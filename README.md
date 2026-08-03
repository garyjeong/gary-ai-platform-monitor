# gary-ai-platform-monitor

macOS **menu bar** monitor for AI platform **usage quotas** and **official status health**.

Automatically discovers local logins (Claude Code, Codex, Grok), shows usage as **percent** when the platform exposes it, and polls public status pages like [status.claude.com](https://status.claude.com). **No outage notifications** — UI only.

## Features

| Feature | Description |
|---------|-------------|
| **Auto-discover** | Detects Claude / Codex / Grok credentials & sessions on this Mac |
| **Monitor toggles** | Enable/disable each platform in the popover Settings |
| **Usage %** | Claude 5h/7d · Codex primary window · Grok tokens/cost (no %) |
| **Health** | Public Statuspage (default every **30s**, min 10s) — badge only |
| **Local only** | Tokens and usage stay on your machine |

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
| Claude | Claude Code OAuth → Anthropic usage API | 5h / 7d **%** |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` | primary **%** |
| Grok | `~/.grok/sessions` | tokens + USD (`usedPercent: null`) |

Optional Grok week alignment:

```bash
export GAI_PM_GROK_WEEK_ANCHOR='2026-08-04T14:19:00'
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

## Packaging (optional)

```bash
npm run build
npm run dist -w @gary-ai-platform-monitor/menubar
```

Produces artifacts under `apps/menubar/release/` (ad-hoc / unsigned unless you set signing).

## Grok quota %

Not available from CLI/local files yet. See [docs/grok-quota.md](./docs/grok-quota.md).

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
