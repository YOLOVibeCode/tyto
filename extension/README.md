# Tyto extension (ATTACH — deferred)

**Optional and deferred** (SPEC draft 2 §3.10). Tyto’s CLI and bundled
Chromium need no extension.

Target design: Chrome + Edge MV3, speaks **only** to the host via native
messaging, auto-enables `chrome.debugger` on the target tab. Today on `main`
the side panel talks HTTP to the loopback host and native messaging /
debugger auto-attach are not wired (work in progress lives on `ci-deploy`).

The document must not get a `window.tyto` command API.

See [docs/IMPLEMENTATION.md](../docs/IMPLEMENTATION.md) Slice 11.
