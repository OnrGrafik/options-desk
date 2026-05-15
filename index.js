import { useState, useEffect, useRef, useCallback } from "react";
import Head from "next/head";

// ─── Black-Scholes Greeks ───────────────────────────────
function normCDF(x) {
  const a1=0.254829592,a2=-0.284496736,a3=1.421413741,a4=-1.453152027,a5=1.061405429,p=0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1/(1+p*x);
  const y = 1-((((a5*t+a4)*t+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
  return 0.5*(1+sign*y);
}
function normPDF(x) { return Math.exp(-0.5*x*x)/Math.sqrt(2*Math.PI); }

function bsGreeks(S,K,T,sigma,r,type) {
  if(T<=0||sigma<=0) return {delta:0,gamma:0,vanna:0,charm:0};
  const sqrtT=Math.sqrt(T);
  const d1=(Math.log(S/K)+(r+0.5*sigma*sigma)*T)/(sigma*sqrtT);
  const d2=d1-sigma*sqrtT;
  const nd1=normPDF(d1);
  const gamma=nd1/(S*sigma*sqrtT);
  const vanna=nd1*(1-d1/(sigma*sqrtT))/S;
  const charm_val=-nd1*(2*r*T-d2*sigma*sqrtT)/(2*T*sigma*sqrtT);
  const delta=type==="call"?normCDF(d1):normCDF(d1)-1;
  return {delta,gamma,vanna,charm:charm_val};
}

// ─── API (proxy uzerinden) ──────────────────────────────
async function api(method, params="") {
  const r = await fetch(`/api/deribit?method=${method}&params=${encodeURIComponent(params)}`);
  return r.json();
}

async function fetchSpot() {
  const d = await api("get_index_price","index_name=btc_usd");
  return d.result?.index_price || 0;
}

async function fetchInstruments() {
  const d = await api("get_instruments","currency=BTC&kind=option&expired=false");
  return d.result || [];
}

async function fetchTicker(name) {
  const d = await api("ticker",`instrument_name=${name}`);
  return d.result;
}

async function fetchAllOptions(instruments, spot) {
  const now = Date.now();
  const maxExp = now + 45*24*3600000;
  const filtered = instruments.filter(i => i.expiration_timestamp > now && i.expiration_timestamp <= maxExp);
  const limited = filtered.slice(0, 300);
  const results = [];
  const batch = 15;

  for(let i=0; i<limited.length; i+=batch) {
    const b = limited.slice(i, i+batch);
    const tickers = await Promise.all(b.map(inst => fetchTicker(inst.instrument_name).catch(()=>null)));
    for(let j=0; j<b.length; j++) {
      const inst=b[j], ticker=tickers[j];
      if(!ticker||!ticker.open_interest) continue;
      const T=Math.max((inst.expiration_timestamp-now)/(365.25*24*3600000),0.001);
      const iv=ticker.mark_iv?ticker.mark_iv/100:0.5;
      const oi=ticker.open_interest||0;
      const type=inst.option_type, strike=inst.strike;
      const daysToExp=Math.round(T*365);
      const greeks=bsGreeks(spot,strike,T,iv,0,type);

      let expiryLabel = "";
      if (daysToExp <= 7) expiryLabel = "0-7 gün";
      else if (daysToExp <= 45) expiryLabel = "8-45 gün";
      else expiryLabel = "45+ gün";

      results.push({
        name:inst.instrument_name, strike, type, oi, iv, T, daysToExp,
        expiryLabel,
        expiry:new Date(inst.expiration_timestamp).toLocaleDateString("tr-TR"),
        ...greeks,
        gex: greeks.gamma*oi*spot*spot*0.01*(type==="call"?1:-1),
        vannaEx: greeks.vanna*oi*spot*0.01,
        charmEx: greeks.charm*oi*spot*0.01,
      });
    }
    await new Promise(r=>setTimeout(r,200));
  }
  return results;
}

function aggregateByStrike(options) {
  const map={};
  for(const o of options) {
    const k=o.strike;
    if(!map[k]) map[k]={
      strike:k, callGex:0, putGex:0, netGex:0,
      callOI:0, putOI:0, totalOI:0,
      vannaNet:0, charmNet:0,
      details:[], byExpiry:{}
    };
    map[k].netGex+=o.gex;
    map[k].vannaNet+=o.vannaEx;
    map[k].charmNet+=o.charmEx;
    map[k].totalOI+=o.oi;
    if(o.type==="call"){map[k].callGex+=o.gex;map[k].callOI+=o.oi;}
    else{map[k].putGex+=o.gex;map[k].putOI+=o.oi;}

    if(!map[k].byExpiry[o.expiryLabel]) map[k].byExpiry[o.expiryLabel]={callGex:0,putGex:0,callOI:0,putOI:0};
    const be = map[k].byExpiry[o.expiryLabel];
    if(o.type==="call"){be.callGex+=o.gex;be.callOI+=o.oi;}
    else{be.putGex+=o.gex;be.putOI+=o.oi;}

    map[k].details.push(o);
  }
  return Object.values(map).sort((a,b)=>a.strike-b.strike);
}

function findLevels(strikes, spot) {
  let callWall=null,putWall=null,maxPain=null,zeroGamma=null;
  let maxCG=0,maxPG=0;
  for(const s of strikes){
    if(s.callGex>maxCG){maxCG=s.callGex;callWall=s.strike;}
    if(Math.abs(s.putGex)>maxPG){maxPG=Math.abs(s.putGex);putWall=s.strike;}
  }
  let minPain=Infinity;
  for(const s of strikes){
    let pain=0;
    for(const s2 of strikes){
      pain+=s2.callOI*Math.max(0,s2.strike-s.strike);
      pain+=s2.putOI*Math.max(0,s.strike-s2.strike);
    }
    if(pain<minPain){minPain=pain;maxPain=s.strike;}
  }
  let minDist=Infinity;
  for(let i=1;i<strikes.length;i++){
    if((strikes[i-1].netGex>0)!==(strikes[i].netGex>0)){
      const mid=(strikes[i-1].strike+strikes[i].strike)/2;
      const dist=Math.abs(mid-spot);
      if(dist<minDist){minDist=dist;zeroGamma=Math.round(mid/500)*500;}
    }
  }
  return {callWall,putWall,maxPain,zeroGamma};
}

// ─── GEX Chart ──────────────────────────────────────────
function GexChart({strikes,spot,levels,tooltip,setTooltip}) {
  const canvasRef=useRef(null);
  const containerRef=useRef(null);

  const draw = useCallback(()=>{
    const canvas=canvasRef.current, container=containerRef.current;
    if(!canvas||!container||!strikes.length) return;
    const W=container.clientWidth, H=container.clientHeight;
    canvas.width=W*2; canvas.height=H*2;
    canvas.style.width=W+"px"; canvas.style.height=H+"px";
    const ctx=canvas.getContext("2d");
    ctx.scale(2,2);

    const pad={top:50,right:140,bottom:35,left:80};
    const cW=W-pad.left-pad.right, cH=H-pad.top-pad.bottom;

    const lo=spot*0.7, hi=spot*1.3;
    const vis=strikes.filter(s=>s.strike>=lo&&s.strike<=hi);
    if(!vis.length) return;

    const maxGex=Math.max(...vis.map(s=>Math.abs(s.netGex)),1);
    const barH=Math.max(Math.floor(cH/vis.length)-1,2);

    ctx.clearRect(0,0,W,H);

    const yScale=strike=>pad.top+((hi-strike)/(hi-lo))*cH;
    const xMid=pad.left+cW/2;
    const xScale=gex=>xMid+(gex/maxGex)*(cW/2);

    // Grid lines
    ctx.strokeStyle="#111827"; ctx.lineWidth=0.5;
    const step=Math.max(Math.round((hi-lo)/25/1000)*1000,1000);
    for(let p=Math.ceil(lo/step)*step;p<=hi;p+=step){
      const y=yScale(p);
      ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(W-pad.right,y);ctx.stroke();
    }

    // Center line
    ctx.strokeStyle="#1e293b";ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(xMid,pad.top);ctx.lineTo(xMid,H-pad.bottom);ctx.stroke();

    // Bars — stacked by expiry
    for(const s of vis){
      const y=yScale(s.strike);
      const expKeys = Object.keys(s.byExpiry);
      const colors07 = {call:"#22c55e",put:"#ef4444"};
      const colors845 = {call:"#6366f1",put:"#f97316"};
      const colors45p = {call:"#374151",put:"#374151"};

      let posOffset=0, negOffset=0;
      for(const ek of ["0-7 gün","8-45 gün","45+ gün"]){
        const be=s.byExpiry[ek];
        if(!be) continue;
        const clr = ek==="0-7 gün"?colors07:ek==="8-45 gün"?colors845:colors45p;

        // Call (positive)
        if(be.callGex>0){
          const w=(be.callGex/maxGex)*(cW/2);
          ctx.fillStyle=clr.call; ctx.globalAlpha=0.85;
          ctx.fillRect(xMid+posOffset,y-barH/2,w,barH);
          posOffset+=w;
        }
        // Put (negative)
        if(be.putGex<0){
          const w=(Math.abs(be.putGex)/maxGex)*(cW/2);
          ctx.fillStyle=clr.put; ctx.globalAlpha=0.85;
          ctx.fillRect(xMid-negOffset-w,y-barH/2,w,barH);
          negOffset+=w;
        }
      }
      ctx.globalAlpha=1;
    }

    // Level lines
    const drawLvl=(price,color,label,dash)=>{
      if(!price) return;
      const y=yScale(price);
      if(y<pad.top||y>H-pad.bottom) return;
      ctx.save();
      ctx.strokeStyle=color; ctx.lineWidth=1.5;
      ctx.setLineDash(dash||[]);
      ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(W-pad.right,y);ctx.stroke();
      ctx.restore();

      // Right label
      ctx.fillStyle="#0d1117";
      ctx.fillRect(W-pad.right+2,y-9,pad.right-4,18);
      ctx.strokeStyle=color;ctx.lineWidth=1;
      ctx.strokeRect(W-pad.right+2,y-9,pad.right-4,18);
      ctx.fillStyle=color;ctx.font="bold 10px monospace";ctx.textAlign="left";
      ctx.fillText(`${label} ${price.toLocaleString()}`,W-pad.right+6,y+4);
    };

    drawLvl(spot,"#FFD700","⚡ SPOT",[]);
    drawLvl(levels.callWall,"#22c55e","Call Wall",[8,4]);
    drawLvl(levels.putWall,"#ef4444","Put Wall",[8,4]);
    drawLvl(levels.maxPain,"#f97316","MaxPain",[4,4]);
    drawLvl(levels.zeroGamma,"#06b6d4","Zero Γ",[3,6]);

    // Y axis
    ctx.fillStyle="#6b7280";ctx.font="10px monospace";ctx.textAlign="right";
    for(let p=Math.ceil(lo/step)*step;p<=hi;p+=step){
      ctx.fillText(p.toLocaleString(),pad.left-5,yScale(p)+3);
    }

    // X axis
    ctx.textAlign="center";ctx.fillStyle="#4b5563";ctx.font="10px monospace";
    ctx.fillText("← Put (Negatif GEX)",pad.left+cW*0.25,H-8);
    ctx.fillText("Call (Pozitif GEX) →",pad.left+cW*0.75,H-8);
    ctx.fillText("Net GEX (Milyar $)",W/2,H-8);

    // Title
    ctx.fillStyle="#e5e7eb";ctx.font="bold 13px monospace";ctx.textAlign="center";
    ctx.fillText("GEX Profili",pad.left+cW/2,25);

    // Legend
    ctx.font="9px monospace";ctx.textAlign="left";
    const ly=38;
    [[pad.left,"#22c55e","Call 0-7 gün"],[pad.left+90,"#ef4444","Put 0-7 gün"],
     [pad.left+170,"#6366f1","Call 8-45 gün"],[pad.left+270,"#f97316","Put 8-45 gün"],
     [pad.left+370,"#374151","45+ gün"]].forEach(([x,c,t])=>{
      ctx.fillStyle=c;ctx.fillRect(x,ly-6,8,8);
      ctx.fillStyle="#9ca3af";ctx.fillText(t,x+11,ly+1);
    });

  },[strikes,spot,levels]);

  useEffect(()=>{draw();},[draw]);
  useEffect(()=>{
    const h=()=>draw();
    window.addEventListener("resize",h);
    return ()=>window.removeEventListener("resize",h);
  },[draw]);

  const handleMouse=(e)=>{
    const canvas=canvasRef.current;
    if(!canvas||!strikes.length) return;
    const rect=canvas.getBoundingClientRect();
    const mouseY=e.clientY-rect.top;
    const H=rect.height;
    const pad={top:50,bottom:35};
    const cH=H-pad.top-pad.bottom;
    const lo=spot*0.7,hi=spot*1.3;
    const price=hi-((mouseY-pad.top)/cH)*(hi-lo);

    let closest=null,minD=Infinity;
    for(const s of strikes){
      const d=Math.abs(s.strike-price);
      if(d<minD){minD=d;closest=s;}
    }
    if(closest&&minD<(hi-lo)*0.015){
      setTooltip({x:e.clientX-rect.left,y:e.clientY-rect.top,data:closest});
    } else setTooltip(null);
  };

  return (
    <div ref={containerRef} style={{position:"relative",width:"100%",height:"100%"}}
         onMouseMove={handleMouse} onMouseLeave={()=>setTooltip(null)}>
      <canvas ref={canvasRef} style={{width:"100%",height:"100%"}} />
      {tooltip&&(
        <div style={{
          position:"absolute",
          left:Math.min(tooltip.x+12,containerRef.current?.clientWidth-250||300),
          top:Math.max(tooltip.y-10,10),
          background:"#0f172aee",border:"1px solid #334155",borderRadius:8,
          padding:"10px 14px",color:"#fff",fontSize:11,fontFamily:"monospace",
          pointerEvents:"none",zIndex:10,minWidth:220,backdropFilter:"blur(8px)"
        }}>
          <div style={{color:"#fbbf24",fontWeight:"bold",fontSize:13,marginBottom:6}}>
            Strike: {tooltip.data.strike.toLocaleString()}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"2px 12px"}}>
            <div>Net GEX:</div>
            <div style={{color:tooltip.data.netGex>=0?"#22c55e":"#ef4444",fontWeight:"bold"}}>
              ${(tooltip.data.netGex/1e6).toFixed(2)}M
            </div>
            <div>Call GEX:</div>
            <div style={{color:"#22c55e"}}>${(tooltip.data.callGex/1e6).toFixed(2)}M</div>
            <div>Put GEX:</div>
            <div style={{color:"#ef4444"}}>${(tooltip.data.putGex/1e6).toFixed(2)}M</div>
          </div>
          <div style={{borderTop:"1px solid #1e293b",marginTop:6,paddingTop:6,
                       display:"grid",gridTemplateColumns:"1fr 1fr",gap:"2px 12px"}}>
            <div>Call OI:</div><div>{tooltip.data.callOI.toFixed(1)} BTC</div>
            <div>Put OI:</div><div>{tooltip.data.putOI.toFixed(1)} BTC</div>
            <div>Toplam OI:</div><div style={{fontWeight:"bold"}}>{tooltip.data.totalOI.toFixed(1)} BTC</div>
          </div>
          {tooltip.data.details.length>0&&(
            <div style={{borderTop:"1px solid #1e293b",marginTop:6,paddingTop:6,fontSize:10}}>
              <div style={{color:"#94a3b8",marginBottom:3}}>Opsiyonlar:</div>
              {tooltip.data.details.slice(0,6).map((d,i)=>(
                <div key={i} style={{color:d.type==="call"?"#4ade80":"#f87171",lineHeight:"16px"}}>
                  {d.type.toUpperCase()} {d.expiry} ({d.daysToExp}g) | OI:{d.oi.toFixed(1)} | IV:{(d.iv*100).toFixed(0)}% | DA-GEX:${(d.gex/1e6).toFixed(2)}M
                </div>
              ))}
              {tooltip.data.details.length>6&&(
                <div style={{color:"#475569"}}>+{tooltip.data.details.length-6} daha...</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────
export default function Home() {
  const [spot,setSpot]=useState(0);
  const [strikes,setStrikes]=useState([]);
  const [levels,setLevels]=useState({});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState(null);
  const [tooltip,setTooltip]=useState(null);
  const [lastUpdate,setLastUpdate]=useState(null);
  const [totals,setTotals]=useState({gamma:0,vanna:0,charm:0});
  const [progress,setProgress]=useState("");

  const loadData=useCallback(async()=>{
    try{
      setLoading(true);setError(null);
      setProgress("Spot fiyat alınıyor...");
      const s=await fetchSpot();
      if(!s) throw new Error("Spot fiyat alınamadı");
      setSpot(s);

      setProgress("Opsiyon enstrümanları çekiliyor...");
      const instruments=await fetchInstruments();
      if(!instruments.length) throw new Error("Opsiyon verisi yok");

      setProgress(`${instruments.length} opsiyon analiz ediliyor...`);
      const options=await fetchAllOptions(instruments,s);

      setProgress("GEX hesaplanıyor...");
      const agg=aggregateByStrike(options);
      const lvls=findLevels(agg,s);

      setStrikes(agg);
      setLevels(lvls);
      setTotals({
        gamma:agg.reduce((a,s)=>a+s.netGex,0),
        vanna:agg.reduce((a,s)=>a+s.vannaNet,0),
        charm:agg.reduce((a,s)=>a+s.charmNet,0),
      });
      setLastUpdate(new Date());
      setLoading(false);
    }catch(e){setError(e.message);setLoading(false);}
  },[]);

  useEffect(()=>{
    loadData();
    const iv=setInterval(loadData,5*60000);
    return()=>clearInterval(iv);
  },[loadData]);

  const gReg=totals.gamma>0?"POZİTİF Γ":"NEGATİF Γ";
  const gClr=totals.gamma>0?"#22c55e":"#ef4444";

  return (
    <>
      <Head>
        <title>BTC GEX Dashboard | Deribit</title>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
      </Head>
      <div style={{background:"#0a0a1a",color:"#fff",minHeight:"100vh",fontFamily:"'JetBrains Mono',monospace"}}>

        {/* Header */}
        <div style={{
          background:"#0d1117",borderBottom:"1px solid #1e293b",
          padding:"10px 16px",display:"flex",alignItems:"center",
          justifyContent:"space-between",flexWrap:"wrap",gap:8
        }}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span style={{color:gClr,fontSize:18}}>●</span>
            <span style={{color:gClr,fontWeight:"bold",fontSize:12}}>{gReg}</span>
            <span style={{color:"#64748b",fontSize:12}}>BTC — QUANTUM GEX</span>
            <span style={{color:"#fbbf24",fontWeight:"bold",fontSize:14}}>
              Spot: ${spot?spot.toLocaleString():"..."}
            </span>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{color:"#475569",fontSize:10}}>
              {lastUpdate?lastUpdate.toLocaleString("tr-TR"):""}
            </span>
            <button onClick={loadData} disabled={loading} style={{
              background:"#1e293b",color:"#94a3b8",border:"1px solid #334155",
              padding:"3px 10px",borderRadius:4,cursor:"pointer",fontSize:11
            }}>↻ Yenile</button>
          </div>
        </div>

        {/* Key Levels */}
        {!loading&&!error&&(
          <div style={{
            display:"flex",gap:14,padding:"8px 16px",
            background:"#0d1117",borderBottom:"1px solid #111827",
            overflowX:"auto",flexWrap:"wrap"
          }}>
            {levels.callWall&&<LevelTag c="#22c55e" l="⚡ Call Wall" v={levels.callWall}/>}
            {levels.putWall&&<LevelTag c="#ef4444" l="⚡ Put Wall" v={levels.putWall}/>}
            {levels.maxPain&&<LevelTag c="#f97316" l="◎ Max Pain" v={levels.maxPain}/>}
            {levels.zeroGamma&&<LevelTag c="#06b6d4" l="Γ Zero Gamma" v={levels.zeroGamma}/>}
            <LevelTag c="#a855f7" l="Σ Net GEX" v={`$${(totals.gamma/1e9).toFixed(3)}B`} raw/>
            <LevelTag c="#64748b" l="Vanna" v={`${(totals.vanna/1e6).toFixed(1)}M`} raw/>
            <LevelTag c="#78716c" l="Charm" v={`${(totals.charm/1e6).toFixed(1)}M`} raw/>
          </div>
        )}

        {/* Loading */}
        {loading&&(
          <div style={{textAlign:"center",padding:80,color:"#475569"}}>
            <div style={{fontSize:24,marginBottom:12}}>⏳</div>
            <div style={{fontSize:14}}>{progress}</div>
            <div style={{fontSize:11,marginTop:8}}>İlk yükleme 30-60 saniye sürebilir</div>
          </div>
        )}

        {/* Error */}
        {error&&(
          <div style={{textAlign:"center",padding:60,color:"#ef4444"}}>
            <div>❌ {error}</div>
            <button onClick={loadData} style={{
              marginTop:12,background:"#1e293b",color:"#fff",border:"1px solid #ef4444",
              padding:"6px 16px",borderRadius:6,cursor:"pointer"
            }}>Tekrar Dene</button>
          </div>
        )}

        {/* Chart */}
        {!loading&&!error&&(
          <div style={{height:"calc(100vh - 100px)",padding:"0 8px 8px"}}>
            <GexChart strikes={strikes} spot={spot} levels={levels}
                      tooltip={tooltip} setTooltip={setTooltip}/>
          </div>
        )}
      </div>
    </>
  );
}

function LevelTag({c,l,v,raw}) {
  return (
    <div style={{fontSize:11,whiteSpace:"nowrap"}}>
      <span style={{color:c}}>{l}:</span>{" "}
      <span style={{color:"#e5e7eb",fontWeight:"bold"}}>{raw?v:v.toLocaleString()}</span>
    </div>
  );
}
