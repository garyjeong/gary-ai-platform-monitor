# Menu bar app

Electron tray app (Dock hidden on macOS).

## Run

From repo root:

```bash
npm install
npm run app
```

Or from this package after a full monorepo build:

```bash
npm run start
```

## Features

- Menu bar title: highest monitored usage % (`AI 93%`)
- Popover: provider cards with % bars, health badge, monitor/health toggles
- Health interval 10–60s (default 30s)
- **No** outage notifications

## Package

```bash
npm run dist
```

Output under `release/` (unsigned unless you configure signing).
