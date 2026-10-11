const setupScreen = document.getElementById("setup-screen");
const sessionScreen = document.getElementById("session-screen");
const deckSelect = document.getElementById("deck-select");
const startBtn = document.getElementById("start-btn");
const setupError = document.getElementById("setup-error");
const backBtn = document.getElementById("back-btn");
const progressEl = document.getElementById("progress");
const cardEl = document.getElementById("card");
const cardFront = cardEl.querySelector(".card-front");
const cardBack = cardEl.querySelector(".card-back");
const hintsEl = document.getElementById("hints");
const completeEl = document.getElementById("complete");
const restartBtn = document.getElementById("restart-btn");
const roundSummaryEl = document.getElementById("round-summary");
const roundSummaryTitle = document.getElementById("round-summary-title");
const roundSummaryDetail = document.getElementById("round-summary-detail");
const timerEnabledCheckbox = document.getElementById("timer-enabled");
const timerSecondsInput = document.getElementById("timer-seconds");
const timerIndicator = document.getElementById("timer-indicator");

let session = null; // active session state, or null when on setup screen
let timerConfig = { enabled: false, seconds: 10 };
let autoFlipTimeout = null;
let countdownInterval = null;

timerEnabledCheckbox.addEventListener("change", () => {
  timerSecondsInput.disabled = !timerEnabledCheckbox.checked;
});

function clearAutoFlipTimer() {
  if (autoFlipTimeout) {
    clearTimeout(autoFlipTimeout);
    autoFlipTimeout = null;
  }
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  timerIndicator.textContent = "";
}

function scheduleAutoFlip() {
  clearAutoFlipTimer();
  if (!timerConfig.enabled) return;

  let remaining = timerConfig.seconds;
  timerIndicator.textContent = `Flipping in ${remaining}s…`;
  countdownInterval = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      timerIndicator.textContent = `Flipping in ${remaining}s…`;
    }
  }, 1000);
  autoFlipTimeout = setTimeout(() => {
    cardEl.classList.add("flipped");
    clearAutoFlipTimer();
  }, timerConfig.seconds * 1000);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function loadDeckList() {
  const res = await fetch("/api/decks");
  const data = await res.json();
  deckSelect.innerHTML = "";
  if (!data.decks || data.decks.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "No decks found in decks/";
    deckSelect.appendChild(opt);
    startBtn.disabled = true;
    return;
  }
  startBtn.disabled = false;
  for (const name of data.decks) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    deckSelect.appendChild(opt);
  }
}

async function loadDeck(name) {
  const res = await fetch(`/api/decks/${encodeURIComponent(name)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to load deck");
  }
  return res.json();
}

function getSelectedMode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function showSetup() {
  session = null;
  clearAutoFlipTimer();
  sessionScreen.classList.add("hidden");
  setupScreen.classList.remove("hidden");
  loadDeckList();
}

function showSession() {
  setupScreen.classList.add("hidden");
  sessionScreen.classList.remove("hidden");
  completeEl.classList.add("hidden");
  roundSummaryEl.classList.add("hidden");
  cardEl.classList.remove("hidden");
}

function renderCard() {
  const card = session.mode === "standard"
    ? session.cards[session.index]
    : session.queue[session.index];

  const cardInner = cardEl.querySelector(".card-inner");
  cardInner.classList.add("no-anim");
  cardEl.classList.remove("flipped");
  cardFront.textContent = card.front;
  cardBack.textContent = card.back;
  // Force layout so the un-flip above applies before re-enabling the transition,
  // otherwise the next manual flip animates in from wherever it last was.
  void cardInner.offsetWidth;
  cardInner.classList.remove("no-anim");

  if (session.mode === "standard") {
    progressEl.textContent = `Card ${session.index + 1} of ${session.cards.length}`;
    hintsEl.innerHTML = `<span>&larr; previous</span><span>space to flip</span><span>next &rarr;</span>`;
  } else {
    const remainingTotal = session.queue.length - session.index + session.failedThisRound.length;
    progressEl.textContent =
      `Round ${session.round} · Card ${session.index + 1} of ${session.queue.length} · ${remainingTotal} left overall`;
    hintsEl.innerHTML =
      `<span class="fail-hint">&larr; fail</span><span>space to flip</span><span class="success-hint">success &rarr;</span>`;
  }

  scheduleAutoFlip();
}

function startStandard(cards) {
  session = { mode: "standard", cards, index: 0 };
  showSession();
  renderCard();
}

function startStudyRound(pool, round) {
  session = {
    mode: "study",
    queue: shuffle(pool),
    index: 0,
    round,
    failedThisRound: [],
  };
  showSession();
  renderCard();
}

function flip() {
  if (!session) return;
  cardEl.classList.toggle("flipped");
  clearAutoFlipTimer();
}

function standardPrev() {
  if (session.index > 0) {
    session.index--;
    renderCard();
  }
}

function standardNext() {
  if (session.index < session.cards.length - 1) {
    session.index++;
    renderCard();
  }
}

function studyAnswer(success) {
  const card = session.queue[session.index];
  if (!success) {
    session.failedThisRound.push(card);
  }

  if (session.index < session.queue.length - 1) {
    session.index++;
    renderCard();
    return;
  }

  // End of this round.
  const wrong = session.failedThisRound.length;
  const right = session.queue.length - wrong;

  clearAutoFlipTimer();
  cardEl.classList.add("hidden");
  hintsEl.innerHTML = "";
  progressEl.textContent = "";

  if (wrong === 0) {
    completeEl.classList.remove("hidden");
  } else {
    roundSummaryTitle.textContent = `Round ${session.round} complete`;
    roundSummaryDetail.textContent = `${right} right, ${wrong} wrong`;
    roundSummaryEl.classList.remove("hidden");
    session.awaitingRoundAck = { nextPool: session.failedThisRound, nextRound: session.round + 1 };
  }
}

document.addEventListener("keydown", (e) => {
  if (!session) return;
  if (!completeEl.classList.contains("hidden")) return;

  if (session.awaitingRoundAck) {
    if (e.code === "Space") {
      e.preventDefault();
      const { nextPool, nextRound } = session.awaitingRoundAck;
      startStudyRound(nextPool, nextRound);
    }
    return;
  }

  if (e.code === "Space") {
    e.preventDefault();
    flip();
    return;
  }
  if (e.code === "ArrowLeft") {
    e.preventDefault();
    if (session.mode === "standard") standardPrev();
    else studyAnswer(false);
    return;
  }
  if (e.code === "ArrowRight") {
    e.preventDefault();
    if (session.mode === "standard") standardNext();
    else studyAnswer(true);
    return;
  }
});

cardEl.addEventListener("click", flip);

startBtn.addEventListener("click", async () => {
  setupError.textContent = "";
  const deckName = deckSelect.value;
  const mode = getSelectedMode();
  timerConfig = {
    enabled: timerEnabledCheckbox.checked,
    seconds: Math.max(1, parseInt(timerSecondsInput.value, 10) || 10),
  };
  try {
    const deck = await loadDeck(deckName);
    if (!deck.cards || deck.cards.length === 0) {
      setupError.textContent = "That deck has no cards.";
      return;
    }
    if (mode === "standard") {
      startStandard(deck.cards);
    } else {
      startStudyRound(deck.cards, 1);
    }
  } catch (err) {
    setupError.textContent = err.message;
  }
});

backBtn.addEventListener("click", showSetup);
restartBtn.addEventListener("click", () => {
  const deckName = deckSelect.value;
  loadDeck(deckName).then((deck) => startStudyRound(deck.cards, 1));
});

showSetup();
