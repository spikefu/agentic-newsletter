#!/bin/bash
# CRC: crc-NewsletterSubagents.md | R201, R202
#
# PreToolUse gatekeeper for newsletter-* subagents. Reads
# {tool_name, tool_input, agent_type} from stdin (CC's hook
# protocol), allows the per-agent whitelist of newsletter CLI
# subcommands and tightly-scoped Read/Write paths, blocks
# everything else with a redirect message via stderr + exit 2.
#
# Per the Greased Pig pattern: structural enforcement against
# weak-model "creativity" (backgrounding, tailing output files,
# polling, etc.) instead of prose-only instructions.

set -u

INPUT=$(cat)
TOOL=$(echo "$INPUT"  | jq -r '.tool_name // ""')
AGENT=$(echo "$INPUT" | jq -r '.agent_type // ""')

# Per-agent CLI subcommand allowlist. Keep the lists tight; each
# agent should only ever invoke the subcommands its task needs.
case "$AGENT" in
  newsletter-elicitor)  ALLOWED_CMDS='elicit-await event' ;;
  newsletter-discovery) ALLOWED_CMDS='fetch event'        ;;
  newsletter-research)  ALLOWED_CMDS='fetch search event' ;;
  newsletter-podcast)   ALLOWED_CMDS='event'              ;;
  *)
    echo "BLOCKED: unknown subagent ($AGENT). This guard is for newsletter-* subagents only." >&2
    exit 2
    ;;
esac

block() {
  echo "BLOCKED: $1" >&2
  case "$AGENT" in
    newsletter-elicitor)
      echo "Use this exact pattern: write cache/elicitor-questions.json, then run \`newsletter elicit-await cache/elicitor-questions.json\` in the FOREGROUND. Do not background, do not tail, do not poll." >&2 ;;
    newsletter-discovery)
      echo "Use \`newsletter fetch <url>\` per tab; write cache/clusters.json. Use \`newsletter event status '...'\` to narrate." >&2 ;;
    newsletter-research)
      echo "Use \`newsletter fetch <url>\` and \`newsletter search <query>\`; write cache/newsletter.json." >&2 ;;
    newsletter-podcast)
      echo "Read cache/newsletter.json and write cache/podcast-script.txt. Use \`newsletter event\` to narrate." >&2 ;;
  esac
  exit 2
}

# ── Bash ──────────────────────────────────────────────────────
if [ "$TOOL" = "Bash" ]; then
  CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""')
  TRIMMED=$(echo "$CMD" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

  # Reject dangerous shell constructs — pipes, heredocs, command
  # substitution, backgrounding, redirection, command chaining.
  if echo "$TRIMMED" | grep -qE '<<|[|]|`|\$\(|&([^&]|$)|;|>|<'; then
    block "no pipes, heredocs, command substitution, backgrounding, redirection, or chaining"
  fi

  # Reject monitoring / polling / sleeping primitives even if
  # they appear inside an otherwise-allowed command.
  if echo "$TRIMMED" | grep -qE '(^|[[:space:]])(tail|sleep|watch|nohup|disown|bg|fg|jobs|wait[[:space:]])'; then
    block "no tail/sleep/watch/nohup/disown/bg/fg/jobs/wait — the blocking call IS the wait"
  fi

  # Extract the first token (the binary). Accept the four
  # invocation forms we use: newsletter, ./bin/newsletter,
  # bin/newsletter, /abs/path/bin/newsletter.
  BIN=$(echo "$TRIMMED" | awk '{print $1}')
  case "$BIN" in
    newsletter|./bin/newsletter|bin/newsletter|/*/bin/newsletter) ;;
    *) block "only the \`newsletter\` CLI is allowed" ;;
  esac

  SUB=$(echo "$TRIMMED" | awk '{print $2}')
  if [ -z "$SUB" ]; then
    block "missing subcommand — usage: newsletter <subcommand> [args]"
  fi

  for ok in $ALLOWED_CMDS; do
    if [ "$SUB" = "$ok" ]; then
      exit 0
    fi
  done
  block "subcommand \`$SUB\` not allowed for $AGENT (allowed: $ALLOWED_CMDS)"
fi

# ── Read ──────────────────────────────────────────────────────
if [ "$TOOL" = "Read" ]; then
  FPATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
  case "$FPATH" in
    */cache/*|cache/*) exit 0 ;;
    *) block "Read is restricted to cache/ paths" ;;
  esac
fi

# ── Write ─────────────────────────────────────────────────────
if [ "$TOOL" = "Write" ]; then
  FPATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
  case "$FPATH" in
    */cache/*|cache/*) exit 0 ;;
    *) block "Write is restricted to cache/ paths" ;;
  esac
fi

# Anything else is denied by default.
block "tool \`$TOOL\` is not allowed"
