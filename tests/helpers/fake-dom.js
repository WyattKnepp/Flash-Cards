// Runs static/app.js in a vm with a minimal fake DOM, a manual clock and a
// seeded Math.random, with fetch pointed at a real running server.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ROOT } = require('./server');

class ClassList {
  constructor(initial = []) { this.set = new Set(initial); }
  add(c) { this.set.add(c); }
  remove(c) { this.set.delete(c); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) {
    const on = force === undefined ? !this.set.has(c) : Boolean(force);
    if (on) this.set.add(c); else this.set.delete(c);
  }
}

class FakeElement {
  constructor(tag, { classes = [], ...props } = {}) {
    this.tagName = tag.toUpperCase();
    this.classList = new ClassList(classes);
    this.children = [];
    this.listeners = {};
    this.style = {};
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.checked = false;
    this.offsetWidth = 300;
    this._innerHTML = '';
    this._selectors = {};
    Object.assign(this, props);
  }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(v) {
    this._innerHTML = v;
    this.children = [];
    if (this.tagName === 'SELECT') this.value = '';
  }
  appendChild(child) {
    this.children.push(child);
    // A <select> takes the value of its first option, like a browser.
    if (this.tagName === 'SELECT' && this.children.length === 1) this.value = child.value || child.textContent;
    return child;
  }
  querySelector(sel) { return this._selectors[sel] || null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type, event = {}) {
    const e = { preventDefault() {}, ...event };
    return Promise.all((this.listeners[type] || []).map((fn) => fn(e)));
  }
  setPointerCapture() {}
  blur() { this.blurred = true; }
}

function seededRandom(seed) {
  // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const clock = {
    now: () => now,
    setTimeout(fn, ms = 0) { const id = nextId++; timers.set(id, { fn, at: now + ms }); return id; },
    setInterval(fn, ms) { const id = nextId++; timers.set(id, { fn, at: now + ms, every: ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    clearInterval(id) { timers.delete(id); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        const [id, t] = next;
        now = t.at;
        if (t.every) t.at += t.every; else timers.delete(id);
        t.fn();
      }
      now = end;
    },
  };
  return clock;
}

async function until(cond, what = 'condition', timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setImmediate(r));
  }
}

const IDS = [
  'setup-screen', 'session-screen', 'deck-select', 'start-btn', 'setup-error', 'back-btn',
  'progress', 'card', 'hints', 'complete', 'restart-btn', 'round-summary',
  'round-summary-title', 'round-summary-detail', 'continue-btn', 'continue-hint',
  'timer-enabled', 'timer-seconds', 'timer-indicator',
];

// touch: true makes matchMedia('(pointer: coarse)') match, like a phone.
async function loadApp(base, { seed = 1, touch = false } = {}) {
  const els = {};
  for (const id of IDS) els[id] = new FakeElement(id === 'deck-select' ? 'select' : 'div', { id });
  els['session-screen'].classList.add('hidden');
  els['complete'].classList.add('hidden');
  els['round-summary'].classList.add('hidden');
  els['timer-seconds'].value = '10';
  els['timer-seconds'].disabled = true;
  const front = new FakeElement('div', { classes: ['card-front'] });
  const back = new FakeElement('div', { classes: ['card-back'] });
  const inner = new FakeElement('div', { classes: ['card-inner'] });
  els.card._selectors = { '.card-front': front, '.card-back': back, '.card-inner': inner };

  const modes = { standard: { value: 'standard' }, study: { value: 'study' } };
  let mode = 'standard';
  const docListeners = new FakeElement('document');
  const document = {
    getElementById: (id) => els[id] || null,
    createElement: (tag) => new FakeElement(tag),
    querySelector: (sel) => (sel === 'input[name="mode"]:checked' ? modes[mode] : null),
    addEventListener: (type, fn) => docListeners.addEventListener(type, fn),
  };

  const clock = makeClock();
  const context = vm.createContext({
    document,
    window: { innerWidth: 1000, matchMedia: (q) => ({ matches: touch && q === '(pointer: coarse)' }) },
    performance: { now: clock.now },
    fetch: (url, opts) => fetch(new URL(url, base), opts),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    console,
  });
  vm.runInContext(`Math.random = (${seededRandom.toString()})(${seed});`, context);
  const src = fs.readFileSync(path.join(ROOT, 'static', 'app.js'), 'utf8');
  vm.runInContext(src, context, { filename: 'static/app.js' });

  const select = els['deck-select'];
  await until(() => select.children.length > 0, 'deck list to load');

  const app = {
    els, front, back, clock,
    setMode(m) { mode = m; },
    key(code) { return docListeners.dispatch('keydown', { code }); },
    async start(deck, m = 'standard', timer) {
      mode = m;
      if (deck !== undefined) select.value = deck;
      if (timer) {
        els['timer-enabled'].checked = true;
        els['timer-seconds'].value = String(timer);
      }
      await els['start-btn'].dispatch('click');
    },
    inSession: () => !els['session-screen'].classList.contains('hidden'),
    flipped: () => els.card.classList.contains('flipped'),
    progress: () => els.progress.textContent,
    deckOptions: () => select.children.map((o) => o.textContent),
    // A touch gesture from x=0 that ends dx pixels away after ms milliseconds.
    async swipe(dx, ms = 300, dy = 0) {
      const t0 = clock.now();
      const steps = 5;
      await els.card.dispatch('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 0, clientY: 0, timeStamp: t0 });
      for (let i = 1; i <= steps; i++) {
        clock.advance(ms / steps);
        await els.card.dispatch('pointermove', {
          pointerId: 1, clientX: (dx * i) / steps, clientY: (dy * i) / steps, timeStamp: clock.now(),
        });
      }
      await els.card.dispatch('pointerup', { pointerId: 1, clientX: dx, clientY: dy, timeStamp: clock.now() });
    },
  };
  return app;
}

module.exports = { loadApp, until };
