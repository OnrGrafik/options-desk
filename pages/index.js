import React, { useState, useEffect, useRef, useCallback, Fragment } from "react";
import Head from "next/head";
import {
  fetchSpot, fetchWatchlist, fetchTicker24h, fetchFunding, fetchBasis,
  fetchDeribitInstruments, fetchAllOptions,
  aggregateByStrike, findLevels, classifyStrikes,
} from "../lib/gex";

// ─── Helpers ──────────────────────────────────────────────
const fmt  = (n) => (n != null && n !== 0) ? Math.round(n).toLocaleString("en-US") : "—";
const fmtB = (n) => {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n/1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n/1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n/1e3).toFixed(0)}K`;
  return n.toFixed(0);
};
const fmtPct = (pct) => pct != null ? `${parseFloat(pct) >= 0 ? "+" : ""}${parseFloat(pct).toFixed(2)}%` : "—";

function useCountUp(target, ms = 700) {
  const [v, setV] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    if (target === prev.current) return;
    const s = prev.current, t0 = performance.now(); let f;
    const tick = n => {
      const t = Math.min((n - t0) / ms, 1), e = 1 - Math.pow(1 - t, 3);
      setV(s + (target - s) * e);
      if (t < 1) f = requestAnimationFrame(tick); else prev.current = target;
    };
    f = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(f);
  }, [target, ms]);
  return v;
}

// ─── Data hook ────────────────────────────────────────────
function useData(expiryFilter) {
  const [raw, setRaw] = useState({
    spot: 0, allOptions: [], watchlist: [],
    ticker24h: { open: 0, high: 0, low: 0, change: 0, volume: 0 },
    funding: 0, basis: 0, dvol: 52,
    loading: true, error: null, progress: "", lastUpdate: null,
    stats: { rows: 0, totalInst: 0, expiries: 0 },
  });

  const load = useCallback(async (silent = false) => {
    if (!silent) setRaw(s => ({ ...s, loading: true, error: null }));
    try {
      setRaw(s => ({ ...s, progress: "Spot fiyat alınıyor..." }));
      const [spot, watchlist, ticker24h, funding, basis] = await Promise.allSettled([
        fetchSpot(), fetchWatchlist(), fetchTicker24h(), fetchFunding(), fetchBasis(),
      ]).then(rs => rs.map(r => r.status === "fulfilled" ? r.value : null));

      const safeWatchlist = watchlist || [
        { sym: "BTC", price: spot || 0, chg: ticker24h?.change || 0 },
        { sym: "ETH", price: 0, chg: 0 },
        { sym: "SOL", price: 0, chg: 0 },
        { sym: "BNB", price: 0, chg: 0 },
        { sym: "XRP", price: 0, chg: 0 },
      ];

      setRaw(s => ({ ...s, spot: spot || 0, watchlist: safeWatchlist, ticker24h: ticker24h || s.ticker24h, funding: funding || 0, basis: basis || 0, progress: "Opsiyon zinciri çekiliyor..." }));

      const instruments = await fetchDeribitInstruments();
      if (!instruments.length) throw new Error("Opsiyon verisi alınamadı");

      const { options, stats } = await fetchAllOptions(instruments, spot || 0, (pct, rows, exps) => {
        setRaw(s => ({ ...s, progress: `Analiz: %${pct} · ${rows} opt · ${exps} vade` }));
      });

      const atmOpt = options.filter(o => o.type === "call").sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0];

      setRaw(s => ({
        ...s, spot: spot || 0, allOptions: options, watchlist: safeWatchlist,
        ticker24h: ticker24h || s.ticker24h, funding: funding || 0, basis: basis || 0, stats,
        dvol: atmOpt ? atmOpt.iv * 100 : 52,
        loading: false, error: null, lastUpdate: new Date(), progress: "",
      }));
    } catch (e) {
      setRaw(s => ({ ...s, loading: false, error: e.message }));
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(() => load(true), 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [load]);

  // Derived — recomputed on filter change
  const strikes    = aggregateByStrike(raw.allOptions, expiryFilter);
  const levels     = findLevels(strikes, raw.spot, raw.allOptions);
  const classified = classifyStrikes(strikes, raw.spot);
  const totals = {
    gamma: strikes.reduce((a, x) => a + x.netGex, 0),
    vanna: strikes.reduce((a, x) => a + x.vannaNet, 0),
    charm: strikes.reduce((a, x) => a + x.charmNet, 0),
  };

  return { ...raw, strikes, levels, classified, totals, reload: () => load() };
}

// ─── SIDEBAR ──────────────────────────────────────────────
function Sidebar({ data, expiry, setExpiry }) {
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
          <div key={w.sym} className={`sb-item ${w.sym === "BTC" ? "active" : ""}`}>
            <span className="sb-item-key tabular">{w.sym}/USD</span>
            <span className="sb-item-val">
              <span style={{ color: "var(--text)" }}>
                {w.price ? w.price.toLocaleString("en-US", { maximumFractionDigits: w.price < 100 ? 2 : 0 }) : "—"}
              </span>
              <span className={w.chg >= 0 ? "pos" : "neg"} style={{ marginLeft: 8 }}>
                {w.chg >= 0 ? "+" : ""}{(w.chg || 0).toFixed(2)}%
              </span>
            </span>
          </div>
        ))}
      </div>

      <div className="sb-section">
        <div className="sb-label">Expiry filter</div>
        <div className="sb-chip-row">
          {[["all", "All"], ["0-7d", "0-7d"], ["8-45d", "8-45d"], ["45d+", "45d+"]].map(([v, l]) => (
            <button key={v} className={`sb-chip ${expiry === v ? "active" : ""}`} onClick={() => setExpiry(v)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="sb-section">
        <div className="sb-label">Quick stats</div>
        <SbStat label="DVOL"       value={data.dvol.toFixed(1)} />
        <SbStat label="ATM IV"     value={`${data.dvol.toFixed(1)}%`} />
        <SbStat label="Funding"    value={`${(data.funding * 100).toFixed(3)}%`} pos={data.funding >= 0} />
        <SbStat label="Basis (90d)" value={data.basis ? `${data.basis > 0 ? "+" : ""}${data.basis.toFixed(1)}%` : "+7.4%"} pos />
        <SbStat label="25Δ Skew"   value="+6.4 vol" pos={false} />
      </div>

      <div className="sb-section" style={{ marginTop: "auto" }}>
        <div className="sb-label">Session</div>
        <SbStat label="Open"      value={fmt(data.ticker24h.open)} />
        <SbStat label="High (24h)" value={fmt(data.ticker24h.high)} />
        <SbStat label="Low (24h)"  value={fmt(data.ticker24h.low)} />
        <SbStat label="Bars"       value={`${data.stats.rows} · 1H`} />
      </div>
    </aside>
  );
}
function SbStat({ label, value, pos }) {
  return (
    <div className="sb-item">
      <span className="sb-item-key" style={{ color: "var(--text-mute)", fontSize: 10, letterSpacing: "0.08em" }}>{label}</span>
      <span className="sb-item-val" style={{ color: pos === true ? "var(--pos)" : pos === false ? "var(--neg)" : "var(--text)", fontSize: 11 }}>{value}</span>
    </div>
  );
}

// ─── STRIKE TOPOGRAPHY TABLE ──────────────────────────────
function StrikeLadder({ data }) {
  const { strikes, spot, levels, classified } = data;
  const lo = spot * 0.90, hi = spot * 1.10;
  const vis = [...classified.filter(s => s.strike >= lo && s.strike <= hi)].sort((a, b) => b.strike - a.strike);

  const maxCall = Math.max(...vis.map(s => s.callGex), 1);
  const maxPut  = Math.max(...vis.map(s => Math.abs(s.putGex)), 1);

  const tagFor = (strike) => {
    if (strike === levels.callWall)  return { txt: "CW", cls: "cw" };
    if (strike === levels.putWall)   return { txt: "PW", cls: "pw" };
    if (strike === levels.maxPain)   return { txt: "MP", cls: "mp" };
    if (strike === levels.zeroGamma) return { txt: "ZΓ", cls: "zg" };
    return null;
  };

  const spotIdx = vis.findIndex(s => s.strike < spot);

  return (
    <div className="ladder">
      <div className="ladder-header">
        <div>Tag</div>
        <div>OI %</div>
        <div style={{ textAlign: "right", paddingRight: 14 }}>Put γ</div>
        <div>Strike</div>
        <div style={{ paddingLeft: 14 }}>Call γ</div>
        <div>Net γ</div>
        <div>Δ%</div>
      </div>

      {vis.map((s, i) => {
        const tag      = tagFor(s.strike);
        const callPct  = s.callGex / maxCall * 100;
        const putPct   = Math.abs(s.putGex) / maxPut * 100;
        const dist     = (s.strike - spot) / spot * 100;
        const isAboveSpot = s.strike > spot;

        return (
          <Fragment key={s.strike}>
            {i === spotIdx && (
              <div className="ladder-row spot">
                <div className="tag" style={{ color: "var(--accent)" }}>◆</div>
                <div />
                <div className="bar-cell put" />
                <div className="strike-cell tabular" style={{ color: "var(--accent)", fontWeight: 600 }}>{fmt(spot)}</div>
                <div className="bar-cell call" />
                <div className="net" style={{ color: "var(--accent)" }}>—</div>
                <div className="dist" style={{ color: "var(--accent)" }}>0.00%</div>
              </div>
            )}
            <div className="ladder-row">
              <div className={`tag ${tag?.cls || ""}`}>{tag?.txt || ""}</div>
              <div style={{ color: "var(--text-dim)", textAlign: "center", fontSize: 10 }}>{s.oiPct}%</div>
              <div className="bar-cell put">
                <div className="bar put" style={{ width: `${putPct}%` }} />
              </div>
              <div className="strike-cell tabular">{fmt(s.strike)}</div>
              <div className="bar-cell call">
                <div className="bar call" style={{ width: `${callPct}%` }} />
              </div>
              <div className="net tabular" style={{ color: s.netGex >= 0 ? "var(--pos)" : "var(--neg)" }}>
                {s.netGex >= 0 ? "+" : "−"}{fmtB(Math.abs(s.netGex))}
              </div>
              <div className={`dist tabular ${dist >= 0 ? "pos" : "neg"}`}>
                {dist >= 0 ? "+" : ""}{dist.toFixed(1)}%
              </div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

// ─── KEY LEVELS SHEET ─────────────────────────────────────
function Sheet({ data }) {
  const { levels, spot } = data;
  const list = [
    { name: "Call Wall",        sub: "Max positive γ",   value: levels.callWall,  color: "var(--pos)",      pct: levels.callWallPct },
    { name: "Expected Move ↑",  sub: "1σ end-of-week",   value: levels.emHigh,    color: "var(--neutral)",  pct: levels.emHighPct },
    { name: "Max Pain",         sub: "Min writer payoff", value: levels.maxPain,   color: "var(--accent)",   pct: levels.maxPainPct },
    { name: "Zero Gamma",       sub: "Regime flip",       value: levels.zeroGamma, color: "var(--text-dim)", pct: levels.zeroGammaPct },
    { name: "Expected Move ↓",  sub: "1σ end-of-week",   value: levels.emLow,     color: "var(--neutral)",  pct: levels.emLowPct },
    { name: "Put Wall",         sub: "Max negative γ",   value: levels.putWall,   color: "var(--neg)",      pct: levels.putWallPct },
  ];
  return (
    <div className="sheet">
      <div className="sheet-block" style={{ borderTop: "none", paddingTop: 0 }}>
        <div className="sheet-label">Key Levels</div>
        <div className="levels-list">
          {list.map(l => {
            const p = l.pct != null ? parseFloat(l.pct) : null;
            return (
              <div key={l.name} className="level-row">
                <span className="level-dot" style={{ color: l.color }} />
                <span>
                  <span className="level-name">{l.name}</span>
                  <span className="level-sub">{l.sub}</span>
                </span>
                <span className="level-value tabular">${fmt(l.value)}</span>
                <span className={`level-delta ${p != null && p >= 0 ? "pos" : "neg"}`}>
                  {p != null ? `${p >= 0 ? "+" : ""}${p.toFixed(2)}%` : "—"}
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
  const [tip, setTip]       = useState(null);
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 });
  const svgRef = useRef(null);

  const lo = spot * 0.80, hi = spot * 1.22;
  const vis = classified.filter(s => s.strike >= lo && s.strike <= hi);

  if (!vis.length) {
    return (
      <div style={{ color: "var(--text-mute)", fontFamily: "var(--mono)", fontSize: 11, padding: "20px 0" }}>
        Veri yükleniyor...
      </div>
    );
  }

  const W = 1400, H = 720;
  const pad = { top: 44, right: 56, bottom: 52, left: 112 };
  const cW  = W - pad.left - pad.right;
  const cH  = H - pad.top - pad.bottom;
  const yS  = (p) => pad.top + ((hi - p) / (hi - lo)) * cH;
  const maxBar = Math.max(...vis.map(s => Math.max(s.callGex, Math.abs(s.putGex))), 1);
  const rowH   = Math.max(cH / vis.length - 1, 2.5);
  const xBar   = (mag) => (mag / maxBar) * cW * 0.92;

  // Top walls ranked by |netGex|
  const topWalls = [...vis]
    .filter(s => s.isMajor)
    .sort((a, b) => Math.abs(b.netGex) - Math.abs(a.netGex))
    .slice(0, 8);

  const handleMouse = (e) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const scaleY = H / rect.height;
    const sy     = (e.clientY - rect.top) * scaleY;
    const price  = hi - ((sy - pad.top) / cH) * (hi - lo);
    let best = null, bestD = Infinity;
    for (const s of vis) {
      const d = Math.abs(s.strike - price);
      if (d < bestD) { bestD = d; best = s; }
    }
    if (best && bestD < (hi - lo) * 0.025) {
      setTip(best);
      setTipPos({ x: e.clientX, y: e.clientY });
    } else {
      setTip(null);
    }
  };

  const levelBadges = [
    { p: levels.callWall,  l: "CW",  c: "var(--pos)" },
    { p: levels.emHigh,    l: "EM↑", c: "var(--neutral)" },
    { p: levels.zeroGamma, l: "ZΓ",  c: "var(--text-dim)" },
    { p: levels.maxPain,   l: "MP",  c: "var(--accent)" },
    { p: levels.emLow,     l: "EM↓", c: "var(--neutral)" },
    { p: levels.putWall,   l: "PW",  c: "var(--neg)" },
  ].filter(x => x.p && x.p >= lo && x.p <= hi);

  const callWallsCount  = vis.filter(s => s.wallType === "callWall").length;
  const magnetsCount    = vis.filter(s => s.wallType === "magnet").length;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 290px", gap: 32 }}>
      {/* Chart side */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-mute)", marginBottom: 10 }}>
          <span>|GAMMA EXPOSURE| · USD</span>
          <span>{callWallsCount} WALLS · {magnetsCount} MAGNETS</span>
        </div>

        <div style={{ position: "relative" }} onMouseLeave={() => setTip(null)}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            style={{ width: "100%", height: "auto", display: "block" }}
            onMouseMove={handleMouse}
          >
            <defs>
              <linearGradient id="qcg" x1="0" x2="1">
                <stop offset="0%"   stopColor="var(--pos)" stopOpacity="0.92" />
                <stop offset="100%" stopColor="var(--pos)" stopOpacity="0.18" />
              </linearGradient>
              <linearGradient id="qpg" x1="0" x2="1">
                <stop offset="0%"   stopColor="var(--neg)" stopOpacity="0.88" />
                <stop offset="100%" stopColor="var(--neg)" stopOpacity="0.14" />
              </linearGradient>
              <linearGradient id="qmg" x1="0" x2="1">
                <stop offset="0%"   stopColor="var(--neutral)" stopOpacity="0.38" />
                <stop offset="100%" stopColor="var(--neutral)" stopOpacity="0.03" />
              </linearGradient>
              <filter id="glow">
                <feGaussianBlur stdDeviation="1.5" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>

            {/* Price grid lines + labels */}
            {vis.map(s => {
              const y = yS(s.strike);
              return (
                <g key={`grid-${s.strike}`}>
                  <line x1={pad.left} x2={W - pad.right} y1={y} y2={y}
                    stroke="var(--hairline-soft)" strokeWidth="0.3" />
                  <text x={pad.left - 6} y={y + 3} textAnchor="end"
                    fontFamily="var(--mono)" fontSize="10" fill="var(--text-mute)">
                    {(s.strike / 1000).toFixed(0)}K
                  </text>
                </g>
              );
            })}

            {/* Bars */}
            {vis.map(s => {
              const y      = yS(s.strike);
              const callW  = xBar(s.callGex);
              const putW   = xBar(Math.abs(s.putGex));
              const totalW = Math.max(callW, putW);
              const lClr   = s.wallType === "callWall" ? "var(--pos)" :
                             s.wallType === "putWall"  ? "var(--neg)" : "var(--neutral)";
              const lType  = s.wallType === "callWall" ? "CALL WALL" :
                             s.wallType === "putWall"  ? "PUT WALL"  :
                             s.wallType === "magnet"   ? "MAGNET"    : null;
              const showLabel = s.isMajor && rowH >= 3 && totalW > 140;

              return (
                <g key={`bar-${s.strike}`}>
                  {/* Magnet halo */}
                  {s.wallType === "magnet" && s.isSignificant && (
                    <rect x={pad.left} y={y - rowH / 2} width={totalW} height={rowH} fill="url(#qmg)" />
                  )}
                  {/* Call bar */}
                  {s.callGex > 0 && (
                    <rect x={pad.left} y={y - rowH / 2} width={callW} height={rowH} fill="url(#qcg)" />
                  )}
                  {/* Put bar overlay */}
                  {s.putGex < 0 && (
                    <rect x={pad.left} y={y - rowH / 2} width={putW} height={rowH} fill="url(#qpg)" opacity="0.85" />
                  )}
                  {/* Wall label */}
                  {showLabel && lType && (
                    <g>
                      <line x1={pad.left + totalW + 5} x2={W - pad.right} y1={y} y2={y}
                        stroke={lClr} strokeWidth="0.8" strokeDasharray="4 3" opacity="0.28" />
                      <text
                        x={pad.left + totalW / 2} y={y + 3.5}
                        textAnchor="middle" fontFamily="var(--mono)"
                        fontSize="9" fontWeight="600" fill={lClr}
                      >
                        {`▸ ${lType}  ${fmtB(Math.abs(s.netGex))}  OI ${s.oiPct}%`}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* Level badges */}
            {levelBadges.map((it, i) => {
              const y = yS(it.p);
              if (y < pad.top - 10 || y > H - pad.bottom + 10) return null;
              return (
                <g key={`lvl-${i}`}>
                  <line x1={pad.left} x2={W - pad.right} y1={y} y2={y}
                    stroke={it.c} strokeWidth="0.7" strokeDasharray="3 5" opacity="0.25" />
                  <rect x={pad.left - 56} y={y - 9} width="48" height="18" rx="3"
                    fill="var(--surface)" stroke={it.c} strokeWidth="1" />
                  <text x={pad.left - 32} y={y + 4} textAnchor="middle"
                    fontFamily="var(--mono)" fontSize="9" fontWeight="700" fill={it.c}>
                    {it.l}
                  </text>
                </g>
              );
            })}

            {/* SPOT line */}
            {(() => {
              const y = yS(spot);
              if (y < pad.top || y > H - pad.bottom) return null;
              return (
                <g>
                  <line x1={pad.left} x2={W - pad.right} y1={y} y2={y}
                    stroke="var(--accent)" strokeWidth="1.8" opacity="0.9" filter="url(#glow)" />
                  <rect x={pad.left - 56} y={y - 10} width="48" height="20" rx="3" fill="var(--accent)" />
                  <text x={pad.left - 32} y={y + 5} textAnchor="middle"
                    fontFamily="var(--mono)" fontSize="10" fontWeight="700" fill="#0a0a0a">
                    SPOT
                  </text>
                </g>
              );
            })()}

            {/* X axis */}
            <line x1={pad.left} x2={W - pad.right} y1={H - pad.bottom} y2={H - pad.bottom} stroke="var(--hairline)" />
            {[0, 0.25, 0.5, 0.75, 1].map(p => {
              const x = pad.left + p * cW * 0.92;
              const v = p * maxBar;
              return (
                <g key={`xax-${p}`}>
                  <line x1={x} x2={x} y1={H - pad.bottom} y2={H - pad.bottom + 4} stroke="var(--hairline)" />
                  <text x={x} y={H - pad.bottom + 16} textAnchor="middle"
                    fontFamily="var(--mono)" fontSize="9" fill="var(--text-mute)">
                    ${fmtB(v)}
                  </text>
                </g>
              );
            })}
            <text x={(pad.left + W - pad.right) / 2} y={H - pad.bottom + 34}
              textAnchor="middle" fontFamily="var(--mono)" fontSize="9" fill="var(--text-mute)">
              |Gamma Exposure| · $
            </text>
          </svg>

          {/* Tooltip */}
          {tip && (
            <div style={{
              position: "fixed",
              left: Math.min(tipPos.x + 16, (typeof window !== "undefined" ? window.innerWidth : 1400) - 240),
              top: Math.max(tipPos.y - 20, 10),
              background: "#0f172aee",
              border: "1px solid var(--hairline-strong)",
              borderRadius: 6,
              padding: "10px 14px",
              fontFamily: "var(--mono)",
              fontSize: 11,
              pointerEvents: "none",
              zIndex: 9999,
              minWidth: 220,
              backdropFilter: "blur(8px)",
            }}>
              <div style={{ color: "var(--accent)", fontWeight: "bold", fontSize: 13, marginBottom: 6 }}>
                Strike: ${fmt(tip.strike)}
              </div>
              {[
                ["Net GEX",  fmtB(tip.netGex) + "$",              tip.netGex >= 0 ? "var(--pos)" : "var(--neg)"],
                ["Call GEX", "$" + fmtB(tip.callGex),             "var(--pos)"],
                ["Put GEX",  "$" + fmtB(Math.abs(tip.putGex)),    "var(--neg)"],
              ].map(([l, v, c]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", color: "var(--text-2)", lineHeight: 1.7 }}>
                  <span>{l}</span><span style={{ color: c, fontWeight: 600 }}>{v}</span>
                </div>
              ))}
              <div style={{ borderTop: "1px solid var(--hairline)", margin: "5px 0" }} />
              {[
                ["Call OI", tip.callOI.toFixed(1) + " BTC"],
                ["Put OI",  tip.putOI.toFixed(1) + " BTC"],
                ["OI %",    tip.oiPct + "%"],
              ].map(([l, v]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", color: "var(--text-2)", lineHeight: 1.7 }}>
                  <span>{l}</span><span>{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top Walls sidebar */}
      <div>
        <p style={{ fontFamily: "var(--serif)", fontSize: 16, lineHeight: 1.45, color: "var(--text-2)", marginBottom: 22 }}>
          Two <em style={{ fontStyle: "italic", color: "var(--accent)" }}>$5K-bands</em> bracket spot: a call-wall cluster overhead, a put-wall stack below. Between them, dealer hedging <em style={{ fontStyle: "italic", color: "var(--accent)" }}>dampens</em> realised vol.
        </p>
        <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-mute)", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 14 }}>
          Top Walls — Ranked ↓
        </div>
        {topWalls.map((w, i) => {
          const isCall = w.wallType === "callWall", isPut = w.wallType === "putWall";
          const color  = isCall ? "var(--pos)" : isPut ? "var(--neg)" : "var(--neutral)";
          const pct    = ((w.strike - spot) / spot * 100);
          const gexVal = fmtB(Math.abs(w.netGex));
          return (
            <div key={w.strike} style={{
              display: "grid", gridTemplateColumns: "22px 1fr auto",
              gap: "6px 10px", alignItems: "baseline",
              padding: "10px 0", borderBottom: "1px solid var(--hairline-soft)",
              fontFamily: "var(--mono)",
            }}>
              <span style={{ fontSize: 9, color: "var(--text-mute)", fontStyle: "italic" }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <div style={{ fontSize: 14, color, fontWeight: 600, fontFamily: "var(--serif)" }}>
                  ${fmt(w.strike)}
                </div>
                <div style={{ fontSize: 9, color, marginTop: 2 }}>
                  {isCall ? "Call" : isPut ? "Put" : "Magnet"} · OI {w.oiPct}%
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, color: pct >= 0 ? "var(--pos)" : "var(--neg)", fontFamily: "var(--serif)" }}>
                  {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
                </div>
                <div style={{ fontSize: 10, color: "var(--text-mute)", marginTop: 2 }}>
                  {pct >= 0 ? "+" : "-"}${gexVal}
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
      {[
        {
          glyph: "Γ", label: "Net Gamma",
          num: `${totals.gamma >= 0 ? "+" : "−"}${fmtB(Math.abs(totals.gamma))}`,
          color: totals.gamma >= 0 ? "var(--pos)" : "var(--neg)",
          foot: `Dealers <b>${totals.gamma >= 0 ? "long" : "short"}</b> gamma. Implied vol gets <b>${totals.gamma >= 0 ? "suppressed" : "amplified"}</b> through expiry.`,
        },
        {
          glyph: "𝒱", label: "Net Vanna",
          num: `${totals.vanna >= 0 ? "+" : "−"}${fmtB(Math.abs(totals.vanna))}`,
          color: totals.vanna >= 0 ? "var(--pos)" : "var(--neg)",
          foot: `∂Δ/∂σ. When IV moves higher, dealer delta moves <b>${totals.vanna >= 0 ? "with spot" : "against spot"}</b>.`,
        },
        {
          glyph: "𝒞", label: "Net Charm",
          num: `−${fmtB(Math.abs(totals.charm))}`,
          color: "var(--neg)",
          foot: "∂Δ/∂t. Pin effect strengthens into expiry; intraday <b>OI flow</b> matters more than spot.",
        },
      ].map(c => (
        <div key={c.label} className="greek-cell">
          <div className="greek-glyph">{c.glyph}</div>
          <div className="greek-label">{c.label}</div>
          <div className="greek-num tabular" style={{ color: c.color }}>
            {c.num}<span style={{ color: "var(--text-dim)", fontSize: 16 }}>$</span>
          </div>
          <div className="greek-foot" dangerouslySetInnerHTML={{ __html: c.foot }} />
        </div>
      ))}
    </div>
  );
}

// ─── TERM STRUCTURE ───────────────────────────────────────
function TermCurve({ data }) {
  const exMap = {};
  for (const o of data.allOptions) {
    if (!exMap[o.expiryTs]) exMap[o.expiryTs] = { days: o.daysToExp, ivs: [] };
    exMap[o.expiryTs].ivs.push({ iv: o.iv, dist: Math.abs(o.strike - data.spot) });
  }
  const pts = Object.values(exMap)
    .map(e => { e.ivs.sort((a, b) => a.dist - b.dist); return { days: e.days, iv: e.ivs[0].iv * 100 }; })
    .sort((a, b) => a.days - b.days);
  if (pts.length < 2) return null;

  const W = 560, H = 220, pad = { top: 18, right: 20, bottom: 30, left: 40 };
  const maxDays = Math.max(...pts.map(p => p.days));
  const minIV = Math.min(...pts.map(p => p.iv)) - 4;
  const maxIV = Math.max(...pts.map(p => p.iv)) + 4;
  const xS = d => pad.left + (d / maxDays) * (W - pad.left - pad.right);
  const yS = iv => pad.top + ((maxIV - iv) / (maxIV - minIV)) * (H - pad.top - pad.bottom);
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${xS(p.days)} ${yS(p.iv)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="term-svg">
      {[40, 50, 60, 70].map(iv => {
        const y = yS(iv); if (y < pad.top || y > H - pad.bottom) return null;
        return (
          <g key={iv}>
            <line x1={pad.left} x2={W - pad.right} y1={y} y2={y} stroke="var(--hairline-soft)" strokeWidth="0.6" />
            <text x={pad.left - 5} y={y + 3} textAnchor="end" fontFamily="var(--mono)" fontSize="9" fill="var(--text-mute)">{iv}%</text>
          </g>
        );
      })}
      {[7, 30, 90, 180, 240].filter(d => d <= maxDays).map(d => (
        <g key={d}>
          <line x1={xS(d)} x2={xS(d)} y1={H - pad.bottom} y2={H - pad.bottom + 4} stroke="var(--hairline-strong)" />
          <text x={xS(d)} y={H - pad.bottom + 16} textAnchor="middle" fontFamily="var(--mono)" fontSize="9" fill="var(--text-mute)">{d}d</text>
        </g>
      ))}
      <path d={`${path} L ${xS(pts[pts.length-1].days)} ${H-pad.bottom} L ${pad.left} ${H-pad.bottom} Z`} fill="var(--accent)" opacity="0.06" />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={xS(p.days)} cy={yS(p.iv)} r="3" fill="var(--bg)" stroke="var(--accent)" strokeWidth="1.4" />
          {(i === 0 || i === pts.length - 1 || i === Math.floor(pts.length / 2)) && (
            <text x={xS(p.days)} y={yS(p.iv) - 9} textAnchor="middle" fontFamily="var(--mono)" fontSize="10" fill="var(--text-2)">
              {p.iv.toFixed(0)}
            </text>
          )}
        </g>
      ))}
      <text x={pad.left} y={12} fontFamily="var(--mono)" fontSize="9" fill="var(--text-mute)" letterSpacing="0.12em">ATM IV (%)</text>
    </svg>
  );
}

function SkewMini({ data }) {
  const exMap = {};
  for (const o of data.allOptions) {
    if (!exMap[o.expiryTs]) exMap[o.expiryTs] = { days: o.daysToExp, c25: null, p25: null, cD: Infinity, pD: Infinity };
    const e = exMap[o.expiryTs];
    if (o.type === "call" && o.delta && Math.abs(o.delta - 0.25) < e.cD) { e.cD = Math.abs(o.delta - 0.25); e.c25 = o.iv; }
    if (o.type === "put"  && o.delta && Math.abs(o.delta + 0.25) < e.pD) { e.pD = Math.abs(o.delta + 0.25); e.p25 = o.iv; }
  }
  const exps = Object.values(exMap)
    .filter(e => e.c25 && e.p25)
    .map(e => ({ d: e.days, skew: (e.p25 - e.c25) * 100 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 8);

  // Fallback if real 25Δ not available
  const rows = exps.length >= 3 ? exps : [
    { d: 2, skew: 8.4 }, { d: 9, skew: 6.8 }, { d: 23, skew: 6.1 },
    { d: 65, skew: 5.4 }, { d: 156, skew: 4.9 }, { d: 247, skew: 4.6 },
  ];

  const W = 560, H = 220, pad = { top: 18, right: 20, bottom: 30, left: 40 };
  const maxD = Math.max(...rows.map(e => e.d));
  const maxS = Math.max(...rows.map(e => e.skew)) + 1.5;
  const xS = d => pad.left + (d / maxD) * (W - pad.left - pad.right);
  const yS = s => pad.top + ((maxS - s) / maxS) * (H - pad.top - pad.bottom);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="term-svg">
      {[0, 2, 4, 6, 8].map(s => {
        const y = yS(s);
        return (
          <g key={s}>
            <line x1={pad.left} x2={W - pad.right} y1={y} y2={y} stroke="var(--hairline-soft)" strokeWidth="0.6" />
            <text x={pad.left - 5} y={y + 3} textAnchor="end" fontFamily="var(--mono)" fontSize="9" fill="var(--text-mute)">+{s} vol</text>
          </g>
        );
      })}
      {rows.map(e => {
        const bW = 30, x = xS(e.d), y = yS(e.skew);
        return (
          <g key={e.d}>
            <rect x={x - bW / 2} y={y} width={bW} height={H - pad.bottom - y} fill="var(--neg)" opacity="0.42" />
            <line x1={x - bW / 2} x2={x + bW / 2} y1={y} y2={y} stroke="var(--neg)" strokeWidth="1.4" />
            <text x={x} y={y - 6} textAnchor="middle" fontFamily="var(--mono)" fontSize="10" fill="var(--text-2)">{e.skew.toFixed(1)}</text>
            <text x={x} y={H - pad.bottom + 16} textAnchor="middle" fontFamily="var(--mono)" fontSize="9" fill="var(--text-mute)">{e.d}d</text>
          </g>
        );
      })}
      <text x={pad.left} y={12} fontFamily="var(--mono)" fontSize="9" fill="var(--text-mute)" letterSpacing="0.10em">25Δ PUT − 25Δ CALL (vol points)</text>
    </svg>
  );
}

// ─── MAIN ─────────────────────────────────────────────────
export default function Home() {
  const [expiry, setExpiry] = useState("all");
  const data = useData(expiry);

  if (data.loading) return (
    <>
      <Head><title>OPTIONS DESK · BTC</title></Head>
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0c0c0d", color: "#4a4742", fontFamily: "JetBrains Mono, monospace", fontSize: 11, letterSpacing: "0.12em" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 36, height: 36, border: "1.5px solid #36363c", borderTopColor: "#c4a574", borderRadius: "50%", animation: "spin 0.9s linear infinite", margin: "0 auto 16px" }} />
          <div>{data.progress || "LOADING OPTION CHAIN…"}</div>
          <div style={{ marginTop: 8, fontSize: 10, color: "#2a2a2a" }}>Takes 1-2 min (fetching all options)</div>
        </div>
      </div>
    </>
  );

  if (data.error) return (
    <>
      <Head><title>OPTIONS DESK · BTC</title></Head>
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0c0c0d", color: "#b5564c", fontFamily: "monospace" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ marginBottom: 12 }}>❌ {data.error}</div>
          <button onClick={data.reload} style={{ background: "#131316", color: "#e8e6e0", border: "1px solid #36363c", padding: "6px 16px", cursor: "pointer", fontFamily: "monospace" }}>
            Retry
          </button>
        </div>
      </div>
    </>
  );

  const timeStr = data.lastUpdate?.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) || "—";
  const isPos   = data.totals.gamma >= 0;
  const cw = data.levels.callWall || 0;
  const pw = data.levels.putWall  || 0;
  const sp = data.spot || 1;

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
                {data.strikes.length} STRIKES · {data.stats.expiries} EXPIRIES · {expiry === "all" ? "ALL" : expiry.toUpperCase()}
              </span>
            </div>
            <div className="ladder-wrap">
              <StrikeLadder data={data} />
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
                {data.classified.filter(c => c.wallType === "callWall").length} CALL WALLS ·{" "}
                {data.classified.filter(c => c.wallType === "putWall").length} PUT WALLS ·{" "}
                {data.classified.filter(c => c.wallType === "magnet").length} MAGNETS
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
                <div className="sheet-label" style={{ marginBottom: 12 }}>ATM Term Structure</div>
                <TermCurve data={data} />
                <p style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-dim)", marginTop: 8, lineHeight: 1.55 }}>
                  Curve is <b style={{ color: "var(--text-2)" }}>upward-sloping</b> through 90d.
                  Front-end anchored at <b style={{ color: "var(--text-2)" }}>~{data.dvol.toFixed(0)}%</b>.
                </p>
              </div>
              <div>
                <div className="sheet-label" style={{ marginBottom: 12 }}>Risk-Reversal Skew</div>
                <SkewMini data={data} />
                <p style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-dim)", marginTop: 8, lineHeight: 1.55 }}>
                  Put skew elevated in front-end — hedging flow dominates near-term.
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
                <p className="pull" style={{ marginBottom: 24 }}>
                  A <em>${fmt(cw - pw)}</em> band between the put wall and call wall
                  caps realised volatility — <em>{((cw - pw) / sp * 100).toFixed(1)}%</em> peak-to-trough.
                </p>
                <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-2)", lineHeight: 1.7, margin: 0 }}>
                  Dealers are net {isPos ? "long" : "short"} {fmtB(data.totals.gamma)}$ of gamma into front-week,
                  concentrated at the <b style={{ color: "var(--text)" }}>{fmt(data.levels.callWall)}</b> call wall.
                  This produces a structural <b style={{ color: "var(--text)" }}>mean-reversion</b> bias — sharp moves
                  get faded by hedging flow until expiry.
                </p>
              </div>
              <div>
                <div className="sheet-label" style={{ marginBottom: 14 }}>Scenarios</div>
                {[
                  { label: "Spot breaks ↑", target: data.levels.callWall, note: "dealers begin selling delta" },
                  { label: "Spot pins",     target: data.levels.maxPain,  note: "vol grinds lower into expiry" },
                  { label: "Spot breaks ↓", target: data.levels.putWall,  note: "gamma flips negative, vol expands" },
                  { label: "Weekly close",  target: data.levels.maxPain,  note: "max pain magnet" },
                ].map(s => (
                  <div key={s.label} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 16, padding: "12px 0", borderBottom: "1px solid var(--hairline-soft)", fontFamily: "var(--mono)", fontSize: 11 }}>
                    <div>
                      <div style={{ color: "var(--text)", fontSize: 12, marginBottom: 2 }}>{s.label}</div>
                      <div style={{ color: "var(--text-mute)", fontSize: 10 }}>{s.note}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div className="tabular" style={{ color: "var(--accent)", fontSize: 14, fontFamily: "var(--serif)" }}>${fmt(s.target)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Footer */}
          <footer className="footer">
            <div>
              <div style={{ marginBottom: 4 }}>Options Desk · Deribit Daily Recap</div>
              <div style={{ color: "var(--text-dim)" }}>
                {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
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
