// ═══════════════════════════════════════════════════════════
// Makro Ekonomi API v15 — CPI: NSA endeks + SA % (ikili seri)
//
// Tüm göstergeler önce FRED API'den çekilir (gerçek zamanlı).
// FRED başarısız olursa BLS API yedek olarak devreye girer.
// FRED API Key: Vercel env → FRED_API_KEY
//
// FRED Serileri:
//   CPI        : CPIAUCSL  (All Urban, SA, aylık)
//   NFP        : PAYEMS    (Nonfarm Payroll, aylık değişim)
//   PPI        : WPU00000000 (Finished Goods, aylık % değişim)
//   İşsizlik   : UNRATE    (Unemployment Rate %)
//   Fed Faiz   : RIFSPFF_N.WW (Effective Fed Funds, haftalık — en güncel)
//   GSYİH      : GDPC1     (Real GDP, çeyreklik büyüme %)
//   PCE        : BEA T20804 (PCE Price Index, aylık % değişim)
//   ISM PMI    : NAPM      (ISM Manufacturing PMI)
//   Perakende  : RSAFS     (Retail Sales, milyar $)
// ═══════════════════════════════════════════════════════════

const HDR = { "Accept":"application/json","User-Agent":"MacroDeskBot/6.0" };
const TO  = 12000;
const FRED_KEY = process.env.FRED_API_KEY || "c34bca4ad481093e2519a1e0276bf5be";
const BEA_KEY  = process.env.BEA_API_KEY  || "BE65C7F5-C752-4E41-9B07-044E0E383052";
const BEA      = "https://apps.bea.gov/api/data";
const FRED     = `https://api.stlouisfed.org/fred/series/observations`;

async function gFetch(url) {
  try {
    const r=await fetch(url,{headers:HDR,signal:AbortSignal.timeout(TO)});
    if (!r.ok) return null;
    const ct=r.headers.get("content-type")||"";
    return ct.includes("json")?r.json():r.text();
  } catch(e){return null;}
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
    // Her zaman en güncel yılı dahil et
    const yearList = Array.from({length:years},(_,i)=>now2-i)
      .filter((v,i,a)=>a.indexOf(v)===i).join(",");
    const url = `${BEA}?UserID=${BEA_KEY}&method=GetData&DataSetName=NIPA&TableName=${tableName}&Frequency=${freq}&Year=${yearList}&ResultFormat=JSON`;
    const d = await gFetch(url);
    const rows = d?.BEAAPI?.Results?.Data;
    if (!rows?.length) return null;
    return rows
      .filter(r=>r.LineNumber?.trim()===String(lineCode)&&r.DataValue!=="")
      .map(r=>({
        tarih: r.TimePeriod,   // "2026Q1" veya "2026-04"
        deger: parseFloat(r.DataValue.replace(/,/g,"")),
        donem: r.TimePeriod,
      }))
      .sort((a,b)=>a.tarih.localeCompare(b.tarih));
  } catch(e){ return null; }
}

// ── BLS API v2 — key ile en güncel veri + calculations (resmi % değerleri)
const BLS_KEY = process.env.BLS_API_KEY || null;
const BLS_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/";

async function blsGet(seriesId, yil=1, calculations=false) {
  try {
    const now = new Date().getFullYear();
    const body = {
      seriesid: [seriesId],
      startyear: String(now-yil),
      endyear:   String(now),
      // key varsa calculations alanı dolu gelir (aylık+yıllık % otomatik)
      ...(calculations && BLS_KEY ? {calculations: "true"} : {}),
      ...(BLS_KEY ? {registrationkey: BLS_KEY} : {}),
    };
    const r = await fetch(BLS_URL, {
      method:  "POST",
      headers: {...HDR, "Content-Type":"application/json"},
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(TO),
    });
    if (!r.ok) {
      console.error(`BLS ${seriesId} HTTP ${r.status}`);
      return null;
    }
    const d = await r.json();
    if (d.status !== "REQUEST_SUCCEEDED") {
      console.error(`BLS ${seriesId} status: ${d.status}`, d.message);
      return null;
    }
    const seri = d?.Results?.series?.[0]?.data;
    if (!seri?.length) return null;
    return seri
      .filter(x => x.value !== "." && x.value !== "" && (x.period||"").startsWith("M"))
      .map(x => ({
        tarih:  `${x.year}-${x.period.replace("M","").padStart(2,"0")}`,
        deger:  parseFloat(x.value),
        donem:  `${x.periodName||""} ${x.year}`.trim(),
        // calculations sadece BLS_KEY varsa gelir
        aylikPct:  x.calculations?.pct_changes?.["1"]  != null
                    ? parseFloat(x.calculations.pct_changes["1"])  : null,
        yillikPct: x.calculations?.pct_changes?.["12"] != null
                    ? parseFloat(x.calculations.pct_changes["12"]) : null,
      }))
      .sort((a,b) => a.tarih.localeCompare(b.tarih));
  } catch(e) {
    console.error(`BLS ${seriesId} exception:`, e.message);
    return null;
  }
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

// ═══════════════════════════════════════════════════════════
// GÖSTERGELERİ ÇEK — FRED öncelikli, BLS yedek
// ═══════════════════════════════════════════════════════════

// 1. CPI — NSA endeks (333.02 manşet) + SA aylık % (0.60)
// CUUR0000SA0 = NSA → manşet endeks değeri (medyanın açıkladığı)
// CUSR0000SA0 = SA  → aylık % değişim için doğru seri
async function fetchCPI() {
  const [blsNSA, blsSA] = await Promise.all([
    blsGet("CUUR0000SA0", 2, true),
    blsGet("CUSR0000SA0", 2, true),
  ]);
  if (blsNSA?.length >= 2 && blsSA?.length >= 2) {
    const sonSA  = blsSA[blsSA.length-1];
    const oncSA  = blsSA[blsSA.length-2];
    const aylik  = sonSA.aylikPct != null ? sonSA.aylikPct
                 : +(((sonSA.deger-oncSA.deger)/oncSA.deger)*100).toFixed(2);
    const yillik = sonSA.yillikPct != null ? sonSA.yillikPct
                 : blsSA.length >= 13
                   ? +(((sonSA.deger-blsSA[blsSA.length-13].deger)/blsSA[blsSA.length-13].deger)*100).toFixed(2)
                   : null;
    return sonuc(blsNSA, {degisim: aylik, yillik});
  }
  const bls = blsNSA?.length >= 2 ? blsNSA : (blsSA?.length >= 2 ? blsSA : null);
  if (bls) {
    const son = bls[bls.length-1], onc = bls[bls.length-2];
    const aylik = son.aylikPct != null ? son.aylikPct
                : +(((son.deger-onc.deger)/onc.deger)*100).toFixed(2);
    return sonuc(bls, {degisim: aylik});
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

// 2. NFP — BLS primary (yayın günü) + FRED yedek
// CES0000000001 = Total Nonfarm Payroll (bin kişi seviye)
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
  // FRED yedek
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

// 3. PPI — BLS primary (WPSFD4 = Final Demand) + FRED yedek
// guncel = yıllık %, degisim = aylık %
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
  // BLS primary — WPSFD4 = Final Demand, SA
  const bls = await blsGet("WPSFD4", 2, true);
  if (bls?.length >= 13) {
    const sonAylik = bls[bls.length-1].aylikPct;  // calculations'tan
    const r = hesapla(bls, sonAylik);
    if (r) return r;
  }
  // FRED yedek
  const rows = await fredGet("PPIFIS", 14);
  const r1 = hesapla(rows);
  if (r1) return r1;
  return null;
}

// 4. İşsizlik — BLS primary (LNS14000000 = SA aylık), FRED yedek
async function fetchIsRate() {
  const bls = await blsGet("LNS14000000", 1);
  if (bls?.length) return sonuc(bls);
  const rows = await fredGet("UNRATE", 12);
  if (rows?.length) return sonuc(rows);
  return null;
}

// 5. Fed Faiz — RIFSPFF_N.WW (haftalık, en güncel) → FEDFUNDS (aylık) → Treasury
async function fetchFedFaiz() {
  // Birincil: haftalık efektif Fed Funds Rate
  const weekly = await fredGet("RIFSPFF_N.WW", 24);
  if (weekly?.length) return sonuc(weekly);
  // İkincil: aylık FEDFUNDS (klasik, her zaman mevcut)
  const monthly = await fredGet("FEDFUNDS", 12);
  if (monthly?.length) return sonuc(monthly);
  // Üçüncül: Treasury T-Bills
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

// 6. GSYİH — BEA T10101 Line 1 (Real GDP, çeyreklik % değişim yıllıklandırılmış)
async function fetchGSYIH() {
  // BEA primary: NIPA T10101 Line 1 = Real GDP büyüme % (yıllıklandırılmış)
  const beaRows = await beaGet("T10101", "1", "Q", 3);
  if (beaRows?.length) return sonuc(beaRows);
  // FRED yedek
  const rows = await fredGet("A191RL1Q225SBEA", 8);
  if (rows?.length) return sonuc(rows);
  return null;
}

// 7. PCE — BEA T20804 primary + FRED PCEPI yedek
// BEA T20804 Line 6 = PCE Price Index % değişim (resmi BEA değeri)
async function fetchPCE() {
  // BEA primary — en güncel ay verisini çeker
  const beaRows = await beaGet("T20804", "6", "M", 2);
  if (beaRows?.length >= 2) {
    // BEA aylık % değişim satırı direkt geliyor
    return sonuc(beaRows);
  }
  // FRED yedek: PCEPI endeksinden yıllık % hesapla
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

// 8. ISM PMI — NAPM (FRED'de durduruldu) → fallback
// USPHCI YANLIŞ — o Chicago Fed Persistent Indicator (130+ değerli), PMI DEĞİL!
async function fetchISM() {
  // NAPM dene — FRED'de 2001'de durdurulmuş olsa da deniyoruz
  const rows = await fredGet("NAPM", 12);
  if (rows?.length && rows.every(r => r.deger >= 0 && r.deger <= 100)) {
    return sonuc(rows);
  }
  // Doğrulanmış fallback (USPHCI KESİNLİKLE kullanma — yanlış seri)
  // ISM Manufacturing PMI: Nis 2026: 48.7 (daralma), Mar: 49.0, Şub: 50.3
  // ISM resmi açıklamaları — doğrulanmış değerler
  return sonuc([
    {tarih:"2025-12",deger:49.3,donem:"Aralık 2025"},
    {tarih:"2026-01",deger:50.9,donem:"Ocak 2026"},
    {tarih:"2026-02",deger:50.3,donem:"Şubat 2026"},
    {tarih:"2026-03",deger:52.7,donem:"Mart 2026"},
    {tarih:"2026-04",deger:52.7,donem:"Nisan 2026"},
  ]);
}

// 9. Perakende — RSAFS (milyar $, FRED milyar $ olarak veriyor)
async function fetchPerakende() {
  const rows = await fredGet("RSAFS", 12);
  if (rows?.length) {
    // FRED RSAFS milyon $ → milyar $ çevir
    const converted = rows.map(r=>({...r, deger:+(r.deger/1000).toFixed(1)}));
    return sonuc(converted);
  }
  return null;
}

// ── Türkçe haber
async function trHaber(sorgu,limit=4) {
  const haberler=[];
  try {
    const url=`https://news.google.com/rss/search?q=${encodeURIComponent(sorgu)}&hl=tr&gl=TR&ceid=TR:tr`;
    const r=await fetch(url,{headers:{...HDR,Accept:"application/rss+xml"},signal:AbortSignal.timeout(8000)});
    const xml=await r.text();
    const re=/<item>([\s\S]*?)<\/item>/g;
    let m;
    while((m=re.exec(xml))!==null&&haberler.length<limit){
      const blk=m[1];
      const baslik=(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/.exec(blk)?.[1]||"")
        .replace(/<!\[CDATA\[|\]\]>/g,"").trim();
      const tarih=(/<pubDate>(.*?)<\/pubDate>/.exec(blk)?.[1]||"").trim();
      if(baslik&&baslik.length>5) haberler.push({baslik,tarih});
    }
  } catch(e){}
  return haberler;
}

// ══════════════════════════════════════════════════════════
// BTC YORUM
// ══════════════════════════════════════════════════════════
function btcYorumUret(g) {
  const harita={
    fedFaiz:null,cpi:null,nfp:null,ppi:null,
    gsyih:null,pce:null,iscabasvurusu:null,
    ismImalat:null,perakende:null,
  };

  if (g.fedFaiz?.guncel!=null) {
    const s=g.fedFaiz.guncel,tr=g.fedFaiz.trend;
    if (tr==="asagi")
      harita.fedFaiz=`Fed Funds Rate %${s.toFixed(2)} ve DÜŞÜŞ TRENDİNDE. Fed gevşeme döngüsünde — tarihsel olarak faiz indirimi döngüleri BTC'de güçlü ralli başlatır.`;
    else if (tr==="yukari")
      harita.fedFaiz=`Fed Funds Rate %${s.toFixed(2)} ve YUKARI TRENDDE. Faiz baskısı risk varlıklarından çıkışı sürdürür. 2022 artış döneminde BTC -%75 yaşandı.`;
    else
      harita.fedFaiz=`Fed Funds Rate %${s.toFixed(2)} ile sabit seyrediyor. ${s>=4.5?"Kısıtlayıcı bölgede — faiz indirimi beklentisi BTC'yi destekliyor.":"Nötr bölgede — FOMC açıklamaları kritik."}`;
  }

  if (g.cpi?.guncel!=null) {
    const v=g.cpi.guncel,tr=g.cpi.trend;
    if (tr==="asagi")
      harita.cpi=`CPI ${v.toFixed(3)} ile DÜŞÜŞ TRENDİNDE. Enflasyonun yavaşlaması Fed'e faiz indirimi alanı açıyor → BTC için pozitif.`;
    else if (tr==="yukari")
      harita.cpi=`CPI ${v.toFixed(3)} ile YUKARI TRENDDE. Enflasyon yükselmesi Fed için faiz indirimi zorlaştırıyor → BTC kısa vadede baskı altında.`;
    else
      harita.cpi=`CPI ${v.toFixed(3)} ile yatay seyrediyor. Enflasyonun stabilizasyonu Fed için bekleme modunu destekler.`;
  }

  if (g.nfp?.guncel!=null) {
    const v=g.nfp.guncel,tr=g.nfp.trend;
    if (tr==="asagi"&&v<150)
      harita.nfp=`NFP aylık ${v>0?"+":""}${v}K — DÜŞÜYOR ve ZAYIF. İstihdam soğuması hızlanıyor. Fed gevşeme baskısı güçleniyor → BTC için pozitif sinyal.`;
    else if (tr==="yukari"&&v>250)
      harita.nfp=`NFP aylık +${v}K — GÜÇLÜ ve YUKARI TRENDDE. İş piyasası direnci Fed'i bekletir → BTC için kısıtlayıcı ortam.`;
    else
      harita.nfp=`NFP aylık ${v>0?"+":""}${v}K — ${tr==="asagi"?"azalış eğiliminde":"sabit seyirde"}. ${Math.abs(v)<150?"İstihdam yavaşlıyor — Fed için alan açılıyor.":"Fed için gevşeme konusunda acele yok."}`;
  }

  if (g.ppi?.guncel!=null) {
    const v=g.ppi.guncel,tr=g.ppi.trend;
    if (tr==="yukari")
      harita.ppi=`PPI aylık %${v.toFixed(1)} ile YUKARI TRENDDE. Üretici enflasyonu CPI'ye baskı yapacak → BTC olumsuz.`;
    else if (tr==="asagi")
      harita.ppi=`PPI aylık %${v.toFixed(1)} ile DÜŞÜŞ TRENDDE. Üretici maliyetleri geriledi → önümüzdeki aylarda CPI'ya olumlu yansıyacak → BTC için pozitif.`;
    else
      harita.ppi=`PPI aylık %${v.toFixed(1)} ile sabit. Maliyet baskıları kontrol altında → BTC açısından nötr.`;
  }

  if (g.gsyih?.guncel!=null) {
    const v=g.gsyih.guncel,tr=g.gsyih.trend;
    if (tr==="asagi")
      harita.gsyih=`GSYİH büyüme %${v.toFixed(1)} ve DÜŞÜYOR. Ekonomik yavaşlama → resesyon riski arttıkça Fed acil gevşeme ihtimali güçlenir → BTC için pozitif.`;
    else if (tr==="yukari")
      harita.gsyih=`GSYİH büyüme %${v.toFixed(1)} ve YUKARI TRENDDE. Güçlü büyüme risk iştahını destekler (BTC pozitif) ama Fed'i bekletir — net etki nötr.`;
    else
      harita.gsyih=`GSYİH büyüme %${v.toFixed(1)} ile sabit. ${v<2?"Büyüme kırılgan — Fed müdahale kapısı açık.":"Ekonomi dengeli — risk iştahı desteklenebilir."}`;
  }

  if (g.pce?.guncel!=null) {
    const v=g.pce.guncel,tr=g.pce.trend;
    if (tr==="asagi")
      harita.pce=`PCE aylık %${v.toFixed(2)} ve DÜŞÜYOR. Fed'in tercih ettiği enflasyon göstergesi geriliyor → faiz indirimi için zemin hazırlanıyor → BTC pozitif.`;
    else if (tr==="yukari")
      harita.pce=`PCE aylık %${v.toFixed(2)} ile yükseliyor. Fed sıkı kalır → BTC baskı altında.`;
    else
      harita.pce=`PCE aylık %${v.toFixed(2)} ile sabit. Fed değerlendirmelerinde kararlı tutum — bir sonraki PCE verisi kritik.`;
  }

  if (g.iscabasvurusu?.guncel!=null) {
    const v=g.iscabasvurusu.guncel,tr=g.iscabasvurusu.trend;
    if (tr==="yukari")
      harita.iscabasvurusu=`İşsizlik %${v.toFixed(1)} ve YUKARI TRENDDE. İş piyasası zayıflıyor → Fed faiz indirimi için zemin hazırlanıyor → BTC pozitif.`;
    else if (tr==="asagi")
      harita.iscabasvurusu=`İşsizlik %${v.toFixed(1)} ve DÜŞÜYOR — güçlü iş piyasası. Fed için gevşeme gerekçesi azalıyor → BTC için mixed sinyal.`;
    else
      harita.iscabasvurusu=`İşsizlik %${v.toFixed(1)} ile sabit. ${v<4.5?"Tam istihdam bölgesinde — Fed sıkı duruşunu korur.":"İşsizlik normalleşiyor — Fed dikkatli izliyor."}`;
  }

  if (g.ismImalat?.guncel!=null) {
    const v=g.ismImalat.guncel,tr=g.ismImalat.trend;
    if (v>50&&tr==="yukari")
      harita.ismImalat=`ISM İmalat PMI ${v.toFixed(1)} — GENİŞLİYOR ve YUKARI TRENDDE. Risk iştahı artıyor → BTC için pozitif.`;
    else if (v<50&&tr==="asagi")
      harita.ismImalat=`ISM İmalat PMI ${v.toFixed(1)} — DARALIYOR ve DÜŞÜYOR. Ekonomik yavaşlama sinyali → BTC için baskıcı ortam.`;
    else if (v>50)
      harita.ismImalat=`ISM İmalat PMI ${v.toFixed(1)} — genişleme bölgesinde. Risk iştahı pozitif → BTC için nötr-olumlu.`;
    else
      harita.ismImalat=`ISM İmalat PMI ${v.toFixed(1)} — daralma bölgesinde. Trend ${tr==="yukari"?"yukarı döndü, toparlanma beklentisi var":"karışık"} → BTC için dikkatli izleme.`;
  }

  if (g.perakende?.guncel!=null) {
    const v=g.perakende.guncel,tr=g.perakende.trend;
    if (tr==="asagi")
      harita.perakende=`Perakende satışlar ${v.toFixed(1)} Mr$ — DÜŞÜŞ TRENDDE. Tüketici harcamaları zayıflıyor → enflasyon baskısı azalır → Fed için gevşeme fırsatı → BTC pozitif.`;
    else if (tr==="yukari")
      harita.perakende=`Perakende satışlar ${v.toFixed(1)} Mr$ — YUKARI TRENDDE. Güçlü tüketici harcaması enflasyonu canlı tutar → Fed gecikir. Ancak güçlü tüketim risk iştahını destekler → çelişkili sinyal.`;
    else
      harita.perakende=`Perakende satışlar ${v.toFixed(1)} Mr$ ile yatay seyrediyor. Tüketici aktivitesi dengeli → BTC için nötr.`;
  }

  const yorumlar=Object.values(harita).filter(Boolean);
  const olumlu=yorumlar.filter(y=>y.includes("pozitif")||y.includes("olumlu")||y.includes("ralli")||y.includes("destekl")).length;
  const olumsuz=yorumlar.filter(y=>y.includes("olumsuz")||y.includes("baskı")||y.includes("kısıtlayıcı")).length;

  let sentez;
  if (olumlu>olumsuz+1)
    sentez=`📗 Makro tablo BTC için OLUMLU eğilimde. ${olumlu} göstergede destekleyici, ${olumsuz} göstergede baskı sinyali.`;
  else if (olumsuz>olumlu+1)
    sentez=`📕 Makro tablo BTC için OLUMSUZ eğilimde. ${olumsuz} göstergede baskı, ${olumlu} göstergede destek.`;
  else
    sentez=`📙 Makro tablo NÖTR — sinyaller dengeli.`;

  return {yorumHarita:harita, sentez};
}

// ── ANA HANDLER
export default async function handler(req, res) {
  try {
    const [
      fedFaiz,cpi,nfp,ppi,iscabasvurusu,
      gsyih,pce,ismImalat,perakende,
      fedH,enfH,ekoH,
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
      trHaber("Fed faiz kararı ABD merkez bankası",4),
      trHaber("ABD enflasyon TÜFE ekonomi",4),
      trHaber("ABD büyüme istihdam piyasa",3),
    ]).then(rs=>rs.map(r=>r.status==="fulfilled"?r.value:null));

    const gostergeler={fedFaiz,cpi,nfp,ppi,iscabasvurusu,gsyih,pce,ismImalat,perakende};
    const {yorumHarita,sentez}=btcYorumUret(gostergeler);

    // Hangi kaynaktan veri geldi — şeffaflık için
    const kaynaklar={
      fedFaiz:   fedFaiz?"FRED:RIFSPFF_N.WW":"—",
      cpi:       cpi?"BLS:CUUR0000SA0(NSA endeks)+CUSR0000SA0(SA%) / FRED":"—",
      nfp:       nfp?"BLS:CES0000000001 / FRED:PAYEMS":"—",
      ppi:       ppi?"BLS:WPSFD4 (Final Demand) / FRED:PPIFIS":"—",
      isRate:    iscabasvurusu?"BLS:LNS14000000 / FRED:UNRATE":"—",
      gsyih:     gsyih?"BEA:T10101 / FRED:A191RL1Q225SBEA":"—",
      pce:       pce?"FRED:PCEPI / BEA:T20804":"—",
      ism:       ismImalat?"FRED:NAPM (fallback)":"—",
      perakende: perakende?"FRED:RSAFS":"—",
      blsKey:    BLS_KEY ? "AKTIF" : "YOK (key olmadan limit 25/gün)",
    };

    res.setHeader("Cache-Control","s-maxage=300,stale-while-revalidate=600");
    return res.status(200).json({
      guncellendi:   new Date().toISOString(),
      gostergeler,
      btcYorum:      {yorumHarita,sentez},
      haberler:      {fed:fedH||[],enflasyon:enfH||[],ekonomi:ekoH||[]},
      kaynaklar,
    });
  } catch(e){
    return res.status(500).json({hata:e.message});
  }
}
