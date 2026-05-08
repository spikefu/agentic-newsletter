---
name: newsletter-pipeline
description: Inside-out newsletter pipeline runner. Bootstraps a Claude Code session into the wait-loop that drives the per-phase newsletter agents. Loaded by the /newsletter slash command (the user-facing entry point) — model auto-invocation is disabled.
disable-model-invocation: true
allowed-tools: Bash(newsletter *)
---

<!-- CRC: crc-NewsletterSkill.md | Seq: seq-cc-bootstrap.md, seq-cc-run.md | R151, R197, R198, R204 -->

# Newsletter pipeline skill

You are bootstrapping the **inside-out newsletter pipeline**. The
`newsletter` CLI on this machine is the broker between you and
the project's web server. Your job is to register this Claude
Code session with the server, then loop on `newsletter wait`,
dispatching each event you receive.

## How to invoke the CLI

Use `./bin/newsletter <subcommand>` from this project's root. CWD
is already the project root in this CC session, so the relative
path resolves. Don't `export PATH=...` — Bash subprocesses don't
share env across tool calls, so the export burns a turn every
cycle.

**Read output directly from stdout.** Every CLI subcommand emits
markdown sized to fit in a Bash tool result. You don't need to
redirect to a file and then `cat` it back; just run the command
and read what comes back.

If you do want to capture for debugging or cross-cycle comparison,
use `cache/.cc/` (e.g. `./bin/newsletter wait > cache/.cc/last-wait.md`).
Don't write to `/tmp/` — `cache/` is project-local, visible in the
tree, and gets cleaned up by `newsletter purge`.

## Top-of-cycle preflight

Before each pass through the loop, run:

```bash
./bin/newsletter health
```

It prints a one-screen markdown report: server reachability, CC
presence state, whether the local connection matches the server's,
and the three most recent project session JSONLs. If anything's
off, the report includes an `Action:` line telling you exactly what
to do (start the server, re-connect, stop the loop on takeover).
You don't need to parse anything — read it and proceed if all
green.

## Main loop

```bash
./bin/newsletter pull
```

One command that (re-)registers your session if needed and then
blocks for work. Idempotent — call it every cycle. No separate
`connect` step is necessary; `pull` handles it.

`pull` blocks until the user clicks "Run with Claude Code" in the
web UI (or calls `/newsletter`). It returns a single work item as
markdown:

```
# Work item received

runId: run-...
kind:  run
mode:  fresh

Tabs in scope (N):
  1. Title
     https://...
  ...

Next:
  1. newsletter event run-started '{"runId":"run-..."}'
  2. newsletter next
  3. Follow the prompt's instructions.
```

When you receive a work item:

1. Push **run-started**:
   ```bash
   ./bin/newsletter event run-started '{"runId":"<id>"}'
   ```
2. Call `./bin/newsletter next` to get the next phase's prompt.
   The CLI carries the pipeline structure; you don't have to
   remember it.
3. **Read the first line of `next`'s output.** If it starts with
   `Run as: <subagent-name>`, dispatch that subagent via the
   Agent tool. The CLI's directive is short by design — it tells
   you which subagent to spawn and the single-line instruction to
   give it (which is always: *"Run `./bin/newsletter prompt` and
   follow what it tells you."*). The subagent fetches its full
   phase prompt itself; you never carry the phase prompt in your
   own context.
   - Subagents you'll see: `newsletter-elicitor`,
     `newsletter-discovery`, `newsletter-research`,
     `newsletter-podcast`.
   - Do NOT do the phase's work yourself when a `Run as:` line
     is present. Inline orchestration looks faster but spends
     orchestration tokens on work the per-phase subagent should
     own — and the cost telemetry's per-phase breakdown
     collapses into "Orchestration."
4. If `next`'s output has no `Run as:` line, run its instructions
   yourself. (Render and done fall into this case — they're
   trivial CLI calls, not model work.)
5. When the subagent finishes (artifact written) or you finish
   the inline step, loop back to step 2: `./bin/newsletter next`
   checks the artifact, advances the state machine, and returns
   either the next phase's prompt or a DONE message.
6. When `./bin/newsletter next` says DONE, push **run-finished**:
   ```bash
   ./bin/newsletter event run-finished '{"runId":"<id>"}'
   ```
7. Loop back to `./bin/newsletter wait` (or `./bin/newsletter pull`)
   for the next event.

## Event vocabulary

`newsletter event <type>` accepts the same types the API-mode
pipeline uses:

- `run-started` / `run-finished` — lifecycle markers (required).
- `status` — free-form text status for the activity log.
- `phase` — phase change (e.g. `{"phase":"discover"}`).
- `clusters` — the discover output, fanned to the UI.
- `newsletter` — the research output.
- `output_ready` — final HTML/PDF written.
- `done` — pipeline finished.

## Tools

- `newsletter fetch <url>` — fetches a page via the project's
  CDP wrapper (sees logged-in pages, extracts publication dates).
  **Use this** in subagents instead of WebFetch.
- `newsletter event <type> <json>` — push status to the UI.
- `newsletter status` — debug helper, prints current presence
  and connection info.

## Failure modes

If a CLI invocation exits with code 64, 65, or 66, **stop
looping**:

- **64** — server unreachable. Tell the user to start the server
  with `npm start` from the project directory, then they can
  invoke the skill again.
- **65** — no session connected. The connect step must have
  failed; surface the error.
- **66** — another Claude Code session is connected. This
  session is no longer authorized; exit cleanly.

These three exits are the catastrophic-loop-stop contract.
