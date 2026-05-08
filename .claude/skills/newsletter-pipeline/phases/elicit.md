<!-- CRC: crc-NewsletterSkill.md | Seq: seq-cc-elicitor.md | R199, R205 -->

# Elicit phase

The CLI emits the canonical elicit-phase prompt via `newsletter
next` — that prompt is the source of truth. This file is
supporting documentation.

## What elicit does

1. Read `cache/run.json` for the tab list.
2. Decide whether 2–3 short clarifying questions would help, or
   if the tabs are clear enough to skip.
3. **Ask path:** write `cache/elicitor-questions.json`, then run
   ONE command — `newsletter elicit-await cache/elicitor-questions.json`.
   That single foreground command pushes the questions to the UI
   and blocks until the user submits answers (or skips). Run it in
   the foreground; do NOT background it, do NOT tail an output
   file. The blocking call is the wait.
4. **Skip path** (or after answers arrive): synthesize a 3–5
   sentence context block to `cache/elicitor-context.txt`.
5. Run `newsletter next` to advance to discover.

`elicit-await` is a single-slot exchange separate from the main
`wait` loop — it's run-scoped and short-lived. (Legacy
`ask-elicitor` / `await-answers` subcommands still exist for
testing, but the production path uses the combined form to avoid
the "background-and-tail" failure mode that two-step blocking
choreography invites in weaker subagent models.)
