---
description: Boot a one-shot newsletter run from inside Claude Code.
---

<!-- CRC: crc-NewsletterSkill.md | Seq: seq-cc-bootstrap.md | R204 -->

You are entering the **inside-out newsletter pipeline**. The
`newsletter-pipeline` skill in this project's `.claude/skills/`
is the canonical bootstrap; load it for the loop's protocol if
you haven't already.

To start, run this one command. It registers your session with
the server, then blocks until a work item arrives (UI Generate
click, or `POST /api/cc/run`). Its output is the next prompt —
follow it; you don't need to remember the protocol.

```bash
./bin/newsletter pull --session ${CLAUDE_SESSION_ID}
```
