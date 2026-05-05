// CRC: crc-Server.md | Seq: seq-fresh-run.md, seq-elicitor.md, seq-research-only.md, seq-clear-redo.md, seq-podcast.md, seq-cache-load.md | R1, R2, R3
import 'dotenv/config';
import http from 'http';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { runDiscoveryAgent } from './agents/discoveryAgent.js';
import { runResearchAgent  } from './agents/researchAgent.js';
import { elicitContext, synthesizeContext } from './agents/elicitorAgent.js';
import { generatePodcastScript } from './agents/podcastAgent.js';
import { renderNewsletterHTML } from './htmlRenderer.js';
import { printToPDF } from './tools/browser.js';
import { PROVIDER, MODEL, FAST_MODEL } from './lib/llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Events from the elicitor (runs before the SSE stream opens) are buffered here
// and replayed as the first events when the stream connects.
// CRC: crc-Server.md | R19
let _elicitorBuffer = [];

const CACHE_DIR        = path.join(__dirname, 'cache');
const DIST_DIR         = path.join(__dirname, 'dist');
const CLUSTERS_CACHE   = path.join(CACHE_DIR, 'clusters.json');
const NEWSLETTER_CACHE = path.join(CACHE_DIR, 'newsletter.json');
const NEWSLETTER_HTML   = path.join(CACHE_DIR, 'newsletter.html');
const NEWSLETTER_PDF    = path.join(CACHE_DIR, 'newsletter.pdf');
const NEWSLETTER_SCRIPT = path.join(CACHE_DIR, 'podcast-script.txt');
const COST_CACHE        = path.join(CACHE_DIR, 'cost.json');
const ELICITOR_CONTEXT  = path.join(CACHE_DIR, 'elicitor-context.txt');
const SETTINGS_FILE    = path.join(CACHE_DIR, 'settings.json');
const DISCOVERY_PROMPT = path.join(__dirname, 'discovery-prompt.md');
const RESEARCH_PROMPT  = path.join(__dirname, 'research-prompt.md');

// CRC: crc-Server.md | R93
const DEFAULT_SETTINGS = {
  elicitor:  { numCtx: null, maxTokens: 512,   thinking: false, model: null },
  discovery: { numCtx: null, maxTokens: 16000, thinking: true,  model: null },
  research:  { numCtx: null, maxTokens: 16000, thinking: true,  model: null },
  podcast:   { numCtx: null, maxTokens: 4000,  thinking: false, model: null }
};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      return {
        elicitor:  { ...DEFAULT_SETTINGS.elicitor,  ...saved.elicitor  },
        discovery: { ...DEFAULT_SETTINGS.discovery, ...saved.discovery },
        research:  { ...DEFAULT_SETTINGS.research,  ...saved.research  },
        podcast:   { ...DEFAULT_SETTINGS.podcast,   ...saved.podcast   }
      };
    }
  } catch (_) {}
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

// Strip null model so agents fall back to their own MODEL/FAST_MODEL default
function resolveSettings(s) {
  const out = { ...s };
  if (!out.model) delete out.model;
  return out;
}

// ─── Chrome tabs ─────────────────────────────────────────────────────────────

const CHROME_PORT = parseInt(process.env.CHROME_DEBUG_PORT || '9222', 10);

function findChromePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  if (process.platform === 'win32') {
    return [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
    ].find(p => fs.existsSync(p));
  }
  if (process.platform === 'darwin') {
    const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    return fs.existsSync(mac) ? mac : null;
  }
  return 'google-chrome';
}

function isChromeDebugRunning() {
  return new Promise(resolve => {
    const req = http.get(`http://localhost:${CHROME_PORT}/json/version`, res => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => { req.destroy(); resolve(false); });
  });
}

// CRC: crc-Server.md | R84, R85
async function launchChrome() {
  if (await isChromeDebugRunning()) {
    console.log(`Chrome already listening on debug port ${CHROME_PORT}`);
    return;
  }
  const chromePath = findChromePath();
  if (!chromePath) {
    console.warn(`Chrome binary not found — start it manually with --remote-debugging-port=${CHROME_PORT}`);
    return;
  }
  // Separate profile so debug mode works even when the user's regular Chrome is open.
  const userDataDir = path.join(__dirname, '.chrome-debug-profile');
  const child = spawn(chromePath, [
    `--remote-debugging-port=${CHROME_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check'
  ], { detached: true, stdio: 'ignore' });
  child.unref();
  console.log(`Launched Chrome on debug port ${CHROME_PORT} (pid ${child.pid}, profile ${userDataDir})`);
}

// CRC: crc-Server.md | R73, R74, R75
function getChromeTabs() {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${CHROME_PORT}/json`, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          const all = JSON.parse(raw);
          const tabs = all.filter(t =>
            t.type === 'page' &&
            (t.url?.startsWith('http://') || t.url?.startsWith('https://')) &&
            !t.url.startsWith(`http://localhost`) &&
            !t.url.startsWith(`https://localhost`)
          ).map(t => ({ title: t.title || t.url, url: t.url }));
          resolve({ tabs, error: null });
        } catch (e) {
          resolve({ tabs: [], error: String(e.message) });
        }
      });
    });
    req.on('error', (e) => {
      resolve({ tabs: [], error: `Chrome not reachable on port ${CHROME_PORT}: ${e.message}` });
    });
    req.setTimeout(3000, () => {
      req.destroy();
      resolve({ tabs: [], error: `Timeout connecting to Chrome on port ${CHROME_PORT}` });
    });
  });
}

// ─── Prompts API ──────────────────────────────────────────────────────────────

// CRC: crc-Server.md
app.get('/api/prompts', (req, res) => {
  res.json({
    discovery: fs.existsSync(DISCOVERY_PROMPT) ? fs.readFileSync(DISCOVERY_PROMPT, 'utf8') : '',
    research:  fs.existsSync(RESEARCH_PROMPT)  ? fs.readFileSync(RESEARCH_PROMPT,  'utf8') : ''
  });
});

app.post('/api/prompts', (req, res) => {
  const { discovery, research } = req.body;
  if (typeof discovery === 'string') fs.writeFileSync(DISCOVERY_PROMPT, discovery, 'utf8');
  if (typeof research  === 'string') fs.writeFileSync(RESEARCH_PROMPT,  research,  'utf8');
  res.json({ ok: true });
});

// ─── Settings API ────────────────────────────────────────────────────────────

// CRC: crc-Server.md | R93
app.get('/api/settings', (req, res) => {
  res.json({ ...loadSettings(), _meta: { provider: PROVIDER, model: MODEL, fastModel: FAST_MODEL } });
});

app.post('/api/settings', (req, res) => {
  const { _meta, ...body } = req.body;
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(body, null, 2));
  res.json({ ok: true });
});

app.get('/api/ollama-models', async (req, res) => {
  const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
  try {
    const r = await fetch(`${host}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const data = await r.json();
    const models = (data.models || []).map(m => m.name).sort();
    res.json({ models });
  } catch (e) {
    res.json({ models: [], error: e.message });
  }
});

// ─── Tabs API ────────────────────────────────────────────────────────────────

app.get('/api/tabs', async (req, res) => {
  res.json(await getChromeTabs());
});

// ─── Status ───────────────────────────────────────────────────────────────────

app.get('/api/status', (req, res) => {
  const hasClusters   = fs.existsSync(CLUSTERS_CACHE);
  const hasNewsletter = fs.existsSync(NEWSLETTER_CACHE);
  const hasCost       = fs.existsSync(COST_CACHE);
  const hasPdf        = fs.existsSync(NEWSLETTER_PDF);
  const hasPodcast    = fs.existsSync(NEWSLETTER_SCRIPT);
  res.json({
    hasClusters,
    hasNewsletter,
    hasPdf,
    hasPodcast,
    clusters:   hasClusters   ? JSON.parse(fs.readFileSync(CLUSTERS_CACHE,   'utf8')) : null,
    newsletter: hasNewsletter ? JSON.parse(fs.readFileSync(NEWSLETTER_CACHE, 'utf8')) : null,
    cost:       hasCost       ? JSON.parse(fs.readFileSync(COST_CACHE,       'utf8')) : null
  });
});

// ─── Elicitor API ────────────────────────────────────────────────────────────

// CRC: crc-Server.md | Seq: seq-elicitor.md | R19, R27
app.post('/api/elicit', async (req, res) => {
  const { existingContext } = req.body;
  const { tabs } = await getChromeTabs();
  _elicitorBuffer = [];
  const bufferSend = (type, data) => _elicitorBuffer.push({ type, data });
  try {
    const result = await elicitContext(tabs, existingContext || '', bufferSend, resolveSettings(loadSettings().elicitor));
    res.json({ ...result, tabs });
  } catch (e) {
    console.error('Elicitor error:', e.message);
    res.json({ ready: true, questions: [], suggestion: '', tabs });
  }
});

app.post('/api/elicit/synthesize', async (req, res) => {
  const { existingContext, qa } = req.body;
  const { tabs } = await getChromeTabs();
  const bufferSend = (type, data) => _elicitorBuffer.push({ type, data });
  try {
    const synthesizedContext = await synthesizeContext(tabs, existingContext || '', qa || [], bufferSend, resolveSettings(loadSettings().elicitor));
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(ELICITOR_CONTEXT, synthesizedContext, 'utf8');
    res.json({ synthesizedContext });
  } catch (e) {
    console.error('Synthesize error:', e.message);
    res.json({ synthesizedContext: existingContext || '' });
  }
});

// ─── Newsletter file downloads ───────────────────────────────────────────────

app.get('/api/newsletter.html', (req, res) => {
  if (!fs.existsSync(NEWSLETTER_HTML)) return res.status(404).send('Not found');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(NEWSLETTER_HTML);
});

app.get('/api/newsletter.pdf', (req, res) => {
  if (!fs.existsSync(NEWSLETTER_PDF)) return res.status(404).send('Not found');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="newsletter.pdf"');
  res.sendFile(NEWSLETTER_PDF);
});

app.get('/api/podcast-script', (req, res) => {
  if (!fs.existsSync(NEWSLETTER_SCRIPT)) return res.status(404).json({ error: 'Not generated yet' });
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="podcast-script.txt"');
  res.sendFile(NEWSLETTER_SCRIPT);
});

// CRC: crc-Server.md | Seq: seq-podcast.md | R6, R13, R15, R64, R71
app.get('/api/podcast-script/generate', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (type, data) => res.write(`data: ${JSON.stringify({ type, data })}\n\n`);

  if (!fs.existsSync(NEWSLETTER_CACHE)) {
    send('error', { message: 'No newsletter cached yet — run the pipeline first.' });
    return res.end();
  }

  let newsletter;
  try {
    newsletter = JSON.parse(fs.readFileSync(NEWSLETTER_CACHE, 'utf8'));
  } catch (e) {
    send('error', { message: `Could not read newsletter cache: ${e.message}` });
    return res.end();
  }

  try {
    const { script } = await generatePodcastScript(newsletter, send, resolveSettings(loadSettings().podcast));
    fs.writeFileSync(NEWSLETTER_SCRIPT, script, 'utf8');
    send('done', { script });
  } catch (e) {
    console.error('Podcast script error:', e.message);
    send('error', { message: e.message || 'Podcast generation failed' });
  }

  res.end();
});

// ─── Purge cache ──────────────────────────────────────────────────────────────

// CRC: crc-Server.md | R11
app.post('/api/purge', (req, res) => {
  if (fs.existsSync(CACHE_DIR)) {
    for (const f of fs.readdirSync(CACHE_DIR)) {
      try { fs.unlinkSync(path.join(CACHE_DIR, f)); } catch (_) {}
    }
  }
  res.json({ ok: true });
});

// ─── Save to dist ─────────────────────────────────────────────────────────────

// CRC: crc-Server.md | R16
app.post('/api/save-dist', (req, res) => {
  if (!fs.existsSync(NEWSLETTER_HTML)) {
    return res.status(400).json({ error: 'No newsletter ready — run the pipeline first.' });
  }

  const ts  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(DIST_DIR, ts);
  fs.mkdirSync(dir, { recursive: true });

  const saved = [];
  const copy  = (src, name) => {
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(dir, name));
      saved.push(name);
    }
  };

  copy(NEWSLETTER_HTML,   'newsletter.html');
  copy(NEWSLETTER_PDF,    'newsletter.pdf');
  copy(NEWSLETTER_CACHE,  'newsletter.json');
  copy(NEWSLETTER_SCRIPT, 'podcast-script.txt');

  res.json({ dir: path.relative(__dirname, dir).replace(/\\/g, '/'), saved });
});

// ─── SSE stream ───────────────────────────────────────────────────────────────

// CRC: crc-Server.md | Seq: seq-fresh-run.md, seq-research-only.md, seq-clear-redo.md | R4, R5, R7, R8, R9, R10, R12, R14, R17, R18, R20, R55
app.get('/api/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (type, data) => res.write(`data: ${JSON.stringify({ type, data })}\n\n`);

  send('model_info', { provider: PROVIDER, model: MODEL, fast_model: FAST_MODEL });

  // ?redo=true  → clear all cache
  // ?phase=2    → skip discovery, run research only (uses cached clusters)
  const redo   = req.query.redo   === 'true';
  const phase2 = req.query.phase  === '2';

  if (redo) {
    [CLUSTERS_CACHE, NEWSLETTER_CACHE, NEWSLETTER_HTML, NEWSLETTER_PDF, NEWSLETTER_SCRIPT, COST_CACHE, ELICITOR_CONTEXT].forEach(f => {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    });
  } else if (!phase2) {
    [NEWSLETTER_CACHE, NEWSLETTER_HTML, NEWSLETTER_PDF, NEWSLETTER_SCRIPT, COST_CACHE].forEach(f => {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    });
  }

  // Replay elicitor events buffered before this stream opened, then clear
  for (const evt of _elicitorBuffer) send(evt.type, evt.data);
  _elicitorBuffer = [];

  try {
    // Elicitor-synthesized context takes precedence over the raw prompt file
    const contextPrompt = fs.existsSync(ELICITOR_CONTEXT)
      ? fs.readFileSync(ELICITOR_CONTEXT, 'utf8').trim()
      : fs.existsSync(DISCOVERY_PROMPT)
        ? fs.readFileSync(DISCOVERY_PROMPT, 'utf8').trim()
        : '';
    const researchPrompt = fs.existsSync(RESEARCH_PROMPT)
      ? fs.readFileSync(RESEARCH_PROMPT, 'utf8').trim()
      : '';

    // ── Fetch open Chrome tabs ────────────────────────────────────────────────
    const { tabs, error: tabError } = await getChromeTabs();

    if (tabError) send('status', { message: `Chrome tabs: ${tabError}` });

    if (!tabs.length) {
      send('error', { message: tabError || 'No pages open in Chrome. Open some tabs then click Run.' });
      return res.end();
    }

    send('tabs', { tabs });

    const tabList = tabs
      .map((t, i) => `${i + 1}. "${t.title}" — ${t.url}`)
      .join('\n');

    const discoveryPrompt = [
      `## Pages currently open in Chrome`,
      `Fetch and analyze each of the following URLs:`,
      ``,
      tabList,
      contextPrompt ? `\n---\n\n## Additional context\n\n${contextPrompt}` : ''
    ].filter(Boolean).join('\n');

    // ── Phase 1: Discovery ────────────────────────────────────────────────────
    let clusters;
    let discoveryCost = { total: 0 };
    const agentSettings = loadSettings();

    if (!redo && fs.existsSync(CLUSTERS_CACHE)) {
      clusters = JSON.parse(fs.readFileSync(CLUSTERS_CACHE, 'utf8'));
      send('phase',    { phase: 1, label: 'Discovery', message: `${clusters.length} clusters loaded from cache` });
      send('clusters', { clusters });
      send('status',   { message: 'Discovery cache hit — running research phase...' });
    } else {
      const result = await runDiscoveryAgent(discoveryPrompt, send, resolveSettings(agentSettings.discovery));
      clusters      = result.clusters;
      discoveryCost = result.cost;

      if (!clusters?.length) {
        send('error', { message: 'Discovery agent returned no clusters.' });
        return res.end();
      }

      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(CLUSTERS_CACHE, JSON.stringify(clusters, null, 2));
    }

    // ── Phase 2: Research + Newsletter ───────────────────────────────────────
    const { newsletter, cost: researchCost } = await runResearchAgent(clusters, researchPrompt, send, resolveSettings(agentSettings.research));

    if (newsletter) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(NEWSLETTER_CACHE, JSON.stringify(newsletter, null, 2));

      // Generate standalone HTML
      const html = renderNewsletterHTML(newsletter);
      fs.writeFileSync(NEWSLETTER_HTML, html, 'utf8');

      // Generate PDF via Chrome
      let hasPdf = false;
      try {
        send('status', { message: 'Generating PDF…' });
        await printToPDF(`http://localhost:${PORT}/api/newsletter.html`, NEWSLETTER_PDF);
        hasPdf = true;
      } catch (e) {
        console.error('PDF generation failed:', e.message);
        send('status', { message: `PDF generation failed: ${e.message}` });
      }

      send('output_ready', { html: '/api/newsletter.html', pdf: hasPdf ? '/api/newsletter.pdf' : null });
    }

    const pipelineCost = {
      discovery:   discoveryCost,
      research:    researchCost,
      grand_total: (discoveryCost?.total || 0) + (researchCost?.total || 0)
    };
    fs.writeFileSync(COST_CACHE, JSON.stringify(pipelineCost, null, 2));
    send('pipeline_cost', pipelineCost);
    send('done', { message: newsletter ? 'Newsletter complete!' : 'Pipeline finished (no newsletter produced).' });

  } catch (err) {
    console.error('Pipeline error:', err);
    send('error', { message: err.message || 'Unexpected pipeline error.' });
  }

  res.end();
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, async () => {
  console.log(`Newsletter Agent → http://localhost:${PORT}`);
  await launchChrome();
});
