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
  newsletter-elicitor)  ALLOWED_CMDS='help --help prompt elicit-await event submit-context'                ;;
  newsletter-discovery) ALLOWED_CMDS='help --help prompt fetch event submit-clusters'                      ;;
  newsletter-research)  ALLOWED_CMDS='help --help prompt fetch search event submit-newsletter'             ;;
  newsletter-podcast)   ALLOWED_CMDS='help --help prompt event submit-podcast'                             ;;
  *)
    echo "BLOCKED: unknown subagent ($AGENT). This guard is for newsletter-* subagents only." >&2
    exit 2
    ;;
esac

block() {
  echo "BLOCKED: $1" >&2
  echo "First action for every newsletter subagent: run \`./bin/newsletter prompt\` to fetch your phase prompt, then follow what it says." >&2
  case "$AGENT" in
    newsletter-elicitor)
      echo "Then: write cache/elicitor-questions.json and run \`./bin/newsletter elicit-await cache/elicitor-questions.json\` in the FOREGROUND. Do not background, do not tail, do not poll." >&2 ;;
    newsletter-discovery)
      echo "Then: \`./bin/newsletter fetch <url>\` per tab; write cache/clusters.md. Use \`./bin/newsletter event status '...'\` to narrate." >&2 ;;
    newsletter-research)
      echo "Then: \`./bin/newsletter fetch <url>\` and \`./bin/newsletter search '<query>'\` (single-quote the query); write cache/newsletter.md." >&2 ;;
    newsletter-podcast)
      echo "Then: read cache/newsletter.json and write cache/podcast-script.txt. Use \`./bin/newsletter event\` to narrate." >&2 ;;
  esac
  exit 2
}

# ── Bash ──────────────────────────────────────────────────────
if [ "$TOOL" = "Bash" ]; then
  CMD=$(echo "$INPUT" | jq -r '.tool_input.command // ""')
  TRIMMED=$(printf '%s' "$CMD" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

  # The command may be multi-line because of a heredoc:
  #   ./bin/newsletter submit-clusters <<'EOF'
  #   <body>
  #   EOF
  # The first line carries the actual command; the rest is
  # heredoc body (data, not commands). BIN/SUB and the shell-
  # construct check operate on the first line only.
  FIRST_LINE=$(printf '%s' "$TRIMMED" | head -n1)

  # Detect a heredoc opener on the first line. If present, find the
  # closing delimiter and verify nothing follows. Anything after the
  # closing delimiter would be a separate bash command.
  HEREDOC_OPEN=$(printf '%s' "$FIRST_LINE" | grep -oE "<<-?[[:space:]]*['\"]?[A-Za-z_][A-Za-z0-9_]*['\"]?" | head -n1)
  if [ -n "$HEREDOC_OPEN" ]; then
    DELIM=$(printf '%s' "$HEREDOC_OPEN" | sed -E "s/^<<-?[[:space:]]*['\"]?//; s/['\"]?$//")
    TOTAL_LINES=$(printf '%s\n' "$TRIMMED" | wc -l)
    CLOSE_LINE=$(printf '%s\n' "$TRIMMED" | grep -n -E "^[[:space:]]*${DELIM}[[:space:]]*$" | head -n1 | cut -d: -f1)
    if [ -z "$CLOSE_LINE" ]; then
      block "heredoc has no closing delimiter (${DELIM})"
    fi
    if [ "$CLOSE_LINE" != "$TOTAL_LINES" ]; then
      block "no commands after the heredoc closing delimiter"
    fi
    # Strip the heredoc opener from the first line before checking
    # for shell metas, so `<<'EOF'` doesn't trip the regex.
    FIRST_FOR_META=$(printf '%s' "$FIRST_LINE" | sed -E "s/<<-?[[:space:]]*['\"]?[A-Za-z_][A-Za-z0-9_]*['\"]?//g")
  else
    # No heredoc — must be a single-line command.
    TOTAL_LINES=$(printf '%s\n' "$TRIMMED" | wc -l)
    if [ "$TOTAL_LINES" != "1" ]; then
      block "multi-line commands require a heredoc form"
    fi
    FIRST_FOR_META="$FIRST_LINE"
  fi

  # Reject dangerous shell constructs on the command line itself
  # (pipes, command substitution, backgrounding, output-redirect,
  # input-redirect, chaining). The heredoc body is unconstrained
  # since it's data, not commands.
  if echo "$FIRST_FOR_META" | grep -qE '[|]|`|\$\(|&([^&]|$)|;|>|<'; then
    block "no pipes, command substitution, backgrounding, redirection, or chaining"
  fi

  # Reject monitoring / polling / sleeping primitives anywhere in
  # the command (not just the heredoc body) — these would be the
  # actual binary, not data.
  if echo "$FIRST_LINE" | grep -qE '(^|[[:space:]])(tail|sleep|watch|nohup|disown|bg|fg|jobs|wait[[:space:]])'; then
    block "no tail/sleep/watch/nohup/disown/bg/fg/jobs/wait — the blocking call IS the wait"
  fi

  # Extract the first token (the binary). Accept the invocation
  # forms we use: newsletter, ./bin/newsletter, bin/newsletter,
  # /abs/path/bin/newsletter.
  BIN=$(printf '%s' "$FIRST_LINE" | awk '{print $1}')
  case "$BIN" in
    newsletter|./bin/newsletter|bin/newsletter|/*/bin/newsletter) ;;
    *) block "only the \`newsletter\` CLI is allowed" ;;
  esac

  SUB=$(printf '%s' "$FIRST_LINE" | awk '{print $2}')
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
