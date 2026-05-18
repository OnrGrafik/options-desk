export default async function handler(req, res) {
  const { source, endpoint } = req.query;

  const headers = { "Accept": "application/json", "User-Agent": "OptionsDesk/1.0" };

  const urls = {
    // Binance Spot
    binance_ticker:   `https://api.binance.com/api/v3/ticker/24hr?symbol=${req.query.symbol || "BTCUSDT"}`,
    binance_price:    `https://api.binance.com/api/v3/ticker/price?symbol=${req.query.symbol || "BTCUSDT"}`,
    binance_klines:   `https://api.binance.com/api/v3/klines?symbol=${req.query.symbol || "BTCUSDT"}&interval=${req.query.interval || "1h"}&limit=${req.query.limit || 48}`,

    // Binance Futures
    futures_ticker:   `https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${req.query.symbol || "BTCUSDT"}`,
    futures_funding:  `https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${req.query.symbol || "BTCUSDT"}`,
    futures_basis:    `https://fapi.binance.com/futures/data/basis?symbol=${req.query.symbol || "BTCUSDT"}&contractType=PERPETUAL&period=1d&limit=1`,

    // CoinGecko
    coingecko_simple: `https://api.coingecko.com/api/v3/simple/price?ids=${req.query.ids || "bitcoin,ethereum,solana,binancecoin,ripple"}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`,

    // OKX spot
    okx_ticker:       `https://www.okx.com/api/v5/market/ticker?instId=${req.query.instId || "BTC-USDT"}`,
    okx_funding:      `https://www.okx.com/api/v5/public/funding-rate?instId=${req.query.instId || "BTC-USD-SWAP"}`,
  };

  const url = urls[source];
  if (!url) return res.status(400).json({ error: "unknown source" });

  try {
    const r = await fetch(url, { headers });
    const data = await r.json();
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
