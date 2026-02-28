# Claude Code Token Generator

Generate Claude OAuth tokens and apply them to OpenClaw — no manual config needed.

## Download

👉 **[Download latest release](https://github.com/absurdfounder/claude-code-token-generator/releases/latest)**

| Version | Works on |
|---------|----------|
| `*-universal.dmg` | ✅ All Macs (Intel + Apple Silicon) — **use this** |
| `*-arm64.dmg` | Apple Silicon only (M1/M2/M3/M4) |

## Install

1. Download the `universal.dmg`
2. Open it and drag the app to Applications
3. **First launch:** Right-click the app → **Open** → Open (bypasses Gatekeeper — only needed once)

> The app is signed but not notarized. macOS will warn on first open — just right-click → Open to proceed.

## What it does

1. Opens a browser window to authenticate with Claude (OAuth PKCE flow)
2. Captures the access token
3. Optionally applies it directly to your OpenClaw config

## Usage

1. Launch the app
2. Click **"Generate Token"**
3. Log in with your Claude/Anthropic account
4. Copy the token or click **"Apply to OpenClaw"**

## Building from source

```bash
npm install
npm run build          # universal (Intel + Apple Silicon)
npm run build:arm64    # Apple Silicon only
npm run build:x64      # Intel only
```
