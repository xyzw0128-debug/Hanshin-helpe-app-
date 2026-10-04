#!/usr/bin/env bash
# PostToolUse: type-check the web app after a .ts/.tsx edit and feed errors back to Claude.
path=$(jq -r '.tool_input.file_path // empty')
case "$path" in
  *.ts|*.tsx) ;;
  *) exit 0 ;;
esac

cd "$CLAUDE_PROJECT_DIR" || exit 0
out=$(npx --no-install tsc --noEmit -p . 2>&1)
if [ $? -ne 0 ]; then
  echo "tsc --noEmit failed after editing ${path#"$CLAUDE_PROJECT_DIR"/}:" >&2
  echo "$out" | head -40 >&2
  exit 2
fi
exit 0
