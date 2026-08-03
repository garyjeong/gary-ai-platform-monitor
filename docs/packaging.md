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

Template: `homebrew/Casks/gary-ai-platform-monitor.rb`

1. Publish a release DMG matching the URL pattern  
2. Compute `shasum -a 256 path/to.dmg` and set `sha256`  
3. Install locally:

```bash
brew install --cask ./homebrew/Casks/gary-ai-platform-monitor.rb
```

Or host the cask in a personal tap (`garyjeong/homebrew-tap`).

## Dev install (recommended until notarized)

```bash
git clone https://github.com/garyjeong/gary-ai-platform-monitor.git
cd gary-ai-platform-monitor
npm install --foreground-scripts
npm run app
```
