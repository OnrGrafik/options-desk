// ═══════════════════════════════════════════════════════════════
// Order Flow API
// Sol grafik: 24 saatlik opsiyon hacmi (BUY↑ / SELL↓ per strike)
// Sağ grafik: Kapanan/vadesi dolan opsiyonların GEX değeri
//
// GEX formülü (gex.js ile birebir):
//   GEX = Gamma * OI * 1 BTC * Spot^2 * 0.01 * (call:+1 / put:-1)
//   gammaUnit = GEX / (Spot^2 * 0.01)  → BTC cinsinden
// ═══════════════════════════════════════════════════════════════

const HDR = { "Accept": "application/json", "User-Agent": "OpsiyonMasasi/1.0" };
const TO  = 15000;

async function deribit(method, params = {}) {
  const qs  = new URLSearchParams(params).toString();
  const url = `https://www.deribit.com/api/v2/public/${method}${qs ? "?" + qs : ""}`;
  try {
    const r = await fetch(url, { headers: HDR, signal: AbortSignal.timeout(TO) });
    if (!r.ok) return null;
    const d = await r.json();
    return d.result;
  } catch(e) { return null; }
}

// ── Black-Scholes Gamma (aynı gex.js formülü)
function normPDF(x) { return Math.exp(-0.5*x*x) / Math.sqrt(2*Math.PI); }
function bsGamma(S, K, T, sigma) {
  if (T <= 0 || sigma <= 0) return 0;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S/K) + (0.5*sigma*sigma)*T) / (sigma*sqrtT);
  return normPDF(d1) / (S * sigma * sqrtT);
}

// ── 24 saatlik hacim verisi — get_book_summary_by_currency
// Her instrument için: volume_24h = buy + sell hacmi, direction bilgisi yok
// Deribit'te direction için get_last_trades_by_currency_and_time kullanılır
// Basit yaklaşım: book_summary'den volume + mark_price + delta bilgisiyle
// positive_net_volume (call) → BUY side, negative (put) → SELL side
async function hacim24h(currency, spot) {
  const summary = await deribit("get_book_summary_by_currency", {
    currency,
    kind: "option",
  });

  if (!summary?.length) return [];

  const byStrike = {};

  for (const inst of summary) {
    const name   = inst.instrument_name;
    // instrument_name: BTC-28MAR25-100000-C
    const parts  = name.split("-");
    if (parts.length < 4) continue;
    const strike = parseInt(parts[2]);
    const tip    = parts[3] === "C" ? "call" : "put";
    if (!strike || isNaN(strike)) continue;

    const vol24h = parseFloat(inst.volume_24h || 0);  // BTC/ETH cinsinden kontrat
    if (vol24h < 0.01) continue;

    if (!byStrike[strike]) {
      byStrike[strike] = {
        strike,
        callBuy: 0, callSell: 0,
        putBuy:  0, putSell:  0,
      };
    }

    // Deribit'te bid/ask spread ve mark'a göre buy/sell tahmini:
    // mark_price yakın ask → daha çok buy baskısı
    // Basit yaklaşım: volume'u % ile ikiye böl
    // Gerçek direction için best_bid/best_ask kullanıyoruz
    const bid  = parseFloat(inst.best_bid_price || 0);
    const ask  = parseFloat(inst.best_ask_price || 0);
    const mark = parseFloat(inst.mark_price || 0);

    let buyRatio = 0.5;
    if (bid > 0 && ask > 0 && mark > 0) {
      // Mark fiyat ask'a yakınsa → alım baskısı yüksek
      const mid = (bid + ask) / 2;
      if (ask > bid) {
        buyRatio = Math.max(0.1, Math.min(0.9, (mark - bid) / (ask - bid)));
      }
    }

    const buyVol  = vol24h * buyRatio;
    const sellVol = vol24h * (1 - buyRatio);

    if (tip === "call") {
      byStrike[strike].callBuy  += buyVol;
      byStrike[strike].callSell += sellVol;
    } else {
      byStrike[strike].putBuy   += buyVol;
      byStrike[strike].putSell  += sellVol;
    }
  }

  // Sadece spot etrafındaki strikeleri döndür
  const lo = spot * 0.55, hi = spot * 1.35;
  return Object.values(byStrike)
    .filter(s => s.strike >= lo && s.strike <= hi)
    .sort((a, b) => a.strike - b.strike);
}

// ── Kapanan opsiyonların GEX değeri (sağ grafik)
// Vadesi son 7 günde dolan opsiyonlar için GEX hesapla
// GEX = Gamma * OI * Spot^2 * 0.01 * (call:+1 / put:-1)
async function kapananGex(currency) {
  const now    = Date.now();
  const yediGun = 7 * 24 * 3600 * 1000;

  // Spot fiyat
  const spotData = await deribit("get_index_price", {
    index_name: `${currency.toLowerCase()}_usd`
  });
  const spot = parseFloat(spotData?.index_price || 0);
  if (!spot) return { gammaUnits: [], spot: 0 };

  // Vadesi dolan enstrumanlar
  const instruments = await deribit("get_instruments", {
    currency,
    kind: "option",
    expired: "true",
  });
  if (!instruments?.length) return { gammaUnits: [], spot };

  // Son 7 günde kapananlar
  const yakin = instruments
    .filter(i => i.expiration_timestamp > now - yediGun && i.expiration_timestamp <= now)
    .sort((a, b) => b.expiration_timestamp - a.expiration_timestamp)
    .slice(0, 80);

  if (!yakin.length) return { gammaUnits: [], spot };

  // Settlement fiyatları
  const deliveryFiyatlari = {};
  const tarihler = [...new Set(yakin.map(i => {
    const d = new Date(i.expiration_timestamp);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
  }))];

  for (const tarih of tarihler) {
    const d = await deribit("get_delivery_prices", {
      index_name: `${currency.toLowerCase()}_usd`,
      date: tarih
    });
    if (d?.data?.length) {
      deliveryFiyatlari[tarih] = parseFloat(d.data[0].delivery_price);
    }
  }

  const byStrike = {};

  for (const inst of yakin.slice(0, 50)) {
    const tk = await deribit("ticker", { instrument_name: inst.instrument_name });
    if (!tk) continue;

    const strike  = inst.strike;
    const tip     = inst.option_type;  // "call" | "put"
    const oi      = parseFloat(tk.open_interest || 0);
    const markIV  = parseFloat(tk.mark_iv || 0) / 100;

    const expDate  = new Date(inst.expiration_timestamp);
    const tarihKey = `${expDate.getUTCFullYear()}-${String(expDate.getUTCMonth()+1).padStart(2,"0")}-${String(expDate.getUTCDate()).padStart(2,"0")}`;
    const settlementFiyat = deliveryFiyatlari[tarihKey] || spot;

    // GEX hesabı — kapanış anındaki değer
    // T = 0 (vadesi geçmiş) ama son IV ile hesapla
    const T = Math.max((inst.expiration_timestamp - now + 3600000) / (365.25*24*3600*1000), 0.001);
    const sigma = Math.max(markIV, 0.1);
    const gamma = bsGamma(settlementFiyat, strike, T, sigma);

    // GEX = Gamma * OI * S^2 * 0.01 * sign
    const sign = tip === "call" ? 1 : -1;
    const gex  = gamma * oi * settlementFiyat * settlementFiyat * 0.01 * sign;
    // gammaUnit = gex / (S^2 * 0.01) = gamma * OI * sign
    const gammaUnit = gamma * oi * sign;

    if (!byStrike[strike]) {
      byStrike[strike] = { strike, callGamma: 0, putGamma: 0, net: 0 };
    }

    if (tip === "call") {
      byStrike[strike].callGamma += gammaUnit;
    } else {
      byStrike[strike].putGamma  += gammaUnit;  // negatif
    }
    byStrike[strike].net = byStrike[strike].callGamma + byStrike[strike].putGamma;
  }

  // Normalize — max değere göre
  const values = Object.values(byStrike);
  const maxAbs = Math.max(...values.map(s => Math.max(Math.abs(s.callGamma), Math.abs(s.putGamma))), 1e-9);
  const gammaUnits = values
    .map(s => ({
      ...s,
      callGamma: s.callGamma / maxAbs,
      putGamma:  s.putGamma  / maxAbs,
      net:       s.net       / maxAbs,
    }))
    .sort((a, b) => a.strike - b.strike);

  return { gammaUnits, spot };
}

// ── Ana handler
export default async function handler(req, res) {
  const { currency = "BTC" } = req.query;
  const cur = currency.toUpperCase();

  try {
    // Paralel çek
    const [spotData, hacimData, kapananData] = await Promise.all([
      deribit("get_index_price", { index_name: `${cur.toLowerCase()}_usd` }),
      hacim24h(cur, 0),   // spot 0 olacak, tekrar çekeceğiz
      kapananGex(cur),
    ]);

    const spot = parseFloat(spotData?.index_price || kapananData.spot || 0);

    // Hacim verisini spot'a göre tekrar filtrele
    const lo = spot * 0.55, hi = spot * 1.35;
    const flowByStrike = (await hacim24h(cur, spot))
      .filter(s => s.strike >= lo && s.strike <= hi);

    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=180");
    res.status(200).json({
      currency: cur,
      spot,
      flowByStrike,                           // Sol grafik: 24h hacim
      gammaUnits: kapananData.gammaUnits,     // Sağ grafik: kapanan GEX
    });
  } catch(e) {
    console.error("orderflow error:", e);
    res.status(500).json({ error: e.message });
  }
}
