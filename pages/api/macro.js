// ═══════════════════════════════════════════════════════════
// Makro Ekonomi Veri API — 9 Kritik Gösterge
// Kaynak: FRED (St. Louis Fed) public JSON API
// Her gösterge için son 3 aylık veri + BTC yorum üreteci
// ═══════════════════════════════════════════════════════════

const HDR = { "Accept": "application/json", "User-Agent": "MacroDeskBot/1.0" };

// FRED public JSON endpoint — API key gerektirmez
async function fredSeries(seriesId, limit = 4) {
  try {
    const url = `https://fred.stlouisfed.org/graph/fredgraph.json?id=${seriesId}`;
    const r = await fetch(url, { headers: HDR, signal: AbortSignal.timeout(8000) });
    const data = await r.json();
    if (!Array.isArray(data) || !data.length) return null;
    // Son limit kadar veri (null olmayanlar)
    const clean = data.filter(d => d.value !== "." && d.value != null);
    const son = clean.slice(-limit).map(d => ({
      tarih: d.date,
      deger: parseFloat(d.value),
    }));
    if (!son.length) return null;
    const enSon = son[son.length - 1];
    const onceki = son[son.length - 2] || null;
    return {
      guncel: enSon.deger,
      tarih:  enSon.tarih,
      onceki: onceki?.deger || null,
      degisim: onceki ? enSon.deger - onceki.deger : null,
      gecmis: son, // son 4 kayıt
    };
  } catch (e) {
    return null;
  }
}

// Google News RSS — kısa haberler
async function haberCek(sorgu) {
  try {
    const enc = encodeURIComponent(sorgu);
    const url = `https://news.google.com/rss/search?q=${enc}&hl=en-US&gl=US&ceid=US:en`;
    const r = await fetch(url, { headers: { ...HDR, "Accept": "application/rss+xml" }, signal: AbortSignal.timeout(6000) });
    const xml = await r.text();
    const items = [];
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = re.exec(xml)) !== null && items.length < 4) {
      const item = m[1];
      const baslik = (/<title>(.*?)<\/title>/.exec(item)?.[1] || "").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
      const tarih  = (/<pubDate>(.*?)<\/pubDate>/.exec(item)?.[1] || "").trim();
      if (baslik) items.push({ baslik, tarih });
    }
    return items;
  } catch (e) { return []; }
}

// ─── BTC Yorum Üretici ────────────────────────────────────
// Her göstergenin BTC üzerindeki tipik etkisini açıklar
function btcYorumu(gostergeler) {
  const yorumlar = [];

  const { fedFaiz, cpi, nfp, ppi, gsyih, pce, iscabasvurusu, ismImalat, ismHizmet, perakende } = gostergeler;

  // Fed Faiz
  if (fedFaiz?.guncel != null) {
    const seviye = fedFaiz.guncel;
    const yuksek = seviye >= 5.0;
    const degisim = fedFaiz.degisim || 0;
    if (Math.abs(degisim) >= 0.25) {
      yorumlar.push(degisim > 0
        ? `Fed faiz artışı (${seviye.toFixed(2)}%) risk varlıkları için olumsuz — BTC için satış baskısı olası. Yüksek faiz ortamında BTC ile negatif korelasyon güçlenir.`
        : `Fed faiz indirimi (${seviye.toFixed(2)}%) risk iştahını artırır — BTC için olumlu sinyal. Likidite genişlemesi kripto piyasalarını yukarı taşır.`);
    } else {
      yorumlar.push(seviye >= 5.0
        ? `Fed faiz ${seviye.toFixed(2)}% ile kısıtlayıcı bölgede. Değişiklik olmadı — BTC için nötr görünüm, ancak yüksek faiz ortamı orta vadede baskı yaratmaya devam eder.`
        : `Fed faiz ${seviye.toFixed(2)}% seviyesinde sabit — BTC için nötr. Sonraki FOMC kararları kritik izlenecek.`);
    }
  }

  // CPI (Enflasyon)
  if (cpi?.guncel != null) {
    const oran = cpi.degisim;
    if (oran != null) {
      yorumlar.push(oran > 0
        ? `TÜFE ${cpi.guncel.toFixed(1)} ile beklentinin üzerinde — enflasyon kalıcılığı Fed'in faiz indirimine geç geçmesine neden olur. BTC için kısa vadede olumsuz, uzun vadede enflasyon hedge'i olarak olumlu senaryolar çatışır.`
        : `TÜFE ${cpi.guncel.toFixed(1)} ile geriledi — enflasyonun dizginlenmesi Fed faiz indirim beklentisini güçlendirir. Likidite genişlemesi BTC için orta vadede olumlu.`);
    }
  }

  // NFP (Tarım Dışı İstihdam)
  if (nfp?.guncel != null) {
    const kuvvetli = nfp.guncel > 200;
    yorumlar.push(kuvvetli
      ? `NFP ${nfp.guncel.toLocaleString("tr-TR")}K ile güçlü iş piyasası. Güçlü istihdam = Fed sıkılaştırma baskısı devam eder = BTC için baskıcı ortam. Olumsuz.`
      : `NFP ${nfp.guncel.toLocaleString("tr-TR")}K ile zayıf istihdam. İş piyasasındaki soğuma Fed faiz indirimini hızlandırabilir — BTC için potansiyel olumlu.`);
  }

  // PPI
  if (ppi?.degisim != null) {
    yorumlar.push(ppi.degisim > 0
      ? `ÜFE artışı (${ppi.guncel.toFixed(1)}) üretici fiyat baskısını gösteriyor — tüketici enflasyonunu besler, Fed temkinli kalır. BTC için olumsuz sinyal.`
      : `ÜFE geriledi (${ppi.guncel.toFixed(1)}) — maliyet baskıları azalıyor, enflasyon beklentileri düşüyor. BTC için hafif olumlu.`);
  }

  // GSYİH
  if (gsyih?.guncel != null) {
    yorumlar.push(gsyih.guncel >= 2
      ? `GSYİH büyüme ${gsyih.guncel.toFixed(1)}% — güçlü ekonomi Fed'in faiz politikasını sıkı tutmasını sağlar. Kısa vadede BTC için risk-off baskısı.`
      : `GSYİH büyüme ${gsyih.guncel.toFixed(1)}% — ekonomik yavaşlama Fed gevşeme beklentisini artırır. BTC için orta vadede olumlu.`);
  }

  // PCE
  if (pce?.degisim != null) {
    yorumlar.push(pce.degisim > 0
      ? `PCE endeksi yükseldi (${pce.guncel.toFixed(2)}) — Fed'in tercih ettiği enflasyon ölçütü beklenti üzerinde, para politikası sıkı kalır. BTC olumsuz.`
      : `PCE endeksi geriledi (${pce.guncel.toFixed(2)}) — enflasyonun Fed hedefine yaklaşması faiz indirimi yolunu açar. BTC olumlu.`);
  }

  // İşsizlik Başvuruları
  if (iscabasvurusu?.guncel != null) {
    const dusuk = iscabasvurusu.guncel < 220;
    yorumlar.push(dusuk
      ? `Haftalık işsizlik başvuruları ${iscabasvurusu.guncel.toLocaleString("tr-TR")}K ile düşük — güçlü iş piyasası Fed sıkılaştırmasını destekler. BTC için baskıcı.`
      : `Haftalık işsizlik başvuruları ${iscabasvurusu.guncel.toLocaleString("tr-TR")}K ile artıyor — iş piyasası zayıflıyor, Fed gevşeme ihtimali artar. BTC için olumlu.`);
  }

  // ISM İmalat
  if (ismImalat?.guncel != null) {
    const genisliyor = ismImalat.guncel > 50;
    yorumlar.push(genisliyor
      ? `ISM İmalat PMI ${ismImalat.guncel.toFixed(1)} — imalat sektörü genişliyor, reel ekonomi güçlü. BTC için risk-on ortam olumlu.`
      : `ISM İmalat PMI ${ismImalat.guncel.toFixed(1)} — imalat daralıyor, ekonomik yavaşlama sinyali. Risk iştahı azalır, BTC baskı altında.`);
  }

  // Perakende Satışlar
  if (perakende?.degisim != null) {
    yorumlar.push(perakende.degisim > 0
      ? `Perakende satışlar arttı (${perakende.degisim >= 0 ? "+" : ""}${perakende.degisim.toFixed(1)}) — tüketici harcamaları güçlü, enflasyon baskısı sürer. Fed faiz düşürmeye acele etmez.`
      : `Perakende satışlar düştü (${perakende.degisim.toFixed(1)}) — tüketici zayıflıyor, büyüme endişesi artar. Fed faiz indirim beklentisi güçlenir, BTC için olumlu.`);
  }

  // Genel BTC sentez yorumu
  const olumlu = yorumlar.filter(y => y.includes("olumlu")).length;
  const olumsuz = yorumlar.filter(y => y.includes("olumsuz") || y.includes("baskı")).length;

  let sentez = "";
  if (olumlu > olumsuz) {
    sentez = `📗 Makro tablo genel olarak BTC için OLUMLu görünüyor. ${olumlu} göstergede fiyatı destekleyen sinyal mevcut. Risk iştahı artış eğiliminde.`;
  } else if (olumsuz > olumlu) {
    sentez = `📕 Makro tablo genel olarak BTC için OLUMSUZ görünüyor. ${olumsuz} göstergede fiyat baskısı riski mevcut. Risk-off ortamı hakim.`;
  } else {
    sentez = `📙 Makro tablo NÖTR. Sinyaller çelişiyor — volatilite azalması ve yön bekleme dönemi olası.`;
  }

  return { yorumlar, sentez };
}

// ─── ANA HANDLER ──────────────────────────────────────────
export default async function handler(req, res) {
  try {
    // Tüm 9 göstergeyi paralel çek (son 4 veri = ~3 ay)
    const [
      fedFaiz,         // FEDFUNDS
      cpi,             // CPIAUCSL — TÜFE
      nfp,             // PAYEMS — NFP
      ppi,             // PPIACO — ÜFE
      gsyih,           // A191RL1Q225SBEA — GDP
      pce,             // PCEPI — PCE
      iscabasvurusu,   // ICSA — İşsizlik başvuruları
      ismImalat,       // MANEMP proxy (ISM direkt FRED'de yok, PMI için alternatif)
      ismHizmet,       // NMFCI — Chicago Fed
      perakende,       // RSAFS — Perakende satışlar
      fedHaberleri,
      enflasyonHaberleri,
    ] = await Promise.allSettled([
      fredSeries("FEDFUNDS", 4),
      fredSeries("CPIAUCSL", 4),
      fredSeries("PAYEMS",   4),
      fredSeries("PPIACO",   4),
      fredSeries("A191RL1Q225SBEA", 4),
      fredSeries("PCEPI",    4),
      fredSeries("ICSA",     4),
      fredSeries("NAPM",     4),  // ISM İmalat
      fredSeries("NMFCI",    4),  // Chicago Fed financial conditions (ISM Hizmet proxy)
      fredSeries("RSAFS",    4),  // Perakende satışlar
      haberCek("Federal Reserve FOMC interest rate decision"),
      haberCek("inflation CPI economy United States"),
    ]).then(rs => rs.map(r => r.status === "fulfilled" ? r.value : null));

    const gostergeler = {
      fedFaiz, cpi, nfp, ppi, gsyih, pce,
      iscabasvurusu, ismImalat, ismHizmet, perakende,
    };

    const { yorumlar, sentez } = btcYorumu(gostergeler);

    const sonuc = {
      guncellendi: new Date().toISOString(),
      gostergeler,
      btcYorum: { yorumlar, sentez },
      haberler: {
        fed:       fedHaberleri      || [],
        enflasyon: enflasyonHaberleri || [],
      },
    };

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json(sonuc);
  } catch (e) {
    return res.status(500).json({ hata: e.message });
  }
}
