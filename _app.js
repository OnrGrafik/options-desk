import Head from "next/head";

const GLOBAL_CSS = `
  :root {
    --bg: #0c0c0d;
    --surface: #131316;
    --surface-2: #1a1a1e;
    --surface-3: #232328;
    --hairline: #232328;
    --hairline-soft: #1a1a1e;
    --hairline-strong: #36363c;
    --text: #e8e6e0;
    --text-2: #b8b5ac;
    --text-dim: #7a7771;
    --text-mute: #4a4742;
    --accent: #c4a574;
    --accent-soft: #c4a57422;
    --pos: #6b9e7d;
    --neg: #b5564c;
    --neutral: #5a6776;
    --serif: "Instrument Serif", Georgia, serif;
    --sans: "Manrope", -apple-system, system-ui, sans-serif;
    --mono: "JetBrains Mono", ui-monospace, monospace;
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--sans);
    font-weight: 400;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  .mono { font-family: var(--mono); }
  .serif { font-family: var(--serif); }
  .tabular { font-variant-numeric: tabular-nums; }

  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-thumb { background: var(--hairline-strong); border-radius: 3px; }

  /* App shell */
  .app { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }

  /* Sidebar */
  .sidebar {
    background: var(--surface);
    border-right: 1px solid var(--hairline);
    padding: 24px 18px;
    display: flex;
    flex-direction: column;
    gap: 24px;
    position: sticky;
    top: 0;
    height: 100vh;
    overflow-y: auto;
  }
  .brand { display: flex; align-items: baseline; gap: 10px; padding-bottom: 4px; }
  .brand-mark { font-family: var(--serif); font-size: 24px; color: var(--accent); line-height: 1; }
  .brand-name { font-size: 9px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-2); }
  .brand-sub { font-size: 9px; color: var(--text-mute); font-family: var(--mono); margin-top: 2px; }

  .sb-section { display: flex; flex-direction: column; gap: 6px; }
  .sb-label { font-size: 9px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-mute); font-weight: 600; padding-bottom: 6px; border-bottom: 1px solid var(--hairline); }
  .sb-item { display: flex; justify-content: space-between; align-items: baseline; padding: 5px 0; font-family: var(--mono); font-size: 11px; color: var(--text-2); border-bottom: 1px solid var(--hairline-soft); cursor: pointer; }
  .sb-item:hover { color: var(--text); }
  .sb-item.active { color: var(--text); }
  .sb-item.active .sb-item-key::before { content: "▸ "; color: var(--accent); }
  .sb-item-val.pos { color: var(--pos); }
  .sb-item-val.neg { color: var(--neg); }
  .pos { color: var(--pos) !important; }
  .neg { color: var(--neg) !important; }

  .sb-chip-row { display: flex; flex-wrap: wrap; gap: 4px; }
  .sb-chip { padding: 3px 8px; background: var(--surface-2); border: 1px solid var(--hairline); color: var(--text-dim); font-family: var(--mono); font-size: 9px; cursor: pointer; letter-spacing: 0.04em; transition: all 0.15s; }
  .sb-chip:hover { color: var(--text); border-color: var(--hairline-strong); }
  .sb-chip.active { background: var(--accent); border-color: var(--accent); color: #0c0c0d; font-weight: 600; }

  /* Main */
  .main { display: flex; flex-direction: column; min-width: 0; }

  .header { padding: 14px 36px; border-bottom: 1px solid var(--hairline); display: flex; justify-content: space-between; align-items: center; font-family: var(--mono); font-size: 10px; color: var(--text-dim); }
  .header-trail { display: flex; gap: 6px; align-items: center; }
  .crumb { color: var(--text-dim); }
  .sep { color: var(--text-mute); }
  .crumb.active { color: var(--text); }
  .header-actions { display: flex; gap: 14px; align-items: center; }
  .h-stat { display: flex; gap: 5px; align-items: baseline; }
  .h-stat-label { color: var(--text-mute); letter-spacing: 0.06em; text-transform: uppercase; font-size: 8px; }
  .h-stat-value { color: var(--text); font-family: var(--mono); font-size: 11px; }
  .h-action { background: none; border: 1px solid var(--hairline-strong); color: var(--text-2); padding: 4px 10px; font-family: var(--mono); font-size: 9px; letter-spacing: 0.06em; cursor: pointer; transition: all 0.15s; }
  .h-action:hover { background: var(--surface-2); color: var(--text); }

  /* Hero */
  .hero { padding: 48px 36px 40px; border-bottom: 1px solid var(--hairline); display: grid; grid-template-columns: minmax(0,1.4fr) minmax(0,1fr); gap: 48px; align-items: start; }
  .hero-left { display: flex; flex-direction: column; gap: 0; min-width: 0; }
  .hero-kicker { display: flex; gap: 10px; align-items: baseline; font-family: var(--mono); font-size: 10px; color: var(--text-dim); letter-spacing: 0.06em; margin-bottom: 10px; }
  .hero-kicker .dot { color: var(--accent); }
  .hero-price { font-family: var(--serif); font-size: 76px; font-weight: 400; line-height: 0.95; letter-spacing: -0.03em; color: var(--text); display: flex; align-items: baseline; gap: 8px; white-space: nowrap; }
  .hero-price .currency { font-family: var(--mono); font-size: 13px; color: var(--text-mute); font-weight: 400; letter-spacing: 0.1em; align-self: flex-end; margin-bottom: 12px; }
  .hero-meta { display: flex; gap: 24px; align-items: center; margin-top: 16px; }
  .change-pill { font-family: var(--mono); font-size: 12px; padding: 3px 9px; border: 1px solid; color: var(--pos); border-color: color-mix(in srgb, var(--pos) 40%, transparent); background: color-mix(in srgb, var(--pos) 8%, transparent); }
  .change-pill.neg { color: var(--neg); border-color: color-mix(in srgb, var(--neg) 40%, transparent); background: color-mix(in srgb, var(--neg) 8%, transparent); }
  .session-note { font-family: var(--mono); font-size: 10px; color: var(--text-dim); }
  .session-note b { color: var(--text-2); font-weight: 500; }

  .hero-right { display: flex; flex-direction: column; gap: 16px; }
  .regime-panel { border: 1px solid var(--hairline); padding: 16px 18px; background: var(--surface); }
  .regime-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; }
  .regime-label { font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-mute); font-weight: 600; }
  .regime-state { font-family: var(--mono); font-size: 10px; letter-spacing: 0.08em; color: var(--pos); }
  .regime-state.neg { color: var(--neg); }
  .regime-value { font-family: var(--serif); font-size: 28px; line-height: 1; color: var(--text); margin-bottom: 12px; }
  .gamma-scale { height: 3px; background: linear-gradient(90deg, var(--neg) 0%, var(--text-mute) 50%, var(--pos) 100%); position: relative; margin-bottom: 6px; opacity: 0.5; }
  .gamma-pointer { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--accent); }
  .gamma-scale-labels { display: flex; justify-content: space-between; font-family: var(--mono); font-size: 9px; color: var(--text-mute); }

  .pull { font-family: var(--serif); font-size: 22px; line-height: 1.35; color: var(--text-2); max-width: 60ch; text-wrap: balance; }
  .pull em { font-style: italic; color: var(--accent); }

  /* Section */
  .section { padding: 36px 36px 28px; border-bottom: 1px solid var(--hairline); }
  .section-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 24px; padding-bottom: 12px; border-bottom: 1px solid var(--hairline-soft); }
  .section-title { font-family: var(--serif); font-size: 20px; font-weight: 400; line-height: 1; color: var(--text); }
  .section-meta { font-family: var(--mono); font-size: 9px; color: var(--text-dim); letter-spacing: 0.06em; }
  .section-nbr { font-family: var(--serif); color: var(--accent); font-style: italic; margin-right: 8px; }

  /* Ladder */
  .ladder-wrap { display: grid; grid-template-columns: 1.5fr 1fr; gap: 40px; }
  .ladder { display: flex; flex-direction: column; font-family: var(--mono); font-size: 10px; }
  .ladder-header { display: grid; grid-template-columns: 32px 52px 1fr 72px 1fr 60px 52px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--hairline); color: var(--text-mute); font-size: 8px; letter-spacing: 0.1em; text-transform: uppercase; font-weight: 600; }
  .ladder-header > div:nth-child(3) { text-align: right; padding-right: 12px; }
  .ladder-header > div:nth-child(5) { text-align: left; padding-left: 12px; }
  .ladder-row { display: grid; grid-template-columns: 32px 52px 1fr 72px 1fr 60px 52px; align-items: center; padding: 3px 0; border-bottom: 1px solid var(--hairline-soft); color: var(--text-2); transition: background 0.1s; cursor: crosshair; }
  .ladder-row:hover { background: var(--surface-2); }
  .ladder-row.spot { background: color-mix(in srgb, var(--accent) 8%, transparent); border-top: 1px solid var(--accent); border-bottom: 1px solid var(--accent); color: var(--text); }
  .tag { font-size: 8px; color: var(--text-mute); letter-spacing: 0.06em; text-align: center; }
  .tag.cw { color: var(--pos); }
  .tag.pw { color: var(--neg); }
  .tag.mp { color: var(--accent); }
  .tag.zg { color: var(--neutral); }
  .dist { font-size: 9px; color: var(--text-dim); text-align: right; }
  .strike-cell { font-size: 11px; color: var(--text); font-weight: 500; text-align: center; }
  .bar-cell { height: 12px; position: relative; display: flex; align-items: center; }
  .bar-cell.put { justify-content: flex-end; padding-right: 12px; }
  .bar-cell.call { justify-content: flex-start; padding-left: 12px; }
  .bar { height: 7px; background: var(--neutral); opacity: 0.85; }
  .bar.call { background: var(--pos); }
  .bar.put { background: var(--neg); }
  .net { font-size: 10px; text-align: center; color: var(--text-dim); }

  /* Sheet */
  .sheet { display: flex; flex-direction: column; gap: 24px; }
  .sheet-block { border-top: 1px solid var(--hairline); padding-top: 16px; }
  .sheet-label { font-size: 8px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-mute); font-weight: 600; margin-bottom: 8px; }
  .sheet-num { font-family: var(--serif); font-size: 36px; line-height: 1; color: var(--text); letter-spacing: -0.02em; margin-bottom: 6px; }
  .sheet-num.pos { color: var(--pos); }
  .sheet-num.neg { color: var(--neg); }
  .sheet-foot { font-family: var(--mono); font-size: 10px; color: var(--text-dim); display: flex; justify-content: space-between; }

  /* Levels */
  .levels-list { display: flex; flex-direction: column; }
  .level-row { display: grid; grid-template-columns: 12px 1fr auto auto; gap: 12px; align-items: baseline; padding: 12px 0; border-bottom: 1px solid var(--hairline-soft); font-family: var(--mono); }
  .level-row:last-child { border-bottom: none; }
  .level-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
  .level-name { font-size: 12px; color: var(--text); font-weight: 500; }
  .level-sub { font-size: 9px; color: var(--text-mute); margin-left: 6px; }
  .level-value { font-size: 13px; color: var(--text); font-weight: 500; }
  .level-delta { font-size: 10px; color: var(--text-dim); min-width: 52px; text-align: right; }
  .level-delta.pos { color: var(--pos); }
  .level-delta.neg { color: var(--neg); }

  /* Greeks */
  .greeks-stack { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0; }
  .greek-cell { padding: 20px 24px 20px 0; border-right: 1px solid var(--hairline); }
  .greek-cell:last-child { border-right: none; padding-right: 0; }
  .greek-glyph { font-family: var(--serif); font-style: italic; font-size: 22px; color: var(--accent); margin-bottom: 4px; }
  .greek-label { font-size: 8px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-mute); margin-bottom: 12px; font-weight: 600; }
  .greek-num { font-family: var(--serif); font-size: 32px; line-height: 1; color: var(--text); margin-bottom: 6px; letter-spacing: -0.02em; }
  .greek-foot { font-family: var(--mono); font-size: 9px; color: var(--text-dim); line-height: 1.5; }

  /* Term */
  .term-card { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
  .term-svg { width: 100%; height: auto; }

  /* Footer */
  .footer { padding: 36px; display: flex; justify-content: space-between; align-items: flex-end; font-family: var(--mono); font-size: 9px; color: var(--text-mute); letter-spacing: 0.06em; }
  .footer-pagenum { font-family: var(--serif); font-style: italic; color: var(--accent); font-size: 14px; }

  @keyframes spin { to { transform: rotate(360deg); } }
`;

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
