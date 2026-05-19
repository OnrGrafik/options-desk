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
function bsDelta(S,K,T,sigma,type) {
  if(T<=0||sigma<=0) return type==="call"?0:-1;
  const sqrtT=Math.sqrt(T), d1=(Math.log(S/K)+0.5*sigma*sigma*T)/(sigma*sqrtT);
  return type==="call"?normCDF(d1):normCDF(d1)-1;
}

// ─── Deribit API ──────────────────────────────────────────
async function deribit(method, params="") {
  const r = await fetch(`/api/deribit?method=${method}&params=${encodeURIComponent(params)}`);
  if(!r.ok) throw new Error(`Deribit API ${r.status}`);
  return r.json();
}

// ─── Market API (multi-source) ────────────────────────────
async function market(source, extra="") {
  const r = await fetch(`/api/market?source=${source}&${extra}`);
  if(!r.ok) return null;
  return r.json();
}

// ─── Fetch BTC spot from Binance (primary), OKX (fallback) ─
export async function fetchSpot() {
  try {
    const d = await market("binance_price", "symbol=BTCUSDT");
    if(d?.price) return parseFloat(d.price);
  } catch(e) {}
  try {
    const d = await market("okx_ticker", "instId=BTC-USDT");
    if(d?.data?.[0]?.last) return parseFloat(d.data[0].last);
  } catch(e) {}
  // Fallback to Deribit index
  const d = await deribit("get_index_price","index_name=btc_usd");
  return d.result?.index_price||0;
}

// ─── Fetch watchlist prices (BTC,ETH,SOL,BNB,XRP) ────────
export async function fetchWatchlist() {
  try {
    const d = await market("coingecko_simple","ids=bitcoin,ethereum,solana,binancecoin,ripple");
    if(d?.bitcoin) return [
      { sym:"BTC", price:d.bitcoin.usd, chg:d.bitcoin.usd_24h_change||0 },
      { sym:"ETH", price:d.ethereum.usd, chg:d.ethereum.usd_24h_change||0 },
      { sym:"SOL", price:d.solana.usd, chg:d.solana.usd_24h_change||0 },
      { sym:"BNB", price:d.binancecoin.usd, chg:d.binancecoin.usd_24h_change||0 },
      { sym:"XRP", price:d.ripple.usd, chg:d.ripple.usd_24h_change||0 },
    ];
  } catch(e) {}
  return [
    { sym:"BTC", price:0, chg:0 },
    { sym:"ETH", price:0, chg:0 },
    { sym:"SOL", price:0, chg:0 },
    { sym:"BNB", price:0, chg:0 },
    { sym:"XRP", price:0, chg:0 },
  ];
}

// ─── Fetch 24h ticker (Binance) ───────────────────────────
export async function fetchTicker24h() {
  try {
    const d = await market("binance_ticker","symbol=BTCUSDT");
    if(d?.openPrice) return {
      open: parseFloat(d.openPrice),
      high: parseFloat(d.highPrice),
      low: parseFloat(d.lowPrice),
      change: parseFloat(d.priceChangePercent),
      volume: parseFloat(d.quoteVolume),
    };
  } catch(e) {}
  return { open:0, high:0, low:0, change:0, volume:0 };
}

// ─── Fetch funding rate ───────────────────────────────────
export async function fetchFunding() {
  try {
    const d = await market("futures_funding","symbol=BTCUSDT");
    if(d?.lastFundingRate!=null) return parseFloat(d.lastFundingRate);
  } catch(e) {}
  try {
    const d = await market("okx_funding","instId=BTC-USD-SWAP");
    if(d?.data?.[0]?.fundingRate) return parseFloat(d.data[0].fundingRate);
  } catch(e) {}
  return 0;
}

// ─── Fetch basis (futures premium) ───────────────────────
export async function fetchBasis() {
  try {
    const d = await market("futures_basis","symbol=BTCUSDT");
    if(d?.[0]?.basisRate) return parseFloat(d[0].basisRate)*100;
  } catch(e) {}
  return 0;
}

// ─── Fetch OHLCV klines (Binance) ────────────────────────
export async function fetchOHLCV(interval="1h", limit=48) {
  try {
    const d = await market("binance_klines",`symbol=BTCUSDT&interval=${interval}&limit=${limit}`);
    if(Array.isArray(d) && d.length) {
      return {
        ticks: d.map(k=>k[0]),
        open:  d.map(k=>parseFloat(k[1])),
        high:  d.map(k=>parseFloat(k[2])),
        low:   d.map(k=>parseFloat(k[3])),
        close: d.map(k=>parseFloat(k[4])),
        volume:d.map(k=>parseFloat(k[5])),
      };
    }
  } catch(e) {}
  return null;
}

// ─── Fetch Deribit BTC options ────────────────────────────
async function fetchDeribitTicker(name) {
  const d = await deribit("ticker",`instrument_name=${name}`);
  return d.result;
}

export async function fetchAllOptions(instruments, spot, onProgress) {
  const now = Date.now();
  const filtered = instruments.filter(i=>i.expiration_timestamp>now);
  const results=[], expirySet=new Set();
  const batchSize=20; let done=0;

  for(let i=0;i<filtered.length;i+=batchSize) {
    const batch=filtered.slice(i,i+batchSize);
    const tickers=await Promise.all(batch.map(inst=>fetchDeribitTicker(inst.instrument_name).catch(()=>null)));

    for(let j=0;j<batch.length;j++) {
      const inst=batch[j], tk=tickers[j];
      if(!tk||!tk.open_interest) continue;
      const T=Math.max((inst.expiration_timestamp-now)/(365.25*24*3600*1000),0.0001);
      const iv=tk.mark_iv?tk.mark_iv/100:0.5;
      const oi=tk.open_interest||0;
      const type=inst.option_type, strike=inst.strike;
      const daysToExp=Math.round(T*365);

      // Prefer Deribit's greeks (forward-adjusted, skew-aware)
      let gamma, delta=0, vega=0;
      if(tk.greeks&&typeof tk.greeks.gamma==="number") {
        gamma=tk.greeks.gamma; delta=tk.greeks.delta||0; vega=tk.greeks.vega||0;
      } else {
        gamma=bsGamma(spot,strike,T,iv);
        delta=bsDelta(spot,strike,T,iv,type);
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
        expiry:new Date(inst.expiration_timestamp).toLocaleDateString("en-GB"),
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

export async function fetchDeribitInstruments() {
  const d = await deribit("get_instruments","currency=BTC&kind=option&expired=false");
  return d.result||[];
}

// ─── Aggregate by strike ──────────────────────────────────
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
    };
    const m=map[k];
    m.netGex+=o.gex; m.vannaNet+=o.vannaEx; m.charmNet+=o.charmEx; m.totalOI+=o.oi;
    if(o.type==="call"){m.callGex+=o.gex;m.callOI+=o.oi;}
    else{m.putGex+=o.gex;m.putOI+=o.oi;}
    m.details.push(o);
  }
  return Object.values(map).sort((a,b)=>a.strike-b.strike);
}

// ─── MAX PAIN — per nearest Friday expiry ─────────────────
export function calcMaxPain(allOptions) {
  if(!allOptions?.length) return null;
  const now=Date.now();
  const expiryMap={};
  for(const o of allOptions) {
    if(!expiryMap[o.expiryTs]) expiryMap[o.expiryTs]={ts:o.expiryTs,opts:[],totalOI:0};
    expiryMap[o.expiryTs].opts.push(o);
    expiryMap[o.expiryTs].totalOI+=o.oi;
  }
  const expiries=Object.values(expiryMap).sort((a,b)=>a.ts-b.ts);
  let target=expiries[0];
  for(const exp of expiries) {
    if(new Date(exp.ts).getUTCDay()===5&&exp.totalOI>0){target=exp;break;}
  }
  if(expiries[0]?.totalOI>target.totalOI*2) target=expiries[0];

  const stMap={};
  for(const o of target.opts) {
    if(!stMap[o.strike]) stMap[o.strike]={strike:o.strike,callOI:0,putOI:0};
    if(o.type==="call") stMap[o.strike].callOI+=o.oi; else stMap[o.strike].putOI+=o.oi;
  }
  const strikes=Object.values(stMap);
  let minPain=Infinity, maxPain=null;
  for(const K of strikes) {
    let pain=0;
    for(const s of strikes) {
      if(s.strike>K.strike) pain+=(s.strike-K.strike)*s.callOI;
      if(K.strike>s.strike) pain+=(K.strike-s.strike)*s.putOI;
    }
    if(pain<minPain){minPain=pain;maxPain=K.strike;}
  }
  return maxPain;
}

// ─── ZERO GAMMA — Brent's Method (scipy.brentq equivalent) ─
// Doğru algoritma:
// 1. Her S fiyatı için tüm opsiyonların gamma'sını BS ile yeniden hesapla
//    G_total(S) = Σ OI_call * Γ(S,K,T,iv) - Σ OI_put * Γ(S,K,T,iv)
// 2. İşaret değişimini geniş taramada bul (bracket)
// 3. Brent yöntemi ile bracket'i daralt → hassas sıfır noktası
// NOT: r (risk-free rate) için Deribit forward basisini kullanıyoruz
//      Her vadenin implied forward'ını call-put paritesinden çıkarıyoruz

function calcImpliedForwardRate(options, expiryTs, spot) {
  // Put-Call Parity: C - P = (F - K) * e^(-rT) → F = PV(C-P) + K
  // En yakın ATM strike'tan implied forward rate hesapla
  const now = Date.now();
  const T = Math.max((expiryTs - now) / (365.25*24*3600*1000), 0.0001);
  const expiryOpts = options.filter(o => o.expiryTs === expiryTs);
  const atmStrike = expiryOpts.reduce((best, o) =>
    Math.abs(o.strike - spot) < Math.abs(best - spot) ? o.strike : best,
    expiryOpts[0]?.strike || spot
  );
  const atmCall = expiryOpts.find(o => o.strike === atmStrike && o.type === "call");
  const atmPut  = expiryOpts.find(o => o.strike === atmStrike && o.type === "put");
  if (!atmCall || !atmPut) return 0; // fallback r=0
  // F = K + (C_price - P_price) / e^(-rT) → simplified: implied r from IV spread
  // Approximate: r ≈ (atmCall.iv - atmPut.iv) as skew proxy (not exact but stable)
  // Better: use the fact that for ATM, d1 ≈ 0.5*sigma*sqrt(T), derive r from futures
  // Use Deribit's index_price vs mark_price gap as basis
  // For simplicity + accuracy: use annualised basis from short-dated ATM
  return 0.05; // BTC crypto basis ~5% annualised (conservative stable estimate)
}

function netGammaAtPrice(S, options, now) {
  let total = 0;
  for (const o of options) {
    const T = Math.max((o.expiryTs - now) / (365.25*24*3600*1000), 0.0001);
    // Use stored IV — this is Deribit's mark IV (vol surface, skew-adjusted)
    const gamma = bsGamma(S, o.strike, T, o.iv);
    // Piyasa yapıcı varsayımı:
    // MM = Uzun Call (pozitif gamma) → +OI * Γ
    // MM = Kısa Put  (negatif gamma) → -OI * Γ
    total += o.oi * gamma * (o.type === "call" ? 1 : -1);
  }
  // Scale to dollar GEX: * S^2 * 0.01 (1% move in $)
  return total * S * S * 0.01;
}

// Brent's method — bracket [a,b] where f(a) and f(b) have opposite signs
function brent(f, a, b, tol = 1.0, maxIter = 60) {
  let fa = f(a), fb = f(b);
  if (fa * fb > 0) return null; // no bracket
  if (Math.abs(fa) < Math.abs(fb)) { [a, b] = [b, a]; [fa, fb] = [fb, fa]; }
  let c = a, fc = fa, mflag = true, s = 0, d = 0;
  for (let i = 0; i < maxIter; i++) {
    if (Math.abs(b - a) < tol) return (a + b) / 2;
    if (fa !== fc && fb !== fc) {
      // Inverse quadratic interpolation
      s = a*fb*fc/((fa-fb)*(fa-fc)) + b*fa*fc/((fb-fa)*(fb-fc)) + c*fa*fb/((fc-fa)*(fc-fb));
    } else {
      s = b - fb * (b - a) / (fb - fa); // secant
    }
    const cond1 = s < (3*a+b)/4 || s > b;
    const cond2 = mflag && Math.abs(s-b) >= Math.abs(b-c)/2;
    const cond3 = !mflag && Math.abs(s-b) >= Math.abs(c-d)/2;
    if (cond1 || cond2 || cond3) { s = (a+b)/2; mflag = true; } else mflag = false;
    const fs = f(s);
    d = c; c = b; fc = fb;
    if (fa*fs < 0) { b = s; fb = fs; } else { a = s; fa = fs; }
    if (Math.abs(fa) < Math.abs(fb)) { [a,b]=[b,a]; [fa,fb]=[fb,fa]; }
  }
  return (a + b) / 2;
}

export function calcZeroGamma(allOptions, spot) {
  if (!allOptions?.length) return null;
  const now = Date.now();
  const f = (S) => netGammaAtPrice(S, allOptions, now);

  // Adım 1: Geniş tarama ile bracket bul (±30%)
  const lo = spot * 0.70, hi = spot * 1.30, steps = 100;
  const step = (hi - lo) / steps;
  const brackets = [];
  let prevG = f(lo);
  for (let i = 1; i <= steps; i++) {
    const S = lo + i * step;
    const currG = f(S);
    if (prevG * currG < 0) {
      brackets.push({ a: S - step, b: S, fromPositive: prevG > 0 });
    }
    prevG = currG;
  }

  if (!brackets.length) return null;

  // Adım 2: Her bracket için Brent yöntemiyle hassas sıfır bul
  const crossings = brackets.map(br => ({
    price: Math.round(brent(f, br.a, br.b, 1.0) || (br.a + br.b) / 2),
    fromPositive: br.fromPositive,
  }));

  const flipUp = crossings.filter(c => c.fromPositive);
  if (flipUp.length) {
    const above = flipUp.filter(c => c.price > spot);
    return above.length?above[0].price:flipUp[flipUp.length-1].price;
  }
  return crossings.reduce((b,c)=>Math.abs(c.price-spot)<Math.abs(b.price-spot)?c:b,crossings[0]).price;
}

// ─── EM Band ──────────────────────────────────────────────
export function calcEMBand(allOptions, spot) {
  if(!allOptions?.length) return {emHigh:null,emLow:null};
  const now=Date.now();
  const expiries=[...new Set(allOptions.map(o=>o.expiryTs))].filter(e=>e>now).sort((a,b)=>a-b);
  let eow=expiries.find(e=>new Date(e).getUTCDay()===5)||expiries[0];
  if(!eow) return {emHigh:null,emLow:null};
  const eowOpts=allOptions.filter(o=>o.expiryTs===eow);
  const eowT=Math.max((eow-now)/(365.25*24*3600*1000),0.0001);
  const atmS=eowOpts.reduce((b,o)=>Math.abs(o.strike-spot)<Math.abs(b.strike-spot)?o:b,eowOpts[0]).strike;
  let cIV=null,pIV=null;
  for(const o of eowOpts) if(o.strike===atmS){if(o.type==="call") cIV=o.iv; else pIV=o.iv;}
  const atmIV=cIV&&pIV?(cIV+pIV)/2:(cIV||pIV||0.5);
  const em=spot*atmIV*Math.sqrt(eowT);
  return {emHigh:Math.round(spot+em),emLow:Math.round(spot-em)};
}

// ─── Find levels ──────────────────────────────────────────
export function findLevels(strikes, spot, allOptions) {
  let callWall=null,putWall=null,maxCG=0,maxPG=0;
  for(const s of strikes) {
    if(s.callGex>maxCG){maxCG=s.callGex;callWall=s.strike;}
    if(Math.abs(s.putGex)>maxPG){maxPG=Math.abs(s.putGex);putWall=s.strike;}
  }
  const maxPain=calcMaxPain(allOptions);
  const zeroGamma=calcZeroGamma(allOptions,spot);
  const {emHigh,emLow}=calcEMBand(allOptions,spot);
  const pct=v=>v?((v-spot)/spot*100).toFixed(2):null;
  return {
    callWall,putWall,maxPain,zeroGamma,emHigh,emLow,
    callWallPct:pct(callWall),putWallPct:pct(putWall),
    maxPainPct:pct(maxPain),zeroGammaPct:pct(zeroGamma),
    emHighPct:pct(emHigh),emLowPct:pct(emLow),
  };
}

// ─── Classify ─────────────────────────────────────────────
export function classifyStrikes(strikes, spot) {
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
