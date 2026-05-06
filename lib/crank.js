// CRC: crc-CrankHandle.md | Seq: seq-cc-run.md | R153, R163, R164, R199, R200, R205, R206, R207, R208, R209, R217
//
// Phase choreography: read state, validate the prior phase's
// artifact, emit the next phase's prompt. System prompts come
// from agents/*.js so both modes share one source of truth.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SYSTEM as DISCOVER_SYSTEM } from '../agents/discoveryAgent.js';
import { ELICIT_SYSTEM, SYNTHESIZE_SYSTEM } from '../agents/elicitorAgent.js';
import { buildSystem as buildResearchSystem } from '../agents/researchAgent.js';
import { SYSTEM as PODCAST_SYSTEM } from '../agents/podcastAgent.js';
import {
  CACHE_DIR, CLUSTERS_FILE, NEWSLETTER_FILE, NEWSLETTER_HTML,
  ELICITOR_CONTEXT, readRun, writeState
} from './state.js';
import { parseClusters, logParseFailure } from './parseClusters.js';
import { parseNewsletter, logNewsletterParseFailure } from './parseNewsletter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLUSTERS_SCHEMA_PATH   = path.join(__dirname, 'schemas/clusters.json');
const NEWSLETTER_SCHEMA_PATH = path.join(__dirname, 'schemas/newsletter.json');
const RESEARCH_PROMPT_PATH   = path.join(path.dirname(__dirname), 'research-prompt.md');
const CLUSTERS_MD            = path.join(CACHE_DIR, 'clusters.md');
const NEWSLETTER_MD          = path.join(CACHE_DIR, 'newsletter.md');

export function loadClustersSchema()  { return JSON.parse(fs.readFileSync(CLUSTERS_SCHEMA_PATH, 'utf8')); }
export function loadNewsletterSchema() { return JSON.parse(fs.readFileSync(NEWSLETTER_SCHEMA_PATH, 'utf8')); }

// ── Lightweight structural validators ──
// We trust the model's adherence to the schema in the prompt; this
// catches the gross-shape failures that would crash downstream
// consumers (R164). Slice 3+ may swap to ajv if shape drift becomes
// noisy.

export function validateClusters(doc) {
  const errs = [];
  if (!doc || typeof doc !== 'object') return ['root must be an object'];
  if (!Array.isArray(doc.clusters)) errs.push('missing/non-array `clusters`');
  else if (doc.clusters.length < 3 || doc.clusters.length > 8)
    errs.push(`clusters length ${doc.clusters.length} not in [3, 8]`);
  else for (const [i, c] of doc.clusters.entries()) {
    for (const k of ['id', 'title', 'theme_summary']) {
      if (typeof c[k] !== 'string' || !c[k]) errs.push(`clusters[${i}].${k} missing or non-string`);
    }
    if (!Array.isArray(c.sources)) errs.push(`clusters[${i}].sources missing/non-array`);
    else for (const [j, s] of c.sources.entries()) {
      for (const k of ['url', 'page_title', 'summary']) {
        if (typeof s[k] !== 'string') errs.push(`clusters[${i}].sources[${j}].${k} missing/non-string`);
      }
      if (!Array.isArray(s.key_points)) errs.push(`clusters[${i}].sources[${j}].key_points missing/non-array`);
    }
  }
  return errs;
}

export function validateNewsletter(doc) {
  const errs = [];
  if (!doc || typeof doc !== 'object') return ['root must be an object'];
  for (const k of ['title', 'subtitle', 'intro', 'closing', 'references']) {
    if (typeof doc[k] !== 'string') errs.push(`${k} missing or non-string`);
  }
  if (!Array.isArray(doc.sections)) errs.push('sections missing/non-array');
  else for (const [i, s] of doc.sections.entries()) {
    for (const k of ['cluster_id', 'headline', 'body']) {
      if (typeof s[k] !== 'string') errs.push(`sections[${i}].${k} missing/non-string`);
    }
    if (!Array.isArray(s.key_links)) errs.push(`sections[${i}].key_links missing/non-array`);
  }
  return errs;
}

function tabUrlList(run) {
  if (!run?.tabs?.length) return '  (no tabs in cache/run.json)';
  return run.tabs.map(t => `  - ${t.url}`).join('\n');
}

function readResearchPromptOverride() {
  try { return fs.readFileSync(RESEARCH_PROMPT_PATH, 'utf8').trim(); }
  catch { return ''; }
}

// ── Phase prompts ──

function elicitPrompt(run) {
  return [
    'Phase: ELICIT.',
    '',
    `Read the tab list (${run.tabs?.length || 0} URLs) and decide whether to ask`,
    '2–3 short clarifying questions before discovery starts. If the context is',
    `already clear, skip and synthesize a 3–5 sentence context block directly.`,
    '',
    'Tabs:',
    tabUrlList(run),
    '',
    'If you ask: write the questions to cache/elicitor-questions.json as',
    '`{"questions": ["...", "..."], "suggestion": "..."}` and run:',
    '  ./bin/newsletter elicit-await cache/elicitor-questions.json',
    'That single command pushes the questions to the UI and blocks until the',
    'user submits answers (UI POST /api/cc/answer) or skips (empty body). The',
    'CLI writes cache/elicitor-qa.json and prints the answers to stdout on',
    'unblock. Run it in the foreground — DO NOT background it; DO NOT tail',
    'an output file. The blocking call IS the wait.',
    '',
    'After answers arrive (or on skip): synthesize a 3–5 sentence context block',
    `for the agents and write it to ${ELICITOR_CONTEXT}.`,
    '',
    'Then run: ./bin/newsletter next',
    '',
    '─── Shared system prompt (decide-to-ask, matches API-mode) ───',
    ELICIT_SYSTEM,
    '─── End decide-to-ask prompt ───',
    '',
    '─── Shared synthesize prompt (matches API-mode synthesize) ───',
    SYNTHESIZE_SYSTEM,
    '─── End synthesize prompt ───',
  ].join('\n') + '\n';
}

function discoverPrompt(run) {
  return [
    'Phase: DISCOVER.',
    '',
    'Read cache/elicitor-context.txt (if present) for the synthesized user',
    'context. Then fetch each URL below using `./bin/newsletter fetch <url>` (NOT',
    'WebFetch — `./bin/newsletter fetch` uses CDP against the user\'s real Chrome',
    'profile, sees logged-in pages, and extracts publication dates).',
    '',
    'Tabs to fetch:',
    tabUrlList(run),
    '',
    'After fetching, group the content into 3–8 thematic clusters and **write',
    'the result to cache/clusters.md** in the markdown shape below. The CLI',
    'parses this into the on-disk JSON the renderer reads — you write prose-',
    'shaped markdown, not JSON.',
    '',
    '─── cache/clusters.md shape ───',
    '## <Cluster Title>',
    '**Theme:** <2–3 sentences on what this cluster is about and why it matters.>',
    '',
    '### Source: <url>',
    '- **Page title:** <title as it appears on the page>',
    '- **Published:** <date as it appeared, or "(unknown)">',
    '- **Summary:** <2–3 sentences describing what the source covers>',
    '- **Key points:**',
    '  - <key point 1>',
    '  - <key point 2>',
    '- **Notable links:**',
    '  - <url worth following>',
    '  - <url worth following>',
    '',
    '### Source: <next-url>',
    '... (repeat for each source in this cluster)',
    '',
    '## <Next Cluster Title>',
    '... (repeat for each cluster)',
    '─── End shape ───',
    '',
    '3–8 clusters total; each cluster has at least one source. The CLI',
    'derives the cluster `id` slug from the title — do not write one. If a',
    'date is not available, write `(unknown)`. If an array has no entries,',
    'omit the indented bullets entirely.',
    '',
    '─── Shared system prompt (rules + date handling, ignore tool refs) ───',
    DISCOVER_SYSTEM,
    '─── End shared prompt ───',
    '',
    'When cache/clusters.md is written, run: ./bin/newsletter next',
    '(the CLI parses the markdown, validates the shape, and either advances',
    'or returns errors for retry.)',
  ].join('\n') + '\n';
}

function researchPrompt(_run) {
  const styleOverride = readResearchPromptOverride();
  let clustersMd = '';
  try { clustersMd = fs.readFileSync(CLUSTERS_MD, 'utf8').trimEnd(); } catch {}
  return [
    'Phase: RESEARCH.',
    '',
    'The thematic clusters from discovery are below — pre-chewed for you,',
    'no JSON to parse. For 3–8 of the most interesting `notable_links`',
    'across clusters, run `./bin/newsletter fetch <url>` to add depth. Use',
    '`./bin/newsletter search <query>` if you need supplemental context.',
    '',
    'Wrap any search query in **single quotes** (not double quotes) so',
    'literal `$` or backticks in the query do not get expanded by the',
    'shell. Example: `./bin/newsletter search \'Cloudflare $100 cap\'`.',
    '',
    '─── Discovery clusters (cache/clusters.md) ───',
    clustersMd || '(cache/clusters.md missing — re-run discover)',
    '─── End clusters ───',
    '',
    '**Write the newsletter to cache/newsletter.md** in the markdown shape',
    'below. The CLI parses your markdown into the JSON the renderer reads —',
    'you write prose-shaped markdown, not JSON, not raw HTML. Inline links',
    'use `[text](url)` (not `<a href>`); the CLI converts them.',
    '',
    '─── cache/newsletter.md shape ───',
    '# <Newsletter title>',
    '**Subtitle:** <one sentence framing the issue>',
    '',
    '<intro paragraph 1 — set the through-line>',
    '',
    '<intro paragraph 2 — optional>',
    '',
    '## <Section headline>',
    '**Cluster:** <cluster id slug from cache/clusters.md, e.g. ai-reasoning>',
    '',
    '<body paragraph 1 — lead with the most concrete finding>',
    '',
    '<body paragraph 2>',
    '',
    '<body paragraph 3>',
    '',
    '**Key links:**',
    '- [Article title](https://...) (Month Year)',
    '- [Another title](https://...) (Month Year)',
    '',
    '## <Next section headline>',
    '... (3–8 sections total — one per cluster you draw from)',
    '',
    '## Closing',
    '',
    '<closing paragraph>',
    '',
    '## References',
    '',
    '- [Reference title](https://...) (Month Year)',
    '- [Another reference](https://...) (Month Year)',
    '─── End shape ───',
    '',
    'Notes on the shape:',
    '  - `## Closing` and `## References` are reserved heading names — the',
    '    CLI treats them as the closing block and the references list,',
    '    not as ordinary sections. Don\'t use them for normal section titles.',
    '  - Each section needs its `**Cluster:**` line so the renderer can',
    '    associate the section back to its discovery cluster.',
    '  - Body paragraphs are blank-line-separated. Each becomes a `<p>` in',
    '    the rendered HTML. Use `[text](url)` for links and `**strong**` /',
    '    `*em*` for emphasis.',
    '',
    '─── Shared system prompt (rules + style + date handling) ───',
    buildResearchSystem(styleOverride),
    '─── End shared prompt ───',
    '',
    'When cache/newsletter.md is written, run: ./bin/newsletter next',
  ].join('\n') + '\n';
}

function renderPrompt(_run) {
  return [
    'Phase: RENDER.',
    '',
    'No model work needed. Run:',
    '  ./bin/newsletter render',
    '',
    'This generates cache/newsletter.html and cache/newsletter.pdf, then pushes',
    'the `output_ready` and `run-finished` events to the UI itself — you do not',
    'need to push them. When it returns, return to: ./bin/newsletter wait',
  ].join('\n') + '\n';
}

function podcastPrompt(run) {
  return [
    'Phase: PODCAST.',
    '',
    'Read cache/newsletter.json. Convert to a 3–6 minute spoken-word script',
    'following the rules below. Write the result to cache/podcast-script.txt.',
    '',
    `Then run: ./bin/newsletter event podcast-ready '{"runId":"${run.runId}"}'`,
    'And: ./bin/newsletter event run-finished',
    '',
    '─── Shared system prompt (matches API-mode PodcastAgent) ───',
    PODCAST_SYSTEM,
    '─── End shared prompt ───',
  ].join('\n') + '\n';
}

function donePrompt(run) {
  return [
    'Phase: DONE.',
    '',
    `Run ${run.runId} produced cache/newsletter.html and cache/newsletter.pdf.`,
    `Push:`,
    `  ./bin/newsletter event run-finished '{"runId":"${run.runId}"}'`,
    'And return to: ./bin/newsletter wait',
  ].join('\n') + '\n';
}

function validationFailedPrompt(label, errors, retryHint) {
  return [
    `Phase: ${label} (retry — schema validation failed).`,
    '',
    'Errors:',
    ...errors.map(e => `  • ${e}`),
    '',
    retryHint || 'Re-write the artifact with the issues fixed, then run `./bin/newsletter next`.',
  ].join('\n') + '\n';
}

// CRC: crc-CrankHandle.md | R163, R164
export async function nextPhasePrompt() {
  const run = readRun();
  if (!run) {
    return 'No run in progress. Trigger one from the UI ("Run with Claude Code") or via /newsletter.\n';
  }

  // Phase derivation from cache state. The order is:
  //   (no elicitor-context) → ELICIT
  //   (context, no clusters) → DISCOVER
  //   (clusters present, validated) → RESEARCH
  //   (newsletter present, validated) → RENDER
  //   (HTML present) → PODCAST (on-demand) or DONE
  if (run.kind === 'podcast') {
    if (!fs.existsSync(NEWSLETTER_FILE)) {
      return validationFailedPrompt('PODCAST', ['cache/newsletter.json missing — cannot generate a podcast script.'],
        'Run a regular newsletter pipeline first, then try again.');
    }
    writeState({ runId: run.runId, phase: 'podcast' });
    return podcastPrompt(run);
  }

  // Regular run pipeline.
  if (!fs.existsSync(ELICITOR_CONTEXT)) {
    writeState({ runId: run.runId, phase: 'elicit' });
    return elicitPrompt(run);
  }
  if (!fs.existsSync(CLUSTERS_MD)) {
    writeState({ runId: run.runId, phase: 'discover' });
    return discoverPrompt(run);
  }
  // Parse the agent's stencilled markdown into the clusters object.
  const clustersMd = fs.readFileSync(CLUSTERS_MD, 'utf8');
  const { result: clusters, errors: parseErrs } = parseClusters(clustersMd);
  if (parseErrs.length) {
    process.exitCode = 65;
    logParseFailure(CACHE_DIR, 'DISCOVER', run.runId, clustersMd, parseErrs);
    return validationFailedPrompt('DISCOVER', parseErrs,
      'Fix the issues above in cache/clusters.md, then run `./bin/newsletter next`.');
  }
  const clusterErrs = validateClusters(clusters);
  if (clusterErrs.length) {
    process.exitCode = 65;
    logParseFailure(CACHE_DIR, 'DISCOVER', run.runId, clustersMd, clusterErrs);
    return validationFailedPrompt('DISCOVER', clusterErrs,
      'Fix the issues above in cache/clusters.md, then run `./bin/newsletter next`.');
  }
  // Persist the JSON wire format for the renderer / research prompt consumers.
  fs.writeFileSync(CLUSTERS_FILE, JSON.stringify(clusters, null, 2));
  if (!fs.existsSync(NEWSLETTER_MD)) {
    writeState({ runId: run.runId, phase: 'research' });
    return researchPrompt(run);
  }
  // Parse the agent's stencilled markdown into the newsletter object.
  const newsletterMd = fs.readFileSync(NEWSLETTER_MD, 'utf8');
  const { result: newsletter, errors: newsletterParseErrs } = parseNewsletter(newsletterMd);
  if (newsletterParseErrs.length) {
    process.exitCode = 65;
    logNewsletterParseFailure(CACHE_DIR, run.runId, newsletterMd, newsletterParseErrs);
    return validationFailedPrompt('RESEARCH', newsletterParseErrs,
      'Fix the issues above in cache/newsletter.md, then run `./bin/newsletter next`.');
  }
  const newsletterErrs = validateNewsletter(newsletter);
  if (newsletterErrs.length) {
    process.exitCode = 65;
    logNewsletterParseFailure(CACHE_DIR, run.runId, newsletterMd, newsletterErrs);
    return validationFailedPrompt('RESEARCH', newsletterErrs,
      'Fix the issues above in cache/newsletter.md, then run `./bin/newsletter next`.');
  }
  // Persist the JSON wire format for the renderer.
  fs.writeFileSync(NEWSLETTER_FILE, JSON.stringify(newsletter, null, 2));
  if (!fs.existsSync(NEWSLETTER_HTML)) {
    writeState({ runId: run.runId, phase: 'render' });
    return renderPrompt(run);
  }
  writeState({ runId: run.runId, phase: 'done' });
  return donePrompt(run);
}
