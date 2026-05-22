import React, { useState, useEffect, useRef, useCallback, Fragment } from "react";
import Head from "next/head";
import {
  ASSETS,
  fetchSpot, fetchWatchlist, fetchTicker24h, fetchFunding, fetchBasis,
  fetchDeribitInstruments, fetchAllOptions,
  aggregateByStrike, findLevels, classifyStrikes, calcVolSurface,
} from "../lib/gex";

// ─── Yardımcılar ──────────────────────────────────────────
const fmt  = n => (n!=null&&n!==0)?Math.round(n).toLocaleString("tr-TR"):"—";
const fmtB = n => { if(n==null)return"—"; const a=Math.abs(n); if(a>=1e9)return`${(n/1e9).toFixed(2)}Mr`; if(a>=1e6)return`${(n/1e6).toFixed(1)}M`; if(a>=1e3)return`${(n/1e3).toFixed(0)}K`; return n.toFixed(0); };
const fmtM = n => { if(n==null)return"—"; const a=Math.abs(n); if(a>=1e9)return`${(n/1e9).toFixed(3)}Mr$`; if(a>=1e6)return`${(n/1e6).toFixed(2)}M$`; if(a>=1e3)return`${(n/1e3).toFixed(1)}K$`; return`${n.toFixed(0)}$`; };

// ═══════════════════════════════════════════════════════════
// GLOBAL CACHE
// ═══════════════════════════════════════════════════════════
const CACHE = {};
const CACHE_TTL = 5 * 60 * 1000;
const EMPTY_RAW = {
  spot:0, allOptions:[], ticker24h:{open:0,high:0,low:0,change:0,volume:0},
  funding:0, basis:0, dvol:50,
  loading:true, error:null, progress:"", lastUpdate:null,
  stats:{rows:0,totalInst:0,expiries:0},
};
const dinleyiciler = {};
const yukleniyor   = {};

function bildir(sym) {
  (dinleyiciler[sym]||new Set()).forEach(cb=>cb());
}

async function varlikYukle(sym, zorla=false) {
  if (!zorla && CACHE[sym] && (Date.now()-CACHE[sym].loadedAt)<CACHE_TTL) { bildir(sym); return; }
  if (yukleniyor[sym]) return;
  yukleniyor[sym] = true;
  if (!CACHE[sym]) CACHE[sym]={raw:{...EMPTY_RAW,loading:true,progress:"Spot fiyat alınıyor..."},loadedAt:0};
  else CACHE[sym].raw={...CACHE[sym].raw,loading:false};
  bildir(sym);
  try {
    const ilerlemeGuncelle = p => { if(CACHE[sym]) { CACHE[sym].raw={...CACHE[sym].raw,progress:p}; bildir(sym); } };
    ilerlemeGuncelle("Spot fiyat alınıyor...");
    const [spot,ticker24h,funding,basis] = await Promise.allSettled([
      fetchSpot(sym),fetchTicker24h(sym),fetchFunding(sym),fetchBasis(sym),
    ]).then(rs=>rs.map(r=>r.status==="fulfilled"?r.value:null));
    CACHE[sym].raw={...CACHE[sym].raw,spot:spot||0,ticker24h:ticker24h||EMPTY_RAW.ticker24h,funding:funding||0,basis:basis||0};
    ilerlemeGuncelle(`${sym} opsiyon zinciri çekiliyor...`);
    const enstrumanlar = await fetchDeribitInstruments(sym);
    if (!enstrumanlar.length) throw new Error(`${sym} opsiyon verisi alınamadı`);
    const {options,stats} = await fetchAllOptions(enstrumanlar,spot||0,sym,(pct,rows,exps)=>{
      ilerlemeGuncelle(`${sym} analiz: %${pct} · ${rows} opsiyon · ${exps} vade`);
    });
    const atmOpt=options.filter(o=>o.type==="call").sort((a,b)=>Math.abs(a.strike-spot)-Math.abs(b.strike-spot))[0];
    CACHE[sym].raw={
      spot:spot||0,allOptions:options,ticker24h:ticker24h||EMPTY_RAW.ticker24h,
      funding:funding||0,basis:basis||0,stats,
      dvol:atmOpt?atmOpt.iv*100:50,
      loading:false,error:null,progress:"",lastUpdate:new Date(),
    };
    CACHE[sym].loadedAt=Date.now();
  } catch(e) {
    if(CACHE[sym]) CACHE[sym].raw={...CACHE[sym].raw,loading:false,error:e.message,progress:""};
  }
  yukleniyor[sym]=false;
  bildir(sym);
}

const yenilemeZamanlayici = {};
function otomatikYenilemeBaslat(sym) {
  if (yenilemeZamanlayici[sym]) return;
  yenilemeZamanlayici[sym]=setInterval(()=>varlikYukle(sym,true),CACHE_TTL);
}

function varlikVerisiKullan(sym, vadeFiltresi) {
  const [,zorlaGuncelle]=useState(0);
  useEffect(()=>{
    if (!dinleyiciler[sym]) dinleyiciler[sym]=new Set();
    const cb=()=>zorlaGuncelle(n=>n+1);
    dinleyiciler[sym].add(cb);
    if (!CACHE[sym]||!CACHE[sym].raw.allOptions.length) varlikYukle(sym);
    else { zorlaGuncelle(n=>n+1); if(Date.now()-(CACHE[sym].loadedAt||0)>CACHE_TTL) varlikYukle(sym,true); }
    otomatikYenilemeBaslat(sym);
    return()=>{ dinleyiciler[sym]?.delete(cb); };
  },[sym]);
  const raw=CACHE[sym]?.raw||{...EMPTY_RAW};
  const strikes    = aggregateByStrike(raw.allOptions,vadeFiltresi);
  const levels     = findLevels(strikes,raw.spot,raw.allOptions);
  const classified = classifyStrikes(strikes,raw.spot);
  const volSurface = calcVolSurface(raw.allOptions,raw.spot);
  const toplamlar  = {
    gamma:strikes.reduce((a,x)=>a+x.netGex,0),
    vanna:strikes.reduce((a,x)=>a+x.vannaNet,0),
    charm:strikes.reduce((a,x)=>a+x.charmNet,0),
  };
  return {...raw,strikes,levels,classified,toplamlar,volSurface,yenile:()=>varlikYukle(sym,true)};
}

function digerAssetPrefetch(aktifSym) {
  Object.keys(ASSETS).filter(s=>s!==aktifSym).forEach(sym=>{
    if (!CACHE[sym]||!CACHE[sym].raw.allOptions.length) setTimeout(()=>varlikYukle(sym),3000);
  });
}

// ─── Hull Yorumu ──────────────────────────────────────────
function hullYorumUret(data, sym) {
  const {spot,levels,toplamlar,volSurface,dvol}=data;
  if (!spot||!levels.callWall) return null;
  const {callWall,putWall,maxPain,zeroGamma,emHigh,emLow}=levels;
  const cw=callWall||0,pw=putWall||0,band=cw-pw;
  const cwUzaklik=(((cw-spot)/spot)*100).toFixed(1);
  const pwUzaklik=(((spot-pw)/spot)*100).toFixed(1);
  const mpUzaklik=maxPain?(((maxPain-spot)/spot)*100).toFixed(1):null;
  const pozitif=toplamlar.gamma>=0;
  const ts=volSurface?.termStructure||[],rr=volSurface?.riskReversals||[];
  const kisaIV=ts.find(p=>p.days<=14)?.iv?.toFixed(0);
  const uzunIV=ts.find(p=>p.days>=60)?.iv?.toFixed(0);
  const egim=ts.length>=2?(ts[ts.length-1].iv>ts[0].iv?"contango":"backwardation"):null;
  const onRR=rr.find(r=>r.days<=14);
  const putBias=onRR?.rr>0, rrDeger=onRR?.rr?.toFixed(1);
  const bandPct=((band/spot)*100).toFixed(1);
  const rejim=pozitif
    ?`Hull (Bölüm 19.6): Dealer net long gamma — piyasa yapıcılar ${sym} fiyat yükseldikçe satıyor, düştükçe alıyor. Mean-reversion akışı volatiliteyi baskılar. Spot ${fmt(cw)} Call Wall'una yaklaştıkça delta hedging baskısı artar.`
    :`Hull (Bölüm 19.6): Dealer net short gamma — piyasa yapıcılar trendle aynı yönde işlem yapıyor. Momentum etkisi volatiliteyi artırır. Zero Gamma ${fmt(zeroGamma)} seviyesinin üstüne çıkış kritik.`;
  const mpYorum=mpUzaklik?`Hull (Bölüm 19.5): Spot, Max Pain ${fmt(maxPain)} seviyesinin %${Math.abs(parseFloat(mpUzaklik)).toFixed(1)} ${parseFloat(mpUzaklik)>0?"üstünde":"altında"}. Charm etkisiyle (∂Δ/∂t) pin baskısı ${fmt(maxPain)}'e doğru güçlenir.`:"";
  const vannaYorum=toplamlar.vanna!==0?`Hull (Bölüm 19.8): Vanna ${fmtM(toplamlar.vanna)} — IV değişiminin delta üzerindeki etkisi ${toplamlar.vanna>0?"spot ile aynı yönde":"spot'a karşı"}. ${dvol.toFixed(0)}% IV seviyesinde ${toplamlar.vanna>0?"yükseliş":"düşüş"} baskısı vanna flow'unu güçlendirir.`:"";
  const volYorum=egim&&kisaIV&&uzunIV?`Hull (Bölüm 20.5): IV term structure ${egim==="contango"?"normal eğimli (contango)":"ters (backwardation)"}; kısa vade ${kisaIV}%, uzun vade ${uzunIV}%.${rrDeger?(putBias?` 25Δ RR +${rrDeger} vol (put bias) — piyasa aşağı hareket için prim ödüyor.`:` 25Δ RR ${rrDeger} vol (call bias) — piyasa yukarı hareket için prim ödüyor.`):""}`:""  ;
  const emYorum=emHigh&&emLow?`Hull (Bölüm 15.7): 1σ Beklenen Hareket ${fmt(emLow)}–${fmt(emHigh)} (±%${((emHigh-emLow)/2/spot*100).toFixed(1)}). ${bandPct}% GEX bandı EM bandını ${parseFloat(bandPct)<parseFloat(((emHigh-emLow)/spot*100).toFixed(1))*0.5?"destekler — volatilite sıkışma riski var":"aşıyor — bant kırılması halinde hızlı hareket olası"}.`:"";
  return{rejim,mpYorum,vannaYorum,volYorum,emYorum,pozitif,netGexStr:fmtM(toplamlar.gamma),cw,pw,band,cwUzaklik,pwUzaklik};
}

// ─── KENAR ÇUBUĞU ─────────────────────────────────────────
function KenarCubugu({ izleme, aktifSekme, setAktifSekme, vade, setVade }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">œ</div>
        <div>
          <div className="brand-name">Opsiyon Masası</div>
          <div className="brand-sub">Vol &amp; Gamma · v.4.2</div>
        </div>
      </div>

      {/* Varlık sekmeleri */}
      <div className="sb-section">
        <div className="sb-label">Varlıklar</div>
        {izleme.map(w=>{
          const asset=ASSETS[w.sym];
          const isActive=w.sym===aktifSekme;
          const onceden=CACHE[w.sym]?.raw?.allOptions?.length>0;
          return (
            <div key={w.sym} className={`sb-item ${isActive?"active":""}`} style={{cursor:"pointer"}} onClick={()=>setAktifSekme(w.sym)}>
              <span className="sb-item-key tabular" style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{width:6,height:6,borderRadius:"50%",background:onceden?asset?.color:"var(--hairline-strong)",display:"inline-block",flexShrink:0,transition:"background 0.3s"}}/>
                {w.sym}/USD
              </span>
              <span className="sb-item-val">
                <span style={{color:"var(--text)"}}>{w.fiyat?w.fiyat.toLocaleString("tr-TR",{maximumFractionDigits:w.fiyat<10?4:w.fiyat<100?2:0}):"—"}</span>
                <span className={w.degisim>=0?"pos":"neg"} style={{marginLeft:8}}>{w.degisim>=0?"+":""}{(w.degisim||0).toFixed(2)}%</span>
              </span>
            </div>
          );
        })}

        {/* Makro sekmesi */}
        <div
          className={`sb-item ${aktifSekme==="MAKRO"?"active":""}`}
          style={{cursor:"pointer",marginTop:4}}
          onClick={()=>setAktifSekme("MAKRO")}
        >
          <span className="sb-item-key tabular" style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{width:6,height:6,borderRadius:"50%",background:aktifSekme==="MAKRO"?"var(--accent)":"var(--hairline-strong)",display:"inline-block",flexShrink:0}}/>
            Makro Ekonomi
          </span>
          <span className="sb-item-val" style={{fontSize:10,color:"var(--text-mute)"}}>9 gösterge</span>
        </div>
      </div>

      {/* Vade filtresi — sadece opsiyon sekmelerinde */}
      {aktifSekme!=="MAKRO" && (
        <div className="sb-section">
          <div className="sb-label">Vade Filtresi</div>
          <div className="sb-chip-row">
            {[["all","Tümü"],["0-7d","0-7g"],["8-45d","8-45g"],["45d+","45g+"]].map(([v,l])=>(
              <button key={v} className={`sb-chip ${vade===v?"active":""}`} onClick={()=>setVade(v)}>{l}</button>
            ))}
          </div>
        </div>
      )}

      {/* Piyasa verileri — cache'den oku, data prop'a gerek yok */}
      {aktifSekme!=="MAKRO" && (() => {
        const d = CACHE[aktifSekme]?.raw;
        if (!d || d.loading) return null;
        return (
          <>
            <div className="sb-section">
              <div className="sb-label">Piyasa Verileri</div>
              <SbStat label="DVOL"      value={(d.dvol||0).toFixed(1)}/>
              <SbStat label="ATM IV"    value={`${(d.dvol||0).toFixed(1)}%`}/>
              <SbStat label="Fonlama"   value={`${((d.funding||0)*100).toFixed(3)}%`} pos={(d.funding||0)>=0}/>
              <SbStat label="Baz (90g)" value={d.basis?`${d.basis>0?"+":""}${d.basis.toFixed(1)}%`:"+7.4%"} pos/>
              <SbStat label="25Δ Eğimi" value="+6.4 vol" pos={false}/>
            </div>
            <div className="sb-section" style={{marginTop:"auto"}}>
              <div className="sb-label">Opsiyon Zinciri</div>
              <SbStat label="Kontrat" value={`${d.stats?.rows||0} adet`}/>
              <SbStat label="Vade"    value={`${d.stats?.expiries||0} adet`}/>
            </div>
          </>
        );
      })()}
    </aside>
  );
}

function SbStat({label,value,pos}) {
  return (
    <div className="sb-item">
      <span className="sb-item-key" style={{color:"var(--text-mute)",fontSize:10,letterSpacing:"0.08em"}}>{label}</span>
      <span className="sb-item-val" style={{color:pos===true?"var(--pos)":pos===false?"var(--neg)":"var(--text)",fontSize:12,fontWeight:500}}>{value}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAKRO SAYFASI — 9 kritik gösterge, son 3 ay, BTC yorumu
// ═══════════════════════════════════════════════════════════
const MAKRO_CACHE = {veri:null, yuklenmeZamani:0};

function MakroSayfasi() {
  const [veri,  setVeri]    = useState(null);
  const [yuklU, setYuklU]   = useState(true);
  const [hata,  setHata]    = useState(null);

  useEffect(()=>{
    const yukle = async () => {
      if (MAKRO_CACHE.veri && (Date.now()-MAKRO_CACHE.yuklenmeZamani)<5*60*1000) {
        setVeri(MAKRO_CACHE.veri); setYuklU(false); return;
      }
      setYuklU(true); setHata(null);
      try {
        const r = await fetch("/api/macro?module=all");
        if (!r.ok) throw new Error(`API hatası: ${r.status}`);
        const d = await r.json();
        MAKRO_CACHE.veri=d; MAKRO_CACHE.yuklenmeZamani=Date.now();
        setVeri(d);
      } catch(e) { setHata(e.message); }
      setYuklU(false);
    };
    yukle();
    const iv=setInterval(yukle,5*60*1000);
    return()=>clearInterval(iv);
  },[]);

  if (yuklU) return (
    <div style={{display:"grid",placeItems:"center",minHeight:"calc(100vh - 53px)",color:"var(--text-mute)",fontFamily:"var(--sans)",fontSize:11,fontWeight:600,letterSpacing:"0.10em"}}>
      <div style={{textAlign:"center"}}>
        <div style={{width:36,height:36,border:"1.5px solid var(--hairline-strong)",borderTopColor:"var(--accent)",borderRadius:"50%",animation:"spin 0.9s linear infinite",margin:"0 auto 16px"}}/>
        <div>Makro veriler yükleniyor...</div>
        <div style={{marginTop:8,fontSize:10,color:"var(--text-mute)",fontWeight:400}}>FRED, US Treasury, CoinGecko</div>
      </div>
    </div>
  );

  if (hata) return (
    <div style={{padding:"40px 36px",color:"var(--neg)",fontFamily:"var(--sans)"}}>
      <div>❌ {hata}</div>
      <button onClick={()=>{MAKRO_CACHE.veri=null;setYuklU(true);}} style={{marginTop:12,background:"var(--surface)",color:"var(--text)",border:"1px solid var(--hairline-strong)",padding:"6px 16px",cursor:"pointer",fontFamily:"var(--sans)",fontWeight:600}}>Tekrar Dene</button>
    </div>
  );

  const g = veri?.gostergeler || {};
  const guncellendi = veri?.guncellendi ? new Date(veri.guncellendi).toLocaleString("tr-TR") : "—";

  // 9 gösterge tanımı
  const gostergeler = [
    {
      id:"fedFaiz", baslik:"Fed Faiz Kararı", kaynak:"FRED · FEDFUNDS",
      birim:"%", ters:false,
      aciklama:"ABD Merkez Bankası (Fed) politika faiz oranı. Yüksek faiz BTC için baskıcı, düşen faiz likidite artışı ile BTC'yi destekler.",
      veri: g.fedFaiz,
    },
    {
      id:"cpi", baslik:"TÜFE (CPI — Enflasyon)", kaynak:"FRED · CPIAUCSL",
      birim:"", ters:true,
      aciklama:"ABD Tüketici Fiyat Endeksi. Yüksek enflasyon Fed'in faiz düşürmesini geciktirir, BTC için olumsuz. Enflasyonun gerilemesi faiz indirimi yolunu açar.",
      veri: g.cpi,
    },
    {
      id:"nfp", baslik:"Tarım Dışı İstihdam (NFP)", kaynak:"FRED · PAYEMS",
      birim:"K", ters:true,
      aciklama:"ABD'de tarım dışı sektörde aylık eklenen iş sayısı. Güçlü NFP = güçlü ekonomi = Fed sıkı duruşu = BTC baskısı.",
      veri: g.nfp,
    },
    {
      id:"ppi", baslik:"ÜFE (PPI — Üretici Fiyatları)", kaynak:"FRED · PPIACO",
      birim:"", ters:true,
      aciklama:"Üretici Fiyat Endeksi. Öncü enflasyon göstergesi — yükselen ÜFE ileride tüketici enflasyonunu besler.",
      veri: g.ppi,
    },
    {
      id:"gsyih", baslik:"GSYİH (Büyüme Verisi)", kaynak:"FRED · GDP Büyüme",
      birim:"%", ters:false,
      aciklama:"ABD Gayri Safi Yurtiçi Hasıla büyümesi. Yavaşlayan büyüme Fed gevşeme beklentisini güçlendirir, BTC için olumlu olabilir.",
      veri: g.gsyih,
    },
    {
      id:"pce", baslik:"PCE (Kişisel Tüketim Harcamaları)", kaynak:"FRED · PCEPI",
      birim:"", ters:true,
      aciklama:"Fed'in tercih ettiği enflasyon ölçütü. PCE düşüşü Fed'e faiz indirimi konusunda alan açar.",
      veri: g.pce,
    },
    {
      id:"iscabasvurusu", baslik:"İşsizlik Maaşı Başvuruları", kaynak:"FRED · ICSA",
      birim:"K", ters:false,
      aciklama:"Haftalık ilk işsizlik başvurusu sayısı. Artış iş piyasasının zayıfladığını gösterir, Fed gevşemesini hızlandırabilir.",
      veri: g.iscabasvurusu,
    },
    {
      id:"ismImalat", baslik:"ISM İmalat PMI", kaynak:"FRED · NAPM",
      birim:"", ters:false,
      aciklama:"ISM İmalat Satın Alma Müdürleri Endeksi. 50 üstü genişleme, altı daralma. Risk iştahı ile doğru orantılı.",
      veri: g.ismImalat,
    },
    {
      id:"perakende", baslik:"Perakende Satışlar", kaynak:"FRED · RSAFS",
      birim:"", ters:true,
      aciklama:"ABD perakende satışlar. Tüketici harcamalarının gücünü ölçer. Güçlü = Fed sıkı, Zayıf = Fed gevşeme ihtimali artar.",
      veri: g.perakende,
    },
  ];

  return (
    <>
      {/* Başlık */}
      <div style={{padding:"12px 36px",borderBottom:"1px solid var(--hairline)",display:"flex",justifyContent:"space-between",alignItems:"center",background:"var(--surface)"}}>
        <div style={{display:"flex",gap:12,alignItems:"center"}}>
          <span style={{fontFamily:"var(--sans)",fontSize:18,fontWeight:700,color:"var(--text)"}}>📊 Makro Ekonomi Göstergeleri</span>
          <span style={{fontFamily:"var(--sans)",fontSize:11,fontWeight:500,color:"var(--text-mute)"}}>9 Kritik Gösterge · Son 3 Ay</span>
        </div>
        <div style={{fontFamily:"var(--sans)",fontSize:10,fontWeight:600,color:"var(--text-mute)",letterSpacing:"0.06em"}}>
          Güncellendi: <b style={{color:"var(--text)"}}>{guncellendi}</b>
        </div>
      </div>

      <div style={{padding:"32px 36px",display:"flex",flexDirection:"column",gap:32}}>

        {/* BTC Genel Yorum — öne çıkar */}
        {veri?.btcYorum?.sentez && (
          <div style={{background:"var(--surface)",border:"1px solid var(--hairline)",borderLeft:"3px solid var(--accent)",padding:"16px 20px"}}>
            <div style={{fontFamily:"var(--sans)",fontSize:10,fontWeight:600,color:"var(--text-mute)",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:8}}>
              Makro · BTC Genel Değerlendirme
            </div>
            <div style={{fontFamily:"var(--sans)",fontSize:13,fontWeight:600,color:"var(--text)",lineHeight:1.5}}>
              {veri.btcYorum.sentez}
            </div>
          </div>
        )}

        {/* 9 Gösterge Kartları */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:20}}>
          {gostergeler.map((gs,idx) => (
            <GostergeKarti key={gs.id} gs={gs} yorum={veri?.btcYorum?.yorumlar?.[idx]||null}/>
          ))}
        </div>

        {/* Haberler — TAMAMEN TÜRKÇE */}
        {(veri?.haberler?.fed?.length>0||veri?.haberler?.enflasyon?.length>0||veri?.haberler?.ekonomi?.length>0) && (
          <section>
            <div style={{fontFamily:"var(--sans)",fontSize:10,fontWeight:600,color:"var(--text-mute)",letterSpacing:"0.14em",textTransform:"uppercase",borderBottom:"1px solid var(--hairline)",paddingBottom:10,marginBottom:16}}>
              Türkçe Makro Haber Akışı
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:24}}>
              {[
                {baslik:"Fed &amp; Faiz", liste: veri?.haberler?.fed||[]},
                {baslik:"Enflasyon",     liste: veri?.haberler?.enflasyon||[]},
                {baslik:"Ekonomi",       liste: veri?.haberler?.ekonomi||[]},
              ].map((grup,i)=>(
                <div key={i}>
                  <div className="sheet-label" style={{marginBottom:10}} dangerouslySetInnerHTML={{__html:grup.baslik}}/>
                  {grup.liste.length === 0
                    ? <div style={{fontFamily:"var(--sans)",fontSize:10,color:"var(--text-mute)",padding:"8px 0"}}>Haber bulunamadı</div>
                    : grup.liste.slice(0,4).map((h,j)=>(
                      <div key={j} style={{padding:"9px 0",borderBottom:"1px solid var(--hairline-soft)"}}>
                        <div style={{fontFamily:"var(--sans)",fontSize:11,fontWeight:600,color:"var(--text-2)",lineHeight:1.4}}>{h.baslik}</div>
                        {h.tarih && (
                          <div style={{fontFamily:"var(--sans)",fontSize:10,color:"var(--text-mute)",marginTop:3}}>
                            {(()=>{try{return new Date(h.tarih).toLocaleString("tr-TR",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}catch(e){return h.tarih}})()}
                          </div>
                        )}
                      </div>
                    ))
                  }
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Kapsamlı Kripto Etki Analizi Tablosu */}
        <KriptoEtkiTablosu veri={veri}/>

        {/* Kaynak bilgisi */}
        <footer className="footer">
          <div>
            <div style={{marginBottom:4,fontFamily:"var(--sans)",fontSize:11,fontWeight:500}}>Opsiyon Masası · Makro Ekonomi Modülü</div>
            <div style={{color:"var(--text-dim)",fontFamily:"var(--sans)",fontSize:10}}>
              Veri Kaynakları: BLS API · US Treasury Fiscal Data · World Bank API · Google News RSS (TR)
            </div>
          </div>
          <div className="footer-pagenum">— Makro —</div>
        </footer>
      </div>
    </>
  );
}

// ─── Kripto Etki Analizi Tablosu ──────────────────────────
// Trend dahil kapsamlı analiz — son 4 veri birlikte yorumlanır
function KriptoEtkiTablosu({ veri }) {
  if (!veri?.gostergeler) return null;
  const g = veri.gostergeler;

  // Trend fonksiyonu
  const trendRenk  = t => t==="yukari"?"var(--pos)":t==="asagi"?"var(--neg)":"var(--accent)";
  const trendSimge = t => t==="yukari"?"▲":t==="asagi"?"▼":"→";

  const analizler = [
    {
      gosterge: "Fed Faiz",
      deger: g.fedFaiz?.guncel, birim: "%",
      degisim: g.fedFaiz?.degisim, trend: g.fedFaiz?.trend,
      gecmis: g.fedFaiz?.gecmis,
      btcEtkiSkoru: g.fedFaiz ? (
        g.fedFaiz.trend==="asagi" ? 2 :
        g.fedFaiz.trend==="yukari" ? -2 :
        g.fedFaiz.guncel>=5?-1:g.fedFaiz.guncel>=3.5?0:1
      ) : null,
      btcMekanizma: "Faiz indirimi döngüsü = likidite artışı = BTC rallisi. Faiz artışı = dolar güçlenir = BTC satış.",
      tarihselNot:  "2019 faiz indirimi → BTC %200+. 2022 faiz artışı → BTC -%75. 2024 indirim → BTC %100+.",
    },
    {
      gosterge: "TÜFE (CPI)",
      deger: g.cpi?.guncel, birim: "",
      degisim: g.cpi?.degisim, trend: g.cpi?.trend,
      gecmis: g.cpi?.gecmis,
      btcEtkiSkoru: g.cpi ? (
        g.cpi.trend==="asagi" ? 2 :
        g.cpi.trend==="yukari" ? -2 : 0
      ) : null,
      btcMekanizma: "Düşen enflasyon → Fed faiz indirir → BTC yükselir. Yükselen enflasyon → Fed sıkı → BTC baskı.",
      tarihselNot:  "2023 enflasyon düşüşü ile BTC aynı dönemde +%160. CPI zirveyi geçince ralli başladı.",
    },
    {
      gosterge: "Tarım Dışı İstihdam (NFP)",
      deger: g.nfp?.guncel, birim: "K",
      degisim: g.nfp?.degisim, trend: g.nfp?.trend,
      gecmis: g.nfp?.gecmis,
      btcEtkiSkoru: g.nfp ? (
        g.nfp.trend==="asagi"&&g.nfp.guncel<150 ? 2 :
        g.nfp.trend==="yukari"&&g.nfp.guncel>250 ? -2 :
        g.nfp.guncel>200?-1:1
      ) : null,
      btcMekanizma: "Zayıf NFP trendi → Fed gevşeme baskısı → BTC ralli. Güçlü NFP → Fed sıkı → BTC baskı.",
      tarihselNot:  "NFP açıklama günlerinde BTC ±%3-5 volatilite. Ardışık zayıf NFP = Fed pivot sinyali.",
    },
    {
      gosterge: "ÜFE (PPI)",
      deger: g.ppi?.guncel, birim: "",
      degisim: g.ppi?.degisim, trend: g.ppi?.trend,
      gecmis: g.ppi?.gecmis,
      btcEtkiSkoru: g.ppi ? (
        g.ppi.trend==="asagi" ? 1 :
        g.ppi.trend==="yukari" ? -1 : 0
      ) : null,
      btcMekanizma: "ÜFE 2-3 ay öncü enflasyon göstergesidir. Düşüş TÜFE'yi takip eder → faiz indirim yolu açılır.",
      tarihselNot:  "ÜFE zirve → TÜFE zirve (2 ay gecikme) → Fed pivot → BTC ralli — 2022-2023 örüntüsü.",
    },
    {
      gosterge: "GSYİH Büyüme",
      deger: g.gsyih?.guncel, birim: "%",
      degisim: g.gsyih?.degisim, trend: g.gsyih?.trend,
      gecmis: g.gsyih?.gecmis,
      btcEtkiSkoru: g.gsyih ? (
        g.gsyih.guncel<0 ? 2 :
        g.gsyih.guncel<1 ? 1 :
        g.gsyih.guncel<2.5 ? 0 : -1
      ) : null,
      btcMekanizma: "Yavaşlayan büyüme Fed gevşemesini tetikler. Resesyon riski = acil Fed müdahalesi = güçlü BTC rally.",
      tarihselNot:  "2020 resesyonu → Fed $3T likidite → BTC 10x yükseldi. 2022 yavaşlama sonrası benzer patern.",
    },
    {
      gosterge: "PCE Endeksi",
      deger: g.pce?.guncel, birim: "%",
      degisim: g.pce?.degisim, trend: g.pce?.trend,
      gecmis: g.pce?.gecmis,
      btcEtkiSkoru: g.pce ? (
        g.pce.trend==="asagi" ? 2 :
        g.pce.trend==="yukari" ? -2 : 0
      ) : null,
      btcMekanizma: "Fed'in en çok önem verdiği veri. PCE → %2 hedefine yaklaştıkça faiz indirim kapısı açılır.",
      tarihselNot:  "2024 PCE gerilemesi ile Fed indirime geçti, BTC aynı dönemde tüm zamanların zirvesine ulaştı.",
    },
    {
      gosterge: "İşsizlik Oranı",
      deger: g.iscabasvurusu?.guncel, birim: "%",
      degisim: g.iscabasvurusu?.degisim, trend: g.iscabasvurusu?.trend,
      gecmis: g.iscabasvurusu?.gecmis,
      btcEtkiSkoru: g.iscabasvurusu ? (
        g.iscabasvurusu.trend==="yukari" ? 2 :
        g.iscabasvurusu.trend==="asagi" ? -1 : 0
      ) : null,
      btcMekanizma: "İşsizlik artış trendi → Fed faiz indirir → BTC yükselir. %4.5 üstü tarihsel tetikleyici.",
      tarihselNot:  "Sahm Kuralı: 3 aylık işsizlik ortalaması 0.5 puan artarsa resesyon. Fed bunu tetik noktası olarak kullanır.",
    },
    {
      gosterge: "ISM İmalat PMI",
      deger: g.ismImalat?.guncel, birim: "",
      degisim: g.ismImalat?.degisim, trend: g.ismImalat?.trend,
      gecmis: g.ismImalat?.gecmis,
      btcEtkiSkoru: g.ismImalat ? (
        g.ismImalat.guncel>52&&g.ismImalat.trend==="yukari" ? 2 :
        g.ismImalat.guncel>50 ? 1 :
        g.ismImalat.guncel>45 ? -1 : -2
      ) : null,
      btcMekanizma: "PMI > 50: genişleme → risk-on → BTC ralli. PMI < 45: güçlü daralma → risk-off → BTC satış.",
      tarihselNot:  "PMI 50'yi aşıp trend sürdürdüğünde BTC ortalama +%30-50. PMI 45 altı resesyon erken uyarısı.",
    },
    {
      gosterge: "Perakende Satışlar",
      deger: g.perakende?.guncel, birim: "Mr$",
      degisim: g.perakende?.degisim, trend: g.perakende?.trend,
      gecmis: g.perakende?.gecmis,
      btcEtkiSkoru: g.perakende ? (
        g.perakende.trend==="asagi" ? 1 :
        g.perakende.trend==="yukari" ? -1 : 0
      ) : null,
      btcMekanizma: "Zayıf perakende = tüketici daralması = ekonomi yavaşlıyor = Fed gevşeme. Güçlü = enflasyon canlı = Fed sıkı.",
      tarihselNot:  "Perakende satışlar 3 ay üst üste düştüğünde tarihsel olarak Fed eyleme geçmiştir.",
    },
  ];

  // Genel skor
  const skorlar = analizler.map(a=>a.btcEtkiSkoru).filter(s=>s!=null);
  const ortSkor = skorlar.length ? skorlar.reduce((a,b)=>a+b,0)/skorlar.length : 0;
  const genelRenk   = ortSkor>0.5?"var(--pos)":ortSkor<-0.5?"var(--neg)":"var(--accent)";
  const genelEtiket = ortSkor>0.5?"BTC Genel Eğilimi: OLUMLU 📗":ortSkor<-0.5?"BTC Genel Eğilimi: OLUMSUZ 📕":"BTC Genel Eğilimi: NÖTR 📙";

  const etiketRenk  = s => s>=1?"var(--pos)":s<=-1?"var(--neg)":"var(--accent)";
  const etiketMetin = s => s>=2?"Çok Olumlu ▲▲":s===1?"Olumlu ▲":s===0?"Nötr →":s===-1?"Olumsuz ▼":"Çok Olumsuz ▼▼";

  return (
    <section>
      <div style={{borderBottom:"1px solid var(--hairline)",paddingBottom:12,marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{fontFamily:"var(--sans)",fontSize:10,fontWeight:600,color:"var(--text-mute)",letterSpacing:"0.14em",textTransform:"uppercase"}}>
          Kapsamlı Kripto Etki Analizi · Trend Bazlı Yorum
        </div>
        <div style={{fontFamily:"var(--sans)",fontSize:13,fontWeight:700,color:genelRenk}}>{genelEtiket}</div>
      </div>

      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"var(--sans)",fontSize:11}}>
          <thead>
            <tr style={{borderBottom:"2px solid var(--hairline)"}}>
              {["Gösterge","Güncel","Son Değişim","Trend (4 dönem)","Son 4 Dönem","BTC Etkisi","Mekanizma"].map(h=>(
                <th key={h} style={{padding:"8px 10px",textAlign:"left",fontWeight:600,fontSize:9,color:"var(--text-mute)",letterSpacing:"0.08em",textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {analizler.map((a,i)=>(
              <tr key={i} style={{borderBottom:"1px solid var(--hairline-soft)",background:i%2===0?"transparent":"rgba(255,255,255,0.015)"}}>
                {/* Gösterge */}
                <td style={{padding:"10px 10px",fontWeight:600,color:"var(--text)",whiteSpace:"nowrap",minWidth:140}}>{a.gosterge}</td>
                {/* Güncel */}
                <td style={{padding:"10px 10px",fontFamily:"var(--mono)",fontWeight:700,color:a.btcEtkiSkoru>0?"var(--pos)":a.btcEtkiSkoru<0?"var(--neg)":"var(--text)",whiteSpace:"nowrap"}}>
                  {a.deger!=null?`${a.deger.toLocaleString("tr-TR",{maximumFractionDigits:2})}${a.birim}`:"—"}
                </td>
                {/* Değişim */}
                <td style={{padding:"10px 10px",whiteSpace:"nowrap"}}>
                  {a.degisim!=null?(
                    <span style={{fontFamily:"var(--mono)",fontWeight:700,fontSize:11,color:a.degisim>=0?"var(--pos)":"var(--neg)"}}>
                      {a.degisim>=0?"+":""}{a.degisim.toFixed(2)}{a.birim}
                    </span>
                  ):<span style={{color:"var(--text-mute)"}}>—</span>}
                </td>
                {/* Trend */}
                <td style={{padding:"10px 10px",whiteSpace:"nowrap"}}>
                  {a.trend?(
                    <span style={{fontWeight:700,fontSize:12,color:trendRenk(a.trend)}}>
                      {trendSimge(a.trend)} {a.trend==="yukari"?"Yükseliş":a.trend==="asagi"?"Düşüş":"Yatay"}
                    </span>
                  ):<span style={{color:"var(--text-mute)"}}>—</span>}
                </td>
                {/* Son 4 dönem mini sparkline */}
                <td style={{padding:"10px 10px"}}>
                  {a.gecmis?.length>1?(
                    <div style={{display:"flex",gap:3,alignItems:"flex-end",height:24}}>
                      {a.gecmis.slice(-4).map((d,bi)=>{
                        const vals=a.gecmis.slice(-4).map(x=>x.deger);
                        const mn=Math.min(...vals),mx=Math.max(...vals);
                        const h=mx>mn?Math.max(4,((d.deger-mn)/(mx-mn))*20):12;
                        const isLast=bi===a.gecmis.slice(-4).length-1;
                        return(
                          <div key={bi} title={`${d.tarih}: ${d.deger}`} style={{
                            width:10,height:h,borderRadius:"1px 1px 0 0",
                            background:isLast?"var(--accent)":a.btcEtkiSkoru>=1?"var(--pos)":a.btcEtkiSkoru<=-1?"var(--neg)":"var(--neutral)",
                            opacity:isLast?1:0.5,flexShrink:0,
                          }}/>
                        );
                      })}
                    </div>
                  ):<span style={{color:"var(--text-mute)"}}>—</span>}
                </td>
                {/* BTC Etkisi */}
                <td style={{padding:"10px 10px",whiteSpace:"nowrap"}}>
                  {a.btcEtkiSkoru!=null?(
                    <span style={{fontWeight:700,color:etiketRenk(a.btcEtkiSkoru),fontSize:10}}>
                      {etiketMetin(a.btcEtkiSkoru)}
                    </span>
                  ):<span style={{color:"var(--text-mute)"}}>—</span>}
                </td>
                {/* Mekanizma */}
                <td style={{padding:"10px 10px",color:"var(--text-2)",lineHeight:1.4,fontSize:10,maxWidth:260}}>{a.btcMekanizma}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tarihsel Hafıza */}
      <div style={{marginTop:20,padding:"16px 18px",background:"var(--surface-2)",border:"1px solid var(--hairline)",borderLeft:`3px solid ${genelRenk}`}}>
        <div style={{fontFamily:"var(--sans)",fontSize:9,fontWeight:600,color:"var(--text-mute)",letterSpacing:"0.10em",textTransform:"uppercase",marginBottom:12}}>
          Tarihsel Hafıza — Geçmiş Verilerle Bağlam
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12}}>
          {analizler.filter(a=>a.btcEtkiSkoru!=null).map((a,i)=>(
            <div key={i} style={{fontFamily:"var(--sans)",fontSize:10,color:"var(--text-2)",lineHeight:1.5,padding:"8px 10px",background:"var(--surface)",border:"1px solid var(--hairline-soft)"}}>
              <div style={{fontWeight:700,color:etiketRenk(a.btcEtkiSkoru),marginBottom:4,fontSize:9,letterSpacing:"0.05em"}}>
                {a.gosterge} · {etiketMetin(a.btcEtkiSkoru)}
              </div>
              {a.tarihselNot}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Gösterge Kartı ───────────────────────────────────────
function GostergeKarti({ gs, yorum }) {
  const v = gs.veri;
  if (!v) return (
    <div style={{background:"var(--surface)",border:"1px solid var(--hairline)",padding:"18px 20px",minHeight:200}}>
      <div style={{fontFamily:"var(--sans)",fontSize:11,fontWeight:700,color:"var(--text)",marginBottom:4}}>{gs.baslik}</div>
      <div style={{fontFamily:"var(--sans)",fontSize:10,color:"var(--text-mute)",marginBottom:12}}>{gs.kaynak}</div>
      <div style={{color:"var(--text-mute)",fontSize:24,fontFamily:"var(--serif)"}}>—</div>
      <div style={{fontFamily:"var(--sans)",fontSize:10,color:"var(--text-mute)",marginTop:8}}>Veri alınamadı</div>
    </div>
  );

  const degisim = v.degisim;
  const yukari  = degisim > 0;
  // ters=true: artış olumsuz (enflasyon, NFP vb.)
  const olumlu  = gs.ters ? !yukari : yukari;
  const degisimRengi = degisim==null?"var(--text-mute)":olumlu?"var(--pos)":"var(--neg)";
  const guncelRengi  = degisim==null?"var(--text)":olumlu?"var(--pos)":"var(--neg)";

  // Mini bar chart — son 4 kayıt
  const gecmis = v.gecmis || [];
  const barMax = Math.max(...gecmis.map(d=>Math.abs(d.deger)),1);

  return (
    <div style={{background:"var(--surface)",border:"1px solid var(--hairline)",padding:"18px 20px",display:"flex",flexDirection:"column",gap:12}}>
      {/* Başlık */}
      <div>
        <div style={{fontFamily:"var(--sans)",fontSize:11,fontWeight:700,color:"var(--text)",marginBottom:2}}>{gs.baslik}</div>
        <div style={{fontFamily:"var(--sans)",fontSize:9,fontWeight:600,color:"var(--text-mute)",letterSpacing:"0.08em",textTransform:"uppercase"}}>{gs.kaynak}</div>
      </div>

      {/* Güncel değer + değişim */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
        <div>
          <div style={{fontFamily:"var(--serif)",fontSize:32,fontWeight:400,color:guncelRengi,lineHeight:1}}>
            {v.guncel.toLocaleString("tr-TR",{maximumFractionDigits:2})}{gs.birim}
          </div>
          <div style={{fontFamily:"var(--sans)",fontSize:10,color:"var(--text-mute)",marginTop:4}}>{v.tarih}</div>
        </div>
        {degisim!=null && (
          <div style={{textAlign:"right"}}>
            <div style={{fontFamily:"var(--sans)",fontSize:14,fontWeight:700,color:degisimRengi}}>
              {degisim>0?"+":""}{degisim.toLocaleString("tr-TR",{maximumFractionDigits:2})}{gs.birim}
            </div>
            <div style={{fontFamily:"var(--sans)",fontSize:9,color:"var(--text-mute)",marginTop:2}}>
              önceki: {v.onceki?.toLocaleString("tr-TR",{maximumFractionDigits:2})}{gs.birim}
            </div>
          </div>
        )}
      </div>

      {/* Mini bar chart — son 3 ay */}
      {gecmis.length > 1 && (
        <div>
          <div style={{fontFamily:"var(--sans)",fontSize:9,fontWeight:600,color:"var(--text-mute)",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6}}>Son {gecmis.length} Dönem</div>
          <div style={{display:"flex",gap:4,alignItems:"flex-end",height:48}}>
            {gecmis.map((d,i)=>{
              const yukseklik = Math.max((Math.abs(d.deger)/barMax)*44,2);
              const enSon = i===gecmis.length-1;
              return (
                <div key={i} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                  <div style={{fontSize:8,fontFamily:"var(--sans)",color:enSon?"var(--accent)":"var(--text-mute)",fontWeight:enSon?700:400,textAlign:"center",lineHeight:1.2}}>
                    {d.deger.toLocaleString("tr-TR",{maximumFractionDigits:1})}
                  </div>
                  <div style={{width:"100%",height:yukseklik,background:enSon?"var(--accent)":olumlu?"var(--pos)":"var(--neg)",opacity:enSon?1:0.4,borderRadius:"1px 1px 0 0"}}/>
                  <div style={{fontSize:8,fontFamily:"var(--sans)",color:"var(--text-mute)",textAlign:"center",lineHeight:1.2,whiteSpace:"nowrap",overflow:"hidden",maxWidth:"100%"}}>
                    {d.tarih?.slice(0,7)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Ayraç */}
      <div style={{borderTop:"1px solid var(--hairline-soft)"}}/>

      {/* Açıklama */}
      <div style={{fontFamily:"var(--sans)",fontSize:10,fontWeight:400,color:"var(--text-mute)",lineHeight:1.5}}>
        {gs.aciklama}
      </div>

      {/* BTC Yorumu */}
      {yorum && (
        <div style={{background:"var(--surface-2)",borderLeft:"2px solid var(--accent)",padding:"8px 10px"}}>
          <div style={{fontFamily:"var(--sans)",fontSize:9,fontWeight:600,color:"var(--accent)",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:4}}>BTC Etkisi</div>
          <div style={{fontFamily:"var(--sans)",fontSize:10,fontWeight:700,color:"var(--text-2)",lineHeight:1.5}}>{yorum}</div>
        </div>
      )}
    </div>
  );
}

// ─── STRIKE MERDIVENI ─────────────────────────────────────
function StrikeMerdiveni({ data, sym }) {
  const {strikes,spot,levels,classified}=data;
  const [hoveredStrike,setHoveredStrike]=useState(null);
  const lo=spot*0.90,hi=spot*1.10;
  const vis=[...classified.filter(s=>s.strike>=lo&&s.strike<=hi)].sort((a,b)=>b.strike-a.strike);
  const maxCall=Math.max(...vis.map(s=>s.callGex),1);
  const maxPut=Math.max(...vis.map(s=>Math.abs(s.putGex)),1);
  const etiketBul=strike=>{if(strike===levels.callWall)return{txt:"CW",cls:"cw"};if(strike===levels.putWall)return{txt:"PW",cls:"pw"};if(strike===levels.maxPain)return{txt:"MP",cls:"mp"};if(strike===levels.zeroGamma)return{txt:"ZΓ",cls:"zg"};return null;};
  const spotIdx=vis.findIndex(s=>s.strike<spot);
  const hoveredVeri=hoveredStrike?vis.find(s=>s.strike===hoveredStrike):null;
  const duvarTipi=s=>{if(s.wallType==="callWall")return{txt:"CALL WALL",renk:"var(--pos)"};if(s.wallType==="putWall")return{txt:"PUT WALL",renk:"var(--neg)"};if(s.wallType==="magnet")return{txt:"MAGNET",renk:"var(--neutral)"};return{txt:"NEUTRAL",renk:"var(--text-dim)"};};

  return (
    <div className="ladder" style={{position:"relative"}}>
      {hoveredVeri&&(()=>{
        const dt=duvarTipi(hoveredVeri);
        return (
          <div style={{position:"absolute",top:0,right:0,background:"var(--surface)",border:"1px solid var(--hairline-strong)",borderRadius:4,fontFamily:"var(--sans)",pointerEvents:"none",zIndex:200,minWidth:215,overflow:"hidden",boxShadow:"0 4px 24px rgba(0,0,0,0.5)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",borderBottom:"1px solid var(--hairline)",background:"var(--surface-2)"}}>
              <span style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>${fmt(hoveredVeri.strike)}</span>
              <span style={{fontSize:9,fontWeight:700,letterSpacing:"0.1em",color:dt.renk}}>{dt.txt}</span>
            </div>
            {[
              ["Net GEX",(hoveredVeri.netGex>=0?"+":"−")+fmtM(Math.abs(hoveredVeri.netGex)),hoveredVeri.netGex>=0?"var(--pos)":"var(--neg)"],
              ["Call GEX","+"+fmtM(hoveredVeri.callGex),"var(--pos)"],
              ["Put GEX","−"+fmtM(Math.abs(hoveredVeri.putGex)),"var(--neg)"],
              ["Call OI",hoveredVeri.callOI.toFixed(1)+" "+sym,"var(--text)"],
              ["Put OI",hoveredVeri.putOI.toFixed(1)+" "+sym,"var(--text)"],
              ["AP Yoğunluğu",hoveredVeri.oiPct+"%","var(--text)"],
              ["γ Yoğunluğu",hoveredVeri.gexPct+"%","var(--text)"],
            ].map(([lbl,val,clr])=>(
              <div key={lbl} style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",padding:"4px 12px",borderBottom:"1px solid var(--hairline-soft)"}}>
                <span style={{color:"var(--text-dim)",fontSize:10,fontWeight:600}}>{lbl}</span>
                <span style={{color:clr,fontWeight:700,fontSize:11}}>{val}</span>
              </div>
            ))}
          </div>
        );
      })()}

      <div className="ladder-header">
        <div>Etiket</div><div>AP %</div>
        <div style={{textAlign:"right",paddingRight:14}}>Put γ</div>
        <div>Kullanım</div>
        <div style={{paddingLeft:14}}>Call γ</div>
        <div>Net γ</div><div>Δ%</div>
      </div>

      {vis.map((s,i)=>{
        const etiket=etiketBul(s.strike),callPct=s.callGex/maxCall*100,putPct=Math.abs(s.putGex)/maxPut*100;
        const uzaklik=(s.strike-spot)/spot*100, isHov=hoveredStrike===s.strike;
        return (
          <Fragment key={s.strike}>
            {i===spotIdx&&(<div className="ladder-row spot"><div className="tag" style={{color:"var(--accent)"}}>◆</div><div/><div className="bar-cell put"/><div className="strike-cell tabular" style={{color:"var(--accent)",fontWeight:700}}>{fmt(spot)}</div><div className="bar-cell call"/><div className="net" style={{color:"var(--accent)"}}>—</div><div className="dist" style={{color:"var(--accent)"}}>0.00%</div></div>)}
            <div className="ladder-row" style={{background:isHov?"rgba(196,165,116,0.06)":undefined}} onMouseEnter={()=>setHoveredStrike(s.strike)} onMouseLeave={()=>setHoveredStrike(null)}>
              <div className={`tag ${etiket?.cls||""}`}>{etiket?.txt||""}</div>
              <div style={{fontFamily:"var(--sans)",fontSize:11,fontWeight:700,color:"var(--text-dim)",textAlign:"center"}}>{s.oiPct}%</div>
              <div className="bar-cell put"><div className="bar put" style={{width:`${putPct}%`,opacity:isHov?1:0.85}}/></div>
              <div className="strike-cell tabular">{fmt(s.strike)}</div>
              <div className="bar-cell call"><div className="bar call" style={{width:`${callPct}%`,opacity:isHov?1:0.85}}/></div>
              <div className="net tabular" style={{color:s.netGex>=0?"var(--pos)":"var(--neg)"}}>{s.netGex>=0?"+":"−"}{fmtB(Math.abs(s.netGex))}</div>
              <div className={`dist tabular ${uzaklik>=0?"pos":"neg"}`}>{uzaklik>=0?"+":""}{uzaklik.toFixed(1)}%</div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

// ─── KİLİT SEVİYELER ──────────────────────────────────────
function KilitSeviyeler({data}) {
  const {levels}=data;
  const liste=[
    {isim:"Call Wall",      aciklama:"Maks. pozitif γ",   deger:levels.callWall,  renk:"var(--pos)",      pct:levels.callWallPct},
    {isim:"Beklenen Hareket ↑",aciklama:"1σ hafta sonu",  deger:levels.emHigh,    renk:"var(--neutral)",  pct:levels.emHighPct},
    {isim:"Max Pain",       aciklama:"Min. yazar ödemesi", deger:levels.maxPain,   renk:"var(--accent)",   pct:levels.maxPainPct},
    {isim:"Zero Gamma",     aciklama:"Rejim dönüşümü",     deger:levels.zeroGamma, renk:"var(--text-dim)", pct:levels.zeroGammaPct},
    {isim:"Beklenen Hareket ↓",aciklama:"1σ hafta sonu",  deger:levels.emLow,     renk:"var(--neutral)",  pct:levels.emLowPct},
    {isim:"Put Wall",       aciklama:"Maks. negatif γ",    deger:levels.putWall,   renk:"var(--neg)",      pct:levels.putWallPct},
  ];
  return (
    <div className="sheet">
      <div className="sheet-block" style={{borderTop:"none",paddingTop:0}}>
        <div className="sheet-label">Kilit Seviyeler</div>
        <div className="levels-list">
          {liste.map(l=>{
            const p=l.pct!=null?parseFloat(l.pct):null;
            return (
              <div key={l.isim} className="level-row">
                <span className="level-dot" style={{color:l.renk}}/>
                <span><span className="level-name">{l.isim}</span><span className="level-sub">{l.aciklama}</span></span>
                <span className="level-value tabular">${fmt(l.deger)}</span>
                <span className={`level-delta ${p!=null&&p>=0?"pos":"neg"}`}>{p!=null?`${p>=0?"+":""}${p.toFixed(2)}%`:"—"}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── HULL YORUMU PANELİ ───────────────────────────────────
function HullYorumuPaneli({data,sym}) {
  const yorum=hullYorumUret(data,sym);
  if (!yorum) return null;
  const satirlar=[yorum.rejim,yorum.mpYorum,yorum.vannaYorum,yorum.volYorum,yorum.emYorum].filter(Boolean);
  return (
    <div style={{background:"var(--surface)",border:"1px solid var(--hairline)",borderTop:`2px solid ${yorum.pozitif?"var(--pos)":"var(--neg)"}`,padding:"16px 18px",display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
        <div>
          <span style={{fontFamily:"var(--sans)",fontSize:10,fontWeight:600,color:"var(--text-mute)",letterSpacing:"0.10em",textTransform:"uppercase"}}>Hull Analizi · Anlık Yorum</span>
          <div style={{fontFamily:"var(--serif)",fontStyle:"italic",fontSize:14,color:yorum.pozitif?"var(--pos)":"var(--neg)",marginTop:2}}>{yorum.pozitif?"● Pozitif Gamma Rejimi":"● Negatif Gamma Rejimi"}</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontFamily:"var(--sans)",color:"var(--text-mute)",fontSize:10,fontWeight:600}}>Net GEX</div>
          <div style={{color:yorum.pozitif?"var(--pos)":"var(--neg)",fontWeight:700,fontSize:13,fontFamily:"var(--sans)"}}>{yorum.netGexStr}</div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,padding:"10px 0",borderTop:"1px solid var(--hairline-soft)",borderBottom:"1px solid var(--hairline-soft)"}}>
        {[{lbl:"Call Wall",val:yorum.cw,pct:"+"+yorum.cwUzaklik+"%",clr:"var(--pos)"},{lbl:"Bant",val:yorum.band,clr:"var(--accent)",orta:true},{lbl:"Put Wall",val:yorum.pw,pct:"−"+yorum.pwUzaklik+"%",clr:"var(--neg)",sag:true}].map((r,i)=>(
          <div key={i} style={{textAlign:r.orta?"center":r.sag?"right":"left"}}>
            <div style={{fontFamily:"var(--sans)",fontSize:10,fontWeight:600,color:"var(--text-mute)",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:2}}>{r.lbl}</div>
            <div style={{fontFamily:"var(--serif)",fontSize:15,color:r.clr,fontWeight:600}}>${fmt(r.val)}</div>
            {r.pct&&<div style={{fontFamily:"var(--sans)",fontSize:9,color:r.clr,opacity:0.7}}>{r.pct}</div>}
          </div>
        ))}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {satirlar.map((s,i)=>(
          <div key={i} style={{fontFamily:"var(--sans)",fontSize:10,fontWeight:700,color:"var(--text-2)",lineHeight:1.55,paddingLeft:10,borderLeft:`2px solid ${i===0?(yorum.pozitif?"var(--pos)":"var(--neg)"):"var(--hairline-strong)"}`}}>{s}</div>
        ))}
      </div>
      <div style={{fontFamily:"var(--sans)",fontSize:10,fontWeight:400,color:"var(--text-mute)",borderTop:"1px solid var(--hairline-soft)",paddingTop:8}}>Hull, J.C. "Options, Futures, and Other Derivatives" 11e · Bölüm 19–20</div>
    </div>
  );
}

// ─── KUANTUM DUVARLAR ─────────────────────────────────────
function KuantumDuvarlar({data,sym}) {
  const {classified,spot,levels}=data;
  const [ipucu,setIpucu]=useState(null);
  const [hover,setHover]=useState(null);
  const svgRef=useRef(null);
  const lo=spot*0.80,hi=spot*1.22;
  const vis=classified.filter(s=>s.strike>=lo&&s.strike<=hi);
  if (!vis.length) return <div style={{color:"var(--text-mute)",fontFamily:"var(--sans)",fontSize:11,padding:"20px 0"}}>Veri yükleniyor...</div>;
  const W=1400,H=720,pad={top:44,right:56,bottom:52,left:112};
  const cW=W-pad.left-pad.right,cH=H-pad.top-pad.bottom;
  const yS=p=>pad.top+((hi-p)/(hi-lo))*cH;
  const maxBar=Math.max(...vis.map(s=>Math.max(s.callGex,Math.abs(s.putGex))),1);
  const rowH=Math.max(cH/vis.length-1,2.5);
  const xBar=mag=>(mag/maxBar)*cW*0.92;
  const topDuvarlar=[...vis].filter(s=>s.isMajor).sort((a,b)=>Math.abs(b.netGex)-Math.abs(a.netGex)).slice(0,8);
  const handleFare=e=>{const rect=svgRef.current?.getBoundingClientRect();if(!rect)return;const sy=(e.clientY-rect.top)*(H/rect.height),fiyat=hi-((sy-pad.top)/cH)*(hi-lo);let best=null,bestD=Infinity;for(const s of vis){const d=Math.abs(s.strike-fiyat);if(d<bestD){bestD=d;best=s;}}if(best&&bestD<(hi-lo)*0.025){setIpucu(best);setHover(best.strike);}else{setIpucu(null);setHover(null);}};
  const seviyeRozeti=[{p:levels.callWall,l:"CW",c:"var(--pos)"},{p:levels.emHigh,l:"BH↑",c:"var(--neutral)"},{p:levels.zeroGamma,l:"ZΓ",c:"var(--text-dim)"},{p:levels.maxPain,l:"MA",c:"var(--accent)"},{p:levels.emLow,l:"BH↓",c:"var(--neutral)"},{p:levels.putWall,l:"PW",c:"var(--neg)"}].filter(x=>x.p&&x.p>=lo&&x.p<=hi);
  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 290px",gap:32}}>
      <div>
        <div style={{display:"flex",justifyContent:"space-between",fontFamily:"var(--sans)",fontSize:10,fontWeight:700,color:"var(--text-mute)",marginBottom:10}}>
          <span>|GAMMA MARUZIYETI| · USD</span>
          <span>{vis.filter(s=>s.wallType==="callWall").length} DUVAR · {vis.filter(s=>s.wallType==="magnet").length} MIKNATIK</span>
        </div>
        <div style={{position:"relative"}} onMouseLeave={()=>{setIpucu(null);setHover(null);}}>
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"auto",display:"block"}} onMouseMove={handleFare}>
            <defs>
              <linearGradient id="qcg" x1="0" x2="1"><stop offset="0%" stopColor="var(--pos)" stopOpacity="0.92"/><stop offset="100%" stopColor="var(--pos)" stopOpacity="0.18"/></linearGradient>
              <linearGradient id="qpg" x1="0" x2="1"><stop offset="0%" stopColor="var(--neg)" stopOpacity="0.88"/><stop offset="100%" stopColor="var(--neg)" stopOpacity="0.14"/></linearGradient>
              <linearGradient id="qmg" x1="0" x2="1"><stop offset="0%" stopColor="var(--neutral)" stopOpacity="0.38"/><stop offset="100%" stopColor="var(--neutral)" stopOpacity="0.03"/></linearGradient>
            </defs>
            {vis.map(s=>{const y=yS(s.strike);return(<g key={`iz-${s.strike}`}><line x1={pad.left} x2={W-pad.right} y1={y} y2={y} stroke="var(--hairline-soft)" strokeWidth="0.3"/><text x={pad.left-6} y={y+3} textAnchor="end" fontFamily="var(--sans)" fontSize="10" fontWeight="700" fill="var(--text-mute)">{(s.strike/1000).toFixed(0)}K</text></g>);})}
            {vis.map(s=>{
              const y=yS(s.strike),callW=xBar(s.callGex),putW=xBar(Math.abs(s.putGex)),totalW=Math.max(callW,putW);
              const lRenk=s.wallType==="callWall"?"var(--pos)":s.wallType==="putWall"?"var(--neg)":"var(--neutral)";
              const lTur=s.wallType==="callWall"?"CALL WALL":s.wallType==="putWall"?"PUT WALL":s.wallType==="magnet"?"MAGNET":null;
              return(<g key={`bar-${s.strike}`}>
                {hover===s.strike&&<rect x={pad.left-8} y={y-rowH/2-1} width={W-pad.left-pad.right+12} height={rowH+2} fill="rgba(255,255,255,0.04)"/>}
                {s.wallType==="magnet"&&s.isSignificant&&<rect x={pad.left} y={y-rowH/2} width={totalW} height={rowH} fill="url(#qmg)"/>}
                {s.callGex>0&&<rect x={pad.left} y={y-rowH/2} width={callW} height={rowH} fill="url(#qcg)"/>}
                {s.putGex<0&&<rect x={pad.left} y={y-rowH/2} width={putW} height={rowH} fill="url(#qpg)" opacity="0.85"/>}
                {s.isMajor&&rowH>=3&&totalW>140&&lTur&&(<g><line x1={pad.left+totalW+5} x2={W-pad.right} y1={y} y2={y} stroke={lRenk} strokeWidth="0.8" strokeDasharray="4 3" opacity="0.28"/><text x={pad.left+totalW/2} y={y+3.5} textAnchor="middle" fontFamily="var(--sans)" fontSize="9" fontWeight="700" fill={lRenk}>{`▸ ${lTur}  ${fmtB(Math.abs(s.netGex))}  AP ${s.oiPct}%`}</text></g>)}
              </g>);
            })}
            {seviyeRozeti.map((it,i)=>{const y=yS(it.p);if(y<pad.top-10||y>H-pad.bottom+10)return null;return(<g key={`lvl-${i}`}><line x1={pad.left} x2={W-pad.right} y1={y} y2={y} stroke={it.c} strokeWidth="0.7" strokeDasharray="3 5" opacity="0.25"/><rect x={pad.left-56} y={y-9} width="48" height="18" rx="3" fill="var(--surface)" stroke={it.c} strokeWidth="1"/><text x={pad.left-32} y={y+4} textAnchor="middle" fontFamily="var(--sans)" fontSize="9" fontWeight="700" fill={it.c}>{it.l}</text></g>);})}
            {(()=>{const y=yS(spot);if(y<pad.top||y>H-pad.bottom)return null;return(<g><line x1={pad.left} x2={W-pad.right} y1={y} y2={y} stroke="var(--accent)" strokeWidth="1.8" opacity="0.9"/><rect x={pad.left-56} y={y-10} width="48" height="20" rx="3" fill="var(--accent)"/><text x={pad.left-32} y={y+5} textAnchor="middle" fontFamily="var(--sans)" fontSize="10" fontWeight="700" fill="#0a0a0a">SPOT</text></g>)})()}
            <line x1={pad.left} x2={W-pad.right} y1={H-pad.bottom} y2={H-pad.bottom} stroke="var(--hairline)"/>
            {[0,0.25,0.5,0.75,1].map(p=>{const x=pad.left+p*cW*0.92,v=p*maxBar;return(<g key={p}><line x1={x} x2={x} y1={H-pad.bottom} y2={H-pad.bottom+4} stroke="var(--hairline)"/><text x={x} y={H-pad.bottom+16} textAnchor="middle" fontFamily="var(--sans)" fontSize="9" fontWeight="700" fill="var(--text-mute)">${fmtB(v)}</text></g>);})}
            <text x={(pad.left+W-pad.right)/2} y={H-pad.bottom+34} textAnchor="middle" fontFamily="var(--sans)" fontSize="9" fontWeight="700" fill="var(--text-mute)">|Gamma Maruziyeti| · $</text>
          </svg>
          {ipucu&&(()=>{const wl=ipucu.wallType==="callWall"?{txt:"CALL WALL",renk:"var(--pos)"}:ipucu.wallType==="putWall"?{txt:"PUT WALL",renk:"var(--neg)"}:ipucu.wallType==="magnet"?{txt:"MAGNET",renk:"var(--neutral)"}:{txt:"NEUTRAL",renk:"var(--text-dim)"};return(<div style={{position:"absolute",top:8,right:8,background:"var(--surface)",border:"1px solid var(--hairline-strong)",borderRadius:4,fontFamily:"var(--sans)",pointerEvents:"none",zIndex:100,minWidth:200,overflow:"hidden"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",borderBottom:"1px solid var(--hairline)",background:"var(--surface-2)"}}><span style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>${fmt(ipucu.strike)}</span><span style={{fontSize:9,fontWeight:700,letterSpacing:"0.1em",color:wl.renk}}>{wl.txt}</span></div>
            {[["Net GEX",(ipucu.netGex>=0?"+":"−")+fmtM(Math.abs(ipucu.netGex)),ipucu.netGex>=0?"var(--pos)":"var(--neg)"],["Call GEX","+"+fmtM(ipucu.callGex),"var(--pos)"],["Put GEX","−"+fmtM(Math.abs(ipucu.putGex)),"var(--neg)"],["AP Yoğunluğu",ipucu.oiPct+"%","var(--text)"],["γ Yoğunluğu",ipucu.gexPct+"%","var(--text)"]].map(([e,d,r])=>(<div key={e} style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",padding:"5px 12px",borderBottom:"1px solid var(--hairline-soft)"}}><span style={{color:"var(--text-dim)",fontSize:10,fontWeight:600}}>{e}</span><span style={{color:r,fontWeight:700,fontSize:11}}>{d}</span></div>))}
          </div>)})()}
        </div>
      </div>
      <div>
        <p style={{fontFamily:"var(--serif)",fontSize:15,lineHeight:1.45,color:"var(--text-2)",marginBottom:20}}>İki <em style={{fontStyle:"italic",color:"var(--accent)"}}>$5K-bant</em> spot'u çerçeveler: yukarıda Call Wall kümesi, aşağıda Put Wall yığını.</p>
        <div style={{fontFamily:"var(--sans)",fontSize:10,fontWeight:600,color:"var(--text-mute)",letterSpacing:"0.10em",textTransform:"uppercase",marginBottom:14}}>Önemli Duvarlar — Sıralı ↓</div>
        {topDuvarlar.map((w,i)=>{const alim=w.wallType==="callWall",satim=w.wallType==="putWall",renk=alim?"var(--pos)":satim?"var(--neg)":"var(--neutral)",pct=((w.strike-spot)/spot*100);return(<div key={w.strike} style={{display:"grid",gridTemplateColumns:"22px 1fr auto",gap:"6px 10px",alignItems:"baseline",padding:"9px 0",borderBottom:"1px solid var(--hairline-soft)"}}><span style={{fontSize:9,color:"var(--text-mute)",fontStyle:"italic",fontFamily:"var(--sans)"}}>{String(i+1).padStart(2,"0")}</span><div><div style={{fontSize:13,color:renk,fontWeight:700,fontFamily:"var(--sans)"}}>${fmt(w.strike)}</div><div style={{fontSize:9,color:renk,marginTop:2,fontFamily:"var(--sans)",fontWeight:600}}>{alim?"Call":satim?"Put":"Mıknatık"} · AP {w.oiPct}%</div></div><div style={{textAlign:"right"}}><div style={{fontSize:12,color:pct>=0?"var(--pos)":"var(--neg)",fontFamily:"var(--sans)",fontWeight:700}}>{pct>=0?"+":""}{pct.toFixed(1)}%</div><div style={{fontSize:10,color:"var(--text-mute)",marginTop:2,fontFamily:"var(--sans)"}}>{pct>=0?"+":"-"}${fmtB(Math.abs(w.netGex))}</div></div></div>);})}
      </div>
    </div>
  );
}

// ─── TOPLU GREEK'LER ──────────────────────────────────────
function TopluGreekler({data}) {
  const {toplamlar}=data;
  return (
    <div className="greeks-stack">
      {[
        {simge:"Γ",etiket:"Net Gamma",deger:`${toplamlar.gamma>=0?"+":"−"}${fmtB(Math.abs(toplamlar.gamma))}`,renk:toplamlar.gamma>=0?"var(--pos)":"var(--neg)",aciklama:`Dealer'lar gamma <b>${toplamlar.gamma>=0?"uzunu":"kısası"}</b>. Implied vol vadeye kadar <b>${toplamlar.gamma>=0?"baskılanır":"yükselir"}</b>.`},
        {simge:"𝒱",etiket:"Net Vanna",deger:`${toplamlar.vanna>=0?"+":"−"}${fmtB(Math.abs(toplamlar.vanna))}`,renk:toplamlar.vanna>=0?"var(--pos)":"var(--neg)",aciklama:`∂Δ/∂σ. IV yükselince dealer delta <b>${toplamlar.vanna>=0?"spot ile birlikte":"spot'a karşı"}</b> hareket eder.`},
        {simge:"𝒞",etiket:"Net Charm",deger:`−${fmtB(Math.abs(toplamlar.charm))}`,renk:"var(--neg)",aciklama:"∂Δ/∂t. Pin etkisi vadeye yaklaştıkça güçlenir; gün içi <b>AP akışı</b> spot'tan daha önemlidir."},
      ].map(c=>(<div key={c.etiket} className="greek-cell"><div className="greek-glyph">{c.simge}</div><div className="greek-label">{c.etiket}</div><div className="greek-num tabular" style={{color:c.renk}}>{c.deger}<span style={{color:"var(--text-dim)",fontSize:16}}>$</span></div><div className="greek-foot" dangerouslySetInnerHTML={{__html:c.aciklama}}/></div>))}
    </div>
  );
}

// ─── VOLATİLİTE YÜZEYİ ───────────────────────────────────
function VadeYapisi({data}) {
  const pts=(data.volSurface?.termStructure||[]).filter(p=>p.days>0&&p.iv>5&&p.iv<200).sort((a,b)=>a.days-b.days);
  if (pts.length<2) return <div style={{color:"var(--text-mute)",fontFamily:"var(--sans)",fontSize:10,fontWeight:700,padding:"20px 0"}}>Vade yapısı hesaplanıyor...</div>;
  const W=560,H=220,pad={top:18,right:20,bottom:30,left:40};
  const maxD=Math.max(...pts.map(p=>p.days)),minIV=Math.floor(Math.min(...pts.map(p=>p.iv))/5)*5-5,maxIV=Math.ceil(Math.max(...pts.map(p=>p.iv))/5)*5+5;
  const xS=g=>pad.left+(g/maxD)*(W-pad.left-pad.right),yS=iv=>pad.top+((maxIV-iv)/(maxIV-minIV))*(H-pad.top-pad.bottom);
  const yol=pts.map((p,i)=>`${i===0?"M":"L"} ${xS(p.days)} ${yS(p.iv)}`).join(" ");
  const ivTicks=[]; for(let iv=Math.ceil(minIV/10)*10;iv<=maxIV;iv+=10)ivTicks.push(iv);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="term-svg">
      {ivTicks.map(iv=>{const y=yS(iv);if(y<pad.top-2||y>H-pad.bottom+2)return null;return<g key={iv}><line x1={pad.left} x2={W-pad.right} y1={y} y2={y} stroke="var(--hairline-soft)" strokeWidth="0.6"/><text x={pad.left-5} y={y+3} textAnchor="end" fontFamily="var(--sans)" fontSize="9" fontWeight="700" fill="var(--text-mute)">{iv}%</text></g>;})}
      {[7,30,90,180,240].filter(g=>g<=maxD).map(g=><g key={g}><line x1={xS(g)} x2={xS(g)} y1={H-pad.bottom} y2={H-pad.bottom+4} stroke="var(--hairline-strong)"/><text x={xS(g)} y={H-pad.bottom+16} textAnchor="middle" fontFamily="var(--sans)" fontSize="9" fontWeight="700" fill="var(--text-mute)">{g}g</text></g>)}
      <path d={`${yol} L ${xS(pts[pts.length-1].days)} ${H-pad.bottom} L ${pad.left} ${H-pad.bottom} Z`} fill="var(--accent)" opacity="0.06"/>
      <path d={yol} fill="none" stroke="var(--accent)" strokeWidth="1.5"/>
      {pts.map((p,i)=><g key={i}><circle cx={xS(p.days)} cy={yS(p.iv)} r="3" fill="var(--bg)" stroke="var(--accent)" strokeWidth="1.4"/><text x={xS(p.days)} y={yS(p.iv)-9} textAnchor="middle" fontFamily="var(--sans)" fontSize="9" fontWeight="700" fill="var(--text-2)">{p.iv.toFixed(0)}</text></g>)}
      <text x={pad.left} y={12} fontFamily="var(--sans)" fontSize="9" fontWeight="700" fill="var(--text-mute)" letterSpacing="0.12em">ATM IV (%)</text>
    </svg>
  );
}

function RiskReversal({data}) {
  const rows=(data.volSurface?.riskReversals||[]).filter(r=>Math.abs(r.rr)>0&&Math.abs(r.rr)<15).sort((a,b)=>a.days-b.days).slice(0,10);
  if (!rows.length) return <div style={{color:"var(--text-mute)",fontFamily:"var(--sans)",fontSize:10,fontWeight:700,padding:"20px 0"}}>25Δ Risk Reversal hesaplanıyor...</div>;
  const W=560,H=220,pad={top:22,right:20,bottom:30,left:44};
  const maxG=Math.max(...rows.map(e=>e.days)),maxRR=Math.max(...rows.map(e=>e.rr))+1.5,minRR=Math.min(0,Math.min(...rows.map(e=>e.rr))-0.5),range=maxRR-minRR;
  const xS=g=>pad.left+(g/maxG)*(W-pad.left-pad.right),yS=rr=>pad.top+((maxRR-rr)/range)*(H-pad.top-pad.bottom),y0=yS(0);
  const rrTicks=[]; for(let r=Math.floor(minRR/2)*2;r<=maxRR;r+=2)rrTicks.push(r);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="term-svg">
      {rrTicks.map(r=>{const y=yS(r);if(y<pad.top-2||y>H-pad.bottom+2)return null;return<g key={r}><line x1={pad.left} x2={W-pad.right} y1={y} y2={y} stroke={r===0?"var(--hairline-strong)":"var(--hairline-soft)"} strokeWidth={r===0?0.8:0.5}/><text x={pad.left-5} y={y+3} textAnchor="end" fontFamily="var(--sans)" fontSize="9" fontWeight="700" fill="var(--text-mute)">{r>=0?"+":""}{r} vol</text></g>;})}
      {rows.map(e=>{const bW=Math.min(36,(W-pad.left-pad.right)/rows.length*0.7),x=xS(e.days),y=e.rr>=0?yS(e.rr):y0,barH=Math.abs(yS(e.rr)-y0),renk=e.rr>=0?"var(--neg)":"var(--pos)";return<g key={e.days}><rect x={x-bW/2} y={y} width={bW} height={barH||1} fill={renk} opacity="0.55"/><line x1={x-bW/2} x2={x+bW/2} y1={y} y2={y} stroke={renk} strokeWidth="1.5"/><text x={x} y={e.rr>=0?yS(e.rr)-6:yS(e.rr)+14} textAnchor="middle" fontFamily="var(--sans)" fontSize="9" fontWeight="700" fill="var(--text-2)">{e.rr.toFixed(1)}</text><text x={x} y={H-pad.bottom+16} textAnchor="middle" fontFamily="var(--sans)" fontSize="9" fontWeight="700" fill="var(--text-mute)">{e.days}g</text></g>;})}
      <text x={pad.left} y={12} fontFamily="var(--sans)" fontSize="9" fontWeight="700" fill="var(--text-mute)" letterSpacing="0.10em">25Δ SAT − 25Δ AL (vol noktası)</text>
    </svg>
  );
}

// ─── OPSİYON SAYFASI (BTC / ETH) ─────────────────────────
function OpsiyonSayfasi({ sym, vade }) {
  const data = varlikVerisiKullan(sym, vade);
  const asset = ASSETS[sym];
  const saatStr=data.lastUpdate?.toLocaleTimeString("tr-TR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})||"—";
  const pozitif=data.toplamlar.gamma>=0;
  const cw=data.levels.callWall||0,pw=data.levels.putWall||0,sp=data.spot||1;

  useEffect(()=>{
    if (!data.loading&&data.allOptions.length>0) digerAssetPrefetch(sym);
  },[data.loading,data.allOptions.length,sym]);

  if (data.loading&&!data.allOptions.length) return (
    <div style={{display:"grid",placeItems:"center",minHeight:"calc(100vh - 53px)",color:"var(--text-mute)",fontFamily:"var(--sans)",fontSize:11,letterSpacing:"0.10em",fontWeight:600}}>
      <div style={{textAlign:"center"}}>
        <div style={{width:36,height:36,border:"1.5px solid var(--hairline-strong)",borderTopColor:asset.color,borderRadius:"50%",animation:"spin 0.9s linear infinite",margin:"0 auto 16px"}}/>
        <div style={{color:asset.color,fontWeight:700,fontSize:14,marginBottom:8}}>{asset.label}</div>
        <div>{data.progress||`${sym} opsiyon zinciri yükleniyor…`}</div>
        <div style={{marginTop:8,fontSize:10,color:"var(--text-mute)",fontWeight:400}}>1-2 dakika sürebilir</div>
      </div>
    </div>
  );

  if (data.error) return (
    <div style={{padding:"40px 36px",color:"var(--neg)",fontFamily:"var(--sans)"}}>
      <div style={{marginBottom:12}}>❌ {data.error}</div>
      <button onClick={data.yenile} style={{background:"var(--surface)",color:"var(--text)",border:"1px solid var(--hairline-strong)",padding:"6px 16px",cursor:"pointer",fontFamily:"var(--sans)",fontWeight:600}}>Tekrar Dene</button>
    </div>
  );

  return (
    <>
      {/* Varlık başlık çubuğu */}
      <div style={{padding:"8px 36px",borderBottom:"1px solid var(--hairline-soft)",display:"flex",justifyContent:"space-between",alignItems:"center",background:"var(--surface-2)"}}>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <span style={{width:8,height:8,borderRadius:"50%",background:asset.color,display:"inline-block"}}/>
          <span style={{fontFamily:"var(--sans)",fontSize:13,fontWeight:700,color:"var(--text)"}}>{asset.label}</span>
          <span style={{fontFamily:"var(--sans)",fontSize:16,fontWeight:700,color:pozitif?"var(--pos)":"var(--neg)",fontVariantNumeric:"tabular-nums"}}>
            {data.spot?`$${data.spot.toLocaleString("tr-TR",{maximumFractionDigits:0})}`:"—"}
          </span>
          <span style={{fontFamily:"var(--sans)",fontSize:11,fontWeight:700,color:pozitif?"var(--pos)":"var(--neg)"}}>
            ● {pozitif?"Pozitif Gamma":"Negatif Gamma"}
          </span>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          <span style={{fontFamily:"var(--sans)",fontSize:10,color:"var(--text-mute)",fontWeight:500}}>
            Güncellendi: <b style={{color:"var(--text)"}}>{saatStr}</b>
          </span>
          <button onClick={data.yenile} className="h-action">↻ Yenile</button>
        </div>
      </div>
      {/* i. Strike Topografyası */}
      <section className="section">
        <div className="section-head">
          <h2 className="section-title"><span className="section-nbr">i.</span>Strike Topografyası</h2>
          <span className="section-meta">{data.strikes.length} KULLANIM · {data.stats.expiries} VADE · {vade==="all"?"TÜMÜ":vade.toUpperCase()}</span>
        </div>
        <div className="ladder-wrap">
          <StrikeMerdiveni data={data} sym={sym}/>
          <div style={{display:"flex",flexDirection:"column",gap:28}}>
            <KilitSeviyeler data={data}/>
            <HullYorumuPaneli data={data} sym={sym}/>
          </div>
        </div>
      </section>

      {/* ii. Kuantum Duvarlar */}
      <section className="section">
        <div className="section-head">
          <h2 className="section-title"><span className="section-nbr">ii.</span>Kuantum Duvarlar</h2>
          <span className="section-meta">{data.classified.filter(c=>c.wallType==="callWall").length} CALL WALL · {data.classified.filter(c=>c.wallType==="putWall").length} PUT WALL · {data.classified.filter(c=>c.wallType==="magnet").length} MIKNATIK</span>
        </div>
        <KuantumDuvarlar data={data} sym={sym}/>
      </section>

      {/* iii. Toplu Greek'ler */}
      <section className="section">
        <div className="section-head">
          <h2 className="section-title"><span className="section-nbr">iii.</span>Toplu Greek'ler</h2>
          <span className="section-meta">DEALER-NORMALIZE · USD CİNSİNDEN</span>
        </div>
        <TopluGreekler data={data}/>
      </section>

      {/* iv. Volatilite Yüzeyi */}
      <section className="section">
        <div className="section-head">
          <h2 className="section-title"><span className="section-nbr">iv.</span>Volatilite Yüzeyi</h2>
          <span className="section-meta">VADE YAPISI · RISK REVERSAL EĞİMİ</span>
        </div>
        <div className="term-card">
          <div>
            <div className="sheet-label" style={{marginBottom:12}}>ATM Vade Yapısı</div>
            <VadeYapisi data={data}/>
            <p style={{fontFamily:"var(--sans)",fontSize:10,fontWeight:700,color:"var(--text-dim)",marginTop:8,lineHeight:1.55}}>
              {data.volSurface?.termStructure?.length>0?`${data.volSurface.termStructure.length} vade · Log-moneyness interpolasyonu · ATM IV ~${data.dvol.toFixed(0)}%`:"Hesaplanıyor..."}
            </p>
          </div>
          <div>
            <div className="sheet-label" style={{marginBottom:12}}>25Δ Risk Reversal</div>
            <RiskReversal data={data}/>
            <p style={{fontFamily:"var(--sans)",fontSize:10,fontWeight:700,color:"var(--text-dim)",marginTop:8,lineHeight:1.55}}>
              {data.volSurface?.riskReversals?.length>0?`RR = IV(25Δ sat) − IV(25Δ al) · ${data.volSurface.riskReversals.length} vade`:"Hesaplanıyor..."}
            </p>
          </div>
        </div>
      </section>

      {/* v. Pozisyon Analizi */}
      <section className="section">
        <div className="section-head">
          <h2 className="section-title"><span className="section-nbr">v.</span>Pozisyon · Analiz</h2>
          <span className="section-meta">DEALER AKIŞI · MASA NOTLARI</span>
        </div>
        <div className="two-up">
          <div>
            <p className="pull" style={{marginBottom:24}}>Put Wall ile Call Wall arasındaki <em>${fmt(cw-pw)}</em> bant gerçekleşen volatiliteyi sınırlar — tepeden dibe <em>{((cw-pw)/sp*100).toFixed(1)}%</em>.</p>
            <p style={{fontFamily:"var(--sans)",fontSize:12,fontWeight:400,color:"var(--text-2)",lineHeight:1.7,margin:0}}>
              Dealer'lar bu haftaya {pozitif?"net long":"net short"} {fmtB(data.toplamlar.gamma)}$ gamma ile giriyor, <b style={{color:"var(--text)"}}>{fmt(data.levels.callWall)}</b> Call Wall'unda yoğunlaşmış. Bu yapısal bir <b style={{color:"var(--text)"}}>mean-reversion</b> eğilimi yaratır.
            </p>
          </div>
          <div>
            <div className="sheet-label" style={{marginBottom:14}}>Senaryolar</div>
            {[
              {etiket:"Spot yukarı kırar ↑", hedef:data.levels.callWall, not:"dealer'lar delta satmaya başlar"},
              {etiket:"Spot sabitlenir",      hedef:data.levels.maxPain,  not:"vol vadeye kadar düşer"},
              {etiket:"Spot aşağı kırar ↓",  hedef:data.levels.putWall,  not:"gamma negatife döner, vol genişler"},
              {etiket:"Haftalık kapanış",     hedef:data.levels.maxPain,  not:"Max Pain mıknatısı"},
            ].map(s=>(
              <div key={s.etiket} style={{display:"grid",gridTemplateColumns:"1fr auto",gap:16,padding:"11px 0",borderBottom:"1px solid var(--hairline-soft)"}}>
                <div>
                  <div style={{fontFamily:"var(--sans)",color:"var(--text)",fontSize:13,fontWeight:600,marginBottom:2}}>{s.etiket}</div>
                  <div style={{fontFamily:"var(--sans)",color:"var(--text-mute)",fontSize:10,fontWeight:700}}>{s.not}</div>
                </div>
                <div style={{textAlign:"right"}}><div className="tabular" style={{color:"var(--accent)",fontSize:14,fontFamily:"var(--serif)"}}>${fmt(s.hedef)}</div></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="footer">
        <div>
          <div style={{marginBottom:4,fontFamily:"var(--sans)",fontSize:11,fontWeight:500}}>Opsiyon Masası · {asset.label} ({sym}) · Deribit</div>
          <div style={{color:"var(--text-dim)",fontFamily:"var(--sans)",fontSize:10,fontWeight:400}}>
            {new Date().toLocaleDateString("tr-TR",{weekday:"long",day:"numeric",month:"long",year:"numeric"})} · {data.stats.rows} kontrat · {data.stats.expiries} vade
          </div>
        </div>
        <div className="footer-pagenum">— {sym} Gamma —</div>
      </footer>
    </>
  );
}

// ─── ANA SAYFA ────────────────────────────────────────────
export default function AnaSayfa() {
  const [aktifSekme, setAktifSekme] = useState("BTC");
  const [vade, setVade]             = useState("all");
  const [izleme, setIzleme]         = useState([
    {sym:"BTC",label:"Bitcoin", fiyat:0,degisim:0},
    {sym:"ETH",label:"Ethereum",fiyat:0,degisim:0},
  ]);

  // Watchlist güncelle
  useEffect(()=>{
    const guncelle=()=>fetchWatchlist().then(wl=>{
      if (wl?.length) setIzleme(wl.map(w=>({...w,fiyat:w.price,degisim:w.chg})));
    }).catch(()=>{});
    guncelle();
    const iv=setInterval(guncelle,60*1000);
    return()=>clearInterval(iv);
  },[]);

  const aktifVarlik = ASSETS[aktifSekme];

  return (
    <>
      <Head><title>Opsiyon Masası · {aktifSekme}</title></Head>
      <div className="app">
        <KenarCubugu
          izleme={izleme}
          aktifSekme={aktifSekme}
          setAktifSekme={s=>{setAktifSekme(s); if(s!=="MAKRO") setVade("all");}}
          vade={vade}
          setVade={setVade}
        />

        <main className="main">
          {/* Üst başlık çubuğu */}
          <div className="header">
            <div className="header-trail">
              <span className="crumb">Masa</span><span className="sep">/</span>
              <span className="crumb">Kripto Opsiyonları</span><span className="sep">/</span>
              <span style={{display:"flex",alignItems:"center",gap:6}}>
                {aktifSekme!=="MAKRO" && aktifVarlik && <span style={{width:8,height:8,borderRadius:"50%",background:aktifVarlik.color,display:"inline-block"}}/>}
                <span className="crumb active">
                  {aktifSekme==="MAKRO"?"📊 Makro Ekonomi":`${aktifSekme} · Gamma`}
                </span>
              </span>
            </div>
            <div className="header-actions">

              <button className="h-action">⤓ PDF İndir</button>
            </div>
          </div>

          {/* İçerik */}
          {aktifSekme==="MAKRO"
            ? <MakroSayfasi/>
            : <OpsiyonSayfasi sym={aktifSekme} vade={vade}/>
          }
        </main>
      </div>
    </>
  );
}
