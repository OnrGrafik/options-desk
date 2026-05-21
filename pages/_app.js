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

  /* ── Reset ── */
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: var(--sans);
    font-size: 13px;          /* base body */
    font-weight: 400;
    font-feature-settings: "ss01","cv11";
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  .mono  { font-family: var(--mono); font-feature-settings: "ss01","zero"; }
  .serif { font-family: var(--serif); font-weight: 400; }
  .tabular { font-variant-numeric: tabular-nums; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-thumb { background: var(--hairline-strong); border-radius: 3px; }

  /* ── App shell ── */
  .app { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }

  /* ═══════════════════════════════════════════════════════
     SIDEBAR
     Spec: sans-serif 12-13px, Regular/Medium (400-500)
  ═══════════════════════════════════════════════════════ */
  .sidebar {
    background: var(--surface);
    border-right: 1px solid var(--hairline);
    padding: 20px 18px 24px;
    display: flex;
    flex-direction: column;
    gap: 22px;
    position: sticky;
    top: 0;
    height: 100vh;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .brand { display: flex; align-items: baseline; gap: 10px; padding-bottom: 4px; }
  .brand-mark {
    font-family: var(--serif);
    font-size: 26px;
    font-weight: 400;
    color: var(--accent);
    line-height: 1;
  }
  /* Brand name — kategori başlığı spec: uppercase 10-11px 500-600 */
  .brand-name {
    font-family: var(--sans);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-2);
  }
  .brand-sub {
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 400;
    color: var(--text-mute);
    margin-top: 2px;
    letter-spacing: 0.04em;
  }
  .sb-section { display: flex; flex-direction: column; gap: 8px; }

  /* Sidebar section labels — kategori başlığı: uppercase 10px 600 */
  .sb-label {
    font-family: var(--sans);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-mute);
    padding-bottom: 6px;
    border-bottom: 1px solid var(--hairline);
  }

  /* Sidebar items — sol menü elemanları: 12-13px 400-500 */
  .sb-item {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 5px 0;
    font-family: var(--sans);
    font-size: 12px;
    font-weight: 400;
    color: var(--text-2);
    cursor: pointer;
    border-bottom: 1px solid var(--hairline-soft);
    transition: color 0.15s;
  }
  .sb-item:hover { color: var(--text); font-weight: 500; }
  .sb-item.active { color: var(--text); font-weight: 500; }
  .sb-item.active .sb-item-key::before { content: "▸ "; color: var(--accent); }
  .sb-item-key { letter-spacing: 0.03em; }
  .sb-item-val {
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 500;
    color: var(--text-dim);
  }
  .sb-item-val.pos, .pos { color: var(--pos) !important; }
  .sb-item-val.neg, .neg { color: var(--neg) !important; }

  .sb-chip-row { display: flex; flex-wrap: wrap; gap: 4px; }
  .sb-chip {
    padding: 3px 9px;
    background: var(--surface-2);
    border: 1px solid var(--hairline);
    color: var(--text-dim);
    font-family: var(--sans);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    letter-spacing: 0.03em;
    transition: all 0.15s;
  }
  .sb-chip:hover { color: var(--text); border-color: var(--hairline-strong); }
  .sb-chip.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #0c0c0d;
    font-weight: 700;
  }

  /* ── Main ── */
  .main { padding: 0; display: flex; flex-direction: column; min-width: 0; }

  /* ── Header ── */
  .header {
    padding: 14px 36px;
    border-bottom: 1px solid var(--hairline);
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-family: var(--sans);
    font-size: 12px;
    font-weight: 400;
    color: var(--text-dim);
  }
  .header-trail { display: flex; gap: 8px; align-items: center; }
  .header-trail .crumb { color: var(--text-dim); }
  .header-trail .sep  { color: var(--text-mute); }
  .header-trail .crumb.active { color: var(--text); font-weight: 500; }
  .header-actions { display: flex; gap: 14px; align-items: center; }
  .h-stat { display: flex; gap: 5px; align-items: baseline; }
  /* Header stat label — küçük kategori: uppercase 10px 600 */
  .h-stat-label {
    font-family: var(--sans);
    font-size: 10px;
    font-weight: 600;
    color: var(--text-mute);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .h-stat-value {
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 500;
    color: var(--text);
  }
  .h-action {
    background: none;
    border: 1px solid var(--hairline-strong);
    color: var(--text-2);
    padding: 4px 11px;
    font-family: var(--sans);
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: all 0.15s;
  }
  .h-action:hover { background: var(--surface-2); color: var(--text); }

  /* ═══════════════════════════════════════════════════════
     SECTION
     Spec: başlıklar 18-20px bold 700 / kategori 10-11px 500-600
  ═══════════════════════════════════════════════════════ */
  .section { padding: 36px 36px 28px; border-bottom: 1px solid var(--hairline); }
  .section-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 24px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--hairline-soft);
  }
  /* Ana başlık: serif 20px 400 (serif'te geometrik hissi sağlar) */
  .section-title {
    font-family: var(--serif);
    font-size: 20px;
    font-weight: 400;
    line-height: 1;
    color: var(--text);
    letter-spacing: -0.01em;
  }
  /* Küçük kategori meta: uppercase 10px 600 */
  .section-meta {
    font-family: var(--sans);
    font-size: 10px;
    font-weight: 600;
    color: var(--text-dim);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .section-nbr {
    font-family: var(--serif);
    color: var(--accent);
    font-style: italic;
    margin-right: 10px;
  }

  /* ═══════════════════════════════════════════════════════
     LADDER (Strike Topography tablosu — genişletildi)
     Spec: grafik içi değerler 11px bold 700 (uppercase label'lar)
           grafik açıklamaları 10px bold 700
  ═══════════════════════════════════════════════════════ */
  /* Tabloya tam genişlik — %100 kullan, oranı korunacak şekilde */
  .ladder-wrap {
    display: grid;
    grid-template-columns: 1.75fr 1fr;
    gap: 40px;
    width: 100%;
  }
  .ladder {
    display: flex;
    flex-direction: column;
    font-family: var(--sans);
    font-size: 12px;
    width: 100%;
  }
  /* Grafik içi başlık satırı — uppercase 10px 700 (bold) */
  .ladder-header {
    display: grid;
    grid-template-columns: 44px 56px 1fr 88px 1fr 72px 60px;
    align-items: center;
    padding: 7px 0;
    border-bottom: 1px solid var(--hairline);
    color: var(--text-mute);
    font-family: var(--sans);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.10em;
    text-transform: uppercase;
  }
  .ladder-header > div:nth-child(3) { text-align: right; padding-right: 14px; }
  .ladder-header > div:nth-child(5) { text-align: left; padding-left: 14px; }

  .ladder-row {
    display: grid;
    grid-template-columns: 44px 56px 1fr 88px 1fr 72px 60px;
    align-items: center;
    padding: 5px 0;
    border-bottom: 1px solid var(--hairline-soft);
    color: var(--text-2);
    transition: background 0.1s;
    cursor: crosshair;
  }
  .ladder-row:hover { background: var(--surface-2); }
  .ladder-row.spot {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    border-top: 1px solid var(--accent);
    border-bottom: 1px solid var(--accent);
    color: var(--text);
    position: relative;
  }
  .ladder-row.spot::after {
    content: "SPOT";
    position: absolute;
    right: -52px;
    top: 50%;
    transform: translateY(-50%);
    font-family: var(--sans);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.14em;
    color: var(--accent);
  }
  /* Tag: uppercase 10px 700 */
  .ladder-row .tag {
    font-family: var(--sans);
    font-size: 10px;
    font-weight: 700;
    color: var(--text-mute);
    letter-spacing: 0.05em;
    text-align: center;
  }
  .ladder-row .tag.cw { color: var(--pos); }
  .ladder-row .tag.pw { color: var(--neg); }
  .ladder-row .tag.mp { color: var(--accent); }
  .ladder-row .tag.zg { color: var(--neutral); }
  /* Dist: 10px 500 */
  .ladder-row .dist {
    font-family: var(--sans);
    font-size: 10px;
    font-weight: 500;
    color: var(--text-dim);
    text-align: right;
  }
  .ladder-row .dist.pos { color: color-mix(in srgb, var(--pos) 80%, var(--text-dim)); }
  .ladder-row .dist.neg { color: color-mix(in srgb, var(--neg) 80%, var(--text-dim)); }
  /* Strike değeri: ana gösterge boyutu 13px 700 */
  .ladder-row .strike-cell {
    font-family: var(--sans);
    font-size: 13px;
    font-weight: 700;
    color: var(--text);
    text-align: right;
    padding-right: 16px;
    letter-spacing: -0.01em;
  }
  /* Net gamma: grafik özet değeri 11px 700 */
  .ladder-row .net {
    font-family: var(--sans);
    font-size: 11px;
    font-weight: 700;
    text-align: center;
    color: var(--text-dim);
  }
  .ladder-row.spot .net { color: var(--accent); }

  .bar-cell { height: 16px; position: relative; display: flex; align-items: center; }
  .bar-cell.put { justify-content: flex-end; padding-right: 14px; }
  .bar-cell.call { justify-content: flex-start; padding-left: 14px; }
  .bar { height: 9px; background: var(--neutral); opacity: 0.85; border-radius: 1px; }
  .bar.call { background: var(--pos); }
  .bar.put  { background: var(--neg); }

  /* ═══════════════════════════════════════════════════════
     SHEET (Key Levels)
     Spec: label uppercase 10px 600, değerler 13px 700
  ═══════════════════════════════════════════════════════ */
  .sheet { display: flex; flex-direction: column; gap: 28px; }
  .sheet-block { border-top: 1px solid var(--hairline); padding-top: 18px; }
  /* Sheet label — küçük kategori: uppercase 10px 600 */
  .sheet-label {
    font-family: var(--sans);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-mute);
    margin-bottom: 10px;
  }
  .levels-list { display: flex; flex-direction: column; }
  .level-row {
    display: grid;
    grid-template-columns: 12px 1fr auto auto;
    gap: 12px;
    align-items: baseline;
    padding: 11px 0;
    border-bottom: 1px solid var(--hairline-soft);
    font-family: var(--sans);
  }
  .level-row:last-child { border-bottom: none; }
  .level-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
  /* Level name: 12px 500 */
  .level-name { font-size: 12px; font-weight: 500; color: var(--text); }
  /* Level sub: 10px 400 */
  .level-sub  { font-size: 10px; font-weight: 400; color: var(--text-mute); margin-left: 5px; letter-spacing: 0.03em; }
  /* Level value: ana gösterge 13px 700 */
  .level-value { font-size: 13px; font-weight: 700; color: var(--text); font-family: var(--mono); }
  /* Level delta: 11px 700 */
  .level-delta { font-size: 11px; font-weight: 700; color: var(--text-dim); min-width: 56px; text-align: right; }
  .level-delta.pos { color: var(--pos); }
  .level-delta.neg { color: var(--neg); }

  /* ═══════════════════════════════════════════════════════
     AGGREGATE GREEKS
     Spec: glyph serif, label uppercase 10px 600, num 38px, foot 10px 700
  ═══════════════════════════════════════════════════════ */
  .greeks-stack { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0; }
  .greek-cell { padding: 24px 32px 24px 0; border-right: 1px solid var(--hairline); }
  .greek-cell:last-child { border-right: none; padding-right: 0; }
  .greek-glyph {
    font-family: var(--serif);
    font-style: italic;
    font-size: 24px;
    color: var(--accent);
    margin-bottom: 6px;
    line-height: 1;
  }
  /* Greek label — küçük kategori: uppercase 10px 600 */
  .greek-label {
    font-family: var(--sans);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-mute);
    margin-bottom: 12px;
  }
  /* Greek num — ana gösterge: serif 38px */
  .greek-num {
    font-family: var(--serif);
    font-size: 38px;
    line-height: 1;
    color: var(--text);
    margin-bottom: 8px;
    letter-spacing: -0.02em;
  }
  /* Greek footnote — grafik küçük açıklama: 10px 700 */
  .greek-foot {
    font-family: var(--sans);
    font-size: 10px;
    font-weight: 700;
    color: var(--text-dim);
    line-height: 1.55;
  }

  /* ═══════════════════════════════════════════════════════
     VOLATILITY SURFACE
  ═══════════════════════════════════════════════════════ */
  .term-card { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; }
  .term-svg { width: 100%; height: auto; }

  /* ═══════════════════════════════════════════════════════
     POSITIONING · READ
  ═══════════════════════════════════════════════════════ */
  /* Pull quote: serif 24px */
  .pull {
    font-family: var(--serif);
    font-size: 24px;
    line-height: 1.35;
    color: var(--text-2);
    max-width: 64ch;
    margin: 0;
    text-wrap: balance;
  }
  .pull em { font-style: italic; color: var(--accent); }
  .two-up { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; }

  /* ── Footer ── */
  .footer {
    padding: 36px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    font-family: var(--sans);
    font-size: 10px;
    font-weight: 400;
    color: var(--text-mute);
    letter-spacing: 0.05em;
  }
  .footer-pagenum {
    font-family: var(--serif);
    font-style: italic;
    color: var(--accent);
    font-size: 16px;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
`;

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <title>Options Desk · BTC</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@300;400;500;600&display=swap" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </Head>
      <Component {...pageProps} />
    </>
  );
}
