#!/usr/bin/env bash
# PreToolUse: block edits to secrets, signing keys, and generated artifacts.
path=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
[ -z "$path" ] && exit 0
rel=${path#"$CLAUDE_PROJECT_DIR"/}

case "$rel" in
  .env.example) exit 0 ;;
  .env|.env.*|*/.env|*/.env.*) reason="secret env file" ;;
  *.keystore|*.jks|keystore.properties) reason="Android signing key — corrupting it breaks updates for installed apps" ;;
  *.apk|*.aab) reason="build artifact" ;;
  dist/*|android/app/src/main/assets/public/*) reason="generated output — edit src/ and rebuild instead" ;;
  package-lock.json) reason="lock file — change dependencies with npm install instead" ;;
  *) exit 0 ;;
esac

echo "Blocked edit to $rel: $reason" >&2
exit 2
