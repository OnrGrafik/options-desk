// ═══════════════════════════════════════════════════════════════
// KAYNAK: Wikipedia "Greeks (finance)" + Hull "Options, Futures..."
// Tüm formüller exact BS türevleri kullanır
// ═══════════════════════════════════════════════════════════════

// ─── Yardımcı fonksiyonlar ────────────────────────────────
function normPDF(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function normCDF(x) {
  // Abramowitz & Stegun 26.2.17 — max |error| < 7.5×10⁻⁸
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * x);
  const poly = t * (0.319381530
    + t * (-0.356563782
    + t * (1.781477937
    + t * (-1.821255978
    + t * 1.330274429))));
  return 0.5 + sign * (0.5 - normPDF(x) * poly);
}

// ─── d1, d2 ───────────────────────────────────────────────
// d1 = [ln(S/K) + (r - q + σ²/2)T] / (σ√T)
// d2 = d1 - σ√T
// For Deribit BTC (no continuous dividend, use r≈0):
//   d1 = [ln(S/K) + σ²T/2] / (σ√T)
function d1d2(S, K, T, sigma, r = 0, q = 0) {
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return { d1, d2, sqrtT };
}

// ─── Full BS Greek engine ─────────────────────────────────
// Returns all Greeks with exact Wikipedia formulas
// r = risk-free rate (≈0 for Deribit, or use futures basis/365)
// q = continuous dividend yield (0 for BTC spot)
function bsGreeks(S, K, T, sigma, r, q, type) {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    return { delta: 0, gamma: 0, vega: 0, vanna: 0, charm: 0, vomma: 0 };
  }
  const { d1, d2, sqrtT } = d1d2(S, K, T, sigma, r, q);
  const nd1 = normPDF(d1);
  const eqT = Math.exp(-q * T);

  // Delta — Wikipedia: e^(-qT)*N(d1) for call; e^(-qT)*(N(d1)-1) for put
  const delta = type === "call"
    ? eqT * normCDF(d1)
    : eqT * (normCDF(d1) - 1);

  // Gamma — same for call & put
  // Wikipedia: Γ = N'(d1) * e^(-qT) / (S * σ * √T)
  const gamma = nd1 * eqT / (S * sigma * sqrtT);

  // Vega — same for call & put
  // Wikipedia: ν = S * e^(-qT) * N'(d1) * √T
  // Units: option price change per 1-unit change in σ (decimal)
  const vega = S * eqT * nd1 * sqrtT;

  // Vanna — same for call & put
  // Wikipedia: Vanna = -e^(-qT) * N'(d1) * d2 / σ
  // = ∂delta/∂σ = ∂vega/∂S
  // Units: delta change per 1-unit change in σ (decimal)
  const vanna = -eqT * nd1 * d2 / sigma;

  // Charm — different for call and put
  // Wikipedia (general, with r and q):
  // Call: -e^(-qT) * [ N'(d1) * (2(r-q)T - d2*σ*√T) / (2T*σ*√T) + q*N(d1) ]
  // Put:  -e^(-qT) * [ N'(d1) * (2(r-q)T - d2*σ*√T) / (2T*σ*√T) - q*N(-d1) ]
  // = ∂delta/∂τ (change in delta per 1 year passing)
  let charm;
  const charmCore = nd1 * (2 * (r - q) * T - d2 * sigma * sqrtT) / (2 * T * sigma * sqrtT);
  if (type === "call") {
    charm = -eqT * (charmCore + q * normCDF(d1));
  } else {
    charm = -eqT * (charmCore - q * normCDF(-d1));
  }

  // Vomma / Volga — same for call & put
  // Wikipedia: Vomma = Vega * d1 * d2 / σ
  const vomma = vega * d1 * d2 / sigma;

  return { delta, gamma, vega, vanna, charm, vomma, d1, d2 };
}

// ─── API ──────────────────────────────────────────────────
async function deribit(method, params = "") {
  const r = await fetch(`/api/deribit?method=${method}&params=${encodeURIComponent(params)}`);
  if (!r.ok) throw new Error(`Deribit API ${r.status}`);
  return r.json();
}
async function market(source, extra = "") {
  const r = await fetch(`/api/market?source=${source}&${extra}`);
  if (!r.ok) return null;
  return r.json();
}

// ─── Market data fetchers ─────────────────────────────────
export async function fetchSpot() {
  try {
    const d = await market("binance_price", "symbol=BTCUSDT");
    if (d?.price) return parseFloat(d.price);
  } catch (e) {}
  try {
    const d = await market("okx_ticker", "instId=BTC-USDT");
    if (d?.data?.[0]?.last) return parseFloat(d.data[0].last);
  } catch (e) {}
  const d = await deribit("get_index_price", "index_name=btc_usd");
  return d.result?.index_price || 0;
}

export async function fetchWatchlist() {
  try {
    const d = await market("coingecko_simple", "ids=bitcoin,ethereum,solana,binancecoin,ripple");
    if (d?.bitcoin) return [
      { sym: "BTC", price: d.bitcoin.usd,      chg: d.bitcoin.usd_24h_change || 0 },
      { sym: "ETH", price: d.ethereum.usd,     chg: d.ethereum.usd_24h_change || 0 },
      { sym: "SOL", price: d.solana.usd,        chg: d.solana.usd_24h_change || 0 },
      { sym: "BNB", price: d.binancecoin.usd,   chg: d.binancecoin.usd_24h_change || 0 },
      { sym: "XRP", price: d.ripple.usd,        chg: d.ripple.usd_24h_change || 0 },
    ];
  } catch (e) {}
  return ["BTC","ETH","SOL","BNB","XRP"].map(sym => ({ sym, price: 0, chg: 0 }));
}

export async function fetchTicker24h() {
  try {
    const d = await market("binance_ticker", "symbol=BTCUSDT");
    if (d?.openPrice) return {
      open:   parseFloat(d.openPrice),
      high:   parseFloat(d.highPrice),
      low:    parseFloat(d.lowPrice),
      change: parseFloat(d.priceChangePercent),
      volume: parseFloat(d.quoteVolume),
    };
  } catch (e) {}
  return { open: 0, high: 0, low: 0, change: 0, volume: 0 };
}

export async function fetchFunding() {
  try {
    const d = await market("futures_funding", "symbol=BTCUSDT");
    if (d?.lastFundingRate != null) return parseFloat(d.lastFundingRate);
  } catch (e) {}
  try {
    const d = await market("okx_funding", "instId=BTC-USD-SWAP");
    if (d?.data?.[0]?.fundingRate) return parseFloat(d.data[0].fundingRate);
  } catch (e) {}
  return 0;
}

export async function fetchBasis() {
  try {
    const d = await market("futures_basis", "symbol=BTCUSDT");
    if (d?.[0]?.basisRate) return parseFloat(d[0].basisRate) * 100;
  } catch (e) {}
  return 0;
}

export async function fetchDeribitInstruments() {
  const d = await deribit("get_instruments", "currency=BTC&kind=option&expired=false");
  return d.result || [];
}

async function fetchDeribitTicker(name) {
  const d = await deribit("ticker", `instrument_name=${name}`);
  return d.result;
}

// ─── Opsiyon zinciri çekme ────────────────────────────────
export async function fetchAllOptions(instruments, spot, onProgress) {
  const now = Date.now();
  const filtered = instruments.filter(i => i.expiration_timestamp > now);
  const results = [];
  const expirySet = new Set();
  const batchSize = 20;
  let done = 0;

  for (let i = 0; i < filtered.length; i += batchSize) {
    const batch = filtered.slice(i, i + batchSize);
    const tickers = await Promise.all(
      batch.map(inst => fetchDeribitTicker(inst.instrument_name).catch(() => null))
    );

    for (let j = 0; j < batch.length; j++) {
      const inst = batch[j], tk = tickers[j];
      if (!tk || !tk.open_interest) continue;

      const T = Math.max((inst.expiration_timestamp - now) / (365.25 * 24 * 3600 * 1000), 0.0001);
      const iv = tk.mark_iv ? tk.mark_iv / 100 : 0.5;  // decimal (0.50 = 50%)
      const oi = tk.open_interest || 0;
      const type = inst.option_type;   // "call" | "put"
      const strike = inst.strike;
      const daysToExp = Math.round(T * 365);

      // ── Deribit'in kendi greek'lerini kullan (forward fiyatlı, skew-aware)
      // Deribit gamma birimi: ∂delta/∂S (per $1 spot move) — aynı bizim bsGamma'mız
      let gamma, delta, vega, vanna, charm;

      if (tk.greeks && typeof tk.greeks.gamma === "number") {
        // Deribit forward-adjusted greeks (daha doğru, basis ve skew dahil)
        gamma = tk.greeks.gamma;
        delta = tk.greeks.delta || 0;
        vega  = tk.greeks.vega  || 0; // Deribit vega: per 1% IV change
        // Vanna & charm: Deribit vermez, BS ile hesaplanır
        const bs = bsGreeks(spot, strike, T, iv, 0, 0, type);
        vanna = bs.vanna;
        charm = bs.charm;
        // Deribit vega birimi: option value change per 1% IV = vega/100 in decimal terms
        // Bizim vanna birimi: ∂delta/∂σ (per 1-unit σ decimal)
        // Uyum: Deribit vega ≈ bs.vega * 0.01 (per 1% = per 0.01 decimal)
      } else {
        // Fallback: tam BS hesabı
        const bs = bsGreeks(spot, strike, T, iv, 0, 0, type);
        gamma = bs.gamma;
        delta = bs.delta;
        vega  = bs.vega * 0.01; // Convert to "per 1% IV" to match Deribit format
        vanna = bs.vanna;
        charm = bs.charm;
      }

      // ─── GEX (Gamma Exposure) ───────────────────────────
      // Kaynak: SpotGamma, Barchart (standart endüstri formülü)
      // GEX = Γ × OI × S² × 0.01
      // Birimi: USD per 1% spot move
      // Piyasa yapıcı varsayımı (crypto):
      //   Call: müşteri alır → MM short call → MM long gamma → pozitif GEX
      //   Put:  müşteri alır → MM short put  → MM long gamma, AMA
      //         put OTM hedging → negatif GEX etkisi
      // Net GEX convention: call = +, put = -
      const gex = gamma * oi * spot * spot * 0.01 * (type === "call" ? 1 : -1);

      // ─── Vanna Exposure (VEX) ───────────────────────────
      // Kaynak: Wikipedia "Greeks (finance)" — Vanna = ∂delta/∂σ
      // Formül: Vanna = -e^(-qT) * N'(d1) * d2 / σ  (q=r=0 için: -N'(d1)*d2/σ)
      // VEX birim: USD delta change per 1% IV change
      // VEX = vanna × OI × S × 0.01
      // Açıklama: IV %1 artarsa delta (vanna×0.01) kadar değişir,
      //           her kontrat S BTC değerinde → toplam etki: vanna×0.01×S×OI
      // Sign convention: call ve put için aynı vanna → dealer flow yönü OI ağırlıklı
      const vex = vanna * oi * spot * 0.01 * (type === "call" ? 1 : -1);

      // ─── Charm Exposure (CEX) ───────────────────────────
      // Kaynak: Wikipedia "Greeks (finance)" — Charm = ∂delta/∂τ (per year)
      // CEX birim: USD delta change per 1 calendar day
      // CEX = charm × OI × S × (1/365)
      // (1/365): charm per-year → per-day dönüşümü
      const cex = charm * oi * spot * (1 / 365) * (type === "call" ? 1 : -1);

      let expiryLabel;
      if (daysToExp <= 7)  expiryLabel = "0-7d";
      else if (daysToExp <= 45) expiryLabel = "8-45d";
      else expiryLabel = "45d+";

      expirySet.add(inst.expiration_timestamp);
      results.push({
        name: inst.instrument_name, strike, type, oi, iv, T, daysToExp, expiryLabel,
        delta, gamma, vega, vanna, charm,
        expiry: new Date(inst.expiration_timestamp).toLocaleDateString("tr-TR"),
        expiryTs: inst.expiration_timestamp,
        gex, vex, cex,
      });
    }

    done += batch.length;
    if (onProgress) onProgress(Math.round((done / filtered.length) * 100), results.length, expirySet.size);
    await new Promise(r => setTimeout(r, 80));
  }

  return { options: results, stats: { rows: results.length, totalInst: filtered.length, expiries: expirySet.size } };
}

// ─── Strike bazlı toplama ─────────────────────────────────
export function aggregateByStrike(options, expiryFilter = "all") {
  const map = {};
  const activeLabels = expiryFilter === "all" ? ["0-7d", "8-45d", "45d+"] : [expiryFilter];

  for (const o of options) {
    if (!activeLabels.includes(o.expiryLabel)) continue;
    const k = o.strike;
    if (!map[k]) map[k] = {
      strike: k,
      callGex: 0, putGex: 0, netGex: 0,
      callOI: 0,  putOI: 0,  totalOI: 0,
      vannaNet: 0, charmNet: 0,
      details: [],
    };
    const m = map[k];
    m.netGex   += o.gex;
    m.vannaNet += o.vex;
    m.charmNet += o.cex;
    m.totalOI  += o.oi;
    if (o.type === "call") { m.callGex += o.gex; m.callOI += o.oi; }
    else                    { m.putGex  += o.gex; m.putOI  += o.oi; }
    m.details.push(o);
  }

  return Object.values(map).sort((a, b) => a.strike - b.strike);
}

// ─── MAX PAIN ─────────────────────────────────────────────
// Kaynak: Hull "Options, Futures, and Other Derivatives" Ch. 18
// Formül: Pain(K) = Σ_i max(K_i - K, 0)×OI_call_i + Σ_j max(K - K_j, 0)×OI_put_j
// Hesap: En yakın Cuma vadesi için (Deribit ana vade günü)
// Rationale: Opsiyon yazarları (MM'ler) en az ödeme yapacakları K'ya settlement'ı çeker
export function calcMaxPain(allOptions) {
  if (!allOptions?.length) return null;
  const now = Date.now();

  // Vade bazında gruplama
  const expiryMap = {};
  for (const o of allOptions) {
    if (!expiryMap[o.expiryTs]) expiryMap[o.expiryTs] = { ts: o.expiryTs, opts: [], totalOI: 0 };
    expiryMap[o.expiryTs].opts.push(o);
    expiryMap[o.expiryTs].totalOI += o.oi;
  }
  const expiries = Object.values(expiryMap).sort((a, b) => a.ts - b.ts);

  // En yakın Cuma vadesi (Deribit haftalık): UTC gün = 5
  let target = expiries[0];
  for (const exp of expiries) {
    if (new Date(exp.ts).getUTCDay() === 5 && exp.totalOI > 0) { target = exp; break; }
  }
  // Eğer en yakın vade 2x daha fazla OI taşıyorsa onu tercih et
  if (expiries[0]?.totalOI > target.totalOI * 2) target = expiries[0];

  // Strike bazında call/put OI
  const stMap = {};
  for (const o of target.opts) {
    if (!stMap[o.strike]) stMap[o.strike] = { strike: o.strike, callOI: 0, putOI: 0 };
    if (o.type === "call") stMap[o.strike].callOI += o.oi;
    else                    stMap[o.strike].putOI  += o.oi;
  }
  const strikes = Object.values(stMap);

  // Her aday settlement fiyatı K için toplam payout hesapla
  let minPain = Infinity, maxPain = null;
  for (const K of strikes) {
    let pain = 0;
    for (const s of strikes) {
      // Call payout at K: max(strike - K, 0) × OI_call
      if (s.strike > K.strike) pain += (s.strike - K.strike) * s.callOI;
      // Put payout at K: max(K - strike, 0) × OI_put
      if (K.strike > s.strike) pain += (K.strike - s.strike) * s.putOI;
    }
    if (pain < minPain) { minPain = pain; maxPain = K.strike; }
  }
  return maxPain;
}

// ─── ZERO GAMMA — Brent's Method ─────────────────────────
// Kaynak: Numerical Recipes + GammaFlip.io metodolojisi
// G(S) = Σ_i OI_call_i × Γ(S,K_i,T_i,σ_i) - Σ_j OI_put_j × Γ(S,K_j,T_j,σ_j)
// Zero Gamma: G(S*) = 0 olan S*
// Gamma Profile: Her fiyat noktasında BS gamma yeniden hesaplanır (spot-fiyat-bağımlı)
// Bu yöntem continuous zero-crossing verir (diskret strike'lar arası değil)

function netGammaAtPrice(S, options, now) {
  let total = 0;
  for (const o of options) {
    if (!o.iv || !o.strike || !o.expiryTs) continue;
    const T = Math.max((o.expiryTs - now) / (365.25 * 24 * 3600 * 1000), 0.0001);
    // S bu noktada spot değil, hypothetical price — gamma'yı o fiyat için hesapla
    const gamma = normPDF(
      (Math.log(S / o.strike) + 0.5 * o.iv * o.iv * T) / (o.iv * Math.sqrt(T))
    ) / (S * o.iv * Math.sqrt(T));
    total += o.oi * gamma * S * S * 0.01 * (o.type === "call" ? 1 : -1);
  }
  return total;
}

// Brent's method — scipy.brentq JavaScript implementasyonu
// Tolerance: $1 (tol=1.0)
function brent(f, a, b, tol = 1.0, maxIter = 60) {
  let fa = f(a), fb = f(b);
  if (fa * fb > 0) return null; // Bracket yok
  if (Math.abs(fa) < Math.abs(fb)) { [a, b] = [b, a]; [fa, fb] = [fb, fa]; }
  let c = a, fc = fa, mflag = true, s = 0, d = 0;
  for (let i = 0; i < maxIter; i++) {
    if (Math.abs(b - a) < tol) return (a + b) / 2;
    if (fa !== fc && fb !== fc) {
      // Inverse quadratic interpolation
      s = a*fb*fc/((fa-fb)*(fa-fc)) + b*fa*fc/((fb-fa)*(fb-fc)) + c*fa*fb/((fc-fa)*(fc-fb));
    } else {
      s = b - fb*(b-a)/(fb-fa); // Secant
    }
    const cond1 = s < (3*a+b)/4 || s > b;
    const cond2 = mflag  && Math.abs(s-b) >= Math.abs(b-c)/2;
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
  const f = S => netGammaAtPrice(S, allOptions, now);

  // Geniş tarama: ±30% aralıkta sign değişimini bul
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

  // Her bracket için Brent ile hassas sıfır bul
  const crossings = brackets.map(br => ({
    price: Math.round(brent(f, br.a, br.b, 1.0) ?? (br.a + br.b) / 2),
    fromPositive: br.fromPositive,
  }));

  // Gamma flip = pozitif→negatif geçiş (spot üstünde → direnç seviyesi)
  const flipUp = crossings.filter(c => c.fromPositive);
  if (flipUp.length) {
    const above = flipUp.filter(c => c.price > spot);
    return above.length ? above[0].price : flipUp[flipUp.length - 1].price;
  }
  return crossings.reduce((best, c) =>
    Math.abs(c.price - spot) < Math.abs(best.price - spot) ? c : best,
    crossings[0]
  ).price;
}

// ─── EXPECTED MOVE (EM Band) ──────────────────────────────
// Kaynak: CBOE Volatility Index® (VIX) metodoloji kılavuzu
// EM = S × ATM_IV × √T
// ATM IV: log-moneyness interpolasyonu (en yakın call ATM strike'larından)
// Vade seçimi: EOW (End of Week) = en yakın Cuma
export function calcEMBand(allOptions, spot) {
  if (!allOptions?.length) return { emHigh: null, emLow: null };
  const now = Date.now();
  const expiries = [...new Set(allOptions.map(o => o.expiryTs))]
    .filter(e => e > now)
    .sort((a, b) => a - b);

  // En yakın Cuma vadesi (EOW)
  let eow = expiries.find(e => new Date(e).getUTCDay() === 5) || expiries[0];
  if (!eow) return { emHigh: null, emLow: null };

  const eowOpts = allOptions.filter(o => o.expiryTs === eow);
  const T = Math.max((eow - now) / (365.25 * 24 * 3600 * 1000), 0.0001);

  // ATM IV: log-moneyness interpolasyonu (call'lardan)
  const calls = eowOpts.filter(o => o.type === "call").sort((a, b) => a.strike - b.strike);
  let atmIV = 0.5;

  if (calls.length) {
    const above = calls.find(c => c.strike >= spot);
    const below = [...calls].reverse().find(c => c.strike < spot);
    if (above && below) {
      const lm1 = Math.abs(Math.log(below.strike / spot));
      const lm2 = Math.abs(Math.log(above.strike / spot));
      const w   = lm1 / (lm1 + lm2); // above'un ağırlığı
      atmIV = below.iv * (1 - w) + above.iv * w;
    } else if (above) atmIV = above.iv;
    else if (below) atmIV = below.iv;
  }

  // Put ATM ile ortalama al (put-call parity'den daha sağlıklı ATM)
  const puts = eowOpts.filter(o => o.type === "put").sort((a, b) => a.strike - b.strike);
  if (puts.length) {
    const atmPut = puts.reduce((b, o) =>
      Math.abs(o.strike - spot) < Math.abs(b.strike - spot) ? o : b, puts[0]);
    const atmCall = calls.reduce((b, o) =>
      Math.abs(o.strike - spot) < Math.abs(b.strike - spot) ? o : b, calls[0] || atmPut);
    if (Math.abs(atmCall.strike - atmPut.strike) < spot * 0.01) {
      // Aynı strike'ta call ve put varsa ortalamaları daha sağlıklı
      atmIV = (atmCall.iv + atmPut.iv) / 2;
    }
  }

  const em = spot * atmIV * Math.sqrt(T);
  return { emHigh: Math.round(spot + em), emLow: Math.round(spot - em) };
}

// ─── Key levels ───────────────────────────────────────────
export function findLevels(strikes, spot, allOptions) {
  // Call Wall: max call GEX strike (dealer long gamma = satış duvarı)
  // Put Wall:  max |put GEX| strike (dealer short gamma = destek duvarı)
  let callWall = null, putWall = null, maxCG = 0, maxPG = 0;
  for (const s of strikes) {
    if (s.callGex > maxCG) { maxCG = s.callGex; callWall = s.strike; }
    if (Math.abs(s.putGex) > maxPG) { maxPG = Math.abs(s.putGex); putWall = s.strike; }
  }

  const maxPain   = calcMaxPain(allOptions);
  const zeroGamma = calcZeroGamma(allOptions, spot);
  const { emHigh, emLow } = calcEMBand(allOptions, spot);

  const pct = v => v ? ((v - spot) / spot * 100).toFixed(2) : null;
  return {
    callWall, putWall, maxPain, zeroGamma, emHigh, emLow,
    callWallPct:  pct(callWall),
    putWallPct:   pct(putWall),
    maxPainPct:   pct(maxPain),
    zeroGammaPct: pct(zeroGamma),
    emHighPct:    pct(emHigh),
    emLowPct:     pct(emLow),
  };
}

// ─── VOLATİLİTE YÜZEYİ ───────────────────────────────────
// ATM Term Structure: log-moneyness interpolasyonu ile her vade ATM IV
// 25Δ Risk Reversal: IV(25Δ put) - IV(25Δ call) [vol puanı]
// RR > 0 → put bias (downside koruma pahalı)
// RR < 0 → call bias (upside beklentisi pahalı)
export function calcVolSurface(options, spot) {
  if (!options?.length) return { termStructure: [], riskReversals: [] };
  const now = Date.now();

  const expiryMap = {};
  for (const o of options) {
    if (o.expiryTs <= now) continue;
    if (!expiryMap[o.expiryTs]) expiryMap[o.expiryTs] = { ts: o.expiryTs, days: o.daysToExp, T: o.T, opts: [] };
    expiryMap[o.expiryTs].opts.push(o);
  }

  const termStructure = [], riskReversals = [];

  for (const exp of Object.values(expiryMap).sort((a, b) => a.ts - b.ts)) {
    const { days, T, opts } = exp;
    if (!opts.length || days < 0) continue;

    const calls = opts.filter(o => o.type === "call").sort((a, b) => a.strike - b.strike);
    const puts  = opts.filter(o => o.type === "put").sort((a, b) => a.strike - b.strike);

    // ATM IV (log-moneyness interpolasyonu)
    let atmIV = null;
    if (calls.length) {
      const above = calls.find(c => c.strike >= spot);
      const below = [...calls].reverse().find(c => c.strike < spot);
      if (above && below) {
        const lm1 = Math.abs(Math.log(below.strike / spot));
        const lm2 = Math.abs(Math.log(above.strike / spot));
        atmIV = lm1 + lm2 > 0
          ? below.iv * (lm2 / (lm1 + lm2)) + above.iv * (lm1 / (lm1 + lm2))
          : above.iv;
      } else if (above) atmIV = above.iv;
      else if (below) atmIV = below.iv;
    }
    if (!atmIV && puts.length) {
      const p = puts.reduce((b, o) => Math.abs(o.strike - spot) < Math.abs(b.strike - spot) ? o : b, puts[0]);
      atmIV = p.iv;
    }
    if (atmIV !== null) termStructure.push({ days, T, iv: atmIV * 100 });

    // 25Δ Risk Reversal
    // 25Δ strike: |delta| ≈ 0.25 olan opsiyonu bul
    // Delta: BS ile hesapla (Deribit delta yoksa veya tutarsızsa)
    let bestCall25 = null, bestPut25 = null, minCdist = Infinity, minPdist = Infinity;

    for (const o of opts) {
      if (!o.T || !o.iv) continue;
      const { d1 } = d1d2(spot, o.strike, o.T, o.iv, 0, 0);
      const delta = o.type === "call" ? normCDF(d1) : normCDF(d1) - 1;

      if (o.type === "call") {
        const dist = Math.abs(delta - 0.25);
        if (dist < minCdist) { minCdist = dist; bestCall25 = { ...o, calcDelta: delta }; }
      } else {
        const dist = Math.abs(Math.abs(delta) - 0.25);
        if (dist < minPdist) { minPdist = dist; bestPut25 = { ...o, calcDelta: delta }; }
      }
    }

    if (bestCall25 && bestPut25 && minCdist < 0.15 && minPdist < 0.15) {
      // RR = IV(25Δ put) - IV(25Δ call) [vol puanı cinsinden]
      const rr = (bestPut25.iv - bestCall25.iv) * 100;
      if (Math.abs(rr) < 20) { // Makul filtre
        riskReversals.push({
          days, rr,
          putIV:  bestPut25.iv * 100,
          callIV: bestCall25.iv * 100,
          atmIV:  atmIV ? atmIV * 100 : null,
          putDelta:  bestPut25.calcDelta,
          callDelta: bestCall25.calcDelta,
        });
      }
    }
  }

  return { termStructure, riskReversals };
}

// ─── Sınıflandır ──────────────────────────────────────────
export function classifyStrikes(strikes, spot) {
  const totalOI    = strikes.reduce((a, s) => a + s.totalOI, 0) || 1;
  const maxAbsGex  = Math.max(...strikes.map(s => Math.abs(s.netGex)), 1);

  return strikes.map(s => {
    const oiPct  = s.totalOI / totalOI * 100;
    const gexPct = Math.abs(s.netGex) / maxAbsGex * 100;
    let wallType = "neutral";
    if      (s.netGex > 0 && s.callGex > Math.abs(s.putGex) * 0.5) wallType = "callWall";
    else if (s.netGex < 0 && Math.abs(s.putGex) > s.callGex * 0.5) wallType = "putWall";
    else if (s.totalOI > 0 && oiPct > 0.5)                          wallType = "magnet";

    return {
      ...s, wallType,
      isSignificant: oiPct > 1    || gexPct > 5,
      isMajor:       oiPct > 3    || gexPct > 25,
      oiPct:  oiPct.toFixed(1),
      gexPct: gexPct.toFixed(0),
    };
  });
}
