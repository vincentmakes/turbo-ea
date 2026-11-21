#!/bin/bash
# Compatibility for chats that loaded the earlier hook configuration.
exec node "${CLAUDE_PROJECT_DIR:-.}/.claude/hooks/check-security-review.cjs"
