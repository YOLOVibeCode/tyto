#!/usr/bin/env python3
"""Retest local models after adding `find` (reuses matrix.py definitions)."""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
ns = {"__file__": os.path.join(HERE, "matrix.py")}
exec(compile(open(ns["__file__"]).read().split("runs = []")[0], "matrix.py", "exec"), ns)
for rep in (1, 2, 3):
    for who in ("gpt-oss:20b", "qwen3-coder:30b"):
        for name in (["wiki"] + (["debug-shop", "login"] if rep == 1 else [])):
            task, ok = ns["TASKS"][name]; ns["reset"]()
            r = ns["local"](who, task); r.update(who=who, task=name, rep=rep, correct=ok(r["answer"]))
            print(json.dumps(r), flush=True)
