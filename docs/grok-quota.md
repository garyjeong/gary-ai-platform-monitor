# Grok quota % — research note

## Goal

Show SuperGrok / subscription **used percent** like Claude and Codex.

## What works today

| Path | Result |
|------|--------|
| Local `~/.grok/sessions/**/updates.jsonl` | Tokens + USD cost for rolling 7d / anchored weekly window. **No quota fields.** |
| CLI `grok -p` / headless | Usage in session stream only; no rate-limit % |
| OIDC token → `cli-chat-proxy.grok.com` / `api.x.ai` usage paths | Previously probed as **404** (token valid; path not exposed) |
| Official public API | Rate limits for **API teams** (TPM/RPS), not consumer SuperGrok plan % |

## Web UI

`grok.com` settings → usage shows weekly **%** and reset time. That value is served by **private web APIs** behind a browser session (cookies), not the CLI OIDC surface.

## Deferred approaches

1. **Browser cookie import** (Chrome Safe Storage) → call the same billing/usage endpoint the web app uses (fragile; ToS-sensitive).
2. **`grok agent stdio` JSON-RPC** `x.ai/billing` if/when the CLI exposes a stable method (CodexBar-style).
3. **Manual anchor only**: user pastes weekly limit once and we estimate % from local tokens (inaccurate; not implemented).

## Product decision (v0.2+)

- Ship **tokens + cost** for Grok with `usedPercent: null`.
- Align week with `GAI_PM_GROK_WEEK_ANCHOR` when set.
- Health via **https://status.x.ai/feed.xml** (RSS) is separate and works without login.

Revisit when xAI documents a stable subscription-quota API for consumer accounts.
