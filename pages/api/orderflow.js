// ═══════════════════════════════════════════════════════════════════════
// Order Flow API v2
//
// TEK KAYNAK: get_book_summary_by_currency
//   → Her aktif opsiyon için: OI, volume_24h, mark_iv, mark_price,
//     bid, ask, instrument_name (strike + tip)
//
// Sol grafik — Net GEX per strike (canlı opsiyonlar):
//   GEX = Gamma * OI * S² * 0.01 * sign(call:+1, put:-1)
//   gammaUnit = GEX / (S² * 0.01) = Gamma * OI * sign
//   Normalize: / maxAbs → [-1, +1]
//
// Sağ grafik — 24h Buy↑/Sell↓ per strike:
//   volume_24h = toplam hacim (BTC cinsinden kontrat)
//   buy/sell tahmini: delta-hedge mantığı
//     - Call alım (buy) → dealer SELL delta → call buy signal
//     - Bid/ask/mark spread'e göre buy ratio hesapla
//
// Hafıza mimarisi:
//   - Vercel serverless = stateless, in-memory cache ÇALIŞMAZ
//   - Cache-Control: s-maxage=120 → Vercel/CDN edge cache = 2dk
//   - Client: React useRef cache = 5dk, sayfa başına 1 fetch
//   - Veri boyutu küçük (~200 strike × 2 sembol) → edge cache yeterli
//
// BS Gamma (gex.js ile birebir):
//   d1 = (ln(S/K) + 0.5σ²T) / (σ√T)
//   Gamma = N'(d1) / (S × σ × √T)
//   GEX = Gamma × OI × S² × 0.01 × sign
// ═══════════════════════════════════════════════════════════════════════

const HDR = { "Accept": "application/json", "User-Agent": "OpsiyonMasasi/1.0" };
const TO  = 20000;

async function deribit(method, params = {}) {
  const qs  = new URLSearchParams(params).toString();
  const url = `https://www.deribit.com/api/v2/public/${method}${qs ? "?" + qs : ""}`;
  try {
    const r = await fetch(url, { headers: HDR, signal: AbortSignal.timeout(TO) });
    if (!r.ok) {
      console.error(`Deribit ${method} → ${r.status}`);
      return null;
    }
    const d = await r.json();
    if (d.error) { console.error(`Deribit ${method} error:`, d.error); return null; }
    return d.result;
  } catch(e) {
    console.error(`Deribit ${method} exception:`, e.message);
    return null;
  }
}

// ── Black-Scholes Gamma — gex.js ile birebir
function normPDF(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function bsGamma(S, K, T, sigma) {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return 0;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * sqrtT);
  return normPDF(d1) / (S * sigma * sqrtT);
}

// ── Strike ve tip'i instrument_name'den parse et
// BTC-28MAR25-100000-C veya ETH-28MAR25-3000-P
function parseInstrument(name) {
  const parts = name.split("-");
  if (parts.length < 4) return null;
  const strike = parseFloat(parts[2]);
  const tip    = parts[parts.length - 1] === "C" ? "call" : "put";
  if (!strike || isNaN(strike)) return null;
  return { strike, tip };
}

// ── Ana veri işleme: tek book_summary çağrısından hem GEX hem 24h hacim
function processBookSummary(summary, spot) {
  if (!summary?.length) return { byStrike: {} };

  const now    = Date.now();
  const lo     = spot * 0.55;
  const hi     = spot * 1.35;
  const byStrike = {};

  for (const inst of summary) {
    const parsed = parseInstrument(inst.instrument_name);
    if (!parsed) continue;
    const { strike, tip } = parsed;
    if (strike < lo || strike > hi) continue;

    const oi      = parseFloat(inst.open_interest    || 0);
    const markIV  = parseFloat(inst.mark_iv          || 50) / 100;  // % → ratio
    const vol24h  = parseFloat(inst.volume_24h       || 0);
    const bid     = parseFloat(inst.best_bid_price   || 0);
    const ask     = parseFloat(inst.best_ask_price   || 0);
    const mark    = parseFloat(inst.mark_price       || 0);

    // Vade: instrument_name'den expiry tarihini çıkar
    // BTC-28MAR25-... → "28MAR25"
    const parts     = inst.instrument_name.split("-");
    const expStr    = parts[1] || "";
    const expDate   = parseExpiry(expStr);
    const T         = expDate ? Math.max((expDate - now) / (365.25 * 24 * 3600 * 1000), 0.00001) : 0.01;
    const sigma     = Math.max(markIV, 0.05);

    // GEX hesabı
    const gamma     = bsGamma(spot, strike, T, sigma);
    const sign      = tip === "call" ? 1 : -1;
    const gammaUnit = gamma * oi * sign;  // normalize edilmemiş

    // 24h hacim buy/sell tahmini
    // Mark fiyatın bid-ask içindeki konumuna göre
    let buyRatio = 0.5;
    if (bid > 0 && ask > 0 && ask > bid) {
      // Mark ask'a yakın → alım baskısı
      buyRatio = Math.max(0.15, Math.min(0.85, (mark - bid) / (ask - bid)));
    }
    const buyVol  = vol24h * buyRatio;
    const sellVol = vol24h * (1 - buyRatio);

    if (!byStrike[strike]) {
      byStrike[strike] = {
        strike,
        callGamma: 0, putGamma: 0, net: 0,   // GEX için
        callBuy: 0, callSell: 0,               // hacim için
        putBuy:  0, putSell:  0,
        callOI: 0,  putOI: 0,
      };
    }

    const b = byStrike[strike];

    if (tip === "call") {
      b.callGamma += gammaUnit;
      b.callBuy   += buyVol;
      b.callSell  += sellVol;
      b.callOI    += oi;
    } else {
      b.putGamma  += gammaUnit;  // negatif değer
      b.putBuy    += buyVol;
      b.putSell   += sellVol;
      b.putOI     += oi;
    }
    b.net = b.callGamma + b.putGamma;
  }

  return { byStrike };
}

// ── Expiry string parse: "28MAR25" → timestamp
const MONTHS = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,
                 JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };
function parseExpiry(s) {
  if (!s || s.length < 7) return null;
  const day = parseInt(s.slice(0, 2));
  const mon = MONTHS[s.slice(2, 5)];
  const yr  = 2000 + parseInt(s.slice(5, 7));
  if (isNaN(day) || mon === undefined || isNaN(yr)) return null;
  return Date.UTC(yr, mon, day, 8, 0, 0);  // Deribit 08:00 UTC'de expire eder
}

export default async function handler(req, res) {
  const { currency = "BTC" } = req.query;
  const cur = currency.toUpperCase();

  if (!["BTC", "ETH"].includes(cur)) {
    return res.status(400).json({ error: "currency must be BTC or ETH" });
  }

  try {
    // 1. Spot fiyat
    const spotRes = await deribit("get_index_price", {
      index_name: `${cur.toLowerCase()}_usd`,
    });
    const spot = parseFloat(spotRes?.index_price || 0);
    if (!spot) {
      return res.status(503).json({ error: "Spot fiyat alınamadı" });
    }

    // 2. Book summary — TEK ÇAĞRI, tüm aktif opsiyonlar
    const summary = await deribit("get_book_summary_by_currency", {
      currency: cur,
      kind: "option",
    });

    if (!summary?.length) {
      return res.status(503).json({ error: "Book summary alınamadı" });
    }

    console.log(`[orderflow] ${cur} spot=${spot} instruments=${summary.length}`);

    // 3. İşle
    const { byStrike } = processBookSummary(summary, spot);
    const strikes = Object.values(byStrike).sort((a, b) => a.strike - b.strike);

    if (!strikes.length) {
      return res.status(200).json({
        currency: cur, spot,
        gammaUnits: [], flowByStrike: [],
      });
    }

    // 4. GEX normalize
    const maxGamma = Math.max(...strikes.map(s =>
      Math.max(Math.abs(s.callGamma), Math.abs(s.putGamma))
    ), 1e-9);

    const gammaUnits = strikes.map(s => ({
      strike:     s.strike,
      callGamma:  s.callGamma / maxGamma,
      putGamma:   s.putGamma  / maxGamma,
      net:        s.net       / maxGamma,
      callOI:     s.callOI,
      putOI:      s.putOI,
    }));

    // 5. Flow verisi (normalize gerekmez, ham hacim)
    const flowByStrike = strikes.map(s => ({
      strike:    s.strike,
      callBuy:   parseFloat(s.callBuy.toFixed(2)),
      callSell:  parseFloat(s.callSell.toFixed(2)),
      putBuy:    parseFloat(s.putBuy.toFixed(2)),
      putSell:   parseFloat(s.putSell.toFixed(2)),
      totalBuy:  parseFloat((s.callBuy + s.putBuy).toFixed(2)),
      totalSell: parseFloat((s.callSell + s.putSell).toFixed(2)),
    })).filter(s => s.totalBuy + s.totalSell > 0.01);

    // Edge cache: 2dk fresh, 4dk stale
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=240");
    res.status(200).json({
      currency: cur,
      spot,
      instruments: summary.length,
      gammaUnits,    // Sol grafik: Net GEX per strike
      flowByStrike,  // Sağ grafik: 24h hacim
    });

  } catch(e) {
    console.error("[orderflow] error:", e);
    res.status(500).json({ error: e.message });
  }
}
