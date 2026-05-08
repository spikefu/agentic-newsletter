// CRC: crc-CrankHandle.md | R164
//
// Parse stencilled research-phase markdown into the newsletter object
// the renderer expects. The agent writes markdown — title, subtitle,
// intro paragraphs, sections with cluster id and body and key_links,
// a closing, and references — and the CLI converts to the HTML-string
// shape htmlRenderer.js consumes.
//
// Returns `{ result, errors }`. `errors` is a list of "line N: ..."
// strings — empty when the parse succeeds. Structural validation
// (required fields, section count, etc.) is the validateNewsletter()
// caller's job.

import fs from 'fs';
import path from 'path';

export function parseNewsletter(text) {
  const lines = text.split(/\r?\n/);
  const errors = [];
  const result = {
    title: '',
    subtitle: '',
    intro: '',
    sections: [],
    closing: '',
    references: '',
  };

  // Walk the lines once, building intermediate buffers per region. The
  // regions are: pre-title (skipped), header (title+subtitle+intro),
  // then named ## sections.
  let region = 'header';        // 'header' | 'section' | 'closing' | 'references'
  let introLines = [];
  let currentSection = null;
  let bodyLines = [];
  let keyLinks = null;          // null until **Key links:** is seen
  let closingLines = [];
  let refsLines = [];

  const err = (i, msg) => errors.push(`line ${i + 1}: ${msg}`);

  const flushSection = () => {
    if (!currentSection) return;
    currentSection.body = paragraphsToHtml(bodyLines);
    if (keyLinks) currentSection.key_links = keyLinks;
    result.sections.push(currentSection);
    currentSection = null;
    bodyLines = [];
    keyLinks = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();

    // # Title (only the first H1 counts)
    const hTitle = /^#\s+(?!#)(.+)$/.exec(line);
    if (hTitle && !result.title) {
      result.title = hTitle[1].trim();
      continue;
    }

    // ## Heading — section, closing, or references
    const hSection = /^##\s+(?!#)(.+)$/.exec(line);
    if (hSection) {
      // close prior region
      flushSection();
      const heading = hSection[1].trim();
      const lower = heading.toLowerCase();
      if (lower === 'closing') {
        region = 'closing';
      } else if (lower === 'references') {
        region = 'references';
      } else {
        region = 'section';
        currentSection = {
          cluster_id: '',
          headline: heading,
          body: '',
          key_links: [],
        };
      }
      continue;
    }

    // **Subtitle:** ...
    const mSubtitle = /^\*\*Subtitle:\*\*\s*(.*)$/i.exec(line);
    if (mSubtitle && region === 'header') {
      result.subtitle = mSubtitle[1].trim();
      continue;
    }

    // **Cluster:** id (only meaningful inside a section)
    const mCluster = /^\*\*Cluster:\*\*\s*(.*)$/i.exec(line);
    if (mCluster) {
      if (currentSection) currentSection.cluster_id = mCluster[1].trim();
      else err(i, 'cluster line outside any section');
      continue;
    }

    // **Key links:** marker — switches body collection to key-links mode
    const mKeyLinks = /^\*\*Key links:\*\*\s*(.*)$/i.exec(line);
    if (mKeyLinks) {
      if (!currentSection) {
        err(i, '"Key links:" found outside any section');
        continue;
      }
      keyLinks = [];
      const inline = mKeyLinks[1].trim();
      if (inline && !/^\(?none\)?$/i.test(inline)) keyLinks.push(linkToObject(inline));
      continue;
    }

    // Bullet under an active key-links collector
    const mBullet = /^-\s+(.+)$/.exec(line);
    if (mBullet && keyLinks) {
      const text = mBullet[1].trim();
      if (!/^\(?none\)?$/i.test(text)) keyLinks.push(linkToObject(text));
      continue;
    }
    // Bullet in references region
    if (mBullet && region === 'references') {
      refsLines.push(mBullet[1].trim());
      continue;
    }

    // Otherwise the line is paragraph content for the active region.
    switch (region) {
      case 'header':   introLines.push(line); break;
      case 'section':  if (currentSection && !keyLinks) bodyLines.push(line); break;
      case 'closing':  closingLines.push(line); break;
      case 'references':
        // Plain prose in the references section is unusual but harmless;
        // append to refsLines so it's not silently discarded.
        if (line.trim() !== '') refsLines.push(line.trim());
        break;
    }
  }

  // Final flush + assemble.
  flushSection();
  if (!result.title) errors.unshift('line 1: missing top-level "# Title" heading');
  result.intro      = paragraphsToHtml(introLines);
  result.closing    = paragraphsToHtml(closingLines);
  result.references = referencesToHtml(refsLines);
  return { result, errors };
}

// Trim leading/trailing blank lines, collapse paragraph breaks,
// run inline md → HTML on each, wrap in <p>...</p>.
function paragraphsToHtml(lines) {
  // Drop leading and trailing blanks.
  let start = 0, end = lines.length;
  while (start < end && !lines[start].trim()) start++;
  while (end > start && !lines[end - 1].trim()) end--;
  if (start >= end) return '';

  const paragraphs = [];
  let buf = [];
  for (let i = start; i < end; i++) {
    const t = lines[i].trim();
    if (!t) {
      if (buf.length) { paragraphs.push(buf.join(' ')); buf = []; }
    } else {
      buf.push(t);
    }
  }
  if (buf.length) paragraphs.push(buf.join(' '));
  return paragraphs.map(p => `<p>${inlineMdToHtml(p)}</p>`).join('\n');
}

// `[text](url)`, `**strong**`, `*em*`. Anything else is passed through
// (including raw HTML the agent might paste — they're free to write
// HTML directly if they prefer; we don't strip it).
function inlineMdToHtml(s) {
  // Process links first so we don't accidentally chew their text.
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    (_, txt, url) => `<a href="${escapeAttr(url)}" target="_blank" rel="noopener">${txt}</a>`);
  // **strong** before *em* (avoid ** matching as ** *)
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return s;
}

function escapeAttr(s) {
  return s.replace(/"/g, '&quot;');
}

// References section becomes a <ul>...</ul> string (matches the
// existing JSON-side shape: a single HTML string).
function referencesToHtml(items) {
  const cleaned = items.filter(s => s && !/^\(?none\)?$/i.test(s));
  if (!cleaned.length) return '';
  const lis = cleaned.map(s => `<li>${inlineMdToHtml(s)}</li>`).join('\n');
  return `<ul>\n${lis}\n</ul>`;
}

// A key_links bullet might be `[Title](url) (Month Year)`,
// `[Title](url)`, a bare URL, or `Title (url)`. Normalize to
// `{text, url, published_date?}` matching the existing JSON shape
// (per htmlRenderer expectations: htmlRenderer.js renders
// published_date as a date span next to the link).
function linkToObject(s) {
  const md = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)\s*(?:\(([^)]+)\))?\s*$/.exec(s);
  if (md) {
    const out = { text: md[1].trim(), url: md[2].trim() };
    if (md[3]?.trim()) out.published_date = md[3].trim();
    return out;
  }
  const bare = /^(https?:\/\/\S+)$/.exec(s);
  if (bare) return { text: bare[1], url: bare[1] };
  const trail = /^(.+?)\s*\((https?:\/\/[^)]+)\)\s*$/.exec(s);
  if (trail) return { text: trail[1].trim(), url: trail[2].trim() };
  // Fallback: treat the whole string as text with no URL.
  return { text: s, url: '' };
}

// CRC: crc-CrankHandle.md | R164
//
// Reuse Fumble Log machinery from parseClusters — same shape, different
// phase. Importing here avoids the circular cost of pulling lib/crank.js.
export function logNewsletterParseFailure(cacheDir, runId, input, errors) {
  try {
    const logDir = path.join(cacheDir, '.cc');
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, 'parse-errors.log');
    const entry = [
      `=== ${new Date().toISOString()} run=${runId || '(unknown)'} phase=RESEARCH ===`,
      'Errors:',
      ...errors.map(e => `  - ${e}`),
      '--- input ---',
      input,
      '--- end ---',
      '',
    ].join('\n');
    fs.appendFileSync(logPath, entry);
  } catch {
    // Logging is best-effort.
  }
}
