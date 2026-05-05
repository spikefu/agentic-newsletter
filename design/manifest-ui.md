# UI Manifest

## Routes

The UI is a single page served from `public/index.html`. It talks
to the Express server through a fixed set of JSON and SSE
endpoints.

| Method | Path                            | Purpose                                  |
|--------|---------------------------------|------------------------------------------|
| GET    | `/`                             | Serve the single-page UI                 |
| GET    | `/api/tabs`                     | List currently-open Chrome tabs          |
| GET    | `/api/prompts`                  | Read discovery + research prompt files   |
| POST   | `/api/prompts`                  | Save discovery + research prompt files   |
| GET    | `/api/settings`                 | Read per-agent model settings + provider |
| POST   | `/api/settings`                 | Save per-agent model settings            |
| GET    | `/api/ollama-models`            | List installed Ollama models             |
| GET    | `/api/status`                   | Cached artifact summary                  |
| POST   | `/api/elicit`                   | Run elicitor analyze (returns Q's)       |
| POST   | `/api/elicit/synthesize`        | Run elicitor synthesize (writes context) |
| GET    | `/api/newsletter.html`          | Serve cached newsletter HTML             |
| GET    | `/api/newsletter.pdf`           | Serve cached newsletter PDF              |
| GET    | `/api/podcast-script`           | Serve cached podcast script (text)       |
| GET    | `/api/podcast-script/generate`  | SSE: generate podcast script             |
| POST   | `/api/purge`                    | Delete all cache files                   |
| POST   | `/api/save-dist`                | Copy cached output to `dist/<ts>/`       |
| GET    | `/api/stream`                   | SSE: run main pipeline (Discover → Research → Render) |

Stream query parameters:
- `?redo=true` — clear cache before running
- `?phase=2`  — skip Discover, reuse cached clusters

## Theme tokens (UI dark theme)

Embedded CSS in `public/index.html`:

| Token       | Value                       |
|-------------|-----------------------------|
| `--bg`      | `#0d1117` (page background) |
| `--surface` | `#161b22` (cards)           |
| `--surface2`| `#1c2128` (card headers)    |
| `--border`  | `#30363d`                   |
| `--text`    | `#e6edf3`                   |
| `--muted`   | `#7d8590`                   |
| `--accent`  | `#58a6ff` (links, badges)   |
| `--green`   | `#7ee787`                   |
| `--orange`  | `#f0883e`                   |
| `--yellow`  | `#e3b341` (cost ticker)     |
| `--purple`  | `#bc8cff`                   |
| `--red`     | `#f85149`                   |
| `--cyan`    | `#67e8f9`                   |
| `--amber`   | `#fb923c` (guide step nums) |

## Mode

The Advanced toggle persists in `localStorage` under the key
`newsletterMode` (values: `simple` | `advanced`). Simple is the
default. The toggle hides/shows: cost ticker, model badge,
Settings card, Clusters card, thinking text and prompt events in
the activity log, "Newsletter Style" textarea, "⚡ Research Only"
button.

## Global components

- **SSE EventSource handler** — installed on `/api/stream` and
  `/api/podcast-script/generate`; dispatches `data:` JSON events
  by `type` to per-panel handlers.
- **Cost ticker** — listens to `step_cost`, sums into a running
  total, shown in header (Advanced) and per-stage footers.
- **Activity feed** — append-only log; entries are tagged by
  agent (Elicitor / Discovery / Research / Podcast) and color-
  coded.
- **Toast / status** — short ephemeral messages for save/purge
  actions.
