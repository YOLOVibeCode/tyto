# Contributing

Tyto is built **TDD + ISP**. Read [docs/IMPLEMENTATION.md](./docs/IMPLEMENTATION.md)
before writing code.

## Agent rules (mandatory)

Coding agents **must** follow TDD, ISP, and stack standards:

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
npm test
```

Node 22+. Tests must pass **offline** (`npm test` never launches Chrome).
To drive a real browser from this clone, follow [docs/USAGE.md](./docs/USAGE.md)
(`npm start`). There is no packaged app yet.

## Laws

1. A failing test exists before production code for that behavior.
2. `@tyto/core` depends on **port types only**. No Playwright, no CDP socket,
   no vendor LLM SDK, no `LiteLLM` type.
3. Perch and MCP must not see `RawCdpPort` or `CredentialStorePort`.
4. No cookies, tokens, or API keys in git. Use `.env` (gitignored).

## Layout

| Path | Role |
|---|---|
| `packages/core` | Domain + ports + fakes |
| `packages/protocol` | JSON-RPC types |
| `packages/fs` | Session files on disk |
| `packages/secrets` | Vault encryption + DEK (memory fake in tests) |
| `packages/cdp` | Chrome/Edge CDP adapter (not Playwright) |
| `packages/host` | Composition root, `127.0.0.1` + token |
| `packages/sdk` | Client |
| `packages/llm` | OpenAI-compatible + Anthropic HTTP |
| `packages/mcp` | Claude Code adapter |
| `packages/perch` | Sidebar view of the session file |
| `packages/poc` | Spike only; harvest algorithms, do not promote |

## PRs

- `npm run check` is green
- Do not add Playwright locators as the product path
- Do not log `Set-Cookie` or `Authorization` values
