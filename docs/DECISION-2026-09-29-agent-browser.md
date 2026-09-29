# Decision: use agent-browser; pause Tyto (2026-09-29)

## Goal we were solving

Let any language model work on any web page, any time, from the command line — no browser extension —
with full visibility (network, JavaScript errors, cookies, storage) and native-CLI speed.

## Decision

Use [agent-browser](https://github.com/vercel-labs/agent-browser) (Vercel Labs, Apache-2.0) as the browser
layer instead of building Tyto's own CDP stack. Tyto development is paused. The code in `packages/` stays
for reference; nothing in it is deleted.

## Why

- agent-browser already ships what Tyto's spec promised: its own Chrome for Testing (or any Chromium, e.g.
  Edge, via `executablePath`), a fast CLI and daemon, accessibility snapshots with refs, cookies, storage,
  console, errors, network requests and bodies, HAR, persistent profiles and saved logins, an encrypted
  credential vault, domain allowlists, action confirmation, and an MCP server.
- Rebuilding that would take weeks for parity, with no advantage on the goal above.
- Forking Chromium is unnecessary: the DevTools protocol already exposes all the plumbing.

## Evidence (measured on an M4 Max; details in `spikes/own-browser/README.md`)

| Measurement | Result |
|---|---|
| Where AI browsing time goes | Model turns are ~75–80% of wall time; browser commands ~55 ms each |
| Model driving the browser (Claude Sonnet, 4 tasks) | 8–16 s median per task, 5–9 turns |
| Model calling a precompiled recipe | 4.6–5.8 s, always 2 turns |
| Recipe with no model | 0.23–0.31 s warm, 0.8–0.9 s cold |
| Recipes compiled automatically from one exploration | 18/18 correct on new inputs after one repair pass, 0 wrong |
| One-call page brief (POC) | "Why is this page broken?" in 2 turns for gpt-oss 20B, Qwen3-coder 30B, and Claude |
| Logins across a full browser restart | Kept (local fixture and a real site) |
| Tool routing rule (API → fetch → agent-browser → saved script) | 8/8 correct; browser used only for login and screenshot tasks |

## What carries forward

- Pick the fastest tool per task: API, then plain fetch, then agent-browser only when a page needs
  JavaScript, a login, interaction, internals, or pixels.
- Save repeated browser tasks as verified `agent-browser batch` scripts; replay instead of re-browsing.
- If a real gap appears, extend agent-browser (plugins, or upstream contributions) before building anew.

## Known issue found

agent-browser 0.38.1: `errors --clear` does not clear the error buffer (worked around in the POC).
