// ═══════════════════════════════════════════════════════════
// Multi-asset GEX engine — BTC, ETH, SOL, XRP, BNB
// Kaynak: Wikipedia Greeks + Hull 11e + Deribit API docs
// ═══════════════════════════════════════════════════════════

// ─── Asset configuration ──────────────────────────────────
export const ASSETS = {
  BTC: {
    sym: "BTC", label: "Bitcoin", currency: "BTC",
    indexName: "btc_usd",
    binanceSym: "BTCUSDT",
    cgId: "bitcoin",
    contractSize: 1,       // 1 BTC per contract (inverse)
    linear: false,         // inverse = settled in BTC
    color: "#F7931A",
  },
  ETH: {
    sym: "ETH", label: "Ethereum", currency: "ETH",
    indexName: "eth_usd",
    binanceSym: "ETHUSDT",
    cgId: "ethereum",
    contractSize: 1,       // 1 ETH per contract (inverse)
    linear: false,
    color: "#627EEA",
  },
  SOL: {
    sym: "SOL", label: "Solana", currency: "SOL",
    indexName: "sol_usd",
    binanceSym: "SOLUSDT",
    cgId: "solana",
    contractSize: 1,       // Deribit SOL linear: 1 SOL per contract
    linear: true,          // USDC-settled
    color: "#9945FF",
  },
  XRP: {
    sym: "XRP", label: "Ripple", currency: "XRP",
    indexName: "xrp_usd",
    binanceSym: "XRPUSDT",
    cgId: "ripple",
    contractSize: 1,
    linear: true,
    color: "#00AAE4",
  },
  BNB: {
    sym: "BNB", label: "BNB", currency: "BNB",
    indexName: "bnb_usd",
    binanceSym: "BNBUSDT",
    cgId: "binancecoin",
    contractSize: 1,
    linear: true,
    color: "#F0B90B",
  },
};

// ─── BS helpers ───────────────────────────────────────────
function normPDF(x) { return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI); }
function normCDF(x) {
  const sign = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1/(1+0.2316419*x);
  const poly = t*(0.319381530+t*(-0.356563782+t*(1.781477937+t*(-1.821255978+t*1.330274429))));
  return 0.5 + sign*(0.5 - normPDF(x)*poly);
}
function d1d2(S, K, T, sigma, r=0, q=0) {
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S/K)+(r-q+0.5*sigma*sigma)*T)/(sigma*sqrtT);
  return { d1, d2: d1-sigma*sqrtT, sqrtT };
}

function bsGreeks(S, K, T, sigma, r, q, type) {
  if (T<=0||sigma<=0||S<=0||K<=0) return {delta:0,gamma:0,vega:0,vanna:0,charm:0};
  const {d1, d2, sqrtT} = d1d2(S,K,T,sigma,r,q);
  const nd1 = normPDF(d1), eqT = Math.exp(-q*T);
  const delta = type==="call" ? eqT*normCDF(d1) : eqT*(normCDF(d1)-1);
  const gamma = nd1*eqT/(S*sigma*sqrtT);
  const vega  = S*eqT*nd1*sqrtT;
  const vanna = -eqT*nd1*d2/sigma;
  const charmCore = nd1*(2*(r-q)*T-d2*sigma*sqrtT)/(2*T*sigma*sqrtT);
  const charm = type==="call"
    ? -eqT*(charmCore+q*normCDF(d1))
    : -eqT*(charmCore-q*normCDF(-d1));
  return {delta, gamma, vega, vanna, charm, d1, d2};
}

// ─── API helpers ──────────────────────────────────────────
async function deribit(method, params="") {
  const r = await fetch(`/api/deribit?method=${method}&params=${encodeURIComponent(params)}`);
  if (!r.ok) throw new Error(`Deribit ${r.status}`);
  return r.json();
}
async function mkt(source, extra="") {
  const r = await fetch(`/api/market?source=${source}&${extra}`);
  if (!r.ok) return null;
  return r.json();
}

// ─── Spot fetch (Binance primary, Deribit fallback) ───────
export async function fetchSpot(sym="BTC") {
  const asset = ASSETS[sym];
  try {
    const d = await mkt("binance_price", `symbol=${asset.binanceSym}`);
    if (d?.price) return parseFloat(d.price);
  } catch(e) {}
  const d = await deribit("get_index_price", `index_name=${asset.indexName}`);
  return d.result?.index_price||0;
}

// ─── Watchlist: all 5 assets from CoinGecko ───────────────
export async function fetchWatchlist() {
  try {
    const ids = Object.values(ASSETS).map(a=>a.cgId).join(",");
    const d = await mkt("coingecko_simple", `ids=${ids}`);
    if (d) return Object.values(ASSETS).map(a => ({
      sym:   a.sym,
      label: a.label,
      price: d[a.cgId]?.usd || 0,
      chg:   d[a.cgId]?.usd_24h_change || 0,
    }));
  } catch(e) {}
  return Object.values(ASSETS).map(a => ({sym:a.sym, label:a.label, price:0, chg:0}));
}

// ─── 24h ticker ───────────────────────────────────────────
export async function fetchTicker24h(sym="BTC") {
  const asset = ASSETS[sym];
  try {
    const d = await mkt("binance_ticker", `symbol=${asset.binanceSym}`);
    if (d?.openPrice) return {
      open:   parseFloat(d.openPrice),
      high:   parseFloat(d.highPrice),
      low:    parseFloat(d.lowPrice),
      change: parseFloat(d.priceChangePercent),
      volume: parseFloat(d.quoteVolume),
    };
  } catch(e) {}
  return {open:0,high:0,low:0,change:0,volume:0};
}

// ─── Funding ──────────────────────────────────────────────
export async function fetchFunding(sym="BTC") {
  const asset = ASSETS[sym];
  try {
    const d = await mkt("futures_funding", `symbol=${asset.binanceSym}`);
    if (d?.lastFundingRate!=null) return parseFloat(d.lastFundingRate);
  } catch(e) {}
  return 0;
}

export async function fetchBasis(sym="BTC") {
  try {
    const d = await mkt("futures_basis", `symbol=${ASSETS[sym].binanceSym}`);
    if (d?.[0]?.basisRate) return parseFloat(d[0].basisRate)*100;
  } catch(e) {}
  return 0;
}

// ─── Deribit instruments for any currency ─────────────────
export async function fetchDeribitInstruments(currency="BTC") {
  const d = await deribit("get_instruments", `currency=${currency}&kind=option&expired=false`);
  return d.result||[];
}

async function fetchDeribitTicker(name) {
  const d = await deribit("ticker", `instrument_name=${name}`);
  return d.result;
}

// ─── Fetch all options for a given asset ─────────────────
export async function fetchAllOptions(instruments, spot, sym="BTC", onProgress) {
  const now = Date.now();
  const asset = ASSETS[sym] || ASSETS.BTC;
  const filtered = instruments.filter(i=>i.expiration_timestamp>now);
  const results=[], expirySet=new Set();
  const batchSize=20; let done=0;

  for (let i=0; i<filtered.length; i+=batchSize) {
    const batch=filtered.slice(i,i+batchSize);
    const tickers=await Promise.all(batch.map(inst=>fetchDeribitTicker(inst.instrument_name).catch(()=>null)));

    for (let j=0; j<batch.length; j++) {
      const inst=batch[j], tk=tickers[j];
      if (!tk||!tk.open_interest) continue;

      const T = Math.max((inst.expiration_timestamp-now)/(365.25*24*3600*1000), 0.0001);
      const iv = tk.mark_iv ? tk.mark_iv/100 : 0.5;
      const oi = tk.open_interest||0;
      const type = inst.option_type, strike=inst.strike;
      const daysToExp = Math.round(T*365);

      // Contract size matters for linear vs inverse
      // For linear (SOL/XRP/BNB): contract size in the underlying asset (e.g. 1 SOL)
      // GEX formula uses spot in USD → same formula, just OI units may differ
      const cs = asset.contractSize;

      let gamma, delta=0, vanna, charm;
      if (tk.greeks&&typeof tk.greeks.gamma==="number") {
        gamma=tk.greeks.gamma; delta=tk.greeks.delta||0;
        const bs=bsGreeks(spot,strike,T,iv,0,0,type);
        vanna=bs.vanna; charm=bs.charm;
      } else {
        const bs=bsGreeks(spot,strike,T,iv,0,0,type);
        gamma=bs.gamma; delta=bs.delta; vanna=bs.vanna; charm=bs.charm;
      }

      // GEX = Γ × OI × contractSize × S² × 0.01 × sign
      const gex   = gamma * oi * cs * spot * spot * 0.01 * (type==="call"?1:-1);
      const vex   = vanna * oi * cs * spot * 0.01       * (type==="call"?1:-1);
      const cex   = charm * oi * cs * spot * (1/365)    * (type==="call"?1:-1);

      let expiryLabel;
      if (daysToExp<=7)  expiryLabel="0-7d";
      else if (daysToExp<=45) expiryLabel="8-45d";
      else expiryLabel="45d+";

      expirySet.add(inst.expiration_timestamp);
      results.push({
        name:inst.instrument_name, strike, type, oi, iv, T, daysToExp, expiryLabel,
        delta, gamma, vanna, charm,
        expiry: new Date(inst.expiration_timestamp).toLocaleDateString("tr-TR"),
        expiryTs: inst.expiration_timestamp,
        gex, vex, cex,
      });
    }
    done+=batch.length;
    if (onProgress) onProgress(Math.round((done/filtered.length)*100), results.length, expirySet.size);
    await new Promise(r=>setTimeout(r,80));
  }
  return {options:results, stats:{rows:results.length, totalInst:filtered.length, expiries:expirySet.size}};
}

// ─── Aggregate ────────────────────────────────────────────
export function aggregateByStrike(options, expiryFilter="all") {
  const map={};
  const labels=expiryFilter==="all"?["0-7d","8-45d","45d+"]:[expiryFilter];
  for (const o of options) {
    if (!labels.includes(o.expiryLabel)) continue;
    const k=o.strike;
    if (!map[k]) map[k]={strike:k,callGex:0,putGex:0,netGex:0,callOI:0,putOI:0,totalOI:0,vannaNet:0,charmNet:0,details:[]};
    const m=map[k];
    m.netGex+=o.gex; m.vannaNet+=o.vex; m.charmNet+=o.cex; m.totalOI+=o.oi;
    if (o.type==="call"){m.callGex+=o.gex;m.callOI+=o.oi;}
    else{m.putGex+=o.gex;m.putOI+=o.oi;}
    m.details.push(o);
  }
  return Object.values(map).sort((a,b)=>a.strike-b.strike);
}

// ─── Max Pain (nearest Friday expiry, Hull Ch.18) ─────────
export function calcMaxPain(allOptions) {
  if (!allOptions?.length) return null;
  const now=Date.now();
  const expiryMap={};
  for (const o of allOptions) {
    if (!expiryMap[o.expiryTs]) expiryMap[o.expiryTs]={ts:o.expiryTs,opts:[],totalOI:0};
    expiryMap[o.expiryTs].opts.push(o); expiryMap[o.expiryTs].totalOI+=o.oi;
  }
  const expiries=Object.values(expiryMap).sort((a,b)=>a.ts-b.ts);
  let target=expiries[0];
  for (const exp of expiries) if (new Date(exp.ts).getUTCDay()===5&&exp.totalOI>0){target=exp;break;}
  if (expiries[0]?.totalOI>target.totalOI*2) target=expiries[0];

  const stMap={};
  for (const o of target.opts) {
    if (!stMap[o.strike]) stMap[o.strike]={strike:o.strike,callOI:0,putOI:0};
    if (o.type==="call") stMap[o.strike].callOI+=o.oi; else stMap[o.strike].putOI+=o.oi;
  }
  const strikes=Object.values(stMap);
  let minPain=Infinity, maxPain=null;
  for (const K of strikes) {
    let pain=0;
    for (const s of strikes) {
      if (s.strike>K.strike) pain+=(s.strike-K.strike)*s.callOI;
      if (K.strike>s.strike) pain+=(K.strike-s.strike)*s.putOI;
    }
    if (pain<minPain){minPain=pain;maxPain=K.strike;}
  }
  return maxPain;
}

// ─── Zero Gamma — Brent's Method ─────────────────────────
function netGammaAtPrice(S, options, now) {
  let total=0;
  for (const o of options) {
    if (!o.iv||!o.strike||!o.expiryTs) continue;
    const T=Math.max((o.expiryTs-now)/(365.25*24*3600*1000),0.0001);
    const g=normPDF((Math.log(S/o.strike)+0.5*o.iv*o.iv*T)/(o.iv*Math.sqrt(T)))/(S*o.iv*Math.sqrt(T));
    total+=o.oi*g*S*S*0.01*(o.type==="call"?1:-1);
  }
  return total;
}
function brent(f,a,b,tol=1.0,maxIter=60) {
  let fa=f(a),fb=f(b);
  if (fa*fb>0) return null;
  if (Math.abs(fa)<Math.abs(fb)){[a,b]=[b,a];[fa,fb]=[fb,fa];}
  let c=a,fc=fa,mflag=true,s=0,d=0;
  for (let i=0;i<maxIter;i++) {
    if (Math.abs(b-a)<tol) return (a+b)/2;
    if (fa!==fc&&fb!==fc) s=a*fb*fc/((fa-fb)*(fa-fc))+b*fa*fc/((fb-fa)*(fb-fc))+c*fa*fb/((fc-fa)*(fc-fb));
    else s=b-fb*(b-a)/(fb-fa);
    const c1=s<(3*a+b)/4||s>b,c2=mflag&&Math.abs(s-b)>=Math.abs(b-c)/2,c3=!mflag&&Math.abs(s-b)>=Math.abs(c-d)/2;
    if (c1||c2||c3){s=(a+b)/2;mflag=true;}else mflag=false;
    const fs=f(s); d=c;c=b;fc=fb;
    if (fa*fs<0){b=s;fb=fs;}else{a=s;fa=fs;}
    if (Math.abs(fa)<Math.abs(fb)){[a,b]=[b,a];[fa,fb]=[fb,fa];}
  }
  return (a+b)/2;
}
export function calcZeroGamma(allOptions, spot) {
  if (!allOptions?.length) return null;
  const now=Date.now();
  const f=S=>netGammaAtPrice(S,allOptions,now);
  const lo=spot*0.70,hi=spot*1.30,steps=100,step=(hi-lo)/steps;
  const brackets=[]; let prevG=f(lo);
  for (let i=1;i<=steps;i++) {
    const S=lo+i*step,currG=f(S);
    if (prevG*currG<0) brackets.push({a:S-step,b:S,fromPositive:prevG>0});
    prevG=currG;
  }
  if (!brackets.length) return null;
  const crossings=brackets.map(br=>({price:Math.round(brent(f,br.a,br.b,1.0)??(br.a+br.b)/2),fromPositive:br.fromPositive}));
  const flipUp=crossings.filter(c=>c.fromPositive);
  if (flipUp.length){const above=flipUp.filter(c=>c.price>spot);return above.length?above[0].price:flipUp[flipUp.length-1].price;}
  return crossings.reduce((best,c)=>Math.abs(c.price-spot)<Math.abs(best.price-spot)?c:best,crossings[0]).price;
}

// ─── EM Band ──────────────────────────────────────────────
export function calcEMBand(allOptions, spot) {
  if (!allOptions?.length) return {emHigh:null,emLow:null};
  const now=Date.now();
  const expiries=[...new Set(allOptions.map(o=>o.expiryTs))].filter(e=>e>now).sort((a,b)=>a-b);
  let eow=expiries.find(e=>new Date(e).getUTCDay()===5)||expiries[0];
  if (!eow) return {emHigh:null,emLow:null};
  const eowOpts=allOptions.filter(o=>o.expiryTs===eow);
  const T=Math.max((eow-now)/(365.25*24*3600*1000),0.0001);
  const calls=eowOpts.filter(o=>o.type==="call").sort((a,b)=>a.strike-b.strike);
  let atmIV=0.5;
  if (calls.length) {
    const above=calls.find(c=>c.strike>=spot), below=[...calls].reverse().find(c=>c.strike<spot);
    if (above&&below){const lm1=Math.abs(Math.log(below.strike/spot)),lm2=Math.abs(Math.log(above.strike/spot));atmIV=lm1+lm2>0?below.iv*(lm2/(lm1+lm2))+above.iv*(lm1/(lm1+lm2)):above.iv;}
    else if (above) atmIV=above.iv; else if (below) atmIV=below.iv;
  }
  const em=spot*atmIV*Math.sqrt(T);
  return {emHigh:Math.round(spot+em),emLow:Math.round(spot-em)};
}

// ─── Find levels ──────────────────────────────────────────
export function findLevels(strikes, spot, allOptions) {
  let callWall=null,putWall=null,maxCG=0,maxPG=0;
  for (const s of strikes) {
    if (s.callGex>maxCG){maxCG=s.callGex;callWall=s.strike;}
    if (Math.abs(s.putGex)>maxPG){maxPG=Math.abs(s.putGex);putWall=s.strike;}
  }
  const maxPain=calcMaxPain(allOptions);
  const zeroGamma=calcZeroGamma(allOptions,spot);
  const {emHigh,emLow}=calcEMBand(allOptions,spot);
  const pct=v=>v?((v-spot)/spot*100).toFixed(2):null;
  return {callWall,putWall,maxPain,zeroGamma,emHigh,emLow,
    callWallPct:pct(callWall),putWallPct:pct(putWall),
    maxPainPct:pct(maxPain),zeroGammaPct:pct(zeroGamma),
    emHighPct:pct(emHigh),emLowPct:pct(emLow)};
}

// ─── Volatility surface ───────────────────────────────────
export function calcVolSurface(options, spot) {
  if (!options?.length) return {termStructure:[],riskReversals:[]};
  const now=Date.now();
  const expiryMap={};
  for (const o of options) {
    if (o.expiryTs<=now) continue;
    if (!expiryMap[o.expiryTs]) expiryMap[o.expiryTs]={ts:o.expiryTs,days:o.daysToExp,T:o.T,opts:[]};
    expiryMap[o.expiryTs].opts.push(o);
  }
  const termStructure=[],riskReversals=[];
  for (const exp of Object.values(expiryMap).sort((a,b)=>a.ts-b.ts)) {
    const {days,T,opts}=exp;
    if (!opts.length||days<0) continue;
    const calls=opts.filter(o=>o.type==="call").sort((a,b)=>a.strike-b.strike);
    let atmIV=null;
    if (calls.length) {
      const above=calls.find(c=>c.strike>=spot),below=[...calls].reverse().find(c=>c.strike<spot);
      if (above&&below){const lm1=Math.abs(Math.log(below.strike/spot)),lm2=Math.abs(Math.log(above.strike/spot));atmIV=lm1+lm2>0?below.iv*(lm2/(lm1+lm2))+above.iv*(lm1/(lm1+lm2)):above.iv;}
      else if (above) atmIV=above.iv; else if (below) atmIV=below.iv;
    }
    if (atmIV!==null) termStructure.push({days,T,iv:atmIV*100});

    let bestCall25=null,bestPut25=null,minCd=Infinity,minPd=Infinity;
    for (const o of opts) {
      if (!o.T||!o.iv) continue;
      const {d1}=d1d2(spot,o.strike,o.T,o.iv,0,0);
      const delta=o.type==="call"?normCDF(d1):normCDF(d1)-1;
      if (o.type==="call"){const dist=Math.abs(delta-0.25);if(dist<minCd){minCd=dist;bestCall25={...o,calcDelta:delta};}}
      else{const dist=Math.abs(Math.abs(delta)-0.25);if(dist<minPd){minPd=dist;bestPut25={...o,calcDelta:delta};}}
    }
    if (bestCall25&&bestPut25&&minCd<0.15&&minPd<0.15) {
      const rr=(bestPut25.iv-bestCall25.iv)*100;
      if (Math.abs(rr)<20) riskReversals.push({days,rr,putIV:bestPut25.iv*100,callIV:bestCall25.iv*100,atmIV:atmIV?atmIV*100:null});
    }
  }
  return {termStructure,riskReversals};
}

// ─── Classify strikes ─────────────────────────────────────
export function classifyStrikes(strikes, spot) {
  const totalOI=strikes.reduce((a,s)=>a+s.totalOI,0)||1;
  const maxAbsGex=Math.max(...strikes.map(s=>Math.abs(s.netGex)),1);
  return strikes.map(s=>{
    const oiPct=s.totalOI/totalOI*100, gexPct=Math.abs(s.netGex)/maxAbsGex*100;
    let wallType="neutral";
    if (s.netGex>0&&s.callGex>Math.abs(s.putGex)*0.5) wallType="callWall";
    else if (s.netGex<0&&Math.abs(s.putGex)>s.callGex*0.5) wallType="putWall";
    else if (s.totalOI>0&&oiPct>0.5) wallType="magnet";
    return {...s,wallType,isSignificant:oiPct>1||gexPct>5,isMajor:oiPct>3||gexPct>25,oiPct:oiPct.toFixed(1),gexPct:gexPct.toFixed(0)};
  });
}
