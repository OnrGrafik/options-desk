import Head from "next/head";
import { useState, useEffect, useRef, useCallback } from "react";
import {
  fetchSpot, fetchInstruments, fetchAllOptions, fetchOHLCV,
  aggregateByStrike, findLevels, classifyStrikes,
} from "../lib/gex";

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════
const fmt = (n) => n ? Math.round(n).toLocaleString("en-US") : "—";
const fmtB = (n) => {
  if (!n && n !== 0) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n/1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n/1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n/1e3).toFixed(0)}K`;
  return n.toFixed(1);
};

function useCountUp(target, ms = 700) {
  const [v, setV] = useState(target);
  const prev = useRef(target);
  useEffect(() => {
    if (target === prev.current) return;
    const start = prev.current, t0 = performance.now();
    let f;
    const tick = (now) => {
      const t = Math.min((now - t0) / ms, 1);
      const e = 1 - Math.pow(1 - t, 3);
      setV(start + (target - start) * e);
      if (t < 1) f = requestAnimationFrame(tick);
      else prev.current = target;
    };
    f = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(f);
  }, [target, ms]);
  return v;
}

// ═══════════════════════════════════════════════════════════
// DATA FETCHING HOOK
// ═══════════════════════════════════════════════════════════
function useGexData() {
  const [state, setState] = useState({
    spot: 0, strikes: [], classified: [], options: [], ohlcv: null,
    levels: {}, totals: { gamma: 0, vanna: 0, charm: 0 },
    stats: { rows: 0, totalInst: 0, expiries: 0 },
    change24h: 0, dvol: 52.4, funding: 0.001, basis: 8.2,
    loading: true, error: null, progress: "", lastUpdate: null,
  });

  const load = useCallback(async (silent = false) => {
    if (!silent) setState(s => ({ ...s, loading: true, error: null }));
    try {
      setState(s => ({ ...s, progress: "Spot fiyat alınıyor..." }));
      const spot = await fetchSpot();
      if (!spot) throw new Error("Spot fiyat alınamadı");

      fetchOHLCV("60", 48).then(ohlcv => {
        if (ohlcv?.close) {
          const n = ohlcv.close.length;
          const chg = n > 24 ? ((ohlcv.close[n-1] - ohlcv.close[n-25]) / ohlcv.close[n-25] * 100) : 0;
          setState(s => ({ ...s, ohlcv, change24h: chg }));
        }
      }).catch(() => {});

      setState(s => ({ ...s, progress: "Opsiyon zinciri çekiliyor..." }));
      const instruments = await fetchInstruments();
      if (!instruments.length) throw new Error("Opsiyon verisi yok");

      const { options, stats } = await fetchAllOptions(instruments, spot, (pct, rows, exps) => {
        setState(s => ({ ...s, progress: `Analiz: %${pct} · ${rows} opt · ${exps} vade` }));
      });

      setState(s => ({ ...s, progress: "GEX hesaplanıyor..." }));
      const agg = aggregateByStrike(options);
      const levels = findLevels(agg, spot, options);
      const classified = classifyStrikes(agg, spot);
      const totals = {
        gamma: agg.reduce((a, x) => a + x.netGex, 0),
        vanna: agg.reduce((a, x) => a + x.vannaNet, 0),
        charm: agg.reduce((a, x) => a + x.charmNet, 0),
      };
      // ATM IV from nearest option
      const atmOpt = options.filter(o => o.type === "call").sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0];
      const dvol = atmOpt ? atmOpt.iv * 100 : 52;

      setState(s => ({
        ...s, spot, strikes: agg, classified, options, levels, totals, stats,
        dvol, loading: false, error: null, lastUpdate: new Date(), progress: "",
      }));
    } catch (e) {
      setState(s => ({ ...s, loading: false, error: e.message }));
    }
  }, []);

  useEffect(() => { load(); const iv = setInterval(() => load(true), 5 * 60000); return () => clearInterval(iv); }, [load]);

  return { ...state, reload: () => load() };
}

// ═══════════════════════════════════════════════════════════
// SIDEBAR
// ═══════════════════════════════════════════════════════════
function Sidebar({ data, expiry, setExpiry }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">₿</div>
        <div>
          <div className="brand-name">Options Desk</div>
          <div className="brand-sub">Vol &amp; Gamma · Deribit Live</div>
        </div>
      </div>

      <div className="sb-section">
        <div className="sb-label">Underlying</div>
        <div className="sb-item active">
          <span className="sb-item-key tabular">BTC/USD</span>
          <span className="sb-item-val">
            <span style={{ color: "var(--text)" }}>{fmt(data.spot)}</span>
            <span className={data.change24h >= 0 ? "pos" : "neg"} style={{ marginLeft: 8 }}>
              {data.change24h >= 0 ? "+" : ""}{data.change24h.toFixed(2)}%
            </span>
          </span>
        </div>
      </div>

      <div className="sb-section">
        <div className="sb-label">Vade filtresi</div>
        <div className="sb-chip-row">
          {["all", "0-7d", "8-45d", "45d+"].map(e => (
            <button key={e} className={`sb-chip ${expiry === e ? "active" : ""}`} onClick={() => setExpiry(e)}>
              {e === "all" ? "Tümü" : e}
            </button>
          ))}
        </div>
      </div>

      <div className="sb-section">
        <div className="sb-label">Piyasa verileri</div>
        <SbStat label="ATM IV" value={`${data.dvol.toFixed(1)}%`} />
        <SbStat label="DVOL" value={data.dvol.toFixed(1)} />
        <SbStat label="Funding" value={`${(data.funding * 100).toFixed(3)}%`} pos={data.funding >= 0} />
        <SbStat label="Basis (90g)" value={`+${data.basis.toFixed(1)}%`} pos />
        <SbStat label="Net GEX" value={fmtB(data.totals.gamma) + "$"} pos={data.totals.gamma >= 0} />
        <SbStat label="Vanna" value={fmtB(data.totals.vanna) + "$"} />
        <SbStat label="Charm" value={fmtB(data.totals.charm) + "$"} />
      </div>

      <div className="sb-section">
        <div className="sb-label">Seviyeler</div>
        {[
          { label: "Call Wall", val: data.levels.callWall, pct: data.levels.callWallPct, cls: "cw" },
          { label: "Put Wall", val: data.levels.putWall, pct: data.levels.putWallPct, cls: "pw" },
          { label: "Zero Gamma", val: data.levels.zeroGamma, pct: data.levels.zeroGammaPct, cls: "zg" },
          { label: "Max Pain", val: data.levels.maxPain, pct: data.levels.maxPainPct, cls: "mp" },
          { label: "EM High", val: data.levels.emHigh, pct: data.levels.emHighPct, cls: "" },
          { label: "EM Low", val: data.levels.emLow, pct: data.levels.emLowPct, cls: "" },
        ].map((r, i) => (
          <div key={i} className="sb-item">
            <span className={`sb-item-key tag ${r.cls}`} style={{ fontSize: 10, letterSpacing: "0.06em" }}>{r.label}</span>
            <span className="sb-item-val">
              <span style={{ color: "var(--text)" }}>${fmt(r.val)}</span>
              {r.pct && <span className={parseFloat(r.pct) >= 0 ? "pos" : "neg"} style={{ marginLeft: 6, fontSize: 9 }}>
                {parseFloat(r.pct) >= 0 ? "+" : ""}{r.pct}%
              </span>}
            </span>
          </div>
        ))}
      </div>

      <div className="sb-section" style={{ marginTop: "auto" }}>
        <div className="sb-label">Chain</div>
        <SbStat label="Opsiyonlar" value={data.stats.rows} />
        <SbStat label="Strike" value={data.strikes.length} />
        <SbStat label="Vade" value={data.stats.expiries} />
      </div>
    </aside>
  );
}
function SbStat({ label, value, pos }) {
  return (
    <div className="sb-item">
      <span className="sb-item-key" style={{ color: "var(--text-mute)", fontSize: 10, letterSpacing: "0.08em" }}>{label}</span>
      <span className="sb-item-val" style={{ color: pos === true ? "var(--pos)" : pos === false ? "var(--neg)" : "var(--text)", fontSize: 11 }}>
        {value}
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// HERO
// ═══════════════════════════════════════════════════════════
function Hero({ data }) {
  const animSpot = useCountUp(data.spot);
  const animChg = useCountUp(data.change24h);
  const isPositive = data.totals.gamma >= 0;

  const closes = data.ohlcv?.close || [];
  const sparkW = 380, sparkH = 56;
  const min = Math.min(...closes), max = Math.max(...closes), range = max - min || 1;
  const sparkPath = closes.length > 1
    ? closes.map((c, i) => `${i === 0 ? "M" : "L"} ${(i / (closes.length - 1)) * sparkW} ${sparkH - ((c - min) / range) * sparkH}`).join(" ")
    : "";

  const gammaPct = Math.max(0, Math.min(100, ((data.totals.gamma + 50e6) / 250e6) * 100));
  const { emHigh, emLow, callWall, putWall, maxPain, zeroGamma } = data.levels;
  const emRange = (emHigh || 0) - (emLow || 0);
  const spotPos = emRange > 0 ? ((data.spot - (emLow || 0)) / emRange) * 100 : 50;

  return (
    <section className="hero">
      <div className="hero-left">
        <div className="hero-kicker">
          <span>BTC / USD</span>
          <span className="dot">·</span>
          <span>Deribit Index</span>
          <span className="dot">·</span>
          <span>Spot · {data.lastUpdate ? data.lastUpdate.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" }) : "—"} UTC</span>
        </div>
        <h1 className="hero-price tabular">
          <span>{Math.floor(animSpot).toLocaleString("en-US")}</span>
          <span className="currency">USD</span>
        </h1>
        <div className="hero-meta">
          <span className={`change-pill ${animChg < 0 ? "neg" : ""}`}>
            {animChg >= 0 ? "+" : ""}{animChg.toFixed(2)}%
            <span style={{ color: "var(--text-mute)", marginLeft: 4 }}>· 24h</span>
          </span>
          {closes.length > 1 && (
            <span className="session-note">
              Range <b>${fmt(Math.min(...closes))}</b> – <b>${fmt(Math.max(...closes))}</b>
              <span style={{ color: "var(--text-mute)" }}> · 48h</span>
            </span>
          )}
        </div>

        {/* Sparkline */}
        {sparkPath && (
          <svg width={sparkW} height={sparkH + 8} style={{ marginTop: 20, display: "block" }}>
            <defs>
              <linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.2" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`${sparkPath} L ${sparkW} ${sparkH} L 0 ${sparkH} Z`} fill="url(#sparkFill)" />
            <path d={sparkPath} fill="none" stroke="var(--accent)" strokeWidth="1.4" />
          </svg>
        )}

        <p className="pull" style={{ marginTop: 32 }}>
          Net gamma exposure prints{" "}
          <em>{isPositive ? "pozitif" : "negatif"}</em>{" "}
          {isPositive
            ? "— dealer hedging fiyat hareketlerini bastırıyor ve fiyatı "
            : "— dealer hedging volatiliteyi amplify ediyor, "
          }
          <em>${fmt(callWall)}</em> call wall'una yakın tutuyor.
        </p>
      </div>

      <div className="hero-right">
        {/* Regime panel */}
        <div className="regime-panel">
          <div className="regime-head">
            <span className="regime-label">Gamma Rejimi</span>
            <span className={`regime-state ${!isPositive ? "neg" : ""}`}>
              {isPositive ? "● POZİTİF" : "● NEGATİF"}
            </span>
          </div>
          <div className="regime-value">{fmtB(data.totals.gamma)}<span style={{ fontSize: 16, color: "var(--text-dim)", marginLeft: 4 }}>$</span></div>
          <div className="gamma-scale">
            <div className="gamma-pointer" style={{ left: `${gammaPct}%` }} />
          </div>
          <div className="gamma-scale-labels">
            <span>−NEG</span><span>NÖTR</span><span>+POS</span>
          </div>
        </div>

        {/* EM Band */}
        <div className="regime-panel" style={{ padding: "14px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
            <span className="regime-label">Beklenen Hareket (EOW)</span>
            {emRange > 0 && <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-dim)" }}>
              ±{((emRange / 2 / data.spot) * 100).toFixed(1)}%
            </span>}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--neg)" }}>${fmt(emLow)}</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-dim)" }}>→ SPOT →</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--pos)" }}>${fmt(emHigh)}</span>
          </div>
          <div className="gamma-scale" style={{ margin: "8px 0 4px", background: "linear-gradient(90deg, var(--neg) 0%, var(--text-mute) 50%, var(--pos) 100%)" }}>
            <div className="gamma-pointer" style={{ left: `${Math.max(2, Math.min(98, spotPos))}%`, background: "var(--accent)" }} />
          </div>
        </div>

        {/* Key levels list */}
        <div className="levels-list">
          {[
            { label: "Call Wall", sub: "max call γ", val: callWall, pct: data.levels.callWallPct, color: "var(--pos)" },
            { label: "Zero Gamma", sub: "rejim dönüşü", val: zeroGamma, pct: data.levels.zeroGammaPct, color: "var(--neutral)" },
            { label: "Max Pain", sub: "yazarlar min", val: maxPain, pct: data.levels.maxPainPct, color: "var(--accent)" },
            { label: "Put Wall", sub: "max put γ", val: putWall, pct: data.levels.putWallPct, color: "var(--neg)" },
          ].map((item, i) => {
            const pctNum = item.pct ? parseFloat(item.pct) : 0;
            return (
              <div key={i} className="level-row">
                <div className="level-dot" style={{ color: item.color }} />
                <div>
                  <span className="level-name">{item.label}</span>
                  <span className="level-sub">{item.sub}</span>
                </div>
                <div className="level-value">${fmt(item.val)}</div>
                <div className={`level-delta ${pctNum >= 0 ? "pos" : "neg"}`}>
                  {item.pct ? `${pctNum >= 0 ? "+" : ""}${item.pct}%` : "—"}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════
// STRIKE LADDER (Section i)
// ═══════════════════════════════════════════════════════════
function StrikeLadder({ data, expiry }) {
  const { strikes, spot, levels } = data;
  const lo = spot * 0.85, hi = spot * 1.15;
  const vis = strikes.filter(s => s.strike >= lo && s.strike <= hi);
  const activeExp = expiry === "all" ? ["0-7d", "8-45d", "45d+"] : [expiry];

  const maxGex = Math.max(...vis.map(s => {
    const cg = activeExp.reduce((a, ek) => a + (s.byExpiry[ek]?.callGex || 0), 0);
    const pg = activeExp.reduce((a, ek) => a + Math.abs(s.byExpiry[ek]?.putGex || 0), 0);
    return Math.max(cg, pg);
  }), 1);

  const wallTags = {
    [levels.callWall]: { label: "CW", cls: "cw" },
    [levels.putWall]: { label: "PW", cls: "pw" },
    [levels.maxPain]: { label: "MP", cls: "mp" },
    [levels.zeroGamma]: { label: "ZΓ", cls: "zg" },
  };

  return (
    <div className="ladder">
      <div className="ladder-header">
        <div>TAG</div>
        <div style={{ textAlign: "right" }}>DIST</div>
        <div style={{ textAlign: "right", paddingRight: 14 }}>PUT γ</div>
        <div style={{ textAlign: "center" }}>STRIKE</div>
        <div style={{ paddingLeft: 14 }}>CALL γ</div>
        <div style={{ textAlign: "center" }}>NET</div>
        <div>OI</div>
      </div>
      {vis.slice().reverse().map(s => {
        const tag = wallTags[s.strike];
        const dist = ((s.strike - spot) / spot * 100).toFixed(1);
        const distPos = parseFloat(dist) >= 0;
        const isSpot = Math.abs(s.strike - spot) < 500;

        const callW = activeExp.reduce((a, ek) => a + (s.byExpiry[ek]?.callGex || 0), 0);
        const putW = activeExp.reduce((a, ek) => a + Math.abs(s.byExpiry[ek]?.putGex || 0), 0);
        const callBarW = Math.round((callW / maxGex) * 100);
        const putBarW = Math.round((putW / maxGex) * 100);

        return (
          <div key={s.strike} className={`ladder-row ${isSpot ? "spot" : ""}`}>
            <div className={`tag ${tag?.cls || ""}`}>{tag?.label || ""}</div>
            <div className={`dist ${distPos ? "pos" : "neg"}`}>{distPos ? "+" : ""}{dist}%</div>
            <div className="bar-cell put">
              {putW > 0 && <div className="bar put" style={{ width: `${putBarW}%` }} />}
            </div>
            <div className="strike-cell">{(s.strike / 1000).toFixed(0)}K</div>
            <div className="bar-cell call">
              {callW > 0 && <div className="bar call" style={{ width: `${callBarW}%` }} />}
            </div>
            <div className="net" style={{ color: s.netGex >= 0 ? "var(--pos)" : "var(--neg)", fontSize: 10 }}>
              {s.netGex >= 0 ? "+" : ""}{fmtB(s.netGex)}
            </div>
            <div style={{ fontSize: 10, color: "var(--text-mute)", textAlign: "right" }}>
              {(s.totalOI / 1000).toFixed(0)}K
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// SHEET (right column in Section i)
// ═══════════════════════════════════════════════════════════
function Sheet({ data }) {
  const { totals, levels, stats } = data;
  return (
    <div className="sheet">
      <div className="sheet-block">
        <div className="sheet-label">Net GEX Toplam</div>
        <div className={`sheet-num ${totals.gamma >= 0 ? "pos" : "neg"}`}>{fmtB(totals.gamma)}<span style={{ fontSize: 20 }}>$</span></div>
        <div className="sheet-foot">
          <span>{totals.gamma >= 0 ? "Pozitif gamma rejimi" : "Negatif gamma rejimi"}</span>
          <span>{stats.rows} opsiyon</span>
        </div>
      </div>
      <div className="sheet-block">
        <div className="sheet-label">Vanna Exposure</div>
        <div className="sheet-num">{fmtB(totals.vanna)}<span style={{ fontSize: 20 }}>$</span></div>
        <div className="sheet-foot"><span>∂Δ/∂σ · IV etkisi</span></div>
      </div>
      <div className="sheet-block">
        <div className="sheet-label">Charm Exposure</div>
        <div className="sheet-num">{fmtB(totals.charm)}<span style={{ fontSize: 20 }}>$</span></div>
        <div className="sheet-foot"><span>∂Δ/∂t · zaman çürümesi</span></div>
      </div>
      <div className="sheet-block">
        <div className="sheet-label">Kilit Seviyeler</div>
        <div className="levels-list">
          {[
            { label: "Call Wall", val: levels.callWall, color: "var(--pos)" },
            { label: "Zero Gamma", val: levels.zeroGamma, color: "var(--neutral)" },
            { label: "Max Pain", val: levels.maxPain, color: "var(--accent)" },
            { label: "Put Wall", val: levels.putWall, color: "var(--neg)" },
          ].map((r, i) => (
            <div key={i} className="level-row" style={{ padding: "10px 0" }}>
              <div className="level-dot" style={{ color: r.color }} />
              <div className="level-name" style={{ fontSize: 12 }}>{r.label}</div>
              <div className="level-value" style={{ fontSize: 13 }}>${fmt(r.val)}</div>
              <div className="level-delta" style={{ fontSize: 10 }}>
                {r.val && data.spot ? `${((r.val - data.spot) / data.spot * 100).toFixed(1)}%` : ""}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// GREEKS STACK (Section ii)
// ═══════════════════════════════════════════════════════════
function GreeksStack({ data }) {
  const cells = [
    {
      glyph: "Γ", label: "GAMMA", num: fmtB(data.totals.gamma) + "$",
      foot: `Dealer net gamma. ${data.totals.gamma >= 0 ? "Pozitif rejim: hedging dampens moves." : "Negatif rejim: hedging amplifies moves."}`,
    },
    {
      glyph: "V", label: "VANNA", num: fmtB(data.totals.vanna) + "$",
      foot: "∂Δ/∂σ — IV yükselince delta akışı. Vol spike → mevcut pozisyonlarda delta rebalancing.",
    },
    {
      glyph: "C", label: "CHARM", num: fmtB(data.totals.charm) + "$",
      foot: "∂Δ/∂t — Zaman geçtikçe delta değişimi. Expiry yaklaştıkça pin etkisi güçlenir.",
    },
  ];
  return (
    <div className="greeks-stack">
      {cells.map((c, i) => (
        <div key={i} className="greek-cell">
          <div className="greek-glyph">{c.glyph}</div>
          <div className="greek-label">{c.label}</div>
          <div className="greek-num">{c.num}</div>
          <div className="greek-foot">{c.foot}</div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TERM STRUCTURE (Section iii)
// ═══════════════════════════════════════════════════════════
function TermCurve({ data }) {
  const expiryMap = {};
  for (const o of data.options) {
    if (!expiryMap[o.expiryTs]) expiryMap[o.expiryTs] = { days: o.daysToExp, ivs: [], gex: 0 };
    expiryMap[o.expiryTs].ivs.push({ strike: o.strike, iv: o.iv, dist: Math.abs(o.strike - data.spot) });
    expiryMap[o.expiryTs].gex += o.gex;
  }
  const points = Object.values(expiryMap).map(e => {
    e.ivs.sort((a, b) => a.dist - b.dist);
    return { days: e.days, iv: e.ivs[0].iv * 100, gex: e.gex };
  }).sort((a, b) => a.days - b.days);

  if (points.length < 2) return null;

  const W = 700, H = 260;
  const pad = { top: 30, right: 20, bottom: 50, left: 50 };
  const maxD = Math.max(...points.map(p => p.days));
  const minIV = Math.min(...points.map(p => p.iv)) - 4;
  const maxIV = Math.max(...points.map(p => p.iv)) + 4;
  const maxGex = Math.max(...points.map(p => Math.abs(p.gex)), 1);
  const xS = (d) => pad.left + (d / maxD) * (W - pad.left - pad.right);
  const yS = (iv) => pad.top + ((maxIV - iv) / (maxIV - minIV)) * (H - pad.top - pad.bottom);
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${xS(p.days)} ${yS(p.iv)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} className="term-svg">
      {[40, 50, 60, 70, 80].map(iv => {
        const y = yS(iv); if (y < pad.top || y > H - pad.bottom) return null;
        return (
          <g key={iv}>
            <line x1={pad.left} x2={W - pad.right} y1={y} y2={y} stroke="var(--hairline)" strokeWidth="0.5" />
            <text x={pad.left - 6} y={y + 3} textAnchor="end" fontSize="9" fontFamily="var(--mono)" fill="var(--text-mute)">{iv}%</text>
          </g>
        );
      })}
      {points.map((p, i) => {
        const x = xS(p.days), bW = Math.max((W - pad.left - pad.right) / points.length * 0.5, 4);
        const bH = Math.abs(p.gex) / maxGex * 60;
        return <rect key={i} x={x - bW/2} y={H - pad.bottom - bH} width={bW} height={bH}
          fill={p.gex >= 0 ? "var(--pos)" : "var(--neg)"} opacity="0.3" />;
      })}
      <path d={`${pathD} L ${xS(points[points.length-1].days)} ${H - pad.bottom} L ${pad.left} ${H - pad.bottom} Z`}
        fill="var(--accent)" opacity="0.06" />
      <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth="1.8" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={xS(p.days)} cy={yS(p.iv)} r="4" fill="var(--bg)" stroke="var(--accent)" strokeWidth="1.5" />
          <text x={xS(p.days)} y={yS(p.iv) - 8} textAnchor="middle" fontSize="9" fontFamily="var(--mono)" fill="var(--text-dim)">
            {p.iv.toFixed(0)}%
          </text>
          <text x={xS(p.days)} y={H - pad.bottom + 16} textAnchor="middle" fontSize="9" fontFamily="var(--mono)" fill="var(--text-mute)">
            {p.days}g
          </text>
        </g>
      ))}
      <text x={W/2} y={H - 8} textAnchor="middle" fontSize="9" fontFamily="var(--mono)" fill="var(--text-mute)">Vadeye Kalan Gün</text>
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════
// LOADING
// ═══════════════════════════════════════════════════════════
function Loading({ progress }) {
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100vh", color: "var(--text-dim)", fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.1em", background: "var(--bg)" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ width: 36, height: 36, margin: "0 auto 20px", border: "1.5px solid var(--hairline-strong)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.9s linear infinite" }} />
        <div>{progress || "LOADING OPTION CHAIN…"}</div>
        <div style={{ marginTop: 8, fontSize: 10, color: "var(--text-mute)" }}>Tüm opsiyonlar çekildiği için 1-2 dk sürebilir</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════
export default function Home() {
  const data = useGexData();
  const [expiry, setExpiry] = useState("all");

  if (data.loading) return (
    <>
      <Head><title>Options Desk · BTC</title></Head>
      <Loading progress={data.progress} />
    </>
  );

  if (data.error) return (
    <>
      <Head><title>Options Desk · BTC</title></Head>
      <div style={{ display: "grid", placeItems: "center", height: "100vh", fontFamily: "var(--mono)", background: "var(--bg)", color: "var(--neg)" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 16, marginBottom: 12 }}>❌ {data.error}</div>
          <button onClick={data.reload} style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--hairline-strong)", padding: "8px 20px", cursor: "pointer", fontFamily: "var(--mono)" }}>
            Tekrar Dene
          </button>
        </div>
      </div>
    </>
  );

  const isPositive = data.totals.gamma >= 0;
  const timeStr = data.lastUpdate
    ? data.lastUpdate.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";

  return (
    <>
      <Head>
        <title>Options Desk · BTC</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@200;300;400;500;600;700;800&family=JetBrains+Mono:wght@300;400;500;600&display=swap" rel="stylesheet" />
      </Head>

      <div className="app">
        <Sidebar data={data} expiry={expiry} setExpiry={setExpiry} />

        <main className="main">
          {/* Header */}
          <div className="header">
            <div className="header-trail">
              <span className="crumb">Desk</span>
              <span className="sep">/</span>
              <span className="crumb">Crypto Options</span>
              <span className="sep">/</span>
              <span className="crumb active">BTC · Gamma</span>
            </div>
            <div className="header-actions">
              <div className="h-stat">
                <span className="h-stat-label">Güncellendi</span>
                <span className="h-stat-value tabular">{timeStr} UTC</span>
              </div>
              <div className="h-stat">
                <span className="h-stat-label">Rejim</span>
                <span className="h-stat-value" style={{ color: isPositive ? "var(--pos)" : "var(--neg)" }}>
                  {isPositive ? "● POZİTİF" : "● NEGATİF"}
                </span>
              </div>
              <button className="h-action" onClick={data.reload}>↻ Yenile</button>
            </div>
          </div>

          {/* Hero */}
          <Hero data={data} />

          {/* Section i — Strike Topography */}
          <section className="section">
            <div className="section-head">
              <h2 className="section-title">
                <span className="section-nbr">i.</span>Strike Topography
              </h2>
              <span className="section-meta">
                {data.strikes.length} STRIKE · {data.stats.expiries} VADE · {expiry === "all" ? "TÜMÜ" : expiry.toUpperCase()}
              </span>
            </div>
            <div className="ladder-wrap">
              <StrikeLadder data={data} expiry={expiry} />
              <Sheet data={data} />
            </div>
          </section>

          {/* Section ii — Greeks */}
          <section className="section">
            <div className="section-head">
              <h2 className="section-title">
                <span className="section-nbr">ii.</span>Aggregate Greeks
              </h2>
              <span className="section-meta">DEALER-NORMALIZED · USD CİNSİNDEN</span>
            </div>
            <GreeksStack data={data} />
          </section>

          {/* Section iii — Vol Surface */}
          {data.options.length > 0 && (
            <section className="section">
              <div className="section-head">
                <h2 className="section-title">
                  <span className="section-nbr">iii.</span>Volatility Surface
                </h2>
                <span className="section-meta">VADE YAPISI · ATM IV</span>
              </div>
              <div className="term-card">
                <div>
                  <div className="sheet-label" style={{ marginBottom: 12 }}>ATM Vade Yapısı</div>
                  <TermCurve data={data} />
                  <p style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-dim)", marginTop: 8, lineHeight: 1.5 }}>
                    Her nokta o vadenin ATM implied volatility'sini gösterir.
                    GEX barları o vadedeki net gamma yoğunluğunu temsil eder.
                  </p>
                </div>
                <div>
                  <div className="sheet-label" style={{ marginBottom: 12 }}>Senaryo Analizi</div>
                  {[
                    { label: "Spot yükselir ↑", target: data.levels.callWall, note: "Call Wall'da dealer delta satışı başlar" },
                    { label: "Spot pinlenir", target: data.levels.maxPain, note: "Max Pain'de vol grinds lower, expiry yaklaştıkça" },
                    { label: "Spot düşer ↓", target: data.levels.putWall, note: "Put Wall'da gamma negatife döner, vol genişler" },
                    { label: "Zero Gamma kırılır", target: data.levels.zeroGamma, note: "Rejim değişimi — dealer flow ters döner" },
                  ].map((s, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 16, padding: "12px 0", borderBottom: "1px solid var(--hairline-soft)", fontFamily: "var(--mono)", fontSize: 11 }}>
                      <div>
                        <div style={{ color: "var(--text)", fontSize: 12, marginBottom: 2 }}>{s.label}</div>
                        <div style={{ color: "var(--text-mute)", fontSize: 10, letterSpacing: "0.04em" }}>{s.note}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div className="tabular" style={{ color: "var(--accent)", fontSize: 14, fontFamily: "var(--serif)" }}>${fmt(s.target)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Footer */}
          <footer className="footer">
            <div>
              <div style={{ marginBottom: 4 }}>Options Desk · Deribit Live Feed</div>
              <div style={{ color: "var(--text-dim)" }}>
                {new Date().toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                {" · "}{data.stats.rows} kontrat · {data.stats.expiries} vade
              </div>
            </div>
            <div className="footer-pagenum">— BTC Gamma —</div>
          </footer>
        </main>
      </div>
    </>
  );
}
