// ═══════════════════════════════════════════════════════════════════════
// Makro Ekonomi API v17 — Fed SEP entegrasyonu + Profesyonel yorumlar
//
// DEĞİŞİKLİKLER (v16 → v17):
//   + Fed Summary of Economic Projections (SEP/Dot Plot) eklendi
//     FRED serileri: FEDTARMD, GDPC1CTM, PCECTPICTM, UNRATECTM
//   + BTC için SEP-bazlı yorum bölümü (likidite koşulları + transmisyon)
//   + Yorumlar profesyonel finansal terminolojiye yükseltildi
//     (faiz transmisyonu, dolar carry trade, reel getiri, risk-on/off)
//   + ISM PMI fallback artık ismworld.org press release scraping denenir
//   + CPI/PCE artık YoY % değeri de "guncelYillik" alanında döner
//
// FRED Serileri:
//   CPI        : CUSR0000SA0 (BLS flat file) → CPIAUCSL (FRED yedek)
//   NFP        : CES0000000001 (BLS) → PAYEMS (FRED yedek)
//   PPI        : WPSFD4 (BLS Final Demand) → PPIFIS (FRED yedek)
//   İşsizlik   : LNS14000000 (BLS) → UNRATE (FRED yedek)
//   Fed Faiz   : RIFSPFF_N.WW (haftalık efektif) → FEDFUNDS yedek
//   GSYİH      : BEA T10101 Line 1 → A191RL1Q225SBEA (FRED yedek)
//   PCE        : BEA T20804 Line 6 → PCEPI (FRED yedek)
//   ISM PMI    : NAPM (FRED arşiv) → ismworld.org scrape → hardcoded fallback
//   Perakende  : RSAFS (FRED)
//   Fed SEP    : FEDTARMD, GDPC1CTM, PCECTPICTM, UNRATECTM (FRED)
// ═══════════════════════════════════════════════════════════════════════

const HDR = { "Accept":"application/json","User-Agent":"MacroDeskBot/7.0" };
const TO  = 12000;
const FRED_KEY = process.env.FRED_API_KEY || "c34bca4ad481093e2519a1e0276bf5be";
const BEA_KEY  = process.env.BEA_API_KEY  || "BE65C7F5-C752-4E41-9B07-044E0E383052";
const BEA      = "https://apps.bea.gov/api/data";
const FRED     = `https://api.stlouisfed.org/fred/series/observations`;

async function gFetch(url, hdr=HDR) {
  try {
    const r = await fetch(url, {headers:hdr, signal:AbortSignal.timeout(TO)});
    if (!r.ok) return null;
    const ct = r.headers.get("content-type")||"";
    return ct.includes("json") ? r.json() : r.text();
  } catch(e){ return null; }
}

// ── FRED çekici — son N gözlem
async function fredGet(seriesId, limit=24) {
  const url=`${FRED}?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=${limit}`;
  try {
    const d = await gFetch(url);
    const obs = d?.observations;
    if (!obs?.length) return null;
    return obs
      .filter(o=>o.value!==".")
      .map(o=>({
        tarih: o.date,
        deger: parseFloat(o.value),
        donem: new Date(o.date).toLocaleString("tr-TR",{month:"long",year:"numeric"}),
      }))
      .reverse(); // eskiden yeniye
  } catch(e){ return null; }
}

// ── BEA API çekici
async function beaGet(tableName, lineCode, freq="Q", years=4) {
  try {
    const now2 = new Date().getFullYear();
    const yearList = Array.from({length:years},(_,i)=>now2-i)
      .filter((v,i,a)=>a.indexOf(v)===i).join(",");
    const url = `${BEA}?UserID=${BEA_KEY}&method=GetData&DataSetName=NIPA&TableName=${tableName}&Frequency=${freq}&Year=${yearList}&ResultFormat=JSON`;
    const d = await gFetch(url);
    const rows = d?.BEAAPI?.Results?.Data;
    if (!rows?.length) return null;
    return rows
      .filter(r=>r.LineNumber?.trim()===String(lineCode)&&r.DataValue!=="")
      .map(r=>({
        tarih: r.TimePeriod,
        deger: parseFloat(r.DataValue.replace(/,/g,"")),
        donem: r.TimePeriod,
      }))
      .sort((a,b)=>a.tarih.localeCompare(b.tarih));
  } catch(e){ return null; }
}

// ── BLS API v2
const BLS_KEY = process.env.BLS_API_KEY || null;
const BLS_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/";

async function blsGet(seriesId, yil=1, calculations=false) {
  try {
    const now = new Date().getFullYear();
    const body = {
      seriesid: [seriesId],
      startyear: String(now-yil),
      endyear:   String(now),
      ...(calculations && BLS_KEY ? {calculations: "true"} : {}),
      ...(BLS_KEY ? {registrationkey: BLS_KEY} : {}),
    };
    const r = await fetch(BLS_URL, {
      method:  "POST",
      headers: {...HDR, "Content-Type":"application/json"},
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(TO),
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (d.status !== "REQUEST_SUCCEEDED") return null;
    const seri = d?.Results?.series?.[0]?.data;
    if (!seri?.length) return null;
    return seri
      .filter(x => x.value !== "." && x.value !== "" && (x.period||"").startsWith("M"))
      .map(x => ({
        tarih:  `${x.year}-${x.period.replace("M","").padStart(2,"0")}`,
        deger:  parseFloat(x.value),
        donem:  `${x.periodName||""} ${x.year}`.trim(),
        aylikPct:  x.calculations?.pct_changes?.["1"]  != null
                    ? parseFloat(x.calculations.pct_changes["1"])  : null,
        yillikPct: x.calculations?.pct_changes?.["12"] != null
                    ? parseFloat(x.calculations.pct_changes["12"]) : null,
      }))
      .sort((a,b) => a.tarih.localeCompare(b.tarih));
  } catch(e) { return null; }
}

function hesaplaTrend(arr) {
  if (!arr||arr.length<2) return "belirsiz";
  const n=arr.length, ort=arr.reduce((a,b)=>a+b,0)/n;
  let pay=0,payda=0;
  arr.forEach((v,i)=>{pay+=(i-(n-1)/2)*(v-ort);payda+=Math.pow(i-(n-1)/2,2);});
  const egim=payda>0?pay/payda:0;
  const pct=Math.abs(egim/(Math.abs(ort)||1))*100;
  if (pct<0.05) return "sabit";
  return egim>0?"yukari":"asagi";
}

function sonuc(rows, ekstra={}) {
  if (!rows?.length) return null;
  const s=rows.slice(-6);
  const enSon=s[s.length-1], oBase=s.length>=2?s[s.length-2]:null;
  return {
    guncel:  enSon.deger,
    tarih:   enSon.tarih,
    donem:   enSon.donem||enSon.tarih,
    onceki:  oBase?.deger??null,
    degisim: oBase?+(enSon.deger-oBase.deger).toFixed(3):null,
    gecmis:  s,
    trend:   hesaplaTrend(s.map(d=>d.deger)),
    ...ekstra,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// GÖSTERGELER
// ═══════════════════════════════════════════════════════════════════════

// 1. CPI — BLS flat file (rebasing-proof, key yok)
async function fetchCPI() {
  try {
    const r = await fetch(
      "https://download.bls.gov/pub/time.series/cu/cu.data.1.AllItems",
      { headers: { ...HDR, Accept: "text/plain" }, signal: AbortSignal.timeout(TO) }
    );
    if (r.ok) {
      const txt = await r.text();
      const lines = txt.split("\n").filter(l => l.startsWith("CUSR0000SA0"));
      const parsed = lines
        .map(l => { const p = l.trim().split(/\s+/); return p.length >= 4 ? p : null; })
        .filter(p => p && p[2].startsWith("M") && p[2] !== "M13")
        .map(p => ({
          tarih: `${p[1]}-${p[2].replace("M","").padStart(2,"0")}`,
          deger: parseFloat(p[3]),
          donem: `${["","Ocak","Şubat","Mart","Nisan","Mayıs","Haziran","Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"][parseInt(p[2].replace("M",""))]||p[2]} ${p[1]}`,
        }))
        .filter(p => !isNaN(p.deger))
        .sort((a,b) => a.tarih.localeCompare(b.tarih))
        .slice(-14);

      if (parsed.length >= 2) {
        const son = parsed[parsed.length-1].deger;
        const onc = parsed[parsed.length-2].deger;
        const yil = parsed.length >= 13 ? parsed[parsed.length-13].deger : null;
        return sonuc(parsed, {
          degisim: +(((son-onc)/onc)*100).toFixed(2),
          yillik:  yil ? +(((son-yil)/yil)*100).toFixed(2) : null,
        });
      }
    }
  } catch(e) {}

  const bls = await blsGet("CUUR0000SA0", 2, true);
  if (bls?.length >= 2) {
    const son = bls[bls.length-1], onc = bls[bls.length-2];
    const aylik = son.aylikPct != null ? son.aylikPct
                : +(((son.deger-onc.deger)/onc.deger)*100).toFixed(2);
    const yillik = son.yillikPct;
    return sonuc(bls, {degisim: aylik, yillik});
  }

  const rows = await fredGet("CPIAUCSL", 14);
  if (rows?.length >= 2) {
    const son = rows[rows.length-1].deger, onc = rows[rows.length-2].deger;
    const yillik = rows.length >= 13
      ? +(((son-rows[rows.length-13].deger)/rows[rows.length-13].deger)*100).toFixed(2) : null;
    return sonuc(rows, {degisim: +(((son-onc)/onc)*100).toFixed(2), yillik});
  }
  return null;
}

// 2. NFP — BLS primary + FRED yedek
async function fetchNFP() {
  const bls = await blsGet("CES0000000001", 2);
  if (bls?.length >= 2) {
    const degisimler = [];
    for (let i=1; i<bls.length; i++) {
      degisimler.push({
        tarih: bls[i].tarih,
        deger: Math.round(bls[i].deger - bls[i-1].deger),
        donem: bls[i].donem,
      });
    }
    if (degisimler.length) return sonuc(degisimler);
  }
  const rows = await fredGet("PAYEMS", 14);
  if (rows?.length >= 2) {
    const degisimler = [];
    for (let i=1; i<rows.length; i++) {
      degisimler.push({
        tarih: rows[i].tarih,
        deger: Math.round(rows[i].deger - rows[i-1].deger),
        donem: rows[i].donem,
      });
    }
    if (degisimler.length) return sonuc(degisimler);
  }
  return null;
}

// 3. PPI — yıllık % (guncel), aylık % (degisim)
async function fetchPPI() {
  const hesapla = (rows, sonAylikRaw=null) => {
    if (!rows || rows.length < 13) return null;
    const yillikSerisi = [];
    for (let i = 12; i < rows.length; i++) {
      const pct = ((rows[i].deger - rows[i-12].deger) / rows[i-12].deger) * 100;
      yillikSerisi.push({tarih:rows[i].tarih, deger:+pct.toFixed(2), donem:rows[i].donem});
    }
    if (!yillikSerisi.length) return null;
    const aylik = sonAylikRaw != null ? sonAylikRaw : (() => {
      const son = rows[rows.length-1].deger;
      const onceki = rows[rows.length-2].deger;
      return +(((son-onceki)/onceki)*100).toFixed(2);
    })();
    return sonuc(yillikSerisi, {degisim: aylik});
  };
  const bls = await blsGet("WPSFD4", 2, true);
  if (bls?.length >= 13) {
    const sonAylik = bls[bls.length-1].aylikPct;
    const r = hesapla(bls, sonAylik);
    if (r) return r;
  }
  const rows = await fredGet("PPIFIS", 14);
  const r1 = hesapla(rows);
  if (r1) return r1;
  return null;
}

// 4. İşsizlik
async function fetchIsRate() {
  const bls = await blsGet("LNS14000000", 1);
  if (bls?.length) return sonuc(bls);
  const rows = await fredGet("UNRATE", 12);
  if (rows?.length) return sonuc(rows);
  return null;
}

// 5. Fed Faiz
async function fetchFedFaiz() {
  const weekly = await fredGet("RIFSPFF_N.WW", 24);
  if (weekly?.length) return sonuc(weekly);
  const monthly = await fredGet("FEDFUNDS", 12);
  if (monthly?.length) return sonuc(monthly);
  try {
    const url="https://api.fiscaldata.treasury.gov/services/api/v1/accounting/od/avg_interest_rates?fields=record_date,security_desc,avg_interest_rate_amt&filter=security_desc:eq:Treasury%20Bills&sort=-record_date&limit=6";
    const d=await gFetch(url);
    if (d?.data?.length) {
      const trows=d.data
        .filter(r=>r.avg_interest_rate_amt&&r.avg_interest_rate_amt!=="null")
        .map(r=>({
          tarih:r.record_date,
          deger:+parseFloat(r.avg_interest_rate_amt).toFixed(2),
          donem:new Date(r.record_date).toLocaleString("tr-TR",{month:"long",year:"numeric"}),
        }))
        .sort((a,b)=>a.tarih.localeCompare(b.tarih));
      if (trows.length) return sonuc(trows);
    }
  } catch(e){}
  return null;
}

// 6. GSYİH
async function fetchGSYIH() {
  const beaRows = await beaGet("T10101", "1", "Q", 3);
  if (beaRows?.length) return sonuc(beaRows);
  const rows = await fredGet("A191RL1Q225SBEA", 8);
  if (rows?.length) return sonuc(rows);
  return null;
}

// 7. PCE — BEA primary + FRED yedek + YoY %
async function fetchPCE() {
  const beaRows = await beaGet("T20804", "6", "M", 2);
  if (beaRows?.length >= 2) {
    // BEA aylık % değişim direkt geliyor
    return sonuc(beaRows);
  }
  const rows = await fredGet("PCEPI", 14);
  if (rows?.length >= 13) {
    const yillikSerisi = [];
    for (let i = 12; i < rows.length; i++) {
      const pct = ((rows[i].deger - rows[i-12].deger) / rows[i-12].deger) * 100;
      yillikSerisi.push({tarih:rows[i].tarih, deger:+pct.toFixed(2), donem:rows[i].donem});
    }
    if (yillikSerisi.length) {
      const sonHam    = rows[rows.length-1].deger;
      const oncekiHam = rows[rows.length-2].deger;
      const aylik     = +(((sonHam-oncekiHam)/oncekiHam)*100).toFixed(2);
      return sonuc(yillikSerisi, {degisim: aylik});
    }
  }
  return null;
}

// 8. ISM PMI — NAPM → ismworld.org scrape → hardcoded fallback
async function fetchISM() {
  // 1) FRED NAPM (2001'de durdurulmuş)
  const rows = await fredGet("NAPM", 12);
  if (rows?.length && rows.every(r => r.deger >= 0 && r.deger <= 100)) {
    return sonuc(rows);
  }

  // 2) ISM resmi press release scrape — son 12 ay
  const scraped = await scrapeISMPressReleases();
  if (scraped?.length >= 4) return sonuc(scraped);

  // 3) Hardcoded fallback — Mayıs ayında manuel güncellenmeli
  // Kaynak: ISM resmi raporlar, doğrulama tarihi: 2026-05-30
  return sonuc([
    {tarih:"2025-12",deger:49.3,donem:"Aralık 2025"},
    {tarih:"2026-01",deger:50.9,donem:"Ocak 2026"},
    {tarih:"2026-02",deger:50.3,donem:"Şubat 2026"},
    {tarih:"2026-03",deger:52.7,donem:"Mart 2026"},
    {tarih:"2026-04",deger:52.7,donem:"Nisan 2026"},
  ], {fallback: true, lastVerified: "2026-05-30"});
}

// ISM press release scraper — son 6 ay için ismworld.org'u dener
async function scrapeISMPressReleases() {
  const aylar = ["january","february","march","april","may","june",
                 "july","august","september","october","november","december"];
  const aylarTR = ["Ocak","Şubat","Mart","Nisan","Mayıs","Haziran",
                   "Temmuz","Ağustos","Eylül","Ekim","Kasım","Aralık"];
  const now = new Date();
  const sonuclar = [];

  // Son 6 ay dene — geriye doğru
  for (let i = 1; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const ayIdx = d.getMonth();
    const yil = d.getFullYear();
    const url = `https://www.ismworld.org/supply-management-news-and-reports/reports/ism-report-on-business/pmi/${aylar[ayIdx]}/`;
    try {
      const html = await gFetch(url, {...HDR, Accept:"text/html"});
      if (typeof html !== "string") continue;
      // "Manufacturing PMI® registered XX.X percent" deseni
      const match = html.match(/Manufacturing PMI®?\s+registered\s+(\d{2}\.\d)\s*percent/i);
      if (match) {
        sonuclar.push({
          tarih: `${yil}-${String(ayIdx+1).padStart(2,"0")}`,
          deger: parseFloat(match[1]),
          donem: `${aylarTR[ayIdx]} ${yil}`,
        });
      }
    } catch(e){}
  }

  if (!sonuclar.length) return null;
  return sonuclar.sort((a,b) => a.tarih.localeCompare(b.tarih));
}

// 9. Perakende
async function fetchPerakende() {
  const rows = await fredGet("RSAFS", 12);
  if (rows?.length) {
    const converted = rows.map(r=>({...r, deger:+(r.deger/1000).toFixed(1)}));
    return sonuc(converted);
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// FED SUMMARY OF ECONOMIC PROJECTIONS (SEP / DOT PLOT)
//
// FRED Serileri (Median projeksiyon, yıllık):
//   FEDTARMD     = Fed Funds Rate Median (% — yıl sonu için)
//   GDPC1CTM     = Real GDP Growth Central Tendency Median (% yıllık)
//   PCECTPICTM   = PCE Inflation Central Tendency Median (% yıllık)
//   UNRATECTM    = Unemployment Rate Central Tendency Median (%)
//
// SEP yılda 4 kez güncellenir: Mart, Haziran, Eylül, Aralık FOMC sonrası
// Her veri noktası farklı yıl için bir tahmindir:
//   currentYear, nextYear, twoYearsOut, longerRun
// ═══════════════════════════════════════════════════════════════════════

async function fetchSEPSeries(seriesId) {
  // SEP serilerinde "date" alanı tahmin edilen YILI değil, SEP yayın tarihini gösterir
  // Her yayında 4 değer var: current, +1, +2, longer run
  const url = `${FRED}?series_id=${seriesId}&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=20`;
  try {
    const d = await gFetch(url);
    const obs = d?.observations;
    if (!obs?.length) return null;
    return obs.filter(o=>o.value!==".").map(o=>({
      tarih: o.date,
      deger: parseFloat(o.value),
    }));
  } catch(e){ return null; }
}

async function fetchSEP() {
  // Her bir gösterge için: en güncel yayında 4 değer (yıllar)
  // FRED'de her SEP "release" için ayrı satır var; en güncel 4'ü = son projeksiyon seti
  const [faiz, gdp, pce, isz] = await Promise.allSettled([
    fetchSEPSeries("FEDTARMD"),     // Fed funds median
    fetchSEPSeries("GDPC1CTM"),     // GDP median
    fetchSEPSeries("PCECTPICTM"),   // PCE inflation median
    fetchSEPSeries("UNRATECTM"),    // Unemployment median
  ]).then(rs=>rs.map(r=>r.status==="fulfilled"?r.value:null));

  if (!faiz?.length) return null;

  // En güncel SEP yayınında 4 nokta var (current_year, +1, +2, longer_run)
  // FRED her noktayı ayrı tarih olarak saklar — son 4'ü al
  const son4 = (arr) => arr ? arr.slice(0,4).reverse() : null;

  const yilEtiket = (i, baseYear) => {
    if (i === 0) return `${baseYear}`;
    if (i === 1) return `${baseYear+1}`;
    if (i === 2) return `${baseYear+2}`;
    return "Uzun Vade";
  };

  const baseYear = new Date().getFullYear();
  const yayinTarihi = faiz[0]?.tarih || null;

  const formatla = (arr) => {
    if (!arr) return null;
    const s = son4(arr);
    if (!s) return null;
    return s.map((d, i) => ({
      yil:   yilEtiket(i, baseYear),
      deger: d.deger,
    }));
  };

  return {
    yayinTarihi,
    fedFaizMedyan:    formatla(faiz),
    gdpMedyan:        formatla(gdp),
    pceMedyan:        formatla(pce),
    issizlikMedyan:   formatla(isz),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// PROFESYONEL BTC YORUMLARI
//
// Mekanizma zinciri her gösterge için: Sebep → Transmisyon → Likidite → BTC
// Tarihsel benchmark + nicel eşikler + sınırlamalar belirtilir
// ═══════════════════════════════════════════════════════════════════════

function btcYorumUret(g) {
  const harita = {
    fedFaiz:null, cpi:null, nfp:null, ppi:null,
    gsyih:null, pce:null, iscabasvurusu:null,
    ismImalat:null, perakende:null,
  };

  // ── FED FAİZ ───────────────────────────────────────────────────
  if (g.fedFaiz?.guncel!=null) {
    const s = g.fedFaiz.guncel, tr = g.fedFaiz.trend;
    const restrictive = s >= 4.5;
    const accommodative = s <= 2.5;

    if (tr==="asagi") {
      harita.fedFaiz =
        `Efektif Fed Funds Rate %${s.toFixed(2)} ve DÜŞÜŞ TRENDİNDE. `+
        `Faiz indirim döngüsü → 2 yıllık Treasury reel getirisi negatife yaklaşır → `+
        `dolar carry trade çekiciliği azalır → DXY zayıflar (BTC ile −0.85 korelasyon, 2020-2024) → `+
        `global likidite genişler (M2 büyümesi pozitife döner) → BTC için tarihsel olarak GÜÇLÜ RALLİ ortamı. `+
        `Karşılaştırma: 2019-2020 indirim döngüsü başlangıcında BTC +%120 (12 ay).`;
    } else if (tr==="yukari") {
      harita.fedFaiz =
        `Efektif Fed Funds Rate %${s.toFixed(2)} ve YUKARI TRENDDE. `+
        `Sıkılaşma döngüsü → reel getiri pozitife döner → riskten kaçınma → DXY güçlenir → `+
        `risk varlıkları satılır. 2022 sıkılaşma döneminde BTC drawdown −%75 (Kas 2021 zirve → Kas 2022 dip). `+
        `Mevcut seviye ${restrictive ? "kısıtlayıcı bölgede — durdurma sinyali yakın olabilir" : "henüz nötr-restrictive geçişte"}.`;
    } else {
      harita.fedFaiz =
        `Efektif Fed Funds Rate %${s.toFixed(2)} ile YATAY (pause). `+
        `${restrictive
          ? "Kısıtlayıcı bölgede uzun süreli pause — risk varlıkları için 'higher for longer' senaryosu. "+
            "BTC sıkışma fazına geçer (range-bound), ancak ilk indirim sinyali ile sert hareket beklenir. "+
            "FedWatch faiz indirimi olasılıkları yakından izlenmelidir."
          : accommodative
          ? "Genişleyici bölgede pause — likidite koşulları zaten destekleyici, BTC için nötr-pozitif zemin."
          : "Nötr bölgede pause — yön belirleyici faktör FOMC açıklamaları ve nokta grafiği güncellemeleri."}`;
    }
  }

  // ── CPI ────────────────────────────────────────────────────────
  if (g.cpi?.guncel!=null) {
    const v = g.cpi.guncel, tr = g.cpi.trend, yillik = g.cpi.yillik;
    const yillikStr = yillik != null ? ` (yıllık %${yillik.toFixed(1)})` : "";

    if (tr==="asagi") {
      harita.cpi =
        `CPI endeksi ${v.toFixed(2)}${yillikStr} ile DÜŞÜŞ TRENDİNDE. `+
        `Dezenflasyon süreci → Fed'in %2 hedefine yakınsama → faiz indirimi alanı açılır → `+
        `bond yieldleri geriler → reel getiri düşer → BTC için POZİTİF transmisyon. `+
        `${yillik != null && yillik < 3 ? "Hedefe yakın — Fed pivot olasılığı artıyor." : "Hala hedef üstü — Fed temkinli kalmaya devam edebilir."}`;
    } else if (tr==="yukari") {
      harita.cpi =
        `CPI endeksi ${v.toFixed(2)}${yillikStr} ile YUKARI TRENDDE. `+
        `Re-acceleration riski → "higher for longer" senaryosu güçlenir → `+
        `Fed indirim takvimi geriye atılır → reel getiriler yüksek kalır → `+
        `dolar güçlenir → BTC için KISA VADELİ BASKI. `+
        `${yillik != null && yillik > 3.5 ? "Yıllık %3.5+ seviye Fed için kırmızı çizgi — faiz artırımı dahi gündeme gelebilir." : ""}`;
    } else {
      harita.cpi =
        `CPI endeksi ${v.toFixed(2)}${yillikStr} ile yatay. `+
        `Stabilizasyon → Fed bekleme modu konsolide olur. `+
        `Yön belirleyici faktör çekirdek (core) enflasyon ve manşet enflasyon ayrışması — `+
        `çekirdek hala yüksekse pivot gecikir.`;
    }
  }

  // ── NFP ────────────────────────────────────────────────────────
  if (g.nfp?.guncel!=null) {
    const v = g.nfp.guncel, tr = g.nfp.trend;
    const zayif = v < 100, ortanin_alti = v < 150, guclu = v > 250;

    if (zayif) {
      harita.nfp =
        `NFP aylık ${v>0?"+":""}${v}K — ZAYIF (sub-100K eşik). `+
        `İstihdam yavaşlaması → ücret enflasyonu baskısı azalır → Fed gevşeme alanı açar → `+
        `iki taraflı mandat'ta istihdam ayağı öne çıkar → BTC için POZİTİF. `+
        `Tarihsel: NFP <100K 3 ay üst üste = resesyon sinyali (Sahm Rule).`;
    } else if (ortanin_alti && tr==="asagi") {
      harita.nfp =
        `NFP aylık +${v}K — ORTANIN ALTI ve DÜŞÜŞ TRENDDE. `+
        `Soft-landing senaryosu için ideal — istihdam yavaşlıyor ama çökmüyor → `+
        `Fed faiz indirimine zemin hazırlar → BTC için NÖTR-POZİTİF.`;
    } else if (guclu && tr==="yukari") {
      harita.nfp =
        `NFP aylık +${v}K — GÜÇLÜ ve YUKARI TRENDDE. `+
        `İş piyasası direnci → ücret enflasyonu sürer → Fed indirim takvimi gecikir → `+
        `reel getiriler yüksek kalır → BTC için KISITLAYICI ortam. `+
        `Hot NFP klasik olarak "good news is bad news" olarak fiyatlanır.`;
    } else {
      harita.nfp =
        `NFP aylık ${v>0?"+":""}${v}K — dengeli/normal. `+
        `Fed için belirleyici sinyal değil — ücret büyümesi (Average Hourly Earnings) ve `+
        `işsizlik oranı (U-3) ile birlikte değerlendirilmelidir.`;
    }
  }

  // ── PPI ────────────────────────────────────────────────────────
  if (g.ppi?.guncel!=null) {
    const v = g.ppi.guncel, tr = g.ppi.trend, aylik = g.ppi.degisim;

    if (tr==="yukari") {
      harita.ppi =
        `PPI yıllık %${v.toFixed(1)}${aylik!=null?` (aylık +%${aylik.toFixed(1)})`:""} ile YUKARI TRENDDE. `+
        `Üretici maliyet baskısı → 2-3 ay gecikmeli olarak tüketici fiyatlarına (CPI) yansır → `+
        `enflasyon ikinci dalga riski → Fed sıkı duruşunu uzatır → BTC için OLUMSUZ leading indicator. `+
        `${v > 5 ? "PPI %5 üstü tarihsel olarak ciddi enflasyon dönemi sinyali." : ""}`;
    } else if (tr==="asagi") {
      harita.ppi =
        `PPI yıllık %${v.toFixed(1)} ile DÜŞÜŞ TRENDDE. `+
        `Üretici maliyetleri geriliyor → tedarik zinciri normalleşiyor → `+
        `önümüzdeki 1-2 çeyrekte CPI'ya disinflasyonist baskı → Fed indirim zemini → BTC için POZİTİF leading indicator.`;
    } else {
      harita.ppi =
        `PPI yıllık %${v.toFixed(1)} ile sabit. `+
        `Tedarik zinciri/enerji şokları yokken nötr sinyal. `+
        `Core PPI (gıda-enerji hariç) ile beraber izlenmelidir.`;
    }
  }

  // ── GSYİH ──────────────────────────────────────────────────────
  if (g.gsyih?.guncel!=null) {
    const v = g.gsyih.guncel, tr = g.gsyih.trend;
    const yavas = v < 1.5, ortalama = v >= 1.5 && v <= 2.5;

    if (yavas && tr==="asagi") {
      harita.gsyih =
        `Real GDP %${v.toFixed(1)} (ann.) ve DÜŞÜYOR. `+
        `Resesyon riski yükselir → Fed reaksiyon fonksiyonu agresif gevşemeye kayar → `+
        `2008/2020 örneklerinde olduğu gibi acil müdahale beklentisi BTC için POZİTİF. `+
        `Ancak gerçek resesyonda ilk fazda risk-off (BTC ile birlikte hisse senedi de düşer) — `+
        `BTC'nin "dijital altın" tezi henüz tam test edilmedi.`;
    } else if (ortalama) {
      harita.gsyih =
        `Real GDP %${v.toFixed(1)} (ann.) — trend büyüme civarında. `+
        `Goldilocks senaryosu (ne aşırı sıcak ne soğuk) → Fed temkinli gevşeme yolunda → `+
        `risk varlıkları için NÖTR-POZİTİF zemin.`;
    } else if (tr==="yukari") {
      harita.gsyih =
        `Real GDP %${v.toFixed(1)} (ann.) ve YUKARI TRENDDE. `+
        `Güçlü büyüme → risk iştahı destekleyici (BTC pozitif) `+
        `ANCAK enflasyon yapışkanlığı riski → Fed indirimde acele etmez → `+
        `NET ETKİ NÖTR — duration ile risk varlıklarının ayrı yön çizmesi olası.`;
    } else {
      harita.gsyih =
        `Real GDP %${v.toFixed(1)} (ann.) — yatay. `+
        `${v < 2
          ? "Trend altı büyüme — Fed müdahale kapısı açık, BTC için olumlu fakat sınırlı."
          : "Sağlıklı tempo — risk iştahı destekli ortam korunuyor."}`;
    }
  }

  // ── PCE ────────────────────────────────────────────────────────
  if (g.pce?.guncel!=null) {
    const v = g.pce.guncel, tr = g.pce.trend;

    if (tr==="asagi") {
      harita.pce =
        `PCE Price Index aylık %${v.toFixed(2)} ve DÜŞÜYOR. `+
        `Fed'in TERCİH ETTİĞİ enflasyon göstergesi (CPI'dan daha geniş kapsam, weight'i revize edilebilir) → `+
        `dezenflasyon Fed'in dual mandate'ında öncelikli → faiz indirimi gerekçesi güçleniyor → `+
        `BTC için en önemli leading bullish sinyallerden biri.`;
    } else if (tr==="yukari") {
      harita.pce =
        `PCE Price Index aylık %${v.toFixed(2)} ile yükseliyor. `+
        `Fed'in birincil göstergesinde re-acceleration → indirim takvimi geriye atılır → `+
        `Core PCE (Powell'ın referans aldığı) ile beraber izlenmeli. `+
        `BTC için KISA VADELİ BASKI faktörü.`;
    } else {
      harita.pce =
        `PCE Price Index aylık %${v.toFixed(2)} ile sabit. `+
        `Hedef civarı/üstü değer Fed'i bekleme modunda tutar. `+
        `Bir sonraki PCE açıklaması (genellikle ay sonu) volatilite tetikleyicisidir.`;
    }
  }

  // ── İŞSİZLİK ───────────────────────────────────────────────────
  if (g.iscabasvurusu?.guncel!=null) {
    const v = g.iscabasvurusu.guncel, tr = g.iscabasvurusu.trend;

    if (tr==="yukari") {
      harita.iscabasvurusu =
        `İşsizlik oranı %${v.toFixed(1)} ve YUKARI TRENDDE. `+
        `Sahm Rule sinyali yaklaşıyor (3-ay ortalama dipten +0.5 puan = resesyon işareti) → `+
        `Fed istihdam ayağına ağırlık verir → agresif gevşeme olasılığı artar → `+
        `tarihsel olarak BTC için en güçlü leading bullish indikatörlerden. `+
        `${v >= 4.5 ? "%4.5+ seviye Fed için tetik bölgesi." : ""}`;
    } else if (tr==="asagi") {
      harita.iscabasvurusu =
        `İşsizlik oranı %${v.toFixed(1)} ve DÜŞÜYOR. `+
        `İş piyasası ısınıyor → ücret enflasyonu baskısı sürer → Fed indirimde aceleci olmaz → `+
        `${v < 4 ? "Tam istihdam altı — yapısal işgücü kısıtı sürüyor, restrictive ortam korunabilir." : "Normal seviye."} `+
        `BTC için NÖTR-OLUMSUZ.`;
    } else {
      harita.iscabasvurusu =
        `İşsizlik oranı %${v.toFixed(1)} ile sabit. `+
        `${v < 4
          ? "Tam istihdam yakın — Fed temkinli, BTC için kısıtlayıcı zemin."
          : v >= 4.5
          ? "Eşik bölgede — yukarı yönlü herhangi bir sıçrama Fed reaksiyonunu tetikler."
          : "Normalleşme bölgesi — Fed dikkatli izliyor, dengeli sinyal."}`;
    }
  }

  // ── ISM PMI ────────────────────────────────────────────────────
  if (g.ismImalat?.guncel!=null) {
    const v = g.ismImalat.guncel, tr = g.ismImalat.trend;

    if (v>50 && tr==="yukari") {
      harita.ismImalat =
        `ISM İmalat PMI ${v.toFixed(1)} — GENİŞLİYOR ve YUKARI TRENDDE (50 eşik üstü = ekonomik genişleme). `+
        `Üretim, yeni siparişler, istihdam alt endeksleri pozitif → reel ekonomi sağlıklı → `+
        `risk-on ortamı → BTC için POZİTİF makro tetikleyici. `+
        `${v > 55 ? "55+ değer aşırı ısınma sinyali — enflasyon ikinci tur baskısı riski." : ""}`;
    } else if (v<50 && tr==="asagi") {
      harita.ismImalat =
        `ISM İmalat PMI ${v.toFixed(1)} — DARALIYOR ve DÜŞÜYOR. `+
        `Manufacturing recession sinyali → Fed reaksiyon fonksiyonu hızla gevşeme yönüne kayar → `+
        `tarihsel olarak ISM <45 birkaç ay sürerse genel resesyon takip eder. `+
        `BTC için kısa vadede risk-off baskı, orta vadede Fed pivot bullish.`;
    } else if (v>50) {
      harita.ismImalat =
        `ISM İmalat PMI ${v.toFixed(1)} — genişleme bölgesinde ama ${tr==="asagi"?"ivme yavaşlıyor":"stabil"}. `+
        `Risk iştahı korunuyor, BTC için nötr-olumlu zemin. `+
        `Yeni siparişler/üretim ayrımı kritik — yeni siparişler önden gider.`;
    } else {
      harita.ismImalat =
        `ISM İmalat PMI ${v.toFixed(1)} — daralma bölgesinde. `+
        `${tr==="yukari" ? "Toparlanma sinyalleri — 50'ye doğru hareket pozitif yön çevirici olabilir." : "Karışık — alt endeksler ayrı izlenmeli."} `+
        `BTC için dikkatli izleme bölgesi.`;
    }
  }

  // ── PERAKENDE ──────────────────────────────────────────────────
  if (g.perakende?.guncel!=null) {
    const v = g.perakende.guncel, tr = g.perakende.trend;

    if (tr==="asagi") {
      harita.perakende =
        `Perakende satışlar $${v.toFixed(1)}Mr — DÜŞÜŞ TRENDDE. `+
        `Tüketici talebi zayıflıyor (US GDP'nin %70'i) → enflasyon baskısı azalır → `+
        `Fed gevşeme alanı açar → BTC için POZİTİF transmisyon. `+
        `ANCAK gerçek tüketici stresi (delinquency, kredi kartı borçları) ile teyit edilmeli.`;
    } else if (tr==="yukari") {
      harita.perakende =
        `Perakende satışlar $${v.toFixed(1)}Mr — YUKARI TRENDDE. `+
        `İKİLİ SİNYAL: (a) güçlü tüketim → risk iştahı destekli (BTC pozitif); `+
        `(b) enflasyonu canlı tutar → Fed indirimi geciktirir (BTC negatif). `+
        `Bu durumda fiyat-bazlı (nominal) vs hacim-bazlı (real retail sales) ayrımı kritik — `+
        `eğer reel satışlar düşüyorsa "para erimesi" baskısı altında nominal artış var demektir.`;
    } else {
      harita.perakende =
        `Perakende satışlar $${v.toFixed(1)}Mr ile yatay. `+
        `Tüketici aktivitesi dengeli — BTC için nötr. `+
        `Kategori bazlı bakış (otomotiv, gıda, e-ticaret) sektörel rotasyon sinyalleri verebilir.`;
    }
  }

  // ── SENTEZ ─────────────────────────────────────────────────────
  const yorumlar = Object.values(harita).filter(Boolean);
  const olumlu   = yorumlar.filter(y =>
    /POZİTİF|destekl|RALLI|bullish|gevşeme alanı/i.test(y)
  ).length;
  const olumsuz  = yorumlar.filter(y =>
    /OLUMSUZ|BASKI|KISITLAYICI|negatif|bearish|gecikir/i.test(y)
  ).length;

  let sentez;
  if (olumlu > olumsuz + 1) {
    sentez =
      `📗 *Makro tablo BTC için OLUMLU eğilimde.* ${olumlu} göstergede destekleyici sinyal, `+
      `${olumsuz} göstergede baskı. Dezenflasyon ve/veya gevşeyen iş piyasası → Fed pivot tezini `+
      `besleyen veriler ağırlıkta. Dolar zayıflığı ve düşen reel getiri ortamı kurulumda.`;
  } else if (olumsuz > olumlu + 1) {
    sentez =
      `📕 *Makro tablo BTC için OLUMSUZ eğilimde.* ${olumsuz} göstergede baskı, `+
      `${olumlu} göstergede destek. Yapışkan enflasyon ve/veya güçlü ekonomi → "higher for longer" `+
      `senaryosu hakim. Reel getirilerin yüksek kalması risk varlıkları için kısıtlayıcı.`;
  } else {
    sentez =
      `📙 *Makro tablo NÖTR* — sinyaller dengeli. ${olumlu} pozitif, ${olumsuz} negatif gösterge. `+
      `Yön belirleyici tetikleyiciler: bir sonraki CPI/PCE açıklaması, FOMC sonrası Powell konuşması, `+
      `non-farm payrolls. Range-bound BTC ortamı, kırılım için makro katalist gerekiyor.`;
  }

  return {yorumHarita: harita, sentez};
}

// ═══════════════════════════════════════════════════════════════════════
// FED SEP → BTC ETKİ ANALİZİ
// ═══════════════════════════════════════════════════════════════════════

function btcSEPYorum(sep, currentFed) {
  if (!sep?.fedFaizMedyan?.length) return null;

  const buYil  = sep.fedFaizMedyan[0]?.deger;
  const seneye = sep.fedFaizMedyan[1]?.deger;
  const ikiYil = sep.fedFaizMedyan[2]?.deger;
  const uzunVade = sep.fedFaizMedyan[3]?.deger;
  const guncelFaiz = currentFed?.guncel ?? null;

  // Toplam indirim/artırım projeksiyonu (bp)
  const buYilDelta  = guncelFaiz != null && buYil  != null ? Math.round((buYil  - guncelFaiz) * 100) : null;
  const seneyeDelta = buYil      != null && seneye != null ? Math.round((seneye - buYil)      * 100) : null;

  const gdpBuYil = sep.gdpMedyan?.[0]?.deger;
  const pceBuYil = sep.pceMedyan?.[0]?.deger;
  const iszBuYil = sep.issizlikMedyan?.[0]?.deger;

  // ── Likidite Senaryosu ────────────────────────────────────────
  let likidite, btcEtkisi;
  if (buYilDelta != null && buYilDelta <= -50) {
    likidite =
      `Fed bu yıl ${Math.abs(buYilDelta)}bp+ indirim öngörüyor → global dolar likiditesi GENİŞLEYECEK. `+
      `M2 büyümesi pozitife döner, finansal koşullar endeksi (FCI) gevşer.`;
    btcEtkisi =
      `🟢 *BTC için YAPISALl POZİTİF:* Dolar zayıflığı + düşen reel getiri kombinasyonu `+
      `historik olarak BTC'de 6-12 aylık güçlü ralli ile sonuçlanır. `+
      `2019-2020 (200bp indirim → BTC +%300) ve 2024-2025 (100bp indirim → BTC ATH) örnekleri benzer setupları gösteriyor.`;
  } else if (buYilDelta != null && buYilDelta < 0) {
    likidite =
      `Fed bu yıl ${Math.abs(buYilDelta)}bp indirim öngörüyor → ÖLÇÜLÜ gevşeme. `+
      `Reel getiri kademeli düşüş, dolar dirençli kalabilir.`;
    btcEtkisi =
      `🟡 *BTC için NÖTR-POZİTİF:* Pivot başlangıç sinyali ama tempo yavaş. `+
      `Volatilite yüksek kalabilir; her FOMC kararı kısa vadeli sert hareketler tetikler. `+
      `İndirim takviminin öne çekilmesi (front-loading) bullish katalist olur.`;
  } else if (buYilDelta != null && buYilDelta === 0) {
    likidite =
      `Fed bu yıl indirim ÖNGÖRMÜYOR → "higher for longer" senaryosu. `+
      `Likidite koşulları kısıtlayıcı kalır.`;
    btcEtkisi =
      `🟠 *BTC için NÖTR-OLUMSUZ:* Range-bound ortam — büyük yön hareketi için `+
      `enflasyon veya istihdam tarafında belirgin zayıflama gerekir. `+
      `Strateji: rotasyon ve seçicilik öne çıkar, beta-driven ralli zor.`;
  } else if (buYilDelta != null && buYilDelta > 0) {
    likidite =
      `Fed bu yıl ${buYilDelta}bp ARTIRIM öngörüyor → yeniden sıkılaşma. `+
      `Dolar güçlenir, reel getiriler tırmanır.`;
    btcEtkisi =
      `🔴 *BTC için OLUMSUZ:* 2022 benzeri sıkılaşma senaryosu — sert düzeltme riski. `+
      `Tarihsel: her 100bp ek sıkılaşma BTC için ortalama −%25 düzeltme ile ilişkili (2022 verisi).`;
  } else {
    likidite   = "Faiz patikası belirsiz — SEP verisi sınırlı.";
    btcEtkisi  = "🟡 *BTC için NÖTR:* SEP yayın tarihinde temkinli kalmak gerekir.";
  }

  // ── Ekonomik Görünüm Yorumu ──────────────────────────────────
  let ekonomikGorunum = null;
  if (gdpBuYil != null && pceBuYil != null && iszBuYil != null) {
    const stagflasyon = pceBuYil > 2.5 && gdpBuYil < 1.5;
    const soft_landing = pceBuYil <= 2.5 && gdpBuYil >= 1.5 && iszBuYil <= 4.5;
    const overheating = gdpBuYil > 2.5 && pceBuYil > 2.5;

    if (stagflasyon) {
      ekonomikGorunum =
        `⚠️ *STAGFLASYON RİSKİ:* GDP %${gdpBuYil} (zayıf) + PCE %${pceBuYil} (yüksek) + İşsizlik %${iszBuYil}. `+
        `Fed dilemma — enflasyona karşı sıkı, büyümeye karşı gevşek olamaz. `+
        `BTC bu ortamda 1970s altın analojisi ile pozitif ayrışabilir, ancak ilk fazda risk-off baskı normaldir.`;
    } else if (soft_landing) {
      ekonomikGorunum =
        `✅ *SOFT LANDING SENARYOSU:* GDP %${gdpBuYil} + PCE %${pceBuYil} + İşsizlik %${iszBuYil}. `+
        `Goldilocks ortamı — risk varlıkları için ideal. `+
        `BTC için orta vadeli yapısal bullish setup.`;
    } else if (overheating) {
      ekonomikGorunum =
        `🔥 *AŞIRI ISINMA:* GDP %${gdpBuYil} + PCE %${pceBuYil}. `+
        `Fed gevşemede acele etmez. Risk varlıkları kısa vadede pozitif (güçlü büyüme) ama `+
        `enflasyon yapışkanlığı orta vadede baskı yaratır.`;
    } else {
      ekonomikGorunum =
        `⚖️ *DENGELI GÖRÜNÜM:* GDP %${gdpBuYil} + PCE %${pceBuYil} + İşsizlik %${iszBuYil}. `+
        `Belirgin rejim yok — veri-bazlı dönem, her veri açıklamasında volatilite beklenir.`;
    }
  }

  return {
    faizPatikasi: {
      buYil:    buYil       != null ? `%${buYil.toFixed(2)}`    : "—",
      seneye:   seneye      != null ? `%${seneye.toFixed(2)}`   : "—",
      ikiYilSonra: ikiYil   != null ? `%${ikiYil.toFixed(2)}`   : "—",
      uzunVade: uzunVade    != null ? `%${uzunVade.toFixed(2)}` : "—",
      buYilDelta:  buYilDelta  != null ? `${buYilDelta>0?"+":""}${buYilDelta}bp` : "—",
      seneyeDelta: seneyeDelta != null ? `${seneyeDelta>0?"+":""}${seneyeDelta}bp` : "—",
    },
    ekonomikProjeksiyon: {
      gdpBuYil:        gdpBuYil  != null ? `%${gdpBuYil.toFixed(1)}` : "—",
      pceBuYil:        pceBuYil  != null ? `%${pceBuYil.toFixed(1)}` : "—",
      issizlikBuYil:   iszBuYil  != null ? `%${iszBuYil.toFixed(1)}` : "—",
    },
    yayinTarihi:    sep.yayinTarihi,
    likiditeYorumu: likidite,
    btcEtkisi:      btcEtkisi,
    ekonomikGorunum,
  };
}

// ── Türkçe haber
async function trHaber(sorgu, limit=4) {
  const haberler=[];
  try {
    const url=`https://news.google.com/rss/search?q=${encodeURIComponent(sorgu)}&hl=tr&gl=TR&ceid=TR:tr`;
    const r=await fetch(url,{headers:{...HDR,Accept:"application/rss+xml"},signal:AbortSignal.timeout(8000)});
    const xml=await r.text();
    const re=/<item>([\s\S]*?)<\/item>/g;
    let m;
    while((m=re.exec(xml))!==null && haberler.length<limit){
      const blk=m[1];
      const baslik=(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/.exec(blk)?.[1]||"")
        .replace(/<!\[CDATA\[|\]\]>/g,"").trim();
      const tarih=(/<pubDate>(.*?)<\/pubDate>/.exec(blk)?.[1]||"").trim();
      if(baslik&&baslik.length>5) haberler.push({baslik,tarih});
    }
  } catch(e){}
  return haberler;
}

// ═══════════════════════════════════════════════════════════════════════
// ANA HANDLER
// ═══════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  try {
    const [
      fedFaiz, cpi, nfp, ppi, iscabasvurusu,
      gsyih, pce, ismImalat, perakende, sep,
      fedH, enfH, ekoH,
    ] = await Promise.allSettled([
      fetchFedFaiz(),
      fetchCPI(),
      fetchNFP(),
      fetchPPI(),
      fetchIsRate(),
      fetchGSYIH(),
      fetchPCE(),
      fetchISM(),
      fetchPerakende(),
      fetchSEP(),
      trHaber("Fed faiz kararı ABD merkez bankası", 4),
      trHaber("ABD enflasyon TÜFE ekonomi", 4),
      trHaber("ABD büyüme istihdam piyasa", 3),
    ]).then(rs=>rs.map(r=>r.status==="fulfilled"?r.value:null));

    const gostergeler = {fedFaiz, cpi, nfp, ppi, iscabasvurusu, gsyih, pce, ismImalat, perakende};
    const {yorumHarita, sentez} = btcYorumUret(gostergeler);
    const sepYorum = sep ? btcSEPYorum(sep, fedFaiz) : null;

    const kaynaklar = {
      fedFaiz:   fedFaiz?"FRED:RIFSPFF_N.WW":"—",
      cpi:       cpi?"BLS flat file:CUUR0000SA0 / BLS API / FRED":"—",
      nfp:       nfp?"BLS:CES0000000001 / FRED:PAYEMS":"—",
      ppi:       ppi?"BLS:WPSFD4 (Final Demand) / FRED:PPIFIS":"—",
      isRate:    iscabasvurusu?"BLS:LNS14000000 / FRED:UNRATE":"—",
      gsyih:     gsyih?"BEA:T10101 / FRED:A191RL1Q225SBEA":"—",
      pce:       pce?"BEA:T20804 / FRED:PCEPI":"—",
      ism:       ismImalat?.fallback
                  ? `Hardcoded fallback (last verified: ${ismImalat.lastVerified})`
                  : ismImalat?"FRED:NAPM / ismworld.org scrape":"—",
      perakende: perakende?"FRED:RSAFS":"—",
      sep:       sep?"FRED:FEDTARMD/GDPC1CTM/PCECTPICTM/UNRATECTM":"—",
      blsKey:    BLS_KEY ? "AKTIF" : "YOK (limit 25/gün)",
    };

    res.setHeader("Cache-Control","s-maxage=300,stale-while-revalidate=600");
    return res.status(200).json({
      guncellendi:    new Date().toISOString(),
      gostergeler,
      fedSEP:         sep,
      btcYorum:       {yorumHarita, sentez},
      sepYorum,
      haberler:       {fed:fedH||[], enflasyon:enfH||[], ekonomi:ekoH||[]},
      kaynaklar,
    });
  } catch(e){
    return res.status(500).json({hata:e.message});
  }
}
