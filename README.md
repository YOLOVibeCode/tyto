# Tyto

**An AI-first browser you drive in prose — without screenshots.**

Barn owls (*Tyto alba*) hunt in the dark by hearing alone. Tyto reads a page as a
**document** (accessibility tree) and clicks as you would (**trusted CDP input**).
The durable object is the **prompt session on disk**, not a Chrome sidebar.

You occupy **Google Chrome** or **Microsoft Edge** on macOS, Windows, and Linux.
The site cannot drive Tyto. The only door is a local SDK (`127.0.0.1` + token).

A [YOLOVibeCode](https://github.com/YOLOVibeCode) public repo. Product: Noctusoft, Inc.

| | |
|---|---|
| Spec (use cases, security) | [docs/SPEC.md](./docs/SPEC.md) |
| **How to run it** | [docs/USAGE.md](./docs/USAGE.md) |
| Design | [docs/DESIGN.md](./docs/DESIGN.md) |
| Implementation (TDD + ISP) | [docs/IMPLEMENTATION.md](./docs/IMPLEMENTATION.md) |
| Agent rules | [AGENTS.md](./AGENTS.md) · [CLAUDE.md](./CLAUDE.md) · [`.cursor/rules`](./.cursor/rules/) |
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

## What you use it for

Tyto is for operating the **same Chrome/Edge profile you already use**, in
prose, without a screenshot loop.

| You paste… | Tyto does… |
|---|---|
| Research | Open an article, bind Search, extract a fact from the accessibility tree. |
| Ops | Open an invoice, download a CSV, stop before Submit. |
| Forms | Fill from notes in the prompt; confirm-gate on submit / purchase / delete / send. |
| Weave | You type name and address; Tyto does the rest of the wizard. You keep the keyboard. |
| Resume | Quit the browser. Open the **same prompt file**. `goto` last URL, continue. |
| Claude Code | Same session document over MCP. Losing the MCP socket does not delete the work. |
| Recipes | After a good run, replay **role + accessible name + landmark** — not `backendNodeId`. |

Improper: unattended agent on the profile that holds payroll or bank cookies
with a wide allowlist and no confirm-gates. You pick the profile explicitly.

---

## Nested pages: iframes, hosted apps, DHTML, proxies

**If you can use it in that profile, Tyto can use it.** How the document was
delivered is not a product line. There is no Workday driver, no “iframe
package,” no proxy adapter. There is a **frame graph**, **readiness** on
*that* frame, and trusted input on *that* frame’s CDP session.

A lot of real work is not a single top-level URL. HR portals, research
databases, and SaaS tenants often look like this:

```
tab
  ├─ https://hr.example.edu          portal chrome (often a shell)
  │     banner, nav, “Jump to content”
  └─ <iframe>  (cross-origin OOPIF)
        └─ https://tenant.example.com   the app you actually click
              search, forms, tables
```

If Tyto snapshotted only the parent, it would see an empty shell and miss
the app. If it clicked using the **parent’s** coordinates, the click would
land in the wrong document. That is a bug, not a “hard site.”

### What Tyto does instead

1. **Auto-attach** child targets (`Target.setAutoAttach`, flatten). Out-of-process
   iframes (OOPIFs) get their own CDP session.
2. **Snapshot per frame** — `Accessibility.getFullAXTree` on the focused
   frame, not a flattened guess of the parent tree.
3. **Pick the working document** — prefer the injected tenant with landmarks
   over the parent shell or a cookie-banner frame. An unattached child is
   not “the app”; it is logged (`reasonEmpty`) and is not thrown as a crash.
4. **Click in that session** — `DOM.getBoxModel` then `Input.dispatchMouseEvent`
   on the **child** session, with the **child’s** box. Parent CSS coordinates
   into an iframe are forbidden.
5. **Allowlist each origin.** Discovering an iframe does **not** grant it.
   You grant the portal, the tenant, and the IdP separately. Recipes key off
   **frame origin**, so the same tenant still binds if the portal URL changes.

Workday-on-a-campus-portal is the documented example of this pattern, not a
special case in code.

### Other ways the same document shows up

| How it shows up | What Tyto does |
|---|---|
| Top-level navigation | `goto` that URL (allowlist first). Snapshot that target. |
| Same-origin iframe | Still a frame in the graph. Focus it; do not assume the parent tree is enough. |
| Cross-origin iframe / OOPIF | Auto-attach; act only in an allowed, attached child session. |
| Nested iframes | Walk the graph. The working document may be two levels down. |
| DHTML / `innerHTML` / React `#root` / hydrate | Classify `shell` vs `injected` **on that frame**. `waitReady` on growth, not `sleep(250)`. If it stays a shell, extract **fails closed** — no invented facts. |
| Shadow DOM / web components | Accessibility tree is truth. Do not `page.evaluate` the light DOM and call it done. |
| Popup / new tab (SSO, print, OAuth) | Related targets. Yield for MFA / login. Then operate the app target, not the opener chrome. |
| Reverse proxy / vanity host / injected proxy | Still one or more Chromium documents. Same ports. No “proxy driver.” |
| Pictorial-only (canvas, WebGL, image) | Screenshot is the exception, not the default loop. |

Limits that still apply: default-deny allowlist, confirm-gates, page text is
**data** (never commands), no `window.tyto` for the page to call.

### What we refuse

- Treating the parent portal chrome as the app because the iframe was empty.
- Auto-granting every origin an iframe happens to load.
- A `WorkdayDriver` (or CSS for `wd-CommandButton`) — that is a **recipe**,
  not a fork of the product.
- Playwright locators as the product API.

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

**Slices 0–9 (contract) + host Perch UI** are in-tree and tested — including host
JSON-RPC on loopback, `GET /` Perch, model HTTP adapters (mocked), and CDP
trusted-click / OOPIF contract tests on a scripted wire. Live Chrome spawn is
`TYTO_LIVE=1` (`npm start`). The MV3 extension is specified; identity restore
is not the first-run path. `poc/` is a Playwright spike used to prove AX + tape;
it is not the product API.

---

## Use it

There is **no native installer** yet. You run the host from this repo. Opening
Chrome from the Dock does not start Tyto.

**Full walkthrough:** [docs/USAGE.md](./docs/USAGE.md).

```bash
git clone git@github.com:YOLOVibeCode/tyto.git
cd tyto
git config core.hooksPath .githooks
npm install
npm start
```

`npm start` listens on `http://127.0.0.1:7420/` (Perch), launches Chrome with
an **empty** Tyto profile (`~/.tyto/profile`), and opens Perch as a **tab in
that Chrome**. Paste a URL and a goal, click **Go**. Your everyday browser stays
closed.

You need Chrome or Edge, and a model at `TYTO_BASE_URL` (default Ollama
`http://127.0.0.1:11434/v1`, model `gpt-oss:20b`). First start writes a host
token into local `.env` (gitignored). Never commit it.

Kill Perch: session JSON under `~/.tyto/sessions/` remains.

---

## Develop

Requires **Node 22+**. Tests must pass **offline**.

```bash
npm test
npm run check          # imports + secrets + tests + types
npm run secrets:scan   # fail closed; does not print secret values
```

Copy `.env.example` to `.env` for local models. **Never commit `.env` or
browser profiles.** `npm test` never launches Chrome.

Optional spike (installs Playwright locally; not the product):

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
| `@tyto/host` | Composition root (loopback JSON-RPC + token) |
| `@tyto/sdk` | Client |
| `@tyto/cdp` | CDP adapter — **not Playwright** |
| `@tyto/llm` | OpenAI-compatible + Anthropic HTTP |
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
