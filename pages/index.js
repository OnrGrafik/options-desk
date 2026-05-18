import Head from "next/head";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  fetchSpot, fetchWatchlist, fetchTicker24h, fetchFunding, fetchBasis,
  fetchOHLCV, fetchDeribitInstruments, fetchAllOptions,
  aggregateByStrike, findLevels, classifyStrikes,
} from "../lib/gex";

// ─── Helpers ──────────────────────────────────────────────
const fmt = (n) => n ? Math.round(n).toLocaleString("en-US") : "—";
const fmtB = (n) => {
  if (!n && n !== 0) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n/1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n/1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n/1e3).toFixed(0)}K`;
  return n.toFixed(0);
};

function useCountUp(target, ms = 800) {
  const [v, setV] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    if (target === prev.current) return;
    const s = prev.current, t0 = performance.now(); let f;
    const tick = n => { const t=Math.min((n-t0)/ms,1),e=1-Math.pow(1-t,3); setV(s+(target-s)*e); if(t<1) f=requestAnimationFrame(tick); else prev.current=target; };
    f = requestAnimationFrame(tick); return () => cancelAnimationFrame(f);
  }, [target, ms]);
  return v;
}

// ─── Data hook ────────────────────────────────────────────
function useData(expiryFilter) {
  const [state, setState] = useState({
    spot: 0, allOptions: [], watchlist: [], ticker24h: { open:0,high:0,low:0,change:0,volume:0 },
    funding: 0, basis: 0, dvol: 52, loading: true, error: null, progress: "", lastUpdate: null,
    stats: { rows:0, totalInst:0, expiries:0 },
  });

  const load = useCallback(async (silent=false) => {
    if (!silent) setState(s=>({...s,loading:true,error:null}));
    try {
      setState(s=>({...s,progress:"Spot fiyat alınıyor..."}));
      const [spot, watchlist, ticker24h, funding, basis] = await Promise.all([
        fetchSpot(), fetchWatchlist(), fetchTicker24h(), fetchFunding(), fetchBasis(),
      ]);
      setState(s=>({...s,spot,watchlist,ticker24h,funding,basis,progress:"Opsiyon zinciri çekiliyor..."}));

      const instruments = await fetchDeribitInstruments();
      const { options, stats } = await fetchAllOptions(instruments, spot, (pct,rows,exps) => {
        setState(s=>({...s,progress:`Analiz: %${pct} · ${rows} opt · ${exps} vade`}));
      });

      const atmOpt = options.filter(o=>o.type==="call").sort((a,b)=>Math.abs(a.strike-spot)-Math.abs(b.strike-spot))[0];
      setState(s=>({
        ...s, spot, allOptions:options, watchlist, ticker24h, funding, basis, stats,
        dvol: atmOpt ? atmOpt.iv*100 : 52,
        loading:false, error:null, lastUpdate:new Date(), progress:"",
      }));
    } catch(e) {
      setState(s=>({...s,loading:false,error:e.message}));
    }
  }, []);

  useEffect(() => { load(); const iv=setInterval(()=>load(true),5*60000); return()=>clearInterval(iv); }, [load]);

  // Derived — recomputed on filter change
  const strikes = aggregateByStrike(state.allOptions, expiryFilter);
  const levels = findLevels(strikes, state.spot, state.allOptions);
  const classified = classifyStrikes(strikes, state.spot);
  const totals = {
    gamma: strikes.reduce((a,x)=>a+x.netGex,0),
    vanna: strikes.reduce((a,x)=>a+x.vannaNet,0),
    charm: strikes.reduce((a,x)=>a+x.charmNet,0),
  };

  return { ...state, strikes, levels, classified, totals, reload:()=>load() };
}

// ─── SIDEBAR ──────────────────────────────────────────────
function Sidebar({ data, expiry, setExpiry }) {
  const animSpot = useCountUp(data.spot);
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
        <div className="sb-label">Underlying</div>
        {data.watchlist.map(w => (
          <div key={w.sym} className={`sb-item ${w.sym==="BTC"?"active":""}`}>
            <span className="sb-item-key tabular">{w.sym}/USD</span>
            <span className="sb-item-val">
              <span style={{color:"var(--text)"}}>
                {w.price.toLocaleString("en-US",{maximumFractionDigits:w.price<100?2:0})}
              </span>
              <span className={w.chg>=0?"pos":"neg"} style={{marginLeft:8}}>
                {w.chg>=0?"+":""}{w.chg.toFixed(2)}%
              </span>
            </span>
          </div>
        ))}
      </div>

      <div className="sb-section">
        <div className="sb-label">Expiry filter</div>
        <div className="sb-chip-row">
          {["all","0-7d","8-45d","45d+"].map(e => (
            <button key={e} className={`sb-chip ${expiry===e?"active":""}`} onClick={()=>setExpiry(e)}>
              {e==="all"?"All":e}
            </button>
          ))}
        </div>
      </div>

      <div className="sb-section">
        <div className="sb-label">Quick stats</div>
        <SbStat label="DVOL" value={data.dvol.toFixed(1)} />
        <SbStat label="ATM IV" value={`${data.dvol.toFixed(1)}%`} />
        <SbStat label="Funding" value={`${(data.funding*100).toFixed(3)}%`} pos={data.funding>=0} />
        <SbStat label="Basis (90d)" value={data.basis?`${data.basis>0?"+":""}${data.basis.toFixed(1)}%`:"+7.4%"} pos />
        <SbStat label="25Δ Skew" value="+6.4 vol" pos={false} />
      </div>

      <div className="sb-section" style={{marginTop:"auto"}}>
        <div className="sb-label">Session</div>
        <SbStat label="Open" value={fmt(data.ticker24h.open)} />
        <SbStat label="High (24h)" value={fmt(data.ticker24h.high)} />
        <SbStat label="Low (24h)" value={fmt(data.ticker24h.low)} />
        <SbStat label="Bars" value={`${data.stats.rows} · 1H`} />
      </div>
    </aside>
  );
}
function SbStat({ label, value, pos }) {
  return (
    <div className="sb-item">
      <span className="sb-item-key" style={{color:"var(--text-mute)",fontSize:10,letterSpacing:"0.08em"}}>{label}</span>
      <span className="sb-item-val" style={{color:pos===true?"var(--pos)":pos===false?"var(--neg)":"var(--text)",fontSize:11}}>{value}</span>
    </div>
  );
}

// ─── STRIKE TOPOGRAPHY TABLE ──────────────────────────────
function StrikeLadder({ data, expiry }) {
  const { strikes, spot, levels, classified } = data;
  const lo = spot * 0.90, hi = spot * 1.10;
  let vis = classified.filter(s => s.strike >= lo && s.strike <= hi);
  vis = [...vis].sort((a,b) => b.strike - a.strike);

  const maxCall = Math.max(...vis.map(s=>s.callGex), 1);
  const maxPut = Math.max(...vis.map(s=>Math.abs(s.putGex)), 1);

  const tagFor = strike => {
    if (strike===levels.callWall) return {txt:"CW",cls:"cw"};
    if (strike===levels.putWall) return {txt:"PW",cls:"pw"};
    if (strike===levels.maxPain) return {txt:"MP",cls:"mp"};
    if (strike===levels.zeroGamma) return {txt:"ZΓ",cls:"zg"};
    return null;
  };
  const spotIdx = vis.findIndex(s => s.strike < spot);

  return (
    <div className="ladder">
      <div className="ladder-header">
        <div>Tag</div>
        <div>OI %</div>
        <div style={{textAlign:"right",paddingRight:14}}>Put γ</div>
        <div>Strike</div>
        <div style={{paddingLeft:14}}>Call γ</div>
        <div>Net γ</div>
        <div>Δ%</div>
      </div>
      {vis.map((s, i) => {
        const tag = tagFor(s.strike);
        const callPct = s.callGex / maxCall * 100;
        const putPct = Math.abs(s.putGex) / maxPut * 100;
        const dist = (s.strike - spot) / spot * 100;
        return (
          <React.Fragment key={s.strike}>
            {i === spotIdx && (
              <div className="ladder-row spot">
                <div className="tag" style={{color:"var(--accent)"}}>◆</div>
                <div />
                <div className="bar-cell put" />
                <div className="strike-cell tabular" style={{color:"var(--accent)",fontWeight:600}}>{fmt(spot)}</div>
                <div className="bar-cell call" />
                <div className="net" style={{color:"var(--accent)"}}>—</div>
                <div className="dist" style={{color:"var(--accent)"}}>0.00%</div>
              </div>
            )}
            <div className="ladder-row">
              <div className={`tag ${tag?.cls||""}`}>{tag?.txt||""}</div>
              <div style={{color:"var(--text-dim)",textAlign:"center",fontSize:10}}>{s.oiPct}%</div>
              <div className="bar-cell put">
                <div className="bar put" style={{width:`${putPct}%`}} />
              </div>
              <div className="strike-cell tabular">{fmt(s.strike)}</div>
              <div className="bar-cell call">
                <div className="bar call" style={{width:`${callPct}%`}} />
              </div>
              <div className="net tabular" style={{color:s.netGex>=0?"var(--pos)":"var(--neg)"}}>
                {s.netGex>=0?"+"+"−"[0]:"−"}{fmtB(Math.abs(s.netGex))}
              </div>
              <div className={`dist tabular ${dist>=0?"pos":"neg"}`}>
                {dist>=0?"+":""}{dist.toFixed(1)}%
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── KEY LEVELS SHEET ─────────────────────────────────────
function Sheet({ data }) {
  const { levels, spot } = data;
  const list = [
    { name:"Call Wall", sub:"Max positive γ", value:levels.callWall, color:"var(--pos)", pct:levels.callWallPct },
    { name:"Expected Move ↑", sub:"1σ end-of-week", value:levels.emHigh, color:"var(--neutral)", pct:levels.emHighPct },
    { name:"Max Pain", sub:"Min writer payoff", value:levels.maxPain, color:"var(--accent)", pct:levels.maxPainPct },
    { name:"Zero Gamma", sub:"Regime flip", value:levels.zeroGamma, color:"var(--text-dim)", pct:levels.zeroGammaPct },
    { name:"Expected Move ↓", sub:"1σ end-of-week", value:levels.emLow, color:"var(--neutral)", pct:levels.emLowPct },
    { name:"Put Wall", sub:"Max negative γ", value:levels.putWall, color:"var(--neg)", pct:levels.putWallPct },
  ];
  return (
    <div className="sheet">
      <div className="sheet-block" style={{borderTop:"none",paddingTop:0}}>
        <div className="sheet-label">Key Levels</div>
        <div className="levels-list">
          {list.map(l => {
            const pctNum = l.pct ? parseFloat(l.pct) : null;
            return (
              <div key={l.name} className="level-row">
                <span className="level-dot" style={{color:l.color}} />
                <span>
                  <span className="level-name">{l.name}</span>
                  <span className="level-sub">{l.sub}</span>
                </span>
                <span className="level-value tabular">${fmt(l.value)}</span>
                <span className={`level-delta ${pctNum!=null&&pctNum>=0?"pos":"neg"}`}>
                  {pctNum!=null?`${pctNum>=0?"+":""}${pctNum.toFixed(2)}%`:"—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── QUANTUM WALLS ────────────────────────────────────────
function QuantumWalls({ data }) {
  const { classified, spot, levels } = data;
  const [tip, setTip] = useState(null);
  const [tipPos, setTipPos] = useState({x:0,y:0});
  const ref = useRef(null);

  const lo = spot * 0.82, hi = spot * 1.20;
  const vis = classified.filter(s => s.strike >= lo && s.strike <= hi);
  if (!vis.length) return <div style={{color:"var(--text-mute)",fontFamily:"var(--mono)",fontSize:11,padding:20}}>Veri yükleniyor...</div>;

  const W=1600,H=760,pad={top:48,right:60,bottom:60,left:120};
  const cW=W-pad.left-pad.right, cH=H-pad.top-pad.bottom;
  const yS=p=>pad.top+((hi-p)/(hi-lo))*cH;
  const maxBar=Math.max(...vis.map(s=>Math.max(s.callGex,Math.abs(s.putGex))),1);
  const rowH=Math.max(cH/vis.length-1,3);
  const xBar=mag=>(mag/maxBar)*cW*0.94;

  const topWalls=[...vis].filter(s=>s.isMajor).sort((a,b)=>Math.abs(b.netGex)-Math.abs(a.netGex)).slice(0,8);

  const handleMouse=e=>{
    const rect=ref.current?.getBoundingClientRect(); if(!rect) return;
    const sy=(e.clientY-rect.top)/rect.height*H;
    const price=hi-((sy-pad.top)/cH)*(hi-lo);
    let best=null,bestD=Infinity;
    for(const s of vis){const d=Math.abs(s.strike-price); if(d<bestD){bestD=d;best=s;}}
    if(best&&bestD<(hi-lo)*0.02){setTip(best);setTipPos({x:e.clientX,y:e.clientY});}
    else setTip(null);
  };

  const callWallsCount=vis.filter(s=>s.wallType==="callWall").length;
  const magnetsCount=vis.filter(s=>s.wallType==="magnet").length;

  return (
    <div className="ladder-wrap" style={{gridTemplateColumns:"1fr 280px"}}>
      <div>
        <div style={{fontFamily:"var(--mono)",fontSize:10,color:"var(--text-mute)",marginBottom:8,display:"flex",justifyContent:"space-between"}}>
          <span>|GAMMA EXPOSURE| · USD</span>
          <span>{callWallsCount} WALLS · {magnetsCount} MAGNETS</span>
        </div>
        <div ref={ref} style={{position:"relative"}} onMouseMove={handleMouse} onMouseLeave={()=>setTip(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{width:"100%",height:"auto",display:"block"}}>
            <defs>
              <linearGradient id="cG" x1="0" x2="1"><stop offset="0%" stopColor="var(--pos)" stopOpacity="0.9"/><stop offset="100%" stopColor="var(--pos)" stopOpacity="0.2"/></linearGradient>
              <linearGradient id="pG" x1="0" x2="1"><stop offset="0%" stopColor="var(--neg)" stopOpacity="0.9"/><stop offset="100%" stopColor="var(--neg)" stopOpacity="0.18"/></linearGradient>
              <linearGradient id="mG" x1="0" x2="1"><stop offset="0%" stopColor="var(--neutral)" stopOpacity="0.4"/><stop offset="100%" stopColor="var(--neutral)" stopOpacity="0.04"/></linearGradient>
            </defs>

            {vis.map(s=>{
              const y=yS(s.strike);
              return <g key={s.strike}>
                <line x1={pad.left} x2={W-pad.right} y1={y} y2={y} stroke="var(--hairline-soft)" strokeWidth="0.3"/>
                <text x={pad.left-8} y={y+3} textAnchor="end" fontFamily="var(--mono)" fontSize="10" fill="var(--text-mute)">
                  {(s.strike/1000).toFixed(0)}K
                </text>
              </g>;
            })}

            {vis.map(s=>{
              const y=yS(s.strike);
              const callW=xBar(s.callGex), putW=xBar(Math.abs(s.putGex));
              const totalW=Math.max(callW,putW);
              const isMajor=s.isMajor&&rowH>=3&&totalW>150;
              const lClr=s.wallType==="callWall"?"var(--pos)":s.wallType==="putWall"?"var(--neg)":"var(--neutral)";
              const lType=s.wallType==="callWall"?"CALL WALL":s.wallType==="putWall"?"PUT WALL":s.wallType==="magnet"?"MAGNET":null;
              return <g key={s.strike}>
                {s.wallType==="magnet"&&s.isSignificant&&<rect x={pad.left} y={y-rowH/2} width={totalW} height={rowH} fill="url(#mG)"/>}
                {s.callGex>0&&<rect x={pad.left} y={y-rowH/2} width={callW} height={rowH} fill="url(#cG)"/>}
                {s.putGex<0&&<rect x={pad.left} y={y-rowH/2} width={putW} height={rowH} fill="url(#pG)" opacity="0.85"/>}
                {isMajor&&lType&&(
                  <g>
                    <line x1={pad.left+totalW+4} x2={W-pad.right} y1={y} y2={y} stroke={lClr} strokeWidth="0.8" strokeDasharray="4 3" opacity="0.28"/>
                    <text x={pad.left+totalW/2} y={y+3.5} textAnchor="middle" fontFamily="var(--mono)" fontSize="9" fontWeight="600" fill={lClr}>
                      {`▸ ${lType}  ${fmtB(Math.abs(s.netGex))}  OI ${s.oiPct}%`}
                    </text>
                  </g>
                )}
              </g>;
            })}

            {[
              {p:levels.callWall,l:"CW",c:"var(--pos)"},{p:levels.emHigh,l:"EM↑",c:"var(--neutral)"},
              {p:levels.zeroGamma,l:"ZΓ",c:"var(--text-dim)"},{p:levels.maxPain,l:"MP",c:"var(--accent)"},
              {p:levels.emLow,l:"EM↓",c:"var(--neutral)"},{p:levels.putWall,l:"PW",c:"var(--neg)"},
            ].filter(x=>x.p).map((it,i)=>{
              const y=yS(it.p); if(y<pad.top-10||y>H-pad.bottom+10) return null;
              return <g key={i}>
                <line x1={pad.left} x2={W-pad.right} y1={y} y2={y} stroke={it.c} strokeWidth="0.7" strokeDasharray="3 5" opacity="0.22"/>
                <rect x={pad.left-58} y={y-9} width="50" height="18" rx="3" fill="var(--surface)" stroke={it.c} strokeWidth="1"/>
                <text x={pad.left-33} y={y+4} textAnchor="middle" fontFamily="var(--mono)" fontSize="9" fontWeight="700" fill={it.c}>{it.l}</text>
              </g>;
            })}

            {(()=>{
              const y=yS(spot);
              return <g>
                <line x1={pad.left} x2={W-pad.right} y1={y} y2={y} stroke="var(--accent)" strokeWidth="1.5" opacity="0.85"/>
                <rect x={pad.left-58} y={y-10} width="50" height="20" rx="3" fill="var(--accent)"/>
                <text x={pad.left-33} y={y+5} textAnchor="middle" fontFamily="var(--mono)" fontSize="10" fontWeight="700" fill="#0a0a0a">SPOT</text>
              </g>;
            })()}

            <line x1={pad.left} x2={W-pad.right} y1={H-pad.bottom} y2={H-pad.bottom} stroke="var(--hairline)"/>
            {[0,0.25,0.5,0.75,1].map(p=>{
              const x=pad.left+p*cW*0.94, v=p*maxBar;
              return <g key={p}>
                <line x1={x} x2={x} y1={H-pad.bottom} y2={H-pad.bottom+4} stroke="var(--hairline)"/>
                <text x={x} y={H-pad.bottom+16} textAnchor="middle" fontFamily="var(--mono)" fontSize="9" fill="var(--text-mute)">${fmtB(v)}</text>
              </g>;
            })}
            <text x={(pad.left+W-pad.right)/2} y={H-pad.bottom+34} textAnchor="middle" fontFamily="var(--mono)" fontSize="9" fill="var(--text-mute)">|Gamma Exposure| · $</text>
          </svg>

          {tip&&(
            <div style={{position:"fixed",left:Math.min(tipPos.x+16,window.innerWidth-230),top:Math.max(tipPos.y-20,10),background:"#0f172aee",border:"1px solid var(--hairline-strong)",borderRadius:6,padding:"10px 13px",fontFamily:"var(--mono)",fontSize:11,pointerEvents:"none",zIndex:9999,minWidth:210,backdropFilter:"blur(8px)"}}>
              <div style={{color:"var(--accent)",fontWeight:"bold",fontSize:13,marginBottom:6}}>Strike: ${fmt(tip.strike)}</div>
              {[["Net GEX",fmtB(tip.netGex)+"$",tip.netGex>=0?"var(--pos)":"var(--neg)"],["Call GEX","$"+fmtB(tip.callGex),"var(--pos)"],["Put GEX","$"+fmtB(Math.abs(tip.putGex)),"var(--neg)"]].map(([l,v,c],i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",color:"var(--text-2)",lineHeight:1.6}}>
                  <span>{l}</span><span style={{color:c,fontWeight:600}}>{v}</span>
                </div>
              ))}
              <div style={{borderTop:"1px solid var(--hairline)",margin:"5px 0"}}/>
              {[["Call OI",tip.callOI.toFixed(1)+" BTC"],["Put OI",tip.putOI.toFixed(1)+" BTC"],["OI %",tip.oiPct+"%"]].map(([l,v],i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",color:"var(--text-2)",lineHeight:1.6}}>
                  <span>{l}</span><span>{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top Walls Sidebar */}
      <div>
        <p style={{fontFamily:"var(--serif)",fontSize:16,lineHeight:1.4,color:"var(--text-2)",marginBottom:20,maxWidth:"28ch"}}>
          Two <em style={{fontStyle:"italic",color:"var(--accent)"}}>$5K-bands</em> bracket spot: a call-wall cluster overhead, a put-wall stack below. Between them, dealer hedging <em style={{fontStyle:"italic",color:"var(--accent)"}}>dampens</em> realised vol.
        </p>
        <div style={{fontFamily:"var(--mono)",fontSize:9,color:"var(--text-mute)",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:12}}>
          TOP WALLS — RANKED ↓
        </div>
        {topWalls.map((w,i)=>{
          const isCall=w.wallType==="callWall", isPut=w.wallType==="putWall";
          const color=isCall?"var(--pos)":isPut?"var(--neg)":"var(--neutral)";
          const pct=((w.strike-spot)/spot*100);
          return (
            <div key={w.strike} style={{display:"grid",gridTemplateColumns:"24px 1fr auto",gap:"8px 12px",alignItems:"baseline",padding:"10px 0",borderBottom:"1px solid var(--hairline-soft)",fontFamily:"var(--mono)"}}>
              <span style={{fontSize:9,color:"var(--text-mute)",fontStyle:"italic"}}>
                {String(i+1).padStart(2,"0")}
              </span>
              <div>
                <div style={{fontSize:14,color,fontWeight:600,fontFamily:"var(--serif)"}}>${fmt(w.strike)}</div>
                <div style={{fontSize:9,color,marginTop:2,letterSpacing:"0.04em"}}>
                  {isCall?"Call":isPut?"Put":"Magnet"} · OI {w.oiPct}%
                </div>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:12,color:pct>=0?"var(--pos)":"var(--neg)",fontFamily:"var(--serif)"}}>
                  {pct>=0?"+":""}{pct.toFixed(1)}%
                </div>
                <div style={{fontSize:10,color:"var(--text-mute)",marginTop:1}}>
                  {pct>=0?"+":"-"}${fmtB(Math.abs(w.netGex))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── GREEKS ───────────────────────────────────────────────
function GreeksStack({ data }) {
  const { totals } = data;
  return (
    <div className="greeks-stack">
      <div className="greek-cell">
        <div className="greek-glyph">Γ</div>
        <div className="greek-label">Net Gamma</div>
        <div className="greek-num tabular" style={{color:totals.gamma>=0?"var(--pos)":"var(--neg)"}}>
          {totals.gamma>=0?"+":"−"}{fmtB(Math.abs(totals.gamma))}<span style={{color:"var(--text-dim)",fontSize:16}}>$</span>
        </div>
        <div className="greek-foot">
          Dealers <b style={{color:"var(--text-2)"}}>{totals.gamma>=0?"long":"short"}</b> gamma. Implied vol gets <b style={{color:"var(--text-2)"}}>{totals.gamma>=0?"suppressed":"amplified"}</b> through expiry.
        </div>
      </div>
      <div className="greek-cell">
        <div className="greek-glyph">𝒱</div>
        <div className="greek-label">Net Vanna</div>
        <div className="greek-num tabular" style={{color:totals.vanna>=0?"var(--pos)":"var(--neg)"}}>
          {totals.vanna>=0?"+":"−"}{fmtB(Math.abs(totals.vanna))}<span style={{color:"var(--text-dim)",fontSize:16}}>$</span>
        </div>
        <div className="greek-foot">
          ∂Δ/∂σ. When IV moves higher, dealer delta moves <b style={{color:"var(--text-2)"}}>{totals.vanna>=0?"with spot":"against spot"}</b>.
        </div>
      </div>
      <div className="greek-cell">
        <div className="greek-glyph">𝒞</div>
        <div className="greek-label">Net Charm</div>
        <div className="greek-num tabular" style={{color:"var(--neg)"}}>
          −{fmtB(Math.abs(totals.charm))}<span style={{color:"var(--text-dim)",fontSize:16}}>$</span>
        </div>
        <div className="greek-foot">
          ∂Δ/∂t. Pin effect strengthens into expiry; intraday <b style={{color:"var(--text-2)"}}>OI flow</b> matters more than spot.
        </div>
      </div>
    </div>
  );
}

// ─── TERM CURVE ───────────────────────────────────────────
function TermCurve({ data }) {
  const exMap={};
  for(const o of data.allOptions) {
    if(!exMap[o.expiryTs]) exMap[o.expiryTs]={days:o.daysToExp,ivs:[]};
    exMap[o.expiryTs].ivs.push({iv:o.iv,dist:Math.abs(o.strike-data.spot)});
  }
  const pts=Object.values(exMap).map(e=>{
    e.ivs.sort((a,b)=>a.dist-b.dist);
    return {days:e.days,iv:e.ivs[0].iv*100};
  }).sort((a,b)=>a.days-b.days);
  if(pts.length<2) return null;

  const W=600,H=240,pad={top:20,right:24,bottom:32,left:44};
  const maxDays=Math.max(...pts.map(p=>p.days));
  const minIV=Math.min(...pts.map(p=>p.iv))-4, maxIV=Math.max(...pts.map(p=>p.iv))+4;
  const xS=d=>pad.left+(d/maxDays)*(W-pad.left-pad.right);
  const yS=iv=>pad.top+((maxIV-iv)/(maxIV-minIV))*(H-pad.top-pad.bottom);
  const path=pts.map((p,i)=>`${i===0?"M":"L"} ${xS(p.days)} ${yS(p.iv)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="term-svg">
      {[40,50,60,70].map(iv=>{
        const y=yS(iv); if(y<pad.top||y>H-pad.bottom) return null;
        return <g key={iv}>
          <line x1={pad.left} x2={W-pad.right} y1={y} y2={y} stroke="var(--hairline-soft)" strokeWidth="0.6"/>
          <text x={pad.left-6} y={y+3} textAnchor="end" fontFamily="var(--mono)" fontSize="9" fill="var(--text-mute)">{iv}%</text>
        </g>;
      })}
      {[7,30,90,180,240].filter(d=>d<=maxDays).map(d=>(
        <g key={d}>
          <line x1={xS(d)} x2={xS(d)} y1={H-pad.bottom} y2={H-pad.bottom+4} stroke="var(--hairline-strong)"/>
          <text x={xS(d)} y={H-pad.bottom+18} textAnchor="middle" fontFamily="var(--mono)" fontSize="9" fill="var(--text-mute)">{d}d</text>
        </g>
      ))}
      <path d={`${path} L ${xS(pts[pts.length-1].days)} ${H-pad.bottom} L ${pad.left} ${H-pad.bottom} Z`} fill="var(--accent)" opacity="0.06"/>
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.5"/>
      {pts.map((p,i)=>(
        <g key={i}>
          <circle cx={xS(p.days)} cy={yS(p.iv)} r="3" fill="var(--bg)" stroke="var(--accent)" strokeWidth="1.4"/>
          {(i===0||i===pts.length-1||i===Math.floor(pts.length/2))&&(
            <text x={xS(p.days)} y={yS(p.iv)-10} textAnchor="middle" fontFamily="var(--mono)" fontSize="10" fill="var(--text-2)">{p.iv.toFixed(0)}</text>
          )}
        </g>
      ))}
      <text x={pad.left} y={14} fontFamily="var(--mono)" fontSize="9" fill="var(--text-mute)" letterSpacing="0.12em">ATM IV (%)</text>
    </svg>
  );
}

function SkewMini({ data }) {
  const exMap={};
  for(const o of data.allOptions) {
    if(!exMap[o.expiryTs]) exMap[o.expiryTs]={days:o.daysToExp,c25:null,p25:null,cD:Infinity,pD:Infinity};
    const e=exMap[o.expiryTs];
    if(o.type==="call"&&Math.abs(o.delta-0.25)<e.cD){e.cD=Math.abs(o.delta-0.25);e.c25=o.iv;}
    if(o.type==="put"&&Math.abs(o.delta+0.25)<e.pD){e.pD=Math.abs(o.delta+0.25);e.p25=o.iv;}
  }
  const exps=Object.values(exMap).filter(e=>e.c25&&e.p25).map(e=>({d:e.days,skew:(e.p25-e.c25)*100})).sort((a,b)=>a.d-b.d).slice(0,8);
  if(!exps.length) {
    // Fallback synthetic skew (same as original)
    const fallback=[{d:2,skew:8.4},{d:9,skew:6.8},{d:23,skew:6.1},{d:65,skew:5.4},{d:156,skew:4.9},{d:247,skew:4.6}];
    return <SkewSvg exps={fallback}/>;
  }
  return <SkewSvg exps={exps}/>;
}
function SkewSvg({ exps }) {
  const W=600,H=240,pad={top:20,right:24,bottom:32,left:44};
  const maxD=Math.max(...exps.map(e=>e.d));
  const maxS=Math.max(...exps.map(e=>e.skew))+1.5;
  const xS=d=>pad.left+(d/maxD)*(W-pad.left-pad.right);
  const yS=s=>pad.top+((maxS-s)/maxS)*(H-pad.top-pad.bottom);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="term-svg">
      {[0,2,4,6,8].map(s=>{
        const y=yS(s);
        return <g key={s}>
          <line x1={pad.left} x2={W-pad.right} y1={y} y2={y} stroke="var(--hairline-soft)" strokeWidth="0.6"/>
          <text x={pad.left-6} y={y+3} textAnchor="end" fontFamily="var(--mono)" fontSize="9" fill="var(--text-mute)">+{s} vol</text>
        </g>;
      })}
      {exps.map(e=>{
        const w=32,x=xS(e.d),y=yS(e.skew);
        return <g key={e.d}>
          <rect x={x-w/2} y={y} width={w} height={H-pad.bottom-y} fill="var(--neg)" opacity="0.42"/>
          <line x1={x-w/2} x2={x+w/2} y1={y} y2={y} stroke="var(--neg)" strokeWidth="1.4"/>
          <text x={x} y={y-6} textAnchor="middle" fontFamily="var(--mono)" fontSize="10" fill="var(--text-2)">{e.skew.toFixed(1)}</text>
          <text x={x} y={H-pad.bottom+18} textAnchor="middle" fontFamily="var(--mono)" fontSize="9" fill="var(--text-mute)">{e.d}d</text>
        </g>;
      })}
      <text x={pad.left} y={14} fontFamily="var(--mono)" fontSize="9" fill="var(--text-mute)" letterSpacing="0.12em">25Δ PUT − 25Δ CALL (vol points)</text>
    </svg>
  );
}

// ─── SCENARIO ROW ─────────────────────────────────────────
function ScenarioRow({ label, target, note }) {
  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:16,padding:"12px 0",borderBottom:"1px solid var(--hairline-soft)",fontFamily:"var(--mono)",fontSize:11}}>
      <div>
        <div style={{color:"var(--text)",fontSize:12,marginBottom:2}}>{label}</div>
        <div style={{color:"var(--text-mute)",fontSize:10,letterSpacing:"0.04em"}}>{note}</div>
      </div>
      <div style={{textAlign:"right"}}>
        <div className="tabular" style={{color:"var(--accent)",fontSize:14,fontFamily:"var(--serif)"}}>${fmt(target)}</div>
      </div>
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────
export default function Home() {
  const [expiry, setExpiry] = useState("all");
  const data = useData(expiry);

  if (data.loading) return (
    <>
      <Head><title>OPTIONS DESK · BTC</title></Head>
      <div style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"var(--bg)",color:"var(--text-dim)",fontFamily:"var(--mono)",fontSize:11,letterSpacing:"0.12em"}}>
        <div style={{textAlign:"center"}}>
          <div style={{width:36,height:36,border:"1.5px solid var(--hairline-strong)",borderTopColor:"var(--accent)",borderRadius:"50%",animation:"spin 0.9s linear infinite",margin:"0 auto 16px"}}/>
          <div>{data.progress||"LOADING OPTION CHAIN…"}</div>
          <div style={{marginTop:8,fontSize:10,color:"var(--text-mute)"}}>1-2 dakika sürebilir</div>
        </div>
      </div>
    </>
  );

  if (data.error) return (
    <>
      <Head><title>OPTIONS DESK · BTC</title></Head>
      <div style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"var(--bg)",color:"var(--neg)",fontFamily:"var(--mono)"}}>
        <div style={{textAlign:"center"}}>
          <div style={{marginBottom:12}}>❌ {data.error}</div>
          <button onClick={data.reload} style={{background:"var(--surface)",color:"var(--text)",border:"1px solid var(--hairline-strong)",padding:"6px 16px",cursor:"pointer",fontFamily:"var(--mono)"}}>Tekrar Dene</button>
        </div>
      </div>
    </>
  );

  const timeStr = data.lastUpdate?.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",second:"2-digit"})||"—";
  const isPos = data.totals.gamma >= 0;

  return (
    <>
      <Head><title>OPTIONS DESK · BTC</title></Head>
      <div className="app">
        <Sidebar data={data} expiry={expiry} setExpiry={setExpiry} />

        <main className="main">
          {/* Header */}
          <div className="header">
            <div className="header-trail">
              <span className="crumb">Desk</span><span className="sep">/</span>
              <span className="crumb">Crypto Options</span><span className="sep">/</span>
              <span className="crumb active">BTC · Gamma</span>
            </div>
            <div className="header-actions">
              <div className="h-stat">
                <span className="h-stat-label">Updated</span>
                <span className="h-stat-value tabular">{timeStr} UTC</span>
              </div>
              <button className="h-action" onClick={data.reload}>↻ Refresh</button>
              <button className="h-action">⤓ Export PDF</button>
            </div>
          </div>

          {/* i. Strike Topography */}
          <section className="section">
            <div className="section-head">
              <h2 className="section-title">
                <span className="section-nbr">i.</span>Strike Topography
              </h2>
              <span className="section-meta">
                {data.strikes.length} STRIKES · {data.stats.expiries} EXPIRIES · {expiry==="all"?"ALL":expiry.toUpperCase()}
              </span>
            </div>
            <div className="ladder-wrap">
              <StrikeLadder data={data} expiry={expiry} />
              <Sheet data={data} />
            </div>
          </section>

          {/* ii. Quantum Walls */}
          <section className="section">
            <div className="section-head">
              <h2 className="section-title">
                <span className="section-nbr">ii.</span>Quantum Walls
              </h2>
              <span className="section-meta">
                {data.classified.filter(c=>c.wallType==="callWall").length} ATK WALL ·{" "}
                {data.classified.filter(c=>c.wallType==="magnet").length} MAGNETS ·{" "}
                KEY LEVELS
              </span>
            </div>
            <QuantumWalls data={data} />
          </section>

          {/* iii. Aggregate Greeks */}
          <section className="section">
            <div className="section-head">
              <h2 className="section-title">
                <span className="section-nbr">iii.</span>Aggregate Greeks
              </h2>
              <span className="section-meta">DEALER-NORMALIZED · USD-DENOMINATED</span>
            </div>
            <GreeksStack data={data} />
          </section>

          {/* iv. Volatility Surface */}
          <section className="section">
            <div className="section-head">
              <h2 className="section-title">
                <span className="section-nbr">iv.</span>Volatility Surface
              </h2>
              <span className="section-meta">TERM STRUCTURE · SKEW DECAY</span>
            </div>
            <div className="term-card">
              <div>
                <div className="sheet-label" style={{marginBottom:12}}>ATM Term Structure</div>
                <TermCurve data={data} />
                <p style={{fontFamily:"var(--mono)",fontSize:10,color:"var(--text-dim)",marginTop:8,lineHeight:1.5}}>
                  Curve is <b style={{color:"var(--text-2)"}}>upward-sloping</b> through 90d, indicating event-vol premium beyond next macro window. Front-end remains anchored at <b style={{color:"var(--text-2)"}}>~{data.dvol.toFixed(0)}%</b>.
                </p>
              </div>
              <div>
                <div className="sheet-label" style={{marginBottom:12}}>Risk-Reversal Skew</div>
                <SkewMini data={data} />
                <p style={{fontFamily:"var(--mono)",fontSize:10,color:"var(--text-dim)",marginTop:8,lineHeight:1.5}}>
                  Put skew elevated in front-end — hedging flow dominates near-term. Long-end normalizes as conviction builds.
                </p>
              </div>
            </div>
          </section>

          {/* v. Positioning Read */}
          <section className="section">
            <div className="section-head">
              <h2 className="section-title">
                <span className="section-nbr">v.</span>Positioning · Read
              </h2>
              <span className="section-meta">DEALER FLOW · DESK NOTES</span>
            </div>
            <div className="two-up">
              <div>
                <p className="pull" style={{marginBottom:24}}>
                  A <em>${fmt((data.levels.callWall||0)-(data.levels.putWall||0))}</em> band between the put wall and call wall
                  caps realised volatility —{" "}
                  <em>{(((data.levels.callWall||0)-(data.levels.putWall||0))/(data.spot||1)*100).toFixed(1)}%</em> peak-to-trough.
                </p>
                <p style={{fontFamily:"var(--mono)",fontSize:11,color:"var(--text-2)",lineHeight:1.7,margin:0}}>
                  Dealers are net {isPos?"long":"short"} {fmtB(data.totals.gamma)}$ of gamma into front-week, concentrated at the{" "}
                  <b style={{color:"var(--text)"}}>{fmt(data.levels.callWall)}</b> call wall. This produces a structural{" "}
                  <b style={{color:"var(--text)"}}>mean-reversion</b> bias — sharp moves get faded by hedging flow until expiry.
                </p>
              </div>
              <div>
                <div className="sheet-label" style={{marginBottom:14}}>Scenarios</div>
                <ScenarioRow label="Spot breaks ↑" target={data.levels.callWall} note="dealers begin selling delta" />
                <ScenarioRow label="Spot pins" target={data.levels.maxPain} note="vol grinds lower into expiry" />
                <ScenarioRow label="Spot breaks ↓" target={data.levels.putWall} note="gamma flips negative, vol expands" />
                <ScenarioRow label="Weekly close" target={data.levels.maxPain} note="max pain magnet" />
              </div>
            </div>
          </section>

          {/* Footer */}
          <footer className="footer">
            <div>
              <div style={{marginBottom:4}}>Options Desk · Deribit Daily Recap</div>
              <div style={{color:"var(--text-dim)"}}>
                {new Date().toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}
                {" · "}{data.stats.rows} contracts · {data.stats.expiries} expiries
              </div>
            </div>
            <div className="footer-pagenum">— 01 / 01 —</div>
          </footer>
        </main>
      </div>
    </>
  );
}
