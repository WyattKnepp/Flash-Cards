const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeDecksDir, startServer } = require('./helpers/server');
const { loadApp, until } = require('./helpers/fake-dom');

// static/app.js runs against a minimal fake DOM (tests/helpers/fake-dom.js)
// and the real server. Timers are a manual clock; Math.random is seeded.

let server;
let decksDir;

before(async () => {
  decksDir = makeDecksDir({
    three: 'Q1\nA1\n\nQ2\nA2\n\nQ3\nA3\n',
    two: 'Q1\nA1\n\nQ2\nA2\n',
    empty: '\n',
  });
  server = await startServer(decksDir);
});

after(async () => {
  await server?.stop();
  fs.rmSync(decksDir, { recursive: true, force: true });
});

describe('ui: setup screen', () => {
  test('fills the deck dropdown from the server', async () => {
    const app = await loadApp(server.base);
    assert.deepEqual(app.deckOptions(), ['empty', 'three', 'two']);
    assert.equal(app.els['start-btn'].disabled, false);
    assert.equal(app.inSession(), false);
  });

  test('says there are no decks and disables Start when the decks dir is empty', async () => {
    const emptyDir = makeDecksDir();
    const s = await startServer(emptyDir);
    try {
      const app = await loadApp(s.base);
      assert.deepEqual(app.deckOptions(), ['No decks found in decks/']);
      assert.equal(app.els['start-btn'].disabled, true);
    } finally {
      await s.stop();
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  test('shows an error instead of starting a deck with no cards', async () => {
    const app = await loadApp(server.base);
    await app.start('empty');
    assert.equal(app.els['setup-error'].textContent, 'That deck has no cards.');
    assert.equal(app.inSession(), false);
  });

  test('shows the server error when the chosen deck was deleted after the list loaded', async () => {
    fs.writeFileSync(path.join(decksDir, 'gone.txt'), 'Q\nA\n');
    let app;
    try {
      app = await loadApp(server.base);
      assert.ok(app.deckOptions().includes('gone'));
    } finally {
      fs.rmSync(path.join(decksDir, 'gone.txt'));
    }
    await app.start('gone');
    assert.equal(app.els['setup-error'].textContent, 'Deck not found');
    assert.equal(app.inSession(), false);
  });

  test('the timer seconds box is only enabled while the timer is ticked', async () => {
    const app = await loadApp(server.base);
    const box = app.els['timer-enabled'];
    box.checked = true;
    await box.dispatch('change');
    assert.equal(app.els['timer-seconds'].disabled, false);
    box.checked = false;
    await box.dispatch('change');
    assert.equal(app.els['timer-seconds'].disabled, true);
  });
});

describe('ui: standard mode', () => {
  test('starts on card 1 showing its question and answer', async () => {
    const app = await loadApp(server.base);
    await app.start('three', 'standard');
    assert.equal(app.inSession(), true);
    assert.equal(app.progress(), 'Card 1 of 3');
    assert.equal(app.front.textContent, 'Q1');
    assert.equal(app.back.textContent, 'A1');
    assert.equal(app.flipped(), false);
  });

  test('right and left arrows move through cards in file order and stop at the ends', async () => {
    const app = await loadApp(server.base);
    await app.start('three', 'standard');
    await app.key('ArrowLeft');
    assert.equal(app.progress(), 'Card 1 of 3');
    await app.key('ArrowRight');
    await app.key('ArrowRight');
    assert.equal(app.progress(), 'Card 3 of 3');
    assert.equal(app.front.textContent, 'Q3');
    await app.key('ArrowRight');
    assert.equal(app.progress(), 'Card 3 of 3');
    await app.key('ArrowLeft');
    assert.equal(app.front.textContent, 'Q2');
  });

  test('space flips the card back and forth, and moving on shows the next question unflipped', async () => {
    const app = await loadApp(server.base);
    await app.start('three', 'standard');
    await app.key('Space');
    assert.equal(app.flipped(), true);
    await app.key('Space');
    assert.equal(app.flipped(), false);
    await app.key('Space');
    await app.key('ArrowRight');
    assert.equal(app.flipped(), false);
  });

  test('clicking the card flips it', async () => {
    const app = await loadApp(server.base);
    await app.start('three', 'standard');
    await app.els.card.dispatch('click');
    assert.equal(app.flipped(), true);
  });

  test('the back button returns to the deck list and ignores further keys', async () => {
    const app = await loadApp(server.base);
    await app.start('three', 'standard');
    await app.els['back-btn'].dispatch('click');
    assert.equal(app.inSession(), false);
    await app.key('Space');
    assert.equal(app.flipped(), false);
  });
});

describe('ui: study mode', () => {
  test('shows round and remaining counts and finishes when every card is right first time', async () => {
    const app = await loadApp(server.base);
    await app.start('three', 'study');
    assert.equal(app.progress(), 'Round 1 · Card 1 of 3 · 3 left overall');
    const seen = [];
    for (let i = 0; i < 3; i++) {
      seen.push(app.front.textContent);
      await app.key('ArrowRight');
    }
    assert.deepEqual([...seen].sort(), ['Q1', 'Q2', 'Q3']);
    assert.equal(app.els.complete.classList.contains('hidden'), false);
    assert.equal(app.els.card.classList.contains('hidden'), true);
  });

  test('missed cards come back next round until each is answered right', async () => {
    const app = await loadApp(server.base);
    await app.start('three', 'study');
    const missed = app.front.textContent;
    await app.key('ArrowLeft'); // fail the first card
    assert.equal(app.progress(), 'Round 1 · Card 2 of 3 · 3 left overall');
    await app.key('ArrowRight');
    await app.key('ArrowRight');

    assert.equal(app.els['round-summary'].classList.contains('hidden'), false);
    assert.equal(app.els['round-summary-title'].textContent, 'Round 1 complete');
    assert.equal(app.els['round-summary-detail'].textContent, '2 right, 1 wrong');

    // Arrows do nothing on the summary; space starts the next round.
    await app.key('ArrowRight');
    assert.equal(app.els['round-summary'].classList.contains('hidden'), false);
    await app.key('Space');
    assert.equal(app.progress(), 'Round 2 · Card 1 of 1 · 1 left overall');
    assert.equal(app.front.textContent, missed);

    await app.key('ArrowLeft'); // miss it again
    assert.equal(app.els['round-summary-detail'].textContent, '0 right, 1 wrong');
    await app.key('Space');
    assert.equal(app.progress(), 'Round 3 · Card 1 of 1 · 1 left overall');
    await app.key('ArrowRight');
    assert.equal(app.els.complete.classList.contains('hidden'), false);
  });

  test('every round shows each remaining card exactly once', async () => {
    const app = await loadApp(server.base, { seed: 42 });
    await app.start('three', 'study');
    const round1 = [];
    for (let i = 0; i < 3; i++) {
      round1.push(app.front.textContent);
      await app.key('ArrowLeft');
    }
    assert.deepEqual([...round1].sort(), ['Q1', 'Q2', 'Q3']);
    await app.key('Space');
    const round2 = [];
    for (let i = 0; i < 3; i++) {
      round2.push(app.front.textContent);
      await app.key(i === 0 ? 'ArrowRight' : 'ArrowLeft');
    }
    assert.deepEqual([...round2].sort(), ['Q1', 'Q2', 'Q3']);
    assert.equal(app.els['round-summary-detail'].textContent, '1 right, 2 wrong');
    await app.key('Space');
    assert.match(app.progress(), /^Round 3 · Card 1 of 2 /);
  });

  test('"left overall" counts cards already failed this round', async () => {
    const app = await loadApp(server.base);
    await app.start('three', 'study');
    await app.key('ArrowLeft');
    await app.key('ArrowRight');
    assert.equal(app.progress(), 'Round 1 · Card 3 of 3 · 2 left overall');
  });

  test('Study again restarts round 1 with the whole deck', async () => {
    const app = await loadApp(server.base);
    await app.start('two', 'study');
    await app.key('ArrowRight');
    await app.key('ArrowRight');
    assert.equal(app.els.complete.classList.contains('hidden'), false);
    await app.els['restart-btn'].dispatch('click');
    await until(() => app.els.complete.classList.contains('hidden'), 'restart');
    assert.equal(app.progress(), 'Round 1 · Card 1 of 2 · 2 left overall');
  });
});

describe('ui: auto-flip timer', () => {
  test('flips the card after the chosen number of seconds with a countdown', async () => {
    const app = await loadApp(server.base);
    await app.start('three', 'standard', 3);
    assert.equal(app.els['timer-indicator'].textContent, 'Flipping in 3s…');
    app.clock.advance(1000);
    assert.equal(app.els['timer-indicator'].textContent, 'Flipping in 2s…');
    app.clock.advance(1999);
    assert.equal(app.flipped(), false);
    app.clock.advance(1);
    assert.equal(app.flipped(), true);
    assert.equal(app.els['timer-indicator'].textContent, '');
  });

  test('restarts the countdown on each new card', async () => {
    const app = await loadApp(server.base);
    await app.start('three', 'standard', 2);
    app.clock.advance(1500);
    await app.key('ArrowRight');
    app.clock.advance(1500);
    assert.equal(app.flipped(), false);
    app.clock.advance(500);
    assert.equal(app.flipped(), true);
  });

  test('flipping by hand cancels the timer so it does not flip back', async () => {
    const app = await loadApp(server.base);
    await app.start('three', 'standard', 2);
    await app.key('Space');
    app.clock.advance(5000);
    assert.equal(app.flipped(), true);
    assert.equal(app.els['timer-indicator'].textContent, '');
  });

  test('treats a blank or zero seconds value safely (10s and 1s)', async () => {
    const blank = await loadApp(server.base);
    blank.els['timer-enabled'].checked = true;
    blank.els['timer-seconds'].value = '';
    await blank.start('three', 'standard');
    assert.equal(blank.els['timer-indicator'].textContent, 'Flipping in 10s…');

    const zero = await loadApp(server.base);
    zero.els['timer-enabled'].checked = true;
    zero.els['timer-seconds'].value = '0';
    await zero.start('three', 'standard');
    // parseInt("0") is 0, which falls back to 10 before the 1s floor applies
    assert.equal(zero.els['timer-indicator'].textContent, 'Flipping in 10s…');
  });

  test('shows no countdown when the timer is off', async () => {
    const app = await loadApp(server.base);
    await app.start('three', 'standard');
    app.clock.advance(60000);
    assert.equal(app.flipped(), false);
    assert.equal(app.els['timer-indicator'].textContent, '');
  });
});

describe('ui: touch gestures', () => {
  test('a long swipe right goes to the next card after the fly-off animation', async () => {
    const app = await loadApp(server.base);
    await app.start('three', 'standard');
    await app.swipe(200);
    assert.equal(app.progress(), 'Card 1 of 3');
    app.clock.advance(250);
    assert.equal(app.progress(), 'Card 2 of 3');
  });

  test('a quick flick counts even when it is short', async () => {
    const app = await loadApp(server.base);
    await app.start('three', 'standard');
    await app.swipe(60, 50);
    app.clock.advance(250);
    assert.equal(app.progress(), 'Card 2 of 3');
  });

  test('a short slow drag springs back and does nothing', async () => {
    const app = await loadApp(server.base);
    await app.start('three', 'standard');
    await app.swipe(60, 1000);
    app.clock.advance(1000);
    assert.equal(app.progress(), 'Card 1 of 3');
    assert.equal(app.els.card.style.transform, '');
  });

  test('swiping left on the first standard card springs back', async () => {
    const app = await loadApp(server.base);
    await app.start('three', 'standard');
    await app.swipe(-200);
    app.clock.advance(1000);
    assert.equal(app.progress(), 'Card 1 of 3');
  });

  test('a tap flips the card once (the follow-up click is ignored)', async () => {
    const app = await loadApp(server.base);
    await app.start('three', 'standard');
    await app.swipe(0, 50);
    assert.equal(app.flipped(), true);
    await app.els.card.dispatch('click');
    assert.equal(app.flipped(), true);
  });

  test('a vertical drag is ignored', async () => {
    const app = await loadApp(server.base);
    await app.start('three', 'standard');
    await app.swipe(20, 300, 200);
    app.clock.advance(1000);
    assert.equal(app.progress(), 'Card 1 of 3');
    assert.equal(app.flipped(), false);
  });

  test('in study mode a left swipe fails the card and a right swipe passes it', async () => {
    const app = await loadApp(server.base);
    await app.start('two', 'study');
    await app.swipe(-200);
    app.clock.advance(250);
    await app.swipe(200);
    app.clock.advance(250);
    assert.equal(app.els['round-summary-detail'].textContent, '1 right, 1 wrong');
  });

  test('mouse drags are ignored', async () => {
    const app = await loadApp(server.base);
    await app.start('three', 'standard');
    await app.els.card.dispatch('pointerdown', { pointerType: 'mouse', pointerId: 1, clientX: 0, clientY: 0, timeStamp: 0 });
    await app.els.card.dispatch('pointermove', { pointerId: 1, clientX: 200, clientY: 0, timeStamp: 100 });
    await app.els.card.dispatch('pointerup', { pointerId: 1, clientX: 200, clientY: 0, timeStamp: 100 });
    app.clock.advance(1000);
    assert.equal(app.progress(), 'Card 1 of 3');
  });
});
