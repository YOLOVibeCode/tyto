# Tyto — Claude Code

You are working on **Tyto** (Noctusoft / YOLOVibeCode): an AI-first Chrome/Edge
control system. Perception is the accessibility tree. Action is trusted CDP.
The prompt session on disk is source of truth.

**Obey TDD and ISP without exception.** If a request conflicts with these laws,
follow the laws and say so.

Path-specific rules: `.claude/rules/`. Product contract: `docs/IMPLEMENTATION.md`.

## TDD

- Write the failing test first. Names are spec sentences.
- `npm test` never launches Chrome and never needs API keys.
- Do not implement first and add tests after.

## ISP

- No `IBrowser` god object. One port file per capability.
- `@tyto/core` must not import Playwright, CDP clients, or LLM vendor SDKs.
- Perch and MCP: no `RawCdpPort`, no `CredentialStorePort`.
- A port that is hard to fake is the wrong port.

## Security

- Public repo: never commit `.env`, profiles, cookies, tokens, keys.
- Bind `127.0.0.1` only. Page JS cannot command Tyto.
- Identity vault: encrypt; restore into the browser only; redact before the model.

## Stack

| Area | Standard |
|---|---|
| TypeScript | `strict`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, named exports, no `any` |
| Tests | Vitest, fakes on ports, no Playwright in core |
| Node | ESM, `node:` specifiers, `fs/promises`, AbortSignal not `sleep` as success |
| CDP | Owned WebSocket, trusted `Input`, OOPIF auto-attach, no Playwright in `@tyto/cdp` |
| Protocol | JSON-RPC; `PERCH_SAFE_METHODS` only for Perch/MCP |
| Extension | MV3, native messaging, no `window.tyto` |
| CI | Node 22, `npm run check`, gitleaks `--redact` |

After every change: `npm run check`.
