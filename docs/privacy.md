# Privacy

- **Usage credentials** (OAuth tokens, CLI sessions, optional browser cookies) stay on your Mac.
- Nothing is uploaded to a gary-ai-platform-monitor backend (there is none).
- **Health checks** call vendor **public** status endpoints only (e.g. `status.claude.com/api/v2/summary.json`). Those requests do not include your account cookies.
- Config is stored at `~/.config/gary-ai-platform-monitor/config.json` with restrictive file permissions when written by the app.
- Outage **notifications are not sent** (product decision). Status is shown only in the UI.
