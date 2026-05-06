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
import { printToPDF, getWindowsForTargets, fetchChromeJson } from './tools/browser.js';
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

// Returns { cmd, prefixArgs } describing how to spawn Chrome, or null.
// The prefixArgs let us prepend e.g. `flatpak run --filesystem=... <appId>`
// in front of the Chrome flags without leaking the launch shape to callers.
function findChromeLauncher() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return { cmd: process.env.CHROME_PATH, prefixArgs: [] };
  }
  if (process.platform === 'win32') {
    const found = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
    ].find(p => fs.existsSync(p));
    return found ? { cmd: found, prefixArgs: [] } : null;
  }
  if (process.platform === 'darwin') {
    const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    return fs.existsSync(mac) ? { cmd: mac, prefixArgs: [] } : null;
  }
  // Linux: try native packages on PATH first, then Flatpak wrappers.
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const p = `/usr/bin/${name}`;
    if (fs.existsSync(p)) return { cmd: p, prefixArgs: [] };
  }
  const flatpakWrappers = [
    `${os.homedir()}/.local/share/flatpak/exports/bin/com.google.Chrome`,
    '/var/lib/flatpak/exports/bin/com.google.Chrome',
    `${os.homedir()}/.local/share/flatpak/exports/bin/org.chromium.Chromium`,
    '/var/lib/flatpak/exports/bin/org.chromium.Chromium',
  ];
  for (const wrapper of flatpakWrappers) {
    if (fs.existsSync(wrapper)) {
      // Invoke `flatpak` directly so we can add --filesystem; the wrapper
      // script doesn't pass that flag through. The project dir grant lets
      // Chrome write the user-data-dir we point it at below.
      return {
        cmd: 'flatpak',
        prefixArgs: ['run', `--filesystem=${__dirname}`, path.basename(wrapper)],
      };
    }
  }
  // Last resort: trust PATH (won't find anything we haven't already tried,
  // but preserves the original "spawn google-chrome and see" behavior).
  return { cmd: 'google-chrome', prefixArgs: [] };
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
  const launcher = findChromeLauncher();
  if (!launcher) {
    console.warn(`Chrome binary not found — start it manually with --remote-debugging-port=${CHROME_PORT}`);
    return;
  }
  // Separate profile so debug mode works even when the user's regular Chrome is open.
  const userDataDir = path.join(__dirname, '.chrome-debug-profile');
  const args = [
    ...launcher.prefixArgs,
    `--remote-debugging-port=${CHROME_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];
  const child = spawn(launcher.cmd, args, { detached: true, stdio: 'ignore' });
  child.unref();
  console.log(`Launched Chrome on debug port ${CHROME_PORT} via ${launcher.cmd} (pid ${child.pid}, profile ${userDataDir})`);
}

function filterPageTabs(all) {
  return all.filter(t =>
    t.type === 'page' &&
    (t.url?.startsWith('http://') || t.url?.startsWith('https://')) &&
    !t.url.startsWith(`http://localhost`) &&
    !t.url.startsWith(`https://localhost`)
  );
}

// CRC: crc-Server.md | R73, R74, R75
async function getChromeTabs() {
  try {
    const all = await fetchChromeJson('/json');
    return {
      tabs: filterPageTabs(all).map(t => ({ title: t.title || t.url, url: t.url })),
      error: null
    };
  } catch (e) {
    return { tabs: [], error: e.message };
  }
}

// CRC: crc-Server.md | Seq: seq-bookmarklet-run.md | R146, R147, R148, R149, R150
async function tabsForRequest(req) {
  const nonce = String(req.query.nonce || '');
  if (!nonce) return getChromeTabs();
  try {
    const all = await fetchChromeJson('/json');
    const target = all.find(t => t.type === 'page' && t.url?.includes(`nl-nonce=${nonce}`));
    if (!target) return getChromeTabs();
    const candidates = filterPageTabs(all);
    const windowMap = await getWindowsForTargets([target.id, ...candidates.map(c => c.id)]);
    const windowId = windowMap.get(target.id);
    if (windowId == null) return getChromeTabs();
    const tabs = candidates.filter(c => windowMap.get(c.id) === windowId)
                           .map(t => ({ title: t.title || t.url, url: t.url }));
    return { tabs, error: null };
  } catch (e) {
    console.warn('Window-scoped tab listing failed; falling back to unscoped:', e.message);
    return getChromeTabs();
  }
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

// CRC: crc-Server.md | Seq: seq-bookmarklet-run.md | R139, R145, R148
app.get('/api/tabs', async (req, res) => {
  res.json(await tabsForRequest(req));
});

// ─── CC mode (additive) ──────────────────────────────────────────────────────
//
// Single-CC-session contract: one session is registered at a time
// (last-wins on connect). Every CLI subcommand sends `X-CC-Session`
// so the server can reject stale callers post-takeover.

// CRC: crc-Server.md | Seq: seq-cc-bootstrap.md, seq-cc-run.md | R151, R152, R190
const _ccConn = {
  sessionId: null,
  targetWindow: null,
  verbose: false,
  lastActivityAt: 0,
  waitConnections: 0,
  currentRunId: null,
  lastEventAt: 0,
};
let _ccPendingWork = null;
const _ccWaitResolvers = [];
const _ccRunHoldCallbacks = [];
let _ccPendingAnswer = null;
const _ccAnswerWaitResolvers = [];
const _ccEventBuffer = [];
const _ccStreamSubs = new Set();

const CC_HEARTBEAT_TIMEOUT_MS  = 60_000;
const CC_RECONNECT_WINDOW_MS   = 30_000;
const CC_RUN_HOLD_TIMEOUT_MS   = 30_000;
const CC_WAIT_LONG_POLL_MS     = 25_000;

function _ccTouch() { _ccConn.lastActivityAt = Date.now(); }

// CRC: crc-Server.md | R190
function _ccPresence() {
  const now = Date.now();
  if (!_ccConn.sessionId) return 'not_connected';
  if (_ccConn.currentRunId) {
    // Either an `event` POST or any other /api/cc/* call counts as a
    // heartbeat. Long discovery phases issue many `newsletter fetch`
    // calls without `event` posts; we don't want those to look idle.
    const lastSignal = Math.max(_ccConn.lastEventAt, _ccConn.lastActivityAt);
    if (now - lastSignal > CC_HEARTBEAT_TIMEOUT_MS) {
      _ccConn.currentRunId = null;
      return now - _ccConn.lastActivityAt < CC_RECONNECT_WINDOW_MS ? 'reconnecting' : 'not_connected';
    }
    return 'running';
  }
  if (_ccConn.waitConnections > 0) return 'listening';
  if (now - _ccConn.lastActivityAt < CC_RECONNECT_WINDOW_MS) return 'reconnecting';
  return 'not_connected';
}

function _ccCheckSession(req, res) {
  const callerSession = req.get('X-CC-Session');
  if (!_ccConn.sessionId) {
    res.status(409).json({ error: 'no session connected', code: 65 });
    return false;
  }
  if (callerSession && callerSession !== _ccConn.sessionId) {
    res.status(409).json({ error: 'session mismatch', code: 66 });
    return false;
  }
  return true;
}

function _ccDispatchPendingWork() {
  while (_ccPendingWork && _ccWaitResolvers.length) {
    const resolver = _ccWaitResolvers.shift();
    const work = _ccPendingWork;
    _ccPendingWork = null;
    resolver(work);
    while (_ccRunHoldCallbacks.length) _ccRunHoldCallbacks.shift()(work);
  }
}

function _ccBroadcastEvent(evt) {
  for (const res of _ccStreamSubs) {
    try { res.write(`data: ${JSON.stringify(evt)}\n\n`); } catch {}
  }
}

// CRC: crc-Server.md | Seq: seq-cc-bootstrap.md | R156, R157, R158, R160, R189
app.get('/api/cc/connection', (req, res) => {
  // Every CLI invocation runs livenessCheck() → this endpoint, so each
  // `newsletter <subcmd>` doubles as a heartbeat. Catches long phases
  // (e.g. discovery's per-tab fetch loop) where the agent is busy but
  // not emitting `event` posts.
  if (_ccConn.sessionId && req.get('X-CC-Session') === _ccConn.sessionId) {
    _ccTouch();
  }
  res.json({
    sessionId:    _ccConn.sessionId,
    targetWindow: _ccConn.targetWindow,
    verbose:      _ccConn.verbose,
    presence:     _ccPresence(),
  });
});

// CRC: crc-Server.md | Seq: seq-cc-bootstrap.md | R158, R159
app.post('/api/cc/connection', (req, res) => {
  const { sessionId, targetWindow, verbose } = req.body || {};
  if (typeof sessionId !== 'string' || !sessionId) {
    return res.status(400).json({ error: 'missing sessionId' });
  }
  const previous = _ccConn.sessionId;
  if (previous && previous !== sessionId) {
    // Last-wins takeover: drop any parked /wait long-polls so the old CLI exits 66 promptly.
    while (_ccWaitResolvers.length) _ccWaitResolvers.shift()({ takeover: true });
    while (_ccAnswerWaitResolvers.length) _ccAnswerWaitResolvers.shift()({ takeover: true });
    _ccPendingWork = null;
    _ccConn.currentRunId = null;
  }
  _ccConn.sessionId    = sessionId;
  _ccConn.targetWindow = targetWindow || null;
  _ccConn.verbose      = !!verbose;
  _ccTouch();
  res.json({ ok: true, takeover: previous && previous !== sessionId });
});

// CRC: crc-Server.md | R160
app.delete('/api/cc/connection', (req, res) => {
  if (!_ccCheckSession(req, res)) return;
  _ccConn.sessionId    = null;
  _ccConn.targetWindow = null;
  _ccConn.verbose      = false;
  _ccConn.currentRunId = null;
  _ccPendingWork = null;
  while (_ccWaitResolvers.length) _ccWaitResolvers.shift()({ disconnected: true });
  res.json({ ok: true });
});

// CRC: crc-Server.md | Seq: seq-cc-run.md | R184, R191, R192, R213, R216
app.post('/api/cc/run', async (req, res) => {
  const presence = _ccPresence();
  if (presence === 'running') {
    return res.status(409).json({ error: 'run in progress' });
  }
  if (presence === 'not_connected') {
    return res.status(503).json({
      error: 'cc_not_connected',
      message: "Claude Code isn't connected. From a CC session in this project, run `/newsletter` (or `newsletter wait` if you've set up the skill). Then click Generate again.",
    });
  }
  // Build the work item. Pull tabs scoped by ?nonce= when present (R213).
  const { tabs } = await tabsForRequest(req);
  const runId = `run-${Date.now().toString(36)}`;
  const kind  = req.body?.kind || 'run';
  const mode  = req.body?.mode || 'fresh';
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, 'run.json'), JSON.stringify({ runId, kind, mode, tabs }, null, 2));
  _ccPendingWork = { runId, kind, mode, tabs };
  _ccTouch();
  if (presence === 'listening') {
    _ccDispatchPendingWork();
    return res.json({ ok: true, runId });
  }
  // reconnecting: hold up to RUN_HOLD_TIMEOUT_MS, then 503.
  let settled = false;
  const settle = (fn) => { if (!settled && !res.headersSent) { settled = true; fn(); } };
  const onConsumed = (work) => settle(() => res.json({ ok: true, runId: work.runId }));
  const timer = setTimeout(() => {
    const idx = _ccRunHoldCallbacks.indexOf(onConsumed);
    if (idx >= 0) _ccRunHoldCallbacks.splice(idx, 1);
    if (_ccPendingWork?.runId === runId) _ccPendingWork = null;
    settle(() => res.status(503).json({ error: 'cc_not_connected', held: true }));
  }, CC_RUN_HOLD_TIMEOUT_MS);
  _ccRunHoldCallbacks.push(onConsumed);
  req.on('close', () => {
    clearTimeout(timer);
    const idx = _ccRunHoldCallbacks.indexOf(onConsumed);
    if (idx >= 0) _ccRunHoldCallbacks.splice(idx, 1);
  });
});

// CRC: crc-Server.md | Seq: seq-cc-run.md | R161, R162, R185
app.get('/api/cc/wait', (req, res) => {
  if (!_ccCheckSession(req, res)) return;
  _ccConn.waitConnections += 1;
  _ccTouch();
  let settled = false;
  const settle = (payload) => {
    if (settled) return;
    settled = true;
    _ccConn.waitConnections = Math.max(0, _ccConn.waitConnections - 1);
    if (payload?.takeover) {
      res.status(409).json({ error: 'session mismatch', code: 66 });
    } else if (payload?.disconnected) {
      res.status(409).json({ error: 'no session connected', code: 65 });
    } else if (payload) {
      res.json(payload);
    } else {
      res.status(204).end();
    }
  };
  _ccWaitResolvers.push(settle);
  _ccDispatchPendingWork();
  const timer = setTimeout(() => {
    const idx = _ccWaitResolvers.indexOf(settle);
    if (idx >= 0) _ccWaitResolvers.splice(idx, 1);
    settle(null);
  }, CC_WAIT_LONG_POLL_MS);
  req.on('close', () => {
    clearTimeout(timer);
    const idx = _ccWaitResolvers.indexOf(settle);
    if (idx >= 0) _ccWaitResolvers.splice(idx, 1);
    if (!settled) {
      settled = true;
      _ccConn.waitConnections = Math.max(0, _ccConn.waitConnections - 1);
    }
  });
});

// CRC: crc-Server.md | Seq: seq-cc-run.md | R168, R169, R170, R180, R186
app.post('/api/cc/event', (req, res) => {
  if (!_ccCheckSession(req, res)) return;
  const { type, data } = req.body || {};
  if (typeof type !== 'string' || !type) {
    return res.status(400).json({ error: 'missing event type' });
  }
  _ccConn.lastEventAt = Date.now();
  _ccTouch();
  if (type === 'run-started') _ccConn.currentRunId = data?.runId || _ccPendingWork?.runId || null;
  if (type === 'run-finished') _ccConn.currentRunId = null;
  const evt = { type, data: data ?? null };
  if (_ccStreamSubs.size === 0) _ccEventBuffer.push(evt);
  else _ccBroadcastEvent(evt);
  res.json({ ok: true });
});

// CRC: crc-Server.md | Seq: seq-cc-elicitor.md | R172, R187
app.post('/api/cc/answer', (req, res) => {
  // Note: not session-checked — UI-side post; the CLI's await side is checked.
  const payload = req.body || {};
  _ccPendingAnswer = payload;
  while (_ccAnswerWaitResolvers.length) {
    _ccAnswerWaitResolvers.shift()(_ccPendingAnswer);
  }
  _ccPendingAnswer = null;
  res.json({ ok: true });
});

// CRC: crc-Server.md | R188
app.get('/api/cc/status', (req, res) => {
  res.json({
    presence:     _ccPresence(),
    sessionId:    _ccConn.sessionId,
    runId:        _ccConn.currentRunId,
    waitOpen:     _ccConn.waitConnections,
    lastEventAt:  _ccConn.lastEventAt,
    lastActivity: _ccConn.lastActivityAt,
  });
});

// CRC: crc-Server.md | Seq: seq-cc-run.md | R165
app.post('/api/cc/fetch', async (req, res) => {
  if (!_ccCheckSession(req, res)) return;
  const { url, maxChars } = req.body || {};
  if (typeof url !== 'string' || !url) {
    return res.status(400).json({ error: 'missing url' });
  }
  try {
    const { fetchPage } = await import('./tools/browser.js');
    const text = await fetchPage(url, maxChars || 8000);
    _ccTouch();
    res.json({ url, text });
  } catch (e) {
    res.status(500).json({ url, error: e.message });
  }
});

// CRC: crc-Server.md | Seq: seq-cc-run.md | R166
app.post('/api/cc/search', async (req, res) => {
  if (!_ccCheckSession(req, res)) return;
  const { query, maxResults } = req.body || {};
  if (typeof query !== 'string' || !query) {
    return res.status(400).json({ error: 'missing query' });
  }
  try {
    const { webSearch } = await import('./tools/browser.js');
    const results = await webSearch(query, maxResults || 8);
    _ccTouch();
    res.json({ query, results });
  } catch (e) {
    res.status(500).json({ query, error: e.message });
  }
});

// CRC: crc-Server.md | Seq: seq-cc-elicitor.md | R172
app.get('/api/cc/await-answer', (req, res) => {
  if (!_ccCheckSession(req, res)) return;
  _ccTouch();
  let settled = false;
  const settle = (payload) => {
    if (settled) return;
    settled = true;
    if (payload?.takeover) res.status(409).json({ error: 'session mismatch', code: 66 });
    else if (payload === null) res.status(204).end();
    else res.json(payload);
  };
  _ccAnswerWaitResolvers.push(settle);
  // If an answer is already pending (rare), drain it now.
  if (_ccPendingAnswer) {
    const drained = _ccPendingAnswer;
    _ccPendingAnswer = null;
    while (_ccAnswerWaitResolvers.length) _ccAnswerWaitResolvers.shift()(drained);
  }
  const timer = setTimeout(() => {
    const idx = _ccAnswerWaitResolvers.indexOf(settle);
    if (idx >= 0) _ccAnswerWaitResolvers.splice(idx, 1);
    settle(null);
  }, CC_WAIT_LONG_POLL_MS);
  req.on('close', () => {
    clearTimeout(timer);
    const idx = _ccAnswerWaitResolvers.indexOf(settle);
    if (idx >= 0) _ccAnswerWaitResolvers.splice(idx, 1);
  });
});

// CRC: crc-Server.md | Seq: seq-cc-run.md | R180, R195, R196
app.get('/api/cc/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  for (const evt of _ccEventBuffer) {
    res.write(`data: ${JSON.stringify(evt)}\n\n`);
  }
  _ccEventBuffer.length = 0;
  _ccStreamSubs.add(res);
  let lastPresence = _ccPresence();
  // R195: SSE keepalive every 5s. R196: emit error on mid-run not_connected.
  const tick = setInterval(() => {
    try { res.write(`: keepalive\n\n`); } catch {}
    const cur = _ccPresence();
    if (lastPresence === 'running' && cur === 'not_connected') {
      try {
        res.write(`data: ${JSON.stringify({
          type: 'error',
          data: { message: "Claude Code disconnected mid-run. The cache is in a partial state; click ↺ Clear & Redo to start fresh." }
        })}\n\n`);
      } catch {}
    }
    lastPresence = cur;
  }, 5000);
  req.on('close', () => {
    clearInterval(tick);
    _ccStreamSubs.delete(res);
  });
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

// CRC: crc-Server.md | Seq: seq-elicitor.md, seq-bookmarklet-run.md | R19, R27, R149
app.post('/api/elicit', async (req, res) => {
  const { existingContext } = req.body;
  const { tabs } = await tabsForRequest(req);
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

// CRC: crc-Server.md | Seq: seq-elicitor.md, seq-bookmarklet-run.md | R149
app.post('/api/elicit/synthesize', async (req, res) => {
  const { existingContext, qa } = req.body;
  const { tabs } = await tabsForRequest(req);
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
    // CRC: crc-Server.md | Seq: seq-bookmarklet-run.md | R149
    const { tabs, error: tabError } = await tabsForRequest(req);

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
