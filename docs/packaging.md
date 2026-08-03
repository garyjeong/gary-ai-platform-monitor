# Packaging & distribution

## Local DMG (unsigned)

```bash
npm install --foreground-scripts
npm run build
npm run dist:mac
```

Artifacts: `apps/menubar/release/`

Gatekeeper will warn on unsigned builds — right-click → Open the first time.

## Notarization (Apple Developer required)

You need:

- Apple Developer Program membership
- Developer ID Application certificate in Keychain
- App-specific password for notarization

```bash
export APPLE_ID='you@example.com'
export APPLE_APP_SPECIFIC_PASSWORD='xxxx-xxxx-xxxx-xxxx'
export APPLE_TEAM_ID='XXXXXXXXXX'
# optional: CSC_LINK / CSC_KEY_PASSWORD for .p12

npm run dist:mac
# electron-builder notarize when credentials present
```

Or after building a zip/dmg:

```bash
xcrun notarytool submit apps/menubar/release/*.dmg \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait
xcrun stapler staple apps/menubar/release/*.dmg
```

Update `apps/menubar/package.json` `build.mac.notarize` / identity when ready.

## GitHub Releases

```bash
git tag v0.3.0
git push origin v0.3.0
```

`.github/workflows/release.yml` builds an unsigned DMG on `macos-latest` and attaches it to the release.

## Homebrew Cask

File: `homebrew/Casks/gary-ai-platform-monitor.rb`

**v0.3.0 (arm64, GitHub Release asset)**

| Field | Value |
|-------|--------|
| URL | https://github.com/garyjeong/gary-ai-platform-monitor/releases/download/v0.3.0/AI-Platform-Monitor-0.3.0-arm64.dmg |
| sha256 | `3c42447074c56ff0f1d9e9e15611c328086564f4efcdc0a2889c2e06e16eaa2c` |

Install from a clone of this repo:

```bash
brew install --cask ./homebrew/Casks/gary-ai-platform-monitor.rb
```

Or download the DMG from the [v0.3.0 release](https://github.com/garyjeong/gary-ai-platform-monitor/releases/tag/v0.3.0).

When publishing a new version:

1. Tag `vX.Y.Z` and wait for Release workflow  
2. `gh release download vX.Y.Z -p '*.dmg' && shasum -a 256 AI-Platform-Monitor-*.dmg`  
3. Update `version` + `sha256` in the cask  

## Dev install (recommended until notarized)

```bash
git clone https://github.com/garyjeong/gary-ai-platform-monitor.git
cd gary-ai-platform-monitor
npm install --foreground-scripts
npm run app
```
