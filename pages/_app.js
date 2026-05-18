import Head from "next/head";
import { useState, createContext, useContext } from "react";

export const FontCtx = createContext({ size: 0, setSize: () => {} });

export default function App({ Component, pageProps }) {
  const [fontSize, setFontSize] = useState(0); // 0 = default, 1 = +1pt

  const CSS = `
  :root {
    --bg: #0c0c0d;
    --surface: #131316;
    --surface-2: #1a1a1e;
    --surface-3: #232328;
    --hairline: #1e2025;
    --hairline-soft: #181a1e;
    --hairline-strong: #36363c;
    --text: #e8e6e0;
    --text-2: #b8b5ac;
    --text-dim: #7a7771;
    --text-mute: #4a4742;
    --accent: #c4a574;
    --pos: #6b9e7d;
    --neg: #b5564c;
    --neutral: #5a6776;
    --call: #22c55e;
    --put: #ef4444;
    --zero-gamma: #06b6d4;
    --max-pain: #f97316;
    --em: #818cf8;
    --spot: #FFD700;
    --magnet: #a855f7;
    --font-base: ${12 + fontSize}px;
    --font-sm: ${10 + fontSize}px;
    --font-xs: ${9 + fontSize}px;
    --font-lg: ${14 + fontSize}px;
    --font-xl: ${16 + fontSize}px;
    --serif: "Instrument Serif", Georgia, serif;
    --sans: "Manrope", -apple-system, system-ui, sans-serif;
    --mono: "JetBrains Mono", ui-monospace, monospace;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: var(--bg); color: var(--text); font-family: var(--sans); font-size: var(--font-base); font-weight: 400; -webkit-font-smoothing: antialiased; }
  .mono { font-family: var(--mono); }
  .serif { font-family: var(--serif); }
  .tabular { font-variant-numeric: tabular-nums; }
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-thumb { background: var(--hairline-strong); border-radius: 3px; }

  /* App shell */
  .app { display: grid; grid-template-columns: 210px 1fr; min-height: 100vh; }

  /* Sidebar */
  .sidebar { background: var(--surface); border-right: 1px solid var(--hairline); padding: 20px 16px; display: flex; flex-direction: column; gap: 20px; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
  .brand { display: flex; align-items: baseline; gap: 8px; }
  .brand-mark { font-family: var(--serif); font-size: 22px; color: var(--accent); line-height: 1; }
  .brand-name { font-size: var(--font-xs); font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-2); }
  .brand-sub { font-size: var(--font-xs); color: var(--text-mute); font-family: var(--mono); margin-top: 1px; }
  .sb-section { display: flex; flex-direction: column; gap: 4px; }
  .sb-label { font-size: var(--font-xs); letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-mute); font-weight: 600; padding-bottom: 5px; border-bottom: 1px solid var(--hairline); margin-bottom: 2px; }
  .sb-item { display: flex; justify-content: space-between; align-items: baseline; padding: 4px 0; font-family: var(--mono); font-size: var(--font-xs); color: var(--text-2); border-bottom: 1px solid var(--hairline-soft); }
  .sb-item.active .sb-item-key::before { content: "▸ "; color: var(--accent); }
  .sb-chip-row { display: flex; flex-wrap: wrap; gap: 3px; }
  .sb-chip { padding: 2px 7px; background: var(--surface-2); border: 1px solid var(--hairline); color: var(--text-dim); font-family: var(--mono); font-size: var(--font-xs); cursor: pointer; transition: all 0.12s; }
  .sb-chip:hover { color: var(--text); border-color: var(--hairline-strong); }
  .sb-chip.active { background: var(--accent); border-color: var(--accent); color: #0c0c0d; font-weight: 600; }
  .pos { color: var(--pos) !important; }
  .neg { color: var(--neg) !important; }

  /* Main */
  .main { display: flex; flex-direction: column; min-width: 0; }

  /* Header */
  .topbar { padding: 10px 28px; border-bottom: 1px solid var(--hairline); display: flex; justify-content: space-between; align-items: center; font-family: var(--mono); font-size: var(--font-xs); color: var(--text-dim); gap: 12px; flex-wrap: wrap; }
  .topbar-left { display: flex; gap: 10px; align-items: center; }
  .topbar-right { display: flex; gap: 12px; align-items: center; }
  .h-stat { display: flex; gap: 4px; align-items: baseline; }
  .h-stat-label { color: var(--text-mute); letter-spacing: 0.06em; text-transform: uppercase; font-size: var(--font-xs); }
  .h-stat-value { color: var(--text); font-family: var(--mono); font-size: var(--font-sm); }
  .h-btn { background: none; border: 1px solid var(--hairline-strong); color: var(--text-2); padding: 3px 8px; font-family: var(--mono); font-size: var(--font-xs); letter-spacing: 0.05em; cursor: pointer; transition: all 0.12s; }
  .h-btn:hover { background: var(--surface-2); color: var(--text); }
  .h-btn.active { background: var(--accent); border-color: var(--accent); color: #0c0c0d; }

  /* Hero */
  .hero { padding: 32px 28px; border-bottom: 1px solid var(--hairline); display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px; }
  .hero-price-block { display: flex; flex-direction: column; gap: 6px; }
  .hero-kicker { font-family: var(--mono); font-size: var(--font-xs); color: var(--text-dim); letter-spacing: 0.06em; }
  .hero-price { font-family: var(--serif); font-size: 64px; font-weight: 400; line-height: 0.95; color: var(--text); display: flex; align-items: baseline; gap: 6px; white-space: nowrap; }
  .hero-price .currency { font-family: var(--mono); font-size: var(--font-sm); color: var(--text-mute); align-self: flex-end; margin-bottom: 8px; }
  .hero-meta { display: flex; gap: 12px; align-items: center; margin-top: 8px; flex-wrap: wrap; }
  .change-pill { font-family: var(--mono); font-size: var(--font-sm); padding: 2px 7px; border: 1px solid; }
  .change-pill.up { color: var(--pos); border-color: color-mix(in srgb, var(--pos) 35%, transparent); background: color-mix(in srgb, var(--pos) 8%, transparent); }
  .change-pill.dn { color: var(--neg); border-color: color-mix(in srgb, var(--neg) 35%, transparent); background: color-mix(in srgb, var(--neg) 8%, transparent); }
  .hero-regime { display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--hairline); padding: 14px 16px; background: var(--surface); }
  .regime-label { font-size: var(--font-xs); letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-mute); font-weight: 600; }
  .regime-state { font-family: var(--mono); font-size: var(--font-sm); letter-spacing: 0.08em; }
  .regime-val { font-family: var(--serif); font-size: 28px; line-height: 1; color: var(--text); }
  .gamma-bar { height: 3px; background: linear-gradient(90deg, var(--neg) 0%, var(--neutral) 50%, var(--pos) 100%); position: relative; opacity: 0.6; }
  .gamma-ptr { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--accent); }
  .hero-em { display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--hairline); padding: 14px 16px; background: var(--surface); }
  .em-row { display: flex; justify-content: space-between; align-items: baseline; font-family: var(--mono); }

  /* Tabs */
  .tabs-row { display: flex; gap: 0; border-bottom: 1px solid var(--hairline); padding: 0 28px; align-items: center; }
  .tab { padding: 8px 16px; font-family: var(--mono); font-size: var(--font-xs); color: var(--text-dim); background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; letter-spacing: 0.04em; transition: all 0.12s; white-space: nowrap; }
  .tab:hover { color: var(--text); }
  .tab.active { color: var(--text); border-bottom-color: var(--accent); }
  .tabs-spacer { flex: 1; }
  .expiry-btns { display: flex; gap: 3px; padding: 6px 0; }
  .expiry-btn { padding: 2px 7px; font-family: var(--mono); font-size: var(--font-xs); color: var(--text-dim); background: var(--surface-2); border: 1px solid var(--hairline); cursor: pointer; transition: all 0.12s; }
  .expiry-btn.active { background: var(--surface-3); color: var(--text); border-color: var(--hairline-strong); }

  /* Chart card */
  .chart-card { padding: 0; position: relative; }
  .chart-header { padding: 12px 28px 0; display: flex; justify-content: space-between; align-items: baseline; }
  .chart-title { font-size: var(--font-base); font-weight: 600; color: var(--text); }
  .chart-sub { font-family: var(--mono); font-size: var(--font-xs); color: var(--text-mute); margin-top: 2px; }

  /* Level lines */
  .axis-label { font-family: var(--mono); font-size: 10px; }

  /* Tooltip */
  .gex-tooltip { position: fixed; background: #0f172aee; border: 1px solid var(--hairline-strong); border-radius: 6px; padding: 10px 13px; font-family: var(--mono); font-size: var(--font-xs); pointer-events: none; z-index: 9999; min-width: 200px; backdrop-filter: blur(8px); }
  .tt-head { color: var(--spot); font-weight: bold; font-size: var(--font-sm); margin-bottom: 6px; }
  .tt-row { display: flex; justify-content: space-between; gap: 12px; color: var(--text-2); line-height: 1.6; }
  .tt-val { color: var(--text); font-weight: 600; }

  /* Quantum Walls */
  .quantum-wrap { padding: 16px 28px 24px; }
  .quantum-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; }
  .quantum-title { font-family: var(--serif); font-style: italic; font-size: 20px; color: var(--text); }
  .quantum-meta { font-family: var(--mono); font-size: var(--font-xs); color: var(--text-mute); }
  .quantum-body { display: grid; grid-template-columns: 1fr 280px; gap: 24px; }
  .quantum-legend { display: flex; gap: 12px; margin-bottom: 10px; font-family: var(--mono); font-size: var(--font-xs); }
  .q-leg { display: flex; align-items: center; gap: 5px; }
  .q-swatch { width: 10px; height: 10px; border-radius: 1px; }

  /* Wall sidebar */
  .wall-list { display: flex; flex-direction: column; gap: 1px; }
  .wall-item { display: grid; grid-template-columns: 16px 1fr auto; gap: 8px; align-items: baseline; padding: 8px 0; border-bottom: 1px solid var(--hairline-soft); font-family: var(--mono); }
  .wall-rank { font-size: var(--font-xs); color: var(--text-mute); }
  .wall-info { display: flex; flex-direction: column; gap: 1px; }
  .wall-price { font-size: var(--font-sm); color: var(--text); font-weight: 500; }
  .wall-type-tag { font-size: var(--font-xs); color: var(--text-mute); }
  .wall-gex { font-size: var(--font-xs); text-align: right; }

  /* Loading */
  .loading-wrap { min-height: 100vh; display: grid; place-items: center; background: var(--bg); }
  .spin { width: 32px; height: 32px; border: 1.5px solid var(--hairline-strong); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.9s linear infinite; margin: 0 auto 16px; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Footer */
  .footer { padding: 24px 28px; display: flex; justify-content: space-between; font-family: var(--mono); font-size: var(--font-xs); color: var(--text-mute); border-top: 1px solid var(--hairline); }
`;

  return (
    <>
      <Head>
        <title>BTC GEX — Options Desk</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@300;400;500;600;700&family=JetBrains+Mono:wght@300;400;500;600&display=swap" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </Head>
      <FontCtx.Provider value={{ size: fontSize, setSize: setFontSize }}>
        <Component {...pageProps} />
      </FontCtx.Provider>
    </>
  );
}
