#!/usr/bin/env python3
"""Local flashcard webapp server. Stdlib only, no dependencies.

Usage:
    python3 server.py [port]

Decks live as *.json files in the decks/ directory, each a JSON array of
{"front": "...", "back": "..."} objects.
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent
DECKS_DIR = ROOT / "decks"
STATIC_DIR = ROOT / "static"

CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
}


def safe_deck_path(name: str) -> Path | None:
    if not name or "/" in name or "\\" in name or name.startswith("."):
        return None
    path = (DECKS_DIR / f"{name}.txt").resolve()
    if DECKS_DIR.resolve() not in path.parents:
        return None
    return path


def parse_deck(text: str) -> list[dict]:
    """Non-empty lines alternate front, back, front, back, ... Blank lines are ignored."""
    lines = [line.strip() for line in text.splitlines()]
    lines = [line for line in lines if line]
    cards = []
    for i in range(0, len(lines) - 1, 2):
        cards.append({"front": lines[i], "back": lines[i + 1]})
    return cards


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, status, message):
        self._send_json({"error": message}, status)

    def _serve_static(self, rel_path: str):
        if rel_path == "" or rel_path == "/":
            rel_path = "index.html"
        rel_path = rel_path.lstrip("/")
        path = (STATIC_DIR / rel_path).resolve()
        if STATIC_DIR.resolve() not in path.parents and path != STATIC_DIR.resolve():
            self._send_error_json(403, "Forbidden")
            return
        if not path.is_file():
            self._send_error_json(404, "Not found")
            return
        content_type = CONTENT_TYPES.get(path.suffix, "application/octet-stream")
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = unquote(self.path.split("?", 1)[0])

        if path == "/api/decks":
            names = sorted(p.stem for p in DECKS_DIR.glob("*.txt"))
            self._send_json({"decks": names})
            return

        if path.startswith("/api/decks/"):
            name = path[len("/api/decks/"):]
            deck_path = safe_deck_path(name)
            if deck_path is None:
                self._send_error_json(400, "Invalid deck name")
                return
            if not deck_path.is_file():
                self._send_error_json(404, "Deck not found")
                return
            cards = parse_deck(deck_path.read_text(encoding="utf-8"))
            self._send_json({"name": name, "cards": cards})
            return

        self._serve_static(path)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8420
    DECKS_DIR.mkdir(exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Flashcards running at http://127.0.0.1:{port}")
    print(f"Deck files: {DECKS_DIR}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping.")
        server.shutdown()


if __name__ == "__main__":
    main()
