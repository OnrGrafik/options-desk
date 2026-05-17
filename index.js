import { useState, useEffect, useRef, useCallback } from "react";
import Head from "next/head";
import {
  fetchSpot, fetchInstruments, fetchAllOptions, fetchOHLCV,
  aggregateByStrike, findLevels, classifyStrikes
} from "../lib/gex";

// ═══════════════════════════════════════════════════════════
// COLORS & CONSTANTS
// ═══════════════════════════════════════════════════════════
const C = {
  bg: "#0a0a1a",
  panel: "#0d1117",
  border: "#1e293b",
  grid: "#111827",
  text: "#e5e7eb",
  textDim: "#6b7280",
  textMuted: "#475569",
  green: "#22c55e",
  red: "#ef4444",
  yellow: "#FFD700",
  orange: "#f97316",
  cyan: "#06b6d4",
  purple: "#a855f7",
  indigo: "#818cf8",
  pink: "#ec4899",
  teal: "#14b8a6",
  callWall: "#ff2d7b",   // hot pink like the reference
  putWall: "#00e5cc",     // cyan/teal like the reference
  magnet: "#9333ea",      // purple
  expiry07: { call: "#22c55e", put: "#ef4444" },
  expiry830: { call: "#6366f1", put: "#f97316" },
  expiry30p: { call: "#475569", put: "#475569" },
};

const fmt = (n) => n ? n.toLocaleString() : "—";
const fmtM = (n) => `${(n / 1e6).toFixed(2)}M`;
const fmtB = (n) => `${(n / 1e9).toFixed(3)}B`;

// ═══════════════════════════════════════════════════════════
// TAB 1: Candlestick + GEX Profile (Split View)
// ═══════════════════════════════════════════════════════════
function Tab1Canvas({ strikes, spot, levels, ohlcv }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctr = containerRef.current;
    if (!canvas || !ctr || !strikes.length) return;

    const W = ctr.clientWidth, H = ctr.clientHeight;
    canvas.width = W * 2; canvas.height = H * 2;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(2, 2);

    const splitX = Math.floor(W * 0.55);
    const pad = { top: 50, bottom: 40, left: 65, right: 10 };
    const gexPad = { left: 8, right: 95 };

    // Common Y axis — price range ±20% around spot for better detail
    const lo = spot * 0.80, hi = spot * 1.20;
    const yScale = (p) => pad.top + ((hi - p) / (hi - lo)) * (H - pad.top - pad.bottom);

    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);

    // ─── Grid lines ─────────────────────────────────
    const step = Math.max(Math.round((hi - lo) / 20 / 1000) * 1000, 1000);
    ctx.strokeStyle = C.grid; ctx.lineWidth = 0.3;
    for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) {
      const y = yScale(p);
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - gexPad.right, y); ctx.stroke();
    }

    // Y axis labels (left)
    ctx.fillStyle = C.textDim; ctx.font = "10px monospace"; ctx.textAlign = "right";
    for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) {
      ctx.fillText(p.toLocaleString(), pad.left - 4, yScale(p) + 3);
    }

    // Divider
    ctx.strokeStyle = C.border; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(splitX, pad.top - 5); ctx.lineTo(splitX, H - pad.bottom + 5); ctx.stroke();

    // ─── Level lines across full width ──────────────
    const drawLvl = (price, color, label, dash, isBold) => {
      if (!price) return;
      const y = yScale(price);
      if (y < pad.top - 5 || y > H - pad.bottom + 5) return;
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = isBold ? 2 : 1;
      ctx.setLineDash(dash || []); ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - gexPad.right, y); ctx.stroke();
      ctx.restore();
      // Right label
      const lx = W - gexPad.right + 3;
      const tw = gexPad.right - 6;
      ctx.fillStyle = C.panel; ctx.fillRect(lx, y - 8, tw, 16);
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(lx, y - 8, tw, 16);
      ctx.fillStyle = color; ctx.font = "bold 8px monospace"; ctx.textAlign = "left";
      ctx.fillText(`${label} ${fmt(price)}`, lx + 2, y + 3);
    };

    // Spot (solid yellow)
    if (spot) {
      const sy = yScale(spot);
      if (sy >= pad.top && sy <= H - pad.bottom) {
        ctx.save(); ctx.strokeStyle = C.yellow; ctx.lineWidth = 1.5;
        ctx.setLineDash([]); ctx.globalAlpha = 0.7;
        ctx.beginPath(); ctx.moveTo(pad.left, sy); ctx.lineTo(W - gexPad.right, sy); ctx.stroke();
        ctx.restore();
        const lx = W - gexPad.right + 3, tw = gexPad.right - 6;
        ctx.fillStyle = C.yellow; ctx.fillRect(lx, sy - 9, tw, 18);
        ctx.fillStyle = "#000"; ctx.font = "bold 9px monospace"; ctx.textAlign = "left";
        ctx.fillText(`⚡ SPOT ${fmt(spot)}`, lx + 2, sy + 4);
      }
    }

    drawLvl(levels.zeroGamma, C.cyan, "ZG", [6, 3]);
    drawLvl(levels.emHigh, C.indigo, "⚡ EM Hi", [4, 2]);
    drawLvl(levels.callWall, C.green, "⚡ CW", [8, 4]);
    drawLvl(levels.maxPain, C.orange, "◎ MP", [4, 4]);
    drawLvl(levels.emLow, C.indigo, "⚡ EM Lo", [4, 2]);
    drawLvl(levels.putWall, C.red, "PW", [8, 4]);

    // ─── LEFT: Candlestick Chart ────────────────────
    const candleArea = splitX - pad.left - 15;
    if (ohlcv && ohlcv.close && ohlcv.close.length > 1) {
      const n = ohlcv.close.length;
      const cw = Math.max(Math.floor(candleArea / n) - 2, 2);
      const gap = candleArea / n;

      // Volume at bottom (15% of chart height)
      const volH = (H - pad.top - pad.bottom) * 0.12;
      const volTop = H - pad.bottom - volH;
      const maxVol = Math.max(...ohlcv.volume, 1);

      for (let i = 0; i < n; i++) {
        const x = pad.left + i * gap + gap / 2;
        const o = ohlcv.open[i], c = ohlcv.close[i], h = ohlcv.high[i], l = ohlcv.low[i];
        const bull = c >= o;
        const color = bull ? C.green : C.red;

        // Wick
        const hy = yScale(h), ly = yScale(l);
        ctx.strokeStyle = color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, hy); ctx.lineTo(x, ly); ctx.stroke();

        // Body
        const oy = yScale(o), cy = yScale(c);
        const bodyTop = Math.min(oy, cy), bodyH = Math.max(Math.abs(oy - cy), 1);
        ctx.fillStyle = color; ctx.globalAlpha = bull ? 0.9 : 0.9;
        ctx.fillRect(x - cw / 2, bodyTop, cw, bodyH);
        ctx.globalAlpha = 1;

        // Volume bar
        const vh = (ohlcv.volume[i] / maxVol) * volH;
        ctx.fillStyle = color; ctx.globalAlpha = 0.35;
        ctx.fillRect(x - cw / 2, H - pad.bottom - vh, cw, vh);
        ctx.globalAlpha = 1;
      }

      // X axis time labels
      ctx.fillStyle = C.textMuted; ctx.font = "9px monospace"; ctx.textAlign = "center";
      const labelEvery = Math.max(Math.floor(n / 6), 1);
      for (let i = 0; i < n; i += labelEvery) {
        const x = pad.left + i * gap + gap / 2;
        const ts = ohlcv.ticks[i];
        const dt = new Date(ts);
        const label = `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, "0")}:00`;
        ctx.fillText(label, x, H - pad.bottom + 15);
      }

      // Title
      ctx.fillStyle = C.text; ctx.font = "bold 12px monospace"; ctx.textAlign = "center";
      ctx.fillText("BTC/USD — Mum Grafiği", pad.left + candleArea / 2, 20);

      // Subtitle
      ctx.fillStyle = C.textMuted; ctx.font = "9px monospace";
      ctx.fillText("Hacim", pad.left + candleArea / 2, 33);
    } else {
      ctx.fillStyle = C.textDim; ctx.font = "12px monospace"; ctx.textAlign = "center";
      ctx.fillText("Mum verisi yükleniyor...", pad.left + candleArea / 2, H / 2);
    }

    // ─── RIGHT: GEX Profile ─────────────────────────
    const gexLeft = splitX + gexPad.left;
    const gexRight = W - gexPad.right;
    const gexW = gexRight - gexLeft;
    const gexMid = gexLeft + gexW / 2;

    // Filter visible strikes
    const vis = strikes.filter(s => s.strike >= lo && s.strike <= hi);
    if (!vis.length) return;
    const maxGex = Math.max(...vis.map(s => Math.abs(s.netGex)), 1);
    const barH = Math.max(Math.floor((H - pad.top - pad.bottom) / vis.length) - 1, 2);

    // Center line
    ctx.strokeStyle = C.border; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(gexMid, pad.top); ctx.lineTo(gexMid, H - pad.bottom); ctx.stroke();

    // Stacked bars by expiry
    for (const s of vis) {
      const y = yScale(s.strike);
      const expKeys = ["0-7d", "8-30d", "30d+"];
      const colorMap = {
        "0-7d": C.expiry07,
        "8-30d": C.expiry830,
        "30d+": C.expiry30p,
      };

      let posOff = 0, negOff = 0;
      for (const ek of expKeys) {
        const be = s.byExpiry[ek];
        if (!be) continue;
        const clr = colorMap[ek];
        // Call (positive side)
        if (be.callGex > 0) {
          const w = (be.callGex / maxGex) * (gexW / 2);
          ctx.fillStyle = clr.call; ctx.globalAlpha = 0.85;
          ctx.fillRect(gexMid + posOff, y - barH / 2, w, barH);
          posOff += w;
        }
        // Put (negative side)
        if (be.putGex < 0) {
          const w = (Math.abs(be.putGex) / maxGex) * (gexW / 2);
          ctx.fillStyle = clr.put; ctx.globalAlpha = 0.85;
          ctx.fillRect(gexMid - negOff - w, y - barH / 2, w, barH);
          negOff += w;
        }
      }
      ctx.globalAlpha = 1;

      // Net GEX diamond marker
      const nx = gexMid + (s.netGex / maxGex) * (gexW / 2);
      ctx.fillStyle = C.yellow; ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(nx, y - 3); ctx.lineTo(nx + 3, y); ctx.lineTo(nx, y + 3); ctx.lineTo(nx - 3, y);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // GEX title
    ctx.fillStyle = C.text; ctx.font = "bold 12px monospace"; ctx.textAlign = "center";
    ctx.fillText("GEX Profili", gexMid, 20);

    // Legend
    ctx.font = "8px monospace"; ctx.textAlign = "left";
    const ly = 34;
    const legend = [
      [gexLeft, C.expiry07.call, "Call 0-7d"],
      [gexLeft + 60, C.expiry07.put, "Put 0-7d"],
      [gexLeft + 115, C.expiry830.call, "Call 8-30d"],
      [gexLeft + 180, C.expiry830.put, "Put 8-30d"],
      [gexLeft + 240, "#FFD700", "Net-GEX ◆"],
    ];
    for (const [x, c, t] of legend) {
      ctx.fillStyle = c; ctx.fillRect(x, ly - 5, 7, 7);
      ctx.fillStyle = C.textDim; ctx.fillText(t, x + 9, ly + 2);
    }

    // X axis labels
    ctx.textAlign = "center"; ctx.fillStyle = C.textMuted; ctx.font = "9px monospace";
    ctx.fillText("← Put (Negatif GEX)", gexLeft + gexW * 0.25, H - pad.bottom + 15);
    ctx.fillText("Call (Pozitif GEX) →", gexLeft + gexW * 0.75, H - pad.bottom + 15);

  }, [strikes, spot, levels, ohlcv]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const h = () => draw();
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, [draw]);

  // Tooltip on mouse
  const handleMouse = (e) => {
    const canvas = canvasRef.current;
    if (!canvas || !strikes.length) return;
    const rect = canvas.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const H = rect.height;
    const pad = { top: 50, bottom: 40 };
    const lo = spot * 0.80, hi = spot * 1.20;
    const price = hi - ((mouseY - pad.top) / (H - pad.top - pad.bottom)) * (hi - lo);

    let closest = null, minD = Infinity;
    for (const s of strikes) {
      const d = Math.abs(s.strike - price);
      if (d < minD) { minD = d; closest = s; }
    }
    if (closest && minD < (hi - lo) * 0.02) {
      setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, data: closest });
    } else setTooltip(null);
  };

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%" }}
      onMouseMove={handleMouse} onMouseLeave={() => setTooltip(null)}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
      {tooltip && <Tooltip tooltip={tooltip} containerRef={containerRef} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TAB 2: Detailed GEX Profile (Full Width) with Wall Labels
// ═══════════════════════════════════════════════════════════
function Tab2Canvas({ strikes, spot, levels, classified }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [tooltip, setTooltip] = useState(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctr = containerRef.current;
    if (!canvas || !ctr || !classified.length) return;

    const W = ctr.clientWidth, H = ctr.clientHeight;
    canvas.width = W * 2; canvas.height = H * 2;
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(2, 2);

    const pad = { top: 45, bottom: 30, left: 65, right: 110 };
    const cW = W - pad.left - pad.right;
    const cH = H - pad.top - pad.bottom;

    // Y range — tighter around spot for more detail
    const lo = spot * 0.78, hi = spot * 1.22;
    const yScale = (p) => pad.top + ((hi - p) / (hi - lo)) * cH;

    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);

    // Grid
    const step = Math.max(Math.round((hi - lo) / 30 / 500) * 500, 500);
    ctx.strokeStyle = C.grid; ctx.lineWidth = 0.3;
    for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) {
      const y = yScale(p);
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    }

    // Y labels
    ctx.fillStyle = C.textDim; ctx.font = "10px monospace"; ctx.textAlign = "right";
    for (let p = Math.ceil(lo / step) * step; p <= hi; p += step) {
      ctx.fillText(p.toLocaleString(), pad.left - 4, yScale(p) + 3);
    }

    // Filter visible
    const vis = classified.filter(s => s.strike >= lo && s.strike <= hi);
    if (!vis.length) return;
    const maxGex = Math.max(...vis.map(s => Math.max(s.callGex, Math.abs(s.putGex))), 1);
    const barH = Math.max(Math.floor(cH / vis.length) - 1, 2);

    // Draw bars
    for (const s of vis) {
      const y = yScale(s.strike);

      // Call bar (right side, from left edge)
      if (s.callGex > 0) {
        const w = (s.callGex / maxGex) * cW * 0.85;
        ctx.fillStyle = C.callWall; ctx.globalAlpha = 0.8;
        ctx.fillRect(pad.left, y - barH / 2, w, barH);
      }

      // Put bar (right side, overlaid, from left edge)
      if (s.putGex < 0) {
        const w = (Math.abs(s.putGex) / maxGex) * cW * 0.85;
        ctx.fillStyle = C.putWall; ctx.globalAlpha = 0.7;
        ctx.fillRect(pad.left, y - barH / 2, w, barH);
      }

      // Magnet overlay (both call & put significant)
      if (s.wallType === "magnet" && s.isSignificant) {
        const w = (Math.max(s.callGex, Math.abs(s.putGex)) / maxGex) * cW * 0.85;
        ctx.fillStyle = C.magnet; ctx.globalAlpha = 0.35;
        ctx.fillRect(pad.left, y - barH / 2, w, barH);
      }

      ctx.globalAlpha = 1;

      // Wall labels on significant strikes
      if (s.isSignificant && barH >= 3) {
        const gexVal = Math.abs(s.netGex) > 1e6
          ? `${(Math.abs(s.netGex) / 1e6).toFixed(1)}M`
          : `${(Math.abs(s.netGex) / 1e3).toFixed(0)}K`;
        const barW = (Math.max(s.callGex, Math.abs(s.putGex)) / maxGex) * cW * 0.85;

        if (barW > 80) {
          let labelColor, labelIcon, labelType;
          if (s.wallType === "callWall") {
            labelColor = C.yellow; labelIcon = "⚡"; labelType = "CALL WALL";
          } else if (s.wallType === "putWall") {
            labelColor = C.cyan; labelIcon = "◎"; labelType = "PUT WALL";
          } else if (s.wallType === "magnet") {
            labelColor = C.purple; labelIcon = "🧲"; labelType = "MAGNET";
          } else continue;

          const tx = pad.left + barW / 2;

          // Dashed line extending from bar
          ctx.save();
          ctx.strokeStyle = labelColor; ctx.lineWidth = 1; ctx.globalAlpha = 0.5;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(pad.left + barW + 5, y);
          ctx.lineTo(W - pad.right, y);
          ctx.stroke();
          ctx.restore();

          // Label on bar
          ctx.font = "bold 9px monospace"; ctx.textAlign = "center";
          const text = `--- ${labelIcon} ${labelType}  ${gexVal}  [${s.oiPct}%|${s.gexPct}%]`;
          // Background
          const textW = ctx.measureText(text).width + 8;
          ctx.fillStyle = "#0a0a1aCC";
          ctx.fillRect(tx - textW / 2, y - 7, textW, 14);
          ctx.fillStyle = labelColor;
          ctx.fillText(text, tx, y + 3);
        }
      }
    }

    // ─── Level lines ────────────────────────────────
    const drawLvl = (price, color, label, dash) => {
      if (!price) return;
      const y = yScale(price);
      if (y < pad.top - 5 || y > H - pad.bottom + 5) return;

      // Right label
      const lx = W - pad.right + 4, tw = pad.right - 8;
      ctx.fillStyle = C.panel; ctx.fillRect(lx, y - 9, tw, 18);
      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(lx, y - 9, tw, 18);
      ctx.fillStyle = color; ctx.font = "bold 9px monospace"; ctx.textAlign = "left";
      ctx.fillText(`${label} ${fmt(price)}`, lx + 3, y + 3);
    };

    // Spot
    if (spot) {
      const sy = yScale(spot);
      if (sy >= pad.top && sy <= H - pad.bottom) {
        ctx.save(); ctx.strokeStyle = C.yellow; ctx.lineWidth = 2;
        ctx.setLineDash([]); ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.moveTo(pad.left, sy); ctx.lineTo(W - pad.right, sy); ctx.stroke();
        ctx.restore();
        const lx = W - pad.right + 4, tw = pad.right - 8;
        ctx.fillStyle = C.yellow; ctx.fillRect(lx, sy - 10, tw, 20);
        ctx.fillStyle = "#000"; ctx.font = "bold 10px monospace"; ctx.textAlign = "left";
        ctx.fillText(`⚡ SPOT ${fmt(spot)}`, lx + 3, sy + 4);
      }
    }

    drawLvl(levels.zeroGamma, C.cyan, "ZG");
    drawLvl(levels.emHigh, C.indigo, "EM High");
    drawLvl(levels.callWall, C.green, "CW");
    drawLvl(levels.maxPain, C.orange, "◎ MP");
    drawLvl(levels.emLow, C.indigo, "EM Low");
    drawLvl(levels.putWall, C.red, "PW");

    // Legend
    ctx.font = "10px monospace"; ctx.textAlign = "left";
    const lx = pad.left + 10, ly = 18;
    const items = [
      [C.callWall, "⚡ CALL WALL"], [C.putWall, "◎ PUT WALL"], [C.magnet, "🧲 MAGNET"],
    ];
    items.forEach(([c, t], i) => {
      const x = lx + i * 130;
      ctx.fillStyle = c; ctx.globalAlpha = 0.8;
      ctx.fillRect(x, ly - 6, 12, 12);
      ctx.globalAlpha = 1; ctx.fillStyle = c; ctx.fillText(t, x + 16, ly + 4);
    });

  }, [classified, spot, levels]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const h = () => draw();
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, [draw]);

  const handleMouse = (e) => {
    const canvas = canvasRef.current;
    if (!canvas || !classified.length) return;
    const rect = canvas.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const H = rect.height;
    const lo = spot * 0.78, hi = spot * 1.22;
    const price = hi - ((mouseY - 45) / (H - 45 - 30)) * (hi - lo);

    let closest = null, minD = Infinity;
    for (const s of classified) {
      const d = Math.abs(s.strike - price);
      if (d < minD) { minD = d; closest = s; }
    }
    if (closest && minD < (hi - lo) * 0.015) {
      setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, data: closest });
    } else setTooltip(null);
  };

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%" }}
      onMouseMove={handleMouse} onMouseLeave={() => setTooltip(null)}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
      {tooltip && <Tooltip tooltip={tooltip} containerRef={containerRef} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Shared Tooltip Component
// ═══════════════════════════════════════════════════════════
function Tooltip({ tooltip, containerRef }) {
  const cW = containerRef.current?.clientWidth || 600;
  return (
    <div style={{
      position: "absolute",
      left: Math.min(tooltip.x + 14, cW - 260),
      top: Math.max(tooltip.y - 10, 10),
      background: "#0f172aee", border: "1px solid #334155", borderRadius: 8,
      padding: "10px 14px", color: "#fff", fontSize: 11, fontFamily: "monospace",
      pointerEvents: "none", zIndex: 10, minWidth: 230, backdropFilter: "blur(8px)",
    }}>
      <div style={{ color: C.yellow, fontWeight: "bold", fontSize: 13, marginBottom: 6 }}>
        Strike: {fmt(tooltip.data.strike)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px" }}>
        <div>Net GEX:</div>
        <div style={{ color: tooltip.data.netGex >= 0 ? C.green : C.red, fontWeight: "bold" }}>
          ${fmtM(tooltip.data.netGex)}
        </div>
        <div>Call GEX:</div>
        <div style={{ color: C.green }}>${fmtM(tooltip.data.callGex)}</div>
        <div>Put GEX:</div>
        <div style={{ color: C.red }}>${fmtM(tooltip.data.putGex)}</div>
      </div>
      <div style={{
        borderTop: "1px solid #1e293b", marginTop: 6, paddingTop: 6,
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px"
      }}>
        <div>Call OI:</div><div>{tooltip.data.callOI.toFixed(1)} BTC</div>
        <div>Put OI:</div><div>{tooltip.data.putOI.toFixed(1)} BTC</div>
        <div>Toplam OI:</div><div style={{ fontWeight: "bold" }}>{tooltip.data.totalOI.toFixed(1)} BTC</div>
      </div>
      {tooltip.data.details && tooltip.data.details.length > 0 && (
        <div style={{ borderTop: "1px solid #1e293b", marginTop: 6, paddingTop: 6, fontSize: 10 }}>
          <div style={{ color: "#94a3b8", marginBottom: 3 }}>Opsiyonlar:</div>
          {tooltip.data.details.slice(0, 5).map((d, i) => (
            <div key={i} style={{ color: d.type === "call" ? "#4ade80" : "#f87171", lineHeight: "15px" }}>
              {d.type.toUpperCase()} {d.expiry} ({d.daysToExp}g) | OI:{d.oi.toFixed(1)} | IV:{(d.iv * 100).toFixed(0)}%
            </div>
          ))}
          {tooltip.data.details.length > 5 && (
            <div style={{ color: "#475569" }}>+{tooltip.data.details.length - 5} daha...</div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════
export default function Home() {
  const [spot, setSpot] = useState(0);
  const [strikes, setStrikes] = useState([]);
  const [levels, setLevels] = useState({});
  const [classified, setClassified] = useState([]);
  const [options, setOptions] = useState([]);
  const [ohlcv, setOhlcv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState("");
  const [lastUpdate, setLastUpdate] = useState(null);
  const [totals, setTotals] = useState({ gamma: 0, vanna: 0, charm: 0 });
  const [activeTab, setActiveTab] = useState(0);

  const loadData = useCallback(async () => {
    try {
      setLoading(true); setError(null);

      setProgress("Spot fiyat alınıyor...");
      const s = await fetchSpot();
      if (!s) throw new Error("Spot fiyat alınamadı");
      setSpot(s);

      // Fetch OHLCV in parallel
      fetchOHLCV("60", 48)
        .then(d => { if (d && d.close) setOhlcv(d); })
        .catch(() => {});

      setProgress("Opsiyon enstrümanları çekiliyor...");
      const instruments = await fetchInstruments();
      if (!instruments.length) throw new Error("Opsiyon verisi yok");

      setProgress(`${instruments.length} opsiyon analiz ediliyor...`);
      const opts = await fetchAllOptions(instruments, s, (pct) => {
        setProgress(`Opsiyonlar analiz ediliyor... %${pct}`);
      });
      setOptions(opts);

      setProgress("GEX hesaplanıyor...");
      const agg = aggregateByStrike(opts);
      const lvls = findLevels(agg, s, opts);
      const cls = classifyStrikes(agg, s);

      setStrikes(agg);
      setLevels(lvls);
      setClassified(cls);
      setTotals({
        gamma: agg.reduce((a, x) => a + x.netGex, 0),
        vanna: agg.reduce((a, x) => a + x.vannaNet, 0),
        charm: agg.reduce((a, x) => a + x.charmNet, 0),
      });
      setLastUpdate(new Date());
      setLoading(false);
    } catch (e) {
      setError(e.message); setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const iv = setInterval(loadData, 5 * 60000);
    return () => clearInterval(iv);
  }, [loadData]);

  const gReg = totals.gamma > 0 ? "POZİTİF GAMMA" : "NEGATİF GAMMA";
  const gClr = totals.gamma > 0 ? C.green : C.red;

  const tabStyle = (active) => ({
    padding: "6px 18px", fontSize: 12, fontWeight: active ? "bold" : "normal",
    background: active ? "#1e293b" : "transparent",
    color: active ? "#e5e7eb" : "#64748b",
    border: active ? "1px solid #334155" : "1px solid transparent",
    borderBottom: active ? "none" : "1px solid #334155",
    borderRadius: "6px 6px 0 0", cursor: "pointer",
    fontFamily: "monospace", marginRight: 2,
  });

  return (
    <>
      <Head>
        <title>BTC GEX Dashboard | Deribit</title>
        <meta name="viewport" content="width=device-width,initial-scale=1" />
      </Head>
      <div style={{ background: C.bg, color: "#fff", minHeight: "100vh", fontFamily: "'JetBrains Mono',monospace" }}>

        {/* ─── Header ─────────────────────────────────── */}
        <div style={{
          background: C.panel, borderBottom: `1px solid ${C.border}`,
          padding: "8px 16px", display: "flex", alignItems: "center",
          justifyContent: "space-between", flexWrap: "wrap", gap: 8
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ color: gClr, fontSize: 16 }}>●</span>
            <span style={{ color: gClr, fontWeight: "bold", fontSize: 12 }}>{gReg}</span>
            <span style={{ color: C.textMuted, fontSize: 12 }}>Deribit BTC GEX</span>
            <span style={{ color: C.yellow, fontWeight: "bold", fontSize: 14 }}>
              Spot: ${spot ? fmt(spot) : "..."}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: C.textMuted, fontSize: 10 }}>
              {lastUpdate ? lastUpdate.toLocaleString("tr-TR") + " UTC" : ""}
            </span>
            <button onClick={loadData} disabled={loading} style={{
              background: "#1e293b", color: "#94a3b8", border: "1px solid #334155",
              padding: "3px 10px", borderRadius: 4, cursor: "pointer", fontSize: 11,
              fontFamily: "monospace",
            }}>↻ Yenile</button>
          </div>
        </div>

        {/* ─── Key Levels Bar ─────────────────────────── */}
        {!loading && !error && (
          <div style={{
            display: "flex", gap: 14, padding: "6px 16px",
            background: C.panel, borderBottom: `1px solid ${C.grid}`,
            overflowX: "auto", flexWrap: "wrap",
          }}>
            <LevelTag c={C.green} l="⚡ Call Wall" v={levels.callWall} />
            <LevelTag c={C.red} l="⚡ Put Wall" v={levels.putWall} />
            <LevelTag c={C.orange} l="◎ Max Pain" v={levels.maxPain} />
            <LevelTag c={C.cyan} l="Γ Zero Gamma" v={levels.zeroGamma} />
            <LevelTag c={C.indigo} l="EM High" v={levels.emHigh} />
            <LevelTag c={C.indigo} l="EM Low" v={levels.emLow} />
            <LevelTag c={C.purple} l="Σ Net GEX" v={`$${fmtB(totals.gamma)}`} raw />
            <LevelTag c={C.textDim} l="Vanna" v={`${fmtM(totals.vanna)}`} raw />
            <LevelTag c="#78716c" l="Charm" v={`${fmtM(totals.charm)}`} raw />
          </div>
        )}

        {/* ─── Tabs ───────────────────────────────────── */}
        {!loading && !error && (
          <div style={{ padding: "8px 16px 0", display: "flex", borderBottom: `1px solid #334155` }}>
            <button onClick={() => setActiveTab(0)} style={tabStyle(activeTab === 0)}>
              📊 Mum + GEX Profili
            </button>
            <button onClick={() => setActiveTab(1)} style={tabStyle(activeTab === 1)}>
              🧱 Detaylı GEX Profili
            </button>
          </div>
        )}

        {/* ─── Loading ────────────────────────────────── */}
        {loading && (
          <div style={{ textAlign: "center", padding: 80, color: C.textMuted }}>
            <div style={{ fontSize: 22, marginBottom: 12 }}>⏳</div>
            <div style={{ fontSize: 14 }}>{progress}</div>
            <div style={{ fontSize: 11, marginTop: 8, color: C.textDim }}>
              İlk yükleme tüm opsiyonları çekeceği için 1-2 dakika sürebilir
            </div>
          </div>
        )}

        {/* ─── Error ──────────────────────────────────── */}
        {error && (
          <div style={{ textAlign: "center", padding: 60, color: C.red }}>
            <div>❌ {error}</div>
            <button onClick={loadData} style={{
              marginTop: 12, background: "#1e293b", color: "#fff", border: `1px solid ${C.red}`,
              padding: "6px 16px", borderRadius: 6, cursor: "pointer", fontFamily: "monospace",
            }}>Tekrar Dene</button>
          </div>
        )}

        {/* ─── Chart Area ─────────────────────────────── */}
        {!loading && !error && (
          <div style={{ height: "calc(100vh - 140px)", padding: "0 8px 8px" }}>
            {activeTab === 0 && (
              <Tab1Canvas strikes={strikes} spot={spot} levels={levels} ohlcv={ohlcv} />
            )}
            {activeTab === 1 && (
              <Tab2Canvas strikes={strikes} spot={spot} levels={levels} classified={classified} />
            )}
          </div>
        )}
      </div>
    </>
  );
}

function LevelTag({ c, l, v, raw }) {
  return (
    <div style={{ fontSize: 11, whiteSpace: "nowrap" }}>
      <span style={{ color: c }}>{l}:</span>{" "}
      <span style={{ color: "#e5e7eb", fontWeight: "bold" }}>
        {raw ? v : (v ? v.toLocaleString() : "—")}
      </span>
    </div>
  );
}
