// Starts the real Python server on a free port against a temp decks dir.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function makeDecksDir(decks = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flash-cards-'));
  for (const [name, text] of Object.entries(decks)) {
    fs.writeFileSync(path.join(dir, `${name}.txt`), text);
  }
  return dir;
}

async function waitFor(url, proc, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`server exited with code ${proc.exitCode}`);
    try {
      const res = await fetch(url);
      await res.arrayBuffer();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error(`server did not answer at ${url}`);
}

async function startServer(decksDir) {
  const port = await freePort();
  const proc = spawn('python3', [path.join(ROOT, 'server.py'), String(port)], {
    cwd: ROOT,
    env: { ...process.env, DECKS_DIR: decksDir, HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d; });
  proc.stdout.resume();
  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/api/decks`, proc);
  return {
    base,
    port,
    proc,
    stderr: () => stderr,
    stop: () => new Promise((resolve) => {
      if (proc.exitCode !== null) return resolve();
      proc.once('exit', () => resolve());
      proc.kill('SIGTERM');
    }),
  };
}

module.exports = { ROOT, freePort, makeDecksDir, startServer };
