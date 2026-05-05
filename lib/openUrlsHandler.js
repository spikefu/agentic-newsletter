import { planOpenUrls } from './openUrls.js';

/**
 * Build the Express handler for `POST /api/open-urls` (req-01.4).
 *
 * Dependencies are injected so the handler can be exercised without a live
 * Chrome instance:
 *   - getChromeTabs() → Promise<{ tabs: Array<{ url, ... }>, error: string|null }>
 *   - openTab(url)    → Promise that resolves on success or rejects with an Error
 *
 * Behavior:
 *   - 400 if body.urls is not a string
 *   - 503 if getChromeTabs reports an error (Chrome unreachable)
 *   - 200 with { results } otherwise; per-URL `failed` is in-band per req-01.5
 */
export function createOpenUrlsHandler({ getChromeTabs, openTab }) {
  return async function openUrlsHandler(req, res) {
    const raw = req.body?.urls;
    if (typeof raw !== 'string') {
      return res.status(400).json({ error: 'urls must be a string' });
    }

    const { tabs, error: tabError } = await getChromeTabs();
    if (tabError) {
      return res.status(503).json({ error: `Chrome unreachable: ${tabError}` });
    }

    const existingUrls = tabs.map(t => t.url);
    const { results, toOpen } = planOpenUrls(raw, existingUrls);

    // Open the planned URLs sequentially; downgrade any "opened" plan to "failed"
    // if the CDP call rejects. Sequential keeps error messages tied to the right
    // URL and avoids hammering Chrome.
    const failures = new Map();
    for (const url of toOpen) {
      try {
        await openTab(url);
      } catch (e) {
        failures.set(url, shortReason(e));
      }
    }

    const finalResults = results.map(r => {
      if (r.status === 'opened' && failures.has(r.url)) {
        return { url: r.url, status: 'failed', reason: failures.get(r.url) };
      }
      return r;
    });

    res.json({ results: finalResults });
  };
}

function shortReason(err) {
  const msg = (err && err.message) ? String(err.message) : String(err);
  return msg.trim().slice(0, 200);
}
