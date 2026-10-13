# Tyto

**Learn a browser task once. Replay it in a quarter of a second.**

Tyto is a thin layer on top of [agent-browser](https://github.com/vercel-labs/agent-browser). agent-browser is
the browser your AI drives (its own Chrome for Testing, or your Edge; command line; saved logins). Tyto adds the
two things it doesn't do:

- **Recipes.** When an AI finishes a browser task, Tyto compiles what it did into a verified, parameterized
  recipe. Next time, `tyto run` replays it with **no model** — about 0.3 s instead of 8–16 s — and misses
  safely (never guesses) if the site changed, so it can be repaired.
- **Brief + find.** `tyto open <url>` returns the whole picture in one response: failed requests with their
  bodies, JavaScript errors, console errors, API calls, masked cookies, interactive elements, text. `tyto find`
  searches the whole page. Any model, including small local ones, gets there in one call.

> **Status:** being rebuilt (2026-09-30) per [docs/IMPLEMENTATION.md](./docs/IMPLEMENTATION.md). The previous
> design (its own CDP browser stack) is archived at tag `archive/tyto-v0`; why:
> [docs/DECISION-2026-09-29-agent-browser.md](./docs/DECISION-2026-09-29-agent-browser.md).

| | |
|---|---|
| Product spec | [docs/SPEC.md](./docs/SPEC.md) |
| Engineering contract (TDD + ISP) | [docs/IMPLEMENTATION.md](./docs/IMPLEMENTATION.md) |
| Measurements and proof of concept | [spikes/own-browser/README.md](./spikes/own-browser/README.md) |
| Agent rules | [AGENTS.md](./AGENTS.md) · [CLAUDE.md](./CLAUDE.md) · [`.cursor/rules`](./.cursor/rules/) |
| Security | [SECURITY.md](./SECURITY.md) |

## Measured (2026-09-29, M4 Max)

| | Time per task |
|---|---|
| AI model driving the browser | 8–16 s median, 5–9 model turns |
| AI model calling a compiled recipe | 4.6–5.8 s, 2 turns |
| Compiled recipe, no model | **0.23–0.31 s** warm, ~1 s cold |
| Recipes compiled automatically, then run on 18 new inputs | 18/18 correct after one repair, 0 wrong |

## Develop

Node 22.22+, 24.15+, or 26 (`.nvmrc`). Tests run offline.

```bash
git config core.hooksPath .githooks
npm install
npm run check        # import boundary + secret scan + tests + types
npm run test:live    # opt-in: needs agent-browser installed
```

## Packages

| Package | Role |
|---|---|
| `@tyto/core` | Recipes, lint, verify, brief, find, redaction, ports, fakes (pure) |
| `@tyto/llm` | OpenAI-compatible and Anthropic HTTP model adapters |
| `@tyto/agent-browser` | Runs the agent-browser CLI (argv, batch JSON); reads its event stream |
| `@tyto/store` | Recipes, traces, session locks, log marks, replay config under `~/.tyto` |
| `@tyto/cli` | The `tyto` command (`learn`, `run`, `test`, `recipes`, `open`, `brief`, `find`, actions) |
| `@tyto/compiler` | Coming in slice 6 |

A [YOLOVibeCode](https://github.com/YOLOVibeCode) public repo. Product: Noctusoft, Inc. MIT license.
