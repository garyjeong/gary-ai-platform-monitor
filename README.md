# gary-ai-platform-monitor

macOS menu bar monitor for AI platform **usage quotas** and **official status health**.

> Phase 0 scaffold — discovery + health CLI work; usage collectors and the menu bar shell come next.

## What it does

| Feature | Description |
|---------|-------------|
| **Auto-discover** | Detects local logins (Claude Code, Codex, Grok, …) without manual setup |
| **Monitor toggles** | Settings enable/disable per platform (planned UI) |
| **Usage %** | Prefer percent remaining/used when the provider exposes it |
| **Health** | Polls public pages like [status.claude.com](https://status.claude.com) (default every **30s**, min 10s) |
| **No alerts** | Health is UI-only — no push/OS notifications for outages |

All credential and usage data stays **local**. Health uses public status APIs only.

## Status

| Area | State |
|------|--------|
| Monorepo + contracts | ✅ |
| Seed adapters detect (Claude / Codex / Grok) | ✅ |
| Statuspage health client | ✅ |
| Usage collectors | ✅ Claude % · Codex % · Grok tokens (no %) |
| Menu bar app | ⏳ Phase 3 |

See [docs/plan.md](./docs/plan.md) for the full plan.

## Requirements

- Node.js 20+
- macOS (Keychain detect for Claude; primary target for the app)

## Quick start (dev)

```bash
git clone https://github.com/garyjeong/gary-ai-platform-monitor.git
cd gary-ai-platform-monitor
npm install
npm run build
npm run scan      # which providers look logged-in locally
npm run health    # live status.claude.com / status.openai.com / …
npm run usage     # quota windows (Claude/Codex %; Grok tokens)
npm test
```

### Usage notes

| Provider | Source | Output |
|----------|--------|--------|
| Claude | Claude Code OAuth → Anthropic usage API | 5h / 7d **%** |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` `rate_limits` | primary **%** |
| Grok | `~/.grok/sessions` aggregation | tokens + USD only (`usedPercent: null`) |

Grok weekly window alignment (optional):

```bash
export GAI_PM_GROK_WEEK_ANCHOR='2026-08-04T14:19:00'
npm run usage
```


Example `scan` output shape:

```json
{
  "providers": [
    {
      "id": "claude",
      "found": true,
      "confidence": "high",
      "signals": [{ "kind": "keychain", "detail": "Claude Code-credentials" }]
    }
  ]
}
```

## Repository layout

```
apps/menubar/                 # Phase 3 shell (placeholder)
packages/core/                # registry, discovery, config, types
packages/health/              # Statuspage v2 client
packages/adapters/claude|codex|grok/
docs/plan.md
```

## Config

`~/.config/gary-ai-platform-monitor/config.json` (created when the app saves settings)

- `health.intervalSeconds`: default `30`, clamped to `10`–`60`
- `providers.<id>.monitor`: whether to fetch usage / show in the bar
- `providers.<id>.showHealth`: health badge on that provider

## Related

- [gary-claude-code-hud](https://github.com/garyjeong/gary-claude-code-hud) — Claude Code statusline; usage readers will be ported into adapters here

## License

MIT
