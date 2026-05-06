// CRC: crc-CrankHandle.md | Seq: seq-cc-run.md | R210, R211
//
// Read/write the CLI state machine and run-config artifacts.
// state.json holds the current phase + runId; run.json holds
// the run's tab list and config (populated by the server when
// it accepts POST /api/cc/run).

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT   = path.dirname(__dirname);
export const CACHE_DIR        = path.join(PROJECT, 'cache');
export const STATE_FILE       = path.join(CACHE_DIR, 'state.json');
export const RUN_FILE         = path.join(CACHE_DIR, 'run.json');
export const CLUSTERS_FILE    = path.join(CACHE_DIR, 'clusters.json');
export const NEWSLETTER_FILE  = path.join(CACHE_DIR, 'newsletter.json');
export const NEWSLETTER_HTML  = path.join(CACHE_DIR, 'newsletter.html');
export const NEWSLETTER_PDF   = path.join(CACHE_DIR, 'newsletter.pdf');
export const PODCAST_SCRIPT   = path.join(CACHE_DIR, 'podcast-script.txt');
export const ELICITOR_CONTEXT = path.join(CACHE_DIR, 'elicitor-context.txt');
export const ELICITOR_QA      = path.join(CACHE_DIR, 'elicitor-qa.json');
export const COST_OFFSETS     = path.join(CACHE_DIR, 'cost-offsets.json');

export function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return null; }
}

export function writeState(state) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function readRun() {
  try { return JSON.parse(fs.readFileSync(RUN_FILE, 'utf8')); } catch { return null; }
}
