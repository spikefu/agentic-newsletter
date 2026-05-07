# OpenUrls
**Requirements:** R223, R224, R225, R226, R227, R228, R229, R230

Server-side handler for the paste-URLs feature. Takes the raw
textarea contents and the live Chrome tab list, decides which URLs
to open, drives the CDP create-target call for each, and assembles a
per-URL result list.

The module is split into a pure planner (`planOpenUrls` in
`lib/openUrls.js`) and an Express handler factory
(`createOpenUrlsHandler` in `lib/openUrlsHandler.js`) so the
parse-and-dedupe logic is unit-testable without Chrome and the HTTP
layer can be exercised against fake `getChromeTabs` / `openTab`
implementations.

## Knows
- The four per-URL result statuses: `opened`, `already_open`,
  `invalid`, `failed`
- The 200-char cap on `failed` reasons
- The request body shape (`{ urls: string }`) and the response
  body shape (`{ results: [...] }` on success;
  `{ error: string }` on 400 / 503)

## Does
- `planOpenUrls(raw, existingUrls)` — pure. Splits `raw` on
  `\r?\n`, trims, drops empties, validates each line as
  `http(s)://` via `new URL`, deduplicates against `existingUrls`
  and within the batch, returns `{ results, toOpen }`. Produces
  three of the four statuses (`opened` / `already_open` /
  `invalid`); only the handler can produce `failed`.
- `createOpenUrlsHandler({ getChromeTabs, openTab })` returns an
  Express handler that:
  - replies 400 if `req.body.urls` is not a string
  - replies 503 if `getChromeTabs()` reports an error
  - calls `planOpenUrls` against the live tab list
  - awaits `openTab(url)` sequentially for every URL in `toOpen`
  - downgrades any planned `opened` to `failed` (with the
    truncated error message) when the corresponding `openTab`
    call rejected
  - replies 200 with `{ results }` preserving the order of
    non-empty input lines

## Collaborators
- BrowserTools: `openTab(url)` (R231) drives the CDP
  `Target.createTarget` call that actually opens the tab
- Server: provides `getChromeTabs()` (R73), mounts the handler at
  `POST /api/open-urls`, and supplies the `express.json` body
  parser the handler reads

## Sequences
- seq-paste-urls.md
