#!/bin/bash
# Agent Start Tracker - PreToolUse hook for Task tool
# Registers agents when spawned for real-time metrics tracking

set -e

# Use global hooks if installed, otherwise use project hooks
if [[ -f "$HOME/.claude/hooks/dist/agent-start-tracker.mjs" ]]; then
    cd "$HOME/.claude/hooks"
else
    cd "$CLAUDE_PROJECT_DIR/.claude/hooks"
fi

cat | node dist/agent-start-tracker.mjs
