// CRC: crc-CrankHandle.md | R164
//
// Parse stencilled discover-phase markdown into the clusters object
// the existing validateClusters() expects. The agent writes prose-
// shaped markdown — easier to author than JSON, easier for a human
// to read in the editor — and the CLI keeps the on-disk JSON wire
// format the renderer wants.
//
// Returns `{ result, errors }`. `errors` is a list of "line N: ..."
// strings — empty when the parse succeeds. Structural validation
// (3–8 clusters, required fields, etc.) is the validateClusters()
// caller's job; this parser only reports shape errors that prevent
// extraction.

import fs from 'fs';
import path from 'path';

export function parseClusters(text) {
  const lines = text.split(/\r?\n/);
  const clusters = [];
  const errors = [];
  let cluster = null;
  let source = null;
  let arrayField = null;     // 'key_points' | 'notable_links' | null
  let themeBuf = null;       // accumulating theme paragraph(s)

  const usedSlugs = new Set();
  const flushTheme = () => {
    if (cluster && themeBuf !== null) {
      cluster.theme_summary = themeBuf.trim();
      themeBuf = null;
    }
  };
  const err = (i, msg) => errors.push(`line ${i + 1}: ${msg}`);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();

    // ## Cluster Title
    const hCluster = /^##\s+(?!#)(.+)$/.exec(line);
    if (hCluster) {
      flushTheme();
      arrayField = null;
      const title = hCluster[1].trim();
      const id = uniqueSlug(title, usedSlugs);
      cluster = { id, title, theme_summary: '', sources: [] };
      clusters.push(cluster);
      source = null;
      continue;
    }

    // ### Source: <url>
    const hSource = /^###\s+Source:\s*(\S.*)$/i.exec(line);
    if (hSource) {
      flushTheme();
      arrayField = null;
      if (!cluster) {
        err(i, 'source heading found before any cluster (## ...) heading');
      }
      source = {
        url: hSource[1].trim(),
        page_title: '',
        published_date: null,
        summary: '',
        key_points: [],
        notable_links: [],
      };
      // Drop the orphan source's fields silently into a sink so the missing-
      // cluster error doesn't cascade into one error per field bullet.
      if (cluster) cluster.sources.push(source);
      continue;
    }

    // **Theme:** <paragraph...>
    const mTheme = /^\*\*Theme:\*\*\s*(.*)$/i.exec(line);
    if (mTheme) {
      arrayField = null;
      if (!cluster) {
        err(i, 'theme line found before any cluster (## ...) heading');
        continue;
      }
      themeBuf = mTheme[1];
      continue;
    }

    // - **Field:** value   (or - **Field:** for arrays)
    const mField = /^-\s+\*\*([^*:]+):\*\*\s*(.*)$/.exec(line);
    if (mField) {
      const field = mField[1].trim().toLowerCase();
      const value = mField[2].trim();
      if (!source) {
        err(i, `field "${mField[1].trim()}" found before any source (### Source: ...) heading`);
        continue;
      }
      arrayField = null;
      switch (field) {
        case 'page title':
        case 'title':
          source.page_title = value;
          break;
        case 'published':
        case 'published date':
          source.published_date = (value && !/^\(?(unknown|none|n\/a)\)?$/i.test(value)) ? value : null;
          break;
        case 'summary':
          source.summary = value;
          break;
        case 'key points':
          arrayField = 'key_points';
          if (value && !/^\(?none\)?$/i.test(value)) source.key_points.push(value);
          break;
        case 'notable links':
          arrayField = 'notable_links';
          if (value && !/^\(?none\)?$/i.test(value)) source.notable_links.push(value);
          break;
        default:
          err(i, `unknown source field "${mField[1].trim()}" — expected one of: Page title, Published, Summary, Key points, Notable links`);
      }
      continue;
    }

    // Indented bullet feeding the active array field
    const mBullet = /^\s{2,}-\s+(.+)$/.exec(line);
    if (mBullet && arrayField && source) {
      const text = mBullet[1].trim();
      if (!/^\(?none\)?$/i.test(text)) source[arrayField].push(text);
      continue;
    }

    // Theme continuation — non-empty, non-heading, non-bullet line while a theme is open.
    if (themeBuf !== null && line.trim() !== '' && !line.startsWith('#') && !line.startsWith('-')) {
      themeBuf += (themeBuf ? '\n' : '') + line.trim();
      continue;
    }

    // Blank line: close any active array field collection.
    if (line.trim() === '') {
      arrayField = null;
      continue;
    }
    // Anything else (top-level # title, stray prose) is ignored.
  }
  flushTheme();
  return { result: { clusters }, errors };
}

function uniqueSlug(title, used) {
  let base = title.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'cluster';
  let slug = base;
  let n = 2;
  while (used.has(slug)) slug = `${base}-${n++}`;
  used.add(slug);
  return slug;
}

// CRC: crc-CrankHandle.md | R164
//
// Append a parse-failure record to cache/.cc/parse-errors.log so we
// can spot recurring stencil violations and tighten the prompt
// instead of paying the recovery turn every cycle.
export function logParseFailure(cacheDir, phase, runId, input, errors) {
  try {
    const logDir = path.join(cacheDir, '.cc');
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, 'parse-errors.log');
    const entry = [
      `=== ${new Date().toISOString()} run=${runId || '(unknown)'} phase=${phase} ===`,
      'Errors:',
      ...errors.map(e => `  - ${e}`),
      '--- input ---',
      input,
      '--- end ---',
      '',
    ].join('\n');
    fs.appendFileSync(logPath, entry);
  } catch {
    // Logging is best-effort; a failure here must not break the pipeline.
  }
}
