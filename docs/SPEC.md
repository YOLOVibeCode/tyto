# Tyto — Product specification

Noctusoft, Inc.  
Status: draft 1 (companion to [`DESIGN.md`](./DESIGN.md))  
Implementation: [`IMPLEMENTATION.md`](./IMPLEMENTATION.md) — TDD + ISP engineering contract  
How to run a clone: [`USAGE.md`](./USAGE.md)  
Audience: anyone building, reviewing, or deciding whether to use Tyto

Tyto is a **separate product**. It is not a Scholarmancy feature, not a
generic “AI Chrome extension,” and not a vision-based computer-use agent.

---

## 1. What it is

Tyto is an **AI-first browser control system**. You drive the web in prose
(a pasted goal, a conversation) the way you drive Claude Code — except the
hands are on a real Chrome or Edge window, reading the page as a **document**
(accessibility tree), not as a **screenshot**.

Three properties are load-bearing:

1. **Prompt-native.** The durable object is the prompt session (goal, plan,
   conversation, recipes, answers, last URL). Perch, Claude Code, and the
   browser are views and hands. Kill the sidebar or the tab: the work remains.
2. **Native occupancy.** You and the agent share the browser. You click and
   type at any time. It yields and re-reads. No screenshot lag. No “possessed
   tab” that you cannot touch.
3. **Full control, closed exterior.** Internally, Tyto has 100% CDP (every
   DevTools-class capability needed to operate a page). Externally — the page,
   other extensions, the public internet — **cannot** issue those commands.
   The only door is a **local SDK** (token on `127.0.0.1`).
4. **If you can use it, Tyto can use it.** Anything you can reach and operate
   in that Chrome/Edge profile — top-level page, iframe/OOPIF, DHTML, JS-
   injected SPA, shadow tree, popup, or a host that reverse-proxies / injects
   another app — Tyto must be able to perceive and act on **the same
   document**, programmatically, with trusted input. Delivery mechanism is
   not a special case. If your hands work and Tyto’s do not, that is a bug.
5. **Identity continuity.** Staying logged in is part of “using” a site.
   The browser profile contains the session; the vault makes it durable.
   Runs survive restarts; re-auth is silent where the IdP session is warm.
   Auth material is encrypted, per-origin, and never reaches the model.

Hunt in the dark: the owl hears the tree, it does not photograph the field.

---

## 2. Who it is for

| Actor | Role |
|---|---|
| **Operator** | You. Paste goals, interrupt, take the keyboard, pick a Chrome/Edge profile, confirm destructive actions. |
| **Host** | Native Tyto process on the machine (macOS, Windows, Linux). Kernel: sessions, token, allowlist, launch/attach. |
| **SDK client** | Perch, Claude Code (MCP), scripts, later other local apps. Speaks only to the host. |
| **Browser** | Google Chrome or Microsoft Edge. Launch (Tyto spawns it) or Attach (extension + auto debugger on a running browser). |
| **Model** | Any OpenAI-compatible (or Anthropic) endpoint you configure. Tyto does not hardcode a vendor or LiteLLM. |

Not an actor: JavaScript on a website, a remote SaaS “drive my Chrome,”
another browser extension.

---

## 3. Proper use cases

These are in-scope. If a request is not on this list, it is not why Tyto
exists — even if the engine could be abused to do it.

### 3.1 Interactive operator (primary)

You are in the browser, working. You paste a goal. Tyto plans once, acts
with trusted input, waits on real page signals (navigation, injected HTML),
and stays out of your way when you type.

Examples:

- Research: “Open the barn owl article and extract conservation status.”
- Ops: “Go to this invoice page and download the CSV.”
- Forms: “Fill this form from the notes in the prompt; stop before Submit.”
- Weave: you fill the name and address; Tyto does the rest of the wizard.
- Resume: you quit Edge, open Tyto, same prompt, continue from last URL.

Success looks like a native power user: seconds of thinking, milliseconds of
clicking, no photograph of the screen per step.

### 3.2 Claude Code as a second pair of hands

Same session document. You paste in the terminal or in Perch. One host, one
Chrome/Edge, one file. Losing the MCP connection does not delete the prompt.

### 3.3 Repeatable local recipes

After a successful run, the session stores **recipes** (role + accessible
name + landmark), not CDP node ids. Next time the same origin appears, Tyto
replays without calling the model. That is how it becomes faster than you.

### 3.4 Authenticated work in *your* profiles (explicit)

You pick a Chrome or Edge profile (e.g. work vs personal). Launch clones or
opens it with a debug port; Attach uses the live browser via the extension.
You stay logged into the sites that profile already has — **because you
opted into that profile**, not because Tyto scraped your OS silently.

Proper: “Use Edge profile Ambient for this session.”  
Improper: unattended agent on the profile that holds payroll, TEA, or bank
cookies with a wide allowlist and no confirm-gates.

### 3.5 Static vs dynamic pages

- **Static HTML** (old sites, Wayback identity captures, server-rendered
  articles): classify `static`, snapshot AX, extract. No inject wait.
- **Injected HTML** (React shells, `#root`, hydration): wait until the tree
  grows; if it stays a shell, **fail closed** — do not invent data.

### 3.6 Observability while operating

Console, exceptions, navigations, failed scripts — a DevTools-class tape so
you (and the planner) know whether the page moved, without a screenshot.
Broken 2008 Wikipedia JS on Wayback is noise; a `TypeError` after your click
is signal.

### 3.7 Unattended local runs (secondary, later)

A saved session/recipe with exit codes, domain allowlist, and confirm policy
(fail or skip destructive steps). CI-style on a machine you own. Not a
cloud browser farm in v1.

### 3.8 Whatever you can reach (iframe, DHTML, inject, proxy)

Workday-on-a-portal is one instance of a general rule: **human-reachable
in this profile ⇒ Tyto-reachable through the SDK.**

The document may arrive as:

| How it shows up | What Tyto does |
|---|---|
| Top-level navigation | `goto` / you type the URL; snapshot that target |
| iframe / OOPIF | Auto-attach; focus the working frame; click in **that** session |
| DHTML / `innerHTML` / hydrate / CSR | Classify shell vs injected; `waitReady` on **that frame**; fail closed if still empty |
| Shadow DOM / web components | Pierce; AX is truth, not `page.evaluate` of light DOM |
| Popup / new tab (SSO, print) | Related targets; yield for MFA; then operate the app target |
| Reverse proxy / vanity host / injected proxy | Still one or more Chromium documents. Same ports. No “proxy driver.” |

There is no Workday package, no DHTML package, no proxy package. There is
`FrameGraph` + `Readiness` + trusted `Actuation` on whatever target you
could have used yourself.

Limits that still apply: allowlist (you grant origins), confirm-gates,
page text is data, no screenshot loop unless the thing is actually
pictorial (canvas/WebGL). “I can see it” includes those — pictorial
fallback is the exception, not the default.

### 3.9 Identity continuity (browser-scoped)

You can use any authenticated site in your profile. Tyto can too — and
it must stay logged in across restarts so the prompt-native promise is real
on authenticated sites.

The vault identifies how each allowed origin authenticates, captures the
browser-scoped session material, caches it encrypted at rest, and restores
it silently when the session resumes.

**Auth methods Tyto identifies and preserves:**

| Method | What is captured | How re-auth works |
|---|---|---|
| Cookie session | `Set-Cookie` sessions (incl. httpOnly, via CDP) | Re-inject cookies before `goto` |
| OAuth / OIDC bearer | Token in localStorage / sessionStorage / IndexedDB | Re-inject; refresh if expiring |
| SAML SSO chain | SP + IdP session cookies | Warm IdP session first; SP auto-redirects |
| Negotiate / Kerberos / IWA | Nothing captured — handled by the real profile | Ensure LAUNCH flags allow IWA; yield for MFA |

**Rules:**

- Per-origin grant, default-deny. Discovering an origin through the frame
  graph does not grant it vault access.
- Confirm-gate on first capture of any origin and on restore of sensitive
  origins (payment, HR, identity provider).
- Expiry-aware: detect dead or expiring bundles and prompt the operator for
  re-auth rather than replaying a session that will 401.
- ATTACH mode already inherits the live profile's cookies. Vault capture
  there is observation, not escalation — but the consent notice still applies.
- Auth material is **never** in the session JSON, never in the tape, never
  in a model prompt, never in git. The session references a vault handle.
- The vault's data-encryption key is stored in the OS keychain, not on disk.

**Improper:** unattended vault restore on payroll/HR with no confirm-gates
and a wide grant. Shared-machine vault without a host authentication layer.

---

## 4. Out of scope (do not build these as Tyto)

| Not Tyto | Why |
|---|---|
| Vision-first computer use (screenshot every step) | That is the latency we exist to kill. Pictorial fallback only for canvas/WebGL/image-only. |
| Consumer AI browser (Comet/Neon) | We do not replace Chrome/Edge; we occupy them. |
| Chrome Web Store extension that works *without* the host | Then the page or the store sandbox owns you. Extension is a hand of the host. |
| Remote “drive my home browser from the cloud” | Exterior stays local unless a later spec adds explicit remote auth. |
| Scholarmancy LMS sync product | Sibling; may borrow `waitReady` / `snapshot`. Different customer. |
| Firefox as a first-class CDP peer | Chromium CDP is the contract. |
| Stealth / anti-detect browser for abuse | Trusted input exists so *real* UI works (file pickers), not to evade banks. |
| Unattended purchasing, wire transfers, production deploys | Confirm-gates; human-in-loop. |
| Treating page text as instructions | Prompt injection. |
| OS credential-store / Kerberos TGT extraction | Out of scope. Negotiate/IWA is handled by operating the real profile; no ticket harvesting. |
| Identity export to non-browser clients | Auth material stays inside the browser boundary. The SDK does not hand cookies to scripts. |
| Impersonation / delegated identity | Acting as a different principal. Not built. A future design would require separate authorization architecture. |
| Shared vault across multiple operator accounts | One vault per operator-machine pair; no multi-tenant credential store in v1. |

---

## 5. Functional specification

### 5.1 Prompt session (source of truth)

A session is a document on disk (host-managed), not memory in an extension.

Must persist:

- Goal and full conversation
- Plan: steps completed vs remaining
- Recipes / anchors (role, name, landmark, origin, route pattern)
- Extracts / answers
- Last URL and tab intent
- Model settings used (provider id + model id, not the raw key)
- Allowlist and confirm policy for that session

Must not persist:

- `ref_N`, `backendNodeId`, click coordinates
- Live CDP sockets, extension ports
- Screenshots (except optional operator-debug attachments)

Resume: open session → launch/attach → `goto` last URL → BROWSE → bind
remaining recipes → continue.

### 5.2 Control modes

**LAUNCH.** Host starts Chrome or Edge with a chosen `user-data-dir` and
`--remote-debugging-port` bound to `127.0.0.1`. Full CDP. Prefer profile
clone so the user’s daily Chrome can stay open.

**ATTACH.** Tyto extension in running Chrome/Edge. Auto-enables the debugger
on the target tab (100% CDP). Speaks to the host **only** via native
messaging. Debugger banner is accepted in this mode as the cost of occupying
a live everyday profile.

Both modes expose the **same SDK**. The operator does not learn two APIs.

### 5.3 SDK (only exterior)

The SDK is the only supported way to drive Tyto from “outside” the host:

- TypeScript first
- MCP as a thin adapter for Claude Code
- Python later if needed

Capabilities (logical; not a screenshot API):

- List/select Chrome and Edge profiles
- Launch / attach / disconnect
- Tabs, frames, OOPIFs (auto-attach; snapshot and act **per frame origin**)
- Discover cross-origin frames; **do not** auto-grant them
- `classify` / `waitReady` (static vs shell vs injected) **per frame**
- `snapshot` (compact AX + ephemeral refs)
- `act` (trusted click/type/keys)
- `extract` (AX first, JS read, model only if the tree actually contains the field)
- Tape: console, nav, exceptions, network errors, DOM inject events
- Interrupt / yield to operator
- Read/write prompt session

The SDK authenticates with a **host token**. It does not listen on a public
interface.

### 5.4 Perception and action

| Step | Behavior |
|---|---|
| Observe | CDP events always on. Debugger *stepping* off unless inspecting a failure. |
| Classify | `static` / `shell` / `injected` from HTML+AX+main text, not from `load` alone. |
| Browse | Compact AX **per focused frame**; refs valid for this snapshot only. |
| Think | Model, rare. Emits recipes, not node ids. |
| Act | Trusted `Input` by default. JS click is degraded mode. |
| Wait | Nav, lifecycle, mutation/AX growth — not `sleep(250)`. |
| Extract | Fail closed if still a shell. |

Screenshots: only if the chosen node (or page) has no useful AX.

### 5.5 Weave (operator occupancy)

- Any real key/mouse from the operator pauses agent dispatch.
- Esc / Stop aborts the current act and drops ephemeral refs.
- Operator-edited fields are truth; the next BROWSE sees them.
- Agent never clicks “on top of” the operator.

### 5.6 Models

- Configure `baseUrl` + API key + model id.
- Discover via `GET /v1/models` when the endpoint supports it.
- Manual model id always works.
- No LiteLLM-specific code paths. A LiteLLM proxy is just another URL.

### 5.7 Perch

Sidebar view of the prompt session: paste, stream, show next recipe,
interrupt. If Perch dies, the session file does not. Perch is not allowed to
forward page JS into the SDK as commands.

**LAUNCH** opens Perch as a tab in the launched Chrome (`browser.openSteer` →
`Target.createTarget` on the loopback host URL). **Go** still navigates the
work tab. The OS default browser is not the start path (`TYTO_STEER=os` to
opt in). LAUNCH also `--load-extension`s the MV3 unpacked dir and registers
a native messaging host so the side panel can seed the loopback token without
paste. ATTACH to a daily profile still needs an explicit profile pick.

### 5.8 Identity vault

The vault is a host-owned kernel service. Perch and MCP see only the status
method (is an origin authenticated, fresh or expiring). They never receive
raw cookies, tokens, or vault handles that could be forwarded.

**Lifecycle:**

1. **Identify** — `AuthProfiler` classifies each allowed origin:
   `cookieSession | oauthBearer | samlSso | oidc | negotiateIWA | clientCert | unknown`.
   Classification is from observed network events and storage (no heuristic
   page-text analysis). The profile is stored in the session doc as metadata,
   not as a secret.

2. **Capture** — operator confirms (once per origin). `CredentialStorePort`
   reads cookies via `Network.getAllCookies` (catches httpOnly), reads token
   stores via `Storage.getDOMStorageItems` / `IndexedDB.requestData`. Bundles
   are AES-GCM encrypted; the DEK lives in the OS keychain.

3. **Preserve** — `IdentityBundle` on disk: ciphertext + origin + auth method
   + expiry hint + IdP dependency list. No plaintext. No cookies in the session
   JSON or in any log.

4. **Restore** — on session resume, vault decrypts and re-injects: cookies via
   `Network.setCookies`, storage via `Storage.setDOMStorageItem`. For SSO
   chains the IdP origin is restored first. For Negotiate/IWA origins, ensure
   LAUNCH flags (`--auth-server-allowlist`) permit the host, then `goto`.

5. **Expiry / rotation** — `auth/expiry` checks bundle age vs expiry hint.
   `expiring` → proactive re-capture prompt. `expired` → yield to operator,
   do not proceed until re-authed. Do not replay a dead session at a 401.

6. **Forget** — explicit operator command. Deletes ciphertext and removes DEK
   reference in keychain. Does not log what was deleted.

**Redaction:** `Redactor` strips all cookie header shapes, bearer-token
shapes, and active vault values from any string before it goes to tape or
to `ModelPort`. The model never learns the auth material and cannot be
prompted to reveal it.

---

## 6. Security specification

CDP input is indistinguishable from a human. Policy lives in the host.

| Rule | Requirement |
|---|---|
| Bind | Debug port and SDK: `127.0.0.1` only |
| Auth | Host token required for SDK |
| Page | No command channel from document JS |
| Extension | Native messaging to host only; no `window` API for control |
| Profile | Explicit pick; empty Tyto profile is default |
| Allowlist | Default-deny **origins**. Grant portal, tenant, and IdP separately. Iframe discovery never auto-grants. |
| Frames | Auto-attach OOPIFs. Act only in an allowed, attached frame. Parent shell is not a substitute for the child tree. |
| Destructive | Confirm submit / purchase / delete / send |
| Injection | Page content is data, never instructions |
| Secrets | API keys in host/OS keychain, never in the page, never in git |
| Auth material | Vault ciphertext on disk; DEK in OS keychain; never in session JSON, tape, model prompt, or git |
| Identity grant | Default-deny per origin. Explicit operator confirm on first capture and on sensitive-origin restore. |
| Expiry | Detect and prompt. Never silently replay an expired bundle. |
| Redaction | `Redactor` strips cookies and tokens from all tape and model inputs. |

ATTACH on a live profile **inherits that profile’s cookies**. The UI must
say so before connect. The vault consent notice is required even in ATTACH
mode before any capture occurs.

---

## 7. Platforms

| | v1 |
|---|---|
| OS | macOS, Windows, Linux |
| Browsers | Google Chrome, Microsoft Edge (Chromium, CDP) |
| Clients | SDK, Perch, MCP |
| Not v1 | Firefox, Safari, remote hosted browsers |

---

## 8. Quality bars (when it is “Tyto”)

- Paste-to-first-trusted-click is obviously faster than a screenshot agent
  on a normal HTML page.
- Closing Perch or disconnecting MCP does not lose the prompt session.
- A static Wayback article classifies `static` and extracts from AX without
  a model inventing facts.
- A CSR shell either becomes `injected` with real content or extract **blocks**.
- A portal that embeds Workday (or any tenant) in a cross-origin iframe:
  Tyto attaches the child, snapshots **that** origin, and does not treat
  the parent chrome as the app.
- A site cannot `postMessage` Tyto into navigating or submitting.
- Operator can type in the same field the agent was about to fill.
- The agent resumes on an authenticated site after a browser restart without
  the operator re-typing a password — and the model conversation contains no
  cookie, token, or credential value.

---

## 9. Build order

1. Host + SDK + disk sessions + LAUNCH (Chrome/Edge) + loop + Perch paste + interrupt.
2. ATTACH: extension, auto debugger, native messaging, profile picker.
3. MCP client on the same session file.
4. Weave + recipe replay.
5. Unattended runner with exit codes.

Proof points already exercised in-repo (`poc/`): AX loop, tape, inject-wait,
fail-closed extract, Wayback 2008 static success. Those are engine spikes,
not the product UI.

---

## 10. One-line tests

- If a power user would rather use a vision agent than paste into Perch,
  Tyto is not done.
- If they quit the browser and cannot reopen the **same prompt** and
  continue, Tyto is not done.
- If a website can drive the SDK, Tyto is not done.
- If they cannot operate whatever they can operate by hand in that
  profile (iframe, DHTML, injected app, proxied host), Tyto is not done.
- If they quit the browser and the model transcript from the resumed run
  contains a cookie or token value, Tyto is not done.
- If an origin gets vault access without an explicit operator grant,
  Tyto is not done.
