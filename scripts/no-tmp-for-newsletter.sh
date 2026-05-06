#!/bin/bash
# Project-level PreToolUse hook. Blocks Bash commands that combine
# `newsletter` and `/tmp/` — newsletter captures belong in cache/.cc/,
# which is project-local, gitignored, and cleaned by `newsletter
# purge`. Other /tmp/ uses (unrelated debug scripts, etc.) pass.

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""')
[ "$TOOL" = "Bash" ] || exit 0
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

if echo "$CMD" | grep -q 'newsletter' && echo "$CMD" | grep -qE '(^|\s|>|<|=)/tmp/'; then
  echo "BLOCKED: don't capture newsletter output to /tmp/. Use cache/.cc/ instead — it's project-local, gitignored, and cleaned by \`newsletter purge\`." >&2
  echo "Or just read stdout directly — every newsletter subcommand emits markdown sized to fit in a Bash tool result." >&2
  exit 2
fi
exit 0
