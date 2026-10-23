#!/usr/bin/env bash
# Copy the canonical rule text from the claude-terse repo into this package.
# Run after editing rules in ../claude-terse/rules. Without that repo, rules/ here is the source.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
up="${TERSE_RULES_SOURCE:-$here/../claude-terse/rules}"
if [ -d "$up" ]; then
	cp "$up/RULES.md" "$here/rules/RULES.md"
	cp "$up/REMINDER.md" "$here/rules/REMINDER.md"
	echo "synced rules from $up"
else
	echo "no ../claude-terse/rules, keeping rules/ in this repo as the source"
fi
