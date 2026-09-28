cask "gary-ai-platform-monitor" do
  version "0.6.0"
  sha256 "e19941343c1d2154def9eb3d5053e1e41be099c888d8292f3155419685c46fab"

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
