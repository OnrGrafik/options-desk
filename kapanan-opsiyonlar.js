// ═══════════════════════════════════════════════════════════════
// Kapanan Opsiyonlar API
// 1. Vadesi dolan opsiyonlar (expiry) — Cuma 08:00 UTC
// 2. Gerçek zamanlı büyük kapanışlar — son işlemler
// Varlık: BTC + ETH
// ═══════════════════════════════════════════════════════════════

const HDR = { "Accept": "application/json", "User-Agent": "OpsiyonMasasi/1.0" };
const TO  = 12000;

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

// ─── Vadesi Dolan Opsiyonlar ──────────────────────────────────
async function vadesiDolanlar(currency) {
  // Son 7 günde vadesi dolan kontratları çek
  const enstrumanlar = await deribit("get_instruments", {
    currency,
    kind: "option",
    expired: "true",
  });
  if (!enstrumanlar?.length) return [];

  const now     = Date.now();
  const yediGun = 7 * 24 * 3600 * 1000;

  // Son 7 günde kapananlar
  const yakin = enstrumanlar
    .filter(i => i.expiration_timestamp > now - yediGun && i.expiration_timestamp <= now)
    .sort((a, b) => b.expiration_timestamp - a.expiration_timestamp)
    .slice(0, 60); // Max 60 kontrat

  if (!yakin.length) return [];

  // Settlement fiyatları
  const deliveryFiyatlari = {};
  const tarihler = [...new Set(yakin.map(i => {
    const d = new Date(i.expiration_timestamp);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
  }))];

  for (const tarih of tarihler) {
    const d = await deribit("get_delivery_prices", { index_name: `${currency.toLowerCase()}_usd`, date: tarih });
    if (d?.data?.length) {
      deliveryFiyatlari[tarih] = parseFloat(d.data[0].delivery_price);
    }
  }

  // Her kontrat için ticker çek
  const sonuclar = [];
  for (const inst of yakin.slice(0, 30)) {
    const t = await deribit("ticker", { instrument_name: inst.instrument_name });

    const expDate = new Date(inst.expiration_timestamp);
    const tarihKey = `${expDate.getUTCFullYear()}-${String(expDate.getUTCMonth()+1).padStart(2,"0")}-${String(expDate.getUTCDate()).padStart(2,"0")}`;
    const settlementFiyat = deliveryFiyatlari[tarihKey] || 0;
    const strike          = inst.strike;
    const tip             = inst.option_type; // "call" | "put"

    // ITM/OTM belirleme
    let itm = false;
    if (tip === "call") itm = settlementFiyat > strike;
    else                itm = settlementFiyat < strike;

    const oi          = parseFloat(t?.open_interest || 0);
    const markFiyat   = parseFloat(t?.mark_price || 0);
    const iv          = parseFloat(t?.mark_iv || 0);

    sonuclar.push({
      instrument:      inst.instrument_name,
      strike,
      tip,
      vade:            expDate.toISOString(),
      vadeTarih:       tarihKey,
      settlementFiyat,
      itm,
      oi,
      oiUsd:           oi * settlementFiyat,
      markFiyat,
      iv,
      currency,
    });
  }

  return sonuclar;
}

// ─── Gerçek Zamanlı Büyük Kapanışlar ─────────────────────────
async function buyukKapanislar(currency, minBtc = 100) {
  // Son işlemleri çek
  const islemler = await deribit("get_last_trades_by_currency", {
    currency,
    kind:       "option",
    count:      100,
    include_old: false,
  });

  if (!islemler?.trades?.length) return [];

  return islemler.trades
    .filter(t => {
      const amount = parseFloat(t.amount || 0);
      return amount >= minBtc;
    })
    .map(t => ({
      instrument:  t.instrument_name,
      fiyat:       parseFloat(t.price),
      miktar:      parseFloat(t.amount),
      yon:         t.direction,        // "buy" | "sell"
      iv:          parseFloat(t.iv || 0),
      timestamp:   t.timestamp,
      indexFiyat:  parseFloat(t.index_price || 0),
      currency,
    }))
    .slice(0, 20);
}

// ─── Vade Özet İstatistikleri ─────────────────────────────────
function ozetHesapla(kapananlar) {
  if (!kapananlar.length) return null;

  const calllar = kapananlar.filter(k => k.tip === "call");
  const putlar  = kapananlar.filter(k => k.tip === "put");

  const itmCallOI = calllar.filter(k => k.itm).reduce((a, k) => a + k.oi, 0);
  const otmCallOI = calllar.filter(k => !k.itm).reduce((a, k) => a + k.oi, 0);
  const itmPutOI  = putlar.filter(k => k.itm).reduce((a, k) => a + k.oi, 0);
  const otmPutOI  = putlar.filter(k => !k.itm).reduce((a, k) => a + k.oi, 0);

  const toplamOI  = kapananlar.reduce((a, k) => a + k.oi, 0);
  const toplamUSD = kapananlar.reduce((a, k) => a + k.oiUsd, 0);

  // Put/Call oranı
  const callOI   = calllar.reduce((a, k) => a + k.oi, 0);
  const putOI    = putlar.reduce((a, k) => a + k.oi, 0);
  const pcRatio  = callOI > 0 ? putOI / callOI : 0;

  // En büyük OI'li strike
  const byStrike = {};
  for (const k of kapananlar) {
    if (!byStrike[k.strike]) byStrike[k.strike] = { call: 0, put: 0, settlement: k.settlementFiyat };
    byStrike[k.strike][k.tip] += k.oi;
  }
  const maxStrike = Object.entries(byStrike)
    .sort((a, b) => (b[1].call + b[1].put) - (a[1].call + a[1].put))[0];

  return {
    toplamOI, toplamUSD,
    callOI, putOI, pcRatio,
    itmCallOI, otmCallOI,
    itmPutOI,  otmPutOI,
    maxPainStrike: maxStrike ? parseFloat(maxStrike[0]) : null,
    kontratSayisi: kapananlar.length,
  };
}

// ─── ANA HANDLER ──────────────────────────────────────────────
export default async function handler(req, res) {
  const { currency = "BTC", tip = "all" } = req.query;
  const gecerliCurrency = ["BTC", "ETH"].includes(currency.toUpperCase())
    ? currency.toUpperCase()
    : "BTC";

  try {
    const [vadesiDolanBTC, vadesiDolanETH, kapanisBTC, kapanisETH] =
      await Promise.allSettled([
        vadesiDolanlar("BTC"),
        vadesiDolanlar("ETH"),
        buyukKapanislar("BTC", 100),  // 100 BTC üzeri
        buyukKapanislar("ETH", 500),  // 500 ETH üzeri
      ]).then(rs => rs.map(r => r.status === "fulfilled" ? r.value : []));

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      guncellendi:    new Date().toISOString(),
      btc: {
        vadesiDolanlar: vadesiDolanBTC,
        ozet:           ozetHesapla(vadesiDolanBTC),
        buyukKapanislar: kapanisBTC,
      },
      eth: {
        vadesiDolanlar: vadesiDolanETH,
        ozet:           ozetHesapla(vadesiDolanETH),
        buyukKapanislar: kapanisETH,
      },
    });
  } catch(e) {
    return res.status(500).json({ hata: e.message });
  }
}
