import { useState, useEffect, useRef, useCallback } from "react";
import Head from "next/head";
import {
  fetchSpot, fetchInstruments, fetchAllOptions, fetchOHLCV,
  aggregateByStrike, findLevels, classifyStrikes
} from "../lib/gex";

// ═══════════════════════════════════════════════════════════
// COLORS
// ═══════════════════════════════════════════════════════════
const C = {
  bg:"#0a0a1a", panel:"#0d1117", border:"#1e293b", grid:"#111827",
  text:"#e5e7eb", dim:"#6b7280", muted:"#475569",
  green:"#22c55e", red:"#ef4444", yellow:"#FFD700", orange:"#f97316",
  cyan:"#06b6d4", purple:"#a855f7", indigo:"#818cf8", pink:"#ec4899",
  callWall:"#ff2d7b", putWall:"#00e5cc", magnet:"#9333ea",
  exp07c:"#22c55e", exp07p:"#ef4444",
  exp845c:"#6366f1", exp845p:"#f97316",
  exp45c:"#475569", exp45p:"#78716c",
};
const fmt=(n)=>n?n.toLocaleString():"—";

// ═══════════════════════════════════════════════════════════
// INFO CARDS (top section like reference image)
// ═══════════════════════════════════════════════════════════
function InfoCards({spot,levels,totals,stats}) {
  const pctBadge=(pct,inv)=>{
    if(!pct) return null;
    const n=parseFloat(pct);
    const up=inv?n<0:n>0;
    return (
      <span style={{color:up?C.green:C.red,fontSize:11,marginLeft:6}}>
        {up?"↑":"↓"} {Math.abs(n).toFixed(1)}%
      </span>
    );
  };

  const cards=[
    {label:"SPOT",value:`$${fmt(spot)}`,color:C.pink,border:C.pink},
    {label:"CALL WALL",value:`$${fmt(levels.callWall)}`,color:C.green,border:C.green,pct:levels.callWallPct},
    {label:"PUT WALL",value:`$${fmt(levels.putWall)}`,color:C.red,border:C.red,pct:levels.putWallPct,inv:true},
    {label:"ZERO GAMMA",value:`$${fmt(levels.zeroGamma)}`,color:C.yellow,border:C.yellow,pct:levels.zeroGammaPct},
    {label:"MAX PAIN",value:`$${fmt(levels.maxPain)}`,color:C.orange,border:C.orange,pct:levels.maxPainPct,inv:true},
    {label:"Vanna / Charm",value:`▲${(totals.vanna/1e9).toFixed(1)}B`,color:C.indigo,border:C.indigo,
      sub:`${totals.charm>=0?"↑":"↓"} ▼${Math.abs(totals.charm/1e6).toFixed(0)}M`},
  ];

  const cards2=[
    {label:"EM BAND (EOW)",
      value:`$${fmt(levels.emLow)} → $${fmt(levels.emHigh)}`,
      color:C.indigo,border:C.indigo,
      sub:levels.emHigh&&spot?`(${((levels.emHigh-spot)/spot*100).toFixed(1)}% yukarı / ${((spot-levels.emLow)/spot*100).toFixed(1)}% aşağı)`:null},
    {label:"NET GEX",value:`▲ ${(totals.gamma/1e9).toFixed(3)}B $`,color:totals.gamma>=0?C.green:C.red,border:totals.gamma>=0?C.green:C.red},
    {label:"VANNA",value:`▲ ${(totals.vanna/1e9).toFixed(1)}B`,color:totals.vanna>=0?C.green:C.red,border:C.indigo},
    {label:"CHARM",value:`▼ ${Math.abs(totals.charm/1e6).toFixed(0)}M`,color:totals.charm>=0?C.green:C.red,border:"#78716c"},
    {label:"DTE / ROWS / EXPIRIES",
      value:`${stats.totalInst||0}g · ${stats.rows||0}r · ${stats.expiries||0}e`,
      color:C.dim,border:C.border},
  ];

  return (
    <div style={{padding:"10px 16px 0"}}>
      {/* Row 1: main levels */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:6}}>
        {cards.map((c,i)=>(
          <div key={i} style={{
            flex:"1 1 140px",minWidth:130,background:C.panel,
            border:`1px solid ${c.border}44`,borderTop:`3px solid ${c.border}`,
            borderRadius:6,padding:"8px 12px",
          }}>
            <div style={{fontSize:10,color:C.dim,marginBottom:2}}>{c.label}</div>
            <div style={{fontSize:16,fontWeight:"bold",color:c.color}}>
              {c.value}
              {c.pct && pctBadge(c.pct,c.inv)}
            </div>
            {c.sub && <div style={{fontSize:10,color:c.color,marginTop:2}}>{c.sub}</div>}
          </div>
        ))}
      </div>
      {/* Row 2: secondary info */}
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:4}}>
        {cards2.map((c,i)=>(
          <div key={i} style={{
            flex:"1 1 180px",minWidth:160,background:C.panel,
            border:`1px solid ${c.border}44`,borderTop:`2px solid ${c.border}`,
            borderRadius:6,padding:"6px 12px",
          }}>
            <div style={{fontSize:9,color:C.dim}}>{c.label}</div>
            <div style={{fontSize:13,fontWeight:"bold",color:c.color,marginTop:1}}>{c.value}</div>
            {c.sub && <div style={{fontSize:9,color:C.dim,marginTop:1}}>{c.sub}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TAB 1: Candlestick + GEX Profile Split View
// ═══════════════════════════════════════════════════════════
function Tab1({strikes,spot,levels,ohlcv}) {
  const canvasRef=useRef(null);
  const ctrRef=useRef(null);
  const [tip,setTip]=useState(null);

  const draw=useCallback(()=>{
    const canvas=canvasRef.current,ctr=ctrRef.current;
    if(!canvas||!ctr||!strikes.length) return;
    const W=ctr.clientWidth,H=ctr.clientHeight;
    canvas.width=W*2;canvas.height=H*2;
    canvas.style.width=W+"px";canvas.style.height=H+"px";
    const ctx=canvas.getContext("2d");ctx.scale(2,2);

    const splitX=Math.floor(W*0.56);
    const pad={top:50,bottom:55,left:65,right:10};
    const gPad={left:8,right:95};

    // Y range ±20%
    const lo=spot*0.80,hi=spot*1.20;
    const yS=(p)=>pad.top+((hi-p)/(hi-lo))*(H-pad.top-pad.bottom);

    ctx.fillStyle=C.bg;ctx.fillRect(0,0,W,H);

    // Grid
    const step=Math.max(Math.round((hi-lo)/20/1000)*1000,1000);
    ctx.strokeStyle=C.grid;ctx.lineWidth=0.3;
    ctx.fillStyle=C.dim;ctx.font="10px monospace";ctx.textAlign="right";
    for(let p=Math.ceil(lo/step)*step;p<=hi;p+=step) {
      const y=yS(p);
      ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(W-gPad.right,y);ctx.stroke();
      ctx.fillText(p.toLocaleString(),pad.left-4,y+3);
    }

    // Divider
    ctx.strokeStyle=C.border;ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(splitX,pad.top-5);ctx.lineTo(splitX,H-pad.bottom+5);ctx.stroke();

    // ─── Level lines ─────────────────────────────────
    const drawLvl=(price,color,label,dash,bold)=>{
      if(!price)return;
      const y=yS(price);
      if(y<pad.top-5||y>H-pad.bottom+5)return;
      ctx.save();ctx.strokeStyle=color;ctx.lineWidth=bold?2:1;
      ctx.setLineDash(dash||[]);ctx.globalAlpha=0.55;
      ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(W-gPad.right,y);ctx.stroke();
      ctx.restore();
      const lx=W-gPad.right+3,tw=gPad.right-6;
      ctx.fillStyle=C.panel;ctx.fillRect(lx,y-8,tw,16);
      ctx.strokeStyle=color;ctx.lineWidth=1;ctx.strokeRect(lx,y-8,tw,16);
      ctx.fillStyle=color;ctx.font="bold 8px monospace";ctx.textAlign="left";
      ctx.fillText(`${label}: ${fmt(price)}`,lx+2,y+3);
    };

    // Spot solid
    if(spot){
      const sy=yS(spot);
      if(sy>=pad.top&&sy<=H-pad.bottom){
        ctx.save();ctx.strokeStyle=C.yellow;ctx.lineWidth=1.5;ctx.setLineDash([2,2]);ctx.globalAlpha=0.7;
        ctx.beginPath();ctx.moveTo(pad.left,sy);ctx.lineTo(W-gPad.right,sy);ctx.stroke();ctx.restore();
        const lx=W-gPad.right+3,tw=gPad.right-6;
        ctx.fillStyle=C.yellow;ctx.fillRect(lx,sy-9,tw,18);
        ctx.fillStyle="#000";ctx.font="bold 9px monospace";ctx.textAlign="left";
        ctx.fillText(`⚡ SPOT: ${fmt(spot)}`,lx+2,sy+4);
      }
    }

    drawLvl(levels.zeroGamma,C.cyan,"ZG",[6,3,2,3]);
    drawLvl(levels.emHigh,C.indigo,"⚡ EM High",[4,2]);
    drawLvl(levels.callWall,C.green,"⚡ Call Wall",[8,4]);
    drawLvl(levels.maxPain,C.orange,"◎ Max Pain",[4,4]);
    drawLvl(levels.putWall,C.red,"⚡ Put Wall",[8,4]);
    drawLvl(levels.emLow,C.indigo,"EM Low",[4,2]);

    // ─── LEFT: Candles ───────────────────────────────
    const cArea=splitX-pad.left-15;
    if(ohlcv&&ohlcv.close&&ohlcv.close.length>1){
      const n=ohlcv.close.length;
      const cw=Math.max(Math.floor(cArea/n)-2,2);
      const gap=cArea/n;

      // Vol at bottom
      const volH=(H-pad.top-pad.bottom)*0.12;
      const maxVol=Math.max(...ohlcv.volume,1);

      for(let i=0;i<n;i++){
        const x=pad.left+i*gap+gap/2;
        const o=ohlcv.open[i],cl=ohlcv.close[i],h=ohlcv.high[i],l=ohlcv.low[i];
        const bull=cl>=o;
        const clr=bull?C.green:C.red;

        // Wick
        ctx.strokeStyle=clr;ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(x,yS(h));ctx.lineTo(x,yS(l));ctx.stroke();
        // Body
        const oy=yS(o),cy=yS(cl);
        ctx.fillStyle=clr;ctx.globalAlpha=0.9;
        ctx.fillRect(x-cw/2,Math.min(oy,cy),cw,Math.max(Math.abs(oy-cy),1));
        // Volume
        const vh=(ohlcv.volume[i]/maxVol)*volH;
        ctx.globalAlpha=0.35;
        ctx.fillRect(x-cw/2,H-pad.bottom-vh,cw,vh);
        ctx.globalAlpha=1;
      }

      // X axis labels
      ctx.fillStyle=C.muted;ctx.font="9px monospace";ctx.textAlign="center";
      const lEvery=Math.max(Math.floor(n/6),1);
      for(let i=0;i<n;i+=lEvery){
        const x=pad.left+i*gap+gap/2;
        const dt=new Date(ohlcv.ticks[i]);
        ctx.fillText(`${dt.getMonth()+1}/${dt.getDate()} ${String(dt.getHours()).padStart(2,"0")}:00`,x,H-pad.bottom+15);
        // Date line below
        if(i===0||new Date(ohlcv.ticks[i-lEvery]).getDate()!==dt.getDate()){
          ctx.fillText(`May ${dt.getDate()}, ${dt.getFullYear()}`,x,H-pad.bottom+28);
        }
      }
      ctx.fillStyle=C.text;ctx.font="bold 12px monospace";ctx.textAlign="center";
      ctx.fillText("BTC/USD — Mum Grafiği",pad.left+cArea/2,20);
    } else {
      ctx.fillStyle=C.dim;ctx.font="12px monospace";ctx.textAlign="center";
      ctx.fillText("Mum verisi yükleniyor...",pad.left+cArea/2,H/2);
    }

    // ─── RIGHT: GEX Profile stacked bars ─────────────
    const gL=splitX+gPad.left,gR=W-gPad.right,gW=gR-gL,gMid=gL+gW/2;
    const vis=strikes.filter(s=>s.strike>=lo&&s.strike<=hi);
    if(!vis.length)return;
    const maxGex=Math.max(...vis.map(s=>Math.abs(s.netGex)),1);
    const barH=Math.max(Math.floor((H-pad.top-pad.bottom)/vis.length)-1,2);

    // Center line
    ctx.strokeStyle=C.border;ctx.lineWidth=0.5;
    ctx.beginPath();ctx.moveTo(gMid,pad.top);ctx.lineTo(gMid,H-pad.bottom);ctx.stroke();

    const colorMap={
      "0-7d":{c:C.exp07c,p:C.exp07p},
      "8-45d":{c:C.exp845c,p:C.exp845p},
      "45d+":{c:C.exp45c,p:C.exp45p},
    };

    for(const s of vis){
      const y=yS(s.strike);
      let posOff=0,negOff=0;
      for(const ek of ["0-7d","8-45d","45d+"]){
        const be=s.byExpiry[ek];if(!be)continue;
        const clr=colorMap[ek];
        if(be.callGex>0){
          const w=(be.callGex/maxGex)*(gW/2);
          ctx.fillStyle=clr.c;ctx.globalAlpha=0.85;
          ctx.fillRect(gMid+posOff,y-barH/2,w,barH);posOff+=w;
        }
        if(be.putGex<0){
          const w=(Math.abs(be.putGex)/maxGex)*(gW/2);
          ctx.fillStyle=clr.p;ctx.globalAlpha=0.85;
          ctx.fillRect(gMid-negOff-w,y-barH/2,w,barH);negOff+=w;
        }
      }
      ctx.globalAlpha=1;
      // Net GEX diamond
      const nx=gMid+(s.netGex/maxGex)*(gW/2);
      ctx.fillStyle=C.yellow;ctx.globalAlpha=0.9;
      ctx.beginPath();ctx.moveTo(nx,y-3);ctx.lineTo(nx+3,y);ctx.lineTo(nx,y+3);ctx.lineTo(nx-3,y);
      ctx.closePath();ctx.fill();ctx.globalAlpha=1;

      // OI delta marker (teal)
      if(s.totalOI>0){
        const oiMax=Math.max(...vis.map(v=>v.totalOI),1);
        const oiW=(s.totalOI/oiMax)*(gW*0.15);
        ctx.fillStyle=C.cyan;ctx.globalAlpha=0.25;
        ctx.fillRect(gMid-oiW/2,y-barH/4,oiW,barH/2);
        ctx.globalAlpha=1;
      }
    }

    // GEX title + legend
    ctx.fillStyle=C.text;ctx.font="bold 12px monospace";ctx.textAlign="center";
    ctx.fillText("GEX Profili",gMid,20);

    // Info box (gamma/charm/skew)
    const totG=vis.reduce((a,s)=>a+s.netGex,0);
    const totC=vis.reduce((a,s)=>a+s.charmNet,0);
    ctx.fillStyle="#0d1117cc";ctx.fillRect(pad.left+5,pad.top+2,280,16);
    ctx.fillStyle=C.dim;ctx.font="9px monospace";ctx.textAlign="left";
    ctx.fillText(`Gamma: ▲ ${(totG/1e9).toFixed(1)}B  Charm: ▼ ${(totC/1e6).toFixed(0)}M  |  ATM Skew: +0.6%`,pad.left+10,pad.top+12);

    // Bottom legend
    const ly=H-pad.bottom+18;
    ctx.font="8px monospace";ctx.textAlign="left";
    const leg=[
      [pad.left,C.exp07c,"BTC/USD"],[pad.left+55,"#475569","Hacim"],
      [pad.left+95,C.exp07c,"Call 45+gün ▶"],[pad.left+175,C.exp07p,"Put 45+gün ▶"],
      [pad.left+250,C.exp845c,"Call 8-45 gün"],[pad.left+335,C.exp845p,"Put 8-45 gün"],
      [pad.left+415,C.exp45c,"Call 0-7 gün ◀"],[pad.left+500,C.exp45p,"Put 0-7 gün ◀"],
      [pad.left+580,"#888","— Net GEX"],[pad.left+650,C.cyan,"OI Δ"],
      [pad.left+690,C.yellow,"◆ DA-GEX"],
    ];
    for(const [x,c,t] of leg){
      ctx.fillStyle=c;ctx.fillRect(x,ly-4,7,7);
      ctx.fillStyle=C.dim;ctx.fillText(t,x+9,ly+3);
    }

    // X axis GEX labels
    ctx.fillStyle=C.muted;ctx.font="9px monospace";ctx.textAlign="center";
    ctx.fillText("Net GEX (Milyar $)",gMid,H-pad.bottom+42);
    for(let v=-4;v<=4;v+=2){
      const x=gMid+(v/4)*(gW/2);
      ctx.fillText(v.toString(),x,H-pad.bottom+15);
    }

    // Y axis label
    ctx.save();ctx.translate(14,H/2);ctx.rotate(-Math.PI/2);
    ctx.fillStyle=C.dim;ctx.font="10px monospace";ctx.textAlign="center";
    ctx.fillText("Fiyat ($)",0,0);ctx.restore();

  },[strikes,spot,levels,ohlcv]);

  useEffect(()=>{draw();},[draw]);
  useEffect(()=>{const h=()=>draw();window.addEventListener("resize",h);return()=>window.removeEventListener("resize",h);},[draw]);

  const handleMouse=(e)=>{
    const canvas=canvasRef.current;if(!canvas||!strikes.length)return;
    const rect=canvas.getBoundingClientRect();
    const mouseY=e.clientY-rect.top;
    const lo=spot*0.80,hi=spot*1.20;
    const price=hi-((mouseY-50)/(rect.height-50-55))*(hi-lo);
    let closest=null,minD=Infinity;
    for(const s of strikes){const d=Math.abs(s.strike-price);if(d<minD){minD=d;closest=s;}}
    if(closest&&minD<(hi-lo)*0.02) setTip({x:e.clientX-rect.left,y:e.clientY-rect.top,data:closest});
    else setTip(null);
  };

  return (
    <div ref={ctrRef} style={{position:"relative",width:"100%",height:"100%"}}
      onMouseMove={handleMouse} onMouseLeave={()=>setTip(null)}>
      <canvas ref={canvasRef} style={{width:"100%",height:"100%"}} />
      {tip&&<Tooltip t={tip} ctr={ctrRef} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TAB 2: Detailed GEX Profile with Wall Labels
// ═══════════════════════════════════════════════════════════
function Tab2({classified,spot,levels}) {
  const canvasRef=useRef(null);
  const ctrRef=useRef(null);
  const [tip,setTip]=useState(null);

  const draw=useCallback(()=>{
    const canvas=canvasRef.current,ctr=ctrRef.current;
    if(!canvas||!ctr||!classified.length)return;
    const W=ctr.clientWidth,H=ctr.clientHeight;
    canvas.width=W*2;canvas.height=H*2;
    canvas.style.width=W+"px";canvas.style.height=H+"px";
    const ctx=canvas.getContext("2d");ctx.scale(2,2);

    const pad={top:40,bottom:30,left:65,right:110};
    const cW=W-pad.left-pad.right,cH=H-pad.top-pad.bottom;
    const lo=spot*0.78,hi=spot*1.22;
    const yS=(p)=>pad.top+((hi-p)/(hi-lo))*cH;

    ctx.fillStyle=C.bg;ctx.fillRect(0,0,W,H);

    // Grid
    const step=Math.max(Math.round((hi-lo)/30/500)*500,500);
    ctx.strokeStyle=C.grid;ctx.lineWidth=0.3;
    ctx.fillStyle=C.dim;ctx.font="10px monospace";ctx.textAlign="right";
    for(let p=Math.ceil(lo/step)*step;p<=hi;p+=step){
      const y=yS(p);
      ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(W-pad.right,y);ctx.stroke();
      ctx.fillText(p.toLocaleString(),pad.left-4,y+3);
    }

    const vis=classified.filter(s=>s.strike>=lo&&s.strike<=hi);
    if(!vis.length)return;
    const maxGex=Math.max(...vis.map(s=>Math.max(s.callGex,Math.abs(s.putGex))),1);
    const barH=Math.max(Math.floor(cH/vis.length)-1,2);

    for(const s of vis){
      const y=yS(s.strike);
      // Call bar
      if(s.callGex>0){
        const w=(s.callGex/maxGex)*cW*0.85;
        ctx.fillStyle=C.callWall;ctx.globalAlpha=0.8;
        ctx.fillRect(pad.left,y-barH/2,w,barH);
      }
      // Put bar (overlaid)
      if(s.putGex<0){
        const w=(Math.abs(s.putGex)/maxGex)*cW*0.85;
        ctx.fillStyle=C.putWall;ctx.globalAlpha=0.7;
        ctx.fillRect(pad.left,y-barH/2,w,barH);
      }
      // Magnet overlay
      if(s.wallType==="magnet"&&s.isSignificant){
        const w=(Math.max(s.callGex,Math.abs(s.putGex))/maxGex)*cW*0.85;
        ctx.fillStyle=C.magnet;ctx.globalAlpha=0.35;
        ctx.fillRect(pad.left,y-barH/2,w,barH);
      }
      ctx.globalAlpha=1;

      // Wall labels
      if(s.isSignificant&&barH>=3){
        const gexVal=Math.abs(s.netGex)>1e6?`${(Math.abs(s.netGex)/1e6).toFixed(1)}M`:`${(Math.abs(s.netGex)/1e3).toFixed(0)}K`;
        const barW=(Math.max(s.callGex,Math.abs(s.putGex))/maxGex)*cW*0.85;
        if(barW>100){
          let lClr,lIcon,lType;
          if(s.wallType==="callWall"){lClr=C.yellow;lIcon="⚡";lType="CALL WALL";}
          else if(s.wallType==="putWall"){lClr=C.cyan;lIcon="◎";lType="PUT WALL";}
          else if(s.wallType==="magnet"){lClr=C.purple;lIcon="🧲";lType="MAGNET";}
          else continue;

          // Dashed extension line
          ctx.save();ctx.strokeStyle=lClr;ctx.lineWidth=1;ctx.globalAlpha=0.4;
          ctx.setLineDash([4,3]);
          ctx.beginPath();ctx.moveTo(pad.left+barW+5,y);ctx.lineTo(W-pad.right,y);ctx.stroke();
          ctx.restore();

          // Label on bar
          const tx=pad.left+barW/2;
          const text=`--- ${lIcon} ${lType}  ${gexVal}  [${s.oiPct}%|${s.gexPct}%]`;
          ctx.font="bold 9px monospace";ctx.textAlign="center";
          const tw=ctx.measureText(text).width+8;
          ctx.fillStyle="#0a0a1acc";ctx.fillRect(tx-tw/2,y-7,tw,14);
          ctx.fillStyle=lClr;ctx.fillText(text,tx,y+3);
        }
      }
    }

    // Level labels on right
    const drawLvl=(price,color,label)=>{
      if(!price)return;
      const y=yS(price);if(y<pad.top-5||y>H-pad.bottom+5)return;
      const lx=W-pad.right+4,tw=pad.right-8;
      ctx.fillStyle=C.panel;ctx.fillRect(lx,y-9,tw,18);
      ctx.strokeStyle=color;ctx.lineWidth=1;ctx.strokeRect(lx,y-9,tw,18);
      ctx.fillStyle=color;ctx.font="bold 9px monospace";ctx.textAlign="left";
      ctx.fillText(`${label} ${fmt(price)}`,lx+3,y+3);
    };

    // Spot line
    if(spot){
      const sy=yS(spot);
      if(sy>=pad.top&&sy<=H-pad.bottom){
        ctx.save();ctx.strokeStyle=C.yellow;ctx.lineWidth=2;ctx.setLineDash([]);ctx.globalAlpha=0.8;
        ctx.beginPath();ctx.moveTo(pad.left,sy);ctx.lineTo(W-pad.right,sy);ctx.stroke();ctx.restore();
        const lx=W-pad.right+4,tw=pad.right-8;
        ctx.fillStyle=C.yellow;ctx.fillRect(lx,sy-10,tw,20);
        ctx.fillStyle="#000";ctx.font="bold 10px monospace";ctx.textAlign="left";
        ctx.fillText(`⚡ SPOT ${fmt(spot)}`,lx+3,sy+4);
      }
    }

    drawLvl(levels.zeroGamma,C.cyan,"◎ ZG");
    drawLvl(levels.emHigh,C.indigo,"EM High");
    drawLvl(levels.callWall,C.green,"⚡ CW");
    drawLvl(levels.maxPain,C.orange,"◎ MP");
    drawLvl(levels.emLow,C.indigo,"EM Low");
    drawLvl(levels.putWall,C.red,"⚡ PW");

    // Legend top-left
    ctx.font="10px monospace";ctx.textAlign="left";
    [[pad.left+10,C.callWall,"⚡ CALL WALL"],[pad.left+140,C.putWall,"◎ PUT WALL"],[pad.left+260,C.magnet,"🧲 MAGNET"]]
    .forEach(([x,c,t])=>{
      ctx.fillStyle=c;ctx.globalAlpha=0.8;ctx.fillRect(x,14,12,12);
      ctx.globalAlpha=1;ctx.fillStyle=c;ctx.fillText(t,x+16,24);
    });
  },[classified,spot,levels]);

  useEffect(()=>{draw();},[draw]);
  useEffect(()=>{const h=()=>draw();window.addEventListener("resize",h);return()=>window.removeEventListener("resize",h);},[draw]);

  const handleMouse=(e)=>{
    const canvas=canvasRef.current;if(!canvas||!classified.length)return;
    const rect=canvas.getBoundingClientRect();
    const lo=spot*0.78,hi=spot*1.22;
    const price=hi-((e.clientY-rect.top-40)/(rect.height-70))*(hi-lo);
    let closest=null,minD=Infinity;
    for(const s of classified){const d=Math.abs(s.strike-price);if(d<minD){minD=d;closest=s;}}
    if(closest&&minD<(hi-lo)*0.015) setTip({x:e.clientX-rect.left,y:e.clientY-rect.top,data:closest});
    else setTip(null);
  };

  return (
    <div ref={ctrRef} style={{position:"relative",width:"100%",height:"100%"}}
      onMouseMove={handleMouse} onMouseLeave={()=>setTip(null)}>
      <canvas ref={canvasRef} style={{width:"100%",height:"100%"}} />
      {tip&&<Tooltip t={tip} ctr={ctrRef} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Tooltip
// ═══════════════════════════════════════════════════════════
function Tooltip({t,ctr}) {
  const cW=ctr.current?.clientWidth||600;
  return (
    <div style={{
      position:"absolute",left:Math.min(t.x+14,cW-270),top:Math.max(t.y-10,10),
      background:"#0f172aee",border:"1px solid #334155",borderRadius:8,
      padding:"10px 14px",color:"#fff",fontSize:11,fontFamily:"monospace",
      pointerEvents:"none",zIndex:10,minWidth:240,backdropFilter:"blur(8px)",
    }}>
      <div style={{color:C.yellow,fontWeight:"bold",fontSize:13,marginBottom:6}}>
        Strike: {fmt(t.data.strike)}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"2px 12px"}}>
        <div>Net GEX:</div>
        <div style={{color:t.data.netGex>=0?C.green:C.red,fontWeight:"bold"}}>
          ${(t.data.netGex/1e6).toFixed(2)}M
        </div>
        <div>Call GEX:</div><div style={{color:C.green}}>${(t.data.callGex/1e6).toFixed(2)}M</div>
        <div>Put GEX:</div><div style={{color:C.red}}>${(t.data.putGex/1e6).toFixed(2)}M</div>
      </div>
      <div style={{borderTop:"1px solid #1e293b",marginTop:6,paddingTop:6,
        display:"grid",gridTemplateColumns:"1fr 1fr",gap:"2px 12px"}}>
        <div>Call OI:</div><div>{t.data.callOI.toFixed(1)} BTC</div>
        <div>Put OI:</div><div>{t.data.putOI.toFixed(1)} BTC</div>
        <div>Toplam OI:</div><div style={{fontWeight:"bold"}}>{t.data.totalOI.toFixed(1)} BTC</div>
      </div>
      {t.data.details&&t.data.details.length>0&&(
        <div style={{borderTop:"1px solid #1e293b",marginTop:6,paddingTop:6,fontSize:10}}>
          <div style={{color:"#94a3b8",marginBottom:3}}>Opsiyonlar:</div>
          {t.data.details.slice(0,5).map((d,i)=>(
            <div key={i} style={{color:d.type==="call"?"#4ade80":"#f87171",lineHeight:"15px"}}>
              {d.type.toUpperCase()} {d.expiry} ({d.daysToExp}g) | OI:{d.oi.toFixed(1)} | IV:{(d.iv*100).toFixed(0)}%
            </div>
          ))}
          {t.data.details.length>5&&<div style={{color:"#475569"}}>+{t.data.details.length-5} daha...</div>}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════
export default function Home() {
  const [spot,setSpot]=useState(0);
  const [strikes,setStrikes]=useState([]);
  const [levels,setLevels]=useState({});
  const [classified,setClassified]=useState([]);
  const [ohlcv,setOhlcv]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState(null);
  const [progress,setProgress]=useState("");
  const [lastUpdate,setLastUpdate]=useState(null);
  const [totals,setTotals]=useState({gamma:0,vanna:0,charm:0});
  const [stats,setStats]=useState({rows:0,totalInst:0,expiries:0});
  const [tab,setTab]=useState(0);

  const loadData=useCallback(async()=>{
    try{
      setLoading(true);setError(null);
      setProgress("Spot fiyat alınıyor...");
      const s=await fetchSpot();
      if(!s) throw new Error("Spot fiyat alınamadı");
      setSpot(s);

      fetchOHLCV("60",48).then(d=>{if(d&&d.close)setOhlcv(d);}).catch(()=>{});

      setProgress("Opsiyon enstrümanları çekiliyor...");
      const instruments=await fetchInstruments();
      if(!instruments.length) throw new Error("Opsiyon verisi yok");

      setProgress(`${instruments.length} opsiyon analiz ediliyor...`);
      const {options,stats:st}=await fetchAllOptions(instruments,s,(pct,rows,exps)=>{
        setProgress(`Opsiyonlar: %${pct} (${rows} satır, ${exps} vade)`);
      });
      setStats(st);

      setProgress("GEX hesaplanıyor...");
      const agg=aggregateByStrike(options);
      const lvls=findLevels(agg,s,options);
      const cls=classifyStrikes(agg,s);

      setStrikes(agg);
      setLevels(lvls);
      setClassified(cls);
      setTotals({
        gamma:agg.reduce((a,x)=>a+x.netGex,0),
        vanna:agg.reduce((a,x)=>a+x.vannaNet,0),
        charm:agg.reduce((a,x)=>a+x.charmNet,0),
      });
      setLastUpdate(new Date());
      setLoading(false);
    }catch(e){setError(e.message);setLoading(false);}
  },[]);

  useEffect(()=>{loadData();const iv=setInterval(loadData,5*60000);return()=>clearInterval(iv);},[loadData]);

  const gReg=totals.gamma>0?"POZİTİF GAMMA":"NEGATİF GAMMA";
  const gClr=totals.gamma>0?C.green:C.red;

  const tabBtn=(active)=>({
    padding:"6px 18px",fontSize:12,fontWeight:active?"bold":"normal",
    background:active?"#1e293b":"transparent",
    color:active?"#e5e7eb":"#64748b",
    border:active?"1px solid #334155":"1px solid transparent",
    borderBottom:active?"none":"1px solid #334155",
    borderRadius:"6px 6px 0 0",cursor:"pointer",fontFamily:"monospace",marginRight:2,
  });

  return (
    <>
      <Head>
        <title>BTC GEX Dashboard | Deribit</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
      </Head>
      <div style={{background:C.bg,color:"#fff",minHeight:"100vh",fontFamily:"'JetBrains Mono',monospace"}}>

        {/* ─── Header ──────────────────────────────── */}
        <div style={{
          background:C.panel,borderBottom:`1px solid ${C.border}`,
          padding:"10px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8
        }}>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <span style={{fontSize:28,fontWeight:"bold",color:C.text}}>BTC/USD</span>
            <span style={{color:gClr,fontSize:14}}>●</span>
            <span style={{color:gClr,fontWeight:"bold",fontSize:12}}>{gReg}</span>
            <span style={{color:C.yellow,fontWeight:"bold",fontSize:14}}>
              ${spot?fmt(spot):"..."}
            </span>
            <span style={{color:C.muted,fontSize:11}}>
              | {lastUpdate?`${lastUpdate.toLocaleDateString("tr-TR")} ${lastUpdate.toLocaleTimeString("tr-TR")} UTC`:""}
            </span>
          </div>
          <button onClick={loadData} disabled={loading} style={{
            background:"#1e293b",color:"#94a3b8",border:"1px solid #334155",
            padding:"4px 12px",borderRadius:4,cursor:"pointer",fontSize:11,fontFamily:"monospace",
          }}>↻ Yenile</button>
        </div>

        {/* ─── Info Cards ──────────────────────────── */}
        {!loading&&!error&&(
          <InfoCards spot={spot} levels={levels} totals={totals} stats={stats} />
        )}

        {/* ─── Tabs ────────────────────────────────── */}
        {!loading&&!error&&(
          <div style={{padding:"8px 16px 0",display:"flex",borderBottom:"1px solid #334155"}}>
            <button onClick={()=>setTab(0)} style={tabBtn(tab===0)}>📊 GEX Profili</button>
            <button onClick={()=>setTab(1)} style={tabBtn(tab===1)}>⚡ Quantum</button>
          </div>
        )}

        {/* ─── Loading ─────────────────────────────── */}
        {loading&&(
          <div style={{textAlign:"center",padding:80,color:C.muted}}>
            <div style={{fontSize:22,marginBottom:12}}>⏳</div>
            <div style={{fontSize:14}}>{progress}</div>
            <div style={{fontSize:11,marginTop:8,color:C.dim}}>
              Tüm opsiyonlar çekildiği için 1-2 dakika sürebilir
            </div>
          </div>
        )}

        {/* ─── Error ───────────────────────────────── */}
        {error&&(
          <div style={{textAlign:"center",padding:60,color:C.red}}>
            <div>❌ {error}</div>
            <button onClick={loadData} style={{
              marginTop:12,background:"#1e293b",color:"#fff",border:`1px solid ${C.red}`,
              padding:"6px 16px",borderRadius:6,cursor:"pointer",fontFamily:"monospace",
            }}>Tekrar Dene</button>
          </div>
        )}

        {/* ─── Chart ───────────────────────────────── */}
        {!loading&&!error&&(
          <div style={{height:"calc(100vh - 280px)",padding:"0 8px 8px",minHeight:400}}>
            {tab===0&&<Tab1 strikes={strikes} spot={spot} levels={levels} ohlcv={ohlcv} />}
            {tab===1&&<Tab2 classified={classified} spot={spot} levels={levels} />}
          </div>
        )}
      </div>
    </>
  );
}
