import Head from "next/head";

const CSS = `
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
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--sans); font-weight: 400; font-feature-settings: "ss01","cv11"; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
  .mono { font-family: var(--mono); font-feature-settings: "ss01","zero"; }
  .serif { font-family: var(--serif); font-weight: 400; }
  .tabular { font-variant-numeric: tabular-nums; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-thumb { background: var(--hairline-strong); border-radius: 3px; }

  /* APP */
  .app { display: grid; grid-template-columns: 232px 1fr; min-height: 100vh; }

  /* SIDEBAR */
  .sidebar { background: var(--surface); border-right: 1px solid var(--hairline); padding: 24px 20px; display: flex; flex-direction: column; gap: 28px; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
  .brand { display: flex; align-items: baseline; gap: 10px; padding-bottom: 4px; }
  .brand-mark { font-family: var(--serif); font-size: 26px; font-weight: 400; color: var(--accent); line-height: 1; letter-spacing: -0.01em; }
  .brand-name { font-size: 10px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-2); }
  .brand-sub { font-size: 9px; color: var(--text-mute); font-family: var(--mono); margin-top: 2px; letter-spacing: 0.04em; }
  .sb-section { display: flex; flex-direction: column; gap: 10px; }
  .sb-label { font-size: 9px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--text-mute); font-weight: 600; padding-bottom: 6px; border-bottom: 1px solid var(--hairline); }
  .sb-item { display: flex; justify-content: space-between; align-items: baseline; padding: 6px 0; font-family: var(--mono); font-size: 12px; color: var(--text-2); cursor: pointer; border-bottom: 1px solid var(--hairline-soft); transition: color 0.15s; }
  .sb-item:hover { color: var(--text); }
  .sb-item.active { color: var(--text); }
  .sb-item.active .sb-item-key::before { content: "▸ "; color: var(--accent); }
  .sb-item-key { letter-spacing: 0.04em; }
  .sb-item-val { font-size: 10px; color: var(--text-dim); }
  .sb-item-val.pos, .pos { color: var(--pos) !important; }
  .sb-item-val.neg, .neg { color: var(--neg) !important; }
  .sb-chip-row { display: flex; flex-wrap: wrap; gap: 4px; }
  .sb-chip { padding: 4px 9px; background: var(--surface-2); border: 1px solid var(--hairline); color: var(--text-dim); font-family: var(--mono); font-size: 10px; cursor: pointer; letter-spacing: 0.04em; transition: all 0.15s; }
  .sb-chip:hover { color: var(--text); border-color: var(--hairline-strong); }
  .sb-chip.active { background: var(--accent); border-color: var(--accent); color: #0c0c0d; font-weight: 600; }

  /* MAIN */
  .main { padding: 0; display: flex; flex-direction: column; min-width: 0; }

  /* HEADER */
  .header { padding: 16px 40px; border-bottom: 1px solid var(--hairline); display: flex; justify-content: space-between; align-items: center; font-family: var(--mono); font-size: 11px; color: var(--text-dim); }
  .header-trail { display: flex; gap: 8px; align-items: center; }
  .header-trail .crumb { color: var(--text-dim); }
  .header-trail .sep { color: var(--text-mute); }
  .header-trail .crumb.active { color: var(--text); }
  .header-actions { display: flex; gap: 16px; align-items: center; }
  .h-stat { display: flex; gap: 6px; align-items: baseline; }
  .h-stat-label { color: var(--text-mute); letter-spacing: 0.06em; text-transform: uppercase; font-size: 9px; }
  .h-stat-value { color: var(--text); }
  .h-action { background: none; border: 1px solid var(--hairline-strong); color: var(--text-2); padding: 5px 12px; font-family: var(--mono); font-size: 10px; letter-spacing: 0.06em; cursor: pointer; transition: all 0.15s; }
  .h-action:hover { background: var(--surface-2); color: var(--text); }

  /* SECTION */
  .section { padding: 40px 40px 32px; border-bottom: 1px solid var(--hairline); }
  .section-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 28px; padding-bottom: 14px; border-bottom: 1px solid var(--hairline-soft); }
  .section-title { font-family: var(--serif); font-size: 22px; font-weight: 400; line-height: 1; color: var(--text); letter-spacing: -0.01em; }
  .section-meta { font-family: var(--mono); font-size: 10px; color: var(--text-dim); letter-spacing: 0.06em; }
  .section-nbr { font-family: var(--serif); color: var(--accent); font-style: italic; margin-right: 10px; }

  /* LADDER */
  .ladder-wrap { display: grid; grid-template-columns: 1.6fr 1fr; gap: 48px; }
  .ladder { display: flex; flex-direction: column; font-family: var(--mono); font-size: 11px; }
  .ladder-header { display: grid; grid-template-columns: 50px 64px 1fr 80px 1fr 64px 56px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--hairline); color: var(--text-mute); font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; font-weight: 600; }
  .ladder-header > div:nth-child(3) { text-align: right; padding-right: 14px; }
  .ladder-header > div:nth-child(5) { text-align: left; padding-left: 14px; }
  .ladder-row { display: grid; grid-template-columns: 50px 64px 1fr 80px 1fr 64px 56px; align-items: center; padding: 4px 0; border-bottom: 1px solid var(--hairline-soft); color: var(--text-2); transition: background 0.1s; cursor: crosshair; }
  .ladder-row:hover { background: var(--surface-2); }
  .ladder-row.spot { background: color-mix(in srgb, var(--accent) 8%, transparent); border-top: 1px solid var(--accent); border-bottom: 1px solid var(--accent); color: var(--text); position: relative; }
  .ladder-row.spot::after { content: "SPOT"; position: absolute; right: -52px; top: 50%; transform: translateY(-50%); font-size: 9px; letter-spacing: 0.16em; color: var(--accent); font-weight: 600; }
  .ladder-row .tag { font-size: 9px; color: var(--text-mute); letter-spacing: 0.06em; text-align: center; }
  .ladder-row .tag.cw { color: var(--pos); }
  .ladder-row .tag.pw { color: var(--neg); }
  .ladder-row .tag.mp { color: var(--accent); }
  .ladder-row .tag.zg { color: var(--neutral); }
  .ladder-row .dist { font-size: 10px; color: var(--text-dim); text-align: right; }
  .ladder-row .dist.pos { color: color-mix(in srgb, var(--pos) 80%, var(--text-dim)); }
  .ladder-row .dist.neg { color: color-mix(in srgb, var(--neg) 80%, var(--text-dim)); }
  .ladder-row .strike-cell { font-size: 12px; color: var(--text); font-weight: 500; text-align: right; padding-right: 16px; }
  .ladder-row .net { font-size: 11px; text-align: center; color: var(--text-dim); }
  .ladder-row.spot .net { color: var(--accent); font-weight: 600; }
  .bar-cell { height: 14px; position: relative; display: flex; align-items: center; }
  .bar-cell.put { justify-content: flex-end; padding-right: 14px; }
  .bar-cell.call { justify-content: flex-start; padding-left: 14px; }
  .bar { height: 8px; background: var(--neutral); opacity: 0.85; }
  .bar.call { background: var(--pos); }
  .bar.put { background: var(--neg); }

  /* SHEET */
  .sheet { display: flex; flex-direction: column; gap: 32px; }
  .sheet-block { border-top: 1px solid var(--hairline); padding-top: 20px; }
  .sheet-label { font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-mute); font-weight: 600; margin-bottom: 10px; }
  .levels-list { display: flex; flex-direction: column; }
  .level-row { display: grid; grid-template-columns: 14px 1fr auto auto; gap: 14px; align-items: baseline; padding: 14px 0; border-bottom: 1px solid var(--hairline-soft); font-family: var(--mono); }
  .level-row:last-child { border-bottom: none; }
  .level-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  .level-name { font-size: 13px; color: var(--text); font-weight: 500; }
  .level-sub { font-size: 10px; color: var(--text-mute); margin-left: 6px; letter-spacing: 0.04em; }
  .level-value { font-size: 14px; color: var(--text); font-weight: 500; }
  .level-delta { font-size: 11px; color: var(--text-dim); min-width: 60px; text-align: right; }
  .level-delta.pos { color: var(--pos); }
  .level-delta.neg { color: var(--neg); }

  /* GREEKS */
  .greeks-stack { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0; }
  .greek-cell { padding: 24px 28px 24px 0; border-right: 1px solid var(--hairline); }
  .greek-cell:last-child { border-right: none; padding-right: 0; }
  .greek-glyph { font-family: var(--serif); font-style: italic; font-size: 24px; color: var(--accent); margin-bottom: 6px; line-height: 1; }
  .greek-label { font-size: 9px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--text-mute); margin-bottom: 14px; font-weight: 600; }
  .greek-num { font-family: var(--serif); font-size: 38px; line-height: 1; color: var(--text); margin-bottom: 6px; letter-spacing: -0.02em; }
  .greek-foot { font-family: var(--mono); font-size: 10px; color: var(--text-dim); text-wrap: pretty; }

  /* TERM */
  .term-card { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; }
  .term-svg { width: 100%; height: auto; }

  /* PULL QUOTE */
  .pull { font-family: var(--serif); font-size: 26px; line-height: 1.3; color: var(--text-2); max-width: 64ch; margin: 0; text-wrap: balance; }
  .pull em { font-style: italic; color: var(--accent); }
  .two-up { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; }

  /* FOOTER */
  .footer { padding: 40px; display: flex; justify-content: space-between; align-items: flex-end; font-family: var(--mono); font-size: 10px; color: var(--text-mute); letter-spacing: 0.06em; }
  .footer-pagenum { font-family: var(--serif); font-style: italic; color: var(--accent); font-size: 16px; }

  @keyframes spin { to { transform: rotate(360deg); } }
`;

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <title>OPTIONS DESK · BTC</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@200;300;400;500;600;700;800&family=JetBrains+Mono:wght@300;400;500;600&display=swap" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
