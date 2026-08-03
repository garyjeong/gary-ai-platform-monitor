cask "gary-ai-platform-monitor" do
  version "0.3.0"
  sha256 "3c42447074c56ff0f1d9e9e15611c328086564f4efcdc0a2889c2e06e16eaa2c"

  url "https://github.com/garyjeong/gary-ai-platform-monitor/releases/download/v#{version}/AI-Platform-Monitor-#{version}-arm64.dmg"
  name "AI Platform Monitor"
  desc "Menu bar usage % and status health for AI platforms"
  homepage "https://github.com/garyjeong/gary-ai-platform-monitor"

  livecheck do
    url "https://github.com/garyjeong/gary-ai-platform-monitor/releases/latest"
    strategy :github_latest
  end

  depends_on macos: :sonoma
  depends_on arch: :arm64

  app "AI Platform Monitor.app"

  zap trash: [
    "~/Library/Application Support/AI Platform Monitor",
    "~/.config/gary-ai-platform-monitor",
  ]
end
