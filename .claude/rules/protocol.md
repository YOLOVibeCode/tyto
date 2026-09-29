# Protocol

JSON-RPC 2.0. Product methods, not CDP names.

- Two token scopes. **safe** (Perch, MCP) may only call `PERCH_SAFE_METHODS`.
  **power** (the `tyto` CLI) may call `PERCH_SAFE_METHODS` ∪ `POWER_METHODS`.
- No `cdp.send` / cookies / storage values on the safe list. Vault: `identity.status` only.
- `POWER_METHODS` is disjoint from the safe set. Power results are masked
  (`Redactor.mask`) unless the request says `reveal: true`.
- JSON-serializable params. No `backendNodeId` in session payloads.
- Errors to clients: code + message, not stacks.
