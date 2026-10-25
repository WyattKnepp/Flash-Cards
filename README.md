# Flashcards

A tiny local flashcard webapp. No dependencies — just Python 3's standard library.

## Run it

```
python3 server.py
```

Then open http://127.0.0.1:8420 in your browser. Pass a different port as an argument if needed, e.g. `python3 server.py 9000`.

## Decks

Decks live in `decks/` as `*.txt` files. Non-empty lines alternate question, answer, question, answer — blank lines are ignored, so you can group pairs with a blank line between them for readability:

```
Whats the captial of france
Paris

Whats the captial of Germany?
Berlin
```

Add, edit, or remove `.txt` files in `decks/` and they'll show up in the deck dropdown next time you load the page.

## Modes

- **Standard** — browse freely. Left arrow (or swipe left) = previous card, right arrow (or swipe right) = next card, spacebar (or tap the card) = flip.
- **Study** — left arrow (or swipe left) = fail, right arrow (or swipe right) = success, spacebar (or tap the card) = flip. Cards you get right drop out of the deck; cards you miss stay in and the remaining pile is reshuffled each round. The session ends when every card has been answered correctly at least once (in its most recent round).

Swiping and tapping work on touch screens only. A short or slow drag springs the card back and does nothing.
