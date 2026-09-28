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
git tag v0.6.0
git push origin v0.6.0
```

`.github/workflows/release.yml` builds an unsigned DMG on `macos-latest` and attaches it to the release.

## Homebrew Cask

**Personal tap (recommended):** [garyjeong/homebrew-tap](https://github.com/garyjeong/homebrew-tap)

```bash
brew tap garyjeong/tap
brew install --cask gary-ai-platform-monitor
```

Mirror of the cask also lives in this repo at `homebrew/Casks/gary-ai-platform-monitor.rb` (keep in sync with the tap).

The cask's `postflight_steps` removes `com.apple.quarantine` after install. The build is unsigned (`identity: null`), and macOS reports a quarantined unsigned copy as "damaged" instead of offering to open it — this hit the login-item launch after a reboot following `brew upgrade`. Drop the step once the build is signed and notarized.

**v0.6.0 (arm64, GitHub Release asset)**

| Field | Value |
|-------|--------|
| URL | https://github.com/garyjeong/gary-ai-platform-monitor/releases/download/v0.6.0/AI-Platform-Monitor-0.6.0-arm64.dmg |
| sha256 | `e19941343c1d2154def9eb3d5053e1e41be099c888d8292f3155419685c46fab` |

Direct install without tap (from this clone):

```bash
brew install --cask ./homebrew/Casks/gary-ai-platform-monitor.rb
```

When publishing a new version:

1. Tag `vX.Y.Z` and wait for Release workflow  
2. `gh release download vX.Y.Z -p '*.dmg' && shasum -a 256 AI-Platform-Monitor-*.dmg`  
3. Update `version` + `sha256` in **both**:
   - `garyjeong/homebrew-tap` → `Casks/gary-ai-platform-monitor.rb`
   - this repo → `homebrew/Casks/gary-ai-platform-monitor.rb`

## Dev install (recommended until notarized)

```bash
git clone https://github.com/garyjeong/gary-ai-platform-monitor.git
cd gary-ai-platform-monitor
npm install --foreground-scripts
npm run app
```
