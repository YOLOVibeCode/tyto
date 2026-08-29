# Use Tyto

Tyto is in **development**. There is no installer. You run it from a git clone.
Opening Google Chrome from the Dock does nothing — the **host** has to be running.

You occupy a Chrome or Edge window that **Tyto launches**. You steer it from
**Perch**, a tab in that same window. The site you browse cannot command Tyto.

Operator contract: [SPEC.md](./SPEC.md). This file is the current start path.

---

## What you will see

`npm start` opens **one** Chrome window with two tabs:

| Tab | What it is |
|---|---|
| Perch at `http://127.0.0.1:7420/` | Chat composer, model picker, **Stop**. The steering wheel. |
| Work tab (starts `about:blank`) | The hands. **Go** navigates this tab. Clicks happen here. |

They share the empty Tyto profile under `~/.tyto/profile` so your everyday
browser stays closed. Set `TYTO_STEER=os` if you still want Perch in the OS
default browser as well.

---

## Prerequisites

- **Node 22+**
- **Google Chrome** or **Microsoft Edge** installed in a normal location
  (`/Applications/Google Chrome.app` on macOS, or on `PATH`)
- A running **OpenAI-compatible model**. Default:

  - base URL `http://127.0.0.1:11434/v1` (Ollama)
  - model id `gpt-oss:20b`

  Install [Ollama](https://ollama.com), pull that model (or set `TYTO_MODEL` to
  one you have), and leave Ollama running.

---

## First run

```bash
git clone git@github.com:YOLOVibeCode/tyto.git
cd tyto
git config core.hooksPath .githooks
npm install
```

Optional: copy `.env.example` to `.env` and uncomment / set `TYTO_BASE_URL`,
`TYTO_MODEL`, and `TYTO_API_KEY` if the endpoint needs a key. Ollama often
works with an empty key.

```bash
npm start
```

The first start:

1. Writes a host token into **local** `.env` if none exists (gitignored; never
   printed to the terminal)
2. Listens on `127.0.0.1:7420` (override with `TYTO_PORT`)
3. Launches Chrome with `--remote-debugging-address=127.0.0.1`
4. Opens Perch as a tab in that Chrome (not your everyday browser)

Do not commit `.env`. Do not paste the token into chat or tickets.

---

## Every run

1. Start the model (Ollama or your proxy).
2. From the repo: `npm start`.
3. In **Perch** (`http://127.0.0.1:7420/`):
   - **Model** dropdown — pick from the host catalog (populated on load from
     `models.list`; shows "unavailable" if the host is not running or the catalog
     endpoint is down).
   - **Go bar** — paste a URL and click **Go** to navigate the launched Chrome
     and start a session. The origin is granted automatically.
   - **Composer** — type a follow-up goal or message and press **Send** (or
     Enter). Shift+Enter inserts a newline.
4. Watch the Tyto Chrome window. You can type or click there at any time; Tyto
   yields, then resumes from a fresh snapshot when you pause.
5. **Stop** asks the host to interrupt the running session.
6. In the terminal: Ctrl+C stops the host.

**Go** does this, in order:

1. Grant **that URL's origin** on the session allowlist (default-deny otherwise)
2. `page.goto` in the launched Chrome
3. Save a prompt session on disk with the selected model id
4. `session.run` — snapshot the accessibility tree, plan, trusted clicks

It does **not** grant every origin a page happens to load (iframes, SSO popups).

---

## Where files live

| Path | What |
|---|---|
| `./.env` (repo cwd) | Host token and optional model settings. Gitignored. |
| `~/.tyto/profile/` | Chrome/Edge user-data-dir for the launched window (empty on first run). |
| `~/.tyto/sessions/` | Prompt session JSON (goal, plan, last URL, model id). This is the durable object. |

Resume later: `npm start` again, then continue from the same session files.
Killing Perch does not delete them.

---

## Environment

All optional except a host token (generated on first `npm start`).

| Variable | Default | Role |
|---|---|---|
| `TYTO_BASE_URL` | `http://127.0.0.1:11434/v1` | OpenAI-compatible `/v1` |
| `TYTO_MODEL` | `gpt-oss:20b` | Default model id when session has none |
| `TYTO_API_KEY` | empty | Sent as Bearer if set |
| `TYTO_HOST_TOKEN` | generated | Loopback RPC auth; never log it |
| `TYTO_BIND` | `127.0.0.1` | Host bind. `0.0.0.0` is refused |
| `TYTO_PORT` | `7420` | Perch + JSON-RPC |
| `TYTO_ALLOW` | empty | Comma-separated origins to seed. Run still grants the URL you type |
| `TYTO_PROFILE` | `~/.tyto/profile` | Launched browser user-data-dir |
| `TYTO_SESSION_DIR` | `~/.tyto/sessions` | Session JSON |
| `TYTO_BROWSER` | `chrome` | `edge` to launch Edge instead |
| `TYTO_NO_OPEN` | unset | With `TYTO_STEER=os`, `1` skips opening Perch in the OS browser |
| `TYTO_STEER` | Chrome tab | `os` also opens Perch in the OS default browser |
| `TYTO_LIVE` | set to `1` by `npm start` | Required to spawn Chrome. `npm test` never sets this |

---

## If something fails

| Symptom | Likely cause |
|---|---|
| `browser binary not found` | Chrome/Edge not installed where Tyto looks |
| `browser spawn is opt-in` | You did not use `npm start` (that sets `TYTO_LIVE=1`) |
| `EADDRINUSE` / listen error on 7420 | Another Tyto (or process) on `TYTO_PORT` |
| Model dropdown shows "unavailable" | Ollama/proxy down, or wrong `TYTO_BASE_URL` |
| Perch loads, **Go** says model HTTP error | Wrong `TYTO_MODEL`, or model not pulled in Ollama |
| `origin not allowed` | Allowlist default-deny; use **Go** from Perch so the typed URL is granted |
| `browser not launched` | Host up but launch failed; check the terminal from `npm start` |
| Empty snapshot / nothing clicks | Model returned no usable plan, or page is a shell/iframe you have not granted |

`npm test` is airplane-mode. It never launches Chrome and never needs API keys.
A green `npm test` does not prove live Chrome.

---

## Chrome / Edge side panel (extension)

The Tyto extension adds a **side panel** (like Claude's sidebar) to Chrome or
Edge. It talks to the running host over loopback — no CDP from the page, no
`window.tyto`, token never in the panel DOM.

### Load the extension (unpacked)

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select the `extension/` folder inside your Tyto checkout.

### Store the host token in the extension

The extension reads the host token from `chrome.storage.session`. Set it once
after each browser restart (the host token is in `.env` as `TYTO_HOST_TOKEN`):

Open the Chrome DevTools console on any extension page, then run:

```js
chrome.storage.session.set({ hostToken: "YOUR_TOKEN", hostPort: "7420" });
```

Replace `YOUR_TOKEN` with the value from `.env`. **Never commit it.**

### Open the side panel

Click the **Tyto** toolbar icon. The panel appears on the right side of the
window. If it does not appear, ensure the host (`npm start`) is running first.

### Pick a model

The **Model** dropdown is populated from `models.list` (the host catalog —
models at `TYTO_BASE_URL`). Select the model you want; the choice persists
in `chrome.storage.local`. If the dropdown shows "unavailable", the host is
not running or the catalog endpoint returned an error.

### Send a goal

Type your goal in the composer at the bottom and press **Send** (or Enter).
Shift+Enter inserts a newline. The transcript shows your message and Tyto's reply.

### Scope: This tab vs All tabs

| Button | Behaviour |
|---|---|
| **This tab** (default) | Panel scoped to the current tab via `setOptions({ tabId })`. |
| **All tabs** | Global panel stays open across tabs. Tyto acts on whichever tab is focused when you send. |

The last scope choice is persisted in `chrome.storage.local`.

### Stop

**Stop** sends `operator.interrupt` to the running session. Typing or clicking
in the launched Chrome window yields occupancy (the agent does not overwrite
mid-keystroke). After you pause, Tyto resumes from a fresh accessibility
snapshot. Esc and Stop halt the loop so it stays Idle.

---

## What this is not (yet)

- A packaged `Tyto.app` / Windows installer / Homebrew keg
- "Open my normal Chrome and Tyto is already in it" (ATTACH via `chrome.debugger`
  auto-attach — Slice 11; the panel today talks to the LAUNCH host)
- Automatic clone of your named Chrome/Edge profile (explicit pick, later)
- Identity vault restore into the first-run profile
- A Chrome Web Store listing

CI on `ci-deploy` (and `main`) uploads an unpacked MV3 zip (`tyto-extension`)
you can **Load unpacked** from `chrome://extensions`. That is the side-panel
client, not a one-click daily-Chrome install. `npm start` remains the one-browser
LAUNCH path.

Those are specified. They are not the current start path.

---

## Developers

```bash
npm test           # offline, always airplane-mode
npm run check      # imports + secrets scan + tests + types
npm run test:e2e   # live E2E: requires Chrome on PATH (sets TYTO_E2E=1 TYTO_LIVE=1)
npm run package:extension  # copies MV3 files to dist/tyto-extension (+ zip if `zip` exists)
```

Product laws: [IMPLEMENTATION.md](./IMPLEMENTATION.md). Do not promote `poc/`
(Playwright spike) into product packages.

---

## Testing tiers

Tyto uses four test tiers. Only Tier 1 gates merges.

| Tier | What | Gate | Command |
|---|---|---|---|
| 1 | JSDOM UI (perch.html + sidepanel.js) | ✅ Merge-gating | `npm test` |
| 2 | Live loop — Tyto drives real Chrome | `TYTO_E2E=1 TYTO_LIVE=1` | `npm run test:e2e` |
| 3 | Playwright extension side-panel DOM | `TYTO_E2E=1` | `npm run test:e2e` |
| 4 | Ollama nightly — real model round-trip | `TYTO_MODEL_LIVE=1` | `TYTO_MODEL_LIVE=1 npm run test:e2e` |

### Tier 1 — JSDOM (offline, gating)

Tests in `packages/host/test/perch-ui.test.ts` and `extension/test/sidepanel-ui.test.ts`
load `perch.html` and `sidepanel.js` into JSDOM, stub `fetch` / `chrome.*`, and assert
UI behaviour without a real browser: model dropdown, Go flow, Send/multi-turn, Enter key,
Stop, error surfaces.

These run on every `npm test` and block merges if they fail.

### Tier 2 — Live loop (opt-in)

`e2e/test/live-loop.test.ts` starts a fixture HTTP server and a scripted OpenAI-compat
server (both on loopback), calls `bootLive` to launch real Chrome, then drives the
session via `TytoClient`. A **second, independent CDP connection** verifies the browser
actually navigated — without trusting the code under test.

Requires Chrome on `PATH` and `TYTO_E2E=1 TYTO_LIVE=1`.

`e2e/test/vault-live.test.ts` is the same gate. It logs into a cookie-session fixture,
captures via `CdpCredentialStore` + the identity vault, quits Chrome, relaunches an
empty profile, restores, and checks the account page is still authenticated. It then
greps the session file, tape, model prompt, and vault ciphertext for the cookie value.

`e2e/test/weave-live.test.ts` types into the search fixture as the operator, then
asks the agent to fill the same box. Mid-keystroke the operator's text stays.
After the operator pauses, the loop resumes from a fresh snapshot.

Unattended exit codes (Slice 14) are `runUnattended` in `@tyto/core`. Preflight:

```bash
npm run run:unattended -- --session <id> [--allow-confirm-fail]
```

| Code | Meaning |
|---|---|
| 0 | done |
| 2 | document still a shell (`ShellNotReady`) |
| 3 | allowlist deny |
| 4 | confirm required (`--no-confirm`, the default) |

### Tier 3 — Extension panel (opt-in, Playwright)

`e2e/test/extension-panel.test.ts` uses `chromium.launchPersistentContext` with
`--load-extension=extension/` to run the real extension. Playwright Chromium must run
**headed** (`headless: false`) — extensions do not register a service worker in
headless mode. On macOS that opens a brief window; on CI the job wraps the run in
`xvfb-run`.

The host token is seeded into `chrome.storage.session` via the service worker.
Playwright intercepts extension→host HTTP with `context.route()` (Playwright
Chromium blocks service-worker `fetch` to loopback). Then it drives `sidepanel.html`
as a tab.

Playwright's role is strictly the operator's finger on the panel DOM. Page actuation
stays Tyto's. The test asserts: model dropdown populated, goal send → assistant reply
visible, token absent from DOM, origin not auto-granted on panel load.

Requires `TYTO_E2E=1`.

### Tier 4 — Ollama nightly (non-gating)

`e2e/test/ollama-live.test.ts` hits a local Ollama instance, lists models, then sends a
single-step session and asserts the response parses as a valid plan. Catches prompt /
format drift before it affects users. Never blocks a merge.

Requires `TYTO_MODEL_LIVE=1` (plus Ollama running with `TYTO_BASE_URL` + `TYTO_MODEL`).

### CI

`.github/workflows/ci.yml` — airplane-mode check, runs on every push / PR.
`.github/workflows/e2e.yml` — Tiers 2–3, nightly + `workflow_dispatch`, marked
`continue-on-error: true`. Not required for merge. Tier 3 runs under `xvfb-run`
because the extension test needs a display.
