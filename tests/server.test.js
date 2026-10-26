const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { makeDecksDir, startServer } = require('./helpers/server');

// Sends a request with the path exactly as written (fetch would normalise "..").
function rawGet(port, rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

const DECKS = {
  capitals: 'Capital of France\nParis\n\nCapital of Germany?\nBerlin\n',
  'b deck': 'Q1\nA1\n',
  empty: '\n\n',
};

let server;
let decksDir;

before(async () => {
  decksDir = makeDecksDir(DECKS);
  fs.writeFileSync(path.join(decksDir, 'notes.md'), 'not a deck');
  fs.writeFileSync(path.join(decksDir, '.hidden.txt'), 'Secret\nStuff\n');
  server = await startServer(decksDir);
});

after(async () => {
  await server?.stop();
  fs.rmSync(decksDir, { recursive: true, force: true });
});

describe('server: startup', () => {
  test('starts and serves the index page', async () => {
    const res = await fetch(`${server.base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/html/);
    const html = await res.text();
    assert.match(html, /<script src="app\.js"><\/script>/);
    assert.match(html, /id="deck-select"/);
  });

  test('serves the script and stylesheet with the right content types', async () => {
    const js = await fetch(`${server.base}/app.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /^text\/javascript/);
    const css = await fetch(`${server.base}/style.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /^text\/css/);
  });

  test('ignores a query string when serving pages', async () => {
    const res = await fetch(`${server.base}/app.js?v=2`);
    assert.equal(res.status, 200);
  });

  test('returns 404 JSON for a missing static file', async () => {
    const res = await fetch(`${server.base}/nope.html`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'Not found' });
  });

  test('refuses to serve files outside static/ via ..', async () => {
    const res = await rawGet(server.port, '/../server.py');
    assert.equal(res.status, 403);
    assert.doesNotMatch(res.body, /ThreadingHTTPServer/);
  });

  test('refuses an encoded .. path outside static/', async () => {
    const res = await rawGet(server.port, '/%2e%2e/server.py');
    assert.equal(res.status, 403);
    assert.doesNotMatch(res.body, /ThreadingHTTPServer/);
  });
});

describe('api: deck list', () => {
  test('lists every .txt deck by name, sorted, ignoring other files', async () => {
    const res = await fetch(`${server.base}/api/decks`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^application\/json/);
    const { decks } = await res.json();
    assert.deepEqual(decks.filter((d) => !d.startsWith('.')), ['b deck', 'capitals', 'empty']);
  });

  test('does not list a dotfile deck that the load endpoint refuses to open',
    { todo: 'BUG: on Python 3.13+ glob("*.txt") matches dotfiles, so .hidden.txt shows in the dropdown but /api/decks/.hidden returns 400' },
    async () => {
      const { decks } = await (await fetch(`${server.base}/api/decks`)).json();
      assert.ok(!decks.includes('.hidden'));
    });

  test('picks up a deck file added while the server is running', async () => {
    fs.writeFileSync(path.join(decksDir, 'later.txt'), 'X\nY\n');
    try {
      const { decks } = await (await fetch(`${server.base}/api/decks`)).json();
      assert.ok(decks.includes('later'));
    } finally {
      fs.rmSync(path.join(decksDir, 'later.txt'));
    }
  });
});

describe('api: load a deck', () => {
  test('returns the cards of a deck as front/back pairs', async () => {
    const res = await fetch(`${server.base}/api/decks/capitals`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      name: 'capitals',
      cards: [
        { front: 'Capital of France', back: 'Paris' },
        { front: 'Capital of Germany?', back: 'Berlin' },
      ],
    });
  });

  test('loads a deck whose name has a space (URL-encoded)', async () => {
    const res = await fetch(`${server.base}/api/decks/${encodeURIComponent('b deck')}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.name, 'b deck');
    assert.deepEqual(body.cards, [{ front: 'Q1', back: 'A1' }]);
  });

  test('returns an empty card list for a deck with only blank lines', async () => {
    const res = await fetch(`${server.base}/api/decks/empty`);
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).cards, []);
  });

  test('returns 404 for a deck that does not exist', async () => {
    const res = await fetch(`${server.base}/api/decks/missing`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'Deck not found' });
  });

  test('rejects a deck name that tries to escape the decks dir', async () => {
    for (const name of ['..%2Fserver', '%2E%2E%2F%2E%2E%2Fetc%2Fpasswd', 'a%5Cb']) {
      const res = await rawGet(server.port, `/api/decks/${name}`);
      assert.equal(res.status, 400, name);
      assert.deepEqual(JSON.parse(res.body), { error: 'Invalid deck name' }, name);
    }
  });

  test('rejects a hidden (dot) deck name', async () => {
    const res = await fetch(`${server.base}/api/decks/.hidden`);
    assert.equal(res.status, 400);
  });

  test('rejects an empty deck name', async () => {
    const res = await fetch(`${server.base}/api/decks/`);
    assert.equal(res.status, 400);
  });
});
