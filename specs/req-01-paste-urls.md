---
id: req-01
title: Paste-to-open URLs
status: approved spikefu@gmail.com
---

# req-01 — Paste-to-open URLs

## Purpose

Let a user paste a list of URLs into a new input field at the top of the page and click a button that opens each URL as a new tab inside the Chrome instance the server is already debugging. After the tabs are opened, the rest of the existing newsletter pipeline (Chrome Tabs panel, Elicitor, Discovery, Research) operates unchanged — it picks up the newly opened tabs the same way it picks up any other tab the user opened by hand.

This requirement adds an *input path* for tabs. It does not change how the pipeline reads tabs, clusters them, or writes the newsletter.

## Line items

### req-01.1 — UI input field

- **Where:** A new card placed at the top of the main column in `public/index.html`, **above** the existing Chrome Tabs panel.
- **Contents:**
  - A `<textarea>` for pasted URLs (placeholder: one URL per line).
  - A primary button labelled **"Open in Chrome"**.
  - An inline status area immediately below the textarea for per-URL results (success / failure with reason).
- **Behavior:**
  - Clicking the button posts the textarea contents to `POST /api/open-urls` (see req-01.4).
  - The button shows a loading state until the server responds.
  - On response, the inline status area is replaced with one line per submitted URL: `✓ <url>` for success or `✗ <url> — <reason>` for failure.
  - After a successful response (any status), the existing Chrome Tabs panel is automatically refreshed so newly opened tabs appear without requiring the user to hit ↺ Refresh.
  - The textarea is **not** cleared automatically (the user may want to retry failures).
- **Out of scope:** No keyboard shortcut, no drag-and-drop, no per-line edit/remove UI, no progress streaming.

### req-01.2 — URL parsing

- Input string is split on newlines (`\r?\n`).
- Each line is trimmed of leading/trailing whitespace.
- Empty lines are ignored.
- A line is a **valid URL** iff `new URL(line)` succeeds **and** the resulting protocol is `http:` or `https:`.
- Any other line is reported back as `invalid url` (see req-01.5) and not opened.
- No fuzzy extraction, no auto-prepending of `https://`, no comma/space splitting.

### req-01.3 — Deduplication against currently open tabs

- Before opening, the server fetches the current tab list via the existing `getChromeTabs()` helper.
- A submitted URL is considered a duplicate iff its **exact string** matches the `url` of any currently open tab returned by `getChromeTabs()`.
  - String comparison only — no normalization of trailing slashes, query order, fragments, or case. (If users hit duplicates because of trivial differences, we revisit in a follow-up requirement.)
- Duplicate URLs are **not** opened a second time and are reported back as `already open` (see req-01.5).
- Deduplication is also applied **within the submitted batch**: if the same URL appears twice in the textarea, it is opened at most once. Subsequent occurrences are reported as `already open` (treating the first occurrence as having opened it).

### req-01.4 — Server endpoint

- **Route:** `POST /api/open-urls`
- **Request body:** `{ "urls": string }` — the raw textarea contents. (Sending the raw string keeps parsing centralized server-side per req-01.2.)
- **Response body (HTTP 200):**
  ```json
  {
    "results": [
      { "url": "<original line>", "status": "opened"     },
      { "url": "<original line>", "status": "already_open" },
      { "url": "<original line>", "status": "invalid",   "reason": "<short message>" },
      { "url": "<original line>", "status": "failed",    "reason": "<short message>" }
    ]
  }
  ```
  - `results` preserves the order of non-empty lines as submitted.
  - Each entry's `url` field is the original (trimmed) line, even when invalid.
- **Response body (HTTP 400):** `{ "error": "urls must be a string" }` if the request body is malformed.
- **HTTP 5xx is reserved for unexpected server errors** (e.g. Chrome unreachable). Per-URL failures are HTTP 200 with `status: "failed"`.

### req-01.5 — Per-URL outcomes

| status | When |
|---|---|
| `opened` | The server successfully created a new tab pointing at this URL via Chrome DevTools Protocol. |
| `already_open` | The URL is a duplicate per req-01.3 (matches an existing open tab, or appeared earlier in the same batch). |
| `invalid` | The line failed the URL parse check in req-01.2. |
| `failed` | CDP `Target.createTarget` (or equivalent) threw, or Chrome was unreachable for that URL. `reason` is the trimmed error message (≤ 200 chars). |

The server never aborts the batch on a single failure; every submitted line gets exactly one result entry.

### req-01.6 — Tab opening mechanism

- Tabs are opened via the Chrome DevTools Protocol target API (`CDP.New({ port, url })` or equivalent), against the same `CHROME_DEBUG_PORT` the rest of the app uses.
- The opened tabs are **left open** after `/api/open-urls` returns, after the pipeline runs, and after the pipeline finishes. Nothing in this requirement closes them.
- New tabs must satisfy the existing filter in `getChromeTabs()` (i.e. they must show up as `type: "page"` with an `http(s)://` URL that is not `localhost`). Localhost URLs in the paste box still parse as valid (req-01.2) and will still be opened in Chrome — they simply won't appear in the Chrome Tabs panel because the existing filter excludes them. This matches today's behavior for hand-opened localhost tabs.

### req-01.7 — Non-goals

- No persistence of paste history.
- No editing of the request after submission (no "retry failed only" button — user re-pastes manually).
- No change to the Discovery, Research, Elicitor, or Podcast agents.
- No change to the Chrome launch logic in `server.js`.
- No new env vars or settings.
- No automatic triggering of the newsletter pipeline after opening.

## Side effects

- Creates new tabs in the debug Chrome instance on `CHROME_DEBUG_PORT`.
- No filesystem writes. No cache changes. No cost incurred (no LLM calls).

## Invariants

- The existing pipeline (`/api/stream`, Elicitor, Discovery, Research) is byte-for-byte unchanged in behavior when no URLs are pasted.
- `getChromeTabs()` is the single source of truth for "what tabs exist." The new endpoint reads from it for deduplication; the UI re-reads from `/api/tabs` after the new endpoint returns.
- A submitted line never produces zero or two result entries — exactly one.
