#!/usr/bin/env bash
# Optional LaunchAgent installer when not using Electron "Open at login".
# Prefer the in-app toggle (Open at login) for normal use.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.garyjeong.ai-platform-monitor"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
NODE="$(command -v node)"
ELECTRON="$ROOT/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
APP_DIR="$ROOT/apps/menubar"

if [[ ! -x "$ELECTRON" ]]; then
  echo "Electron binary not found at $ELECTRON"
  echo "Run: npm install && node scripts/ensure-electron.mjs"
  exit 1
fi

if [[ ! -f "$APP_DIR/dist/main.js" ]]; then
  echo "Build the menubar first: npm run build"
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents"

cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${ELECTRON}</string>
    <string>${APP_DIR}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>WorkingDirectory</key>
  <string>${APP_DIR}</string>
  <key>StandardOutPath</key>
  <string>${HOME}/Library/Logs/${LABEL}.out.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/Library/Logs/${LABEL}.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/${LABEL}"
echo "Installed Login Item: $PLIST"
echo "Unload with: bash scripts/uninstall-login-item.sh"
