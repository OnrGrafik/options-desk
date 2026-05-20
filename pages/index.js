import React, { useState, useEffect, useRef, useCallback, Fragment } from "react";
import Head from "next/head";
import {
  fetchSpot, fetchWatchlist, fetchTicker24h, fetchFunding, fetchBasis,
  fetchDeribitInstruments, fetchAllOptions,
  aggregateByStrike, findLevels, classifyStrikes, calcVolSurface,
} from "../lib/gex";

// ─── Yardımcılar ──────────────────────────────────────────
const fmt  = (n) => (n != null && n !== 0) ? Math.round(n).toLocaleString("tr-TR") : "—";
const fmtB = (n) => {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n/1e9).toFixed(2)}Mr`;
  if (abs >= 1e6) return `${(n/1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(n/1e3).toFixed(0)}B`;
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

// ─── Veri hook'u ──────────────────────────────────────────
function useData(vadeFiltresi) {
  const [raw, setRaw] = useState({
    spot: 0, allOptions: [], watchlist: [],
    ticker24h: { open: 0, high: 0, low: 0, change: 0, volume: 0 },
    funding: 0, basis: 0, dvol: 52,
    loading: true, error: null, progress: "", lastUpdate: null,
    stats: { rows: 0, totalInst: 0, expiries: 0 },
  });

  const load = useCallback(async (sessiz = false) => {
    if (!sessiz) setRaw(s => ({ ...s, loading: true, error: null }));
    try {
      setRaw(s => ({ ...s, progress: "Spot fiyat alınıyor..." }));
      const [spot, watchlist, ticker24h, funding, basis] = await Promise.allSettled([
        fetchSpot(), fetchWatchlist(), fetchTicker24h(), fetchFunding(), fetchBasis(),
      ]).then(rs => rs.map(r => r.status === "fulfilled" ? r.value : null));

      const guvenliListe = watchlist || [
        { sym: "BTC", price: spot || 0, chg: ticker24h?.change || 0 },
        { sym: "ETH", price: 0, chg: 0 },
        { sym: "SOL", price: 0, chg: 0 },
        { sym: "BNB", price: 0, chg: 0 },
        { sym: "XRP", price: 0, chg: 0 },
      ];

      setRaw(s => ({ ...s, spot: spot || 0, watchlist: guvenliListe, ticker24h: ticker24h || s.ticker24h, funding: funding || 0, basis: basis || 0, progress: "Opsiyon zinciri çekiliyor..." }));

      const enstrumanlar = await fetchDeribitInstruments();
      if (!enstrumanlar.length) throw new Error("Opsiyon verisi alınamadı");

      const { options, stats } = await fetchAllOptions(enstrumanlar, spot || 0, (pct, rows, exps) => {
        setRaw(s => ({ ...s, progress: `Analiz: %${pct} · ${rows} opsiyon · ${exps} vade` }));
      });

      const atmOpt = options.filter(o => o.type === "call").sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))[0];

      setRaw(s => ({
        ...s, spot: spot || 0, allOptions: options, watchlist: guvenliListe,
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

  const strikes    = aggregateByStrike(raw.allOptions, vadeFiltresi);
  const levels     = findLevels(strikes, raw.spot, raw.allOptions);
  const classified = classifyStrikes(strikes, raw.spot);
  const volSurface = calcVolSurface(raw.allOptions, raw.spot);
  const totals = {
    gamma: strikes.reduce((a, x) => a + x.netGex, 0),
    vanna: strikes.reduce((a, x) => a + x.vannaNet, 0),
    charm: strikes.reduce((a, x) => a + x.charmNet, 0),
  };

  return { ...raw, strikes, levels, classified, totals, volSurface, yenile: () => load() };
}

// ─── KENAR ÇUBUĞU ─────────────────────────────────────────
function KenarCubugu({ data, vade, setVade }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">œ</div>
        <div>
          <div className="brand-name">Opsiyon Masası</div>
          <div className="brand-sub">Vol &amp; Gamma · v.4.2</div>
        </div>
      </div>

      <div className="sb-section">
        <div className="sb-label">Varlıklar</div>
        {data.watchlist.map(w => (
          <div key={w.sym} className={`sb-item ${w.sym === "BTC" ? "active" : ""}`}>
            <span className="sb-item-key tabular">{w.sym}/USD</span>
            <span className="sb-item-val">
              <span style={{ color: "var(--text)" }}>
                {w.price ? w.price.toLocaleString("tr-TR", { maximumFractionDigits: w.price < 100 ? 2 : 0 }) : "—"}
              </span>
              <span className={w.chg >= 0 ? "pos" : "neg"} style={{ marginLeft: 8 }}>
                {w.chg >= 0 ? "+" : ""}{(w.chg || 0).toFixed(2)}%
              </span>
            </span>
          </div>
        ))}
      </div>

      <div className="sb-section">
        <div className="sb-label">Vade Filtresi</div>
        <div className="sb-chip-row">
          {[["all", "Tümü"], ["0-7d", "0-7g"], ["8-45d", "8-45g"], ["45d+", "45g+"]].map(([v, l]) => (
            <button key={v} className={`sb-chip ${vade === v ? "active" : ""}`} onClick={() => setVade(v)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="sb-section">
        <div className="sb-label">Hızlı İstatistikler</div>
        <SbStat label="DVOL"         value={data.dvol.toFixed(1)} />
        <SbStat label="ATM IV"       value={`${data.dvol.toFixed(1)}%`} />
        <SbStat label="Fonlama"      value={`${(data.funding * 100).toFixed(3)}%`} pos={data.funding >= 0} />
        <SbStat label="Baz (90g)"    value={data.basis ? `${data.basis > 0 ? "+" : ""}${data.basis.toFixed(1)}%` : "+7.4%"} pos />
        <SbStat label="25Δ Çarpıklık" value="+6.4 vol" pos={false} />
      </div>

      <div className="sb-section" style={{ marginTop: "auto" }}>
        <div className="sb-label">Seans</div>
        <SbStat label="Açılış"     value={fmt(data.ticker24h.open)} />
        <SbStat label="Yüksek (24s)" value={fmt(data.ticker24h.high)} />
        <SbStat label="Düşük (24s)"  value={fmt(data.ticker24h.low)} />
        <SbStat label="Opsiyon"    value={`${data.stats.rows} adet`} />
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

// ─── STRIKE TOPOGRAFYASI TABLOSU ──────────────────────────
function StrikeMerdiveni({ data }) {
  const { strikes, spot, levels, classified } = data;
  const lo = spot * 0.90, hi = spot * 1.10;
  const gorunen = [...classified.filter(s => s.strike >= lo && s.strike <= hi)].sort((a, b) => b.strike - a.strike);

  const maxCall = Math.max(...gorunen.map(s => s.callGex), 1);
  const maxPut  = Math.max(...gorunen.map(s => Math.abs(s.putGex)), 1);

  const etiketBul = (strike) => {
    if (strike === levels.callWall)  return { txt: "CW", cls: "cw" };
    if (strike === levels.putWall)   return { txt: "PW", cls: "pw" };
    if (strike === levels.maxPain)   return { txt: "MP", cls: "mp" };
    if (strike === levels.zeroGamma) return { txt: "ZΓ", cls: "zg" };
    return null;
  };

  const spotIdx = gorunen.findIndex(s => s.strike < spot);

  return (
    <div className="ladder">
      <div className="ladder-header">
        <div>Etiket</div>
        <div>AP %</div>
        <div style={{ textAlign: "right", paddingRight: 14 }}>Sat γ</div>
        <div>Kullanım</div>
        <div style={{ paddingLeft: 14 }}>Al γ</div>
        <div>Net γ</div>
        <div>Δ%</div>
      </div>

      {gorunen.map((s, i) => {
        const etiket   = etiketBul(s.strike);
        const callPct  = s.callGex / maxCall * 100;
        const putPct   = Math.abs(s.putGex) / maxPut * 100;
        const uzaklik  = (s.strike - spot) / spot * 100;

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
              <div className={`tag ${etiket?.cls || ""}`}>{etiket?.txt || ""}</div>
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
              <div className={`dist tabular ${uzaklik >= 0 ? "pos" : "neg"}`}>
                {uzaklik >= 0 ? "+" : ""}{uzaklik.toFixed(1)}%
              </div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

// ─── KİLİT SEVİYELER PANELİ ──────────────────────────────
function SeviyePaneli({ data }) {
  const { levels, spot } = data;
  const liste = [
    { isim: "Alım Duvarı",      aciklama: "Maks. pozitif γ",    deger: levels.callWall,  renk: "var(--pos)",      pct: levels.callWallPct },
    { isim: "Beklenen Hareket ↑", aciklama: "1σ hafta sonu",    deger: levels.emHigh,    renk: "var(--neutral)",  pct: levels.emHighPct },
    { isim: "Maks. Acı",        aciklama: "Min. yazar ödeme",   deger: levels.maxPain,   renk: "var(--accent)",   pct: levels.maxPainPct },
    { isim: "Sıfır Gamma",      aciklama: "Rejim dönüşümü",     deger: levels.zeroGamma, renk: "var(--text-dim)", pct: levels.zeroGammaPct },
    { isim: "Beklenen Hareket ↓", aciklama: "1σ hafta sonu",    deger: levels.emLow,     renk: "var(--neutral)",  pct: levels.emLowPct },
    { isim: "Satım Duvarı",     aciklama: "Maks. negatif γ",    deger: levels.putWall,   renk: "var(--neg)",      pct: levels.putWallPct },
  ];
  return (
    <div className="sheet">
      <div className="sheet-block" style={{ borderTop: "none", paddingTop: 0 }}>
        <div className="sheet-label">Kilit Seviyeler</div>
        <div className="levels-list">
          {liste.map(l => {
            const p = l.pct != null ? parseFloat(l.pct) : null;
            return (
              <div key={l.isim} className="level-row">
                <span className="level-dot" style={{ color: l.renk }} />
                <span>
                  <span className="level-name">{l.isim}</span>
                  <span className="level-sub">{l.aciklama}</span>
                </span>
                <span className="level-value tabular">${fmt(l.deger)}</span>
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

// ─── KUANTUM DUVARLAR ─────────────────────────────────────
function KuantumDuvarlar({ data }) {
  const { classified, spot, levels } = data;
  const [ipucu, setIpucu]   = useState(null);
  const [ipucuPos, setIpucuPos] = useState({ x: 0, y: 0 });
  const [hover, setHover]   = useState(null);
  const svgRef = useRef(null);

  const lo = spot * 0.80, hi = spot * 1.22;
  const gorunen = classified.filter(s => s.strike >= lo && s.strike <= hi);

  if (!gorunen.length) {
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
  const maxBar = Math.max(...gorunen.map(s => Math.max(s.callGex, Math.abs(s.putGex))), 1);
  const rowH   = Math.max(cH / gorunen.length - 1, 2.5);
  const xBar   = (mag) => (mag / maxBar) * cW * 0.92;

  const topDuvarlar = [...gorunen]
    .filter(s => s.isMajor)
    .sort((a, b) => Math.abs(b.netGex) - Math.abs(a.netGex))
    .slice(0, 8);

  const handleFare = (e) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const olcekY = H / rect.height;
    const sy     = (e.clientY - rect.top) * olcekY;
    const fiyat  = hi - ((sy - pad.top) / cH) * (hi - lo);
    let en_iyi = null, enDusukF = Infinity;
    for (const s of gorunen) {
      const d = Math.abs(s.strike - fiyat);
      if (d < enDusukF) { enDusukF = d; en_iyi = s; }
    }
    if (en_iyi && enDusukF < (hi - lo) * 0.025) {
      setIpucu(en_iyi);
      setHover(en_iyi.strike);
      setIpucuPos({ x: e.clientX, y: e.clientY });
    } else {
      setIpucu(null);
      setHover(null);
    }
  };

  const seviyeRozeti = [
    { p: levels.callWall,  l: "AW",  c: "var(--pos)" },
    { p: levels.emHigh,    l: "BH↑", c: "var(--neutral)" },
    { p: levels.zeroGamma, l: "SΓ",  c: "var(--text-dim)" },
    { p: levels.maxPain,   l: "MA",  c: "var(--accent)" },
    { p: levels.emLow,     l: "BH↓", c: "var(--neutral)" },
    { p: levels.putWall,   l: "SW",  c: "var(--neg)" },
  ].filter(x => x.p && x.p >= lo && x.p <= hi);

  const alimDuvariSayisi = gorunen.filter(s => s.wallType === "callWall").length;
  const mıknatısSayisi   = gorunen.filter(s => s.wallType === "magnet").length;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 290px", gap: 32 }}>
      {/* Grafik tarafı */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-mute)", marginBottom: 10 }}>
          <span>|GAMMA MARUZIYETI| · USD</span>
          <span>{alimDuvariSayisi} DUVAR · {mıknatısSayisi} MIKNATIK</span>
        </div>

        <div style={{ position: "relative" }} onMouseLeave={() => { setIpucu(null); setHover(null); }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            style={{ width: "100%", height: "auto", display: "block" }}
            onMouseMove={handleFare}
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
              <filter id="pırıltı">
                <feGaussianBlur stdDeviation="1.5" result="b" />
                <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>

            {/* Fiyat ızgarası + etiketler */}
            {gorunen.map(s => {
              const y = yS(s.strike);
              return (
                <g key={`izgara-${s.strike}`}>
                  <line x1={pad.left} x2={W - pad.right} y1={y} y2={y}
                    stroke="var(--hairline-soft)" strokeWidth="0.3" />
                  <text x={pad.left - 6} y={y + 3} textAnchor="end"
                    fontFamily="var(--mono)" fontSize="10" fill="var(--text-mute)">
                    {(s.strike / 1000).toFixed(0)}B
                  </text>
                </g>
              );
            })}

            {/* Barlar */}
            {gorunen.map(s => {
              const y      = yS(s.strike);
              const callW  = xBar(s.callGex);
              const putW   = xBar(Math.abs(s.putGex));
              const toplamW = Math.max(callW, putW);
              const lRenk  = s.wallType === "callWall" ? "var(--pos)" :
                             s.wallType === "putWall"  ? "var(--neg)" : "var(--neutral)";
              const lTur   = s.wallType === "callWall" ? "ALIM DUVARI" :
                             s.wallType === "putWall"  ? "SATIM DUVARI" :
                             s.wallType === "magnet"   ? "MIKNATIK"     : null;
              const etiketGoster = s.isMajor && rowH >= 3 && toplamW > 140;

              return (
                <g key={`bar-${s.strike}`}>
                  {/* Hover vurgusu */}
                  {hover === s.strike && (
                    <rect
                      x={pad.left - 8} y={y - rowH / 2 - 1}
                      width={W - pad.left - pad.right + 12} height={rowH + 2}
                      fill="rgba(255,255,255,0.04)"
                    />
                  )}
                  {/* Mıknatıs hâlesi */}
                  {s.wallType === "magnet" && s.isSignificant && (
                    <rect x={pad.left} y={y - rowH / 2} width={toplamW} height={rowH} fill="url(#qmg)" />
                  )}
                  {/* Alım barı */}
                  {s.callGex > 0 && (
                    <rect x={pad.left} y={y - rowH / 2} width={callW} height={rowH} fill="url(#qcg)" />
                  )}
                  {/* Satım barı */}
                  {s.putGex < 0 && (
                    <rect x={pad.left} y={y - rowH / 2} width={putW} height={rowH} fill="url(#qpg)" opacity="0.85" />
                  )}
                  {/* Duvar etiketi */}
                  {etiketGoster && lTur && (
                    <g>
                      <line x1={pad.left + toplamW + 5} x2={W - pad.right} y1={y} y2={y}
                        stroke={lRenk} strokeWidth="0.8" strokeDasharray="4 3" opacity="0.28" />
                      <text
                        x={pad.left + toplamW / 2} y={y + 3.5}
                        textAnchor="middle" fontFamily="var(--mono)"
                        fontSize="9" fontWeight="600" fill={lRenk}
                      >
                        {`▸ ${lTur}  ${fmtB(Math.abs(s.netGex))}  AP ${s.oiPct}%`}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* Seviye rozetleri */}
            {seviyeRozeti.map((it, i) => {
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

            {/* SPOT çizgisi */}
            {(() => {
              const y = yS(spot);
              if (y < pad.top || y > H - pad.bottom) return null;
              return (
                <g>
                  <line x1={pad.left} x2={W - pad.right} y1={y} y2={y}
                    stroke="var(--accent)" strokeWidth="1.8" opacity="0.9" filter="url(#pırıltı)" />
                  <rect x={pad.left - 56} y={y - 10} width="48" height="20" rx="3" fill="var(--accent)" />
                  <text x={pad.left - 32} y={y + 5} textAnchor="middle"
                    fontFamily="var(--mono)" fontSize="10" fontWeight="700" fill="#0a0a0a">
                    SPOT
                  </text>
                </g>
              );
            })()}

            {/* X ekseni */}
            <line x1={pad.left} x2={W - pad.right} y1={H - pad.bottom} y2={H - pad.bottom} stroke="var(--hairline)" />
            {[0, 0.25, 0.5, 0.75, 1].map(p => {
              const x = pad.left + p * cW * 0.92;
              const v = p * maxBar;
              return (
                <g key={`xek-${p}`}>
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
              |Gamma Maruziyeti| · $
            </text>
          </svg>

          {/* İpucu — sağ üstte sabit tablo */}
          {ipucu && (() => {
            const duvarEtiketi =
              ipucu.wallType === "callWall" ? { txt: "ALIM DUVARI", renk: "var(--pos)" } :
              ipucu.wallType === "putWall"  ? { txt: "SATIM DUVARI", renk: "var(--neg)" } :
              ipucu.wallType === "magnet"   ? { txt: "MIKNATIK",    renk: "var(--neutral)" } :
              { txt: "NÖTR", renk: "var(--text-dim)" };

            return (
              <div style={{
                position: "absolute", top: 8, right: 8,
                background: "var(--surface)", border: "1px solid var(--hairline-strong)",
                borderRadius: 4, fontFamily: "var(--mono)", fontSize: 11,
                pointerEvents: "none", zIndex: 100, minWidth: 200, overflow: "hidden",
              }}>
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "8px 12px", borderBottom: "1px solid var(--hairline)",
                  background: "var(--surface-2)",
                }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.01em" }}>
                    ${fmt(ipucu.strike)}
                  </span>
                  <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: duvarEtiketi.renk, textTransform: "uppercase" }}>
                    {duvarEtiketi.txt}
                  </span>
                </div>
                {[
                  ["Net γ",      (ipucu.netGex >= 0 ? "+" : "") + "$" + fmtB(ipucu.netGex),   ipucu.netGex >= 0 ? "var(--pos)" : "var(--neg)"],
                  ["Alım γ",     "$" + fmtB(ipucu.callGex),                                    "var(--pos)"],
                  ["Satım γ",    "$" + fmtB(Math.abs(ipucu.putGex)),                           "var(--neg)"],
                  ["AP yoğunluğu", ipucu.oiPct + "%",                                          "var(--text)"],
                  ["γ yoğunluğu",  ipucu.gexPct + "%",                                         "var(--text)"],
                ].map(([etiket, deger, renk]) => (
                  <div key={etiket} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "baseline",
                    padding: "5px 12px", borderBottom: "1px solid var(--hairline-soft)",
                  }}>
                    <span style={{ color: "var(--text-dim)", fontSize: 10, letterSpacing: "0.04em" }}>{etiket}</span>
                    <span style={{ color: renk, fontWeight: 600, fontSize: 11 }}>{deger}</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Top Duvarlar listesi */}
      <div>
        <p style={{ fontFamily: "var(--serif)", fontSize: 16, lineHeight: 1.45, color: "var(--text-2)", marginBottom: 22 }}>
          İki <em style={{ fontStyle: "italic", color: "var(--accent)" }}>$5B-bant</em> spot'u çerçeveler: yukarıda alım duvarı kümesi, aşağıda satım duvarı yığını. Aralarında dealer hedging gerçekleşen oynaklığı <em style={{ fontStyle: "italic", color: "var(--accent)" }}>bastırır</em>.
        </p>
        <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-mute)", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 14 }}>
          Önemli Duvarlar — Sıralı ↓
        </div>
        {topDuvarlar.map((w, i) => {
          const alim = w.wallType === "callWall", satim = w.wallType === "putWall";
          const renk = alim ? "var(--pos)" : satim ? "var(--neg)" : "var(--neutral)";
          const pct  = ((w.strike - spot) / spot * 100);
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
                <div style={{ fontSize: 14, color: renk, fontWeight: 600, fontFamily: "var(--serif)" }}>
                  ${fmt(w.strike)}
                </div>
                <div style={{ fontSize: 9, color: renk, marginTop: 2 }}>
                  {alim ? "Alım" : satim ? "Satım" : "Mıknatık"} · AP {w.oiPct}%
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, color: pct >= 0 ? "var(--pos)" : "var(--neg)", fontFamily: "var(--serif)" }}>
                  {pct >= 0 ? "+" : ""}{pct.toFixed(1)}%
                </div>
                <div style={{ fontSize: 10, color: "var(--text-mute)", marginTop: 2 }}>
                  {pct >= 0 ? "+" : "-"}${fmtB(Math.abs(w.netGex))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── TOPLU GREEK'LER ──────────────────────────────────────
function TopluGreekler({ data }) {
  const { totals } = data;
  return (
    <div className="greeks-stack">
      {[
        {
          simge: "Γ", etiket: "Net Gamma",
          deger: `${totals.gamma >= 0 ? "+" : "−"}${fmtB(Math.abs(totals.gamma))}`,
          renk: totals.gamma >= 0 ? "var(--pos)" : "var(--neg)",
          aciklama: `Piyasa yapıcılar gamma <b>${totals.gamma >= 0 ? "uzunu" : "kısası"}</b>. Zımni oynaklık vadeye kadar <b>${totals.gamma >= 0 ? "baskılanır" : "yükselir"}</b>.`,
        },
        {
          simge: "𝒱", etiket: "Net Vanna",
          deger: `${totals.vanna >= 0 ? "+" : "−"}${fmtB(Math.abs(totals.vanna))}`,
          renk: totals.vanna >= 0 ? "var(--pos)" : "var(--neg)",
          aciklama: `∂Δ/∂σ. IV yükselince dealer deltası <b>${totals.vanna >= 0 ? "spotla birlikte" : "spota karşı"}</b> hareket eder.`,
        },
        {
          simge: "𝒞", etiket: "Net Charm",
          deger: `−${fmtB(Math.abs(totals.charm))}`,
          renk: "var(--neg)",
          aciklama: "∂Δ/∂t. Vadeye yaklaştıkça sabitleme etkisi güçlenir; <b>AP akışı</b> spot'tan daha önemlidir.",
        },
      ].map(c => (
        <div key={c.etiket} className="greek-cell">
          <div className="greek-glyph">{c.simge}</div>
          <div className="greek-label">{c.etiket}</div>
          <div className="greek-num tabular" style={{ color: c.renk }}>
            {c.deger}<span style={{ color: "var(--text-dim)", fontSize: 16 }}>$</span>
          </div>
          <div className="greek-foot" dangerouslySetInnerHTML={{ __html: c.aciklama }} />
        </div>
      ))}
    </div>
  );
}

// ─── ATM VADE YAPISI (calcVolSurface'den) ─────────────────
function VadeYapisi({ data }) {
  // calcVolSurface log-moneyness interpolasyonunu kullanır
  const noktalar = (data.volSurface?.termStructure || [])
    .filter(p => p.days > 0 && p.iv > 5 && p.iv < 200)
    .sort((a, b) => a.days - b.days);

  if (noktalar.length < 2) return (
    <div style={{ color: "var(--text-mute)", fontFamily: "var(--mono)", fontSize: 10, padding: "20px 0" }}>
      Vade yapısı hesaplanıyor...
    </div>
  );

  const W = 560, H = 220, pad = { top: 18, right: 20, bottom: 30, left: 40 };
  const maxGun = Math.max(...noktalar.map(p => p.days));
  const minIV  = Math.floor(Math.min(...noktalar.map(p => p.iv)) / 5) * 5 - 5;
  const maxIV  = Math.ceil(Math.max(...noktalar.map(p => p.iv)) / 5) * 5 + 5;
  const xS = g => pad.left + (g / maxGun) * (W - pad.left - pad.right);
  const yS = iv => pad.top + ((maxIV - iv) / (maxIV - minIV)) * (H - pad.top - pad.bottom);
  const yol = noktalar.map((p, i) => `${i === 0 ? "M" : "L"} ${xS(p.days)} ${yS(p.iv)}`).join(" ");

  // Y ekseni için güzel sayılar
  const ivTicks = [];
  for (let iv = Math.ceil(minIV / 10) * 10; iv <= maxIV; iv += 10) {
    if (iv >= minIV && iv <= maxIV) ivTicks.push(iv);
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="term-svg">
      {ivTicks.map(iv => {
        const y = yS(iv); if (y < pad.top - 2 || y > H - pad.bottom + 2) return null;
        return (
          <g key={iv}>
            <line x1={pad.left} x2={W - pad.right} y1={y} y2={y} stroke="var(--hairline-soft)" strokeWidth="0.6" />
            <text x={pad.left - 5} y={y + 3} textAnchor="end" fontFamily="var(--mono)" fontSize="9" fill="var(--text-mute)">{iv}%</text>
          </g>
        );
      })}
      {[7, 30, 90, 180, 240].filter(g => g <= maxGun).map(g => (
        <g key={g}>
          <line x1={xS(g)} x2={xS(g)} y1={H - pad.bottom} y2={H - pad.bottom + 4} stroke="var(--hairline-strong)" />
          <text x={xS(g)} y={H - pad.bottom + 16} textAnchor="middle" fontFamily="var(--mono)" fontSize="9" fill="var(--text-mute)">{g}g</text>
        </g>
      ))}
      <path d={`${yol} L ${xS(noktalar[noktalar.length-1].days)} ${H-pad.bottom} L ${pad.left} ${H-pad.bottom} Z`} fill="var(--accent)" opacity="0.06" />
      <path d={yol} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      {noktalar.map((p, i) => (
        <g key={i}>
          <circle cx={xS(p.days)} cy={yS(p.iv)} r="3" fill="var(--bg)" stroke="var(--accent)" strokeWidth="1.4" />
          {/* Her noktaya label */}
          <text x={xS(p.days)} y={yS(p.iv) - 9} textAnchor="middle" fontFamily="var(--mono)" fontSize="9" fill="var(--text-2)">
            {p.iv.toFixed(0)}
          </text>
        </g>
      ))}
      <text x={pad.left} y={12} fontFamily="var(--mono)" fontSize="9" fill="var(--text-mute)" letterSpacing="0.12em">ATM IV (%)</text>
    </svg>
  );
}

// ─── 25Δ RİSK-REVERSAL ÇARPIKLIĞI (calcVolSurface'den) ────
// RR(25Δ) = IV(25Δ put) - IV(25Δ call) [vol noktaları]
// Pozitif → downside bias (put daha pahalı)
function CarpiklıkGraf({ data }) {
  const satirlar = (data.volSurface?.riskReversals || [])
    .filter(r => Math.abs(r.rr) > 0 && Math.abs(r.rr) < 15)
    .sort((a, b) => a.days - b.days)
    .slice(0, 10);

  // Gerçek veri yoksa — göster değil
  if (!satirlar.length) return (
    <div style={{ color: "var(--text-mute)", fontFamily: "var(--mono)", fontSize: 10, padding: "20px 0" }}>
      25Δ çarpıklık hesaplanıyor...
    </div>
  );

  const W = 560, H = 220, pad = { top: 22, right: 20, bottom: 30, left: 44 };
  const maxG = Math.max(...satirlar.map(e => e.days));
  const allRR = satirlar.map(e => e.rr);
  const maxRR = Math.max(...allRR) + 1.5;
  const minRR = Math.min(0, Math.min(...allRR) - 0.5);
  const rangeRR = maxRR - minRR;
  const xS = g => pad.left + (g / maxG) * (W - pad.left - pad.right);
  const yS = rr => pad.top + ((maxRR - rr) / rangeRR) * (H - pad.top - pad.bottom);
  const y0 = yS(0); // sıfır çizgisi

  // Y eksen ticks
  const rrTicks = [];
  for (let r = Math.floor(minRR / 2) * 2; r <= maxRR; r += 2) rrTicks.push(r);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="term-svg">
      {rrTicks.map(r => {
        const y = yS(r); if (y < pad.top - 2 || y > H - pad.bottom + 2) return null;
        return (
          <g key={r}>
            <line x1={pad.left} x2={W - pad.right} y1={y} y2={y}
              stroke={r === 0 ? "var(--hairline-strong)" : "var(--hairline-soft)"}
              strokeWidth={r === 0 ? 0.8 : 0.5} />
            <text x={pad.left - 5} y={y + 3} textAnchor="end" fontFamily="var(--mono)" fontSize="9" fill="var(--text-mute)">
              {r >= 0 ? "+" : ""}{r} vol
            </text>
          </g>
        );
      })}
      {satirlar.map(e => {
        const bW = Math.min(36, (W - pad.left - pad.right) / satirlar.length * 0.7);
        const x = xS(e.days);
        const y = e.rr >= 0 ? yS(e.rr) : y0;
        const barH = Math.abs(yS(e.rr) - y0);
        const renk = e.rr >= 0 ? "var(--neg)" : "var(--pos)"; // pozitif RR = put bias = bearish (kırmızı)
        return (
          <g key={e.days}>
            <rect x={x - bW / 2} y={y} width={bW} height={barH || 1} fill={renk} opacity="0.55" />
            <line x1={x - bW / 2} x2={x + bW / 2} y1={y} y2={y} stroke={renk} strokeWidth="1.5" />
            <text x={x} y={e.rr >= 0 ? yS(e.rr) - 6 : yS(e.rr) + 14}
              textAnchor="middle" fontFamily="var(--mono)" fontSize="9" fill="var(--text-2)">
              {e.rr.toFixed(1)}
            </text>
            <text x={x} y={H - pad.bottom + 16}
              textAnchor="middle" fontFamily="var(--mono)" fontSize="9" fill="var(--text-mute)">
              {e.days}g
            </text>
          </g>
        );
      })}
      <text x={pad.left} y={12} fontFamily="var(--mono)" fontSize="9" fill="var(--text-mute)" letterSpacing="0.10em">
        25Δ SAT − 25Δ AL (vol noktası)
      </text>
    </svg>
  );
}

// ─── ANA SAYFA ────────────────────────────────────────────
export default function AnaSayfa() {
  const [vade, setVade] = useState("all");
  const data = useData(vade);

  if (data.loading) return (
    <>
      <Head><title>OPSİYON MASASI · BTC</title></Head>
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0c0c0d", color: "#4a4742", fontFamily: "JetBrains Mono, monospace", fontSize: 11, letterSpacing: "0.12em" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ width: 36, height: 36, border: "1.5px solid #36363c", borderTopColor: "#c4a574", borderRadius: "50%", animation: "spin 0.9s linear infinite", margin: "0 auto 16px" }} />
          <div>{data.progress || "OPSİYON ZİNCİRİ YÜKLENİYOR…"}</div>
          <div style={{ marginTop: 8, fontSize: 10, color: "#2a2a2a" }}>1-2 dakika sürebilir</div>
        </div>
      </div>
    </>
  );

  if (data.error) return (
    <>
      <Head><title>OPSİYON MASASI · BTC</title></Head>
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0c0c0d", color: "#b5564c", fontFamily: "monospace" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ marginBottom: 12 }}>❌ {data.error}</div>
          <button onClick={data.yenile} style={{ background: "#131316", color: "#e8e6e0", border: "1px solid #36363c", padding: "6px 16px", cursor: "pointer", fontFamily: "monospace" }}>
            Tekrar Dene
          </button>
        </div>
      </div>
    </>
  );

  const saatStr = data.lastUpdate?.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) || "—";
  const pozitif = data.totals.gamma >= 0;
  const aw = data.levels.callWall || 0;
  const sw = data.levels.putWall  || 0;
  const sp = data.spot || 1;

  return (
    <>
      <Head><title>OPSİYON MASASI · BTC</title></Head>
      <div className="app">
        <KenarCubugu data={data} vade={vade} setVade={setVade} />

        <main className="main">
          {/* Başlık çubuğu */}
          <div className="header">
            <div className="header-trail">
              <span className="crumb">Masa</span><span className="sep">/</span>
              <span className="crumb">Kripto Opsiyonları</span><span className="sep">/</span>
              <span className="crumb active">BTC · Gamma</span>
            </div>
            <div className="header-actions">
              <div className="h-stat">
                <span className="h-stat-label">Güncellendi</span>
                <span className="h-stat-value tabular">{saatStr} UTC</span>
              </div>
              <button className="h-action" onClick={data.yenile}>↻ Yenile</button>
              <button className="h-action">⤓ PDF İndir</button>
            </div>
          </div>

          {/* i. Strike Topografyası */}
          <section className="section">
            <div className="section-head">
              <h2 className="section-title">
                <span className="section-nbr">i.</span>Strike Topografyası
              </h2>
              <span className="section-meta">
                {data.strikes.length} KULLANIM · {data.stats.expiries} VADE · {vade === "all" ? "TÜMÜ" : vade.toUpperCase()}
              </span>
            </div>
            <div className="ladder-wrap">
              <StrikeMerdiveni data={data} />
              <SeviyePaneli data={data} />
            </div>
          </section>

          {/* ii. Kuantum Duvarlar */}
          <section className="section">
            <div className="section-head">
              <h2 className="section-title">
                <span className="section-nbr">ii.</span>Kuantum Duvarlar
              </h2>
              <span className="section-meta">
                {data.classified.filter(c => c.wallType === "callWall").length} ALIM DUVARI ·{" "}
                {data.classified.filter(c => c.wallType === "putWall").length} SATIM DUVARI ·{" "}
                {data.classified.filter(c => c.wallType === "magnet").length} MIKNATIK
              </span>
            </div>
            <KuantumDuvarlar data={data} />
          </section>

          {/* iii. Toplu Greek'ler */}
          <section className="section">
            <div className="section-head">
              <h2 className="section-title">
                <span className="section-nbr">iii.</span>Toplu Greek'ler
              </h2>
              <span className="section-meta">DEALER-NORMALIZE · USD CİNSİNDEN</span>
            </div>
            <TopluGreekler data={data} />
          </section>

          {/* iv. Volatilite Yüzeyi */}
          <section className="section">
            <div className="section-head">
              <h2 className="section-title">
                <span className="section-nbr">iv.</span>Volatilite Yüzeyi
              </h2>
              <span className="section-meta">VADE YAPISI · ÇARPIKLIK</span>
            </div>
            <div className="term-card">
              <div>
                <div className="sheet-label" style={{ marginBottom: 12 }}>ATM Vade Yapısı</div>
                <VadeYapisi data={data} />
                <p style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-dim)", marginTop: 8, lineHeight: 1.55 }}>
                  {data.volSurface?.termStructure?.length > 0
                    ? `Eğri ${data.volSurface.termStructure.length} vadeden hesaplandı. Kısa uç ~${data.dvol.toFixed(0)}% seviyesinde.`
                    : "Vade yapısı log-moneyness interpolasyonuyla hesaplanıyor..."
                  }
                </p>
              </div>
              <div>
                <div className="sheet-label" style={{ marginBottom: 12 }}>Risk-Reversal Çarpıklığı</div>
                <CarpiklıkGraf data={data} />
                <p style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-dim)", marginTop: 8, lineHeight: 1.55 }}>
                  {data.volSurface?.riskReversals?.length > 0
                    ? `${data.volSurface.riskReversals.length} vade için hesaplandı. RR = IV(25Δ put) − IV(25Δ call)`
                    : "25Δ risk-reversal hesaplanıyor..."
                  }
                </p>
              </div>
            </div>
          </section>

          {/* v. Pozisyon Analizi */}
          <section className="section">
            <div className="section-head">
              <h2 className="section-title">
                <span className="section-nbr">v.</span>Pozisyon · Analiz
              </h2>
              <span className="section-meta">DEALER AKIŞI · MASA NOTLARI</span>
            </div>
            <div className="two-up">
              <div>
                <p className="pull" style={{ marginBottom: 24 }}>
                  Satım duvarı ile alım duvarı arasındaki <em>${fmt(aw - sw)}</em> bantı,
                  gerçekleşen oynaklığı sınırlar — tepe noktadan dibe <em>{((aw - sw) / sp * 100).toFixed(1)}%</em>.
                </p>
                <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-2)", lineHeight: 1.7, margin: 0 }}>
                  Piyasa yapıcılar bu haftaya {pozitif ? "net uzun" : "net kısa"} {fmtB(data.totals.gamma)}$ gamma ile giriyor,{" "}
                  <b style={{ color: "var(--text)" }}>{fmt(data.levels.callWall)}</b> alım duvarında yoğunlaşmış.
                  Bu yapısal bir <b style={{ color: "var(--text)" }}>ortalamaya-dönüş</b> eğilimi yaratır —
                  keskin hareketler, vade sonuna kadar hedge akışıyla törpülenir.
                </p>
              </div>
              <div>
                <div className="sheet-label" style={{ marginBottom: 14 }}>Senaryolar</div>
                {[
                  { etiket: "Spot yukarı kırar ↑", hedef: data.levels.callWall, not: "dealerlar delta satmaya başlar" },
                  { etiket: "Spot sabitlenir",      hedef: data.levels.maxPain,  not: "volatilite vadeye kadar düşer" },
                  { etiket: "Spot aşağı kırar ↓",  hedef: data.levels.putWall,  not: "gamma negatife döner, vol genişler" },
                  { etiket: "Haftalık kapanış",     hedef: data.levels.maxPain,  not: "maks. acı mıknatısı" },
                ].map(s => (
                  <div key={s.etiket} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 16, padding: "12px 0", borderBottom: "1px solid var(--hairline-soft)", fontFamily: "var(--mono)", fontSize: 11 }}>
                    <div>
                      <div style={{ color: "var(--text)", fontSize: 12, marginBottom: 2 }}>{s.etiket}</div>
                      <div style={{ color: "var(--text-mute)", fontSize: 10 }}>{s.not}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div className="tabular" style={{ color: "var(--accent)", fontSize: 14, fontFamily: "var(--serif)" }}>${fmt(s.hedef)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Alt Bilgi */}
          <footer className="footer">
            <div>
              <div style={{ marginBottom: 4 }}>Opsiyon Masası · Deribit Günlük Özet</div>
              <div style={{ color: "var(--text-dim)" }}>
                {new Date().toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                {" · "}{data.stats.rows} kontrat · {data.stats.expiries} vade
              </div>
            </div>
            <div className="footer-pagenum">— 01 / 01 —</div>
          </footer>
        </main>
      </div>
    </>
  );
}
