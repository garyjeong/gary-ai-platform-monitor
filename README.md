# gary-ai-platform-monitor

macOS **menu bar** monitor for AI platform **usage quotas** and **official status health**.

Automatically discovers local logins, shows usage as **percent** when available, and polls public status pages. **No outage notifications** — UI only.

## Features

| Feature | Description |
|---------|-------------|
| **Auto-discover** | 15 providers: Claude, Codex, Grok, Gemini, OpenRouter, Cursor, Copilot, Ollama, OpenCode, ChatGPT Desktop, Warp, Factory, Amp, Kiro, Kilo |
| **Monitor toggles** | Enable/disable each platform in Settings |
| **Usage %** | Claude · Codex · Gemini · OpenRouter; Grok via browser cookie when available |
| **Health** | Statuspage + xAI RSS (default **60s**, 30–300s) — badge only |
| **Open at login** | Electron login item or LaunchAgent scripts |
| **Local only** | Credentials stay on your machine |
| **Polite polling** | Per-provider usage TTL (1–5 min), backoff, honors `Retry-After`; keeps last good numbers and shows their age |

## Requirements

- macOS 13+ (Electron 44)
- Node.js 22.13+ (uses `node:sqlite`)
- Logged-in CLI tools where you want usage (Claude Code, Codex, Grok)

## Install & run

```bash
git clone https://github.com/garyjeong/gary-ai-platform-monitor.git
cd gary-ai-platform-monitor
npm install
npm run app   # builds, downloads the Electron binary on first run, starts the app
```

The Dock icon is hidden; click the menu bar icon to open the panel (right-click for Settings / Quit).

### CLI

```bash
node apps/cli/dist/cli.js snapshot
node apps/cli/dist/cli.js scan
node apps/cli/dist/cli.js usage
node apps/cli/dist/cli.js health
node apps/cli/dist/cli.js config set-monitor grok off
```

### Dev helpers

```bash
npm run scan
npm run usage
npm run health
npm test
```

## Usage sources

| Provider | Source | Output |
|----------|--------|--------|
| Claude | Claude Code OAuth | 5h / 7d **%** |
| Codex | local rollout `rate_limits` | primary **%** |
| Grok | sessions tokens/USD; optional browser Cookie → % | see [docs/grok-quota.md](./docs/grok-quota.md) |
| Gemini | `~/.gemini/oauth_creds.json` → retrieveUserQuota | model **%** |
| OpenRouter | `OPENROUTER_API_KEY` or key file | credit **%** / spend |
| Cursor | browser Cookie / `CURSOR_COOKIE` | plan **%** when API returns it |
| Copilot | `gh auth token` → copilot_internal | chat/completions **%** |
| Ollama | local daemon `api/tags` | model count (no cloud %) |
| OpenCode | auth.json + local DB | session/message counts |
| ChatGPT Desktop / Warp / Factory / Amp / Kiro / Kilo | local install detect | presence / notes |

Grok week alignment (local tokens):

```bash
export GAI_PM_GROK_WEEK_ANCHOR='2026-08-04T14:19:00'
```

Grok browser % (recommended manual cookie):

```bash
# from browser DevTools Cookie header while logged into grok.com
export GAI_PM_GROK_COOKIE='sso=...; sso-rw=...'
# or write ~/.config/gary-ai-platform-monitor/grok.cookie
```

## Config

`~/.config/gary-ai-platform-monitor/config.json`

- `health.intervalSeconds` — status-page poll, 30–300 (default 60). Older 10–29s values migrate to 30s
- `scan.intervalMinutes` — local login re-detection (default 15)
- `providers.<id>.monitor` — fetch usage + status for that provider (one toggle)
- `defaults.autoEnableOnFirstConnect` — seed `monitor: true` on first detect

## Open at login

In the app popover: **Settings → Open at login** (preferred).

Optional LaunchAgent (dev tree):

```bash
bash scripts/install-login-item.sh
bash scripts/uninstall-login-item.sh
```

## Packaging / Homebrew

See [docs/packaging.md](./docs/packaging.md).

**v0.3.0 release (unsigned arm64 DMG):**  
https://github.com/garyjeong/gary-ai-platform-monitor/releases/tag/v0.3.0

```bash
# Homebrew personal tap
brew tap garyjeong/tap
brew install --cask gary-ai-platform-monitor

# Or rebuild DMG locally
npm run dist:mac   # → apps/menubar/release/
```

Tap repo: https://github.com/garyjeong/homebrew-tap  

Gatekeeper may block unsigned apps: right-click → **Open**.  
**Notarization** needs your Apple Developer ID (see packaging docs).

## Layout

```
apps/menubar/            Electron tray app (main) + collector utility process
apps/cli/                gai-pm CLI (read-only snapshot)
packages/runtime/        ALL_ADAPTERS list, app collector, config helpers
packages/core/           types, config (atomic), collector/scheduler, HTTP helpers
packages/health/         Statuspage v2 + RSS status parsing
packages/browser-cookies Chromium cookie reader (opt-in)
packages/adapters/       claude, codex, grok, gemini, openrouter, cursor, copilot,
                         ollama, opencode, apps (ChatGPT Desktop/Warp/Factory/Amp/Kiro/Kilo)
docs/                    plan, privacy, adding-a-provider, packaging, grok-quota
```

## Privacy

See [docs/privacy.md](./docs/privacy.md). No telemetry backend. Health requests are unauthenticated GETs to vendor status APIs.

## Related

- [gary-claude-code-hud](https://github.com/garyjeong/gary-claude-code-hud) — Claude Code statusline (usage readers shared in spirit)

## License

MIT
