// ═══════════════════════════════════════════════════════════
// Makro Ekonomi Veri API
// Kaynaklar: FRED, US Treasury, Yahoo Finance (proxy),
//             CoinGecko, Google News RSS, IMF DataMapper
// ═══════════════════════════════════════════════════════════

const HDR = { "Accept": "application/json", "User-Agent": "MacroDeskBot/1.0" };

// ─── FRED API (St. Louis Fed) ─────────────────────────────
// Ücretsiz API key gerekmez — public seriler
async function fredSeries(seriesId) {
  try {
    // FRED public JSON endpoint (API key'siz, limited)
    const url = `https://fred.stlouisfed.org/graph/fredgraph.json?id=${seriesId}`;
    const r = await fetch(url, { headers: HDR });
    const data = await r.json();
    if (Array.isArray(data) && data.length > 0) {
      const last = data[data.length - 1];
      const prev = data[data.length - 2];
      return {
        value: parseFloat(last.value) || null,
        date: last.date,
        prev: parseFloat(prev?.value) || null,
        change: prev ? (parseFloat(last.value) - parseFloat(prev.value)) : null,
      };
    }
  } catch (e) {}
  return null;
}

// ─── US Treasury Fiscal Data ──────────────────────────────
async function fetchTreasuryTGA() {
  try {
    const url = "https://api.fiscaldata.treasury.gov/services/api/v1/accounting/dts/deposits_withdrawals_operating_cash?fields=record_date,open_today_bal&sort=-record_date&limit=2";
    const r = await fetch(url, { headers: HDR });
    const d = await r.json();
    const rows = d?.data || [];
    if (rows.length >= 1) {
      const latest = parseFloat(rows[0].open_today_bal);
      const prev   = rows.length >= 2 ? parseFloat(rows[1].open_today_bal) : null;
      return { value: latest, date: rows[0].record_date, prev, change: prev ? latest - prev : null };
    }
  } catch (e) {}
  return null;
}

async function fetchTreasuryDebt() {
  try {
    const url = "https://api.fiscaldata.treasury.gov/services/api/v1/debt/debt_to_penny?fields=record_date,tot_pub_debt_out_amt&sort=-record_date&limit=1";
    const r = await fetch(url, { headers: HDR });
    const d = await r.json();
    const row = d?.data?.[0];
    if (row) return { value: parseFloat(row.tot_pub_debt_out_amt) / 1e12, date: row.record_date }; // trilyon
  } catch (e) {}
  return null;
}

// ─── Yahoo Finance proxy (Stooq free API) ─────────────────
async function fetchStooq(symbol) {
  try {
    // Stooq: ücretsiz, kayıt gerektirmez
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(symbol)}&f=sd2t2ohlcvn&h&e=json`;
    const r = await fetch(url, { headers: { ...HDR, "Accept": "*/*" } });
    const txt = await r.text();
    // Stooq bazen CSV döner
    const lines = txt.trim().split("\n");
    if (lines.length >= 2) {
      const parts = lines[1].split(",");
      return { close: parseFloat(parts[4]) || null, open: parseFloat(parts[2]) || null, date: parts[0] };
    }
  } catch (e) {}
  return null;
}

// ─── CoinGecko Global Market ──────────────────────────────
async function fetchCoinGeckoGlobal() {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/global", { headers: HDR });
    const d = await r.json();
    const g = d?.data;
    if (g) return {
      totalMarketCap:   g.total_market_cap?.usd || null,
      totalVolume:      g.total_volume?.usd || null,
      btcDominance:     g.market_cap_percentage?.btc || null,
      ethDominance:     g.market_cap_percentage?.eth || null,
      marketCapChange:  g.market_cap_change_percentage_24h_usd || null,
    };
  } catch (e) {}
  return null;
}

// ─── Google News RSS (Makro haberler) ─────────────────────
async function fetchNewsRSS(query) {
  try {
    const encoded = encodeURIComponent(query);
    const url = `https://news.google.com/rss/search?q=${encoded}&hl=en-US&gl=US&ceid=US:en`;
    const r = await fetch(url, { headers: { ...HDR, "Accept": "application/rss+xml" } });
    const xml = await r.text();
    // Basit XML parse (regex, bağımsız lib yok)
    const items = [];
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = re.exec(xml)) !== null && items.length < 5) {
      const item = m[1];
      const title   = (/<title>(.*?)<\/title>/.exec(item)?.[1] || "").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
      const pubDate = (/<pubDate>(.*?)<\/pubDate>/.exec(item)?.[1] || "").trim();
      const link    = (/<link>(.*?)<\/link>/.exec(item)?.[1] || "").trim();
      if (title) items.push({ title, pubDate, link });
    }
    return items;
  } catch (e) {}
  return [];
}

// ─── IMF DataMapper ───────────────────────────────────────
async function fetchIMF(indicator, countryCode) {
  try {
    // IMF DataMapper REST API — ücretsiz, public
    const url = `https://www.imf.org/external/datamapper/api/v1/${indicator}/${countryCode}`;
    const r = await fetch(url, { headers: HDR });
    const d = await r.json();
    const values = d?.values?.[indicator]?.[countryCode];
    if (values) {
      const years = Object.keys(values).sort();
      const lastYear = years[years.length - 1];
      const prevYear = years[years.length - 2];
      return {
        value: values[lastYear],
        year:  lastYear,
        prev:  values[prevYear] || null,
      };
    }
  } catch (e) {}
  return null;
}

// ─── Hesapla: Global Net Likidite ─────────────────────────
// Net Likidite = Fed Bilançosu - TGA - RRP
// Kaynak: CrossBorderCapital metodolojisi
function calcNetLiquidity(fedBalance, tga, rrp) {
  if (!fedBalance || !tga) return null;
  const rrpVal = rrp || 0;
  return {
    value:      fedBalance - tga - rrpVal,
    components: { fedBalance, tga, rrp: rrpVal },
  };
}

// ─── ANA HANDLER ──────────────────────────────────────────
export default async function handler(req, res) {
  const { module } = req.query;

  try {
    if (module === "all" || !module) {
      // Tüm modülleri paralel çek
      const [
        fedBalance, // WALCL — Fed toplam bilançosu (milyar $)
        rrp,        // RRPONTTLD — Ters Repo (milyar $)
        cpi,        // CPIAUCSL — ABD TÜFE
        fedfunds,   // FEDFUNDS — Fed faiz oranı
        unrate,     // UNRATE — İşsizlik oranı
        tga,
        debt,
        cgGlobal,
        // Yahoo Finance / Stooq proxies
        tnx,   // 10Y Treasury yield
        dxy,   // Dolar endeksi
        spx,   // S&P 500
        nq,    // Nasdaq
        // News
        fedNews,
        inflNews,
        // IMF
        imfGrowth,
      ] = await Promise.allSettled([
        fredSeries("WALCL"),
        fredSeries("RRPONTTLD"),
        fredSeries("CPIAUCSL"),
        fredSeries("FEDFUNDS"),
        fredSeries("UNRATE"),
        fetchTreasuryTGA(),
        fetchTreasuryDebt(),
        fetchCoinGeckoGlobal(),
        fetchStooq("^tnx"),
        fetchStooq("dxy"),
        fetchStooq("^spx"),
        fetchStooq("^ndx"),
        fetchNewsRSS("Federal Reserve FOMC interest rates"),
        fetchNewsRSS("inflation CPI economy"),
        fetchIMF("NGDP_RPCH", "USA"), // ABD reel GSYH büyüme
      ]).then(rs => rs.map(r => r.status === "fulfilled" ? r.value : null));

      // Fed bilanço milyar → trilyon
      const fedBalT = fedBalance ? { ...fedBalance, valueTr: fedBalance.value / 1e3 } : null;
      const rrpT    = rrp        ? { ...rrp,        valueTr: rrp.value / 1e3 }        : null;
      const tgaT    = tga        ? { ...tga,        valueTr: tga.value / 1e6 }        : null; // TGA milyar $

      const netLiquidity = calcNetLiquidity(
        fedBalT?.valueTr,
        tgaT?.valueTr,
        rrpT?.valueTr
      );

      const result = {
        timestamp: new Date().toISOString(),
        fed: {
          balance:  fedBalT,
          rrp:      rrpT,
          fedfunds: fedfunds,
          netLiquidity,
        },
        macro: {
          cpi:    cpi,
          unrate: unrate,
          debt:   debt,
          tga:    tgaT,
          imfGrowth: imfGrowth,
        },
        markets: {
          tnx: tnx,    // 10Y yield
          dxy: dxy,
          spx: spx,
          nq:  nq,
          crypto: cgGlobal,
        },
        news: {
          fed:      fedNews   || [],
          inflation: inflNews || [],
        },
      };

      res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
      return res.status(200).json(result);
    }

    // Modül bazlı çekimler
    if (module === "news") {
      const query = req.query.q || "Federal Reserve inflation";
      const news  = await fetchNewsRSS(query);
      return res.status(200).json({ news });
    }

    if (module === "liquidity") {
      const [fedBalance, rrp, tga] = await Promise.all([
        fredSeries("WALCL"), fredSeries("RRPONTTLD"), fetchTreasuryTGA(),
      ]);
      const fedT = fedBalance ? fedBalance.value / 1e3 : null;
      const rrpT = rrp        ? rrp.value / 1e3        : null;
      const tgaT = tga        ? tga.value / 1e6        : null;
      return res.status(200).json({ fedBalance: fedT, rrp: rrpT, tga: tgaT, netLiquidity: calcNetLiquidity(fedT, tgaT, rrpT) });
    }

    res.status(400).json({ error: "unknown module" });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
