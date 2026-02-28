# Claude Code Token Generator & OpenClaw Applier

A macOS menubar app that generates a fresh Anthropic OAuth token via Claude's Authorization Code + PKCE flow and automatically applies it to your OpenClaw gateway — no manual config file editing required.

![App Screenshot](screenshot.png)

---

## Download

👉 **[Download the latest DMG from Releases](https://github.com/absurdfounder/claude-code-token-generator/releases/latest)**

> macOS arm64 (Apple Silicon) only.

---

## How to Use

### 1. Install
- Download the `.dmg` from Releases
- Open it and drag the app to `/Applications`
- Launch **Claude Code Token Generator** from Applications or Spotlight

### 2. Sign In
- Click **"Sign in with Claude"**
- Your browser opens Anthropic's OAuth page
- Sign in with your Anthropic / Claude account
- The app captures the token automatically — no copy/paste needed

### 3. Apply to OpenClaw
- Once signed in, click **"Apply to OpenClaw"**
- The app will:
  1. `openclaw gateway stop` — safely stop the gateway
  2. Write the new token to `~/.openclaw/agents/main/agent/auth-profiles.json`
  3. Verify the token was written correctly
  4. `openclaw gateway` — restart the gateway with the new token
- Each step is shown with ✅ / ❌ status

### 4. Done
OpenClaw is now running with a fresh Anthropic token.

---

## Requirements

- macOS (Apple Silicon / arm64)
- [OpenClaw](https://openclaw.ai) installed (`openclaw` in PATH)
- An Anthropic account with Claude access

---

## Build from Source

```bash
git clone https://github.com/absurdfounder/claude-code-token-generator
cd claude-code-token-generator
npm install
npm start          # run in dev
npm run build      # build DMG
```

> Note: Building requires Xcode Command Line Tools. Code signing is optional for local use.

---

## How it Works

Uses Anthropic's OAuth 2.0 Authorization Code flow with PKCE:
- Client ID: `9d1c250a-e61b-44d9-88ed-5944d1962f5e`
- Redirect URI: `http://localhost:3456/callback`
- Scopes: `openid profile email`

The app runs a local HTTP server on port `3456` to catch the OAuth callback, exchanges the code for tokens, and writes the `access_token` directly into OpenClaw's auth profiles file.
