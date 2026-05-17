// ═══════════════════════════════════════════════════════════
// Black-Scholes (fallback only — prefer Deribit's own greeks)
// ═══════════════════════════════════════════════════════════
function normPDF(x) { return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI); }

function bsFallbackGamma(S,K,T,sigma) {
  if(T<=0||sigma<=0) return 0;
  const sqrtT=Math.sqrt(T);
  const d1=(Math.log(S/K)+(0.5*sigma*sigma)*T)/(sigma*sqrtT);
  return normPDF(d1)/(S*sigma*sqrtT);
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
// Fetch ALL options — USE DERIBIT'S OWN GREEKS
// ═══════════════════════════════════════════════════════════
// KEY FIX: Deribit ticker returns `greeks.gamma` computed with:
//   - Forward price (from futures basis, not raw spot)
//   - Their own vol surface (skew-adjusted IV)
//   - Proper rate assumptions
//
// Using their gamma eliminates the main error source.
//
// GEX = gamma * OI * S^2 * 0.01 * sign
// This gives dealer delta-hedging flow per 1% spot move in USD.
// ═══════════════════════════════════════════════════════════
export async function fetchAllOptions(instruments,spot,onProgress) {
  const now=Date.now();
  const filtered=instruments.filter(i=>i.expiration_timestamp>now);
  const results=[];
  const batchSize=20;
  let done=0;
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

      // ── USE DERIBIT'S PRE-COMPUTED GREEKS ──
      let gamma, delta, vega;
      if(tk.greeks && typeof tk.greeks.gamma === 'number') {
        gamma = tk.greeks.gamma;
        delta = tk.greeks.delta || 0;
        vega = tk.greeks.vega || 0;
      } else {
        gamma = bsFallbackGamma(spot,strike,T,iv);
        delta = 0;
        vega = 0;
      }

      // GEX per strike per option:
      // gamma * OI * S^2 * 0.01 * sign
      const gex = gamma * oi * spot * spot * 0.01 * (type==="call" ? 1 : -1);

      // Vanna approx: dDelta/dVol ≈ vega/S
      const vannaEx = vega ? (vega / spot) * oi * spot * 0.01 : 0;

      // Charm approx: dDelta/dT
      const charmEx = gamma ? -gamma * spot * iv / (2*Math.sqrt(Math.max(T,0.001))) * oi * 0.01 : 0;

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
    if(onProgress) onProgress(Math.round((done/filtered.length)*100), results.length, expirySet.size);
    await new Promise(r=>setTimeout(r,80));
  }

  return { options:results, stats:{rows:results.length, totalInst:filtered.length, expiries:expirySet.size} };
}

// ═══════════════════════════════════════════════════════════
// Aggregate by Strike
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
// Find Key Levels
// ═══════════════════════════════════════════════════════════
export function findLevels(strikes,spot,options) {
  let callWall=null,putWall=null,maxPain=null,zeroGamma=null;
  let maxCG=0,maxPG=0;

  for(const s of strikes) {
    if(s.callGex>maxCG){maxCG=s.callGex;callWall=s.strike;}
    if(Math.abs(s.putGex)>maxPG){maxPG=Math.abs(s.putGex);putWall=s.strike;}
  }

  // ──── MAX PAIN (per-expiry) ────
  // Calculate for the nearest major Friday expiry
  if(options&&options.length) {
    const now=Date.now();
    const expiryMap={};
    for(const o of options) {
      if(!expiryMap[o.expiryTs]) expiryMap[o.expiryTs]={ts:o.expiryTs,opts:[],totalOI:0};
      expiryMap[o.expiryTs].opts.push(o);
      expiryMap[o.expiryTs].totalOI+=o.oi;
    }
    const expiries=Object.values(expiryMap).sort((a,b)=>a.ts-b.ts);

    // Nearest Friday expiry, or nearest with most OI
    let target=expiries[0];
    for(const exp of expiries) {
      const dt=new Date(exp.ts);
      if(dt.getUTCDay()===5 && exp.totalOI>0){target=exp;break;}
    }
    if(expiries[0].totalOI>target.totalOI*2) target=expiries[0];

    // Max Pain for target expiry
    const stMap={};
    for(const o of target.opts) {
      if(!stMap[o.strike]) stMap[o.strike]={strike:o.strike,callOI:0,putOI:0};
      if(o.type==="call") stMap[o.strike].callOI+=o.oi;
      else stMap[o.strike].putOI+=o.oi;
    }
    const stArr=Object.values(stMap);
    let minPain=Infinity;
    for(const s of stArr) {
      let pain=0;
      for(const s2 of stArr) {
        pain+=s2.callOI*Math.max(0,s2.strike-s.strike);
        pain+=s2.putOI*Math.max(0,s.strike-s2.strike);
      }
      if(pain<minPain){minPain=pain;maxPain=s.strike;}
    }
  } else {
    let minPain=Infinity;
    for(const s of strikes) {
      let pain=0;
      for(const s2 of strikes) {
        pain+=s2.callOI*Math.max(0,s2.strike-s.strike);
        pain+=s2.putOI*Math.max(0,s.strike-s2.strike);
      }
      if(pain<minPain){minPain=pain;maxPain=s.strike;}
    }
  }

  // ──── ZERO GAMMA ────
  // Find crossing where cumulative GEX flips from positive to negative
  // going UP in strikes — this is the "gamma flip" level
  let crossings=[];
  for(let i=1;i<strikes.length;i++) {
    const prev=strikes[i-1],curr=strikes[i];
    if((prev.netGex>0)!==(curr.netGex>0)) {
      const g1=prev.netGex,g2=curr.netGex;
      const ratio=Math.abs(g1)/(Math.abs(g1)+Math.abs(g2));
      const cross=prev.strike+ratio*(curr.strike-prev.strike);
      crossings.push({price:Math.round(cross),fromPositive:g1>0});
    }
  }
  // Gamma flip = positive→negative transition nearest above spot
  const flipUp=crossings.filter(c=>c.fromPositive);
  if(flipUp.length>0) {
    const aboveSpot=flipUp.filter(c=>c.price>spot);
    zeroGamma=aboveSpot.length>0?aboveSpot[0].price:flipUp[flipUp.length-1].price;
  } else if(crossings.length>0) {
    let minDist=Infinity;
    for(const c of crossings) {
      const dist=Math.abs(c.price-spot);
      if(dist<minDist){minDist=dist;zeroGamma=c.price;}
    }
  }

  // ──── EM BAND (End of Week) ────
  let emHigh=null,emLow=null;
  if(options&&options.length) {
    const now=Date.now();
    const expiries=[...new Set(options.map(o=>o.expiryTs))].filter(e=>e>now).sort((a,b)=>a-b);

    // EOW = nearest Friday
    let eowExp=null;
    for(const exp of expiries) {
      if(new Date(exp).getUTCDay()===5){eowExp=exp;break;}
    }
    if(!eowExp) eowExp=expiries[0];

    if(eowExp) {
      const eowOpts=options.filter(o=>o.expiryTs===eowExp);
      const eowT=Math.max((eowExp-now)/(365.25*24*3600*1000),0.0001);

      // Find ATM options for IV
      let bestDist=Infinity,callIV=null,putIV=null;
      for(const o of eowOpts) {
        const d=Math.abs(o.strike-spot);
        if(d<bestDist){
          bestDist=d;
          if(o.type==="call") callIV=o.iv; else putIV=o.iv;
        }
      }
      // Also grab the other type at same strike
      const atmStrike=eowOpts.reduce((best,o)=>Math.abs(o.strike-spot)<Math.abs(best.strike-spot)?o:best,eowOpts[0]).strike;
      for(const o of eowOpts) {
        if(o.strike===atmStrike) {
          if(o.type==="call") callIV=o.iv; else putIV=o.iv;
        }
      }
      const atmIV=callIV&&putIV?(callIV+putIV)/2:(callIV||putIV||0.5);

      const em=spot*atmIV*Math.sqrt(eowT);
      emHigh=Math.round(spot+em);
      emLow=Math.round(spot-em);
    }
  }

  const pct=(v)=>v?((v-spot)/spot*100).toFixed(1):null;

  return {
    callWall,putWall,maxPain,zeroGamma,emHigh,emLow,
    callWallPct:pct(callWall),putWallPct:pct(putWall),
    maxPainPct:pct(maxPain),zeroGammaPct:pct(zeroGamma),
  };
}

// ═══════════════════════════════════════════════════════════
// Classify for Tab 2
// ═══════════════════════════════════════════════════════════
export function classifyStrikes(strikes,spot) {
  const totalOI=strikes.reduce((a,s)=>a+s.totalOI,0)||1;
  const maxAbsGex=Math.max(...strikes.map(s=>Math.abs(s.netGex)),1);

  return strikes.map(s=>{
    const oiPct=(s.totalOI/totalOI*100);
    const gexPct=(Math.abs(s.netGex)/maxAbsGex*100);
    let wallType="neutral";
    if(s.netGex>0&&s.callGex>Math.abs(s.putGex)*0.5) wallType="callWall";
    else if(s.netGex<0&&Math.abs(s.putGex)>s.callGex*0.5) wallType="putWall";
    else if(s.totalOI>0&&oiPct>0.5) wallType="magnet";

    return {
      ...s,wallType,
      isSignificant:oiPct>1||gexPct>5,
      oiPct:oiPct.toFixed(1),
      gexPct:gexPct.toFixed(0),
    };
  });
}
