const { app, BrowserWindow, shell } = require('electron');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const url = require('url');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

const PORT = 17249;
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const SCOPES = 'user:inference';
const sessions = new Map();

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function postJSON(u, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const p = new URL(u);
    const req = https.request({
      hostname: p.hostname, port: 443, path: p.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

function html(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'text/html' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const p = parsed.pathname;

  if (p === '/api/auth/start') {
    const sessionId = crypto.randomUUID();
    const state = crypto.randomBytes(16).toString('hex');
    const { verifier, challenge } = generatePKCE();
    const redirectUri = `http://localhost:${PORT}/callback`;
    sessions.set(sessionId, { state, verifier, redirectUri, status: 'pending', token: null });
    setTimeout(() => sessions.delete(sessionId), 600000);
    const authUrl = new URL(AUTHORIZE_URL);
    authUrl.searchParams.set('code', 'true');
    authUrl.searchParams.set('client_id', CLIENT_ID);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', SCOPES);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);
    sessions.set(`state:${state}`, sessionId);
    return json(res, 200, { session_id: sessionId, authorization_url: authUrl.toString() });
  }

  if (p === '/callback') {
    const { code, state, error } = parsed.query;
    if (error) return html(res, 400, `<html><body style="font-family:system-ui;text-align:center;padding:60px"><h1>❌ Error: ${error}</h1></body></html>`);
    if (!code || !state) return html(res, 400, '<h1>Missing params</h1>');
    const sessionId = sessions.get(`state:${state}`);
    const session = sessionId && sessions.get(sessionId);
    if (!session) return html(res, 400, '<html><body style="font-family:system-ui;text-align:center;padding:60px"><h1>❌ Invalid session</h1></body></html>');
    try {
      const result = await postJSON(TOKEN_URL, {
        grant_type: 'authorization_code', code, redirect_uri: session.redirectUri,
        client_id: CLIENT_ID, code_verifier: session.verifier, state,
      });
      if (result.status === 200 && result.body.access_token) {
        session.status = 'complete';
        session.token = result.body.access_token;
        session.refreshToken = result.body.refresh_token;
        session.expiresIn = result.body.expires_in;
        session.scope = result.body.scope;
        sessions.delete(`state:${state}`);
        return html(res, 200, '<html><body style="font-family:system-ui;text-align:center;padding:60px;background:#0a0a0a;color:#e5e5e5"><h1>✅ Success!</h1><p style="color:#737373">You can close this tab and go back to the app.</p></body></html>');
      }
      session.status = 'error';
      return html(res, 400, `<html><body style="font-family:system-ui;text-align:center;padding:60px"><h1>❌ Failed</h1><pre>${JSON.stringify(result.body, null, 2)}</pre></body></html>`);
    } catch (err) {
      session.status = 'error';
      return html(res, 500, `<h1>Error</h1><pre>${err.message}</pre>`);
    }
  }

  const tm = p.match(/^\/api\/auth\/token\/(.+)$/);
  if (tm) {
    const session = sessions.get(tm[1]);
    if (!session) return json(res, 404, { error: 'Not found' });
    if (session.status === 'pending') return json(res, 200, { status: 'pending' });
    if (session.status === 'error') return json(res, 400, { status: 'error' });
    return json(res, 200, {
      status: 'complete', access_token: session.token, refresh_token: session.refreshToken,
      expires_in: session.expiresIn, scope: session.scope,
    });
  }

  if (p === '/api/auth/refresh') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const { refresh_token } = JSON.parse(body);
      if (!refresh_token) return json(res, 400, { error: 'Missing refresh_token' });
      const result = await postJSON(TOKEN_URL, { grant_type: 'refresh_token', refresh_token, client_id: CLIENT_ID });
      if (result.status === 200) return json(res, 200, result.body);
      return json(res, 400, { error: 'Refresh failed', detail: result.body });
    } catch (err) { return json(res, 500, { error: err.message }); }
  }

  if (p === '/api/apply-key') {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const { access_token } = JSON.parse(body);
      if (!access_token) return json(res, 400, { error: 'Missing access_token' });

      const authFile = path.join(os.homedir(), '.openclaw/agents/main/agent/auth-profiles.json');
      const steps = [];

      // Step 1: Read file and find old token, then replace with sed
      let oldToken = null;
      try {
        const fileContent = fs.readFileSync(authFile, 'utf8');
        const match = fileContent.match(/sk-ant-[A-Za-z0-9_-]{10,}/);
        oldToken = match ? match[0] : null;
      } catch (e) {
        return json(res, 500, { success: false, steps: [{ cmd: `cat ${authFile}`, output: e.message, ok: false }] });
      }

      const sedCmd = oldToken
        ? `sed -i.bak 's/${oldToken}/${access_token}/' ~/.openclaw/agents/main/agent/auth-profiles.json`
        : `# Could not find existing token to replace`;

      // Step 1: Stop OpenClaw gateway before making changes
      const stopCmd = `openclaw gateway stop`;
      try {
        const openclawBin = path.join(os.homedir(), '.nvm/versions/node/v22.22.0/bin/openclaw');
        const bin = fs.existsSync(openclawBin) ? openclawBin : 'openclaw';
        const out = execSync(`${bin} gateway stop`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
        steps.push({ cmd: stopCmd, output: out || '(gateway stopped)', ok: true });
      } catch (e) {
        const msg = (e.stderr && e.stderr.toString().trim()) || e.message || '(stop attempted)';
        steps.push({ cmd: stopCmd, output: msg, ok: true }); // non-fatal
      }

      // Step 2: Replace token in auth-profiles.json
      try {
        // Do the replacement with Node.js (handles special chars in tokens)
        const content = fs.readFileSync(authFile, 'utf8');
        fs.writeFileSync(authFile + '.bak', content); // create .bak
        const updated = oldToken ? content.split(oldToken).join(access_token) : content;
        fs.writeFileSync(authFile, updated);
        steps.push({ cmd: sedCmd, output: oldToken ? '(replaced)' : '(no existing token found, file unchanged)', ok: !!oldToken });
      } catch (e) {
        steps.push({ cmd: sedCmd, output: e.message, ok: false });
        return json(res, 200, { success: false, steps });
      }

      // Step 3: verify token in file
      const verifyCmd = `cat ~/.openclaw/agents/main/agent/auth-profiles.json | grep token`;
      try {
        const verifyContent = fs.readFileSync(authFile, 'utf8');
        const tokenLines = verifyContent.split('\n').filter(l => l.includes('token'));
        const verified = tokenLines.some(l => l.includes(access_token));
        steps.push({ cmd: verifyCmd, output: tokenLines.join('\n') || '(no token lines found)', ok: verified });
        if (!verified) return json(res, 200, { success: false, steps });
      } catch (e) {
        steps.push({ cmd: verifyCmd, output: e.message, ok: false });
        return json(res, 200, { success: false, steps });
      }

      // Step 4: Start OpenClaw gateway with new token
      const startCmd = `openclaw gateway`;
      try {
        const openclawBin = path.join(os.homedir(), '.nvm/versions/node/v22.22.0/bin/openclaw');
        const bin = fs.existsSync(openclawBin) ? openclawBin : 'openclaw';
        // Run in background — gateway runs as a daemon
        const { spawn } = require('child_process');
        const proc = spawn(bin, ['gateway'], { detached: true, stdio: 'ignore' });
        proc.unref();
        steps.push({ cmd: startCmd, output: '(gateway started in background)', ok: true });
      } catch (e) {
        steps.push({ cmd: startCmd, output: e.message, ok: false });
      }

      return json(res, 200, { success: true, steps });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  }

  if (p === '/health') return json(res, 200, { ok: true });

  if (p === '/') {
    const paths = [
      path.join(__dirname, 'index.html'),
      path.join(process.resourcesPath || __dirname, 'index.html'),
      path.join(app.getAppPath(), 'index.html'),
    ];
    for (const fp of paths) {
      try { return html(res, 200, fs.readFileSync(fp, 'utf8')); } catch {}
    }
    return html(res, 200, '<h1>index.html not found</h1>');
  }

  json(res, 404, { error: 'Not found' });
});

let mainWindow;

app.whenReady().then(() => {
  server.listen(PORT, '127.0.0.1', () => {
    mainWindow = new BrowserWindow({
      width: 620,
      height: 700,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 16 },
      backgroundColor: '#f0e8da',
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
  });
});

app.on('window-all-closed', () => { server.close(); app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) app.emit('ready'); });
