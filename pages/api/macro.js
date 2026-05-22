// ═══════════════════════════════════════════════════════════
// Makro Ekonomi API — Çoklu Kaynak (Key gerektirmiyor)
// BLS (Bureau of Labor Statistics) → CPI, NFP, İşsizlik
// US Treasury Fiscal Data → Fed Faiz proxy, borç
// World Bank API → GSYİH büyüme
// OECD API → PCE proxy, Perakende
// Google News RSS (TR) → Türkçe haber
// ═══════════════════════════════════════════════════════════

const HDR = { "Accept": "application/json", "User-Agent": "MacroDeskBot/2.0" };
const TO = 10000; // 10 saniye timeout

async function guvenliCek(url, basliklar = HDR) {
  try {
    const r = await fetch(url, {
      headers: basliklar,
      signal: AbortSignal.timeout(TO),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

// ─── BLS Public Data API v2 (key gerektirmez) ─────────────
// Seri kodları: https://www.bls.gov/help/hlpforma.htm
async function blsSeries(seriesId, yilSayisi = 1) {
  try {
    const bitisYili = new Date().getFullYear();
    const baslangicYili = bitisYili - yilSayisi;
    const url = "https://api.bls.gov/publicAPI/v2/timeseries/data/";
    const r = await fetch(url, {
      method: "POST",
      headers: { ...HDR, "Content-Type": "application/json" },
      body: JSON.stringify({
        seriesid: [seriesId],
        startyear: String(baslangicYili),
        endyear:   String(bitisYili),
      }),
      signal: AbortSignal.timeout(TO),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const seri = d?.Results?.series?.[0]?.data;
    if (!seri?.length) return null;
    // BLS en yeni veri en önce geliyor
    const temiz = seri
      .filter(x => x.value !== "-")
      .map(x => ({
        tarih: `${x.year}-${x.period.replace("M","").padStart(2,"0")}-01`,
        deger: parseFloat(x.value),
      }))
      .sort((a, b) => a.tarih.localeCompare(b.tarih));
    const son4 = temiz.slice(-4);
    if (!son4.length) return null;
    const enSon  = son4[son4.length - 1];
    const onceki = son4[son4.length - 2] || null;
    return {
      guncel:  enSon.deger,
      tarih:   enSon.tarih,
      onceki:  onceki?.deger ?? null,
      degisim: onceki ? enSon.deger - onceki.deger : null,
      gecmis:  son4,
    };
  } catch (e) { return null; }
}

// ─── US Treasury Fiscal Data API (key gerektirmez) ────────
async function hazineVeri(endpoint, alan, limit = 4) {
  try {
    const url = `https://api.fiscaldata.treasury.gov/services/api/v1/${endpoint}?fields=record_date,${alan}&sort=-record_date&limit=${limit}`;
    const d = await guvenliCek(url);
    if (!d?.data?.length) return null;
    const rows = d.data
      .map(r => ({ tarih: r.record_date, deger: parseFloat(r[alan]) }))
      .filter(r => !isNaN(r.deger))
      .sort((a, b) => a.tarih.localeCompare(b.tarih));
    if (!rows.length) return null;
    const enSon  = rows[rows.length - 1];
    const onceki = rows[rows.length - 2] || null;
    return {
      guncel:  enSon.deger,
      tarih:   enSon.tarih,
      onceki:  onceki?.deger ?? null,
      degisim: onceki ? enSon.deger - onceki.deger : null,
      gecmis:  rows.slice(-4),
    };
  } catch (e) { return null; }
}

// ─── World Bank API (key gerektirmez) ─────────────────────
// Örnek: GDP growth = NY.GDP.MKTP.KD.ZG
async function worldBankVeri(indikatorKodu, ulke = "US", limit = 4) {
  try {
    const url = `https://api.worldbank.org/v2/country/${ulke}/indicator/${indikatorKodu}?format=json&per_page=${limit}&mrv=${limit}`;
    const d = await guvenliCek(url);
    const rows = d?.[1];
    if (!Array.isArray(rows) || !rows.length) return null;
    const temiz = rows
      .filter(r => r.value != null)
      .map(r => ({ tarih: `${r.date}-01-01`, deger: parseFloat(r.value) }))
      .sort((a, b) => a.tarih.localeCompare(b.tarih));
    if (!temiz.length) return null;
    const enSon  = temiz[temiz.length - 1];
    const onceki = temiz[temiz.length - 2] || null;
    return {
      guncel:  parseFloat(enSon.deger.toFixed(2)),
      tarih:   enSon.tarih.slice(0, 4), // sadece yıl
      onceki:  onceki ? parseFloat(onceki.deger.toFixed(2)) : null,
      degisim: onceki ? parseFloat((enSon.deger - onceki.deger).toFixed(2)) : null,
      gecmis:  temiz.slice(-4).map(r => ({ ...r, tarih: r.tarih.slice(0,4) })),
    };
  } catch (e) { return null; }
}

// ─── OECD API (key gerektirmez) ───────────────────────────
async function oecdVeri(dataset, filtre, limit = 4) {
  try {
    const url = `https://stats.oecd.org/SDMX-JSON/data/${dataset}/${filtre}/all?startTime=${new Date().getFullYear()-2}&endTime=${new Date().getFullYear()}&dimensionAtObservation=allDimensions&format=jsondata`;
    const d = await guvenliCek(url);
    const obsList = d?.dataSets?.[0]?.observations;
    const timeList = d?.structure?.dimensions?.observation?.find(x=>x.id==="TIME_PERIOD")?.values;
    if (!obsList || !timeList) return null;
    const entries = Object.entries(obsList)
      .map(([key, vals]) => {
        const timeIdx = parseInt(key.split(":").at(-1));
        return { tarih: timeList[timeIdx]?.id || "", deger: parseFloat(vals[0]) };
      })
      .filter(r => !isNaN(r.deger))
      .sort((a, b) => a.tarih.localeCompare(b.tarih))
      .slice(-limit);
    if (!entries.length) return null;
    const enSon  = entries[entries.length - 1];
    const onceki = entries[entries.length - 2] || null;
    return {
      guncel:  enSon.deger,
      tarih:   enSon.tarih,
      onceki:  onceki?.deger ?? null,
      degisim: onceki ? enSon.deger - onceki.deger : null,
      gecmis:  entries,
    };
  } catch (e) { return null; }
}

// ─── Google News RSS — Türkçe haber çekimi ────────────────
async function haberCekTurkce(enSorgu, trSorgu) {
  const haberler = [];
  // Türkçe haberler önce
  try {
    const enc = encodeURIComponent(trSorgu);
    const url = `https://news.google.com/rss/search?q=${enc}&hl=tr&gl=TR&ceid=TR:tr`;
    const r = await fetch(url, {
      headers: { ...HDR, Accept: "application/rss+xml" },
      signal: AbortSignal.timeout(6000),
    });
    const xml = await r.text();
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = re.exec(xml)) !== null && haberler.length < 3) {
      const item = m[1];
      const baslik = (/<title>(.*?)<\/title>/.exec(item)?.[1] || "")
        .replace(/<!\[CDATA\[|\]\]>/g, "").trim();
      const tarih  = (/<pubDate>(.*?)<\/pubDate>/.exec(item)?.[1] || "").trim();
      const link   = (/<link>(.*?)<\/link>/.exec(item)?.[1] || "").trim();
      if (baslik) haberler.push({ baslik, tarih, link, dil: "tr" });
    }
  } catch (e) {}
  // İngilizce tamamla
  try {
    const enc = encodeURIComponent(enSorgu);
    const url = `https://news.google.com/rss/search?q=${enc}&hl=en-US&gl=US&ceid=US:en`;
    const r = await fetch(url, {
      headers: { ...HDR, Accept: "application/rss+xml" },
      signal: AbortSignal.timeout(6000),
    });
    const xml = await r.text();
    const re = /<item>([\s\S]*?)<\/item>/g;
    let m;
    while ((m = re.exec(xml)) !== null && haberler.length < 6) {
      const item = m[1];
      const baslik = (/<title>(.*?)<\/title>/.exec(item)?.[1] || "")
        .replace(/<!\[CDATA\[|\]\]>/g, "").trim();
      const tarih  = (/<pubDate>(.*?)<\/pubDate>/.exec(item)?.[1] || "").trim();
      const link   = (/<link>(.*?)<\/link>/.exec(item)?.[1] || "").trim();
      if (baslik) haberler.push({ baslik, tarih, link, dil: "en" });
    }
  } catch (e) {}
  return haberler;
}

// ─── BTC Yorum Üretici ────────────────────────────────────
function btcYorumUret(gostergeler) {
  const yorumlar = [];
  const { fedFaiz, cpi, nfp, ppi, gsyih, pce, iscabasvurusu, ismImalat, perakende } = gostergeler;

  if (fedFaiz?.guncel != null) {
    const s = fedFaiz.guncel;
    yorumlar.push(s >= 5.0
      ? `Fed faiz oranı %${s.toFixed(2)} ile kısıtlayıcı bölgede. Yüksek faiz ortamı risk varlıklarından sermaye çekişini sürdürür. BTC için negatif baskı devam ediyor.`
      : `Fed faiz oranı %${s.toFixed(2)} — makul seviyede. Faiz indirimi beklentileri güçlenirse likidite artışı BTC'yi destekler.`);
  }

  if (cpi?.guncel != null) {
    const d = cpi.degisim;
    yorumlar.push(d != null && d > 0
      ? `TÜFE ${cpi.guncel.toFixed(1)} ile yükseldi. Enflasyon kalıcılığı Fed faiz indirimini geciktirir → kısa vadede BTC için olumsuz. Uzun vadede enflasyon hedge beklentisi fiyatı destekler.`
      : `TÜFE ${cpi.guncel.toFixed(1)} ile geriledi. Enflasyonun dizginlenmesi faiz indirimi ihtimalini artırır → likidite genişlemesi BTC için orta vadeli katalizör.`);
  }

  if (nfp?.guncel != null) {
    yorumlar.push(nfp.guncel > 200
      ? `NFP ${nfp.guncel.toLocaleString("tr-TR")}K ile güçlü. İş piyasası direnci Fed'in gevşeme adımını erteler → BTC baskı altında.`
      : `NFP ${nfp.guncel.toLocaleString("tr-TR")}K ile zayıf. Yavaşlayan istihdam Fed'e alan açar → BTC için potansiyel katalizör.`);
  }

  if (ppi?.degisim != null) {
    yorumlar.push(ppi.degisim > 0
      ? `ÜFE aylık +${ppi.degisim.toFixed(1)} ile üretici maliyetleri artıyor. Öncü enflasyon sinyali: Fed sıkı duruşunu korur → BTC negatif.`
      : `ÜFE aylık ${ppi.degisim.toFixed(1)} ile düştü. Maliyet baskısı azalıyor, tüketici enflasyonu frenlenir → BTC için hafif pozitif.`);
  }

  if (gsyih?.guncel != null) {
    yorumlar.push(gsyih.guncel >= 2
      ? `GSYİH büyüme %${gsyih.guncel.toFixed(1)} — güçlü ekonomi. Fed gevşemeye acele etmez → risk varlıkları için kısa vadeli baskı.`
      : `GSYİH büyüme %${gsyih.guncel.toFixed(1)} — yavaşlama sinyali. Ekonomik soğuma Fed gevşeme beklentisini öne çeker → BTC için orta vadede olumlu.`);
  }

  if (pce?.degisim != null) {
    yorumlar.push(pce.degisim > 0
      ? `PCE endeksi arttı (${pce.guncel.toFixed(2)}). Fed'in tercih ettiği enflasyon ölçütü beklenti üzerinde → para politikası sıkı kalır.`
      : `PCE endeksi geriledi (${pce.guncel.toFixed(2)}). Fed hedefine yaklaşma faiz indirim yolunu açar → BTC için pozitif sinyal.`);
  }

  if (iscabasvurusu?.guncel != null) {
    yorumlar.push(iscabasvurusu.guncel < 220
      ? `Haftalık işsizlik başvurusu ${iscabasvurusu.guncel.toLocaleString("tr-TR")}K ile düşük → güçlü iş piyasası Fed sıkılaştırmasını destekler.`
      : `Haftalık başvuru ${iscabasvurusu.guncel.toLocaleString("tr-TR")}K ile artıyor → iş piyasası soğuyor, Fed gevşemesi yaklaşıyor, BTC için olumlu.`);
  }

  if (ismImalat?.guncel != null) {
    yorumlar.push(ismImalat.guncel > 50
      ? `ISM İmalat PMI ${ismImalat.guncel.toFixed(1)} → imalat genişliyor. Risk iştahı pozitif, BTC için destekleyici ortam.`
      : `ISM İmalat PMI ${ismImalat.guncel.toFixed(1)} → imalat daralıyor. Ekonomik yavaşlama endişesi risk iştahını azaltır, BTC baskı altında.`);
  }

  if (perakende?.degisim != null) {
    yorumlar.push(perakende.degisim > 0
      ? `Perakende satışlar arttı (+%${perakende.degisim.toFixed(1)}). Güçlü tüketici → enflasyon baskısı sürer, Fed faiz düşürmeye acele etmez.`
      : `Perakende satışlar düştü (%${perakende.degisim.toFixed(1)}). Tüketici zayıflıyor → büyüme endişesi artar, Fed gevşeme ihtimali güçlenir.`);
  }

  const olumlu  = yorumlar.filter(y => y.includes("olumlu") || y.includes("pozitif") || y.includes("destekleyici")).length;
  const olumsuz = yorumlar.filter(y => y.includes("negatif") || y.includes("olumsuz") || y.includes("baskı")).length;

  let sentez;
  if (olumlu > olumsuz) {
    sentez = `📗 Makro tablo genel olarak BTC için OLUMLU görünüyor. ${olumlu}/${yorumlar.length} göstergede destekleyici sinyal mevcut. Risk iştahı artış eğiliminde, likidite genişlemesi beklentisi fiyatı destekliyor.`;
  } else if (olumsuz > olumlu) {
    sentez = `📕 Makro tablo genel olarak BTC için OLUMSUZ görünüyor. ${olumsuz}/${yorumlar.length} göstergede baskı sinyali mevcut. Sıkı para politikası ortamı risk iştahını kısıtlıyor.`;
  } else {
    sentez = `📙 Makro tablo NÖTR. Sinyaller çelişiyor — volatilite sıkışması ve yön bekleme dönemi olası. Yaklaşan FOMC ve NFP verileri kritik.`;
  }

  return { yorumlar, sentez };
}

// ─── ANA HANDLER ──────────────────────────────────────────
export default async function handler(req, res) {
  try {
    // Paralel çekimler
    const [
      // CPI — BLS: CUUR0000SA0 (ABD Tüketici Fiyat Endeksi, tüm kentler)
      cpi,
      // NFP — BLS: CES0000000001 (Tarım dışı toplam istihdam, bin kişi)
      nfp,
      // PPI — BLS: WPUFD49104 (ÜFE Nihai talep)
      ppi,
      // İşsizlik Başvuruları — BLS: CUSR0000AA0 (proxy)
      iscabasvurusu,
      // Fed Faiz — US Treasury kısa vadeli tahvil faizi (proxy)
      hazineT3m,
      // ABD borcu
      usaborcu,
      // GSYİH büyüme — World Bank
      gsyih,
      // PCE — OECD kişisel tüketim proxy
      pce,
      // ISM İmalat — BLS ISM Manufacturing proxy
      ismImalat,
      // Perakende Satışlar — BLS Retail proxy
      perakende,
      // Haberler — Türkçe + İngilizce
      fedHaberleri,
      enflasyonHaberleri,
    ] = await Promise.allSettled([
      blsSeries("CUUR0000SA0", 1),       // CPI
      blsSeries("CES0000000001", 1),     // NFP (bin kişi)
      blsSeries("WPSFD49502", 1),        // PPI Nihai talep
      blsSeries("LNS14000000", 1),       // İşsizlik oranı % (proxy başvuru için)
      hazineVeri("accounting/od/avg_interest_rates", "avg_interest_rate_amt", 4), // Hazine faiz oranı
      hazineVeri("debt/debt_to_penny", "tot_pub_debt_out_amt", 4), // ABD borcu
      worldBankVeri("NY.GDP.MKTP.KD.ZG", "US", 4),    // GSYİH büyüme %
      worldBankVeri("NE.CON.PRVT.KD.ZG", "US", 4),    // Kişisel tüketim büyüme
      blsSeries("NAPMPI", 1),            // ISM İmalat PMI
      blsSeries("RSSXFS", 1),            // Perakende satışlar (mevs. düz.)
      haberCekTurkce("Fed faiz kararı FOMC", "Federal Reserve interest rate FOMC"),
      haberCekTurkce("ABD enflasyon TÜFE", "US inflation CPI Consumer Price Index"),
    ]).then(rs => rs.map(r => r.status === "fulfilled" ? r.value : null));

    // Fed faiz proxy: hazine 3 aylık ortalama faiz
    const fedFaiz = hazineT3m ? {
      guncel:  parseFloat(hazineT3m.guncel?.toFixed(2) || 0),
      tarih:   hazineT3m.tarih,
      onceki:  hazineT3m.onceki ? parseFloat(hazineT3m.onceki.toFixed(2)) : null,
      degisim: hazineT3m.degisim ? parseFloat(hazineT3m.degisim.toFixed(3)) : null,
      gecmis:  hazineT3m.gecmis?.map(d => ({ ...d, deger: parseFloat(d.deger?.toFixed(2)||0) })),
    } : null;

    // Borç trilyon $
    const borcTr = usaborcu ? {
      guncel:  parseFloat((usaborcu.guncel / 1e12).toFixed(2)),
      tarih:   usaborcu.tarih,
      onceki:  usaborcu.onceki ? parseFloat((usaborcu.onceki / 1e12).toFixed(2)) : null,
      degisim: usaborcu.degisim ? parseFloat((usaborcu.degisim / 1e12).toFixed(3)) : null,
      gecmis:  usaborcu.gecmis?.map(d => ({ ...d, deger: parseFloat((d.deger/1e12).toFixed(2)) })),
    } : null;

    const gostergeler = {
      fedFaiz, cpi, nfp, ppi, gsyih, pce: pce,
      iscabasvurusu, ismImalat, perakende, usaborcu: borcTr,
    };

    const { yorumlar, sentez } = btcYorumUret(gostergeler);

    const sonuc = {
      guncellendi: new Date().toISOString(),
      gostergeler,
      btcYorum: { yorumlar, sentez },
      haberler: {
        fed:       fedHaberleri       || [],
        enflasyon: enflasyonHaberleri || [],
      },
    };

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json(sonuc);
  } catch (e) {
    return res.status(500).json({ hata: e.message });
  }
}
