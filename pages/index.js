import React, { useState, useEffect, useRef, useCallback, Fragment } from "react";
import Head from "next/head";
import {
  ASSETS,
  fetchSpot, fetchWatchlist, fetchTicker24h, fetchFunding, fetchBasis,
  fetchDeribitInstruments, fetchAllOptions,
  aggregateByStrike, findLevels, classifyStrikes, calcVolSurface,
} from "../lib/gex";

// ─── Helpers ──────────────────────────────────────────────
const fmt  = n => (n!=null&&n!==0)?Math.round(n).toLocaleString("tr-TR"):"—";
const fmtB = n => { if(n==null)return"—"; const a=Math.abs(n); if(a>=1e9)return`${(n/1e9).toFixed(2)}Mr`; if(a>=1e6)return`${(n/1e6).toFixed(1)}M`; if(a>=1e3)return`${(n/1e3).toFixed(0)}K`; return n.toFixed(0); };
const fmtM = n => { if(n==null)return"—"; const a=Math.abs(n); if(a>=1e9)return`${(n/1e9).toFixed(3)}B$`; if(a>=1e6)return`${(n/1e6).toFixed(2)}M$`; if(a>=1e3)return`${(n/1e3).toFixed(1)}K$`; return`${n.toFixed(0)}$`; };

// ═══════════════════════════════════════════════════════════
// GLOBAL CACHE — component dışında, sekme değişiminde korunur
// Her asset'in raw verisi burada tutulur.
// Cache structure: { BTC: { raw, loadedAt }, ETH: {...} }
// ═══════════════════════════════════════════════════════════
const CACHE = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 dakika

const EMPTY_RAW = {
  spot: 0, allOptions: [], ticker24h: { open:0, high:0, low:0, change:0, volume:0 },
  funding: 0, basis: 0, dvol: 50,
  loading: true, error: null, progress: "", lastUpdate: null,
  stats: { rows:0, totalInst:0, expiries:0 },
};

// ═══════════════════════════════════════════════════════════
// GLOBAL DATA MANAGER — her asset için bağımsız yükleme
// ═══════════════════════════════════════════════════════════
const listeners = {}; // { BTC: Set<callback>, ETH: Set<callback> }
const loading   = {}; // { BTC: bool, ETH: bool } — duplicate fetch engeli

function notify(sym) {
  (listeners[sym] || new Set()).forEach(cb => cb());
}

async function loadAsset(sym, force=false) {
  // Cache geçerliyse tekrar yükleme
  if (!force && CACHE[sym] && (Date.now() - CACHE[sym].loadedAt) < CACHE_TTL) {
    notify(sym);
    return;
  }
  // Zaten yükleniyorsa bekle
  if (loading[sym]) return;
  loading[sym] = true;

  // Loading state'i güncelle (cache yoksa boş state)
  if (!CACHE[sym]) {
    CACHE[sym] = { raw: { ...EMPTY_RAW, loading: true, progress: "Spot fiyat alınıyor..." }, loadedAt: 0 };
  } else {
    CACHE[sym].raw = { ...CACHE[sym].raw, loading: false }; // sessiz yenileme
  }
  notify(sym);

  try {
    const setProgress = p => {
      if (CACHE[sym]) { CACHE[sym].raw = { ...CACHE[sym].raw, progress: p }; notify(sym); }
    };

    setProgress("Spot fiyat alınıyor...");
    const [spot, ticker24h, funding, basis] = await Promise.allSettled([
      fetchSpot(sym), fetchTicker24h(sym), fetchFunding(sym), fetchBasis(sym),
    ]).then(rs => rs.map(r => r.status === "fulfilled" ? r.value : null));

    CACHE[sym].raw = { ...CACHE[sym].raw, spot: spot||0, ticker24h: ticker24h||EMPTY_RAW.ticker24h, funding: funding||0, basis: basis||0 };
    setProgress(`${sym} opsiyon zinciri çekiliyor...`);

    const instruments = await fetchDeribitInstruments(sym);
    if (!instruments.length) throw new Error(`${sym} opsiyon verisi alınamadı`);

    const { options, stats } = await fetchAllOptions(instruments, spot||0, sym, (pct, rows, exps) => {
      setProgress(`${sym} analiz: %${pct} · ${rows} opt · ${exps} vade`);
    });

    const atmOpt = options.filter(o => o.type === "call").sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0];

    CACHE[sym].raw = {
      spot: spot||0, allOptions: options, ticker24h: ticker24h||EMPTY_RAW.ticker24h,
      funding: funding||0, basis: basis||0, stats,
      dvol: atmOpt ? atmOpt.iv * 100 : 50,
      loading: false, error: null, progress: "", lastUpdate: new Date(),
    };
    CACHE[sym].loadedAt = Date.now();
  } catch(e) {
    if (CACHE[sym]) CACHE[sym].raw = { ...CACHE[sym].raw, loading: false, error: e.message, progress: "" };
  }

  loading[sym] = false;
  notify(sym);
}

// Her asset için 5 dakikada bir otomatik yenileme
const refreshTimers = {};
function startAutoRefresh(sym) {
  if (refreshTimers[sym]) return;
  refreshTimers[sym] = setInterval(() => loadAsset(sym, true), CACHE_TTL);
}

// ─── useAssetData hook ────────────────────────────────────
// Sadece CACHE[sym].raw'ı okur, cache değişince re-render
function useAssetData(sym, vadeFiltresi) {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    // Listener kaydet
    if (!listeners[sym]) listeners[sym] = new Set();
    const cb = () => forceUpdate(n => n + 1);
    listeners[sym].add(cb);

    // Cache boşsa yükle, doluysa anında göster + arka planda yenile
    if (!CACHE[sym] || !CACHE[sym].raw.allOptions.length) {
      loadAsset(sym);
    } else {
      forceUpdate(n => n + 1); // anında mevcut cache'i göster
      // TTL geçtiyse sessiz yenile
      if (Date.now() - (CACHE[sym].loadedAt||0) > CACHE_TTL) {
        loadAsset(sym, true);
      }
    }

    startAutoRefresh(sym);

    return () => { listeners[sym]?.delete(cb); };
  }, [sym]);

  const raw = CACHE[sym]?.raw || { ...EMPTY_RAW };

  // Vade filtresine göre derived data — sadece vade veya raw değişince
  const strikes    = aggregateByStrike(raw.allOptions, vadeFiltresi);
  const levels     = findLevels(strikes, raw.spot, raw.allOptions);
  const classified = classifyStrikes(strikes, raw.spot);
  const volSurface = calcVolSurface(raw.allOptions, raw.spot);
  const totals = {
    gamma: strikes.reduce((a, x) => a + x.netGex,   0),
    vanna: strikes.reduce((a, x) => a + x.vannaNet, 0),
    charm: strikes.reduce((a, x) => a + x.charmNet, 0),
  };

  return {
    ...raw, strikes, levels, classified, totals, volSurface,
    yenile: () => loadAsset(sym, true),
  };
}

// ─── Prefetch diğer asset ─────────────────────────────────
// Aktif asset yüklenince diğerini arka planda başlat
function prefetchOther(activeSym) {
  const others = Object.keys(ASSETS).filter(s => s !== activeSym);
  others.forEach(sym => {
    if (!CACHE[sym] || !CACHE[sym].raw.allOptions.length) {
      setTimeout(() => loadAsset(sym), 3000); // 3sn geciktir
    }
  });
}

// ─── Hull Commentary ──────────────────────────────────────
function hullYorum(data, sym) {
  const {spot,levels,totals,volSurface,dvol}=data;
  if (!spot||!levels.callWall) return null;
  const {callWall,putWall,maxPain,zeroGamma,emHigh,emLow}=levels;
  const cw=callWall||0,pw=putWall||0,band=cw-pw;
  const distToCW=(((cw-spot)/spot)*100).toFixed(1),distToPW=(((spot-pw)/spot)*100).toFixed(1);
  const distToMP=maxPain?(((maxPain-spot)/spot)*100).toFixed(1):null;
  const posGamma=totals.gamma>=0;
  const ts=volSurface?.termStructure||[],rr=volSurface?.riskReversals||[];
  const shortIV=ts.find(p=>p.days<=14)?.iv?.toFixed(0),longIV=ts.find(p=>p.days>=60)?.iv?.toFixed(0);
  const termSlope=ts.length>=2?(ts[ts.length-1].iv>ts[0].iv?"contango":"backwardation"):null;
  const frontRR=rr.find(r=>r.days<=14),putBias=frontRR?.rr>0,rrVal=frontRR?.rr?.toFixed(1);
  const bandPct=((band/spot)*100).toFixed(1);
  const rejiim=posGamma?`Hull (Bölüm 19.6): Dealer net long gamma — piyasa yapıcılar fiyat yükseldikçe ${sym} satıyor, düştükçe alıyor. Mean-reversion akışı volatiliteyi baskılar. Spot ${fmt(cw)} Call Wall'una yaklaştıkça delta hedging baskısı artar.`:`Hull (Bölüm 19.6): Dealer net short gamma — piyasa yapıcılar trendle aynı yönde işlem yapıyor. Momentum etkisi volatiliteyi amplify eder. Zero Gamma ${fmt(zeroGamma)} seviyesinin üstüne çıkış kritik.`;
  const mpYorum=distToMP?`Hull (Bölüm 19.5): Spot, Max Pain ${fmt(maxPain)} seviyesinin %${Math.abs(parseFloat(distToMP)).toFixed(1)} ${parseFloat(distToMP)>0?"üstünde":"altında"}. Charm etkisiyle (∂Δ/∂t) pin baskısı ${fmt(maxPain)}'e doğru güçlenir.`:"";
  const vannaYorum=totals.vanna!==0?`Hull (Bölüm 19.8): Vanna ${fmtM(totals.vanna)} — IV değişiminin delta üzerindeki etkisi ${totals.vanna>0?"spot ile aynı yönde":"spot'a karşı"}. ${dvol.toFixed(0)}% IV seviyesinde ${totals.vanna>0?"yükseliş":"düşüş"} baskısı vanna flow'unu güçlendirir.`:"";
  const volYorum=termSlope&&shortIV&&longIV?`Hull (Bölüm 20.5): IV term structure ${termSlope==="contango"?"normal eğimli (contango)":"ters (backwardation)"}; kısa vade ${shortIV}%, uzun vade ${longIV}%.${rrVal?(putBias?` 25Δ RR +${rrVal} vol (put bias) — piyasa aşağı hareket için prim ödüyor.`:` 25Δ RR ${rrVal} vol (call bias) — piyasa yukarı hareket için prim ödüyor.`):""}`:""  ;
  const emYorum=emHigh&&emLow?`Hull (Bölüm 15.7): 1σ Beklenen Hareket ${fmt(emLow)}–${fmt(emHigh)} (±%${((emHigh-emLow)/2/spot*100).toFixed(1)}). ${bandPct}% GEX bandı EM bandını ${parseFloat(bandPct)<parseFloat(((emHigh-emLow)/spot*100).toFixed(1))*0.5?"destekler — volatilite sıkışma riski var":"aşıyor — bant kırılması halinde hızlı hareket olası"}.`:"";
  return{rejiim,mpYorum,vannaYorum,volYorum,emYorum,posGamma,netGexStr:fmtM(totals.gamma),cw,pw,band,distToCW,distToPW};
}

// ─── SIDEBAR ──────────────────────────────────────────────
function Sidebar({ watchlist, activeSym, setActiveSym, vade, setVade, data }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">œ</div>
        <div>
          <div className="brand-name">Options Desk</div>
          <div className="brand-sub">Vol &amp; Gamma · v.4.2</div>
        </div>
      </div>
      <div className="sb-section">
        <div className="sb-label">Varlıklar</div>
        {watchlist.map(w => {
          const asset=ASSETS[w.sym], isActive=w.sym===activeSym;
          const cached=CACHE[w.sym]; const isLoaded=cached&&cached.raw?.allOptions?.length>0;
          return (
            <div key={w.sym} className={`sb-item ${isActive?"active":""}`} style={{cursor:"pointer"}} onClick={()=>setActiveSym(w.sym)}>
              <span className="sb-item-key tabular" style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{width:6,height:6,borderRadius:"50%",background:isLoaded?asset?.color:"var(--hairline-strong)",display:"inline-block",flexShrink:0,transition:"background 0.3s"}}/>
                {w.sym}/USD
              </span>
              <span className="sb-item-val">
                <span style={{color:"var(--text)"}}>{w.price?w.price.toLocaleString("tr-TR",{maximumFractionDigits:w.price<10?4:w.price<100?2:0}):"—"}</span>
                <span className={w.chg>=0?"pos":"neg"} style={{marginLeft:8}}>{w.chg>=0?"+":""}{(w.chg||0).toFixed(2)}%</span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="sb-section">
        <div className="sb-label">Vade Filtresi</div>
        <div className="sb-chip-row">
          {[["all","Tümü"],["0-7d","0-7g"],["8-45d","8-45g"],["45d+","45g+"]].map(([v,l])=>(
            <button key={v} className={`sb-chip ${vade===v?"active":""}`} onClick={()=>setVade(v)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="sb-section">
        <div className="sb-label">Piyasa Verileri</div>
        <SbStat label="DVOL"        value={data.dvol.toFixed(1)}/>
        <SbStat label="ATM IV"      value={`${data.dvol.toFixed(1)}%`}/>
        <SbStat label="Funding"     value={`${(data.funding*100).toFixed(3)}%`} pos={data.funding>=0}/>
        <SbStat label="Basis (90g)" value={data.basis?`${data.basis>0?"+":""}${data.basis.toFixed(1)}%`:"+7.4%"} pos/>
        <SbStat label="25Δ Skew"    value="+6.4 vol" pos={false}/>
      </div>
      <div className="sb-section" style={{marginTop:"auto"}}>
        <div className="sb-label">Seans</div>
        <SbStat label="Açılış"       value={fmt(data.ticker24h.open)}/>
        <SbStat label="Yüksek (24s)" value={fmt(data.ticker24h.high)}/>
        <SbStat label="Düşük (24s)"  value={fmt(data.ticker24h.low)}/>
        <SbStat label="Opsiyon"      value={`${data.stats.rows} adet`}/>
      </div>
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

// ─── STRIKE LADDER ────────────────────────────────────────
function StrikeLadder({ data, sym }) {
  const {strikes,spot,levels,classified}=data;
  const [hoveredStrike,setHoveredStrike]=useState(null);
  const lo=spot*0.90,hi=spot*1.10;
  const vis=[...classified.filter(s=>s.strike>=lo&&s.strike<=hi)].sort((a,b)=>b.strike-a.strike);
  const maxCall=Math.max(...vis.map(s=>s.callGex),1);
  const maxPut=Math.max(...vis.map(s=>Math.abs(s.putGex)),1);
  const tagFor=strike=>{if(strike===levels.callWall)return{txt:"CW",cls:"cw"};if(strike===levels.putWall)return{txt:"PW",cls:"pw"};if(strike===levels.maxPain)return{txt:"MP",cls:"mp"};if(strike===levels.zeroGamma)return{txt:"ZΓ",cls:"zg"};return null;};
  const spotIdx=vis.findIndex(s=>s.strike<spot);
  const hovered=hoveredStrike?vis.find(s=>s.strike===hoveredStrike):null;
  const wallTypeFor=s=>{if(s.wallType==="callWall")return{txt:"CALL WALL",renk:"var(--pos)"};if(s.wallType==="putWall")return{txt:"PUT WALL",renk:"var(--neg)"};if(s.wallType==="magnet")return{txt:"MAGNET",renk:"var(--neutral)"};return{txt:"NEUTRAL",renk:"var(--text-dim)"};};

  return (
    <div className="ladder" style={{position:"relative"}}>
      {/* Tooltip */}
      {hovered&&(()=>{
        const wt=wallTypeFor(hovered);
        return (
          <div style={{position:"absolute",top:0,right:0,background:"var(--surface)",border:"1px solid var(--hairline-strong)",borderRadius:4,fontFamily:"var(--sans)",pointerEvents:"none",zIndex:200,minWidth:215,overflow:"hidden",boxShadow:"0 4px 24px rgba(0,0,0,0.5)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",borderBottom:"1px solid var(--hairline)",background:"var(--surface-2)"}}>
              <span style={{fontSize:14,fontWeight:700,color:"var(--text)",fontFamily:"var(--sans)"}}>${fmt(hovered.strike)}</span>
              <span style={{fontSize:9,fontWeight:700,letterSpacing:"0.1em",color:wt.renk}}>{wt.txt}</span>
            </div>
            {[
              ["Net GEX",(hovered.netGex>=0?"+":"−")+fmtM(Math.abs(hovered.netGex)),hovered.netGex>=0?"var(--pos)":"var(--neg)"],
              ["Call GEX","+"+fmtM(hovered.callGex),"var(--pos)"],
              ["Put GEX","−"+fmtM(Math.abs(hovered.putGex)),"var(--neg)"],
              ["Call OI",hovered.callOI.toFixed(1)+" "+sym,"var(--text)"],
              ["Put OI",hovered.putOI.toFixed(1)+" "+sym,"var(--text)"],
              ["OI density",hovered.oiPct+"%","var(--text)"],
              ["γ density",hovered.gexPct+"%","var(--text)"],
            ].map(([lbl,val,clr])=>(
              <div key={lbl} style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",padding:"4px 12px",borderBottom:"1px solid var(--hairline-soft)"}}>
                <span style={{color:"var(--text-dim)",fontSize:10,fontWeight:600,fontFamily:"var(--sans)"}}>{lbl}</span>
                <span style={{color:clr,fontWeight:700,fontSize:11,fontFamily:"var(--sans)"}}>{val}</span>
              </div>
            ))}
          </div>
        );
      })()}
      <div className="ladder-header">
        <div>Etiket</div><div>OI %</div>
        <div style={{textAlign:"right",paddingRight:14}}>Put γ</div>
        <div>Strike</div>
        <div style={{paddingLeft:14}}>Call γ</div>
        <div>Net γ</div><div>Δ%</div>
      </div>
      {vis.map((s,i)=>{
        const tag=tagFor(s.strike),callPct=s.callGex/maxCall*100,putPct=Math.abs(s.putGex)/maxPut*100,dist=(s.strike-spot)/spot*100,isHov=hoveredStrike===s.strike;
        return (
          <Fragment key={s.strike}>
            {i===spotIdx&&(<div className="ladder-row spot"><div className="tag" style={{color:"var(--accent)"}}>◆</div><div/><div className="bar-cell put"/><div className="strike-cell tabular" style={{color:"var(--accent)",fontWeight:700}}>{fmt(spot)}</div><div className="bar-cell call"/><div className="net" style={{color:"var(--accent)"}}>—</div><div className="dist" style={{color:"var(--accent)"}}>0.00%</div></div>)}
            <div className="ladder-row" style={{background:isHov?"rgba(196,165,116,0.06)":undefined}} onMouseEnter={()=>setHoveredStrike(s.strike)} onMouseLeave={()=>setHoveredStrike(null)}>
              <div className={`tag ${tag?.cls||""}`}>{tag?.txt||""}</div>
              <div style={{fontFamily:"var(--sans)",fontSize:11,fontWeight:700,color:"var(--text-dim)",textAlign:"center"}}>{s.oiPct}%</div>
              <div className="bar-cell put"><div className="bar put" style={{width:`${putPct}%`,opacity:isHov?1:0.85}}/></div>
              <div className="strike-cell tabular">{fmt(s.strike)}</div>
              <div className="bar-cell call"><div className="bar call" style={{width:`${callPct}%`,opacity:isHov?1:0.85}}/></div>
              <div className="net tabular" style={{color:s.netGex>=0?"var(--pos)":"var(--neg)"}}>{s.netGex>=0?"+":"−"}{fmtB(Math.abs(s.netGex))}</div>
              <div className={`dist tabular ${dist>=0?"pos":"neg"}`}>{dist>=0?"+":""}{dist.toFixed(1)}%</div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

// ─── KEY LEVELS ───────────────────────────────────────────
function KeyLevels({data}) {
  const {levels}=data;
  const liste=[
    {isim:"Call Wall",      aciklama:"Max positive γ",    deger:levels.callWall,  renk:"var(--pos)",      pct:levels.callWallPct},
    {isim:"Expected Move ↑",aciklama:"1σ end-of-week",   deger:levels.emHigh,    renk:"var(--neutral)",  pct:levels.emHighPct},
    {isim:"Max Pain",       aciklama:"Min writer payoff", deger:levels.maxPain,   renk:"var(--accent)",   pct:levels.maxPainPct},
    {isim:"Zero Gamma",     aciklama:"Regime flip",       deger:levels.zeroGamma, renk:"var(--text-dim)", pct:levels.zeroGammaPct},
    {isim:"Expected Move ↓",aciklama:"1σ end-of-week",   deger:levels.emLow,     renk:"var(--neutral)",  pct:levels.emLowPct},
    {isim:"Put Wall",       aciklama:"Max negative γ",    deger:levels.putWall,   renk:"var(--neg)",      pct:levels.putWallPct},
  ];
  return (
    <div className="sheet">
      <div className="sheet-block" style={{borderTop:"none",paddingTop:0}}>
        <div className="sheet-label">Key Levels</div>
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

// ─── HULL COMMENTARY ──────────────────────────────────────
function HullCommentary({data,sym}) {
  const yorum=hullYorum(data,sym);
  if (!yorum) return null;
  const satirlar=[yorum.rejiim,yorum.mpYorum,yorum.vannaYorum,yorum.volYorum,yorum.emYorum].filter(Boolean);
  return (
    <div style={{background:"var(--surface)",border:"1px solid var(--hairline)",borderTop:`2px solid ${yorum.posGamma?"var(--pos)":"var(--neg)"}`,padding:"16px 18px",display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
        <div>
          <span style={{fontFamily:"var(--sans)",fontSize:10,fontWeight:600,color:"var(--text-mute)",letterSpacing:"0.10em",textTransform:"uppercase"}}>Hull Analizi · Anlık Yorum</span>
          <div style={{fontFamily:"var(--serif)",fontStyle:"italic",fontSize:14,color:yorum.posGamma?"var(--pos)":"var(--neg)",marginTop:2}}>{yorum.posGamma?"● Pozitif Gamma Rejimi":"● Negatif Gamma Rejimi"}</div>
        </div>
        <div style={{textAlign:"right"}}>
          <div style={{fontFamily:"var(--sans)",color:"var(--text-mute)",fontSize:10,fontWeight:600}}>Net GEX</div>
          <div style={{color:yorum.posGamma?"var(--pos)":"var(--neg)",fontWeight:700,fontSize:13,fontFamily:"var(--sans)"}}>{yorum.netGexStr}</div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,padding:"10px 0",borderTop:"1px solid var(--hairline-soft)",borderBottom:"1px solid var(--hairline-soft)"}}>
        {[{lbl:"Call Wall",val:yorum.cw,pct:"+"+yorum.distToCW+"%",clr:"var(--pos)"},{lbl:"Bant",val:yorum.band,clr:"var(--accent)",center:true},{lbl:"Put Wall",val:yorum.pw,pct:"−"+yorum.distToPW+"%",clr:"var(--neg)",right:true}].map((r,i)=>(
          <div key={i} style={{textAlign:r.center?"center":r.right?"right":"left"}}>
            <div style={{fontFamily:"var(--sans)",fontSize:10,fontWeight:600,color:"var(--text-mute)",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:2}}>{r.lbl}</div>
            <div style={{fontFamily:"var(--serif)",fontSize:15,color:r.clr,fontWeight:600}}>${fmt(r.val)}</div>
            {r.pct&&<div style={{fontFamily:"var(--sans)",fontSize:9,color:r.clr,opacity:0.7}}>{r.pct}</div>}
          </div>
        ))}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {satirlar.map((s,i)=>(
          <div key={i} style={{fontFamily:"var(--sans)",fontSize:10,fontWeight:700,color:"var(--text-2)",lineHeight:1.55,paddingLeft:10,borderLeft:`2px solid ${i===0?(yorum.posGamma?"var(--pos)":"var(--neg)"):"var(--hairline-strong)"}`}}>{s}</div>
        ))}
      </div>
      <div style={{fontFamily:"var(--sans)",fontSize:10,fontWeight:400,color:"var(--text-mute)",borderTop:"1px solid var(--hairline-soft)",paddingTop:8}}>Hull, J.C. "Options, Futures, and Other Derivatives" 11e · Bölüm 19–20</div>
    </div>
  );
}

// ─── QUANTUM WALLS ────────────────────────────────────────
function QuantumWalls({data,sym}) {
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
  const topWalls=[...vis].filter(s=>s.isMajor).sort((a,b)=>Math.abs(b.netGex)-Math.abs(a.netGex)).slice(0,8);
  const handleFare=e=>{const rect=svgRef.current?.getBoundingClientRect();if(!rect)return;const sy=(e.clientY-rect.top)*(H/rect.height),fiyat=hi-((sy-pad.top)/cH)*(hi-lo);let best=null,bestD=Infinity;for(const s of vis){const d=Math.abs(s.strike-fiyat);if(d<bestD){bestD=d;best=s;}}if(best&&bestD<(hi-lo)*0.025){setIpucu(best);setHover(best.strike);}else{setIpucu(null);setHover(null);}};
  const seviyeRozeti=[{p:levels.callWall,l:"CW",c:"var(--pos)"},{p:levels.emHigh,l:"EM↑",c:"var(--neutral)"},{p:levels.zeroGamma,l:"ZΓ",c:"var(--text-dim)"},{p:levels.maxPain,l:"MP",c:"var(--accent)"},{p:levels.emLow,l:"EM↓",c:"var(--neutral)"},{p:levels.putWall,l:"PW",c:"var(--neg)"}].filter(x=>x.p&&x.p>=lo&&x.p<=hi);
  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 290px",gap:32}}>
      <div>
        <div style={{display:"flex",justifyContent:"space-between",fontFamily:"var(--sans)",fontSize:10,fontWeight:700,color:"var(--text-mute)",marginBottom:10}}>
          <span>|GAMMA EXPOSURE| · USD</span>
          <span>{vis.filter(s=>s.wallType==="callWall").length} WALLS · {vis.filter(s=>s.wallType==="magnet").length} MAGNETS</span>
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
                {s.isMajor&&rowH>=3&&totalW>140&&lTur&&(<g><line x1={pad.left+totalW+5} x2={W-pad.right} y1={y} y2={y} stroke={lRenk} strokeWidth="0.8" strokeDasharray="4 3" opacity="0.28"/><text x={pad.left+totalW/2} y={y+3.5} textAnchor="middle" fontFamily="var(--sans)" fontSize="9" fontWeight="700" fill={lRenk}>{`▸ ${lTur}  ${fmtB(Math.abs(s.netGex))}  OI ${s.oiPct}%`}</text></g>)}
              </g>);
            })}
            {seviyeRozeti.map((it,i)=>{const y=yS(it.p);if(y<pad.top-10||y>H-pad.bottom+10)return null;return(<g key={`lvl-${i}`}><line x1={pad.left} x2={W-pad.right} y1={y} y2={y} stroke={it.c} strokeWidth="0.7" strokeDasharray="3 5" opacity="0.25"/><rect x={pad.left-56} y={y-9} width="48" height="18" rx="3" fill="var(--surface)" stroke={it.c} strokeWidth="1"/><text x={pad.left-32} y={y+4} textAnchor="middle" fontFamily="var(--sans)" fontSize="9" fontWeight="700" fill={it.c}>{it.l}</text></g>);})}
            {(()=>{const y=yS(spot);if(y<pad.top||y>H-pad.bottom)return null;return(<g><line x1={pad.left} x2={W-pad.right} y1={y} y2={y} stroke="var(--accent)" strokeWidth="1.8" opacity="0.9"/><rect x={pad.left-56} y={y-10} width="48" height="20" rx="3" fill="var(--accent)"/><text x={pad.left-32} y={y+5} textAnchor="middle" fontFamily="var(--sans)" fontSize="10" fontWeight="700" fill="#0a0a0a">SPOT</text></g>)})()}
            <line x1={pad.left} x2={W-pad.right} y1={H-pad.bottom} y2={H-pad.bottom} stroke="var(--hairline)"/>
            {[0,0.25,0.5,0.75,1].map(p=>{const x=pad.left+p*cW*0.92,v=p*maxBar;return(<g key={p}><line x1={x} x2={x} y1={H-pad.bottom} y2={H-pad.bottom+4} stroke="var(--hairline)"/><text x={x} y={H-pad.bottom+16} textAnchor="middle" fontFamily="var(--sans)" fontSize="9" fontWeight="700" fill="var(--text-mute)">${fmtB(v)}</text></g>);})}
            <text x={(pad.left+W-pad.right)/2} y={H-pad.bottom+34} textAnchor="middle" fontFamily="var(--sans)" fontSize="9" fontWeight="700" fill="var(--text-mute)">|Gamma Exposure| · $</text>
          </svg>
          {ipucu&&(()=>{const wl=ipucu.wallType==="callWall"?{txt:"CALL WALL",renk:"var(--pos)"}:ipucu.wallType==="putWall"?{txt:"PUT WALL",renk:"var(--neg)"}:ipucu.wallType==="magnet"?{txt:"MAGNET",renk:"var(--neutral)"}:{txt:"NEUTRAL",renk:"var(--text-dim)"};return(<div style={{position:"absolute",top:8,right:8,background:"var(--surface)",border:"1px solid var(--hairline-strong)",borderRadius:4,fontFamily:"var(--sans)",pointerEvents:"none",zIndex:100,minWidth:200,overflow:"hidden"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",borderBottom:"1px solid var(--hairline)",background:"var(--surface-2)"}}><span style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>${fmt(ipucu.strike)}</span><span style={{fontSize:9,fontWeight:700,letterSpacing:"0.1em",color:wl.renk}}>{wl.txt}</span></div>
            {[["Net GEX",(ipucu.netGex>=0?"+":"−")+fmtM(Math.abs(ipucu.netGex)),ipucu.netGex>=0?"var(--pos)":"var(--neg)"],["Call GEX","+"+fmtM(ipucu.callGex),"var(--pos)"],["Put GEX","−"+fmtM(Math.abs(ipucu.putGex)),"var(--neg)"],["OI density",ipucu.oiPct+"%","var(--text)"],["γ density",ipucu.gexPct+"%","var(--text)"]].map(([e,d,r])=>(<div key={e} style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",padding:"5px 12px",borderBottom:"1px solid var(--hairline-soft)"}}><span style={{color:"var(--text-dim)",fontSize:10,fontWeight:600}}>{e}</span><span style={{color:r,fontWeight:700,fontSize:11}}>{d}</span></div>))}
          </div>)})()}
        </div>
      </div>
      <div>
        <p style={{fontFamily:"var(--serif)",fontSize:15,lineHeight:1.45,color:"var(--text-2)",marginBottom:20}}>İki <em style={{fontStyle:"italic",color:"var(--accent)"}}>$5K-bant</em> spot'u çerçeveler: yukarıda Call Wall kümesi, aşağıda Put Wall yığını.</p>
        <div style={{fontFamily:"var(--sans)",fontSize:10,fontWeight:600,color:"var(--text-mute)",letterSpacing:"0.10em",textTransform:"uppercase",marginBottom:14}}>Top Walls — Sıralı ↓</div>
        {topWalls.map((w,i)=>{const alim=w.wallType==="callWall",satim=w.wallType==="putWall",renk=alim?"var(--pos)":satim?"var(--neg)":"var(--neutral)",pct=((w.strike-spot)/spot*100);return(<div key={w.strike} style={{display:"grid",gridTemplateColumns:"22px 1fr auto",gap:"6px 10px",alignItems:"baseline",padding:"9px 0",borderBottom:"1px solid var(--hairline-soft)"}}><span style={{fontSize:9,color:"var(--text-mute)",fontStyle:"italic",fontFamily:"var(--sans)"}}>{String(i+1).padStart(2,"0")}</span><div><div style={{fontSize:13,color:renk,fontWeight:700,fontFamily:"var(--sans)"}}>${fmt(w.strike)}</div><div style={{fontSize:9,color:renk,marginTop:2,fontFamily:"var(--sans)",fontWeight:600}}>{alim?"Call":satim?"Put":"Magnet"} · OI {w.oiPct}%</div></div><div style={{textAlign:"right"}}><div style={{fontSize:12,color:pct>=0?"var(--pos)":"var(--neg)",fontFamily:"var(--sans)",fontWeight:700}}>{pct>=0?"+":""}{pct.toFixed(1)}%</div><div style={{fontSize:10,color:"var(--text-mute)",marginTop:2,fontFamily:"var(--sans)"}}>{pct>=0?"+":"-"}${fmtB(Math.abs(w.netGex))}</div></div></div>);})}
      </div>
    </div>
  );
}

// ─── GREEKS ───────────────────────────────────────────────
function AggregateGreeks({data}) {
  const {totals}=data;
  return (
    <div className="greeks-stack">
      {[
        {simge:"Γ",etiket:"Net Gamma",deger:`${totals.gamma>=0?"+":"−"}${fmtB(Math.abs(totals.gamma))}`,renk:totals.gamma>=0?"var(--pos)":"var(--neg)",aciklama:`Dealer'lar gamma <b>${totals.gamma>=0?"uzunu":"kısası"}</b>. Implied vol vadeye kadar <b>${totals.gamma>=0?"baskılanır":"yükselir"}</b>.`},
        {simge:"𝒱",etiket:"Net Vanna",deger:`${totals.vanna>=0?"+":"−"}${fmtB(Math.abs(totals.vanna))}`,renk:totals.vanna>=0?"var(--pos)":"var(--neg)",aciklama:`∂Δ/∂σ. IV yükselince dealer delta <b>${totals.vanna>=0?"spot ile birlikte":"spot'a karşı"}</b> hareket eder.`},
        {simge:"𝒞",etiket:"Net Charm",deger:`−${fmtB(Math.abs(totals.charm))}`,renk:"var(--neg)",aciklama:"∂Δ/∂t. Pin etkisi vadeye yaklaştıkça güçlenir; intraday <b>OI flow</b> spot'tan daha önemlidir."},
      ].map(c=>(<div key={c.etiket} className="greek-cell"><div className="greek-glyph">{c.simge}</div><div className="greek-label">{c.etiket}</div><div className="greek-num tabular" style={{color:c.renk}}>{c.deger}<span style={{color:"var(--text-dim)",fontSize:16}}>$</span></div><div className="greek-foot" dangerouslySetInnerHTML={{__html:c.aciklama}}/></div>))}
    </div>
  );
}

// ─── VOL SURFACE ──────────────────────────────────────────
function TermStructure({data}) {
  const pts=(data.volSurface?.termStructure||[]).filter(p=>p.days>0&&p.iv>5&&p.iv<200).sort((a,b)=>a.days-b.days);
  if (pts.length<2) return <div style={{color:"var(--text-mute)",fontFamily:"var(--sans)",fontSize:10,fontWeight:700,padding:"20px 0"}}>Term structure hesaplanıyor...</div>;
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
      <text x={pad.left} y={12} fontFamily="var(--sans)" fontSize="9" fontWeight="700" fill="var(--text-mute)" letterSpacing="0.10em">25Δ PUT − 25Δ CALL (vol puanı)</text>
    </svg>
  );
}

// ─── MAIN ─────────────────────────────────────────────────
export default function Home() {
  const [activeSym, setActiveSym] = useState("BTC");
  const [vade, setVade] = useState("all");
  const [watchlist, setWatchlist] = useState([
    {sym:"BTC",label:"Bitcoin", price:0,chg:0},
    {sym:"ETH",label:"Ethereum",price:0,chg:0},
  ]);

  // Watchlist güncelleme
  useEffect(()=>{
    const update=()=>fetchWatchlist().then(wl=>{if(wl?.length)setWatchlist(wl);}).catch(()=>{});
    update(); const iv=setInterval(update,60*1000); return()=>clearInterval(iv);
  },[]);

  // Aktif asset'in verisi
  const data = useAssetData(activeSym, vade);
  const asset = ASSETS[activeSym];

  // Aktif asset yüklendikten sonra diğerini arka planda prefetch et
  useEffect(()=>{
    if (!data.loading && data.allOptions.length>0) {
      prefetchOther(activeSym);
    }
  },[data.loading, data.allOptions.length, activeSym]);

  const saatStr=data.lastUpdate?.toLocaleTimeString("tr-TR",{hour:"2-digit",minute:"2-digit",second:"2-digit"})||"—";
  const pozitif=data.totals.gamma>=0;
  const cw=data.levels.callWall||0,pw=data.levels.putWall||0,sp=data.spot||1;

  return (
    <>
      <Head><title>Options Desk · {activeSym}</title></Head>
      <div className="app">
        <Sidebar watchlist={watchlist} activeSym={activeSym} setActiveSym={sym=>{setActiveSym(sym);}} vade={vade} setVade={setVade} data={data}/>

        <main className="main">
          {/* Header */}
          <div className="header">
            <div className="header-trail">
              <span className="crumb">Desk</span><span className="sep">/</span>
              <span className="crumb">Kripto Opsiyonları</span><span className="sep">/</span>
              <span style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:asset.color,display:"inline-block"}}/>
                <span className="crumb active">{activeSym} · Gamma</span>
              </span>
            </div>
            <div className="header-actions">
              <div className="h-stat">
                <span className="h-stat-label">Güncellendi</span>
                <span className="h-stat-value tabular">{saatStr} UTC</span>
              </div>
              {/* Cache durumu göstergesi */}
              {data.loading&&<span style={{fontFamily:"var(--sans)",fontSize:10,fontWeight:600,color:"var(--accent)",letterSpacing:"0.06em"}}>{data.progress||"Yükleniyor..."}</span>}
              <button className="h-action" onClick={data.yenile}>↻ Yenile</button>
              <button className="h-action">⤓ PDF İndir</button>
            </div>
          </div>

          {/* Loading — sadece ilk yüklemede tam ekran (cache yoksa) */}
          {data.loading && !data.allOptions.length ? (
            <div style={{minHeight:"calc(100vh - 53px)",display:"grid",placeItems:"center",color:"var(--text-mute)",fontFamily:"var(--sans)",fontSize:11,letterSpacing:"0.10em",fontWeight:600}}>
              <div style={{textAlign:"center"}}>
                <div style={{width:36,height:36,border:"1.5px solid var(--hairline-strong)",borderTopColor:asset.color,borderRadius:"50%",animation:"spin 0.9s linear infinite",margin:"0 auto 16px"}}/>
                <div style={{color:asset.color,fontWeight:700,fontSize:14,marginBottom:8}}>{asset.label}</div>
                <div>{data.progress||`${activeSym} opsiyon zinciri yükleniyor…`}</div>
                <div style={{marginTop:8,fontSize:10,color:"var(--text-mute)",fontWeight:400}}>1-2 dakika sürebilir</div>
              </div>
            </div>
          ) : data.error ? (
            <div style={{padding:"40px 36px",color:"var(--neg)",fontFamily:"var(--sans)"}}>
              <div style={{marginBottom:12}}>❌ {data.error}</div>
              <button onClick={data.yenile} style={{background:"var(--surface)",color:"var(--text)",border:"1px solid var(--hairline-strong)",padding:"6px 16px",cursor:"pointer",fontFamily:"var(--sans)",fontWeight:600}}>Tekrar Dene</button>
            </div>
          ) : (
            <>
              {/* i. Strike Topography */}
              <section className="section">
                <div className="section-head">
                  <h2 className="section-title"><span className="section-nbr">i.</span>Strike Topography</h2>
                  <span className="section-meta">{data.strikes.length} STRIKE · {data.stats.expiries} VADE · {vade==="all"?"TÜMÜ":vade.toUpperCase()}</span>
                </div>
                <div className="ladder-wrap">
                  <StrikeLadder data={data} sym={activeSym}/>
                  <div style={{display:"flex",flexDirection:"column",gap:28}}>
                    <KeyLevels data={data}/>
                    <HullCommentary data={data} sym={activeSym}/>
                  </div>
                </div>
              </section>

              {/* ii. Quantum Walls */}
              <section className="section">
                <div className="section-head">
                  <h2 className="section-title"><span className="section-nbr">ii.</span>Quantum Walls</h2>
                  <span className="section-meta">{data.classified.filter(c=>c.wallType==="callWall").length} CALL WALLS · {data.classified.filter(c=>c.wallType==="putWall").length} PUT WALLS · {data.classified.filter(c=>c.wallType==="magnet").length} MAGNETS</span>
                </div>
                <QuantumWalls data={data} sym={activeSym}/>
              </section>

              {/* iii. Aggregate Greeks */}
              <section className="section">
                <div className="section-head">
                  <h2 className="section-title"><span className="section-nbr">iii.</span>Aggregate Greeks</h2>
                  <span className="section-meta">DEALER-NORMALIZED · USD-DENOMINATED</span>
                </div>
                <AggregateGreeks data={data}/>
              </section>

              {/* iv. Volatility Surface */}
              <section className="section">
                <div className="section-head">
                  <h2 className="section-title"><span className="section-nbr">iv.</span>Volatility Surface</h2>
                  <span className="section-meta">TERM STRUCTURE · RISK REVERSAL SKEW</span>
                </div>
                <div className="term-card">
                  <div>
                    <div className="sheet-label" style={{marginBottom:12}}>ATM Term Structure</div>
                    <TermStructure data={data}/>
                    <p style={{fontFamily:"var(--sans)",fontSize:10,fontWeight:700,color:"var(--text-dim)",marginTop:8,lineHeight:1.55}}>
                      {data.volSurface?.termStructure?.length>0?`${data.volSurface.termStructure.length} vade · Log-moneyness interpolasyonu · ATM IV ~${data.dvol.toFixed(0)}%`:"Hesaplanıyor..."}
                    </p>
                  </div>
                  <div>
                    <div className="sheet-label" style={{marginBottom:12}}>25Δ Risk Reversal</div>
                    <RiskReversal data={data}/>
                    <p style={{fontFamily:"var(--sans)",fontSize:10,fontWeight:700,color:"var(--text-dim)",marginTop:8,lineHeight:1.55}}>
                      {data.volSurface?.riskReversals?.length>0?`RR = IV(25Δ put) − IV(25Δ call) · ${data.volSurface.riskReversals.length} vade`:"Hesaplanıyor..."}
                    </p>
                  </div>
                </div>
              </section>

              {/* v. Positioning */}
              <section className="section">
                <div className="section-head">
                  <h2 className="section-title"><span className="section-nbr">v.</span>Positioning · Read</h2>
                  <span className="section-meta">DEALER FLOW · DESK NOTLARI</span>
                </div>
                <div className="two-up">
                  <div>
                    <p className="pull" style={{marginBottom:24}}>Put Wall ile Call Wall arasındaki <em>${fmt(cw-pw)}</em> bant gerçekleşen volatiliteyi sınırlar — tepeden dibe <em>{((cw-pw)/sp*100).toFixed(1)}%</em>.</p>
                    <p style={{fontFamily:"var(--sans)",fontSize:12,fontWeight:400,color:"var(--text-2)",lineHeight:1.7,margin:0}}>Dealer'lar bu haftaya {pozitif?"net long":"net short"} {fmtB(data.totals.gamma)}$ gamma ile giriyor, <b style={{color:"var(--text)"}}>{fmt(data.levels.callWall)}</b> Call Wall'unda yoğunlaşmış. Bu yapısal bir <b style={{color:"var(--text)"}}>mean-reversion</b> bias yaratır.</p>
                  </div>
                  <div>
                    <div className="sheet-label" style={{marginBottom:14}}>Senaryolar</div>
                    {[
                      {etiket:"Spot yukarı kırar ↑",hedef:data.levels.callWall,not:"dealer'lar delta satmaya başlar"},
                      {etiket:"Spot sabitlenir",     hedef:data.levels.maxPain, not:"vol grinds lower into expiry"},
                      {etiket:"Spot aşağı kırar ↓", hedef:data.levels.putWall, not:"gamma negatife döner, vol genişler"},
                      {etiket:"Haftalık kapanış",    hedef:data.levels.maxPain, not:"Max Pain mıknatısı"},
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
                  <div style={{marginBottom:4,fontFamily:"var(--sans)",fontSize:11,fontWeight:500}}>Options Desk · {asset.label} ({activeSym}) · Deribit</div>
                  <div style={{color:"var(--text-dim)",fontFamily:"var(--sans)",fontSize:10,fontWeight:400}}>{new Date().toLocaleDateString("tr-TR",{weekday:"long",day:"numeric",month:"long",year:"numeric"})} · {data.stats.rows} kontrat · {data.stats.expiries} vade</div>
                </div>
                <div className="footer-pagenum">— {activeSym} Gamma —</div>
              </footer>
            </>
          )}
        </main>
      </div>
    </>
  );
}
