from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from predict_complaint_category import predict_from_description


class PredictionHandler(BaseHTTPRequestHandler):
    artifacts_dir = Path("ml/artifacts/current")

    def _json_response(self, status_code: int, payload: dict):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._json_response(200, {"ok": True})

    def do_GET(self):
        if self.path == "/health":
            self._json_response(
                200,
                {
                    "ok": True,
                    "artifacts": str(self.artifacts_dir),
                },
            )
            return

        self._json_response(404, {"error": "Not Found"})

    def do_POST(self):
        if self.path != "/predict":
            self._json_response(404, {"error": "Not Found"})
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(content_length) if content_length > 0 else b"{}"

        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self._json_response(400, {"error": "Invalid JSON body"})
            return

        description = str(payload.get("description", "")).strip()
        if not description:
            self._json_response(400, {"error": "description is required"})
            return

        try:
            prediction = predict_from_description(description, self.artifacts_dir)
        except Exception as error:
            self._json_response(500, {"error": str(error)})
            return

        self._json_response(200, prediction)


def main():
    parser = argparse.ArgumentParser(description="Run local complaint prediction API server")
    parser.add_argument("--host", default="0.0.0.0", help="Bind host")
    parser.add_argument("--port", type=int, default=8000, help="Bind port")
    parser.add_argument("--artifacts", default="ml/artifacts/current", help="Artifacts directory")
    args = parser.parse_args()

    PredictionHandler.artifacts_dir = Path(args.artifacts)
    server = ThreadingHTTPServer((args.host, args.port), PredictionHandler)

    print(f"Prediction API server running at http://{args.host}:{args.port}")
    print(f"Using artifacts: {PredictionHandler.artifacts_dir.resolve()}")
    print("Endpoints: GET /health, POST /predict")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
