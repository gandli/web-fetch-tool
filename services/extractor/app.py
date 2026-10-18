#!/usr/bin/env python3
"""Trafilatura sidecar for the web-fetch-tool precision extractor.

Zero third-party web framework: the standard library HTTP server plus
trafilatura. The Node/Bun service calls POST /extract with {html, url} and gets
{markdown, title, author, date, language, images} back.

Usage:
    .venv/Scripts/python.exe app.py --port 8100
    TRAFILATURA_URL=http://127.0.0.1:8100/extract bun run dev
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import trafilatura
    from trafilatura.metadata import extract_metadata
except ImportError:  # pragma: no cover - startup guard
    print("trafilatura is not installed; see requirements.txt", file=sys.stderr)
    raise

MAX_BODY = 12 * 1024 * 1024
MARKDOWN_IMAGE = re.compile(r"!\[[^\]]*\]\((https?://[^)\s]+)")


def extract(payload: dict) -> dict:
    html = payload.get("html") or ""
    url = payload.get("url") or None
    if not html.strip():
        raise ValueError("html is required")

    markdown = trafilatura.extract(
        html,
        url=url,
        output_format="markdown",
        include_images=True,
        include_links=True,
        include_tables=True,
        favor_precision=True,
        deduplicate=True,
    ) or ""

    title = author = date = language = None
    try:
        metadata = extract_metadata(html, default_url=url)
        if metadata is not None:
            title = metadata.title
            author = metadata.author
            date = metadata.date
            language = metadata.language
    except Exception:  # metadata is best-effort
        pass

    images: list[str] = []
    for match in MARKDOWN_IMAGE.finditer(markdown):
        candidate = match.group(1)
        if candidate not in images:
            images.append(candidate)
        if len(images) >= 20:
            break

    return {
        "markdown": markdown,
        "title": title,
        "author": author,
        "date": date,
        "language": language,
        "images": images,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "web-fetch-trafilatura/0.1"

    def log_message(self, fmt: str, *args) -> None:  # quieter access logs
        sys.stderr.write("[extractor] " + (fmt % args) + "\n")

    def _send(self, status: int, body: dict) -> None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send(200, {"ok": True, "trafilatura": trafilatura.__version__})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/extract":
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("content-length") or 0)
            if length <= 0 or length > MAX_BODY:
                self._send(413, {"error": "invalid content length"})
                return
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            self._send(200, extract(payload))
        except ValueError as error:
            self._send(400, {"error": str(error)})
        except Exception as error:  # noqa: BLE001
            self.log_message("extract failed: %s", error)
            self._send(500, {"error": "extraction failed"})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8100)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"trafilatura sidecar listening on http://{args.host}:{args.port}/extract", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
