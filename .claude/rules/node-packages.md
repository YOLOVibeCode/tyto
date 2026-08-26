# Node packages

Node 22, ESM, `node:` specifiers, `fs/promises` on the RPC path (no sync I/O).

- Listen on `127.0.0.1` only; `BindPolicy` rejects `0.0.0.0`.
- JSON-RPC token auth; never log the token.
- LLM adapter: OpenAI-compatible HTTP; no `LiteLLM` type; page text is untrusted data.
- Secrets package: AES-GCM; DEK via `SecretStore`; memory fake in tests.
- MCP tools ⊆ `PERCH_SAFE_METHODS`. Perch does not import `@tyto/cdp`.
- Waits: AbortSignal / tape, not `sleep(250)` as success.
