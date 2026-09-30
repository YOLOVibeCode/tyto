# Contributing

Tyto is built **TDD + ISP**. Read [docs/IMPLEMENTATION.md](./docs/IMPLEMENTATION.md) before writing code.

## Agent rules (mandatory)

| For | Where |
|---|---|
| Cursor | [`.cursor/rules/`](./.cursor/rules/) (`alwaysApply` + per-glob) |
| Cursor Cloud / AGENTS | [`AGENTS.md`](./AGENTS.md) |
| Claude Code | [`CLAUDE.md`](./CLAUDE.md) + [`.claude/rules/`](./.claude/rules/) |

If a change conflicts with those rules, **the rules win**.

## Setup

```bash
git clone git@github.com:YOLOVibeCode/tyto.git
cd tyto
git config core.hooksPath .githooks
npm install
npm run check
```

Node 22.22+, 24.15+, or 26 (`.nvmrc` pins 26). `npm test` is offline. Live tests (`npm run test:live`) need
[agent-browser](https://github.com/vercel-labs/agent-browser) installed.

## Laws

1. A failing spec-sentence test exists before production code for that behavior.
2. `@tyto/core` is pure: ports and domain only; no processes, files, network, WebSocket, browser drivers,
   vendor LLM SDKs.
3. Never re-implement agent-browser; call its CLI with an argv array.
4. No cookies, tokens, API keys, traces, or browser state in git.

## Layout

| Path | Role |
|---|---|
| `packages/core` | Recipes, lint, verify, brief, find, redaction, ports, fakes |
| `packages/llm` | OpenAI-compatible + Anthropic HTTP model adapters |
| `packages/agent-browser`, `store`, `compiler`, `cli` | Adapters and the `tyto` command (slices 3–9) |
| `spikes/own-browser` | Python proof of concept and measurements; not product code |

## PRs

- One slice per PR; `npm run check` green; CI green.
- Never log `Set-Cookie`, `Authorization`, cookie, or token values.
