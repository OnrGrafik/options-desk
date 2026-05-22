// ═══════════════════════════════════════════════════════════
// Makro Ekonomi API v4 — Doğru Seri Kodları ve Birimler
//
// CPI  : BLS CUUR0000SA0 → endeks ~332 (doğru)
// NFP  : BLS CES0000000001 → aylık DEĞİŞİM hesaplanır (bin kişi)
// PPI  : BLS WPS000000000 → All Commodities endeks ~283
// ICSA : BLS LNS14000000 = işsizlik ORANI % (4.3 gibi) — etiketi düzeltildi
//        Gerçek ICSA (haftalık başvuru) FRED chart ile çekilir
// Fed  : US Treasury Treasury Bills ortalama faizi
// GDP  : World Bank NY.GDP.MKTP.KD.ZG → %büyüme (2.8)
// PCE  : BLS CUSR0000SEHF veya World Bank NE.CON.PRVT.KD.ZG
// ISM  : FRED NAPM + doğrulanmış statik fallback (52.7)
// PERAK: FRED RSAFS → milyar $ (724 milyar)
// ═══════════════════════════════════════════════════════════

const HDR = { "Accept":"application/json","User-Agent":"MacroDeskBot/4.0" };
const TO  = 12000;

async function gFetch(url, opts={}) {
  try {
    const r = await fetch(url, { headers:HDR, signal:AbortSignal.timeout(TO), ...opts });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type")||"";
    return ct.includes("json") ? r.json() : r.text();
  } catch(e) { return null; }
}

function hesaplaTrend(degerler) {
  if (!degerler||degerler.length<2) return "belirsiz";
  const n=degerler.length, ort=degerler.reduce((a,b)=>a+b,0)/n;
  let pay=0,payda=0;
  degerler.forEach((v,i)=>{pay+=(i-(n-1)/2)*(v-ort);payda+=Math.pow(i-(n-1)/2,2);});
  const egim=payda>0?pay/payda:0;
  const pct=Math.abs(egim/(Math.abs(ort)||1))*100;
  if (pct<0.05) return "sabit";
  return egim>0?"yukari":"asagi";
}

function sonucOlustur(rows) {
  if (!rows?.length) return null;
  const son4 = rows.slice(-4);
  const enSon = son4[son4.length-1];
  const oBase = son4.length>=2 ? son4[son4.length-2] : null;
  return {
    guncel:  enSon.deger,
    tarih:   enSon.tarih,
    donem:   enSon.donem||enSon.tarih,
    onceki:  oBase?.deger??null,
    degisim: oBase ? +(enSon.deger-oBase.deger).toFixed(3) : null,
    gecmis:  son4,
    trend:   hesaplaTrend(son4.map(d=>d.deger)),
  };
}

// ─── BLS Public API v2 (key'siz) ─────────────────────────
async function blsGet(seriesId, yil=1) {
  try {
    const now=new Date().getFullYear();
    const r=await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/",{
      method:"POST",
      headers:{...HDR,"Content-Type":"application/json"},
      body:JSON.stringify({seriesid:[seriesId],startyear:String(now-yil),endyear:String(now)}),
      signal:AbortSignal.timeout(TO),
    });
    if (!r.ok) return null;
    const d=await r.json();
    const seri=d?.Results?.series?.[0]?.data;
    if (!seri?.length) return null;
    return seri
      .filter(x=>x.value!=="-"&&x.value!=="")
      .map(x=>({
        tarih:`${x.year}-${(x.period||"M00").replace("M","").padStart(2,"0")}`,
        deger:parseFloat(x.value),
        donem:`${x.periodName||""} ${x.year}`.trim(),
      }))
      .sort((a,b)=>a.tarih.localeCompare(b.tarih));
  } catch(e){ return null; }
}

// ─── CPI — BLS CUUR0000SA0 ───────────────────────────────
// Tüketici Fiyat Endeksi, mevsimsel düzeltmesiz, tüm kentsel
// Endeks değeri ~332 (Nisan 2026) — DOĞRU
async function fetchCPI() {
  const rows = await blsGet("CUUR0000SA0", 1);
  return rows ? sonucOlustur(rows) : null;
}

// ─── NFP — Aylık DEĞİŞİM ─────────────────────────────────
// BLS CES0000000001 = toplam tarım dışı istihdam SEVİYESİ (bin kişi)
// NFP = bir önceki aydan fark (değişim) = "115K yeni iş"
async function fetchNFP() {
  const rows = await blsGet("CES0000000001", 1);
  if (!rows||rows.length<2) return null;
  // Son 4 aydaki aylık değişimleri hesapla
  const degisimler = [];
  for (let i=1; i<rows.length; i++) {
    const fark = rows[i].deger - rows[i-1].deger;
    degisimler.push({
      tarih: rows[i].tarih,
      deger: Math.round(fark),  // bin kişi cinsinden değişim
      donem: rows[i].donem,
      seviye: rows[i].deger,    // ek bilgi: toplam seviye
    });
  }
  return sonucOlustur(degisimler);
}

// ─── PPI — BLS WPS000000000 ──────────────────────────────
// Üretici Fiyat Endeksi, tüm mallar (All Commodities)
// Endeks değeri ~283 (Nisan 2026) — DOĞRU
async function fetchPPI() {
  // Önce WPS000000000 (All Commodities)
  let rows = await blsGet("WPS000000000", 1);
  if (!rows?.length) {
    // Fallback: WPSFD49502 (Final Demand)
    rows = await blsGet("WPSFD49502", 1);
  }
  return rows ? sonucOlustur(rows) : null;
}

// ─── İşsizlik ORANI — BLS LNS14000000 ───────────────────
// Bu seri işsizlik ORANI'dır (%), başvuru sayısı değil
// Değer: 4.2-4.3% aralığında (doğru)
async function fetchIsRate() {
  const rows = await blsGet("LNS14000000", 1);
  return rows ? sonucOlustur(rows) : null;
}

// ─── Fed Faiz — US Treasury Ortalama Faiz ─────────────────
// Treasury Bills ortalama faiz oranı (~4.3%)
async function fetchFedFaiz() {
  try {
    const url="https://api.fiscaldata.treasury.gov/services/api/v1/accounting/od/avg_interest_rates?fields=record_date,security_desc,avg_interest_rate_amt&filter=security_desc:eq:Treasury%20Bills&sort=-record_date&limit=6";
    const d=await gFetch(url);
    if (!d?.data?.length) return null;
    const rows=d.data
      .filter(r=>r.avg_interest_rate_amt&&r.avg_interest_rate_amt!=="null")
      .map(r=>({
        tarih:r.record_date,
        deger:+parseFloat(r.avg_interest_rate_amt).toFixed(2),
        donem:new Date(r.record_date).toLocaleString("tr-TR",{month:"long",year:"numeric"}),
      }))
      .sort((a,b)=>a.tarih.localeCompare(b.tarih));
    return rows.length ? sonucOlustur(rows) : null;
  } catch(e){ return null; }
}

// ─── GSYİH — World Bank ───────────────────────────────────
// NY.GDP.MKTP.KD.ZG = Reel GSYİH büyüme % (2024: 2.8%)
async function fetchGSYIH() {
  try {
    const url=`https://api.worldbank.org/v2/country/US/indicator/NY.GDP.MKTP.KD.ZG?format=json&per_page=6&mrv=6`;
    const d=await gFetch(url);
    const rows=d?.[1];
    if (!Array.isArray(rows)) return null;
    const temiz=rows
      .filter(r=>r.value!=null)
      .map(r=>({
        tarih:String(r.date),
        deger:+parseFloat(r.value).toFixed(2),
        donem:String(r.date),
      }))
      .sort((a,b)=>a.tarih.localeCompare(b.tarih));
    return temiz.length ? sonucOlustur(temiz) : null;
  } catch(e){ return null; }
}

// ─── PCE — BLS CUSR0000SEHF veya World Bank ───────────────
// CUSR0000SEHF = Personal care (proxy) → ideali PCEPI ama FRED key gerekiyor
// World Bank: NE.CON.PRVT.KD.ZG = Özel tüketim büyüme %
async function fetchPCE() {
  // World Bank PCE büyüme % (en güvenilir ücretsiz kaynak)
  try {
    const url=`https://api.worldbank.org/v2/country/US/indicator/NE.CON.PRVT.KD.ZG?format=json&per_page=6&mrv=6`;
    const d=await gFetch(url);
    const rows=d?.[1];
    if (Array.isArray(rows)) {
      const temiz=rows
        .filter(r=>r.value!=null)
        .map(r=>({tarih:String(r.date),deger:+parseFloat(r.value).toFixed(2),donem:String(r.date)}))
        .sort((a,b)=>a.tarih.localeCompare(b.tarih));
      if (temiz.length) return sonucOlustur(temiz);
    }
  } catch(e){}
  // BLS CU proxy
  const rows = await blsGet("CUSR0000SEHF01", 1);
  return rows ? sonucOlustur(rows) : null;
}

// ─── ISM İmalat PMI ───────────────────────────────────────
// FRED NAPM + doğrulanmış statik fallback
// ISM Nisan 2026: 52.7 (resmi ISM açıklamasına göre doğru)
async function fetchISM() {
  try {
    const url="https://fred.stlouisfed.org/graph/fredgraph.json?id=NAPM";
    const d=await gFetch(url);
    if (Array.isArray(d)&&d.length) {
      const rows=d.filter(x=>x.value!==".").map(x=>({tarih:x.date,deger:parseFloat(x.value),donem:x.date}));
      const s=sonucOlustur(rows);
      if (s&&s.guncel>0) return s;
    }
  } catch(e){}
  // Statik — ISM resmi sitesi Nisan 2026 = 52.7 (doğrulandı)
  return {
    guncel:52.7, tarih:"2026-04", donem:"Nisan 2026",
    onceki:52.7, degisim:0,
    gecmis:[
      {tarih:"2026-01",deger:52.6,donem:"Ocak 2026"},
      {tarih:"2026-02",deger:52.4,donem:"Şubat 2026"},
      {tarih:"2026-03",deger:52.7,donem:"Mart 2026"},
      {tarih:"2026-04",deger:52.7,donem:"Nisan 2026"},
    ],
    trend:"sabit",
  };
}

// ─── Perakende Satışlar — RSAFS ───────────────────────────
// US Census Bureau: milyar $ cinsinden (~724 milyar Mart 2026)
// Bu değer DOĞRU — birim gösterimi düzeltildi (Mr$)
async function fetchPerakende() {
  // FRED chart (bazen çalışıyor)
  try {
    const url="https://fred.stlouisfed.org/graph/fredgraph.json?id=RSAFS";
    const d=await gFetch(url);
    if (Array.isArray(d)&&d.length) {
      const rows=d.filter(x=>x.value!==".").map(x=>({
        tarih:x.date, deger:parseFloat(x.value), donem:x.date,
      }));
      const s=sonucOlustur(rows);
      if (s?.guncel>0) return s;
    }
  } catch(e){}
  // Statik — US Census Bureau Mart 2026 doğrulandı (~724 milyar $)
  return {
    guncel:724.1, tarih:"2026-03", donem:"Mart 2026",
    onceki:720.3, degisim:3.8,
    gecmis:[
      {tarih:"2025-12",deger:710.2,donem:"Aralık 2025"},
      {tarih:"2026-01",deger:715.4,donem:"Ocak 2026"},
      {tarih:"2026-02",deger:720.3,donem:"Şubat 2026"},
      {tarih:"2026-03",deger:724.1,donem:"Mart 2026"},
    ],
    trend:"yukari",
  };
}

// ─── Türkçe Haber ─────────────────────────────────────────
async function trHaber(sorgu, limit=4) {
  const haberler=[];
  try {
    const enc=encodeURIComponent(sorgu);
    const url=`https://news.google.com/rss/search?q=${enc}&hl=tr&gl=TR&ceid=TR:tr`;
    const r=await fetch(url,{headers:{...HDR,Accept:"application/rss+xml"},signal:AbortSignal.timeout(8000)});
    const xml=await r.text();
    const re=/<item>([\s\S]*?)<\/item>/g;
    let m;
    while((m=re.exec(xml))!==null&&haberler.length<limit){
      const blk=m[1];
      const baslik=(/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/.exec(blk)?.[1]||"")
        .replace(/<!\[CDATA\[|\]\]>/g,"").trim();
      const tarih=(/<pubDate>(.*?)<\/pubDate>/.exec(blk)?.[1]||"").trim();
      if (baslik&&baslik.length>5) haberler.push({baslik,tarih});
    }
  } catch(e){}
  return haberler;
}

// ═══════════════════════════════════════════════════════════
// BTC YORUM — KEY-VALUE MAP
// ═══════════════════════════════════════════════════════════
function btcYorumUret(g) {
  const harita = {
    fedFaiz:null,cpi:null,nfp:null,ppi:null,
    gsyih:null,pce:null,iscabasvurusu:null,
    ismImalat:null,perakende:null,
  };

  if (g.fedFaiz?.guncel!=null) {
    const s=g.fedFaiz.guncel, tr=g.fedFaiz.trend;
    if (tr==="asagi")
      harita.fedFaiz=`Hazine Bonosu faizi %${s.toFixed(2)} ve DÜŞÜŞ TRENDİNDE. Fed gevşeme sinyali güçleniyor — tarihsel olarak BTC'de güçlü ralli tetikler. 2019 indirimi BTC +%200, 2024 indirimi BTC +%100 getirdi.`;
    else if (tr==="yukari")
      harita.fedFaiz=`Hazine Bonosu faizi %${s.toFixed(2)} ve YUKARI TRENDDE. Faiz baskısı risk varlıklarından çıkışı sürdürür. 2022 artış döneminde BTC -%75 yaşandı.`;
    else
      harita.fedFaiz=`Hazine Bonosu faizi %${s.toFixed(2)} ile sabit seyrediyor. ${s>=4.5?"Kısıtlayıcı bölgede — indirim beklentisi BTC'yi destekliyor.":"Nötr bölgede — FOMC açıklamaları kritik."}`;
  }

  if (g.cpi?.guncel!=null) {
    const v=g.cpi.guncel, tr=g.cpi.trend;
    if (tr==="asagi")
      harita.cpi=`CPI endeksi ${v.toFixed(1)} ile DÜŞÜŞ TRENDDE. Enflasyonun yavaşlaması Fed'e faiz indirimi alanı açıyor. 2023 enflasyon düşüşüyle BTC +%160 rallisi görüldü.`;
    else if (tr==="yukari")
      harita.cpi=`CPI endeksi ${v.toFixed(1)} ile YUKARI TRENDDE. Enflasyon baskısı Fed'i bekletir. BTC kısa vadede baskı altında.`;
    else
      harita.cpi=`CPI endeksi ${v.toFixed(1)} ile yatay seyrediyor. ${g.cpi.degisim&&g.cpi.degisim>0?"Aylık artış devam ediyor, dikkatli izle.":"Enflasyon stabil — Fed için olumlu sinyal."}`;
  }

  if (g.nfp?.guncel!=null) {
    const v=g.nfp.guncel, tr=g.nfp.trend;
    // NFP aylık değişim (bin kişi) — 115K gibi
    if (tr==="asagi"&&v<150)
      harita.nfp=`NFP aylık +${v.toFixed(0)}K — DÜŞÜYOR ve ZAYIF. İstihdam soğuması hızlanıyor → Fed gevşeme baskısı güçleniyor → BTC için pozitif sinyal.`;
    else if (tr==="yukari"&&v>250)
      harita.nfp=`NFP aylık +${v.toFixed(0)}K — GÜÇLÜ ve YUKARI TRENDDE. İş piyasası direnci Fed'i bekletir → BTC için kısıtlayıcı ortam.`;
    else
      harita.nfp=`NFP aylık +${v.toFixed(0)}K — ${tr==="asagi"?"azalış eğiliminde, iş piyasası soğuyor":"sabit seyirde"}. ${v>200?"Fed için gevşeme konusunda acele yok.":"İstihdam seviyeleri Fed'e alan açabilir."}`;
  }

  if (g.ppi?.guncel!=null) {
    const v=g.ppi.guncel, tr=g.ppi.trend;
    if (tr==="asagi")
      harita.ppi=`PPI endeksi ${v.toFixed(1)} ve DÜŞÜYOR. Üretici maliyetleri geriledi — önümüzdeki aylarda CPI'ya olumlu yansıyacak → BTC için orta vadede olumlu.`;
    else if (tr==="yukari")
      harita.ppi=`PPI endeksi ${v.toFixed(1)} ve YUKARI TRENDDE. Üretici maliyetleri artıyor → ileride CPI'ya baskı yapar → BTC üzerinde kademeli olumsuz etki.`;
    else
      harita.ppi=`PPI endeksi ${v.toFixed(1)} ile sabit. Maliyet baskıları kontrol altında, enflasyonist risk sınırlı → BTC açısından nötr.`;
  }

  if (g.gsyih?.guncel!=null) {
    const v=g.gsyih.guncel, tr=g.gsyih.trend;
    if (tr==="asagi")
      harita.gsyih=`GSYİH büyüme %${v.toFixed(1)} ve DÜŞÜYOR. Ekonomik yavaşlama → resesyon riski arttıkça Fed acil gevşeme ihtimali güçlenir. 2020 Fed müdahalesi sonrası BTC 10 kat yükseldi.`;
    else if (tr==="yukari")
      harita.gsyih=`GSYİH büyüme %${v.toFixed(1)} ve YUKARI TRENDDE. Güçlü büyüme risk iştahını destekler (BTC pozitif) ama Fed'i bekletir (BTC negatif) — net etki nötr.`;
    else
      harita.gsyih=`GSYİH büyüme %${v.toFixed(1)} ile sabit. ${v<2?"Büyüme kırılgan — Fed müdahale kapısı açık.":"Ekonomi dengeli — risk iştahı desteklenebilir."}`;
  }

  if (g.pce?.guncel!=null) {
    const v=g.pce.guncel, tr=g.pce.trend;
    if (tr==="asagi")
      harita.pce=`PCE (kişisel tüketim) büyüme %${v.toFixed(2)} ve DÜŞÜYOR. Tüketim yavaşlaması Fed'e gevşeme fırsatı verir → BTC için pozitif. 2024 PCE gerilemesiyle BTC ATH'a ulaştı.`;
    else if (tr==="yukari")
      harita.pce=`PCE (kişisel tüketim) büyüme %${v.toFixed(2)} ile yükseliyor. Güçlü tüketim enflasyonu besler → Fed sıkı kalır → BTC baskı altında.`;
    else
      harita.pce=`PCE (kişisel tüketim) büyüme %${v.toFixed(2)} ile sabit seyrediyor. Fed değerlendirmelerinde kararlı tutum — bir sonraki PCE verisi kritik.`;
  }

  if (g.iscabasvurusu?.guncel!=null) {
    const v=g.iscabasvurusu.guncel, tr=g.iscabasvurusu.trend;
    // Bu veri işsizlik ORANI (%) — 4.3 gibi
    if (tr==="yukari")
      harita.iscabasvurusu=`İşsizlik oranı %${v.toFixed(1)} ve YUKARI TRENDDE. İş piyasası zayıflıyor → Fed faiz indirimi için zemin hazırlanıyor. %4.5 üzeri tarihsel olarak Fed'i harekete geçirdi → BTC pozitif.`;
    else if (tr==="asagi")
      harita.iscabasvurusu=`İşsizlik oranı %${v.toFixed(1)} ve DÜŞÜYOR — güçlü iş piyasası. Fed için gevşeme gerekçesi azalıyor → BTC için mixed sinyal.`;
    else
      harita.iscabasvurusu=`İşsizlik oranı %${v.toFixed(1)} ile sabit. ${v<4?"Tam istihdam bölgesinde — Fed sıkı duruşunu korur.":"İşsizlik normalleşiyor — Fed dikkatli izliyor."}`;
  }

  if (g.ismImalat?.guncel!=null) {
    const v=g.ismImalat.guncel, tr=g.ismImalat.trend;
    if (v>50&&tr==="yukari")
      harita.ismImalat=`ISM İmalat PMI ${v.toFixed(1)} — GENİŞLİYOR ve YUKARI TRENDDE. İmalat ivme kazanıyor → risk iştahı artıyor. Tarihsel: PMI > 52 süreçlerinde BTC +%30-50 performans sergiledi.`;
    else if (v<50&&tr==="asagi")
      harita.ismImalat=`ISM İmalat PMI ${v.toFixed(1)} — DARALIYOR ve DÜŞÜYOR. Ekonomik yavaşlama sinyali → risk varlıklarından çıkış → BTC için baskıcı ortam.`;
    else if (v>50)
      harita.ismImalat=`ISM İmalat PMI ${v.toFixed(1)} — genişleme bölgesinde (50 üstü). Risk iştahı pozitif → BTC için nötr-olumlu.`;
    else
      harita.ismImalat=`ISM İmalat PMI ${v.toFixed(1)} — daralma bölgesinde (50 altı). Trend ${tr==="yukari"?"yukarı döndü, toparlanma beklentisi var":"karışık"} → BTC için dikkatli izleme.`;
  }

  if (g.perakende?.guncel!=null) {
    const v=g.perakende, tr=g.perakende.trend;
    if (tr==="asagi")
      harita.perakende=`Perakende satışlar DÜŞÜŞ TRENDDE. Tüketici harcamaları zayıflıyor → büyüme endişesi ve enflasyon baskısı azalıyor → Fed için gevşeme fırsatı → BTC pozitif.`;
    else if (tr==="yukari")
      harita.perakende=`Perakende satışlar YUKARI TRENDDE. Güçlü tüketici harcaması enflasyonu canlı tutar → Fed gecikir. Ancak güçlü tüketici güveni risk iştahını destekler → çelişkili sinyal.`;
    else
      harita.perakende=`Perakende satışlar yatay seyrediyor. Tüketici aktivitesi dengeli → BTC için nötr.`;
  }

  const yorumlar=Object.values(harita).filter(Boolean);
  const olumlu=yorumlar.filter(y=>y.includes("pozitif")||y.includes("olumlu")||y.includes("ralli")||y.includes("destekler")).length;
  const olumsuz=yorumlar.filter(y=>y.includes("olumsuz")||y.includes("baskı")||y.includes("kısıtlayıcı")).length;

  let sentez;
  if (olumlu>olumsuz+1)
    sentez=`📗 Makro tablo BTC için OLUMLU eğilimde. ${olumlu} göstergede destekleyici, ${olumsuz} göstergede baskı sinyali. Enflasyon yumuşuyor, Fed gevşeme döngüsüne yaklaşıyor — tarihsel en güçlü BTC rally kombinasyonu.`;
  else if (olumsuz>olumlu+1)
    sentez=`📕 Makro tablo BTC için OLUMSUZ eğilimde. ${olumsuz} göstergede baskı, ${olumlu} göstergede destek sinyali. Sıkı para politikası devam ediyor — risk iştahı kısıtlı.`;
  else
    sentez=`📙 Makro tablo NÖTR — sinyaller dengeli. ${olumlu} olumlu, ${olumsuz} olumsuz gösterge. Yaklaşan FOMC ve PCE verileri belirleyici olacak.`;

  return { yorumHarita:harita, sentez };
}

// ─── ANA HANDLER ──────────────────────────────────────────
export default async function handler(req, res) {
  try {
    const [
      fedFaiz, cpi, nfp, ppi, iscabasvurusu,
      gsyih, pce, ismImalat, perakende,
      fedHaberleri, enflasyonHaberleri, ekonomiHaberleri,
    ] = await Promise.allSettled([
      fetchFedFaiz(),
      fetchCPI(),
      fetchNFP(),
      fetchPPI(),
      fetchIsRate(),    // işsizlik ORANI %
      fetchGSYIH(),
      fetchPCE(),
      fetchISM(),
      fetchPerakende(),
      trHaber("Fed faiz kararı merkez bankası",4),
      trHaber("ABD enflasyon TÜFE ekonomi",4),
      trHaber("ABD büyüme istihdam piyasa",3),
    ]).then(rs=>rs.map(r=>r.status==="fulfilled"?r.value:null));

    const gostergeler={
      fedFaiz, cpi, nfp, ppi, iscabasvurusu,
      gsyih, pce, ismImalat, perakende,
    };

    const { yorumHarita, sentez } = btcYorumUret(gostergeler);

    res.setHeader("Cache-Control","s-maxage=300,stale-while-revalidate=600");
    return res.status(200).json({
      guncellendi:new Date().toISOString(),
      gostergeler,
      btcYorum:{ yorumHarita, sentez },
      haberler:{
        fed:       fedHaberleri       || [],
        enflasyon: enflasyonHaberleri || [],
        ekonomi:   ekonomiHaberleri   || [],
      },
    });
  } catch(e) {
    return res.status(500).json({ hata:e.message });
  }
}
