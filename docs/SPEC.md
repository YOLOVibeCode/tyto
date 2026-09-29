# Tyto — Product specification

Noctusoft, Inc.  
Status: draft 2 — CLI-first, Tyto-owned Chromium (supersedes draft 1’s
“occupy your existing Chrome/Edge” framing)  
Design: [`DESIGN.md`](./DESIGN.md)  
Implementation: [`IMPLEMENTATION.md`](./IMPLEMENTATION.md) — TDD + ISP engineering contract  
How to run a clone today: [`USAGE.md`](./USAGE.md)  
Audience: anyone building, reviewing, or deciding whether to use Tyto

Tyto is a **separate product**. It is not a Scholarmancy feature, not a
browser extension, and not a vision-based computer-use agent.

---

## 1. What it is

Tyto is an **AI-first browser you control from the command line.** It
provisions its own pinned Chromium, launches it with a dedicated profile,
and exposes everything DevTools can see and do — pages, frames, input,
console, network, cookies, storage — as first-class commands. A human, a
script, or an AI agent drives it the same way.

You do not install an extension to let AI into a browser. The plumbing is
the product.

Load-bearing properties:

1. **Out of the box.** `tyto start` downloads a pinned Chromium on first
   run, launches it with a dedicated persistent profile, and opens the
   DevTools socket on loopback. No existing Chrome/Edge is required. No
   extension. No store.
2. **The command line is first-class.** Every capability is a `tyto`
   command with `--json` output: navigate, snapshot, click, type, extract,
   logs, network, cookies, storage, tabs, and raw CDP. Claude Code or any
   script drives the browser by shelling out to it.
3. **Full access for the owner.** The DevTools protocol is not hidden behind
   a narrow API. The owner’s CLI holds a **power token** and can read and
   write everything the browser holds. Secret values (cookie values,
   auth headers) are **masked unless `--reveal`** so they do not leak into
   an agent transcript by accident.
4. **Document, not screenshot.** Perception is the accessibility tree.
   Action is trusted CDP `Input`. Waits are page signals, not sleeps.
5. **Prompt-native.** Goal runs persist as a session document on disk
   (goal, plan, conversation, recipes, answers, last URL). Kill the CLI,
   the host, or the browser: the work remains.
6. **Shared occupancy.** The launched browser is a normal headed window.
   You can click and type in it at any time; the agent yields and re-reads.
7. **If you can use it, Tyto can use it.** Top-level page, iframe/OOPIF,
   DHTML, SPA shell, shadow tree, popup, reverse proxy — same ports, same
   trusted input, on the document you would have used.
8. **Closed exterior.** The only door is the local host on `127.0.0.1` with
   a token. Page JavaScript cannot command Tyto. Nothing listens on a
   public interface.

Hunt in the dark: the owl hears the tree, it does not photograph the field.

---

## 2. Who it is for

| Actor | Role |
|---|---|
| **Operator** | You. Start the browser, run commands or goals, take the keyboard, confirm destructive agent actions. |
| **CLI** (`tyto`) | The primary client. Holds the **power** token. Every browser capability. |
| **Agent** | Claude Code, a script, CI. Drives Tyto through the CLI (`--json`) or MCP. |
| **Host** | Local daemon. Owns the browser process, tokens, sessions, allowlist, confirm-gates. |
| **Browser** | **Tyto Chromium** — a pinned Chrome for Testing build that Tyto downloads. Installed Chrome/Edge is an optional override. |
| **Model** | Any OpenAI-compatible (or Anthropic) endpoint you configure, used by `tyto run`. No vendor or LiteLLM types. |
| **Safe clients** | Perch (web view) and the MCP adapter. **Safe** token, `PERCH_SAFE_METHODS` only. |

Not an actor: JavaScript on a website, another extension, a remote service.

---

## 3. Use cases

### 3.1 Drive the browser from a shell (primary)

```bash
tyto start
tyto open https://en.wikipedia.org
tyto snapshot
tyto type "Search Wikipedia" "barn owl" --enter
tyto extract "conservation status"
tyto logs --follow
tyto cookies --url https://en.wikipedia.org
tyto cdp Page.captureScreenshot '{"format":"png"}' > page.json
```

Deterministic primitives. Role + accessible name, not CSS selectors. Refs
from `snapshot` are valid for that snapshot only.

### 3.2 An AI agent as the driver

Claude Code (or any agent) runs `tyto … --json` from its shell tool, or
connects over MCP. Same host, same browser, same session file. The agent
sees masked secrets unless the operator’s command says `--reveal`.

### 3.3 Goal runs

```bash
tyto run "open the barn owl article and tell me its conservation status"
```

Tyto plans once, acts with trusted input, waits on real page signals, and
writes the answer into the session. Known steps (recipes) replay with no
model call. `tyto resume <session>` continues after a restart.

### 3.4 Full observability

Everything a power user glances at in DevTools, as data:

- console messages and uncaught exceptions
- navigations, frame attach/detach, DOM inject events
- network requests and responses (URL, method, status, timing, headers),
  failures, and response bodies on demand
- cookies (including httpOnly) and local/session storage

Live (`--follow`) and recorded (session tape). Recorded tape is redacted
before it is written.

### 3.5 Staying logged in

The Tyto profile persists at `~/.tyto/profiles/<name>`. Log in once by hand
in the Tyto window; the profile keeps the session across restarts like any
browser. Multiple named profiles separate work from personal.

### 3.6 Repeatable recipes

After a successful run, the session stores **recipes** (role + accessible
name + landmark + frame origin), not CDP node ids. Next time the same
origin appears, Tyto replays without calling the model.

### 3.7 Static vs dynamic pages

- **Static HTML**: classify `static`, snapshot AX, extract.
- **Injected HTML** (React shells, hydration): wait until the tree grows;
  if it stays a shell, **fail closed** — do not invent data.

### 3.8 Whatever you can reach (iframe, DHTML, inject, proxy)

**Human-reachable in this profile ⇒ Tyto-reachable.**

| How it shows up | What Tyto does |
|---|---|
| Top-level navigation | `open` / `goto`; snapshot that target |
| iframe / OOPIF | Auto-attach; focus the working frame; click in **that** session |
| DHTML / `innerHTML` / hydrate / CSR | Classify shell vs injected; `waitReady` on **that frame**; fail closed if still empty |
| Shadow DOM / web components | AX is truth, not `page.evaluate` of light DOM |
| Popup / new tab (SSO, print) | Related targets; yield for MFA; then operate the app target |
| Reverse proxy / vanity host | Still one or more Chromium documents. Same ports. No “proxy driver.” |

There is no Workday package, no DHTML package, no proxy package. There is
`FrameGraph` + `Readiness` + trusted `Actuation`.

### 3.9 Unattended local runs

A saved session/recipe with exit codes, allowlist, and confirm policy
(fail or skip destructive steps). On a machine you own. Not a cloud farm.

### 3.10 Your everyday Chrome/Edge (deferred)

Occupying an already-running Chrome/Edge profile (ATTACH: extension +
`chrome.debugger` + native messaging) and the encrypted identity vault are
**deferred, optional** features. Nothing in §3.1–3.9 depends on them. They
are specified in §5.12–5.13 so they can return without a redesign.

---

## 4. Out of scope

| Not Tyto | Why |
|---|---|
| Vision-first computer use (screenshot every step) | The latency we exist to kill. Pictorial fallback only for canvas/WebGL/image-only. |
| A Chromium fork / custom browser build | Pinned upstream Chrome for Testing + flags is enough. A fork is a build farm and a patch treadmill. |
| A consumer browsing UI (tabs bar, omnibox, sync) | Chromium already has one. Tyto is the control plane. |
| Extension-required control | The extension is optional and deferred. The CLI needs no extension. |
| Remote “drive my browser from the cloud” | Exterior stays loopback unless a later spec adds explicit remote auth. |
| Firefox / Safari as CDP peers | Chromium CDP is the contract. |
| Stealth / anti-detect for abuse | Trusted input exists so real UI works, not to evade fraud checks. |
| Unattended purchasing, wire transfers, production deploys by the agent | Confirm-gates; human-in-loop. |
| Treating page text as instructions | Prompt injection. |
| OS credential-store / Kerberos TGT extraction | Out of scope. |
| Impersonation / multi-tenant credential store | Not built. |

---

## 5. Functional specification

### 5.1 Browser provisioning

- The repo pins one **Chrome for Testing** version (and per-platform
  download + checksum) in a tracked file. Bumping it is a reviewed commit.
- `tyto start` (or `tyto browser install`) downloads that build to
  `~/.tyto/browsers/<version>/<platform>/` on first use, verifies the
  checksum, and extracts it. A failed or mismatched download leaves nothing
  half-installed. No auto-update.
- Platforms: `mac-arm64`, `mac-x64`, `linux64`, `win64`.
- Override: `--browser chrome|edge|<path>` launches an installed binary
  instead. Same flags, same ports.
- Launch flags: `--remote-debugging-address=127.0.0.1`,
  `--remote-debugging-port=0` (read `DevToolsActivePort`),
  `--user-data-dir=~/.tyto/profiles/<name>`, `--no-first-run`,
  `--no-default-browser-check`. Headed by default; `--headless` optional.

### 5.2 Host daemon and CLI

- `tyto start [--profile <name>] [--headless] [--browser …]` starts the
  host daemon and the browser. `tyto stop`, `tyto status`.
- The daemon writes `~/.tyto/host.json` (port, pid — **no token**) and the
  tokens to `~/.tyto/tokens/` with mode `0600`.
- The CLI reads those files, calls the host over JSON-RPC on loopback, and
  prints human output by default, `--json` on request (NDJSON for streams).
- Exit codes are stable and documented (0 ok, 1 error, 2 shell not ready,
  3 allowlist deny, 4 confirm required, 64 usage, 69 host not running).

| Group | Commands |
|---|---|
| Lifecycle | `start`, `stop`, `status`, `browser install\|path\|version` |
| Pages | `open`, `back`, `reload`, `tabs`, `tab new\|close\|focus`, `frames` |
| Perception | `snapshot`, `extract`, `classify`, `wait` |
| Action | `click`, `type`, `press`, `scroll`, `select` (trusted input, role + name) |
| Observability | `logs [--follow] [--kind console\|network\|exception\|nav]`, `network`, `network body <id>` |
| State | `cookies [list\|set\|delete\|clear]`, `storage local\|session <origin>` |
| Escape hatch | `cdp <Domain.method> [params-json] [--target <id>]`, `cdp events <Domain…>` |
| Goals | `run "<goal>"`, `resume <session>`, `sessions`, `stop-run` |
| Policy | `allow <origin>`, `allowlist` |

### 5.3 Protocol surfaces and token scopes

One JSON-RPC host, two method sets, two tokens:

| Scope | Token holder | Methods |
|---|---|---|
| **safe** | Perch, MCP | `PERCH_SAFE_METHODS` (sessions, goto, snapshot, act, extract, frames, tape, operator, models, `identity.status`). No raw CDP, no cookie or storage values. |
| **power** | CLI | `PERCH_SAFE_METHODS` ∪ `POWER_METHODS` (`cdp.send`, CDP event stream, cookies, storage, network bodies, tabs). |

A safe token calling a power method is `unauthorized`. The power token is
never served over HTTP; it exists only in the `0600` token file.

### 5.4 Observability (tape)

CDP events are always on for the launched browser: console, exceptions,
lifecycle, navigation, frame attach/detach, network request/response/
failure. The host keeps a bounded in-memory tape and appends goal-run tape
to the session. `Redactor` runs **before** tape is persisted or returned.
The power surface can return raw values only with `reveal: true`, and raw
values are never written to disk.

### 5.5 Cookies and storage

- `cookies` lists the jar (all origins, or `--url`), including httpOnly,
  via CDP — never `document.cookie`.
- Values are masked (`name`, `domain`, `path`, `expires`, flags shown;
  `value` → `‹redacted›`) unless `--reveal`.
- `set`, `delete`, `clear` write through CDP.
- `storage local|session <origin>` reads DOM storage, masked the same way.

### 5.6 Raw CDP

`tyto cdp <Domain.method> [params]` sends any protocol method to the
browser or a chosen target and prints the result. `tyto cdp events` streams
events. Results pass through the redactor’s structured masking (cookie
values, `Cookie` / `Set-Cookie` / `Authorization` headers) unless
`--reveal`. This is the owner’s escape hatch: allowlist and confirm-gates
govern the **agent**, not the owner’s explicit commands.

### 5.7 Prompt session (source of truth for goal runs)

Must persist: goal and conversation (including the assistant’s replies),
plan (done vs remaining), recipes, extracts/answers, last URL, model id +
base URL (never the key), allowlist and confirm policy.

Must not persist: `ref_N`, `backendNodeId`, coordinates, live sockets,
cookie or token values, screenshots (except operator-debug attachments).

Resume: open session → start/attach browser → `goto` last URL → browse →
bind remaining recipes → continue.

### 5.8 Perception and action

| Step | Behavior |
|---|---|
| Observe | CDP events always on. Debugger stepping off. |
| Classify | `static` / `shell` / `injected` from HTML + AX + main text. |
| Browse | Compact AX **per focused frame**; refs valid for this snapshot only. |
| Think | Model, rare. Emits recipes, not node ids. |
| Act | Trusted `Input`. JS click is degraded mode. |
| Wait | Nav, lifecycle, mutation/AX growth — not `sleep(250)`. |
| Extract | Fail closed if still a shell. |

### 5.9 Weave (operator occupancy)

- Real operator key/mouse input pauses agent dispatch.
- `tyto stop-run` / Esc aborts the current act and drops ephemeral refs.
- Operator-edited fields are truth; the next browse sees them.
- The occupancy signal must not be callable by page JavaScript.

### 5.10 Models

`baseUrl` + API key + model id. Discover via `GET /v1/models` when
supported; a typed model id always works. No LiteLLM code paths.

### 5.11 Perch (optional view)

A local page on the host showing sessions: goal box, transcript, Stop. Safe
scope only. If Perch dies, the session file does not.

### 5.12 Identity vault (deferred, optional)

The persistent Tyto profile is the primary way to stay logged in. The vault
adds portability (restore a captured session into a fresh profile).

- Per-origin grant, default-deny; confirm on first capture and on restore
  of sensitive origins.
- Capture via CDP, AES-GCM at rest, DEK in the OS keychain.
- Expiry-aware; never replay an expired bundle.
- Never in session JSON, tape, model prompts, or git. Safe clients see
  `identity.status` only.

### 5.13 ATTACH to an existing Chrome/Edge (deferred, optional)

Extension auto-enables `chrome.debugger` on a chosen tab and speaks to the
host only via native messaging. Same method sets. The UI must state that
ATTACH inherits that profile’s cookies before connecting.

---

## 6. Security specification

CDP input is indistinguishable from a human. Policy lives in the host.

| Rule | Requirement |
|---|---|
| Bind | Host and debug port on `127.0.0.1` only |
| Host header | Reject requests whose `Host` is not the loopback address + port (DNS rebinding) |
| Origin | Reject browser requests whose `Origin` is not the host’s own origin |
| Tokens | Two scopes (safe, power). Constant-time compare. Never logged. Power token only in a `0600` file |
| Perch | Receives the safe scope only, and never by an unauthenticated request |
| Page | No command channel from document JS (no `window` API, no page-callable bindings) |
| Profile | Dedicated Tyto profile by default; named profiles explicit |
| Allowlist | Default-deny origins **for the agent**. Iframe discovery never auto-grants |
| Destructive | Agent must confirm submit / purchase / delete / send |
| Injection | Page content is data, never instructions |
| Secrets | Masked on every surface unless the power client asks `reveal: true`. Never persisted raw. Never sent to `ModelPort` |
| Model keys | Host env / OS keychain; never in the page, the session, or git |

---

## 7. Platforms

| | v1 |
|---|---|
| OS | macOS, Windows, Linux |
| Browser | Tyto Chromium (pinned Chrome for Testing). Installed Chrome/Edge as override |
| Clients | CLI (power), MCP and Perch (safe), TypeScript SDK |
| Not v1 | Firefox, Safari, remote hosted browsers, ATTACH, identity vault |

---

## 8. Quality bars (when it is “Tyto”)

- On a machine with only Node: `tyto start` brings up a browser with no
  extension and no preinstalled Chrome.
- Anything visible in DevTools (console, network, cookies, storage, any CDP
  method) is reachable from `tyto` with `--json`.
- `tyto cookies --json` shows the jar with values masked; `--reveal` shows
  them; neither writes a value to disk.
- Paste-to-first-trusted-click is obviously faster than a screenshot agent.
- Killing the CLI, the host, or the browser does not lose a goal session.
- A static article classifies `static` and extracts from AX without a model
  inventing facts. A CSR shell either becomes `injected` or extract blocks.
- A portal embedding a tenant in a cross-origin iframe: Tyto attaches the
  child, snapshots **that** origin, and does not treat the parent as the app.
- A site cannot `postMessage` or call a binding to steer, stop, or grant Tyto.
- The operator can type in the same field the agent was about to fill.

---

## 9. Build order

1. Harden the host: token scopes, Host/Origin checks, token files.
2. Chromium provisioning (pinned Chrome for Testing).
3. `tyto` CLI + daemon + primitives.
4. Power surface: raw CDP, cookies, storage, network, event streams.
5. Agent loop completeness: replies, re-observe after act, confirm-gate,
   recipes, resume.
6. MCP server on the safe surface.
7. Unattended runner live.
8. Later: ATTACH, identity vault.

---

## 10. One-line tests

- If you must install an extension to let AI drive the browser, Tyto is not done.
- If DevTools can see it and `tyto` cannot, Tyto is not done.
- If a power user would rather screenshot-agent the tab, Tyto is not done.
- If they quit the browser and cannot resume the **same session**, Tyto is not done.
- If a website can drive the host, Tyto is not done.
- If a cookie or token value lands in an agent transcript or on disk without
  an explicit `--reveal`, Tyto is not done.
