// CRC: crc-CostTracker.md | Seq: seq-cc-run.md | R154, R174, R175, R176, R177, R178, R179, R181, R182, R183, R212
//
// Cost telemetry for CC mode. Reads only the connected
// top-level session and its CC-managed subagent transcripts;
// other sessions in the project-hash dir are filesystem-isolated
// from us by CC's layout. Stateless and event-paced.

import fs from 'fs';
import path from 'path';
import os from 'os';
import { calcCost } from '../agents/pricing.js';
import { CACHE_DIR, COST_OFFSETS } from './state.js';

// CRC: crc-CostTracker.md | R212
export function readOffsets() {
  try { return JSON.parse(fs.readFileSync(COST_OFFSETS, 'utf8')); } catch { return {}; }
}
export function writeOffsets(offsets) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(COST_OFFSETS, JSON.stringify(offsets, null, 2));
}

// Project-hash dir mirrors CC's convention: cwd with every
// non-alphanumeric character replaced by '-'.
function projectHashDir() {
  const hash = process.cwd().replace(/[^a-zA-Z0-9]/g, '-');
  return path.join(os.homedir(), '.claude/projects', hash);
}

// CRC: crc-CostTracker.md | R177
//
// Matches the newsletter CLI in any of its invocation forms:
// `newsletter ...` (PATH-resolved), `./bin/newsletter ...`,
// `bin/newsletter ...`, or absolute-path forms.
const NEWSLETTER_CMD_RE = /(?:^|\s|\/)newsletter\s/;

function turnTouchesNewsletter(content) {
  if (!Array.isArray(content)) return false;
  for (const block of content) {
    if (block?.type !== 'tool_use') continue;
    const name = block.name || '';
    if (name === 'Bash') {
      const cmd = block.input?.command;
      if (typeof cmd === 'string' && NEWSLETTER_CMD_RE.test(cmd.trim())) return true;
    }
    if (name === 'Agent' || name === 'Task') {
      const sub = block.input?.subagent_type || block.input?.agent || '';
      if (typeof sub === 'string' && sub.startsWith('newsletter-')) return true;
    }
  }
  return false;
}

// CRC: crc-CostTracker.md | R178
// CC writes each subagent's metadata to agent-<id>.meta.json with
// `{ "agentType": "newsletter-discovery", "description": "..." }`.
// agentType is the authoritative agent slug. Returns the lowercase
// slug ("discovery"); makeEvents() builds the capitalized label
// from it. Lowercase matches the public/index.html step_cost
// handler, which buckets by `data.agent`.
function agentSlugForSubagent(metaPath, fallbackId) {
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const t = meta.agentType || '';
    if (t.startsWith('newsletter-')) {
      return t.slice('newsletter-'.length);
    }
    return null;     // signals "not a newsletter subagent — skip"
  } catch {
    return `subagent-${fallbackId.slice(0, 8)}`;
  }
}

// Scan newly-appended assistant lines from a JSONL file.
function scanFromOffset(filePath, fromOffset, filterFn) {
  let stat;
  try { stat = fs.statSync(filePath); } catch { return { events: [], newOffset: fromOffset }; }
  if (stat.size <= fromOffset) return { events: [], newOffset: fromOffset };
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(stat.size - fromOffset);
  fs.readSync(fd, buf, 0, buf.length, fromOffset);
  fs.closeSync(fd);
  const events = [];
  for (const line of buf.toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type !== 'assistant') continue;
    const message = entry.message;
    if (!message?.usage) continue;
    if (filterFn && !filterFn(message.content)) continue;
    events.push({
      timestamp: entry.timestamp || null,
      model:     message.model || 'unknown',
      usage:     message.usage,
    });
  }
  return { events, newOffset: stat.size };
}

// Build per-event records from a scanned set. `agent` is the
// lowercase slug (matches the public/index.html bucket comparison);
// the human-readable display label is derived from it.
function makeEvents(scanned, agent) {
  const display = agent.charAt(0).toUpperCase() + agent.slice(1);
  const out = [];
  let total = 0;
  for (const e of scanned) {
    let cost = 0;
    try { cost = calcCost(e.model, e.usage); } catch { cost = 0; }
    out.push({
      agent,
      label:              `${display} · step`,
      model:              e.model,
      input_tokens:       e.usage.input_tokens                || 0,
      output_tokens:      e.usage.output_tokens               || 0,
      cache_read_tokens:  e.usage.cache_read_input_tokens     || 0,
      cache_write_tokens: e.usage.cache_creation_input_tokens || 0,
      cost,
      timestamp:          e.timestamp,
    });
    total += cost;
  }
  return { events: out, total };
}

// CRC: crc-CostTracker.md | R174, R175, R176, R178, R181, R182, R183
export function computeCostEvents(connectedSessionId) {
  if (!connectedSessionId) return { events: [], total: 0 };
  const dir = projectHashDir();
  const offsets = readOffsets();
  // Persisted cross-call running total so each step_cost event carries
  // a true cumulative-cost stamp the UI can use for its live display.
  const carriedOver = offsets._runningTotal || 0;
  const allEvents = [];
  let runningTotal = 0;

  // 1) Top-level connected session — tool-call signature filter.
  const topPath   = path.join(dir, `${connectedSessionId}.jsonl`);
  const topOffset = offsets[connectedSessionId] || 0;
  const top = scanFromOffset(topPath, topOffset, turnTouchesNewsletter);
  const topEv = makeEvents(top.events, 'orchestration');
  allEvents.push(...topEv.events);
  runningTotal += topEv.total;
  offsets[connectedSessionId] = top.newOffset;

  // 2) Subagents nested under <connectedSessionId>/subagents/.
  const subDir = path.join(dir, connectedSessionId, 'subagents');
  let subFiles = [];
  try { subFiles = fs.readdirSync(subDir).filter(f => f.endsWith('.jsonl')); } catch {}
  for (const file of subFiles) {
    const subId    = file.replace(/^agent-/, '').replace(/\.jsonl$/, '');
    const metaPath = path.join(subDir, file.replace(/\.jsonl$/, '.meta.json'));
    const agent    = agentSlugForSubagent(metaPath, subId);
    if (agent === null) continue;          // non-newsletter subagent — skip
    const subPath   = path.join(subDir, file);
    const offsetKey = `agent-${subId}`;
    const fromOff   = offsets[offsetKey] || 0;
    const scanned   = scanFromOffset(subPath, fromOff, /* no filter */ null);
    const ev        = makeEvents(scanned.events, agent);
    allEvents.push(...ev.events);
    runningTotal += ev.total;
    offsets[offsetKey] = scanned.newOffset;
  }

  // Stamp each event with the true cumulative running total at the
  // point it was emitted. Sort by timestamp so cross-stream order is
  // sensible; subagent events typically follow the orchestration
  // turn that dispatched them.
  allEvents.sort((a, b) => {
    const ta = a.timestamp ? Date.parse(a.timestamp) : 0;
    const tb = b.timestamp ? Date.parse(b.timestamp) : 0;
    return ta - tb;
  });
  let cumulative = carriedOver;
  for (const ev of allEvents) {
    cumulative += ev.cost;
    ev.running_total = cumulative;
  }
  offsets._runningTotal = cumulative;

  writeOffsets(offsets);
  return { events: allEvents, total: runningTotal, runningTotal: cumulative };
}
