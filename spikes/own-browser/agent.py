#!/usr/bin/env python3
"""Minimal model-agnostic agent: any OpenAI-compatible chat model + one tool (`tyto`).
usage: agent.py <model> <task>   env: TYTO_BASE_URL (default Ollama), TYTO_API_KEY
Prints one JSON line: turns, model_s, tool_s, wall_s, answer."""
import json, os, shlex, subprocess, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.environ.get("TYTO_BASE_URL", "http://127.0.0.1:11434/v1")
KEY = os.environ.get("TYTO_API_KEY", "")
CARD = open(os.path.join(HERE, "card.md")).read()
TOOL = {"type": "function", "function": {
    "name": "tyto", "description": "Run one tyto browser command, e.g. 'open https://example.com' or 'click @e3'.",
    "parameters": {"type": "object", "properties": {"args": {"type": "string", "description": "arguments after `tyto`"}},
                   "required": ["args"]}}}

def chat(model, messages):
    body = json.dumps({"model": model, "messages": messages, "tools": [TOOL], "temperature": 0}).encode()
    req = urllib.request.Request(f"{BASE}/chat/completions", data=body, headers={
        "content-type": "application/json", **({"authorization": f"Bearer {KEY}"} if KEY else {})})
    return json.load(urllib.request.urlopen(req, timeout=300))["choices"][0]["message"]

def run_tyto(args):
    try: argv = shlex.split(args)
    except ValueError as e: return f"bad arguments: {e}"
    p = subprocess.run([os.path.join(HERE, "tyto"), *argv], capture_output=True, text=True, timeout=90, stdin=subprocess.DEVNULL)
    return ((p.stdout or "") + (p.stderr or ""))[:6000] or "(no output)"

def main(model, task, max_turns=15):
    msgs = [{"role": "system", "content": CARD}, {"role": "user", "content": task}]
    model_s = tool_s = 0.0; t0 = time.time(); calls = []
    for turn in range(1, max_turns + 1):
        t = time.time(); m = chat(model, msgs); model_s += time.time() - t
        tcs = m.get("tool_calls") or []
        msgs.append({"role": "assistant", "content": m.get("content") or "", **({"tool_calls": tcs} if tcs else {})})
        if not tcs:
            return {"turns": turn, "calls": calls, "model_s": round(model_s, 1), "tool_s": round(tool_s, 1),
                    "wall_s": round(time.time() - t0, 1), "answer": (m.get("content") or "").strip()}
        for tc in tcs:
            try: args = json.loads(tc["function"]["arguments"] or "{}").get("args", "")
            except json.JSONDecodeError: args = ""
            t = time.time(); out = run_tyto(args); tool_s += time.time() - t
            calls.append(args[:80])
            msgs.append({"role": "tool", "tool_call_id": tc.get("id", ""), "content": out})
    return {"turns": max_turns, "calls": calls, "model_s": round(model_s, 1), "tool_s": round(tool_s, 1),
            "wall_s": round(time.time() - t0, 1), "answer": "(gave up: turn limit)"}

if __name__ == "__main__":
    print(json.dumps(main(sys.argv[1], sys.argv[2])))
