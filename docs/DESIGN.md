# Tyto

**An AI-first browser you drive in prose — without screenshots.**

Noctusoft, Inc. — design doc, draft 2  
Full specification: [`SPEC.md`](./SPEC.md) (use cases, requirements, security, platforms).  
Implementation: [`IMPLEMENTATION.md`](./IMPLEMENTATION.md) (TDD + ISP).

**Prompt-native first.** The durable object is the prompt (goal, plan,
conversation, recipes). The browser is a runtime that attaches to it. Lose
the tab, the sidebar, or a Chrome extension — **you must not lose the work.**

> **This is its own product.** Not a Scholarmancy feature, not a scraper
> sidecar, not “Playwright with a chat box.” Tyto is the thing you open when
> you want to *use the web with a model sitting next to you*, as fast as
> clicking it yourself. Treat it that way in naming, repos, and roadmap.

---

## What we are building now

The interaction is the same one people already like in **Claude Code** and
**Claude in Chrome**: you paste a goal (“find the barn owl article and tell me
its conservation status,” “fill this form from the PDF,” “open the invoice and
download the CSV”). The agent works *in the real page*.

What those products get wrong is **latency, occupancy, and amnesia**. Vision
loops photograph the screen, reason about pixels, and click approximately.
You wait. The page feels possessed. You cannot jump in and type without
fighting the agent. And if the Chrome extension disconnects, the tab sleeps,
or you close the side panel — **the run dies with the UI.** That is crazy.
The work was a prompt, not a port.

Tyto is the opposite occupancy model:

- **Paste** a task in the perch (sidebar), the way you paste into Claude Code.
- The host **reads the page as a document** (accessibility tree), not as a
  picture.
- It **clicks and types as you would** (trusted CDP input).
- **You keep the keyboard.** Take over any field, scroll, switch tabs. The
  agent yields. When you pause, it resumes from a fresh snapshot — not from a
  stale screenshot.
- Weave in and out like a native: human and owl share one Chromium, one
  profile of *this* product, one timeline.

**If you can use it, Tyto can use it.** iframe, DHTML, injected SPA, shadow
tree, popup, reverse-proxied or injected host — same hands, programmatically.
How the document was delivered is not a product line. If your click works
and Tyto’s does not, that is a bug.

If a step is already known (role + name + landmark), there is **no model call**.
That is how it feels faster than you. The model is for *deciding*, not for
*looking*.

---

## Prompt-native first (this is load-bearing)

Claude-in-Chrome / Claude Code’s browser extension keeps the *agent* in the
extension. Kill the extension, and you lose what it was doing: the plan, the
cursor in the task, the “why,” sometimes even the goal you pasted.

Tyto inverts that.

```
prompt session (file / host DB)
    ├── goal you pasted
    ├── conversation (you ↔ model)
    ├── plan: steps done | remaining
    ├── recipes / anchors (role + name + landmark — never node ids)
    ├── extracts / answers
    └── last URL + tab intent
         │
         ├── perch   (sidebar view)
         ├── MCP     (Claude Code view)
         └── Chromium (hands)
```

The session is a **document**, like a Claude Code thread plus a committable
task. Perch is one editor. MCP is another. Chromium is the body. Any of those
can die. Reloading Tyto means: open the session, `goto` last URL, BROWSE, bind
remaining recipes, continue. No archaeology of a vanished side panel.

What we persist vs throw away:

| Keep | Throw away |
|---|---|
| Prompt, messages, plan, recipes | `ref_N`, `backendNodeId`, box coordinates |
| Answers, allowlist, model settings | Live CDP session, extension port |
| Last URL, “I was on the invoice tab” | Screenshots |

That is what “AI prompt native first” means: **you paste into a durable
prompt, not into a widget that happens to be docked on a tab.** The page is
where hands go. The prompt is where the work lives.

### Identity is continuity

The durable prompt is worthless if every resume hits a login wall. A
recipe for an authenticated portal — payroll, HR, a research database —
is useful only if the agent can actually get in.

The **identity vault** is the part of the host kernel that keeps you in.
It identifies how each allowed origin authenticates (cookie session, OAuth
bearer, SAML SSO, IWA/Negotiate), captures the browser-scoped session
material with your consent, encrypts it at rest with a key in the OS
keychain, and re-injects it silently on resume. The prompt session stores a
vault **handle**, never the raw material.

This is not "save my passwords." The vault captures the *result* of
authentication — the session cookies and tokens that Chrome already holds
— not the credentials you typed. It is closer to profile persistence than
to a password manager. And it is strictly browser-to-browser: the material
is re-injected back into Chrome or Edge, never exported to scripts or APIs.

---

## Why this has to be a separate product

Scholarmancy’s crawler (`scholaracle_scrapers` / `IPageDriver`) is a sibling
problem: authenticated portals, recipes, CLI + WebView + extension. It may
**borrow** Tyto’s ready-signal and AX extract later. It is not the customer.

Tyto’s customer is a person in a browser who wants an AI-native way to move
through the web — research, ops, forms, “do this to that page” — with the
snappiness of a power user, not the lag of a screenshot agent.

Shipping it inside Scholarmancy would make it a sync tool. It is a **browser**.

---

## Premise

Barn owls (*Tyto alba*) hunt in total darkness by hearing alone. They don't
need to see the prey to strike it.

Tyto perceives the page semantically and acts through trusted input events.
No screenshot loop. The model never looks at pixels unless the content is
genuinely pictorial (canvas, WebGL, image-only).

---

## The painful thing we refuse

Vision-first browser agents (and most “AI Chrome extensions” in practice) do
this every step:

```
screenshot → tokens → “the blue button is around (412, 880)” → click → wait
```

That is seconds per move, and it is *wrong* for HTML. The page already knows
what a button is. Asking a model to *see* it is how you get lag.

Tyto’s step:

```
AX snapshot (tens of ms) → plan once → trusted click (tens of ms)
         → wait on nav / mutation, not on a sleep
         → you can type in the same field whenever you want
```

The Wikipedia-via-Wayback POC already showed the static case: classify
`static` in ~17ms, extract from the tree in ~0ms. Live CSR pages need a
**ready** wait (injected HTML), not a screenshot.

---

## Weave — occupancy of a native pro

This is a product requirement, not a polish item.

| You | Tyto |
|---|---|
| Click, type, scroll at any moment | Yields; does not queue clicks on top of you |
| Paste a goal in the perch | Plans; acts only while you are idle *or* when you hit Run |
| Say “stop” / Esc | Immediate halt; snapshot discarded |
| Switch tabs, go back | Agent re-browses; never trusts last `ref_N` |
| Fill half a form yourself | Agent reads the new AX tree and continues the *rest* |

The Chrome-extension debug banner (`chrome.debugger`) is the tax for
**occupying a browser you already live in** (your Edge/Chrome profiles).
Tyto pays that tax only in **attach** mode, and only because you asked for
100% CDP in *that* process. **Launch** mode starts Chrome or Edge itself with
a localhost debug port — full CDP, your chosen profile copy or path, no
store sandbox.

Either way, **the open web cannot drive it.** Control is a local SDK, not a
page script, not a public API.

`perch` is the Claude Code analog: a thin sidebar. Chat lives there. The
prompt session on disk is the source of truth. The page stays the page.

---

## Control plane — 100% in, 0% from the outside

You need **full automation of every CDP domain** that DevTools has: Input,
Accessibility, Page, DOM, Network, Runtime, Target (tabs, iframes, OOPIFs).
Anything less is not “a native pro.”

You also need the inverse: **nothing outside the machine’s trusted Tyto
surface can issue those commands.** Not `window.postMessage` from a site.
Not a random extension. Not a WAN-facing port.

```
  prompt session (disk)
           │
           ▼
  Tyto SDK  (Node / Python / MCP)     ← only callers
           │  127.0.0.1 + token
           ▼
  Tyto host (native, win / mac / linux)
           │
           ├─ LAUNCH   spawn Chrome or Edge
           │           user-data-dir = chosen profile
           │           --remote-debugging-port=127.0.0.1:… 
           │           full CDP, no MV3 sandbox
           │
           └─ ATTACH   native-messaging ↔ Tyto extension
                       already running in Chrome or Edge
                       extension auto-enables debugger on the tab
                       full CDP in *your* everyday profiles
```

**SDK** is the product’s exterior: Claude Code, scripts, Perch backend, later
other apps. Same session document, same loop (browse / think / act / ready).

**Extension** is how you get 100% control *inside* Chrome and Edge without
abandoning those profiles — including auto debug-attach so you do not click
“inspect” by hand. It speaks only to the host via **native messaging**, never
to the page’s JavaScript as a command channel.

**Host** is the security kernel. It owns the token, the allowlist, the
confirm-gates, and which profile may be launched or attached.

Cross-platform means all of this on **macOS, Windows, Linux**, against
**Google Chrome and Microsoft Edge** (both Chromium, both CDP, both have
your profiles). Firefox is not a day-one CDP peer; do not pretend.

### What “externally I cannot control it” means

| Caller | Allowed |
|---|---|
| Tyto SDK on localhost with session token | Yes — full CDP |
| Tyto extension via native host | Yes — only as the host’s hands |
| Perch UI (same origin as host) | Yes — paste / interrupt, not raw CDP from the page |
| JavaScript on example.com | **No** |
| Another extension | **No** |
| Bind debug port on `0.0.0.0` | **No** — `127.0.0.1` only |
| Cloud “drive my home Chrome” | **No** unless you later add explicit remote auth |

The page is data. The SDK is the steering wheel. Mixing those is how
extension agents get prompt-injected into sending money.

### Profiles (Chrome and Edge)

You need *your* logins. Discover profiles from each browser’s user-data
directory (`Default`, `Profile N`, Edge’s named profiles). You **choose**
which profile LAUNCH or ATTACH uses.

Do not silently mount the profile that holds TEA, Azure, or bank sessions
for an unattended agent. Explicit pick + allowlist. Prefer a **clone** for
LAUNCH so Chrome/Edge can stay open on the original. ATTACH uses the live
profile and therefore inherits every cookie in it — that is the point, and
the risk.

---

## Loop (unchanged in spirit, stricter on time)

```
observe tape (console, nav, exceptions, DOM inject)     always on
        │
        ▼
classify: static | shell | injected
        │
        ▼
BROWSE   AX tree + refs     (skip if the last snapshot still binds)
        │
        ▼
THINK    model, rare        paste-goal → plan + durable recipes
        │                   (role + name + landmark — never cache node ids)
        ▼
ACT      trusted input      you may interrupt
        │
        ▼
WAIT     tape + injected-HTML ready     not sleep, not screenshot
```

**Perception.** Accessibility tree: role, name, state, visibility-filtered.
Order of magnitude cheaper than DOM or screenshots. Refs (`ref_32`) are valid
for one snapshot only.

**Action.** `Input.dispatchMouseEvent` / `insertText` over CDP. JS
`element.click()` is `isTrusted: false` — fine for some SPAs, forbidden as the
only path (file pickers, some submits, bot flags).

**Dynamic HTML.** `DOMContentLoaded` means the *file* parsed. Many sites then
write the real page (`#root`, hydration, `innerHTML`). Wait on mutation + AX
growth. If it is still a shell, **do not let the model invent the answer**.

**Observability.** Console, navigation, JS exceptions, network failures — the
same tape a native pro glances at in DevTools. That tape is how we wait and
how we know we failed, without photographing the screen.

---

## Components

**`tyto` host** — native, cross-platform. Launch or attach, token, allowlist,
prompt sessions on disk. The kernel.

**`tyto` SDK** — the only supported way to drive the host from the outside
(TypeScript first, MCP as a thin adapter, Python when needed). Full
automation surface: tabs, frames, AX snapshot, trusted input, tape, ready.

**`tyto` extension** — Chrome + Edge. Auto debug-attach for 100% CDP in
ATTACH mode. Native messaging only. Not a Store-shaped product that lives
without the host.

**`perch`** — one *view* of the prompt session. If Perch crashes, the
session file is still on disk. Not the source of truth.

**`tyto` identity vault** — host-owned kernel service. Identify, capture,
preserve, restore, and forget browser-scoped auth per allowed origin.
Encrypted at rest. Never a Perch or MCP surface. The session references a
handle; Perch and MCP see only an auth status per origin.

Models: **the app does not know about LiteLLM.** Settings are base URL + API
key + discover via `GET /v1/models`. Typed model id always works.

---

## Security (non-negotiable)

CDP actions look like a real user. Nothing downstream will save you.

- SDK and debug port: **localhost + token.** Never the public internet.
- The page cannot call the SDK. Treat page text as **data** (prompt injection).
- Extension has no “accept commands from `window`.”
- Profile is an explicit choice. Default Tyto profile is empty; Chrome/Edge
  profiles are opt-in.
- Confirm on submit / purchase / delete / send.
- Domain allowlist, default-deny, until you widen it.

---

## Build order (for this product)

**Phase 1 — feel it.** Host + SDK + prompt session on disk. LAUNCH Chrome or
Edge (mac first, same code for win/linux). AX loop, interrupt, Perch paste.
Kill Perch mid-run and resume from the file.

**Phase 2 — ATTACH.** Extension on Chrome and Edge, auto debugger, native
messaging. Same SDK. Your existing profiles, explicitly picked.

**Phase 3 — Claude Code / MCP** as another SDK client. Same session file.

**Phase 4 — weave + recipe replay.** Yield on real user input.

**Phase 5 — unattended runner.** Exit codes. Not day-one occupancy.

Scholarmancy may later implement `waitReady` / `snapshot` on `IPageDriver`.
That is a port, not a merge.

---

## Known gotchas

- **Shadow DOM** — pierce, or web components are empty to JS (AX still sees
  them).
- **httpOnly cookies** — `document.cookie` cannot read them; use
  `Network.getAllCookies` over CDP. Vault capture must go through the CDP
  path, never through page JS.
- **Token store variety** — OAuth/OIDC tokens live in localStorage,
  sessionStorage, or IndexedDB depending on the SP. Vault capture must
  probe all three. `IndexedDB.requestData` is async; await before encrypt.
- **Short-lived access tokens** — treat any token expiring in < 10 minutes
  as `expiring`. Refresh via a silent token endpoint if available (check
  for a refresh token in the bundle); else prompt re-auth.
- **Never log auth material** — `Set-Cookie`, `Authorization`, and
  `X-Auth-Token` response/request headers must be stripped from tape
  before storage. `Redactor` runs on every tape event, not just on model
  calls.
- **Cross-origin iframes / hosted apps** — Workday-class: the portal is
  one origin, the tenant is an OOPIF. Auto-attach or the snapshot is the
  empty parent chrome. Allowlist each origin; never auto-grant an iframe.
  Recipes key off **frame origin**. Clicks use that target’s box model.
- **Stale refs** — never reuse `backendNodeId` across steps.
- **Coordinate drift** — `getBoxModel` immediately before click.
- **Shell vs page** — classify; wait for inject; fail closed on extract.

---

## Name

`tyto` — barn owl genus. Noctusoft nocturnal line (Noctus Explorer). Short
enough for a CLI and a sidebar.

Check npm, PyPI, and the GitHub org before a logo.

Alternates: Talon (action only), Strix, Parliament (multi-agent story).
Ruled out: Lumen (vision-first agent already).

---

## One-line test

If a native power user would rather screenshot-agent the tab than paste into
Perch, the product is not done. If they paste, glance, and type into the same
field without waiting on a photograph — that is Tyto. If they quit Chrome
and cannot open the same prompt and continue — that is not Tyto.
