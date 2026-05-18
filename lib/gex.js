// ─── Black-Scholes ────────────────────────────────────────
function normPDF(x) { return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI); }
function normCDF(x) {
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const sign=x<0?-1:1; x=Math.abs(x)/Math.sqrt(2);
  const t=1/(1+p*x); const y=1-((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
  return 0.5*(1+sign*y);
}
function bsGamma(S,K,T,sigma) {
  if(T<=0||sigma<=0||S<=0) return 0;
  const sqrtT=Math.sqrt(T), d1=(Math.log(S/K)+0.5*sigma*sigma*T)/(sigma*sqrtT);
  return normPDF(d1)/(S*sigma*sqrtT);
}

// ─── API ──────────────────────────────────────────────────
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
  const end=Date.now(), start=end-count*parseInt(resolution)*60*1000;
  const d=await api("get_tradingview_chart_data",
    `instrument_name=BTC-PERPETUAL&start_timestamp=${start}&end_timestamp=${end}&resolution=${resolution}`);
  return d.result||null;
}

// ─── Fetch all options ────────────────────────────────────
export async function fetchAllOptions(instruments,spot,onProgress) {
  const now=Date.now();
  const filtered=instruments.filter(i=>i.expiration_timestamp>now);
  const results=[], expirySet=new Set();
  const batchSize=20; let done=0;

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

      // Use Deribit greeks if available (forward-price & skew adjusted)
      let gamma, delta=0, vega=0;
      if(tk.greeks&&typeof tk.greeks.gamma==="number") {
        gamma=tk.greeks.gamma; delta=tk.greeks.delta||0; vega=tk.greeks.vega||0;
      } else {
        gamma=bsGamma(spot,strike,T,iv);
      }

      const gex=gamma*oi*spot*spot*0.01*(type==="call"?1:-1);
      const vannaEx=vega?(vega/spot)*oi*spot*0.01:0;
      const charmEx=gamma?-gamma*spot*iv/(2*Math.sqrt(Math.max(T,0.001)))*oi*0.01:0;

      let expiryLabel;
      if(daysToExp<=7) expiryLabel="0-7d";
      else if(daysToExp<=45) expiryLabel="8-45d";
      else expiryLabel="45d+";

      expirySet.add(inst.expiration_timestamp);
      results.push({
        name:inst.instrument_name, strike, type, oi, iv, T, daysToExp, expiryLabel,
        delta, gamma, vega,
        expiry:new Date(inst.expiration_timestamp).toLocaleDateString("tr-TR"),
        expiryTs:inst.expiration_timestamp,
        gex, vannaEx, charmEx,
      });
    }
    done+=batch.length;
    if(onProgress) onProgress(Math.round((done/filtered.length)*100),results.length,expirySet.size);
    await new Promise(r=>setTimeout(r,80));
  }
  return {options:results, stats:{rows:results.length, totalInst:filtered.length, expiries:expirySet.size}};
}

// ─── Aggregate by strike (expiry filter aware) ────────────
export function aggregateByStrike(options, expiryFilter="all") {
  const map={};
  const activeLabels=expiryFilter==="all"?["0-7d","8-45d","45d+"]:[expiryFilter];
  for(const o of options) {
    if(!activeLabels.includes(o.expiryLabel)) continue;
    const k=o.strike;
    if(!map[k]) map[k]={
      strike:k, callGex:0, putGex:0, netGex:0,
      callOI:0, putOI:0, totalOI:0,
      vannaNet:0, charmNet:0, details:[],
      byExpiry:{"0-7d":{callGex:0,putGex:0},"8-45d":{callGex:0,putGex:0},"45d+":{callGex:0,putGex:0}}
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

// ─── MAX PAIN — correct formula, per-expiry ───────────────
// Uses ALL options (not filtered) for correctness.
// Selects the nearest Friday expiry (e.g. 26.05.2026).
// Pain(K) = Σ max(S_call - K, 0)*OI_call + Σ max(K - S_put, 0)*OI_put
// Min Pain(K) across all K = Max Pain strike
export function calcMaxPain(allOptions) {
  if(!allOptions||!allOptions.length) return null;
  const now=Date.now();

  // Group options by expiry timestamp
  const expiryMap={};
  for(const o of allOptions) {
    if(!expiryMap[o.expiryTs]) expiryMap[o.expiryTs]={ts:o.expiryTs,opts:[],totalOI:0};
    expiryMap[o.expiryTs].opts.push(o);
    expiryMap[o.expiryTs].totalOI+=o.oi;
  }
  const expiries=Object.values(expiryMap).sort((a,b)=>a.ts-b.ts);

  // Select nearest FRIDAY expiry with meaningful OI
  // (Deribit major weekly expiry = Friday 08:00 UTC)
  let target=expiries[0];
  for(const exp of expiries) {
    const dt=new Date(exp.ts);
    if(dt.getUTCDay()===5&&exp.totalOI>0){target=exp;break;}
  }
  // If nearest expiry (any day) has 2x more OI, prefer it (likely imminent expiry)
  if(expiries.length>0&&expiries[0].totalOI>target.totalOI*2) target=expiries[0];

  // Build per-strike call/put OI for this expiry
  const stMap={};
  for(const o of target.opts) {
    if(!stMap[o.strike]) stMap[o.strike]={strike:o.strike,callOI:0,putOI:0};
    if(o.type==="call") stMap[o.strike].callOI+=o.oi;
    else stMap[o.strike].putOI+=o.oi;
  }
  const strikes=Object.values(stMap);
  const strikeList=strikes.map(s=>s.strike).sort((a,b)=>a-b);

  // For each candidate settlement price K, compute total option-holder payout
  // (= total loss to option sellers/writers)
  // Min of this function = Max Pain (writers minimise their losses here)
  let minPain=Infinity, maxPainStrike=null;
  for(const K of strikeList) {
    let pain=0;
    for(const s of strikes) {
      // ITM calls at settlement K: payout = (strike - K) * OI  [if strike > K]
      if(s.strike>K) pain+=( s.strike-K)*s.callOI;
      // ITM puts at settlement K: payout = (K - strike) * OI  [if K > strike]
      if(K>s.strike) pain+=(K-s.strike)*s.putOI;
    }
    if(pain<minPain){minPain=pain;maxPainStrike=K;}
  }
  return maxPainStrike;
}

// ─── ZERO GAMMA — Gamma Profile method ────────────────────
// Recalculates total GEX at 200 price points using Black-Scholes.
// Finds continuous zero-crossing (not just between discrete strikes).
// This is the same approach used by GammaFlip.io & SpotGamma.
export function calcZeroGamma(allOptions, spot) {
  if(!allOptions||!allOptions.length) return null;
  const now=Date.now();
  const lo=spot*0.70, hi=spot*1.30, steps=200;
  const step=(hi-lo)/steps;
  const profile=[];
  for(let i=0;i<=steps;i++) {
    const S=lo+i*step;
    let totalGex=0;
    for(const o of allOptions) {
      const T=Math.max((o.expiryTs-now)/(365.25*24*3600*1000),0.0001);
      const g=bsGamma(S,o.strike,T,o.iv);
      totalGex+=g*o.oi*S*S*0.01*(o.type==="call"?1:-1);
    }
    profile.push({price:S,gex:totalGex});
  }
  // Find sign-change crossings
  const crossings=[];
  for(let i=1;i<profile.length;i++) {
    const prev=profile[i-1],curr=profile[i];
    if((prev.gex>0)!==(curr.gex>0)) {
      const ratio=Math.abs(prev.gex)/(Math.abs(prev.gex)+Math.abs(curr.gex));
      const cross=prev.price+ratio*(curr.price-prev.price);
      crossings.push({price:Math.round(cross),fromPositive:prev.gex>0});
    }
  }
  if(!crossings.length) return null;
  // Gamma flip = positive→negative going UP (resistance level above spot)
  const flipUp=crossings.filter(c=>c.fromPositive);
  if(flipUp.length>0) {
    const above=flipUp.filter(c=>c.price>spot);
    return above.length>0?above[0].price:flipUp[flipUp.length-1].price;
  }
  return crossings.reduce((best,c)=>Math.abs(c.price-spot)<Math.abs(best.price-spot)?c:best,crossings[0]).price;
}

// ─── EM Band from nearest Friday EOW expiry ───────────────
export function calcEMBand(allOptions, spot) {
  if(!allOptions||!allOptions.length) return {emHigh:null,emLow:null};
  const now=Date.now();
  const expiries=[...new Set(allOptions.map(o=>o.expiryTs))].filter(e=>e>now).sort((a,b)=>a-b);
  let eow=expiries.find(e=>new Date(e).getUTCDay()===5)||expiries[0];
  if(!eow) return {emHigh:null,emLow:null};
  const eowOpts=allOptions.filter(o=>o.expiryTs===eow);
  const eowT=Math.max((eow-now)/(365.25*24*3600*1000),0.0001);
  const atmStrike=eowOpts.reduce((b,o)=>Math.abs(o.strike-spot)<Math.abs(b.strike-spot)?o:b,eowOpts[0]).strike;
  let callIV=null,putIV=null;
  for(const o of eowOpts) {
    if(o.strike===atmStrike){if(o.type==="call") callIV=o.iv; else putIV=o.iv;}
  }
  const atmIV=callIV&&putIV?(callIV+putIV)/2:(callIV||putIV||0.5);
  const em=spot*atmIV*Math.sqrt(eowT);
  return {emHigh:Math.round(spot+em),emLow:Math.round(spot-em)};
}

// ─── Find all key levels ──────────────────────────────────
export function findLevels(strikes, spot, allOptions) {
  let callWall=null,putWall=null,maxCG=0,maxPG=0;
  for(const s of strikes) {
    if(s.callGex>maxCG){maxCG=s.callGex;callWall=s.strike;}
    if(Math.abs(s.putGex)>maxPG){maxPG=Math.abs(s.putGex);putWall=s.strike;}
  }
  const maxPain=calcMaxPain(allOptions);
  const zeroGamma=calcZeroGamma(allOptions,spot);
  const {emHigh,emLow}=calcEMBand(allOptions,spot);
  const pct=(v)=>v?((v-spot)/spot*100).toFixed(2):null;
  return {
    callWall,putWall,maxPain,zeroGamma,emHigh,emLow,
    callWallPct:pct(callWall),putWallPct:pct(putWall),
    maxPainPct:pct(maxPain),zeroGammaPct:pct(zeroGamma),
    emHighPct:pct(emHigh),emLowPct:pct(emLow),
  };
}

// ─── Classify strikes ─────────────────────────────────────
export function classifyStrikes(strikes,spot) {
  const totalOI=strikes.reduce((a,s)=>a+s.totalOI,0)||1;
  const maxAbsGex=Math.max(...strikes.map(s=>Math.abs(s.netGex)),1);
  return strikes.map(s=>{
    const oiPct=s.totalOI/totalOI*100;
    const gexPct=Math.abs(s.netGex)/maxAbsGex*100;
    let wallType="neutral";
    if(s.netGex>0&&s.callGex>Math.abs(s.putGex)*0.5) wallType="callWall";
    else if(s.netGex<0&&Math.abs(s.putGex)>s.callGex*0.5) wallType="putWall";
    else if(s.totalOI>0&&oiPct>0.5) wallType="magnet";
    return {
      ...s, wallType,
      isSignificant:oiPct>1||gexPct>5,
      isMajor:oiPct>3||gexPct>25,
      oiPct:oiPct.toFixed(1),
      gexPct:gexPct.toFixed(0),
    };
  });
}
