import { useState, useEffect, useRef, useCallback, useContext } from "react";
import { FontCtx } from "./_app";
import {
  fetchSpot, fetchInstruments, fetchAllOptions, fetchOHLCV,
  aggregateByStrike, findLevels, classifyStrikes,
} from "../lib/gex";

// ─── helpers ──────────────────────────────────────────────
const fmt = (n) => n ? Math.round(n).toLocaleString("en-US") : "—";
const fmtM = (n) => { const a = Math.abs(n); if (a >= 1e9) return `${(n/1e9).toFixed(2)}B`; if (a >= 1e6) return `${(n/1e6).toFixed(1)}M`; if (a >= 1e3) return `${(n/1e3).toFixed(0)}K`; return n.toFixed(1); };

function useCountUp(target, ms = 600) {
  const [v, setV] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    if (target === prev.current) return;
    const s = prev.current, t0 = performance.now(); let f;
    const tick = (now) => { const t = Math.min((now-t0)/ms,1), e=1-Math.pow(1-t,3); setV(s+(target-s)*e); if(t<1) f=requestAnimationFrame(tick); else prev.current=target; };
    f = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(f);
  }, [target, ms]);
  return v;
}

// ─── data hook ────────────────────────────────────────────
function useGexData() {
  const [allOptions, setAllOptions] = useState([]);
  const [spot, setSpot] = useState(0);
  const [ohlcv, setOhlcv] = useState(null);
  const [stats, setStats] = useState({ rows: 0, totalInst: 0, expiries: 0 });
  const [change24h, setChange24h] = useState(0);
  const [dvol, setDvol] = useState(52);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState("");
  const [lastUpdate, setLastUpdate] = useState(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError(null); }
    try {
      setProgress("Spot fiyat alınıyor...");
      const s = await fetchSpot();
      if (!s) throw new Error("Spot alınamadı");
      setSpot(s);

      fetchOHLCV("60", 48).then(d => {
        if (d?.close) {
          const n = d.close.length;
          setOhlcv(d);
          if (n > 24) setChange24h((d.close[n-1] - d.close[n-25]) / d.close[n-25] * 100);
        }
      }).catch(() => {});

      setProgress("Opsiyon zinciri çekiliyor...");
      const instruments = await fetchInstruments();

      const { options, stats: st } = await fetchAllOptions(instruments, s, (pct, rows, exps) => {
        setProgress(`Analiz: %${pct} · ${rows} opt · ${exps} vade`);
      });
      setAllOptions(options);
      setStats(st);

      const atmIV = options.filter(o => o.type === "call").sort((a, b) => Math.abs(a.strike - s) - Math.abs(b.strike - s))[0]?.iv;
      if (atmIV) setDvol(atmIV * 100);
      setLastUpdate(new Date());
      setLoading(false);
    } catch (e) {
      setError(e.message); setLoading(false);
    }
  }, []);

  useEffect(() => { load(); const iv = setInterval(() => load(true), 5*60000); return () => clearInterval(iv); }, [load]);

  return { allOptions, spot, ohlcv, stats, change24h, dvol, loading, error, progress, lastUpdate, reload: () => load() };
}

// ─── Sidebar ──────────────────────────────────────────────
function Sidebar({ spot, levels, totals, stats, dvol, change24h, expiry, setExpiry }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">₿</div>
        <div>
          <div className="brand-name">Options Desk</div>
          <div className="brand-sub mono">Deribit Live · GEX</div>
        </div>
      </div>

      <div className="sb-section">
        <div className="sb-label">Vade Filtresi</div>
        <div className="sb-chip-row">
          {[["all","Tümü"],["0-7d","0-7g"],["8-45d","8-45g"],["45d+","45g+"]].map(([v,l]) => (
            <button key={v} className={`sb-chip ${expiry===v?"active":""}`} onClick={() => setExpiry(v)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="sb-section">
        <div className="sb-label">Piyasa</div>
        {[
          ["Spot", `$${fmt(spot)}`],
          ["24h", `${change24h >= 0 ? "+" : ""}${change24h.toFixed(2)}%`, change24h >= 0 ? "pos" : "neg"],
          ["ATM IV", `${dvol.toFixed(1)}%`],
          ["Net GEX", fmtM(totals.gamma) + "$", totals.gamma >= 0 ? "pos" : "neg"],
          ["Vanna", fmtM(totals.vanna) + "$"],
          ["Charm", fmtM(totals.charm) + "$"],
        ].map(([l, v, cls], i) => (
          <div key={i} className="sb-item">
            <span style={{ color: "var(--text-mute)", fontSize: "var(--font-xs)" }}>{l}</span>
            <span className={`mono ${cls || ""}`} style={{ fontSize: "var(--font-xs)", color: "var(--text)" }}>{v}</span>
          </div>
        ))}
      </div>

      <div className="sb-section">
        <div className="sb-label">Kilit Seviyeler</div>
        {[
          ["Call Wall", levels.callWall, levels.callWallPct, "var(--call)"],
          ["EM High", levels.emHigh, levels.emHighPct, "var(--em)"],
          ["Zero Gamma", levels.zeroGamma, levels.zeroGammaPct, "var(--zero-gamma)"],
          ["Max Pain", levels.maxPain, levels.maxPainPct, "var(--max-pain)"],
          ["EM Low", levels.emLow, levels.emLowPct, "var(--em)"],
          ["Put Wall", levels.putWall, levels.putWallPct, "var(--put)"],
        ].map(([l, v, pct, color], i) => (
          <div key={i} className="sb-item">
            <span style={{ color, fontSize: "var(--font-xs)" }}>{l}</span>
            <span className="mono" style={{ fontSize: "var(--font-xs)", color: "var(--text)" }}>
              ${fmt(v)}{pct ? ` ${pct >= 0 ? "+" : ""}${pct}%` : ""}
            </span>
          </div>
        ))}
      </div>

      <div className="sb-section" style={{ marginTop: "auto" }}>
        <div className="sb-label">Chain</div>
        {[["Opsiyonlar", stats.rows], ["Strike", "-"], ["Vade", stats.expiries]].map(([l, v], i) => (
          <div key={i} className="sb-item">
            <span style={{ color: "var(--text-mute)", fontSize: "var(--font-xs)" }}>{l}</span>
            <span className="mono" style={{ fontSize: "var(--font-xs)", color: "var(--text)" }}>{v}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

// ─── GEX Profile Canvas Chart ─────────────────────────────
function GexChart({ strikes, spot, levels, ohlcv, expiry }) {
  const canvasRef = useRef(null);
  const ctrRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const draw = useCallback(() => {
    const canvas = canvasRef.current, ctr = ctrRef.current;
    if (!canvas || !ctr || !strikes.length) return;

    const W = ctr.clientWidth, H = ctr.clientHeight;
    canvas.width = W * 2; canvas.height = H * 2;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d"); ctx.scale(2, 2);

    const splitX = Math.floor(W * 0.56);
    const pad = { top: 48, bottom: 58, left: 68, right: 10 };
    const gPad = { left: 8, right: 90 };

    const lo = spot * 0.82, hi = spot * 1.18;
    const yS = (p) => pad.top + ((hi - p) / (hi - lo)) * (H - pad.top - pad.bottom);

    ctx.fillStyle = "#0c0c0d"; ctx.fillRect(0, 0, W, H);

    // Grid
    const step = Math.max(Math.round((hi - lo) / 18 / 1000) * 1000, 1000);
    ctx.strokeStyle = "#1a1a1e"; ctx.lineWidth = 0.4;
    ctx.fillStyle = "#4a4742"; ctx.font = "10px JetBrains Mono"; ctx.textAlign = "right";
    for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) {
      const y = yS(p);
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - gPad.right, y); ctx.stroke();
      ctx.fillText((p / 1000).toFixed(0) + "K", pad.left - 5, y + 3);
    }

    // Divider
    ctx.strokeStyle = "#1e2025"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(splitX, pad.top - 5); ctx.lineTo(splitX, H - pad.bottom + 5); ctx.stroke();

    // Level lines
    const drawLvl = (price, color, label, dash) => {
      if (!price) return;
      const y = yS(price); if (y < pad.top - 8 || y > H - pad.bottom + 8) return;
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1;
      ctx.setLineDash(dash || []); ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - gPad.right, y); ctx.stroke();
      ctx.restore();
      const lx = W - gPad.right + 3, tw = gPad.right - 5;
      ctx.fillStyle = "#0c0c0d"; ctx.fillRect(lx, y - 8, tw, 16);
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(lx, y - 8, tw, 16);
      ctx.fillStyle = color; ctx.font = "bold 8px JetBrains Mono"; ctx.textAlign = "left";
      ctx.fillText(`${label}: ${fmt(price)}`, lx + 2, y + 3);
    };

    if (spot) {
      const sy = yS(spot);
      if (sy >= pad.top && sy <= H - pad.bottom) {
        ctx.save(); ctx.strokeStyle = "#FFD700"; ctx.lineWidth = 1.5; ctx.setLineDash([2,2]); ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.moveTo(pad.left, sy); ctx.lineTo(W - gPad.right, sy); ctx.stroke(); ctx.restore();
        const lx = W - gPad.right + 3, tw = gPad.right - 5;
        ctx.fillStyle = "#FFD700"; ctx.fillRect(lx, sy - 9, tw, 18);
        ctx.fillStyle = "#000"; ctx.font = "bold 9px JetBrains Mono"; ctx.textAlign = "left";
        ctx.fillText(`⚡ ${fmt(spot)}`, lx + 2, sy + 4);
      }
    }
    drawLvl(levels.zeroGamma, "#06b6d4", "ZG", [6,3,2,3]);
    drawLvl(levels.emHigh, "#818cf8", "EM↑", [4,2]);
    drawLvl(levels.callWall, "#22c55e", "CW", [8,4]);
    drawLvl(levels.maxPain, "#f97316", "MP", [4,4]);
    drawLvl(levels.putWall, "#ef4444", "PW", [8,4]);
    drawLvl(levels.emLow, "#818cf8", "EM↓", [4,2]);

    // Candles
    const cArea = splitX - pad.left - 12;
    if (ohlcv?.close?.length > 1) {
      const n = ohlcv.close.length, cw = Math.max(Math.floor(cArea/n)-3,2), gap = cArea/n;
      const volH = (H-pad.top-pad.bottom)*0.13, maxVol = Math.max(...ohlcv.volume,1);
      for (let i = 0; i < n; i++) {
        const x = pad.left + i*gap + gap/2, o=ohlcv.open[i], cl=ohlcv.close[i], h=ohlcv.high[i], l=ohlcv.low[i];
        const bull = cl >= o, clr = bull ? "#22c55e" : "#ef4444";
        ctx.strokeStyle = clr; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x,yS(h)); ctx.lineTo(x,yS(l)); ctx.stroke();
        ctx.fillStyle = clr; ctx.globalAlpha = 0.9;
        ctx.fillRect(x-cw/2, Math.min(yS(o),yS(cl)), cw, Math.max(Math.abs(yS(o)-yS(cl)),1));
        ctx.globalAlpha = 0.3;
        ctx.fillRect(x-cw/2, H-pad.bottom-(ohlcv.volume[i]/maxVol)*volH, cw, (ohlcv.volume[i]/maxVol)*volH);
        ctx.globalAlpha = 1;
      }
      // X axis labels
      ctx.fillStyle = "#4a4742"; ctx.font = "9px JetBrains Mono"; ctx.textAlign = "center";
      const lEvery = Math.max(Math.floor(n/6),1);
      for (let i = 0; i < n; i += lEvery) {
        const x = pad.left+i*gap+gap/2, dt = new Date(ohlcv.ticks[i]);
        ctx.fillText(`${String(dt.getHours()).padStart(2,"0")}:00`, x, H-pad.bottom+14);
        if (i === 0 || new Date(ohlcv.ticks[Math.max(0,i-lEvery)]).getDate() !== dt.getDate()) {
          ctx.fillText(`${dt.getDate()} May`, x, H-pad.bottom+26);
        }
      }
      // Subtitle
      ctx.fillStyle = "#b8b5ac"; ctx.font = "bold 11px Manrope"; ctx.textAlign = "center";
      ctx.fillText("BTC/USD — Mum Grafiği", pad.left+cArea/2, 26);
    } else {
      ctx.fillStyle = "#4a4742"; ctx.font = "11px Manrope"; ctx.textAlign = "center";
      ctx.fillText("Mum verisi yükleniyor...", pad.left+cArea/2, H/2);
    }

    // Info box
    const totG = strikes.reduce((a,s)=>a+s.netGex,0);
    const totC = strikes.reduce((a,s)=>a+s.charmNet,0);
    ctx.fillStyle = "#0d1117cc"; ctx.fillRect(pad.left+5, pad.top+2, 300, 16);
    ctx.fillStyle = "#4a4742"; ctx.font = "9px JetBrains Mono"; ctx.textAlign = "left";
    ctx.fillText(`Gamma: ▲${fmtM(totG)}  Charm: ${fmtM(totC)}  |  ATM Skew: +0.0%`, pad.left+8, pad.top+12);

    // GEX bars
    const gL = splitX + gPad.left, gR = W - gPad.right, gW = gR - gL, gMid = gL + gW/2;
    const vis = strikes.filter(s => s.strike >= lo && s.strike <= hi);
    if (!vis.length) return;
    const maxGex = Math.max(...vis.map(s => Math.abs(s.netGex)), 1);
    const barH = Math.max(Math.floor((H-pad.top-pad.bottom)/vis.length)-1, 2);

    // Center axis
    ctx.strokeStyle = "#232328"; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(gMid,pad.top); ctx.lineTo(gMid,H-pad.bottom); ctx.stroke();

    // Expiry colors
    const eColors = {
      "0-7d":  { c:"#22c55e", p:"#ef4444" },
      "8-45d": { c:"#6366f1", p:"#f97316" },
      "45d+":  { c:"#475569", p:"#78716c" },
    };
    const activeExp = expiry === "all" ? ["0-7d","8-45d","45d+"] : [expiry];

    for (const s of vis) {
      const y = yS(s.strike);
      let posOff = 0, negOff = 0;
      for (const ek of activeExp) {
        const be = s.byExpiry[ek]; if (!be) continue;
        const clr = eColors[ek];
        if (be.callGex > 0) {
          const w = (be.callGex/maxGex)*(gW/2);
          ctx.fillStyle = clr.c; ctx.globalAlpha = 0.85;
          ctx.fillRect(gMid+posOff, y-barH/2, w, barH); posOff += w;
        }
        if (be.putGex < 0) {
          const w = (Math.abs(be.putGex)/maxGex)*(gW/2);
          ctx.fillStyle = clr.p; ctx.globalAlpha = 0.85;
          ctx.fillRect(gMid-negOff-w, y-barH/2, w, barH); negOff += w;
        }
      }
      ctx.globalAlpha = 1;
      // Net GEX diamond
      const nx = gMid + (s.netGex/maxGex)*(gW/2);
      ctx.fillStyle = "#FFD700"; ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.moveTo(nx,y-3.5); ctx.lineTo(nx+3.5,y); ctx.lineTo(nx,y+3.5); ctx.lineTo(nx-3.5,y); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // GEX title + legend
    ctx.fillStyle = "#b8b5ac"; ctx.font = "bold 11px Manrope"; ctx.textAlign = "center";
    ctx.fillText("GEX Profili", gMid, 26);

    // X axis
    const gexTicks = [-3,-1.5,0,1.5,3];
    ctx.fillStyle = "#4a4742"; ctx.font = "9px JetBrains Mono"; ctx.textAlign = "center";
    for (const v of gexTicks) {
      const x = gMid + (v/3)*(gW/2);
      ctx.beginPath(); ctx.moveTo(x,H-pad.bottom); ctx.lineTo(x,H-pad.bottom+4); ctx.stroke();
      ctx.fillText(v===0?"0":`${v>0?"+":""}${v}B`, x, H-pad.bottom+16);
    }
    ctx.fillText("Net GEX (Milyar $)", gMid, H-pad.bottom+32);

    // Legend
    const ly = H - pad.bottom + 44;
    const leg = [
      [pad.left,      "#8b5cf6","BTC/USD"],
      [pad.left+58,   "#78716c","Hacim"],
      [pad.left+100,  eColors["45d+"].c,"Call 45g+"],
      [pad.left+158,  eColors["45d+"].p,"Put 45g+"],
      [pad.left+210,  eColors["8-45d"].c,"Call 8-45g"],
      [pad.left+270,  eColors["8-45d"].p,"Put 8-45g"],
      [pad.left+325,  eColors["0-7d"].c,"Call 0-7g"],
      [pad.left+375,  eColors["0-7d"].p,"Put 0-7g"],
      [pad.left+420,  "#888","— Net GEX"],
      [pad.left+475,  "#06b6d4","OI Δ"],
      [pad.left+505,  "#FFD700","◆ DA-GEX"],
    ];
    ctx.textAlign = "left";
    for (const [x,c,t] of leg) {
      ctx.fillStyle = c; ctx.fillRect(x, ly-5, 7, 7);
      ctx.fillStyle = "#4a4742"; ctx.fillText(t, x+9, ly+2);
    }

    // Y label
    ctx.save(); ctx.translate(16, H/2); ctx.rotate(-Math.PI/2);
    ctx.fillStyle = "#4a4742"; ctx.textAlign = "center"; ctx.fillText("Fiyat ($)", 0, 0); ctx.restore();
  }, [strikes, spot, levels, ohlcv, expiry]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const h = () => draw(); window.addEventListener("resize", h); return () => window.removeEventListener("resize", h);
  }, [draw]);

  const handleMouseMove = (e) => {
    const canvas = canvasRef.current, ctr = ctrRef.current;
    if (!canvas || !ctr || !strikes.length) return;
    const rect = ctr.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const lo = spot * 0.82, hi = spot * 1.18;
    const pad = { top: 48, bottom: 58 };
    const price = hi - ((mouseY - pad.top) / (rect.height - pad.top - pad.bottom)) * (hi - lo);

    let closest = null, minD = Infinity;
    for (const s of strikes) {
      const d = Math.abs(s.strike - price);
      if (d < minD) { minD = d; closest = s; }
    }
    if (closest && minD < (hi - lo) * 0.025) {
      setTooltip(closest);
      setTooltipPos({ x: e.clientX, y: e.clientY });
    } else {
      setTooltip(null);
    }
  };

  return (
    <div ref={ctrRef} style={{ position: "relative", width: "100%", height: "calc(100vh - 280px)", minHeight: 420 }}
      onMouseMove={handleMouseMove} onMouseLeave={() => setTooltip(null)}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      {tooltip && (
        <div className="gex-tooltip" style={{ left: Math.min(tooltipPos.x + 16, window.innerWidth - 230), top: Math.max(tooltipPos.y - 20, 10) }}>
          <div className="tt-head">Strike: ${fmt(tooltip.strike)}</div>
          <div className="tt-row"><span>Net GEX</span><span className="tt-val" style={{ color: tooltip.netGex >= 0 ? "var(--call)" : "var(--put)" }}>{tooltip.netGex >= 0 ? "+" : ""}${fmtM(tooltip.netGex)}</span></div>
          <div className="tt-row"><span>Call GEX</span><span className="tt-val" style={{ color: "var(--call)" }}>${fmtM(tooltip.callGexDollar)}</span></div>
          <div className="tt-row"><span>Put GEX</span><span className="tt-val" style={{ color: "var(--put)" }}>${fmtM(tooltip.putGexDollar)}</span></div>
          <div style={{ borderTop: "1px solid var(--hairline)", margin: "6px 0" }} />
          <div className="tt-row"><span>Call OI</span><span className="tt-val">{tooltip.callOI.toFixed(1)} BTC</span></div>
          <div className="tt-row"><span>Put OI</span><span className="tt-val">{tooltip.putOI.toFixed(1)} BTC</span></div>
          <div className="tt-row"><span>Toplam OI</span><span className="tt-val">{tooltip.totalOI.toFixed(1)} BTC</span></div>
          {tooltip.details?.slice(0,3).map((d,i) => (
            <div key={i} style={{ color: d.type==="call"?"var(--call)":"var(--put)", fontSize:"var(--font-xs)", lineHeight:"14px", marginTop: i===0?6:2 }}>
              {d.type.toUpperCase()} {d.expiry} ({d.daysToExp}g) OI:{d.oi.toFixed(0)} IV:{(d.iv*100).toFixed(0)}%
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Quantum Walls SVG Chart ──────────────────────────────
function QuantumChart({ classified, spot, levels }) {
  const [tip, setTip] = useState(null);
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);

  const W = 1400, H = 680;
  const pad = { top: 44, right: 56, bottom: 50, left: 108 };
  const cW = W - pad.left - pad.right;
  const cH = H - pad.top - pad.bottom;
  const lo = spot * 0.80, hi = spot * 1.20;
  const yS = (p) => pad.top + ((hi - p) / (hi - lo)) * cH;

  const vis = classified.filter(s => s.strike >= lo && s.strike <= hi);
  if (!vis.length) return null;
  const maxBar = Math.max(...vis.map(s => Math.max(s.callGex, Math.abs(s.putGex))), 1);
  const rowH = Math.max(cH / vis.length - 1, 2.5);
  const xBar = (mag) => (mag / maxBar) * cW * 0.88;

  const wallColors = { callWall: "#ff2d7b", putWall: "#00e5cc", magnet: "#a855f7", neutral: "#334155" };

  const handleMouse = (e) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sy = (e.clientY - rect.top) / rect.height * H;
    const price = hi - ((sy - pad.top) / cH) * (hi - lo);
    let best = null, bestD = Infinity;
    for (const s of vis) { const d = Math.abs(s.strike - price); if (d < bestD) { bestD = d; best = s; } }
    if (best && bestD < (hi - lo) * 0.02) { setTip(best); setTipPos({ x: e.clientX, y: e.clientY }); }
    else setTip(null);
  };

  // Top walls for sidebar
  const topWalls = [...vis].filter(s => s.isMajor).sort((a, b) => Math.abs(b.netGex) - Math.abs(a.netGex)).slice(0, 8);

  return (
    <div className="quantum-wrap">
      <div className="quantum-header">
        <div>
          <div style={{ fontFamily:"var(--serif)", fontStyle:"italic", fontSize: 18, color:"var(--text)" }}>ii. Quantum Walls</div>
          <div style={{ fontFamily:"var(--mono)", fontSize:"var(--font-xs)", color:"var(--text-mute)", marginTop: 2 }}>
            |GAMMA EXPOSURE| · USD &nbsp;&nbsp;·&nbsp;&nbsp; {vis.filter(s=>s.wallType==="callWall").length} CALL WALLS · {vis.filter(s=>s.wallType==="putWall").length} PUT WALLS · {vis.filter(s=>s.wallType==="magnet").length} MAGNETS
          </div>
        </div>
        <span style={{ fontFamily:"var(--mono)", fontSize:"var(--font-xs)", color:"var(--text-mute)" }}>
          {vis.length} STRIKE · ±20% SPOT
        </span>
      </div>

      <div className="quantum-legend" style={{ marginBottom: 8 }}>
        {[["#ff2d7b","⚡ CALL WALL"],["#00e5cc","◎ PUT WALL"],["#a855f7","🧲 MAGNET"]].map(([c,l],i) => (
          <span key={i} className="q-leg">
            <span className="q-swatch" style={{ background: c, opacity: 0.85 }} />
            <span style={{ color: c, fontFamily:"var(--mono)", fontSize:"var(--font-xs)" }}>{l}</span>
          </span>
        ))}
      </div>

      <div className="quantum-body">
        {/* SVG Chart */}
        <div ref={containerRef} style={{ position:"relative" }} onMouseMove={handleMouse} onMouseLeave={() => setTip(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width:"100%", height:"auto", display:"block" }}>
            <defs>
              <linearGradient id="cBar" x1="0" x2="1"><stop offset="0%" stopColor="#ff2d7b" stopOpacity="0.9"/><stop offset="100%" stopColor="#ff2d7b" stopOpacity="0.25"/></linearGradient>
              <linearGradient id="pBar" x1="0" x2="1"><stop offset="0%" stopColor="#00e5cc" stopOpacity="0.85"/><stop offset="100%" stopColor="#00e5cc" stopOpacity="0.2"/></linearGradient>
              <linearGradient id="mBar" x1="0" x2="1"><stop offset="0%" stopColor="#a855f7" stopOpacity="0.5"/><stop offset="100%" stopColor="#a855f7" stopOpacity="0.08"/></linearGradient>
            </defs>

            {/* Grid */}
            {[...Array(Math.ceil((hi-lo)/1000)+1)].map((_,i) => {
              const p = Math.ceil(lo/1000)*1000 + i*1000;
              if (p > hi) return null;
              const y = yS(p);
              return <g key={p}>
                <line x1={pad.left} x2={W-pad.right} y1={y} y2={y} stroke="#1a1a1e" strokeWidth="0.4"/>
                <text x={pad.left-6} y={y+3} textAnchor="end" fontFamily="JetBrains Mono" fontSize="10" fill="#4a4742">{(p/1000).toFixed(0)}K</text>
              </g>;
            })}

            {/* Bars */}
            {vis.map(s => {
              const y = yS(s.strike);
              const callW = xBar(s.callGex), putW = xBar(Math.abs(s.putGex));
              const totalW = Math.max(callW, putW);
              return (
                <g key={s.strike}>
                  {s.wallType==="magnet" && s.isSignificant && <rect x={pad.left} y={y-rowH/2} width={totalW} height={rowH} fill="url(#mBar)"/>}
                  {s.callGex > 0 && <rect x={pad.left} y={y-rowH/2} width={callW} height={rowH} fill="url(#cBar)"/>}
                  {s.putGex < 0 && <rect x={pad.left} y={y-rowH/2} width={putW} height={rowH} fill="url(#pBar)" opacity="0.85"/>}

                  {/* Wall label */}
                  {s.isMajor && rowH >= 3 && totalW > 160 && (() => {
                    const lClr = wallColors[s.wallType];
                    const lType = s.wallType==="callWall"?"CALL WALL":s.wallType==="putWall"?"PUT WALL":s.wallType==="magnet"?"MAGNET":null;
                    if (!lType) return null;
                    const gexV = fmtM(Math.abs(s.netGex));
                    const txt = `--- ${s.wallType==="callWall"?"⚡":s.wallType==="putWall"?"◎":"🧲"} ${lType}  ${gexV}  [${s.oiPct}%|${s.gexPct}%]`;
                    const tx = pad.left + totalW / 2;
                    return (
                      <g>
                        <line x1={pad.left+totalW+4} x2={W-pad.right} y1={y} y2={y} stroke={lClr} strokeWidth="0.8" strokeDasharray="4 3" opacity="0.35"/>
                        <text x={tx} y={y+3.5} textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fontWeight="600" fill={lClr}>{txt}</text>
                      </g>
                    );
                  })()}
                </g>
              );
            })}

            {/* Level badges */}
            {[
              { price: levels.callWall, label: "CW", color: "#22c55e" },
              { price: levels.emHigh, label: "EM↑", color: "#818cf8" },
              { price: levels.zeroGamma, label: "ZΓ", color: "#06b6d4" },
              { price: levels.maxPain, label: "MP", color: "#f97316" },
              { price: levels.emLow, label: "EM↓", color: "#818cf8" },
              { price: levels.putWall, label: "PW", color: "#ef4444" },
            ].filter(x => x.price).map((it, i) => {
              const y = yS(it.price);
              if (y < pad.top - 10 || y > H - pad.bottom + 10) return null;
              return <g key={i}>
                <line x1={pad.left} x2={W-pad.right} y1={y} y2={y} stroke={it.color} strokeWidth="0.7" strokeDasharray="3 5" opacity="0.28"/>
                <rect x={pad.left-56} y={y-9} width="48" height="18" rx="3" fill="var(--surface-2)" stroke={it.color} strokeWidth="1"/>
                <text x={pad.left-32} y={y+4} textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fontWeight="700" fill={it.color}>{it.label}</text>
              </g>;
            })}

            {/* Spot */}
            {(() => {
              const y = yS(spot);
              return <g>
                <line x1={pad.left} x2={W-pad.right} y1={y} y2={y} stroke="#FFD700" strokeWidth="1.6" opacity="0.85"/>
                <rect x={pad.left-56} y={y-10} width="48" height="20" rx="3" fill="#FFD700"/>
                <text x={pad.left-32} y={y+5} textAnchor="middle" fontFamily="JetBrains Mono" fontSize="10" fontWeight="700" fill="#000">SPOT</text>
              </g>;
            })()}

            {/* X axis */}
            <line x1={pad.left} x2={W-pad.right} y1={H-pad.bottom} y2={H-pad.bottom} stroke="#1e2025"/>
            {[0,0.25,0.5,0.75,1].map(p => {
              const x = pad.left + p * cW * 0.88, v = p * maxBar;
              return <g key={p}>
                <line x1={x} x2={x} y1={H-pad.bottom} y2={H-pad.bottom+4} stroke="#1e2025"/>
                <text x={x} y={H-pad.bottom+16} textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fill="#4a4742">${fmtM(v)}</text>
              </g>;
            })}
            <text x={(pad.left + W-pad.right)/2} y={H-pad.bottom+34} textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fill="#4a4742">|Gamma Exposure| · $</text>
            <text transform={`translate(18,${H/2}) rotate(-90)`} textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fill="#4a4742">STRIKE ($)</text>
          </svg>

          {tip && (
            <div className="gex-tooltip" style={{ left: Math.min(tipPos.x+16, window.innerWidth-230), top: Math.max(tipPos.y-20,10) }}>
              <div className="tt-head">Strike: ${fmt(tip.strike)}</div>
              <div className="tt-row"><span>Net GEX</span><span className="tt-val" style={{color:tip.netGex>=0?"var(--call)":"var(--put)"}}>{fmtM(tip.netGex)}$</span></div>
              <div className="tt-row"><span>Call GEX</span><span className="tt-val" style={{color:"var(--call)"}}>${fmtM(tip.callGexDollar)}</span></div>
              <div className="tt-row"><span>Put GEX</span><span className="tt-val" style={{color:"var(--put)"}}>${fmtM(tip.putGexDollar)}</span></div>
              <div style={{borderTop:"1px solid var(--hairline)",margin:"5px 0"}}/>
              <div className="tt-row"><span>Call OI</span><span className="tt-val">{tip.callOI.toFixed(1)} BTC</span></div>
              <div className="tt-row"><span>Put OI</span><span className="tt-val">{tip.putOI.toFixed(1)} BTC</span></div>
              <div className="tt-row"><span>OI %</span><span className="tt-val">{tip.oiPct}%</span></div>
            </div>
          )}
        </div>

        {/* Top Walls List */}
        <div>
          <div style={{ fontFamily:"var(--mono)", fontSize:"var(--font-xs)", color:"var(--text-mute)", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom: 10 }}>
            TOP WALLS — RANKED ↓
          </div>
          <div className="wall-list">
            {topWalls.map((w, i) => {
              const isCall = w.wallType === "callWall";
              const isPut = w.wallType === "putWall";
              const color = isCall ? "#ff2d7b" : isPut ? "#00e5cc" : "#a855f7";
              const pct = ((w.strike - spot) / spot * 100);
              return (
                <div key={w.strike} className="wall-item">
                  <span className="wall-rank">{String(i+1).padStart(2,"0")}</span>
                  <div className="wall-info">
                    <span className="wall-price" style={{ color }}>${fmt(w.strike)}</span>
                    <span className="wall-type-tag" style={{ color }}>
                      {isCall ? "Call" : isPut ? "Put" : "Magnet"} · OI {w.oiPct}%
                    </span>
                  </div>
                  <span className="wall-gex" style={{ color: pct >= 0 ? "var(--pos)" : "var(--neg)" }}>
                    {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%<br/>
                    <span style={{ color:"var(--text-mute)" }}>{fmtM(w.netGex)}$</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Hero ─────────────────────────────────────────────────
function Hero({ spot, change24h, totals, levels, dvol }) {
  const animSpot = useCountUp(spot);
  const animChg = useCountUp(change24h);
  const isPos = totals.gamma >= 0;
  const gammaPct = Math.max(0, Math.min(100, ((totals.gamma + 50e6) / 250e6) * 100));
  const emRange = (levels.emHigh || 0) - (levels.emLow || 0);
  const spotPos = emRange > 0 ? ((spot - (levels.emLow || 0)) / emRange) * 100 : 50;

  return (
    <div className="hero">
      <div className="hero-price-block">
        <div className="hero-kicker mono">BTC/USD · Deribit Index · Spot</div>
        <div className="hero-price tabular">
          <span>{Math.floor(animSpot).toLocaleString("en-US")}</span>
          <span className="currency">USD</span>
        </div>
        <div className="hero-meta">
          <span className={`change-pill ${animChg >= 0 ? "up" : "dn"}`}>
            {animChg >= 0 ? "+" : ""}{animChg.toFixed(2)}% <span style={{ color:"var(--text-mute)", marginLeft:4 }}>24h</span>
          </span>
          <span style={{ fontFamily:"var(--mono)", fontSize:"var(--font-xs)", color:"var(--text-dim)" }}>
            ATM IV: <b style={{ color:"var(--text)" }}>{dvol.toFixed(1)}%</b>
          </span>
        </div>
      </div>

      <div className="hero-regime">
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
          <span className="regime-label">Gamma Rejimi</span>
          <span className="regime-state" style={{ color: isPos ? "var(--pos)" : "var(--neg)" }}>
            {isPos ? "● POZİTİF" : "● NEGATİF"}
          </span>
        </div>
        <div className="regime-val">{fmtM(totals.gamma)}<span style={{fontSize:16,color:"var(--text-dim)",marginLeft:4}}>$</span></div>
        <div className="gamma-bar"><div className="gamma-ptr" style={{ left: `${gammaPct}%` }}/></div>
        <div style={{ display:"flex", justifyContent:"space-between", fontFamily:"var(--mono)", fontSize:"var(--font-xs)", color:"var(--text-mute)" }}>
          <span>− NEG</span><span>NÖTR</span><span>+ POS</span>
        </div>
        <div style={{ marginTop: 8, fontFamily:"var(--mono)", fontSize:"var(--font-xs)", color:"var(--text-dim)", display:"grid", gridTemplateColumns:"1fr 1fr", gap:"2px 12px" }}>
          <span>Vanna</span><span style={{color:"var(--text)"}}>{fmtM(totals.vanna)}$</span>
          <span>Charm</span><span style={{color:"var(--text)"}}>{fmtM(totals.charm)}$</span>
        </div>
      </div>

      <div className="hero-em">
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
          <span className="regime-label">Beklenen Hareket (EOW)</span>
          {emRange > 0 && <span style={{ fontFamily:"var(--mono)", fontSize:"var(--font-xs)", color:"var(--text-dim)" }}>±{((emRange/2/spot)*100).toFixed(1)}%</span>}
        </div>
        <div className="em-row" style={{ marginTop: 4 }}>
          <span style={{ color:"var(--put)", fontFamily:"var(--mono)", fontSize: 13 }}>${fmt(levels.emLow)}</span>
          <span style={{ color:"var(--text-mute)", fontSize:"var(--font-xs)" }}>→ SPOT →</span>
          <span style={{ color:"var(--call)", fontFamily:"var(--mono)", fontSize: 13 }}>${fmt(levels.emHigh)}</span>
        </div>
        <div className="gamma-bar" style={{ margin:"8px 0 4px", background:"linear-gradient(90deg,var(--neg) 0%,var(--neutral) 50%,var(--pos) 100%)" }}>
          <div className="gamma-ptr" style={{ left:`${Math.max(2,Math.min(98,spotPos))}%`, background:"var(--spot)" }}/>
        </div>
        <div style={{ fontFamily:"var(--mono)", fontSize:"var(--font-xs)", color:"var(--text-mute)", display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"4px" }}>
          {[["Zero Gamma",levels.zeroGamma,"var(--zero-gamma)"],["Max Pain",levels.maxPain,"var(--max-pain)"],["Call Wall",levels.callWall,"var(--call)"]].map(([l,v,c],i) => (
            <div key={i}>
              <div style={{color:c, fontSize:"var(--font-xs)"}}>{l}</div>
              <div style={{color:"var(--text)",fontWeight:500,fontFamily:"var(--mono)"}}>${fmt(v)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────
export default function Home() {
  const { size: fontSize, setSize: setFontSize } = useContext(FontCtx);
  const { allOptions, spot, ohlcv, stats, change24h, dvol, loading, error, progress, lastUpdate, reload } = useGexData();
  const [expiry, setExpiry] = useState("all");
  const [tab, setTab] = useState("gex");

  // Recompute when expiry filter changes
  const strikes = aggregateByStrike(allOptions, expiry);
  const levels = findLevels(strikes, spot, allOptions, allOptions);
  const classified = classifyStrikes(strikes, spot);
  const totals = {
    gamma: strikes.reduce((a, x) => a + x.netGex, 0),
    vanna: strikes.reduce((a, x) => a + x.vannaNet, 0),
    charm: strikes.reduce((a, x) => a + x.charmNet, 0),
  };

  const isPos = totals.gamma >= 0;
  const timeStr = lastUpdate ? lastUpdate.toLocaleTimeString("tr-TR", { hour:"2-digit", minute:"2-digit", second:"2-digit" }) : "—";

  if (loading) return (
    <div className="loading-wrap">
      <div style={{ textAlign:"center", fontFamily:"var(--mono)", fontSize:"var(--font-xs)", color:"var(--text-mute)", letterSpacing:"0.1em" }}>
        <div className="spin"/>
        <div>{progress || "OPSİYON ZİNCİRİ YÜKLENİYOR..."}</div>
        <div style={{ marginTop:8, color:"var(--text-mute)", fontSize:"var(--font-xs)" }}>Tüm opsiyonlar çekildiği için 1-2 dk sürebilir</div>
      </div>
    </div>
  );

  if (error) return (
    <div className="loading-wrap">
      <div style={{ textAlign:"center" }}>
        <div style={{ color:"var(--neg)", marginBottom:12 }}>❌ {error}</div>
        <button className="h-btn" onClick={reload}>Tekrar Dene</button>
      </div>
    </div>
  );

  return (
    <div className="app">
      <Sidebar spot={spot} levels={levels} totals={totals} stats={stats} dvol={dvol} change24h={change24h} expiry={expiry} setExpiry={setExpiry} />

      <main className="main">
        {/* Topbar */}
        <div className="topbar">
          <div className="topbar-left">
            <span style={{ fontFamily:"var(--mono)", fontSize:"var(--font-xs)", color:"var(--text-dim)" }}>
              Deribit BTC GEX
            </span>
            <span style={{ color: isPos ? "var(--pos)" : "var(--neg)", fontFamily:"var(--mono)", fontSize:"var(--font-xs)" }}>
              ● {isPos ? "POZİTİF GAMMA" : "NEGATİF GAMMA"}
            </span>
            <span style={{ color:"var(--spot)", fontFamily:"var(--mono)", fontWeight:600, fontSize:"var(--font-sm)" }}>
              Spot: ${fmt(spot)}
            </span>
            <span style={{ color:"var(--text-mute)", fontFamily:"var(--mono)", fontSize:"var(--font-xs)" }}>
              {lastUpdate ? `${lastUpdate.toLocaleDateString("tr-TR")} ${timeStr} UTC` : ""}
            </span>
          </div>
          <div className="topbar-right">
            <div className="h-stat">
              <span className="h-stat-label">DVol</span>
              <span className="h-stat-value">{dvol.toFixed(1)}</span>
            </div>
            <button className={`h-btn ${fontSize === 1 ? "active" : ""}`} onClick={() => setFontSize(f => f === 0 ? 1 : 0)} title="Yazı boyutu +1pt">
              Aa{fontSize === 1 ? "+" : ""}
            </button>
            <button className="h-btn" onClick={reload}>↻ Yenile</button>
          </div>
        </div>

        {/* Hero */}
        <Hero spot={spot} change24h={change24h} totals={totals} levels={levels} dvol={dvol} />

        {/* Tabs */}
        <div className="tabs-row">
          <button className={`tab ${tab==="gex"?"active":""}`} onClick={() => setTab("gex")}>
            📊 GEX Profili
          </button>
          <button className={`tab ${tab==="quantum"?"active":""}`} onClick={() => setTab("quantum")}>
            ⚡ Quantum Walls
          </button>
          <div className="tabs-spacer"/>
          <div className="expiry-btns">
            {[["all","Tüm Vadeler"],["0-7d","0-7 Gün"],["8-45d","8-45 Gün"],["45d+","45+ Gün"]].map(([v,l]) => (
              <button key={v} className={`expiry-btn ${expiry===v?"active":""}`} onClick={() => setExpiry(v)}>{l}</button>
            ))}
          </div>
        </div>

        {/* Chart */}
        <div className="chart-card">
          {tab === "gex" && (
            <>
              <div className="chart-header">
                <div>
                  <div className="chart-title">BTC/USD · Mum + Gamma Exposure</div>
                  <div className="chart-sub">
                    {expiry === "all" ? "Tüm vadeler" : expiry} · {strikes.length} strike · Spot ${fmt(spot)}
                  </div>
                </div>
                <div style={{ display:"flex", gap:16, fontFamily:"var(--mono)", fontSize:"var(--font-xs)", color:"var(--text-dim)" }}>
                  <span>ZG: <b style={{ color:"var(--zero-gamma)" }}>${fmt(levels.zeroGamma)}</b></span>
                  <span>MP: <b style={{ color:"var(--max-pain)" }}>${fmt(levels.maxPain)}</b></span>
                  <span>CW: <b style={{ color:"var(--call)" }}>${fmt(levels.callWall)}</b></span>
                  <span>PW: <b style={{ color:"var(--put)" }}>${fmt(levels.putWall)}</b></span>
                </div>
              </div>
              <GexChart strikes={strikes} spot={spot} levels={levels} ohlcv={ohlcv} expiry={expiry} />
            </>
          )}

          {tab === "quantum" && (
            <QuantumChart classified={classified} spot={spot} levels={levels} />
          )}
        </div>

        {/* Footer */}
        <div className="footer">
          <span>Options Desk · Deribit Live · {stats.rows} kontrat · {stats.expiries} vade</span>
          <span>{new Date().toLocaleDateString("tr-TR", { weekday:"long", day:"numeric", month:"long", year:"numeric" })} · {timeStr} UTC</span>
        </div>
      </main>
    </div>
  );
}
