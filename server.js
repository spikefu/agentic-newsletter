import 'dotenv/config';
import http from 'http';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { runDiscoveryAgent } from './agents/discoveryAgent.js';
import { runResearchAgent  } from './agents/researchAgent.js';
import { elicitContext, synthesizeContext } from './agents/elicitorAgent.js';
import { generatePodcastScript } from './agents/podcastAgent.js';
import { renderNewsletterHTML } from './htmlRenderer.js';
import { printToPDF } from './tools/browser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Events from the elicitor (runs before the SSE stream opens) are buffered here
// and replayed as the first events when the stream connects.
let _elicitorBuffer = [];

const CACHE_DIR        = path.join(__dirname, 'cache');
const CLUSTERS_CACHE   = path.join(CACHE_DIR, 'clusters.json');
const NEWSLETTER_CACHE = path.join(CACHE_DIR, 'newsletter.json');
const NEWSLETTER_HTML   = path.join(CACHE_DIR, 'newsletter.html');
const NEWSLETTER_PDF    = path.join(CACHE_DIR, 'newsletter.pdf');
const NEWSLETTER_SCRIPT = path.join(CACHE_DIR, 'podcast-script.txt');
const COST_CACHE        = path.join(CACHE_DIR, 'cost.json');
const ELICITOR_CONTEXT  = path.join(CACHE_DIR, 'elicitor-context.txt');
const DISCOVERY_PROMPT = path.join(__dirname, 'discovery-prompt.md');
const RESEARCH_PROMPT  = path.join(__dirname, 'research-prompt.md');

// ─── Chrome tabs ─────────────────────────────────────────────────────────────

const CHROME_PORT = parseInt(process.env.CHROME_DEBUG_PORT || '9222', 10);

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

app.post('/api/elicit', async (req, res) => {
  const { existingContext } = req.body;
  const { tabs } = await getChromeTabs();
  _elicitorBuffer = [];
  const bufferSend = (type, data) => _elicitorBuffer.push({ type, data });
  try {
    const result = await elicitContext(tabs, existingContext || '', bufferSend);
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
    const synthesizedContext = await synthesizeContext(tabs, existingContext || '', qa || [], bufferSend);
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
    const { script } = await generatePodcastScript(newsletter, send);
    fs.writeFileSync(NEWSLETTER_SCRIPT, script, 'utf8');
    send('done', { script });
  } catch (e) {
    console.error('Podcast script error:', e.message);
    send('error', { message: e.message || 'Podcast generation failed' });
  }

  res.end();
});

// ─── SSE stream ───────────────────────────────────────────────────────────────

app.get('/api/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (type, data) => res.write(`data: ${JSON.stringify({ type, data })}\n\n`);

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

    if (!redo && fs.existsSync(CLUSTERS_CACHE)) {
      clusters = JSON.parse(fs.readFileSync(CLUSTERS_CACHE, 'utf8'));
      send('phase',    { phase: 1, label: 'Discovery', message: `${clusters.length} clusters loaded from cache` });
      send('clusters', { clusters });
      send('status',   { message: 'Discovery cache hit — running research phase...' });
    } else {
      const result = await runDiscoveryAgent(discoveryPrompt, send);
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
    const { newsletter, cost: researchCost } = await runResearchAgent(clusters, researchPrompt, send);

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
app.listen(PORT, () => console.log(`Newsletter Agent → http://localhost:${PORT}`));
