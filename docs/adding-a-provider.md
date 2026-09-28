# Adding a provider

1. Copy `packages/adapters/_template` → `packages/adapters/<id>`
2. Set `package.json` name to `@gary-ai-platform-monitor/adapter-<id>`
3. Implement `ProviderAdapter` in `src/index.ts`:
   - `meta.id`, `displayName`, `capabilities`
   - optional `meta.status` for public health
   - `detect()` — local signals only, async, never read a secret just to check presence
   - `fetchUsage()` — prefer `usedPercent` on windows (see contract below)
4. Register it in **`packages/runtime/src/index.ts` → `ALL_ADAPTERS`** (app, CLI and dev scripts all read this list)
   and add the package to `packages/runtime/package.json` dependencies
5. Add the workspace to the root `package.json` `build` chain (before `runtime`) and, if it has tests, to `test`
6. Document signals and ToS notes in this folder or README

## Usage contract

- Use `fetchJson` / `fetchText` from `@gary-ai-platform-monitor/core` for every request: they add a timeout,
  classify failures (`errorKind`) and parse `Retry-After` (`retryAfterMs`).
- Do not retry or loop. The collector schedules calls (per-provider TTL in `core/src/collector.ts`,
  exponential backoff, Retry-After) and keeps the last good numbers when a call fails.
- `resetsAt` is epoch **seconds**. Set `windowSeconds` when the window length is known (enables pace display).
  Rolling aggregates ("last 7 days") use `windowKind: 'rolling'` and no `resetsAt`.
- `observedAt` (ms) is when the numbers were observed at the source. Cached or log-derived data keeps
  its original time — never stamp old data with "now".
- `401/403` → `status: 'auth_required'`; everything else that fails → `'error'` (or `'stale'` with cached windows).
- Put non-error display text (plan tier) in `note`, not `errorMessage`. Error text must not contain secrets
  (`scrubSecrets`).

## Health

If the vendor uses Atlassian Statuspage:

```ts
status: {
  pageUrl: 'https://status.example.com',
  strategy: 'statuspage_v2',
  summaryUrl: 'https://status.example.com/api/v2/summary.json',
  watchComponents: ['API', 'Web'],
}
```

When `watchComponents` match, the indicator comes from the worst watched component; otherwise the page-wide
indicator is used. No authentication. Status pages are polled every `health.intervalSeconds`
(default 60s, 30–300s) and shared between providers that use the same page. No notifications.
