function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Matches the blog's design system:
//   font: Atkinson (loaded from /fonts/ on the blog host)
//   --accent:     #2337ff
//   --black:      rgb(15,  18,  25)
//   --gray:       rgb(96,  115, 159)
//   --gray-light: rgb(229, 233, 240)
//   --gray-dark:  rgb(34,  41,  57)
const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

@page { size: letter; margin: 0.75in; }

@font-face {
  font-family: "Atkinson";
  src: url("/fonts/atkinson-regular.woff") format("woff");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Atkinson";
  src: url("/fonts/atkinson-bold.woff") format("woff");
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}

body {
  font-family: "Atkinson", system-ui, -apple-system, sans-serif;
  background: #fff;
  color: rgb(34, 41, 57);
  font-size: 18px;
  line-height: 1.7;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

.wrapper {
  max-width: 720px;
  margin: 0 auto;
  padding: 3em 2em;
}

/* ── Header ── */
.nl-header {
  padding-bottom: 2em;
  margin-bottom: 2em;
  border-bottom: 1px solid rgb(229, 233, 240);
}
.eyebrow {
  font-size: 0.72em;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgb(96, 115, 159);
  margin-bottom: 0.6em;
}
.nl-title {
  font-size: 2.2em;
  font-weight: 700;
  line-height: 1.15;
  color: rgb(15, 18, 25);
  margin-bottom: 0.4em;
}
.dateline {
  font-size: 0.8em;
  color: rgb(96, 115, 159);
}

/* ── Intro ── */
.nl-intro {
  margin-bottom: 0;
  font-size: 1.02em;
  line-height: 1.75;
}
.nl-intro p { margin-bottom: 1em; }
.nl-intro p:last-child { margin-bottom: 0; }
.nl-intro a { color: #2337ff; }

/* ── Sections ── */
.nl-section {
  padding: 2.25em 0;
  border-top: 1px solid rgb(229, 233, 240);
  page-break-inside: avoid;
}
.section-num {
  font-size: 0.7em;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgb(96, 115, 159);
  margin-bottom: 0.4em;
}
.section-headline {
  font-size: 1.45em;
  font-weight: 700;
  line-height: 1.2;
  color: rgb(15, 18, 25);
  margin-bottom: 1.1em;
}
.section-body {
  font-size: 0.95em;
  line-height: 1.8;
}
.section-body p { margin-bottom: 1em; }
.section-body p:last-child { margin-bottom: 0; }
.section-body a { color: #2337ff; text-decoration: underline; text-underline-offset: 2px; }
.section-body strong { color: rgb(15, 18, 25); font-weight: 700; }
.section-body code {
  font-family: 'SFMono-Regular', Consolas, monospace;
  font-size: 0.88em;
  background: rgb(229, 233, 240);
  border-radius: 2px;
  padding: 0.12em 0.4em;
}
.section-body ul, .section-body ol { margin: 0.75em 0 1em 1.5em; }
.section-body li { margin-bottom: 0.4em; line-height: 1.65; }

/* ── Further reading ── */
.further-reading {
  margin-top: 1.5em;
  padding: 0 0 0 1.1em;
  border-left: 4px solid #2337ff;
}
.further-reading h4 {
  font-size: 0.68em;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgb(96, 115, 159);
  margin-bottom: 0.5em;
}
.further-reading ul { list-style: none; display: flex; flex-direction: column; gap: 0.3em; }
.further-reading li { font-size: 0.85em; }
.further-reading a { color: #2337ff; text-decoration: none; }
.further-reading a:hover { text-decoration: underline; }
.further-reading .link-date { color: rgb(96, 115, 159); font-size: 0.88em; }

/* ── Closing ── */
.nl-closing {
  padding-top: 2em;
  margin-top: 0;
  border-top: 1px solid rgb(229, 233, 240);
  font-size: 0.92em;
  line-height: 1.75;
  color: rgb(96, 115, 159);
  font-style: italic;
}
.nl-closing p { margin-bottom: 0.75em; }
.nl-closing p:last-child { margin-bottom: 0; }

/* ── Print ── */
@media print {
  .wrapper { padding: 0; }
  .nl-section { page-break-inside: avoid; }
}
`;

export function renderNewsletterHTML(newsletter) {
  const date = newsletter.generatedAt
    ? new Date(newsletter.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const sectionsHtml = (newsletter.sections || []).map((s, i) => `
  <div class="nl-section">
    <div class="section-num">${String(i + 1).padStart(2, '0')}</div>
    <h2 class="section-headline">${esc(s.headline)}</h2>
    <div class="section-body">${s.body || ''}</div>
    ${s.key_links?.length ? `
    <div class="further-reading">
      <h4>Further Reading</h4>
      <ul>${s.key_links.map(l => `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.text)}</a>${l.published_date ? `<span class="link-date"> — ${esc(l.published_date)}</span>` : ''}</li>`).join('')}</ul>
    </div>` : ''}
  </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(newsletter.title || 'Newsletter')}</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🤖</text></svg>">
  <style>${CSS}</style>
</head>
<body>
  <div class="wrapper">
    <header class="nl-header">
      <div class="eyebrow">Newsletter</div>
      <h1 class="nl-title">${esc(newsletter.title || 'Newsletter')}</h1>
      <div class="dateline">${date}</div>
    </header>
    <div class="nl-intro">${newsletter.intro || ''}</div>
    ${sectionsHtml}
    ${newsletter.closing ? `<div class="nl-closing">${newsletter.closing}</div>` : ''}
  </div>
</body>
</html>`;
}
