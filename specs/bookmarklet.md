# Window-scoped capture via bookmarklet

**Language / environment:** Bookmarklet code is browser JavaScript;
the install panel and supporting endpoints are served by the
project's Express server (Node.js 18+, ESM). The mechanism uses
the same Chrome DevTools Protocol the rest of the project uses —
no browser extension required.

A bookmarklet lets the user generate a newsletter from **the
tabs in whichever Chrome window they click from**, instead of
"all tabs across all windows of the debug-port Chrome process."

## Motivation

The base behavior (`getChromeTabs()`) returns the union of every
tab in every window of the one Chrome process listening on the
debug port. If the user has multiple windows — say research in
one, unrelated browsing in another — the agent sees both. The
bookmarklet anchors a run to one specific window.

A Chrome extension could solve the same problem with the
`chrome.tabs.query({currentWindow: true})` API and no debug port,
but extensions hold standing read access to every page the user
visits. The project's CDP philosophy keeps the trust boundary at
"the user has explicitly started Chrome with a debug port" —
acceptable to many users where a permanent extension is not. The
bookmarklet preserves that boundary.

## Constraint: the bookmarklet must know the server's URL

A bookmarklet runs in the context of whatever page it's clicked
from (`nytimes.com`, `arxiv.org`, anywhere). Cross-origin browser
APIs (`localStorage`, `BroadcastChannel`, `SharedWorker`,
`postMessage` to other tabs) cannot bridge from the source page
to the newsletter server's origin, and there's no in-browser
discovery channel that lets the bookmarklet ask "which port is
the server on?" The bookmarklet must therefore bake the server's
URL in at install time.

This project's `PORT` is set in `.env` and is stable across
restarts. The user installs the bookmarklet from the running main
page, so the page's own `location.origin` is the URL the
bookmarklet captures. As long as the user doesn't change `PORT`
in `.env`, the bookmarklet keeps working across restarts. If the
user changes `PORT`, they reinstall from the new main page.

## What the user sees

1. On the main page, the Chrome Tabs card has a small
   "bookmarklet ▾" toggle next to the refresh control. Clicking
   it expands a one-row install panel inside the card.
2. The panel contains a draggable link labeled "📰 Newsletter
   from this window" and a brief instruction
   ("Drag this to your bookmarks bar").
3. After installation, clicking the bookmarklet from any tab in
   any debug-port-enabled Chrome window opens a new tab on the
   newsletter UI, scoped to that window's tabs.

## How it works

The bookmarklet itself can only see the page it's clicked from
and can open new tabs/windows; browsers don't expose the user's
other tabs to page JS. So the actual tab enumeration still goes
through CDP. The bookmarklet's job is to **identify the source
window** so the server can scope its CDP query.

Flow:

1. The bookmarklet generates a single-use nonce, then calls
   `window.open('<server-origin>/?nl-nonce=<nonce>')`. Chrome
   opens new tabs in the same window the action was taken in, so
   the newly-opened tab lives in the source window.
2. The main page loads with `?nl-nonce=<n>` in the URL. On
   noticing the parameter, the page calls
   `GET /api/tabs?nonce=<n>` instead of the unscoped
   `/api/tabs`.
3. The `/api/tabs?nonce=<n>` handler:
   a. Queries CDP `/json/list` and finds the single target whose
      URL contains the nonce. That's the tab the bookmarklet
      just opened.
   b. Calls CDP `Browser.getWindowForTarget(targetId)` to learn
      that target's `windowId`.
   c. Re-queries CDP and filters all targets to the same
      `windowId`, applying the existing http(s)/non-localhost
      filter.
   d. Returns the filtered tab list.
4. The UI proceeds normally — same Generate button, same SSE
   stream, same elicitor flow. The only difference is that
   the tab list for this run is window-scoped.

## Endpoints

- **`GET /api/tabs`** — existing endpoint, unchanged for the
  base any-window flow.
- **`GET /api/tabs?nonce=<n>`** — extended form. Resolves the
  nonce to a `windowId` via CDP and returns the scoped tab list.

No new install-page endpoint and no separate `/cluster` entry
point: the bookmarklet panel lives inside the main UI, and the
main page handles `?nl-nonce` directly.

## Behavior when the bookmarklet can't resolve

- **Server is not running.** `window.open` lands on the browser's
  built-in "This site can't be reached" page for the configured
  port. The user starts the server and clicks again. (We
  deliberately don't render a custom fallback page — doing so
  reliably across hostile-CSP source pages would cost more code
  than the failure mode justifies.)
- **Nonce target not found in CDP** (e.g. the new tab closed
  before the handler ran, or CDP is unreachable). `/api/tabs`
  falls back to the unscoped any-window list. The user lands in
  the normal flow with all tabs from all windows.

## Trust boundary

The bookmarklet contains only the URL to open with the nonce —
no remote-controlled JS, no eval, no secrets. The user installs
it once by drag-and-drop. Each click is a discrete user-initiated
action; there is no persistent browser permission grant.

The server only acts on CDP after the user clicks the
bookmarklet, just as it only acts on CDP after the user clicks
Generate today. The feature surface is additive to the existing
CDP usage; no new privileges are required.

## Behavior in Claude Code mode

Window scoping flows through to Claude Code mode unchanged. When
the user clicks the bookmarklet and then picks **Claude Code** in
the run-mode toggle (or vice versa), the UI's `POST /api/cc/run`
includes the same nonce. The server resolves the source window via
the existing CDP path and seeds the run's tab list with the
window-scoped tabs before handing the work to the CC session.
From the bookmarklet's point of view, the choice of LLM driver is
invisible.

## Out of scope

- Multi-window batch (run one newsletter per open Chrome window
  in one click). Future enhancement.
- Bookmarklet-driven podcast trigger (clicking from a saved
  newsletter window to add a podcast). Future enhancement.
- Cross-machine use (the bookmarklet hard-codes the install-time
  origin, including `localhost`). Tracked separately if/when
  remote deployment becomes a goal.
- Custom server-down fallback page. See the failure-mode section
  above.
