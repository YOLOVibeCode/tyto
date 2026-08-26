# TDD and ISP (mandatory)

Tests define behavior. Ports define ownership. Do not ship a change that
violates this file.

1. Failing test first. `it("…")` is a spec sentence from `docs/IMPLEMENTATION.md`.
2. `npm test` is airplane-mode (no Chrome, no network, no keys).
3. No `IBrowser` with twenty methods. One port, one file, `packages/core/src/ports/`.
4. `@tyto/core` is pure: no Playwright, no CDP socket, no vendor LLM SDK, no LiteLLM type.
5. Perch/MCP must not depend on `RawCdpPort` or `CredentialStorePort`.
6. Hard-to-fake port → wrong port. Separate fakes, not a god `FakeTyto`.
7. Trusted `Input` clicks. Session JSON has no `backendNodeId`, cookies, or tokens.
8. `Redactor` before every `ModelPort.complete` and before tape persist.
9. Bind `127.0.0.1` only. Finish with `npm run check`.
