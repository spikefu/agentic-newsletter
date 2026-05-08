# Research agent

**Language / environment:** Node.js 18+, ESM. Runs server-side
inside the main SSE pipeline, after Discovery.

Research turns the cluster output from Discovery into a finished
newsletter. It enriches the clusters with extra detail by following
notable downstream links and (optionally) running web searches,
then writes the newsletter.

## Behavior

### Inputs
- The clusters from Discovery (or from cache).
- A research style block — either the user's saved
  `research-prompt.md` or a built-in default style.

### What it does
1. Review each cluster — sources, key points, notable links.
2. For the most interesting `notable_links` across clusters, fetch
   a few using `fetch_page` to add depth, quotes, or specifics.
3. Use `web_search` if supplemental context is needed.
4. Write the complete newsletter and submit via `write_newsletter`.

### Outputs
A `newsletter` object with these top-level fields:
- `title` — punchy and specific, not generic
- `subtitle` — a hyperlink crediting the project (the schema
  hard-codes the link target in the tool description)
- `intro` — opening paragraph in HTML
- `sections` — one per cluster, in narrative order; each section
  has `cluster_id`, `headline`, `body` (HTML — 3–5 substantive
  paragraphs), and `key_links` (2–5 further-reading entries with
  optional `published_date`)
- `closing` — closing paragraph in HTML
- `references` — full reference list in HTML

A `generatedAt` ISO timestamp is added by the server.

## Style rules baked into the system prompt

These hold regardless of any user-supplied style block:

- Cite sources inline as `<a href="URL" target="_blank">Title</a>
  (Month Year)`.
- Sources without a known date must not lead a paragraph; move
  them to the end of a section, prefix with `<em>Additional
  info:</em>`, and append "(date unavailable)".
- No relative time references ("this week", "recently", "just
  announced", etc.) — the newsletter publishes ad hoc and may be
  read days later.
- HTML body formatting uses `<p>`, `<strong>`, `<a>`, and `<ul>` —
  no inline headers (the section headline is rendered separately).

## Tools

- `fetch_page(url)` — same as Discovery; visited-URL deduplication
  applies.
- `web_search(query, max_results)` — DuckDuckGo via the headless
  Chrome instance, returning up to ~8 results.
- `write_newsletter(newsletter)` — terminal tool.

## Loop control

Same shape as Discovery — step limit (25), visited-URL set, single
nudge when the agent goes quiet without writing the newsletter,
then fail.
