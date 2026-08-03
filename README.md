# gary-ai-platform-monitor

macOS **menu bar** monitor for AI platform **usage quotas** and **official status health**.

Automatically discovers local logins, shows usage as **percent** when available, and polls public status pages. **No outage notifications** — UI only.

## Features

| Feature | Description |
|---------|-------------|
| **Auto-discover** | Claude, Codex, Grok, Gemini CLI, OpenRouter key, Cursor install |
| **Monitor toggles** | Enable/disable each platform in Settings |
| **Usage %** | Claude · Codex · Gemini · OpenRouter; Grok via browser cookie when available |
| **Health** | Statuspage + xAI RSS (default **30s**) — badge only |
| **Open at login** | Electron login item or LaunchAgent scripts |
| **Local only** | Credentials stay on your machine |

## Requirements

- macOS
- Node.js 20+
- Logged-in CLI tools where you want usage (Claude Code, Codex, Grok)

## Install & run

```bash
git clone https://github.com/garyjeong/gary-ai-platform-monitor.git
cd gary-ai-platform-monitor
npm install
npm run build
npm run app
```

The Dock icon is hidden; look for **AI NN%** in the menu bar. Click to open the panel.

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

- `health.intervalSeconds` — 10–60 (default 30)
- `providers.<id>.monitor` — fetch usage / show in bar summary
- `providers.<id>.showHealth` — poll status page for that provider
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

```bash
npm run dist:mac          # unsigned DMG → apps/menubar/release/
# Homebrew cask template: homebrew/Casks/gary-ai-platform-monitor.rb
# GitHub Actions: tag v* → builds release assets
```

**Notarization** needs your Apple Developer ID (documented; not runnable without secrets).

## Layout

```
apps/menubar/     Electron tray app
apps/cli/         gai-pm CLI
packages/runtime/ Wired snapshot API
packages/core/    Registry, config, snapshot
packages/health/  Statuspage client
packages/adapters/{claude,codex,grok}/
docs/plan.md
```

## Privacy

See [docs/privacy.md](./docs/privacy.md). No telemetry backend. Health requests are unauthenticated GETs to vendor status APIs.

## Related

- [gary-claude-code-hud](https://github.com/garyjeong/gary-claude-code-hud) — Claude Code statusline (usage readers shared in spirit)

## License

MIT
