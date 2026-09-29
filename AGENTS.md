# Agent instructions (Cursor Cloud + other coding agents)

Tyto is **TDD + ISP**. These instructions are mandatory. Detailed Cursor
rules live in [`.cursor/rules/`](.cursor/rules/). Claude Code also reads
[`CLAUDE.md`](./CLAUDE.md) and [`.claude/rules/`](.claude/rules/).

## Non-negotiable

1. **Red–green–refactor.** A failing test exists before production code.
2. **`npm test` is offline.** No Chrome, no network, no keys. `TYTO_LIVE=1` is opt-in.
3. **No god interfaces.** Ports in `packages/core/src/ports/` — one job each.
4. **`@tyto/core` is pure.** No Playwright, no CDP socket, no vendor LLM SDK, no `LiteLLM` type.
5. **Perch/MCP never see** `RawCdpPort` or `CredentialStorePort`. They hold the
   **safe** token. Only the `tyto` CLI (power token) reaches `POWER_METHODS`.
6. **Loopback only.** `127.0.0.1` + token. Never `0.0.0.0`.
7. **Trusted CDP input** for clicks. Not `element.click()` as the product path.
8. **No secrets in git.** Cookies/tokens never in session JSON, tape, or model prompts. Run `Redactor` first.
   Power results are masked unless `reveal: true`; revealed values are never persisted.
9. After changes: `npm run check`.

Do not promote `poc/` (Playwright spike) into product packages.

Product direction (SPEC draft 2): CLI-first, Tyto-owned pinned Chromium, no
extension required. ATTACH and the identity vault are deferred.

Full contract: [docs/IMPLEMENTATION.md](./docs/IMPLEMENTATION.md).

## Noctusoft LLM Relay (optional endpoint)

When this app talks to Noctusoft models, the base URL is `https://ai.noctusoft.com/v1` on litellm-vm. Tyto still treats it as a generic OpenAI-compatible URL. No LiteLLM types.
