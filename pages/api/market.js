export default async function handler(req, res) {
  const { source, symbol, instId, ids, interval, limit } = req.query;
  const headers = { "Accept": "application/json", "User-Agent": "OptionsDesk/1.0" };
  const urls = {
    binance_ticker:  `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol||"BTCUSDT"}`,
    binance_price:   `https://api.binance.com/api/v3/ticker/price?symbol=${symbol||"BTCUSDT"}`,
    binance_klines:  `https://api.binance.com/api/v3/klines?symbol=${symbol||"BTCUSDT"}&interval=${interval||"1h"}&limit=${limit||48}`,
    futures_ticker:  `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${symbol||"BTCUSDT"}`,
    futures_funding: `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol||"BTCUSDT"}`,
    futures_basis:   `https://fapi.binance.com/futures/data/basis?symbol=${symbol||"BTCUSDT"}&contractType=PERPETUAL&period=1d&limit=1`,
    coingecko_simple:`https://api.coingecko.com/api/v3/simple/price?ids=${ids||"bitcoin,ethereum,solana,binancecoin,ripple"}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`,
    okx_ticker:      `https://www.okx.com/api/v5/market/ticker?instId=${instId||"BTC-USDT"}`,
    okx_funding:     `https://www.okx.com/api/v5/public/funding-rate?instId=${instId||"BTC-USD-SWAP"}`,
  };
  const url = urls[source];
  if (!url) return res.status(400).json({ error: "unknown source" });
  try {
    const r = await fetch(url, { headers });
    const data = await r.json();
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    res.status(200).json(data);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
}
