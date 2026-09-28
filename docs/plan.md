# gary-ai-platform-monitor — Product Plan

Status: **v0.6** — reliability pass (v0.4) + design refresh + floating widget (v0.5) + this Mac resources

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
| Shell | **Electron** menu bar (Rust/Tauri not available on this machine; TS adapters reused natively) |
| Health interval | Default **60s**, configurable **30–300s** (usage has its own per-provider TTL) |
| Outage notifications | **Disabled / not implemented** |
| Browser cookie scan | Opt-in, default off (not required for seed adapters) |
| First connect | Auto-enable monitoring on first discover |
| Providers | 15 (see README) — registered in `packages/runtime` `ALL_ADAPTERS` |
| Usage display | Prefer **%**; Grok tokens/USD only |

## Architecture

```
apps/menubar          → Electron tray + popover UI
apps/cli              → gai-pm snapshot|scan|usage|health|config
packages/runtime      → ALL_ADAPTERS + app collector + CLI snapshot
packages/core         → types, config, collector (scheduler), HTTP helpers
packages/health       → Statuspage v2
packages/adapters/*   → 15 providers (claude, codex, grok, gemini, …)
```

## Data sources (seed)

| Provider | Detect | Usage | Health |
|----------|--------|-------|--------|
| Claude | Keychain / `~/.claude` | OAuth 5h/7d **%** | status.claude.com |
| Codex | `~/.codex` | local rate_limits **%** | status.openai.com |
| Grok | `~/.grok` | tokens/USD only | status.x.ai (RSS stub) |

## Config path

`~/.config/gary-ai-platform-monitor/config.json`

## Roadmap status

- [x] Phase 0 scaffold + public repo
- [x] Phase 2 usage collectors
- [x] Snapshot engine + auto-enable prefs
- [x] CLI `gai-pm`
- [x] Electron menu bar (monitor toggles, health interval, silent health badges)
- [x] xAI/Grok health via RSS (`status.x.ai/feed.xml`)
- [x] Open at login (Electron login item + optional LaunchAgent scripts)
- [x] Grok % research documented (`docs/grok-quota.md`)
- [x] Grok browser cookie % path (manual cookie + best-effort Chrome import)
- [x] Extra adapters: Gemini, OpenRouter, Cursor, Copilot, Ollama, OpenCode, ChatGPT Desktop, Warp, Factory, Amp, Kiro, Kilo
- [x] DMG packaging scripts + GitHub Release workflow + Homebrew cask template
- [x] v0.4: collector utility process, per-provider TTL + backoff + Retry-After, last-good retention, atomic config, single instance, sandboxed renderer, Electron 44
- [x] v0.5: design refresh (shared components, light/dark, pace, freshness) and floating widget (Electron panel window)
- [x] v0.6: this Mac resources (CPU, memory, shared memory, network) in popover and widget; single-size widget
- [ ] Notarization (requires user's Apple Developer cert — documented)

## Commands

```bash
npm install
npm run build
npm test
npm run snapshot    # full JSON
npm run app         # start menu bar
# or
node apps/cli/dist/cli.js config set-monitor grok off
```

## License

MIT
