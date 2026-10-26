const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { makeDecksDir, startServer } = require('./helpers/server');

// Deck parsing is checked through the real API, one deck file per case.
const CASES = {
  grouped: 'Q1\nA1\n\nQ2\nA2\n',
  ungrouped: 'Q1\nA1\nQ2\nA2\n',
  messy: '\n\n  Q1  \n\n\n\tA1\t\n\n\n',
  crlf: 'Q1\r\nA1\r\n\r\nQ2\r\nA2\r\n',
  odd: 'Q1\nA1\nQ2 with no answer\n',
  unicode: 'A major third up from C#\nE#\n\nGrüße 你好\nHello 👋\n',
  noTrailingNewline: 'Q1\nA1',
};

let server;
let decksDir;

async function cards(name) {
  const res = await fetch(`${server.base}/api/decks/${name}`);
  assert.equal(res.status, 200);
  return (await res.json()).cards;
}

before(async () => {
  decksDir = makeDecksDir(CASES);
  server = await startServer(decksDir);
});

after(async () => {
  await server?.stop();
  fs.rmSync(decksDir, { recursive: true, force: true });
});

describe('logic: deck parsing', () => {
  test('pairs lines as question then answer, with or without blank lines between pairs', async () => {
    const expected = [{ front: 'Q1', back: 'A1' }, { front: 'Q2', back: 'A2' }];
    assert.deepEqual(await cards('grouped'), expected);
    assert.deepEqual(await cards('ungrouped'), expected);
  });

  test('ignores extra blank lines and trims whitespace around each side', async () => {
    assert.deepEqual(await cards('messy'), [{ front: 'Q1', back: 'A1' }]);
  });

  test('handles Windows (CRLF) line endings', async () => {
    assert.deepEqual(await cards('crlf'), [{ front: 'Q1', back: 'A1' }, { front: 'Q2', back: 'A2' }]);
  });

  test('drops a trailing question that has no answer', async () => {
    assert.deepEqual(await cards('odd'), [{ front: 'Q1', back: 'A1' }]);
  });

  test('keeps sharps, accents and non-Latin text intact', async () => {
    assert.deepEqual(await cards('unicode'), [
      { front: 'A major third up from C#', back: 'E#' },
      { front: 'Grüße 你好', back: 'Hello 👋' },
    ]);
  });

  test('reads the last card when the file has no trailing newline', async () => {
    assert.deepEqual(await cards('noTrailingNewline'), [{ front: 'Q1', back: 'A1' }]);
  });
});
