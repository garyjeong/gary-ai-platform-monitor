# Grok quota %

## Working paths

| Path | Result |
|------|--------|
| Local `~/.grok/sessions` | Tokens + USD (no %) |
| CLI OIDC → `GET /rest/subscriptions` | Tier + billing period (no usage %) |
| CLI OIDC → `POST /rest/rate-limits` | **403** `oauth2-auth-forbidden` |
| Browser Cookie → `POST /rest/rate-limits` | Target for % when session cookies work |

## How to enable browser %

1. Log into [grok.com](https://grok.com) in Chrome (or Brave/Arc).
2. Prefer **manual Cookie** (most reliable; Chrome v20 encryption often blocks auto-decrypt):
   - DevTools → Network → any `grok.com` request → Request Headers → `Cookie:`
   - Save to `~/.config/gary-ai-platform-monitor/grok.cookie` **or**
   - `export GAI_PM_GROK_COOKIE='sso=...; sso-rw=...'`
3. Or turn on **Settings → Read browser cookies** in the menu bar app (uses Chrome Safe Storage; may fail on newer Chrome).
4. `npm run usage` / refresh the app — if the web API returns percent fields, they appear as Grok windows.

## Security

- Cookie files are local secrets (mode 600 recommended).
- Never commit `*.cookie` or paste cookies into issues.
- App never uploads cookies.

## Status health

Independent of quota: `https://status.x.ai/feed.xml` (RSS).
