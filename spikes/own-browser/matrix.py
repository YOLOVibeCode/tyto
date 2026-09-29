#!/usr/bin/env python3
"""POC check 4: same tasks, many models, graded. Local models via agent.py; Claude via Claude Code (-p)."""
import json, os, re, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
env = {**os.environ, "PATH": HERE + ":" + os.environ["PATH"]}; env.pop("ANTHROPIC_API_KEY", None)
PROFILE = os.path.join(env["TYTO_HOME"], "profiles", "default")
F = "http://127.0.0.1:8765"
TASKS = {
 "debug-shop": (f"The page {F}/shop shows 'No items' instead of a product list. Find out why. Give the root cause.",
                lambda a: bool(re.search(r"500", a)) and bool(re.search(r"api/items|items api", a, re.I))),
 "debug-save": (f"On {F}/click, clicking the Save button does nothing. Find out why. Give the root cause.",
                lambda a: bool(re.search(r"TypeError|undefined", a)) and "id" in a),
 "login":      (f"Log in at {F}/login with username 'ada' and password 'lovelace' (do not tick 'Remember me'), then report the welcome text on the account page.",
                lambda a: "Welcome, Ada" in a),
 "wiki":       ("Using English Wikipedia, what is the IUCN conservation status of the Snowy owl?",
                lambda a: "vulnerable" in a.lower()),
}
def reset():
    subprocess.run(["agent-browser", "--session", "tyto-default", "--profile", PROFILE, "cookies", "clear"], capture_output=True, stdin=subprocess.DEVNULL)
    subprocess.run([os.path.join(HERE, "tyto"), "open", "about:blank"], capture_output=True, env=env, stdin=subprocess.DEVNULL)
def local(model, task):
    p = subprocess.run([os.path.join(HERE, "agent.py"), model, task], capture_output=True, text=True, env=env, stdin=subprocess.DEVNULL)
    return json.loads(p.stdout.strip().splitlines()[-1])
def claude(task, card, tools):
    t = time.time()
    p = subprocess.run(["claude", "-p", task, "--model", "sonnet", "--output-format", "json", "--strict-mcp-config",
                        "--no-session-persistence", "--append-system-prompt-file", card, "--allowedTools", *tools,
                        "--disallowedTools", "WebFetch", "WebSearch", "Task"], capture_output=True, text=True, env=env,
                       cwd=HERE, stdin=subprocess.DEVNULL)
    r = json.loads(p.stdout)
    return {"turns": r.get("num_turns"), "model_s": round((r.get("duration_api_ms") or 0) / 1000, 1),
            "wall_s": round(time.time() - t, 1), "answer": (r.get("result") or "").strip(), "cost": r.get("total_cost_usd")}
runs = []
CORE = os.path.join(HERE, ".core-skill.md")  # agent-browser's own instructions, fetched at run time
with open(CORE, "w") as f:
    f.write(subprocess.run(["agent-browser", "skills", "get", "core"], capture_output=True, text=True).stdout)
for rep in (1, 2):
    for name, (task, ok) in TASKS.items():
        for who in ("gpt-oss:20b", "qwen3-coder:30b", "claude-sonnet+tyto"):
            reset()
            r = claude(task, os.path.join(HERE, "card.md"), ["Bash(tyto:*)"]) if who.startswith("claude") else local(who, task)
            r.update(who=who, task=name, rep=rep, correct=ok(r["answer"])); runs.append(r); print(json.dumps(r), flush=True)
        if name.startswith("debug"):
            reset()
            r = claude(task + " Use the agent-browser CLI only.", CORE, ["Bash(agent-browser:*)"])
            r.update(who="claude-sonnet+agent-browser (pull)", task=name, rep=rep, correct=ok(r["answer"])); runs.append(r); print(json.dumps(r), flush=True)
