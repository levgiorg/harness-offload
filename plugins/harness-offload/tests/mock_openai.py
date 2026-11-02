#!/usr/bin/env python3
"""Tiny OpenAI-compatible mock for exercising OpenCode end to end.

MOCK_MODE (env or per-request via the model name suffix):
  echo   -> streams a reply describing what it received (default)
  error  -> HTTP 429 on every call
  tool   -> first turn asks to call tool MOCK_TOOL (default "edit"), then answers
  slow   -> sleeps MOCK_SLEEP seconds before answering
  script -> MOCK_SCRIPT is a JSON file {"steps": [{"tool": NAME, "args": {...}}, ..., {"text": "..."}]};
            the step played is the number of tool results already in the conversation, so a
            host's agent loop walks through the script (requests without tools get "ok")
Every request is appended as JSON to MOCK_LOG (if set) for inspection.
"""
import json, os, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("MOCK_PORT", "18080"))
LOG = os.environ.get("MOCK_LOG")

def mode_for(model):
    for m in ("error", "auth", "tool", "readenv", "slow", "script", "echo"):
        if model.endswith("-" + m):
            return m
    return os.environ.get("MOCK_MODE", "echo")

def tool_results_of(msgs):
    return [m for m in msgs if m.get("role") == "tool"]

class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers()
        self.wfile.write(json.dumps({"data": [{"id": "echo", "object": "model"}]}).encode())

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n) or b"{}")
        if LOG:
            with open(LOG, "a") as f:
                f.write(json.dumps(body) + "\n")
        mode = mode_for(body.get("model", ""))
        msgs = body.get("messages", [])
        if mode == "error":
            self.send_response(429); self.send_header("Content-Type", "application/json"); self.end_headers()
            self.wfile.write(b'{"error":{"message":"mock rate limit","type":"rate_limit"}}'); return
        if mode == "auth":
            self.send_response(401); self.send_header("Content-Type", "application/json"); self.end_headers()
            self.wfile.write(b'{"error":{"message":"mock invalid api key","type":"invalid_request_error"}}'); return
        if mode == "slow":
            time.sleep(float(os.environ.get("MOCK_SLEEP", "30")))
        user = [m for m in msgs if m.get("role") == "user"]
        last = user[-1]["content"] if user else ""
        if isinstance(last, list):
            last = "".join(p.get("text", "") for p in last if isinstance(p, dict))
        system = " ".join(m["content"] if isinstance(m.get("content"), str) else json.dumps(m.get("content")) for m in msgs if m.get("role") == "system")
        tool_results = [m for m in msgs if m.get("role") == "tool"]
        tools = [t["function"]["name"] for t in body.get("tools", []) or [] if isinstance(t, dict) and "function" in t]
        if mode == "script":
            if not tools:
                return self.stream(text="ok", stream=body.get("stream", False))
            with open(os.environ["MOCK_SCRIPT"]) as f:
                steps = json.load(f)["steps"]
            step = steps[min(len(tool_results_of(msgs)), len(steps) - 1)]
            if "tool" in step:
                return self.stream(tool_call=(step["tool"], step.get("args", {})), stream=body.get("stream", False))
            return self.stream(text=step.get("text", "done"), stream=body.get("stream", False))
        if mode == "tool" and not tool_results and tools:
            name = os.environ.get("MOCK_TOOL", "edit")
            args = json.loads(os.environ.get("MOCK_TOOL_ARGS", '{"filePath":"pwned.txt","oldString":"","newString":"x"}'))
            return self.stream(tool_call=(name, args), stream=body.get("stream", False))
        import re as _re
        want = _re.search(r"READ:(\S+?)[<\s]", last + " ")
        read_path = want.group(1) if want else os.environ.get("MOCK_READ_PATH", ".env")
        if mode == "readenv" and not tool_results and "read_file" in tools:
            return self.stream(tool_call=("read_file", {"path": read_path}), stream=body.get("stream", False))
        if mode == "readenv" and not tool_results and "read" in tools:
            spec = [t for t in body["tools"] if t["function"]["name"] == "read"][0]["function"].get("parameters", {})
            key = next((k for k in spec.get("properties", {}) if "path" in k.lower()), "filePath")
            return self.stream(tool_call=("read", {key: read_path}), stream=body.get("stream", False))
        text = (f"MOCK-REPLY chars={len(last)} system_chars={len(system)} tools={','.join(sorted(tools)) or 'none'} "
                f"tool_results={len(tool_results)}\nFIRST_LINE: {last.splitlines()[0] if last else ''}\nLAST_LINE: {last.splitlines()[-1] if last else ''}")
        if tool_results:
            text += "\nTOOL_RESULT: " + str(tool_results[-1].get("content"))[:300]
        self.stream(text=text, stream=body.get("stream", False))

    def stream(self, text=None, tool_call=None, stream=True):
        if not stream:
            msg = {"role": "assistant", "content": text}
            fr = "stop"
            if tool_call:
                msg = {"role": "assistant", "content": None, "tool_calls": [{"id": "call_1", "type": "function", "function": {"name": tool_call[0], "arguments": json.dumps(tool_call[1])}}]}
                fr = "tool_calls"
            out = {"id": "c1", "object": "chat.completion", "created": 0, "model": "echo",
                   "choices": [{"index": 0, "message": msg, "finish_reason": fr}],
                   "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}}
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers()
            self.wfile.write(json.dumps(out).encode()); return
        self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
        def ev(d):
            self.wfile.write(b"data: " + json.dumps(d).encode() + b"\n\n"); self.wfile.flush()
        base = {"id": "c1", "object": "chat.completion.chunk", "created": 0, "model": "echo"}
        if tool_call:
            ev({**base, "choices": [{"index": 0, "delta": {"role": "assistant", "tool_calls": [{"index": 0, "id": "call_1", "type": "function", "function": {"name": tool_call[0], "arguments": json.dumps(tool_call[1])}}]}, "finish_reason": None}]})
            ev({**base, "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}], "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}})
        else:
            ev({**base, "choices": [{"index": 0, "delta": {"role": "assistant", "content": ""}, "finish_reason": None}]})
            for i in range(0, len(text), 40):
                ev({**base, "choices": [{"index": 0, "delta": {"content": text[i:i+40]}, "finish_reason": None}]})
            ev({**base, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 1234, "completion_tokens": 56, "total_tokens": 1290}})
        self.wfile.write(b"data: [DONE]\n\n"); self.wfile.flush()

if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
