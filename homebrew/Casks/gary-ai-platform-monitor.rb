cask "gary-ai-platform-monitor" do
  version "0.6.1"
  sha256 "cdd33b395c5058c966f2c0b2e74553133b6cd96905012e183081ad2d47f02779"

  url "https://github.com/garyjeong/gary-ai-platform-monitor/releases/download/v#{version}/AI-Platform-Monitor-#{version}-arm64.dmg"
  name "AI Platform Monitor"
  desc "Menu bar AI usage quotas, status health and system resource charts"
  homepage "https://github.com/garyjeong/gary-ai-platform-monitor"

  livecheck do
    url "https://github.com/garyjeong/gary-ai-platform-monitor/releases/latest"
    strategy :github_latest
  end

  depends_on arch: :arm64
  depends_on macos: :sonoma

  app "AI Platform Monitor.app"

  # Unsigned build: macOS reports a quarantined copy as "damaged" and refuses to open it.
  postflight_steps do
    run "/usr/bin/xattr",
        args: ["-dr", "com.apple.quarantine", "{{appdir}}/AI Platform Monitor.app"]
  end

  zap trash: [
    "~/.config/gary-ai-platform-monitor",
    "~/Library/Application Support/@gary-ai-platform-monitor",
    "~/Library/Application Support/AI Platform Monitor",
  ]
end
