# Protocol

JSON-RPC 2.0. Product methods, not CDP names.

- Perch and MCP may only call `PERCH_SAFE_METHODS`.
- No `debug.cdp` / `cdp.send` on that list. Vault: `identity.status` only.
- JSON-serializable params. No `backendNodeId` in session payloads.
- Errors to clients: code + message, not stacks.
