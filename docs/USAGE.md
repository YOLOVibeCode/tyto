# Use Tyto

Tyto is in **development**. There is no installer. You run it from a git clone.
Opening Google Chrome from the Dock does nothing — the **host** has to be running.

You occupy a Chrome or Edge window that **Tyto launches**. You steer it from
**Perch** (a local page). The site you browse cannot command Tyto.

Operator contract: [SPEC.md](./SPEC.md). This file is the current start path.

---

## What you will see

`npm start` opens **two** windows:

| Window | What it is |
|---|---|
| Perch at `http://127.0.0.1:7420/` | URL, goal, **Run** / **Stop**. This is the steering wheel. |
| Chrome (empty Tyto profile) | The hands. Pages load and clicks happen here. |

They are not the same window. Perch is usually your default browser; Chrome is
a separate profile under `~/.tyto/profile` so your everyday cookies stay out of
the first run.

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
4. Opens Perch in your default browser

Do not commit `.env`. Do not paste the token into chat or tickets.

---

## Every run

1. Start the model (Ollama or your proxy).
2. From the repo: `npm start`.
3. In **Perch**:
   - **URL** — page to open (must be `http:` or `https:`). Example:
     `https://example.com/`
   - **Goal** — what you want in prose. Example: `extract the heading`
   - **Run**
4. Watch the Tyto Chrome window. You can type or click in that window at any
   time; Tyto is supposed to yield.
5. **Stop** asks the host to interrupt.
6. In the terminal: Ctrl+C stops the host (Chrome child is torn down with the
   session’s debug process).

**Run** does this, in order:

1. Grant **that URL’s origin** on the session allowlist (default-deny otherwise)
2. `page.goto` in the launched Chrome
3. Save a prompt session on disk
4. `session.run` — snapshot the accessibility tree, plan, trusted clicks

It does **not** grant every origin a page happens to load (iframes, SSO popups).
Grant those separately when we expose that in the UI; until then, stay on
simple top-level pages for first runs.

---

## Where files live

| Path | What |
|---|---|
| `./.env` (repo cwd) | Host token and optional model settings. Gitignored. |
| `~/.tyto/profile/` | Chrome/Edge user-data-dir for the launched window (empty on first run). |
| `~/.tyto/sessions/` | Prompt session JSON (goal, plan, last URL). This is the durable object. |

Resume later: `npm start` again, then continue from the same session files.
Killing Perch does not delete them.

---

## Environment

All optional except a host token (generated on first `npm start`).

| Variable | Default | Role |
|---|---|---|
| `TYTO_BASE_URL` | `http://127.0.0.1:11434/v1` | OpenAI-compatible `/v1` |
| `TYTO_MODEL` | `gpt-oss:20b` | Model id at that base URL |
| `TYTO_API_KEY` | empty | Sent as Bearer if set |
| `TYTO_HOST_TOKEN` | generated | Loopback RPC auth; never log it |
| `TYTO_BIND` | `127.0.0.1` | Host bind. `0.0.0.0` is refused |
| `TYTO_PORT` | `7420` | Perch + JSON-RPC |
| `TYTO_ALLOW` | empty | Comma-separated origins to seed. Run still grants the URL you type |
| `TYTO_PROFILE` | `~/.tyto/profile` | Launched browser user-data-dir |
| `TYTO_SESSION_DIR` | `~/.tyto/sessions` | Session JSON |
| `TYTO_BROWSER` | `chrome` | `edge` to launch Edge instead |
| `TYTO_NO_OPEN` | unset | `1` skips opening Perch in the OS browser |
| `TYTO_LIVE` | set to `1` by `npm start` | Required to spawn Chrome. `npm test` never sets this |

---

## If something fails

| Symptom | Likely cause |
|---|---|
| `browser binary not found` | Chrome/Edge not installed where Tyto looks |
| `browser spawn is opt-in` | You did not use `npm start` (that sets `TYTO_LIVE=1`) |
| `EADDRINUSE` / listen error on 7420 | Another Tyto (or process) on `TYTO_PORT` |
| Perch loads, **Run** says model HTTP error | Ollama/proxy down, wrong `TYTO_MODEL`, or `TYTO_BASE_URL` |
| `origin not allowed` | Allowlist default-deny; use **Run** from Perch so the typed URL is granted |
| `browser not launched` | Host up but Launch failed; check the terminal from `npm start` |
| Empty snapshot / nothing clicks | Model returned no usable plan, or the page is a shell/iframe you have not granted |

`npm test` is airplane-mode. It never launches Chrome and never needs API keys.
A green `npm test` does not prove live Chrome.

---

## What this is not (yet)

- A packaged `Tyto.app` / Windows installer
- “Open my normal Chrome and Tyto is already in it” (that is **ATTACH**,
  extension + native messaging)
- Automatic clone of your named Chrome/Edge profile (explicit pick, later)
- Perch as a Chrome side panel (same SDK client; still a later view)
- Identity vault restore into the first-run profile

Those are specified. They are not the current start path.

---

## Developers

```bash
npm test           # offline
npm run check      # imports + secrets scan + tests + types
```

Product laws: [IMPLEMENTATION.md](./IMPLEMENTATION.md). Do not promote `poc/`
(Playwright spike) into product packages.
