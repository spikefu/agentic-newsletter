// CRC: crc-OpenUrls.md | Seq: seq-paste-urls.md | R223, R224, R225, R226, R229
/**
 * Plan which pasted URLs to open in the debug Chrome instance.
 *
 * Implements req-01.2 (parsing) and req-01.3 (deduplication). Pure function:
 * no I/O, no side effects. The /api/open-urls endpoint composes this with the
 * actual CDP call.
 *
 * Inputs:
 *   raw           — the raw textarea string (newline-separated lines)
 *   existingUrls  — array of URLs already open in Chrome (exact strings)
 *
 * Output:
 *   {
 *     results: Array<{ url, status, reason? }>   // one entry per non-empty line, in order
 *     toOpen:  string[]                          // URLs the caller should open via CDP, in order
 *   }
 *
 * Statuses produced here:
 *   - "opened"        → planned for opening; caller must attempt CDP and may downgrade to "failed"
 *   - "already_open"  → matches an existingUrl, OR appeared earlier in the same batch
 *   - "invalid"       → not parseable as http(s):// URL per req-01.2
 *
 * Error mode "failed" is produced by the endpoint, not here, since it represents
 * a CDP call failure.
 */
export function planOpenUrls(raw, existingUrls) {
  if (typeof raw !== 'string') throw new TypeError('raw must be a string');
  if (!Array.isArray(existingUrls)) throw new TypeError('existingUrls must be an array');

  const existing = new Set(existingUrls);
  const seenInBatch = new Set();
  const results = [];
  const toOpen = [];

  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

  for (const line of lines) {
    if (!isHttpUrl(line)) {
      results.push({ url: line, status: 'invalid', reason: 'not a valid http(s) URL' });
      continue;
    }
    if (existing.has(line) || seenInBatch.has(line)) {
      results.push({ url: line, status: 'already_open' });
      continue;
    }
    seenInBatch.add(line);
    results.push({ url: line, status: 'opened' });
    toOpen.push(line);
  }

  return { results, toOpen };
}

function isHttpUrl(s) {
  let u;
  try { u = new URL(s); } catch { return false; }
  return u.protocol === 'http:' || u.protocol === 'https:';
}
