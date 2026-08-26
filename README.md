# Tyto

**An AI-first browser you drive in prose — without screenshots.**

Barn owls (*Tyto alba*) hunt in the dark by hearing alone. Tyto reads a page as a
**document** (accessibility tree) and clicks as you would (**trusted CDP input**).
The durable object is the **prompt session on disk**, not a Chrome sidebar.

You occupy **Google Chrome** or **Microsoft Edge** on macOS, Windows, and Linux.
If you can use it in that profile — iframe, DHTML, injected SPA, reverse proxy,
Workday-on-a-portal — Tyto can use it programmatically. The site cannot drive Tyto.

A [YOLOVibeCode](https://github.com/YOLOVibeCode) public repo. Product: Noctusoft, Inc.

| | |
|---|---|
| Spec | [docs/SPEC.md](./docs/SPEC.md) |
| Design | [docs/DESIGN.md](./docs/DESIGN.md) |
| Implementation (TDD + ISP) | [docs/IMPLEMENTATION.md](./docs/IMPLEMENTATION.md) |
| Security | [SECURITY.md](./SECURITY.md) |
| License | [MIT](./LICENSE) |

---

## Why it exists

Vision-first agents photograph the screen, reason about pixels, and click
approximately. That is seconds per move, and it is the wrong model for HTML.

Tyto’s step:

```
AX snapshot (tens of ms) → plan once → trusted click (tens of ms)
         → wait on nav / mutation, not on a sleep
         → you can type in the same field whenever you want
```

Kill Perch or disconnect MCP: the **session file remains**. Reopen, `goto`
last URL, browse, continue.

---

## Architecture

```
prompt session (disk)
    → SDK / MCP / Perch     127.0.0.1 + token
        → host (kernel)
            ├─ LAUNCH  Chrome/Edge + localhost CDP
            └─ ATTACH  native messaging → extension → chrome.debugger
```

**Core** (`@tyto/core`) is pure TypeScript: ports, recipes, classify, allowlist,
redaction, identity classification. Default CI never launches Chrome.

**Identity vault** (browser-scoped): capture *your* cookies/tokens (encrypted,
DEK in the OS keychain), restore into Chrome/Edge only. The model never sees
auth material. No Kerberos TGT harvest, no impersonation, no export to scripts.

---

## Status

**Slice 0–6b + 9b (fakes) are in-tree and tested.** Host JSON-RPC, real CDP
LAUNCH, Perch UI, and the MV3 extension are specified and stubbed — not
product-complete yet. `poc/` is a Playwright spike used to prove AX + tape;
it is not the product API.

---

## Develop

Requires **Node 22+**.

```bash
git clone git@github.com:YOLOVibeCode/tyto.git
cd tyto
git config core.hooksPath .githooks
npm install
npm test
```

```bash
npm run check          # imports + secrets + tests + types
npm run secrets:scan   # fail closed; does not print secret values
```

Copy `.env.example` to `.env` for local models. **Never commit `.env` or
`tmp/` browser profiles.**

Optional spike (installs Playwright locally):

```bash
npx playwright install chromium
npx tsx poc/run.ts --url "https://en.wikipedia.org/wiki/Main_Page" --goal "…"
```

---

## Packages

| Package | Role |
|---|---|
| `@tyto/core` | Domain + ISP ports + fakes |
| `@tyto/protocol` | JSON-RPC methods (Perch-safe; no raw CDP) |
| `@tyto/fs` | Session JSON on disk |
| `@tyto/secrets` | Vault encryption (memory DEK in tests) |
| `@tyto/host` | Composition root (Slice 7) |
| `@tyto/sdk` | Client |
| `@tyto/cdp` | CDP adapter — **not Playwright** (Slice 9) |
| `@tyto/llm` | OpenAI-compatible HTTP (Slice 8) |
| `@tyto/mcp` | Claude Code adapter (Slice 12) |
| `@tyto/perch` | Session sidebar (Slice 10) |
| `extension/` | MV3 ATTACH (Slice 11) |

---

## Public repository — secrets

This repo is **public**. Assume anything committed is world-readable.

Blocked by `.gitignore`: `.env`, `tmp/` profiles, vault dirs, private keys.

Scanned on every PR: `scripts/check-secrets.mjs` + [gitleaks](https://github.com/gitleaks/gitleaks)
(`.gitleaks.toml`). GitHub secret scanning is on for public repos.

If you paste a real key: **rotate it**, do not just delete the commit.

---

## One-line tests (from the spec)

- If a power user would rather screenshot-agent the tab than paste a goal, Tyto is not done.
- If they quit the browser and cannot reopen the **same prompt**, Tyto is not done.
- If a website can drive the SDK, Tyto is not done.
- If they can use it by hand (iframe, DHTML, proxied host) and Tyto cannot, Tyto is not done.
- If the model transcript contains a cookie or token, Tyto is not done.
