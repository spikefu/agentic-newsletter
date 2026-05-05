# BrowserTools
**Requirements:** R72, R73, R74, R75, R76, R77, R78, R79, R80, R81, R82, R83, R146, R147, R148

Chrome DevTools Protocol wrapper. Drives a single Chrome instance
to list open tabs, fetch pages with date extraction, scrape
DuckDuckGo results, and print the rendered newsletter to PDF.

## Knows
- `CHROME_DEBUG_PORT` env var (default 9222)
- The CDP `Page` and `Runtime` domains
- Date-extraction precedence list (article:published_time,
  og:updated_time, name=date, name=publish-date, name=pubdate,
  DC.date.issued, time[datetime], JSON-LD)

## Does
- `getChromeTabs()` — calls `/json` on the debug port, filters to
  http(s) page tabs that aren't pointed at localhost; returns
  `{ tabs, error }`
- `fetchChromeJson(path, timeoutMs?)` — exported HTTP helper.
  GETs the named path on the debug port and returns the parsed
  JSON response, with consistent "Chrome not reachable" / "Timeout"
  error messages on rejection. Used by Server's `getChromeTabs`
  and `tabsForRequest`
- `getWindowsForTargets(targetIds)` — opens a single browser-level
  CDP connection (via the WebSocket URL from `/json/version`),
  calls `Browser.getWindowForTarget` for every id in parallel,
  closes the connection, and returns a `Map<targetId, windowId>`.
  Used by Server when scoping `/api/tabs?nonce=<n>` — one socket
  per request, never N+1
- `withTab(fn)` — opens a fresh CDP tab, enables Page domain,
  yields it to `fn`, closes the tab on completion
- `navigate(Page, url, timeoutMs)` — issues `Page.navigate` and
  races `loadEventFired` against a timeout
- `fetchPage(url, maxChars=8000)` — navigates, evaluates an
  in-page script that extracts date metadata then strips clutter
  and returns visible text; prefixes the result with
  `[Published: <date>]\n\n` when a date is found; trims to
  `maxChars`; returns a Chrome-not-reachable explainer on connect
  errors
- `webSearch(query, maxResults=8)` — navigates to
  `html.duckduckgo.com`, evaluates a result-scraping script,
  returns up to `maxResults` records (or a Chrome-error placeholder)
- `printToPDF(url, outputPath)` — navigates, waits 800ms, calls
  `Page.printToPDF` with Letter dimensions and 0.6" margins,
  writes bytes to disk

(The bookmarklet flow's per-target enumeration and URL-substring
match — for finding the nonce target — runs from Server, which
now reuses `fetchChromeJson` for the `/json` GET. CDP-domain
calls live here.)

## Collaborators
- chrome-remote-interface (npm)
- Server: provides debug port, calls these tools

## Sequences
- seq-fresh-run.md
- seq-bookmarklet-run.md
