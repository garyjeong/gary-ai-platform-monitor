# gary-ai-platform-monitor — Product Plan

Status: **Phase 0 scaffold complete** (public repo, core contracts, seed adapters, health Statuspage client)

## Vision

macOS installable menu bar app that:

1. **Discovers** AI platforms that are already logged in locally
2. Lets the user **enable/disable monitoring** per platform in Settings
3. Shows subscription **usage as percentages** when available
4. Polls official **status pages** (e.g. https://status.claude.com) for health badges

Privacy: local-only for credentials and usage. Health uses **public** status APIs only.  
Notifications: **none** (no outage alerts).

## Confirmed product decisions

| Decision | Value |
|----------|--------|
| Repository | `garyjeong/gary-ai-platform-monitor` (**public**, MIT) |
| Health interval | Default **30s**, configurable **10–60s** (faster preferred; be a good API citizen) |
| Outage notifications | **Disabled / not implemented** |
| Browser cookie scan | Opt-in, default off |
| First connect | Auto-enable monitoring (`autoEnableOnFirstConnect: true`) |
| Seed providers | Claude, Codex, Grok |
| Usage display | Prefer **%**; Grok may fall back until percent path is proven |

## Architecture

```
apps/menubar          → Phase 3 shell (Tauri or SwiftUI)
packages/core         → types, registry, discovery, config
packages/health       → Statuspage v2 / future RSS
packages/adapters/*   → one package per platform
```

### Provider lifecycle

`not_found → discovered → connected → monitored | paused | auth_error | unsupported`

- **Discover** ≠ **Monitor**. User toggle is the gate for menu bar display.
- **Health** is independent of login; can show even when usage is unavailable.

### Adapter contract

See `packages/core/src/types.ts` → `ProviderAdapter`:

- `detect()` — local signals only when possible
- `fetchUsage()` — quota windows with `usedPercent`
- `meta.status` — optional public health source

## Data sources (seed)

| Provider | Detect | Usage % | Health |
|----------|--------|---------|--------|
| Claude | Keychain / `~/.claude` | OAuth `api.anthropic.com/api/oauth/usage` (Phase 2; proven in gary-claude-code-hud) | status.claude.com Statuspage v2 |
| Codex | `~/.codex` sessions/auth | Local `rate_limits.used_percent` (Phase 2) | status.openai.com Statuspage v2 |
| Grok | `~/.grok` | Local sessions → tokens/USD only (**no %**); optional `GAI_PM_GROK_WEEK_ANCHOR` | status.x.ai (RSS/custom Phase 4) |

## Config path

`~/.config/gary-ai-platform-monitor/config.json`

```json
{
  "scan": { "intervalMinutes": 15, "includeBrowserCookies": false },
  "health": { "enabled": true, "intervalSeconds": 30, "showInMenuBar": true },
  "providers": {
    "claude": { "monitor": true, "showHealth": true, "userHidden": false }
  },
  "defaults": { "autoEnableOnFirstConnect": true }
}
```

## Roadmap

### Phase 0 — Scaffold + spike

- [x] Public repo + monorepo layout
- [x] Core types / registry / discovery / config
- [x] Health Statuspage client + Claude fixture test
- [x] Seed adapters with real `detect()`
- [x] CLI: `npm run scan`, `npm run health`
- [x] Grok percent path spike → **no % from CLI/local** (tokens/USD only)

### Phase 1 — Core hardening

- [ ] Persist config round-trip tests
- [ ] Discovery merge with user prefs (never force re-enable)
- [ ] Unified snapshot builder for UI

### Phase 2 — Usage collectors (current)

- [x] Claude OAuth usage → 5h / 7d %
- [x] Codex rollout JSONL → used_percent
- [x] Grok: local session tokens/USD (`usedPercent: null`); browser % deferred
- [x] CLI: `npm run usage`

### Phase 3 — Menu bar app

- [ ] Tauri or SwiftUI shell
- [ ] Popover: monitored providers only
- [ ] Settings → Platforms list + monitor toggles
- [ ] Health badge (silent, no alerts)
- [ ] Installable `.app` / dmg

### Phase 4+

- [ ] More adapters (Cursor, Gemini, …) via template
- [ ] Grok/xAI health strategy
- [ ] Optional browser cookie import

## CLI (dev)

```bash
npm install
npm run build
npm run scan      # local discovery JSON
npm run health    # live status pages JSON
npm test          # health parser tests
```

## Relation to gary-claude-code-hud

Reuse proven readers (Claude OAuth, Codex rate_limits, Grok session aggregation) as adapter implementations.  
HUD remains Claude Code statusline; this app is the always-on system menu bar.

## Non-goals (v1)

- Push/OS notifications for incidents
- Server-side sync
- Windows/Linux
- 60+ providers day one
- Storing passwords

## License

MIT
