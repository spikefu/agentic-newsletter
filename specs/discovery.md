# Discovery agent

**Language / environment:** Node.js 18+, ESM. Runs server-side
inside the main SSE pipeline.

Discovery turns a list of Chrome tab URLs (plus user context) into
3–8 thematic content clusters. Each cluster groups multiple sources
that share a theme.

## Behavior

### Inputs
- The list of currently-open Chrome tabs (titles + URLs).
- A discovery context block — either the elicitor's synthesized
  context (if present) or the raw `discovery-prompt.md` file.

### What it does
1. For every URL the user provided, fetch the page using the
   `fetch_page` tool. Skip URLs already fetched in this run.
2. For each fetched page, extract: title, main topic, publication
   date, 3–5 key insights, and any notable downstream links worth
   following.
3. Group all fetched content into 3–8 logical thematic clusters.
4. Submit the clustering via the `submit_clusters` tool.

### Outputs
A `clusters` array. Each cluster has:
- `id` — short slug (e.g. "ai-reasoning")
- `title` — human-readable cluster title
- `theme_summary` — 2–3 sentence overview
- `sources` — array of source records, each with: `url`,
  `page_title`, `published_date` (or null), `summary`,
  `key_points`, and `notable_links`.

## Date handling

Fetched page content begins with a `[Published: <date>]` prefix
when the browser tool found a date in the page metadata. The
discovery agent must record that exact date string in
`published_date`. If no `[Published: ...]` line appears, the agent
should look for a date cue in the content (e.g. "1h ago", "2d
ago", a dateline) and use surrounding context to infer the likely
publish date.

## Tools

- `fetch_page(url)` — fetches a single URL, returning extracted
  text capped at 8000 chars and date-prefixed if available.
- `submit_clusters(clusters)` — terminal tool; submitting a non-
  empty clusters array ends the discovery stage.

## Loop control

The discovery agent runs in a tool-call loop with a step limit (30).
The server tracks visited URLs to prevent re-fetches. If the agent
stops emitting tool calls without submitting, the server "nudges"
it once with an explicit reminder to call `submit_clusters`. If the
agent still doesn't submit, the run fails with no clusters.

## Failure handling

- A `submit_clusters` call with an empty or missing array gets a
  `tool_result` error and the agent is allowed to retry.
- If the loop exits without clusters, the pipeline emits an error
  event and stops.
