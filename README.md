# Newsletter Agent

Turns your open Chrome tabs into a polished newsletter. Open a bunch of tabs on a topic, hit Run, and get back a structured, link-rich brief with optional PDF export and podcast script.

## How it works

Four stages run in order:

1. **Elicitor** — before the pipeline starts, asks 2–3 clarifying questions about what you were reading and who will read the newsletter. Skippable; its cost and activity appear in the panels like any other agent.
2. **Discovery** — fetches every open tab, extracts content and publication dates, then groups everything into 3–8 thematic clusters.
3. **Research** — dives deeper into each cluster by following downstream links and running web searches, then writes the full newsletter.
4. **Podcast** *(on demand)* — converts the finished newsletter into a spoken-word script. Triggered by clicking 🎙 Podcast; streams its activity and cost to the same panels in real time.

## Prerequisites

- **Node.js** 18+
- **Chrome** launched with remote debugging enabled (see below)
- One of:
  - **Anthropic API key** (Claude — default, costs money, higher quality)
  - **Ollama** running locally with a capable model like `qwen3:14b` (free, slower)

## Setup

```bash
git clone <repo>
cd newsletter
npm install
cp .env.example .env
# edit .env — at minimum set ANTHROPIC_API_KEY or LLM_PROVIDER=ollama
```

## Start Chrome with remote debugging

The agent reads your actual open tabs via Chrome's DevTools Protocol. Launch Chrome with the debug port open:

**macOS**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

**Windows**
```
chrome.exe --remote-debugging-port=9222
```

**Linux**
```bash
google-chrome --remote-debugging-port=9222
```

> Chrome must be launched this way *before* you start the server. Already-running Chrome instances don't expose the debug port. You'll need to either close all your regular profile Chrome instances, or tell it to create a profile or use one that's not currently running.

## Run the server

```bash
npm start
```

Then open [http://localhost:3002](http://localhost:3002).

## Using the UI

1. **Open tabs** on whatever topic you want the newsletter to cover.
2. The **Chrome Tabs** panel shows what the agent will read. Hit ↺ Refresh if tabs don't appear.
3. Fill in **"What were you reading about?"** — the more specific you are, the sharper the output. Example chips give you a quick start.
4. Click **✨ Generate Newsletter**.
5. The **Elicitor** may ask a couple of clarifying questions first. Answer them or skip.
6. Watch the **Agent Activity** and **Pipeline Cost** panels update live. All four stages (Elicitor, Discovery, Research, Podcast) feed into these panels — costs are broken out per stage.
7. The finished newsletter renders on the page. Use **⬇ HTML** or **⬇ PDF** to download, or **🎙 Podcast** to generate a script and a player with whatever speech synthesis voices your browser supports so you can listen  (streams live into the activity and cost panels).

### Advanced mode

The **Agent Activity** and **Pipeline Cost** panels are visible in both modes. Click **⚙ Advanced** (top right) to also unlock:
- Thinking output and raw tool calls in the activity log
- Phase banners showing Discovery vs. Research progress
- Live cost ticker in the header
- Discovery Clusters panel (see how your tabs were grouped)
- **Newsletter Style** prompt pane to control tone, depth, and framing
- **⚡ Research Only** button to re-run just the writing phase against cached clusters
- **↺ Clear & Redo** to wipe the cache and start fresh

### Caching

Discovery results are cached in `cache/` so you can re-run the Research phase without re-fetching all your tabs. Use **↺ Clear & Redo** to force a full fresh run.

## Configuration

Copy `.env.example` to `.env` and set the relevant variables:

| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | `claude` | `claude` or `ollama` |
| `ANTHROPIC_API_KEY` | — | Required for Claude |
| `CLAUDE_MODEL` | `claude-opus-4-7` | Main agent model |
| `CLAUDE_FAST_MODEL` | `claude-haiku-4-5` | Elicitor model |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `qwen3:14b` | Main agent model |
| `OLLAMA_FAST_MODEL` | `qwen3:4b` | Elicitor model |
| `PORT` | `3002` | Server port |
| `CHROME_DEBUG_PORT` | `9222` | Chrome DevTools port |

## Project structure

```
agents/
  discoveryAgent.js   — fetches tabs, clusters content
  researchAgent.js    — enriches clusters, writes newsletter
  elicitorAgent.js    — pre-run clarifying questions
  podcastAgent.js     — converts newsletter to podcast script
  pricing.js          — Claude token cost calculation
lib/
  llm.js              — unified chat() interface (Claude + Ollama)
tools/
  browser.js          — fetch_page, web_search, PDF generation
public/
  index.html          — single-page UI
htmlRenderer.js       — standalone HTML newsletter template
server.js             — Express server + SSE pipeline
cache/                — runtime output (gitignored)
```

## Tips

- **More context = better newsletter.** Tell the agent your role, what you were investigating, and what matters. Vague prompts produce generic output.
- **Ollama needs a capable model.** `qwen3.6:35b` works well if you can run it. Smaller models (7b and below) tend to produce thin newsletters or malformed tool calls.
- **PDF generation** requires Chrome to be running with the debug port open (it renders the HTML newsletter through Chrome).
- **Podcast scripts** are generated on demand after the newsletter is ready — click 🎙 Podcast in the output header.
