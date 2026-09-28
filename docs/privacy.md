# Privacy

- **Usage credentials** (OAuth tokens, CLI sessions, optional browser cookies) stay on your Mac.
- Nothing is uploaded to a gary-ai-platform-monitor backend (there is none).
- **Health checks** call vendor **public** status endpoints only (e.g. `status.claude.com/api/v2/summary.json`).
  Those requests do not include your account cookies.
- Config is stored at `~/.config/gary-ai-platform-monitor/config.json` (mode 600, written atomically).
  An unreadable file is renamed to `config.json.corrupt-<time>` instead of being overwritten.
- Outage **notifications are not sent** (product decision). Status is shown only in the UI.

## What is read locally

| Source | Used for | Notes |
|--------|----------|-------|
| Keychain item `Claude Code-credentials` | Claude usage | Presence is checked without reading the secret; the token is read only to call the usage API |
| `~/.codex/sessions/**/rollout-*.jsonl` | Codex rate limits | Only `rate_limits` records are parsed |
| `~/.grok/sessions` | Grok local tokens/cost | Token counters only |
| `~/.gemini/oauth_creds.json`, `gh auth token`, OpenRouter key | Usage APIs | Sent only to the vendor's own API |
| Browser cookie DB (Chrome, Brave, Arc, Chromium) | Grok / Cursor usage | **Off by default** (Settings → 브라우저 쿠키 읽기). Reads the browser's "Safe Storage" key from the Keychain (macOS asks for permission), copies the cookie DB to a private temp dir, decrypts only the named cookies for the vendor domain, then deletes the copy |
| OpenCode `opencode.db` | Session/message counts | Copied to a temp dir, counted, deleted |

System resources are read with local commands only (`vm_stat`, `sysctl`, `top -l 1`, `netstat -ibn`) and never leave the Mac.

All fetching runs in a separate helper process of the app. Error messages are scrubbed of tokens before they
reach the UI.

Keychain note: if you click **Always Allow** for the browser Safe Storage prompt, macOS grants it to
`/usr/bin/security`, which other local programs can also invoke. Prefer **Allow** (once) or keep browser
cookie reading off and paste a cookie into `~/.config/gary-ai-platform-monitor/grok.cookie` instead.
