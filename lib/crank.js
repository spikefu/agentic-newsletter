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
  ELICITOR_CONTEXT, readRun, readState, writeState
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
    'If you ask, pipe a small markdown stencil into elicit-await on stdin:',
    '',
    '    ./bin/newsletter elicit-await <<\'EOF\'',
    '    **Suggestion:** <one-sentence framing of the angle gap>',
    '    - <Question 1>',
    '    - <Question 2>',
    '    EOF',
    '',
    'No JSON, no braces — just `**Suggestion:**` and `- bullet` questions.',
    'The CLI parses your markdown, pushes the questions to the UI, and blocks',
    'until the user submits answers (or skips with an empty body). When it',
    'returns, the answers JSON is on stdout. Run it in the foreground — DO NOT',
    'background it; DO NOT tail an output file. The blocking call IS the wait.',
    '',
    'After answers arrive (or on skip): synthesize a 3–5 sentence context block',
    'and submit it via:',
    '',
    '    ./bin/newsletter submit-context <<\'EOF\'',
    '    <your 3–5 sentence context block — plain text, no markdown>',
    '    EOF',
    '',
    'On a successful submit, exit. The orchestrator will run',
    '`./bin/newsletter next` to advance.',
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
  let elicCtx = '';
  try { elicCtx = fs.readFileSync(ELICITOR_CONTEXT, 'utf8').trim(); } catch {}
  return [
    'Phase: DISCOVER.',
    '',
    elicCtx ? '─── User context (from elicit) ───' : '',
    elicCtx || '',
    elicCtx ? '─── End user context ───' : '',
    elicCtx ? '' : '',
    'Fetch each URL below using `./bin/newsletter fetch <url>` (NOT',
    'WebFetch — `./bin/newsletter fetch` uses CDP against the user\'s real Chrome',
    'profile, sees logged-in pages, and extracts publication dates).',
    '',
    'Tabs to fetch:',
    tabUrlList(run),
    '',
    'After fetching, group the content into 3–8 thematic clusters and submit',
    'the result via stdin to **`./bin/newsletter submit-clusters`**, in the',
    'markdown shape below. The CLI parses, validates, and persists — you',
    'write prose-shaped markdown, not JSON.',
    '',
    'Submit form:',
    '',
    '    ./bin/newsletter submit-clusters <<\'EOF\'',
    '    ## <Cluster Title>',
    '    ... (the markdown from the shape below)',
    '    EOF',
    '',
    'Use a single-quoted heredoc (`<<\'EOF\'`) so literal `$` and backticks in',
    'your content do not get expanded by the shell.',
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
    'On a successful submit-clusters, exit. The orchestrator will run',
    '`./bin/newsletter next` to advance to research. If submit-clusters',
    'reports parse or validation errors, fix the markdown and resubmit.',
  ].join('\n') + '\n';
}

function researchPrompt(_run) {
  const styleOverride = readResearchPromptOverride();
  let clustersMd = '';
  try { clustersMd = fs.readFileSync(CLUSTERS_MD, 'utf8').trimEnd(); } catch {}
  let elicCtx = '';
  try { elicCtx = fs.readFileSync(ELICITOR_CONTEXT, 'utf8').trim(); } catch {}
  return [
    'Phase: RESEARCH.',
    '',
    elicCtx ? '─── User context (from elicit) ───' : '',
    elicCtx || '',
    elicCtx ? '─── End user context ───' : '',
    elicCtx ? '' : '',
    'The thematic clusters from discovery are below — pre-chewed for you,',
    'no JSON to parse. For 3–8 of the most interesting `notable_links`',
    'across clusters, run `./bin/newsletter fetch <url>` to add depth. Use',
    '`./bin/newsletter search <query>` if you need supplemental context.',
    '',
    'Wrap any search query in **single quotes** (not double quotes) so',
    'literal `$` or backticks in the query do not get expanded by the',
    'shell. Example: `./bin/newsletter search \'Cloudflare $100 cap\'`.',
    '',
    '─── Discovery clusters ───',
    clustersMd || '(cache/clusters.md missing — re-run discover)',
    '─── End clusters ───',
    '',
    'Submit your finished newsletter as markdown. Two-step form:',
    '  1. Use the Write tool to write the markdown to',
    '     `cache/newsletter.md`. Long content goes through Write to',
    '     avoid the heredoc length limits CC enforces on Bash.',
    '  2. Run `./bin/newsletter submit-newsletter` (no args). The CLI',
    '     parses, validates, and persists. Inline links use',
    '     `[text](url)` (not `<a href>`); the CLI converts them.',
    '',
    'Heredoc form is also accepted for short content / testing:',
    '',
    '    ./bin/newsletter submit-newsletter <<\'EOF\'',
    '    # <Newsletter title>',
    '    ... (the markdown from the shape below)',
    '    EOF',
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
    'On a successful submit-newsletter, exit. The orchestrator will run',
    '`./bin/newsletter next` to advance to render. If submit-newsletter',
    'reports parse or validation errors, fix the markdown and resubmit.',
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

function podcastPrompt(_run) {
  let newsletterMd = '';
  try { newsletterMd = fs.readFileSync(NEWSLETTER_MD, 'utf8').trimEnd(); } catch {}
  return [
    'Phase: PODCAST.',
    '',
    'The finished newsletter is below — pre-chewed for you, no JSON to parse.',
    'Convert it to a 3–6 minute spoken-word script following the rules in the',
    'shared system prompt. Two-step submit form:',
    '  1. Use the Write tool to write the script to',
    '     `cache/podcast-script.txt` (plain text, no markdown, no bullets).',
    '  2. Run `./bin/newsletter submit-podcast` (no args). The CLI validates,',
    '     reports word count, and persists.',
    '',
    'Heredoc form is also accepted for short content / testing:',
    '',
    '    ./bin/newsletter submit-podcast <<\'EOF\'',
    '    <your spoken-word script — plain text, no markdown, no bullets>',
    '    EOF',
    '',
    '─── Newsletter ───',
    newsletterMd || '(cache/newsletter.md missing — research has not run)',
    '─── End newsletter ───',
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

// Subagent name per model-work phase. Render and done aren't in this
// table because the orchestrator handles them inline (CLI command,
// no model work). The dispatchDirective uses this to name the agent
// the orchestrator should spawn.
const SUBAGENT_FOR_PHASE = {
  elicit:   'newsletter-elicitor',
  discover: 'newsletter-discovery',
  research: 'newsletter-research',
  podcast:  'newsletter-podcast',
};

const PHASE_LABEL = {
  elicit: 'ELICIT', discover: 'DISCOVER', research: 'RESEARCH',
  podcast: 'PODCAST', render: 'RENDER', done: 'DONE',
};

// Short, orchestrator-facing message: "spawn this subagent and tell
// it to run `./bin/newsletter prompt`." Keeps the orchestrator's
// context tiny — the actual phase prompt only enters the subagent's
// context when the subagent runs `prompt`.
function dispatchDirective(phase) {
  const subagent = SUBAGENT_FOR_PHASE[phase];
  if (!subagent) return null;
  return [
    `Run as: ${subagent}`,
    '',
    'Dispatch this subagent via the Agent tool. The single instruction',
    'to give it is:',
    '',
    '    Run `./bin/newsletter prompt` and follow what it tells you.',
    '',
    'When the subagent finishes, run `./bin/newsletter next` again.',
  ].join('\n') + '\n';
}

// CRC: crc-CrankHandle.md | R163, R164
//
// Subagent-facing: the full prompt for whatever phase state.json
// currently records. If the prior `next` recorded a retry (parse or
// schema failure), this returns the retry shape so the subagent sees
// the errors. Otherwise it returns the regular phase prompt.
export async function currentPhasePrompt() {
  const run = readRun();
  if (!run) return 'No run in progress. Run `./bin/newsletter wait` (or `pull`) first.\n';
  const state = readState();
  if (!state || !state.phase) return 'No phase in state. Run `./bin/newsletter next` first.\n';
  const phase = state.phase;
  if (state.retry?.errors?.length) {
    return validationFailedPrompt(PHASE_LABEL[phase] || phase.toUpperCase(),
      state.retry.errors, state.retry.hint);
  }
  switch (phase) {
    case 'elicit':   return elicitPrompt(run);
    case 'discover': return discoverPrompt(run);
    case 'research': return researchPrompt(run);
    case 'podcast':  return podcastPrompt(run);
    case 'render':   return renderPrompt(run);
    case 'done':     return donePrompt(run);
    default:         return `Unknown phase '${phase}'. Run \`./bin/newsletter next\`.\n`;
  }
}

// CRC: crc-CrankHandle.md | R163, R164
//
// Orchestrator-facing: validate the prior phase's artifact, advance
// state, and emit a short dispatch directive (for model-work phases)
// or inline content (for render / done). The full phase prompt
// content lives in `currentPhasePrompt`, which the subagent retrieves
// by running `./bin/newsletter prompt`.
export async function nextPhasePrompt() {
  const run = readRun();
  if (!run) {
    return 'No run in progress. Trigger one from the UI ("Run with Claude Code") or via /newsletter.\n';
  }

  const setPhase = (phase, retry) => {
    const next = { runId: run.runId, phase };
    if (retry) next.retry = retry;
    writeState(next);
  };
  const emit = (phase) =>
    SUBAGENT_FOR_PHASE[phase] ? dispatchDirective(phase)
    : phase === 'render' ? renderPrompt(run)
    : phase === 'done'   ? donePrompt(run)
    : `Unknown phase '${phase}'.\n`;

  // Phase derivation from cache state. Order:
  //   (no elicitor-context) → ELICIT
  //   (context, no clusters.md) → DISCOVER
  //   (clusters parsed/validated, no newsletter.md) → RESEARCH
  //   (newsletter parsed/validated, no html) → RENDER
  //   (html present) → DONE  (or PODCAST if run.kind === 'podcast')
  if (run.kind === 'podcast') {
    if (!fs.existsSync(NEWSLETTER_FILE)) {
      process.exitCode = 65;
      setPhase('podcast', {
        errors: ['cache/newsletter.json missing — cannot generate a podcast script.'],
        hint: 'Run a regular newsletter pipeline first, then try again.',
      });
      return dispatchDirective('podcast');
    }
    setPhase('podcast');
    return emit('podcast');
  }

  // Regular pipeline.
  if (!fs.existsSync(ELICITOR_CONTEXT)) { setPhase('elicit'); return emit('elicit'); }
  if (!fs.existsSync(CLUSTERS_MD))      { setPhase('discover'); return emit('discover'); }

  // Discover artifact validation.
  const clustersMd = fs.readFileSync(CLUSTERS_MD, 'utf8');
  const { result: clusters, errors: parseErrs } = parseClusters(clustersMd);
  if (parseErrs.length) {
    process.exitCode = 65;
    logParseFailure(CACHE_DIR, 'DISCOVER', run.runId, clustersMd, parseErrs);
    setPhase('discover', { errors: parseErrs, hint: 'Fix the issues above in cache/clusters.md, then exit; the orchestrator will re-dispatch via `./bin/newsletter next`.' });
    return dispatchDirective('discover');
  }
  const clusterErrs = validateClusters(clusters);
  if (clusterErrs.length) {
    process.exitCode = 65;
    logParseFailure(CACHE_DIR, 'DISCOVER', run.runId, clustersMd, clusterErrs);
    setPhase('discover', { errors: clusterErrs, hint: 'Fix the issues above in cache/clusters.md, then exit; the orchestrator will re-dispatch via `./bin/newsletter next`.' });
    return dispatchDirective('discover');
  }
  fs.writeFileSync(CLUSTERS_FILE, JSON.stringify(clusters, null, 2));

  if (!fs.existsSync(NEWSLETTER_MD)) { setPhase('research'); return emit('research'); }

  // Research artifact validation.
  const newsletterMd = fs.readFileSync(NEWSLETTER_MD, 'utf8');
  const { result: newsletter, errors: newsletterParseErrs } = parseNewsletter(newsletterMd);
  if (newsletterParseErrs.length) {
    process.exitCode = 65;
    logNewsletterParseFailure(CACHE_DIR, run.runId, newsletterMd, newsletterParseErrs);
    setPhase('research', { errors: newsletterParseErrs, hint: 'Fix the issues above in cache/newsletter.md, then exit; the orchestrator will re-dispatch via `./bin/newsletter next`.' });
    return dispatchDirective('research');
  }
  const newsletterErrs = validateNewsletter(newsletter);
  if (newsletterErrs.length) {
    process.exitCode = 65;
    logNewsletterParseFailure(CACHE_DIR, run.runId, newsletterMd, newsletterErrs);
    setPhase('research', { errors: newsletterErrs, hint: 'Fix the issues above in cache/newsletter.md, then exit; the orchestrator will re-dispatch via `./bin/newsletter next`.' });
    return dispatchDirective('research');
  }
  fs.writeFileSync(NEWSLETTER_FILE, JSON.stringify(newsletter, null, 2));

  if (!fs.existsSync(NEWSLETTER_HTML)) { setPhase('render'); return emit('render'); }
  setPhase('done');
  return emit('done');
}
