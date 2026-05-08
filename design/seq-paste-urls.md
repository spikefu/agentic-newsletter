# Sequence: Paste-to-open URLs
**Requirements:** R218, R219, R220, R221, R225, R227, R228, R229, R230, R231

The user pastes a list of URLs into the Open URLs card at the top of
the main UI and clicks **Open in Chrome**. The server validates,
deduplicates against currently open tabs, opens the survivors via
CDP, and replies with a per-URL result list. The UI replaces the
inline status with one line per URL and refreshes the Chrome Tabs
panel so newly opened tabs show up.

```
User      WebUi                      Server                  OpenUrls               BrowserTools/CDP
 |          |                           |                       |                       |
 |-paste-->|                           |                        |                       |
 |-click ->| (button → loading)         |                       |                       |
 |          |---- POST /api/open-urls { urls } ---------------->|                       |
 |          |                           |  getChromeTabs() ---->|                       |
 |          |                           |<-- { tabs, error: null }                      |
 |          |                           |  planOpenUrls(raw, existingUrls)              |
 |          |                           |   parse + dedupe -----|                       |
 |          |                           |<-- { results, toOpen }                        |
 |          |                           |  for url of toOpen:   |                       |
 |          |                           |    openTab(url) ------|---- CDP.New ---------->|
 |          |                           |                       |<-- target / reject ----|
 |          |                           |  (downgrade rejects to failed, ≤200 chars)    |
 |          |<------- 200 { results } --|                       |                       |
 |          | (renders ✓ / • / ✗ lines per result)               |                       |
 |          |---- GET /api/tabs --------------->|                |                       |
 |          |<------- { tabs } -----------------|                |                       |
 |          | (Chrome Tabs panel refreshed; loading state cleared)                       |
```

Error paths:

- `urls` not a string → 400 `{ error: "urls must be a string" }`;
  UI shows ⚠️ with the message. No tab opening, no panel refresh.
- `getChromeTabs()` reports `error` (Chrome unreachable) → 503
  `{ error: "Chrome unreachable: …" }`; UI shows ⚠️ with the
  message. No tab opening, no panel refresh.

Notes:

- `openTab` calls are sequential, not parallel — keeps error
  messages tied to the right URL and avoids hammering Chrome
  (R230).
- New tabs are left open after the response; they will appear in
  the panel because they satisfy the existing http(s) /
  non-localhost filter (R232).
- Localhost URLs in the paste box still parse as valid (R224)
  and still get opened in Chrome — they simply don't show up in
  the panel because of the same filter.
