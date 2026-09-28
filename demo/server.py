"""
BESing Local Demo Server & Full Agent Sync RPC Server
Features:
- GET  /api/sync/health   : Endpoint health check
- GET  /api/sync/status   : Retrieves the browser's live extension list, status (on/off), and script content
- POST /api/sync/push     : Browser pushes live extensions, status, and script content
- POST /api/sync/pull     : Browser pulls queued agent commands (insert script, set status on/off, modify script)
- POST /api/sync/command  : Agent issues commands to control browser extensions live
"""
import os
import sys
import json
import time
import http.server
import socketserver

PORT = 8765
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BESING_ROOT = os.path.dirname(SCRIPT_DIR)

# In-memory Agent State
LATEST_BROWSER_STATE = {
    "site": None,
    "url": None,
    "extensions": [],
    "blockedSites": [],
    "lastUpdated": 0
}

# Queue of commands from agent to browser
PENDING_COMMANDS = []

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BESING_ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        # Health check
        if self.path.startswith("/api/sync/health"):
            self._send_json(200, {
                "status": "ok",
                "agent": "BESing-AgentSync-v1.1",
                "timestamp": int(time.time() * 1000)
            })
            return

        # Query live browser status list and script content
        if self.path.startswith("/api/sync/status"):
            self._send_json(200, {
                "status": "ok",
                "site": LATEST_BROWSER_STATE.get("site"),
                "url": LATEST_BROWSER_STATE.get("url"),
                "extensionsCount": len(LATEST_BROWSER_STATE.get("extensions", [])),
                "extensions": LATEST_BROWSER_STATE.get("extensions", []),
                "blockedSites": LATEST_BROWSER_STATE.get("blockedSites", []),
                "pendingCommandsCount": len(PENDING_COMMANDS),
                "lastUpdated": LATEST_BROWSER_STATE.get("lastUpdated")
            })
            return

        super().do_GET()

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body_str = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else "{}"
        try:
            body = json.loads(body_str) if body_str else {}
        except Exception:
            body = {}

        # 1. Browser pushes live state, active status list & script content to agent
        if self.path.startswith("/api/sync/push"):
            global LATEST_BROWSER_STATE
            LATEST_BROWSER_STATE["site"] = body.get("site")
            LATEST_BROWSER_STATE["url"] = body.get("url")
            LATEST_BROWSER_STATE["extensions"] = body.get("extensions", [])
            LATEST_BROWSER_STATE["blockedSites"] = body.get("blockedSites", [])
            LATEST_BROWSER_STATE["lastUpdated"] = int(time.time() * 1000)

            active_names = [e["name"] for e in body.get("extensions", []) if e.get("enabled")]
            inactive_names = [e["name"] for e in body.get("extensions", []) if not e.get("enabled")]
            print(f"[Agent Sync Push] Received state from {body.get('site')} | Active: {active_names} | Inactive: {inactive_names}")

            self._send_json(200, {
                "status": "ok",
                "message": "State and script contents recorded by agent",
                "timestamp": int(time.time() * 1000)
            })
            return

        # 2. Browser pulls pending commands from agent
        if self.path.startswith("/api/sync/pull"):
            global PENDING_COMMANDS
            commands_to_send = list(PENDING_COMMANDS)
            PENDING_COMMANDS = [] # Drain the queue

            if commands_to_send:
                print(f"[Agent Sync Pull] Dispatched {len(commands_to_send)} commands to browser: {[c.get('action') for c in commands_to_send]}")

            self._send_json(200, {
                "status": "ok",
                "commands": commands_to_send,
                "timestamp": int(time.time() * 1000)
            })
            return

        # 3. Agent issues live commands (insert script, modify script, set status on/off)
        if self.path.startswith("/api/sync/command"):
            action = body.get("action")
            if not action:
                self._send_json(400, {"error": "Missing 'action' in command payload"})
                return

            PENDING_COMMANDS.append(body)
            print(f"[Agent Sync Command] Queued agent command: {action} (Target: {body.get('id') or body.get('script', {}).get('id')})")

            self._send_json(200, {
                "status": "queued",
                "command": body,
                "queueLength": len(PENDING_COMMANDS),
                "timestamp": int(time.time() * 1000)
            })
            return

        self.send_response(404)
        self.end_headers()

    def _send_json(self, code, data):
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data, indent=2).encode("utf-8"))

def main():
    os.chdir(BESING_ROOT)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        print(f"[*] BESing Demo & Full Agent Sync RPC Server running at: http://127.0.0.1:{PORT}/demo/index.html")
        print(f"[*] Agent Sync Endpoints:")
        print(f"    - GET  http://127.0.0.1:{PORT}/api/sync/status   (Inspect live browser extension status & scripts)")
        print(f"    - POST http://127.0.0.1:{PORT}/api/sync/command  (Send live commands: set_status, insert_script)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n[*] Server stopped.")

if __name__ == "__main__":
    main()
