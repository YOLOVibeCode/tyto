# Tyto — Product specification

Noctusoft, Inc. · Status: draft 3 (2026-09-30) — a thin layer on agent-browser
Engineering contract: [`IMPLEMENTATION.md`](./IMPLEMENTATION.md) · Why: [`DECISION-2026-09-29-agent-browser.md`](./DECISION-2026-09-29-agent-browser.md)

## 1. What it is

Tyto makes AI browsing fast and legible on top of [agent-browser](https://github.com/vercel-labs/agent-browser).
agent-browser is the browser (its own Chrome for Testing, or your Edge; CLI; saved logins). Tyto adds two things
agent-browser does not do:

1. **Recipes — learn once, replay fast.** A browser task an AI completed once is compiled into a verified,
   parameterized recipe that runs with **no model** (~0.3 s warm vs 8–16 s for a model driving the browser).
   When the site changes, the recipe misses safely and is repaired automatically.
2. **Brief + find.** One command returns everything about a page — failed requests with bodies, JavaScript
   errors, console errors, API calls, masked cookies and storage, interactive elements, outline, text — and
   `find` searches the whole page. Any model, including local 20–30B models, gets the picture in one call.

## 2. Who uses it

| Actor | Role |
|---|---|
| Operator | You. Ask for tasks, approve recipes that run with your logins. |
| Agent | Claude Code, Cursor, Codex, a local model — anything that runs shell commands. Calls `tyto`. |
| agent-browser | The browser. Tyto only ever calls its CLI and listens to its event stream. |
| Compiler model | Claude Code headless by default; any OpenAI-compatible endpoint optionally. Used once per recipe. |

## 3. Use cases

- **Repeat lookups and chores:** "status of species X", "latest release of repo Y", "fill this form with
  these values" — the second time, `tyto run` answers in about a second without a model.
- **Batch:** the same task over many inputs, each a replay.
- **Debug a page:** `tyto open <url>` shows the failing request and the error in one response.
- **Weak or local models:** the brief and `find` replace many exploratory turns.

## 4. Out of scope

A browser, a CDP driver, a browser extension, a Chromium fork, a vision/screenshot agent, a cloud browser farm,
stealth or anti-detection, unattended purchases or transfers, sharing recipes or logins across people.

## 5. Behavior

- **Learn:** `tyto learn <name>` starts listening to an agent-browser session's event stream; the agent does the
  task; `tyto learn stop --task "…"` compiles the trace into a recipe, self-tests it on at least three inputs,
  and stores it as a draft.
- **Run:** `tyto run <recipe> --param value …` renders the recipe, runs it as one agent-browser batch, verifies
  the result, and prints JSON (exit 0) or a MISS with the reason (exit 3).
- **Repair:** on a MISS, `tyto repair` sends the missed and previously-passing inputs to the compiler; the
  repaired recipe must pass all of them before it replaces the old one.
- **Brief:** `tyto open|brief|find` and action pass-through that reports what changed after each action.
- **Sessions:** replays run in `tyto-rx` with **no saved logins** and a domain allowlist; recipes that need your
  login run in `tyto-rx-auth` only after you approve them.

## 6. Security

| Rule | Requirement |
|---|---|
| Recipe lint | Required before store and run: command allowlist, no templating inside eval code, rendered URLs inside `origins`, read-only eval heuristics, no password-like fills |
| Logged-in replay | Only `auth: true` recipes with `status: approved` |
| Traces | Typed values become placeholders; secrets redacted before disk and model; files `0600` |
| Compiler | Page text fenced as data; the compiler may only run `tyto compile-tool`; output linted, stored as draft |
| Secrets | Never in git, recipes, traces, or model prompts; cookie values masked unless explicitly revealed |

## 7. Platforms

macOS first; Linux expected; Windows untested. Requires agent-browser ≥ 0.38.1 and Node 22.22+ / 24.15+ / 26.

## 8. Quality bars

- Warm replay under 0.5 s; cold under 2 s; no replay waits out a 25 s default timeout.
- Compiled recipes: ≥ 17/18 correct on new inputs after one repair, **0 wrong answers** (misses are fine).
- Brief under 1,000 tokens for typical pages and under 1 s.
- `npm test` fully offline.

## 9. One-line tests

- If a repeated browser task still takes a model 8 seconds, Tyto is not done.
- If a recipe returns a wrong answer instead of a MISS, Tyto is not done.
- If a recipe can run with your logins without your approval, Tyto is not done.
- If a password or cookie value reaches a trace, recipe, or model prompt, Tyto is not done.
