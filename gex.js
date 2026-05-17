// ═══════════════════════════════════════════════════════════
// Black-Scholes Greeks
// ═══════════════════════════════════════════════════════════
export function normCDF(x) {
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const sign=x<0?-1:1; x=Math.abs(x)/Math.sqrt(2);
  const t=1/(1+p*x);
  const y=1-((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
  return 0.5*(1+sign*y);
}

export function normPDF(x) { return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI); }

export function bsGreeks(S,K,T,sigma,r,type) {
  if(T<=0||sigma<=0) return {delta:0,gamma:0,vanna:0,charm:0};
  const sqrtT=Math.sqrt(T);
  const d1=(Math.log(S/K)+(r+0.5*sigma*sigma)*T)/(sigma*sqrtT);
  const d2=d1-sigma*sqrtT;
  const nd1=normPDF(d1);
  return {
    delta: type==="call" ? normCDF(d1) : normCDF(d1)-1,
    gamma: nd1/(S*sigma*sqrtT),
    vanna: nd1*(1-d1/(sigma*sqrtT))/S,
    charm: -nd1*(2*r*T-d2*sigma*sqrtT)/(2*T*sigma*sqrtT),
  };
}

// ═══════════════════════════════════════════════════════════
// API helpers
// ═══════════════════════════════════════════════════════════
async function api(method,params="") {
  const r=await fetch(`/api/deribit?method=${method}&params=${encodeURIComponent(params)}`);
  if(!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
}

export async function fetchSpot() {
  const d=await api("get_index_price","index_name=btc_usd");
  return d.result?.index_price||0;
}

export async function fetchInstruments() {
  const d=await api("get_instruments","currency=BTC&kind=option&expired=false");
  return d.result||[];
}

export async function fetchTicker(name) {
  const d=await api("ticker",`instrument_name=${name}`);
  return d.result;
}

export async function fetchOHLCV(resolution,count) {
  const end=Date.now();
  const start=end-count*parseInt(resolution)*60*1000;
  const d=await api("get_tradingview_chart_data",
    `instrument_name=BTC-PERPETUAL&start_timestamp=${start}&end_timestamp=${end}&resolution=${resolution}`);
  return d.result||null;
}

// ═══════════════════════════════════════════════════════════
// Fetch ALL options — NO limits
// ═══════════════════════════════════════════════════════════
export async function fetchAllOptions(instruments,spot,onProgress) {
  const now=Date.now();
  // FIX: NO expiry filter — include ALL active expirations
  const filtered=instruments.filter(i=>i.expiration_timestamp>now);
  const results=[];
  const batchSize=20;
  let done=0;
  // Track unique expiries
  const expirySet=new Set();

  for(let i=0;i<filtered.length;i+=batchSize) {
    const batch=filtered.slice(i,i+batchSize);
    const tickers=await Promise.all(batch.map(inst=>fetchTicker(inst.instrument_name).catch(()=>null)));

    for(let j=0;j<batch.length;j++) {
      const inst=batch[j], tk=tickers[j];
      if(!tk||!tk.open_interest) continue;

      const T=Math.max((inst.expiration_timestamp-now)/(365.25*24*3600*1000),0.0001);
      const iv=tk.mark_iv?tk.mark_iv/100:0.5;
      const oi=tk.open_interest||0;
      const type=inst.option_type, strike=inst.strike;
      const daysToExp=Math.round(T*365);
      const greeks=bsGreeks(spot,strike,T,iv,0,type);

      // GEX = Gamma * OI * ContractSize * S^2 * 0.01
      // Deribit: ContractSize = 1 BTC
      const gex=greeks.gamma*oi*1*spot*spot*0.01*(type==="call"?1:-1);
      const vannaEx=greeks.vanna*oi*1*spot*0.01;
      const charmEx=greeks.charm*oi*1*spot*0.01;

      let expiryLabel;
      if(daysToExp<=7) expiryLabel="0-7d";
      else if(daysToExp<=45) expiryLabel="8-45d";
      else expiryLabel="45d+";

      expirySet.add(inst.expiration_timestamp);

      results.push({
        name:inst.instrument_name, strike, type, oi, iv, T, daysToExp, expiryLabel,
        expiry:new Date(inst.expiration_timestamp).toLocaleDateString("tr-TR"),
        expiryTs:inst.expiration_timestamp,
        ...greeks, gex, vannaEx, charmEx,
      });
    }
    done+=batch.length;
    if(onProgress) onProgress(Math.round((done/filtered.length)*100), results.length, expirySet.size);
    await new Promise(r=>setTimeout(r,80));
  }

  return { options: results, stats: { rows: results.length, totalInst: filtered.length, expiries: expirySet.size } };
}

// ═══════════════════════════════════════════════════════════
// Aggregate
// ═══════════════════════════════════════════════════════════
export function aggregateByStrike(options) {
  const map={};
  for(const o of options) {
    const k=o.strike;
    if(!map[k]) map[k]={
      strike:k, callGex:0, putGex:0, netGex:0,
      callOI:0, putOI:0, totalOI:0,
      vannaNet:0, charmNet:0, details:[], byExpiry:{}
    };
    const m=map[k];
    m.netGex+=o.gex; m.vannaNet+=o.vannaEx; m.charmNet+=o.charmEx; m.totalOI+=o.oi;
    if(o.type==="call"){m.callGex+=o.gex;m.callOI+=o.oi;}
    else{m.putGex+=o.gex;m.putOI+=o.oi;}

    if(!m.byExpiry[o.expiryLabel]) m.byExpiry[o.expiryLabel]={callGex:0,putGex:0};
    const be=m.byExpiry[o.expiryLabel];
    if(o.type==="call") be.callGex+=o.gex; else be.putGex+=o.gex;
    m.details.push(o);
  }
  return Object.values(map).sort((a,b)=>a.strike-b.strike);
}

// ═══════════════════════════════════════════════════════════
// Find levels — with EM Band
// ═══════════════════════════════════════════════════════════
export function findLevels(strikes,spot,options) {
  let callWall=null,putWall=null,maxPain=null,zeroGamma=null;
  let maxCG=0,maxPG=0;

  for(const s of strikes) {
    if(s.callGex>maxCG){maxCG=s.callGex;callWall=s.strike;}
    if(Math.abs(s.putGex)>maxPG){maxPG=Math.abs(s.putGex);putWall=s.strike;}
  }

  // Max Pain
  let minPain=Infinity;
  for(const s of strikes) {
    let pain=0;
    for(const s2 of strikes) {
      pain+=s2.callOI*Math.max(0,s2.strike-s.strike);
      pain+=s2.putOI*Math.max(0,s.strike-s2.strike);
    }
    if(pain<minPain){minPain=pain;maxPain=s.strike;}
  }

  // Zero Gamma — linear interpolation, NO rounding
  let minDist=Infinity;
  for(let i=1;i<strikes.length;i++) {
    const prev=strikes[i-1], curr=strikes[i];
    if((prev.netGex>0)!==(curr.netGex>0)) {
      const g1=prev.netGex,g2=curr.netGex;
      const ratio=Math.abs(g1)/(Math.abs(g1)+Math.abs(g2));
      const cross=prev.strike+ratio*(curr.strike-prev.strike);
      const dist=Math.abs(cross-spot);
      if(dist<minDist){minDist=dist;zeroGamma=Math.round(cross);}
    }
  }

  // EM Band — End of Week ATM IV
  let emHigh=null,emLow=null;
  if(options&&options.length) {
    const now=Date.now();
    const expiries=[...new Set(options.map(o=>o.expiryTs))].filter(e=>e>now).sort((a,b)=>a-b);
    // Nearest weekly (< 8 days) or first available
    const targetExp=expiries.find(e=>(e-now)<8*24*3600*1000)||expiries[0];
    if(targetExp) {
      const nearOpts=options.filter(o=>o.expiryTs===targetExp);
      let bestDist=Infinity,atmIV=0.5,atmT=1/365;
      for(const o of nearOpts) {
        const d=Math.abs(o.strike-spot);
        if(d<bestDist){bestDist=d;atmIV=o.iv;atmT=o.T;}
      }
      const em=spot*atmIV*Math.sqrt(atmT);
      emHigh=Math.round(spot+em);
      emLow=Math.round(spot-em);
    }
  }

  // Spot-relative percentages
  const pct=(v)=>v?((v-spot)/spot*100).toFixed(1):null;

  return {
    callWall, putWall, maxPain, zeroGamma, emHigh, emLow,
    callWallPct:pct(callWall), putWallPct:pct(putWall),
    maxPainPct:pct(maxPain), zeroGammaPct:pct(zeroGamma),
  };
}

// ═══════════════════════════════════════════════════════════
// Classify strikes for Tab 2
// ═══════════════════════════════════════════════════════════
export function classifyStrikes(strikes,spot) {
  const totalOI=strikes.reduce((a,s)=>a+s.totalOI,0)||1;
  const maxAbsGex=Math.max(...strikes.map(s=>Math.abs(s.netGex)),1);

  return strikes.map(s=>{
    const oiPct=(s.totalOI/totalOI*100);
    const gexPct=(Math.abs(s.netGex)/maxAbsGex*100);
    let wallType="neutral";
    if(s.netGex>0 && s.callGex>Math.abs(s.putGex)*0.5) wallType="callWall";
    else if(s.netGex<0 && Math.abs(s.putGex)>s.callGex*0.5) wallType="putWall";
    else if(s.totalOI>0 && oiPct>0.5) wallType="magnet";

    return {
      ...s, wallType,
      isSignificant:oiPct>1||gexPct>5,
      oiPct:oiPct.toFixed(1),
      gexPct:gexPct.toFixed(0),
    };
  });
}
