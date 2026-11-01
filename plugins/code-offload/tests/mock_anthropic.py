#!/usr/bin/env python3
"""Scripted stand-in for the Anthropic Messages API, for end-to-end tests of
the plugin inside the real Claude Code binary — no real model, no tokens.

MOCK_SCRIPT: JSON file with a list of tool calls, e.g.
  [{"name": "Read", "input": {"file_path": "big.ts"}},
   {"name": "Bash", "input": {"command": "seq 1 5000", "description": "count"}}]
Main-conversation requests (they carry `tools`) get the next tool call, chosen
by how many tool_result blocks the conversation already has; once the script
is exhausted the reply is plain text "DONE". Side requests (titles, etc.) get
a short text reply.

MOCK_LOG: every tool_result seen (and the system prompt's offload context)
is appended there as JSON lines, for the test to assert on.
"""
import json, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("MOCK_PORT", "18090"))
SCRIPT = json.load(open(os.environ["MOCK_SCRIPT"])) if os.environ.get("MOCK_SCRIPT") else []
LOG = os.environ.get("MOCK_LOG")


def log(obj):
    if LOG:
        with open(LOG, "a") as f:
            f.write(json.dumps(obj) + "\n")


def text_of(content):
    if isinstance(content, str):
        return content
    out = []
    for b in content or []:
        if isinstance(b, dict):
            if b.get("type") == "text":
                out.append(b.get("text", ""))
            elif b.get("type") == "tool_result":
                out.append(text_of(b.get("content")))
    return "\n".join(out)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._json(200, {"data": [], "has_more": False})

    def do_HEAD(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(n) or b"{}"
        try:
            body = json.loads(raw)
        except Exception:
            body = {}
        if "count_tokens" in self.path:
            return self._json(200, {"input_tokens": 100})
        if not self.path.startswith("/v1/messages"):
            return self._json(200, {})

        msgs = body.get("messages", [])
        results = []
        for m in msgs:
            if isinstance(m.get("content"), list):
                for b in m["content"]:
                    if isinstance(b, dict) and b.get("type") == "tool_result":
                        results.append(b)
        if body.get("tools"):
            system = body.get("system")
            sys_text = system if isinstance(system, str) else json.dumps(system)
            first_user = text_of(msgs[0].get("content")) if msgs else ""
            log({"kind": "request", "n_results": len(results),
                 "has_offload_context": ("offload is installed" in sys_text) or ("offload is installed" in json.dumps(msgs)),
                 "tools": [t.get("name") for t in body.get("tools", [])][:50]})
            if results:
                last = results[-1]
                log({"kind": "tool_result", "index": len(results) - 1,
                     "is_error": bool(last.get("is_error")), "text": text_of(last.get("content"))})
            i = len(results)
            if i < len(SCRIPT):
                return self.reply(body, tool=SCRIPT[i], idx=i)
            return self.reply(body, text="DONE")
        return self.reply(body, text="ok")

    def reply(self, body, text=None, tool=None, idx=0):
        model = body.get("model", "claude-test")
        if tool:
            block = {"type": "tool_use", "id": f"toolu_{idx:04d}", "name": tool["name"], "input": tool["input"]}
            stop = "tool_use"
        else:
            block = {"type": "text", "text": text}
            stop = "end_turn"
        if not body.get("stream"):
            return self._json(200, {"id": f"msg_{idx}", "type": "message", "role": "assistant", "model": model,
                                    "content": [block], "stop_reason": stop, "stop_sequence": None,
                                    "usage": {"input_tokens": 10, "output_tokens": 5}})
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()

        def ev(name, data):
            self.wfile.write(f"event: {name}\ndata: {json.dumps(data)}\n\n".encode())
            self.wfile.flush()

        ev("message_start", {"type": "message_start", "message": {
            "id": f"msg_{idx}", "type": "message", "role": "assistant", "model": model, "content": [],
            "stop_reason": None, "stop_sequence": None, "usage": {"input_tokens": 10, "output_tokens": 1}}})
        if tool:
            ev("content_block_start", {"type": "content_block_start", "index": 0,
                                       "content_block": {"type": "tool_use", "id": block["id"], "name": block["name"], "input": {}}})
            ev("content_block_delta", {"type": "content_block_delta", "index": 0,
                                       "delta": {"type": "input_json_delta", "partial_json": json.dumps(block["input"])}})
        else:
            ev("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}})
            ev("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": text}})
        ev("content_block_stop", {"type": "content_block_stop", "index": 0})
        ev("message_delta", {"type": "message_delta", "delta": {"stop_reason": stop, "stop_sequence": None},
                             "usage": {"output_tokens": 5}})
        ev("message_stop", {"type": "message_stop"})


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
