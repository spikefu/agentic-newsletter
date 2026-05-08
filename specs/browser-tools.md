# Browser tools (Chrome DevTools Protocol)

**Language / environment:** Node.js 18+, ESM. Uses the
`chrome-remote-interface` library to drive a Chrome instance over
its DevTools Protocol debug port (default 9222).

The agent reads the user's actual open tabs through Chrome's
DevTools Protocol — it does not run a generic web fetcher. The same
Chrome instance is used for fetching pages, running web searches,
and printing the newsletter to PDF.

## Capabilities

### `getChromeTabs()`
Returns the current set of open tabs in the debugged Chrome
instance, filtered to tabs that:
- Are real pages (`type === 'page'`).
- Use http or https.
- Are not pointed at the local server (`localhost`).

Each tab record is `{ title, url }`. If Chrome isn't reachable,
returns an empty list and a human-readable error string.

### `fetchPage(url)`
Navigates the headless tab to the URL, waits for `load`, then:
1. Extracts a publication date from page metadata, scanning (in
   order): `meta[property=article:published_time]`,
   `meta[property=og:updated_time]`, `meta[name=date]`,
   `meta[name=publish-date]`, `meta[name=pubdate]`,
   `meta[name=DC.date.issued]`, `time[datetime]`, and JSON-LD
   blocks (`datePublished` / `dateCreated`).
2. Removes `script`, `style`, `nav`, `footer`, `header`, `aside`
   elements.
3. Returns the visible text, trimmed and capped at 8000 characters.

When a date is found, the returned text is prefixed with
`[Published: <human-formatted date>]` followed by a blank line, so
downstream agents can rely on a uniform date marker.

If Chrome cannot be reached, returns a string explaining how to
start Chrome with `--remote-debugging-port=<port>`.

### `webSearch(query, maxResults)`
Navigates the headless tab to DuckDuckGo's HTML endpoint with the
query, then scrapes the result list — title, URL, snippet — and
returns up to `maxResults` (default 8) records.

### `printToPDF(url, outputPath)`
Navigates to a URL (typically the newsletter's local HTML page),
waits ~800ms for fonts and rendering to settle, then prints to PDF
with Letter dimensions and 0.6" margins, writing the bytes to disk.

## Auto-launch

If Chrome is not already listening on the debug port, the server
starts a fresh Chrome process with the debug port enabled and a
dedicated user data directory inside the project (so it doesn't
collide with the user's everyday Chrome profile).

The server logs whether it found an existing debug Chrome or
launched a new one.

## Why CDP and not generic fetch

- The tabs endpoint shows the user's actual reading list — the
  whole premise of the project.
- Pages render with the user's logged-in session and JavaScript,
  catching content that pure HTTP fetches miss.
- Date extraction works against the rendered DOM, not raw HTML.
- The same Chrome instance prints the final newsletter to PDF
  consistently.
