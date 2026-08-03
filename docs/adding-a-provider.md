# Adding a provider

1. Copy `packages/adapters/_template` → `packages/adapters/<id>`
2. Set `package.json` name to `@gary-ai-platform-monitor/adapter-<id>`
3. Implement `ProviderAdapter` in `src/index.ts`:
   - `meta.id`, `displayName`, `capabilities`
   - optional `meta.status` for public health
   - `detect()` — local signals only; never log secrets
   - `fetchUsage()` — prefer `usedPercent` on windows
4. Register in `scripts/register-seed.ts` (and later app bootstrap)
5. Add root `package.json` build `-w` entry if needed
6. Document signals and ToS notes in this folder or README

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

No authentication. Poll interval is app-global (default 30s). No notifications.
