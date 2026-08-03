cask "gary-ai-platform-monitor" do
  version "0.3.0"
  sha256 :no_check # update after first GitHub release asset is published

  url "https://github.com/garyjeong/gary-ai-platform-monitor/releases/download/v#{version}/AI-Platform-Monitor-#{version}-arm64.dmg"
  name "AI Platform Monitor"
  desc "Menu bar usage % and status health for AI platforms"
  homepage "https://github.com/garyjeong/gary-ai-platform-monitor"

  # Until a signed DMG is published, prefer the source install:
  #   git clone … && npm install && npm run app
  #
  # After release assets exist, install with:
  #   brew install --cask ./homebrew/Casks/gary-ai-platform-monitor.rb
  # or add a personal tap that vendors this file.

  depends_on macos: ">= :sonoma"

  app "AI Platform Monitor.app"

  zap trash: [
    "~/Library/Application Support/AI Platform Monitor",
    "~/.config/gary-ai-platform-monitor",
  ]
end
