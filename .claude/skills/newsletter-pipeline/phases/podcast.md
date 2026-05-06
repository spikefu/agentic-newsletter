<!-- CRC: crc-NewsletterSkill.md | Seq: seq-cc-run.md | R199, R209 -->

# Podcast phase

The CLI emits the canonical podcast-phase prompt via `newsletter
next` (when the run kind is `podcast`). This file is supporting
documentation.

## What podcast does

1. Read `cache/newsletter.json`.
2. Convert to a 3–6 minute spoken-word script following the
   shared system prompt rules (first-person plural, no markdown,
   spelled-out numbers when natural, transitions between
   sections, warm intro + brief sign-off).
3. Write to `cache/podcast-script.txt`. Plain text.
4. Push `newsletter event podcast-ready '{"runId":"<id>"}'`.

The `/api/cc/run` payload's `kind` set to `"podcast"` triggers
this phase directly, bypassing elicit/discover/research.
