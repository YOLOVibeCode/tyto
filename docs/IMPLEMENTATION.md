# Tyto — Implementation plan (TDD + ISP)

Noctusoft, Inc.  
Companion to [`SPEC.md`](./SPEC.md) and [`DESIGN.md`](./DESIGN.md)  
Operator start path: [`USAGE.md`](./USAGE.md)  
Status: draft 1 — this is the engineering contract

This plan is how we build the spec without growing a god object or a
Playwright script with a chat box glued on. **Tests define behavior. Ports
define ownership. Adapters are replaceable.** The POC in `poc/` is a spike:
harvest algorithms from it, do not promote it.

---

## 0. Laws (non-negotiable)

### TDD

1. A failing test exists before production code for that behavior.
2. Red → green → refactor. No “write the adapter then sprinkle tests.”
3. Default CI (`npm test`) is **pure**: no Chrome, no network, no model
   keys. Green on a laptop in airplane mode.
4. Live Chrome tests are opt-in (`TYTO_LIVE=1`). They never gate the core.
5. If a test needs Playwright, Chrome, or `fetch`, it does not live in
   `@tyto/core`.

### ISP (Interface Segregation)

1. No `IBrowser` / `ITyto` with twenty methods. A client depends only on
   the port it calls.
2. Perch and MCP **must not** see `RawCdpPort`. Power scripts may.
3. Domain (`@tyto/core`) depends on **port types only**. Zero imports of
   Node `child_process`, CDP, Playwright, `chrome.debugger`, or HTTP
   vendors.
4. Adding a CDP method is not a reason to widen every interface. Add it to
   the smallest port that needs it, or to `RawCdpPort` behind the host
   policy gate.
5. A port that is hard to fake is the wrong port. The fake is the second
   customer.

### Control plane (from the spec)

- SDK / debug: `127.0.0.1` + token only.
- Page JS is data, never a command channel.
- Default-deny allowlist. Explicit profile. Confirm on destructive acts.
- Prompt session on disk is source of truth.
- **Human-reachable ⇒ Tyto-reachable.** iframe, DHTML, inject, proxy,
  OOPIF, popup: same ports. Delivery is not a special driver. If the
  operator can operate it in the attached profile and the loop cannot,
  the test is missing or the adapter is wrong.

---

## 1. Locked decisions

| Decision | Choice | Why |
|---|---|---|
| Core language | TypeScript (strict) | One language for TDD, SDK, MCP, fakes |
| Host v1 | Node process (same TS), packaged later | Native messaging can target this binary; rewrite the host in Rust only if packaging/signing forces it |
| Test runner | Vitest | Fast, ESM, matches `type: module` |
| CDP in production | Thin WebSocket client we own (`@tyto/cdp`). **Not Playwright** | Playwright is POC glue. Product owns the socket and the arg list |
| Models | `ModelPort` = OpenAI-compatible HTTP adapter + Anthropic adapter. No LiteLLM types | Spec: a proxy is just a URL |
| Session store | JSON documents on disk (`@tyto/fs`) | Prompt-native; trivial to test with a temp dir |
| SDK wire | JSON-RPC 2.0 over TCP `127.0.0.1` + bearer token | Same methods for SDK, Perch, MCP adapter |
| Perch v1 | Local UI that is an SDK client (side panel later) | Session file outlives the UI |
| Extension | MV3, Chrome + Edge, native messaging only | ATTACH mode; no `window` command API |
| Monorepo | npm workspaces | ISP at package boundaries |

Playwright may remain in `poc/` until the first live adapter is green. It
must not appear in `packages/core` or in default CI.

---

## 2. Package map (dependency direction)

```
@tyto/sdk  ──┐
@tyto/mcp  ──┼──►  @tyto/protocol  (JSON-RPC types only)
@tyto/perch ─┘         │
                       ▼
                  @tyto/host  ──wires──►  adapters
                       │
                       ▼
                  @tyto/core  ◄── ports (types) + domain
                       ▲
         fakes in core/testing; adapters implement ports

@tyto/cdp     implements Perception, Actuation, Observation,
              Readiness, Navigation, Targets, Occupancy, RawCdp
@tyto/llm     implements ModelPort
@tyto/fs      implements SessionStore, RecipeArchive
@tyto/secrets implements SecretStore (OS keychain; memory fake in tests)
              IdentityVault (encryption layer + DEK via SecretStore)
@tyto/cdp     also implements CredentialStorePort
extension/    native-messaging peer of host (not imported by core)
```

**Forbidden imports**

| From | Must not import |
|---|---|
| `@tyto/core` | cdp, llm, fs, host, playwright, `node:http` as a server |
| `@tyto/sdk` | cdp, chrome, extension |
| `@tyto/mcp` | cdp, RawCdp method names, CredentialStorePort |
| Perch / MCP surfaces | VaultHandle, RawCookie, RawStorageItems |
| `@tyto/perch` | cdp |
| adapters | each other, except host composition root |

The **composition root** is `packages/host/src/main.ts` only.

---

## 3. ISP port catalog

Each port is a TypeScript interface in `@tyto/core/ports`. One file per
port. No “utils” barrel that re-exports a god type.

### 3.1 Session and memory

```ts
// SessionStore — Perch, host resume, MCP, runner
interface SessionStore {
  load(id: SessionId): Promise<Session | null>;
  save(session: Session): Promise<void>;
  list(): Promise<SessionSummary[]>;
}

// RecipeArchive — loop + replay; never stores node ids
interface RecipeArchive {
  remember(origin: Origin, recipe: Recipe): void;
  lookup(origin: Origin, role: string, name: string): Recipe | null;
}

// Clock — wait budgets in tests
interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}
```

`Session` JSON **must** include: goal, messages, plan, recipes, answers,
last URL, allowlist, model settings (id + base URL, not the key).
`Session` JSON **must not** include: `ref_N`, `backendNodeId`, boxes,
sockets, screenshots.

### 3.2 Policy (kernel)

```ts
interface Allowlist {
  permits(url: URL): boolean;
  grant(origin: Origin): void; // session-scoped
}

interface ConfirmGate {
  mustConfirm(intent: Intent): ConfirmReason | null;
}

interface ProfileGuard {
  defaultProfile(): ProfileRef;           // empty Tyto profile
  assertExplicitPick(picked: ProfileRef): void;
}

interface InjectionGuard {
  wrapPageText(text: string): UntrustedDocument; // never concatenated into system as instructions
}
```

Clients: `Actuation` callers need Allowlist + ConfirmGate.
`Extract` needs InjectionGuard, not ConfirmGate.
`Launch` needs ProfileGuard, not Actuation.

### 3.3 Page capabilities (segregated)

```ts
interface Perception {
  snapshot(target: FrameRef): Promise<AxSnapshot>;
}

interface Actuation {
  perform(intent: TrustedIntent): Promise<void>;
}

interface Observation {
  subscribe(fn: (e: TapeEvent) => void): Unsubscribe;
  recent(n: number): TapeEvent[];
}

interface Readiness {
  classify(): Promise<DocStats>;          // static | shell | injected
  waitReady(budget: Ms): Promise<DocStats>;
}

interface Navigation {
  goto(url: URL): Promise<void>;          // host applies allowlist first
  currentUrl(): Promise<URL>;
}

interface FrameGraph {
  list(tab: TabId): Promise<FrameNode[]>;
  focus(frame: FrameRef): void;           // subsequent snapshot/act/waitReady
  autoAttachChildTargets(on: boolean): Promise<void>;
}

interface RelatedTargets {
  pages(): Promise<Tab[]>;                // SSO popups, Workday print windows
}

interface Occupancy {
  operatorActive(): boolean;
  interrupt(): void;                      // Esc / Stop
  onOperatorInput(fn: () => void): Unsubscribe;
}

interface Extractor {
  fromAx(snap: AxSnapshot, query: string): ExtractResult;
  // JS read is a degraded path on a different port:
}

interface JsReader {
  evaluateJson<T>(expression: string): Promise<T | null>;
}

interface RawCdpPort {                    // host + power scripts only
  send(method: string, params?: object): Promise<unknown>;
}
```

`TrustedIntent` is `{ op: "click" | "fill" | "press" | "insertText", node: BackendNodeId, ... }`
produced **after** bind. Domain bind is pure: snapshot + recipe → node id
or miss. Actuation never searches the tree.

`JsReader` is **not** the click path. Tests assert `Actuation.perform`
never calls `JsReader` for `click`.

`FrameNode` is `{ ref, origin, parent?, attached, reasonEmpty? }`.
`Perception.snapshot`, `Readiness`, `Actuation.perform`, and `JsReader`
all operate on the **focused** frame after `FrameGraph.focus`. Box models
are in that target’s coordinate space. Clicking with the parent’s CDP
session at iframe CSS coordinates is a bug — tests must catch it.

**Working document (pure).** `pickWorkingDocument(frames: FrameSnap[]): FrameRef`
chooses the allowed frame whose tree is the app, not the chrome:

- drop frames whose origin is not allowlisted
- drop attached-but-empty (OOPIF not yet attached → `reasonEmpty`)
- prefer origin that already has recipes
- else prefer the largest non-shell AX
- never prefer a cookie-banner / recaptcha frame over a tenant with
  application landmarks

Workday-class fake: parent `https://hr.example.edu` is a shell; child
`https://wd5.myworkday.com` is injected. Pick the child. If the child
origin is not granted, pick nothing and emit `frame.discovered` — do
**not** act, do **not** auto-grant.

### 3.4 Connection

```ts
interface Launcher {
  launch(opts: LaunchOpts): Promise<BrowserHandle>;
}

interface Attacher {
  attach(opts: AttachOpts): Promise<BrowserHandle>;
}

interface BrowserHandle {
  disconnect(): Promise<void>;
}

interface ProfileCatalog {
  list(browser: "chrome" | "edge"): Promise<ProfileRef[]>;
}

interface BindPolicy {
  assertLoopback(host: string): void;     // reject 0.0.0.0
}
```

`BrowserHandle` is **not** a capability port. Host unwraps it into the
page ports. SDK clients never receive a raw handle.

### 3.5 Model

```ts
interface ModelPort {
  complete(req: CompleteRequest): Promise<CompleteResponse>;
}

interface ModelCatalog {
  list(baseUrl: URL, apiKey: SecretRef): Promise<ModelId[]>;
}
```

`CompleteRequest` carries `UntrustedDocument` for page text plus a
**fixed** system preamble owned by core. Adapters must not prepend vendor
“helpful assistant clicks buttons” prompts that bypass InjectionGuard.

No `LiteLLM` symbol anywhere in the repo except a comment in the spec.

### 3.6 Operator / HITL

```ts
interface Operator {
  confirm(reason: ConfirmReason, intent: Intent): Promise<boolean>;
  pasteGoal(text: string): void;          // used by Perch via session, not this port
}
```

Perch writes the session and calls `operator.interrupt` / `confirm` through
the host RPC. It does not implement Occupancy; the host does.

### 3.7 Identity vault

```ts
// AuthProfiler — classify how a frame's origin authenticates.
// Pure over recorded evidence from CredentialStorePort; no live Chrome call.
interface AuthProfiler {
  identify(evidence: AuthEvidence): AuthProfile;
}
// AuthProfile = { method: AuthMethod, idpOrigin?: Origin, expiryHint?: Date }
// AuthMethod = "cookieSession" | "oauthBearer" | "samlSso" | "oidc"
//            | "negotiateIWA" | "clientCert" | "unknown"

// IdentityVault — kernel service; returns handles, never plaintext.
interface IdentityVault {
  capture(origin: Origin): Promise<VaultHandle>;     // confirm-gated
  restore(origin: Origin): Promise<void>;            // re-injects into browser
  status(origin: Origin): Promise<BundleStatus>;     // fresh | expiring | expired | none
  forget(origin: Origin): Promise<void>;             // deletes ciphertext + DEK ref
}
// BundleStatus visible to Perch/MCP. VaultHandle is opaque, host-internal only.

// CredentialStorePort — adapter boundary; the only thing that touches raw
// secrets. Implemented in @tyto/cdp. Faked in @tyto/core tests.
interface CredentialStorePort {
  readCookies(origin: Origin): Promise<RawCookie[]>;           // Network.getAllCookies
  writeCookies(origin: Origin, cookies: RawCookie[]): Promise<void>; // Network.setCookies
  readStorage(origin: Origin): Promise<RawStorageItems>;       // DOM + IndexedDB
  writeStorage(origin: Origin, items: RawStorageItems): Promise<void>;
  clearCookies(origin: Origin): Promise<void>;
}
// RawCookie / RawStorageItems are opaque to domain; only CredentialStorePort
// and the vault encryption layer see them in plaintext.

// Redactor — pure; strips secret-shaped strings from any outbound value.
interface Redactor {
  tape(event: TapeEvent): TapeEvent;         // strip Set-Cookie / Authorization
  prompt(req: CompleteRequest): CompleteRequest; // strip cookies/tokens from content
  safe(text: string): string;                // general-purpose, for logging
}
```

**ISP rules for vault ports:**

- `IdentityVault.status` is the only vault method on the Perch/MCP surface.
- `CredentialStorePort` is host-internal only; it does not appear in
  `@tyto/protocol` and is never exposed to SDK clients.
- `Redactor` is called by `AgentLoop` before every `ModelPort.complete` and
  before every `Observation.subscribe` push to tape storage.
- `AuthProfiler` is pure and has no network call; the adapter feeds it
  recorded `AuthEvidence` (request headers, storage keys, cookie names).

---

## 4. Domain modules (pure)

These are functions and small services. They take ports in constructors.
They contain the product brain.

| Module | Responsibility | Ports used |
|---|---|---|
| `session/schema` | Zod (or equivalent) parse/serialize | none |
| `recipe/bind` | role+name(+landmark) → unique hit or miss | none (pure on snapshot) |
| `ax/compact` | CDP AX nodes → tree text + ephemeral refs | none |
| `ax/extract` | query against compact tree | none |
| `ready/classify` | stats → `static \| shell \| injected` | none |
| `policy/allow` | URL vs allowlist | none |
| `policy/confirm` | intent → confirm reason | none |
| `policy/inject` | wrap page text | none |
| `plan/coerce` | messy model JSON → `Plan` | none |
| `auth/classify` | `AuthEvidence` → `AuthProfile` | none |
| `auth/expiry` | `IdentityBundle` + clock → `fresh \| expiring \| expired` | Clock |
| `identity/redact` | strip secret shapes from tape / prompt strings | none |
| `loop/AgentLoop` | observe → classify → browse → think? → act → wait | many, injected |
| `loop/state` | legal transitions + interrupt | Occupancy, Clock |
| `frame/pick` | working document among allowed frames | none (pure) |

**Harvest from `poc/` (rewrite behind tests, then delete usage from product):**

- `compactAx`, `bind`, `coerceStep` / `coercePlan`
- `classifyAfter`, shell regex, fail-closed extract
- Tape wait predicates (nav, not sleep)
- Trusted click via box model + `Input.dispatchMouseEvent` (adapter, not domain)

---

## 5. Test layers

```
npm test              → unit + fake loop          < 2s, no Chrome
npm test:contract     → adapters vs fixtures      no live browser
npm test:live         → TYTO_LIVE=1 real Chrome   optional
npm test:security     → bind, token, allowlist    unit + contract
```

Naming: `describe("bind")` / `it("refuses a ref from a previous snapshot")`.
Test names are spec sentences.

Fixtures live in `packages/core/fixtures/` and `packages/cdp/fixtures/`:

| Fixture | Use |
|---|---|
| `ax/wikipedia-search.json` | compact + bind Search |
| `ax/wayback-barn-owl-2008.json` | static extract conservation status, 0 model calls |
| `ax/react-shell.json` | classify shell, extract blocked |
| `ax/react-injected.json` | classify injected after growth |
| `session/roundtrip.json` | no node ids after save |
| `local-state/chrome.json` | profile catalog |
| `rpc/unauthorized.json` | token missing |
| `cdp/input-click.expected.json` | adapter sends Input.*, not evaluate click |

---

## 6. TDD slices (order of work)

Each slice: write tests → fail CI → implement until green → refactor.
Do not start the next slice with a red suite from the previous.

### Slice 0 — repo skeleton (no product behavior)

- npm workspaces, Vitest, `tsc --noEmit` on all packages
- `packages/core` eslint boundary: ban `playwright`, `chrome-remote-interface`
- Empty `npm test` runs 1 sanity test

**Done when:** `npm test` is green with Playwright uninstalled from
product packages.

---

### Slice 1 — session document

**Tests (write first)**

- `saves goal, messages, plan, recipes, lastUrl, allowlist`
- `roundtrip drops ref_N, backendNodeId, box, screenshot if present in input`
- `load missing id returns null`
- `resume payload includes lastUrl and remaining plan steps`
- `model settings persist id + baseUrl and never persist raw apiKey`

**Implement:** `Session` type, schema, `FilesystemSessionStore` behind
`SessionStore`. Tests for store use `os.tmpdir()`. Schema tests use a
memory store fake first, then the fs adapter contract.

---

### Slice 2 — recipes and refs (pure)

**Tests**

- `bind hits unique role+name case-insensitively`
- `bind returns miss when two nodes share role+name`
- `bind never uses backendNodeId from a recipe archive`
- `compact assigns ref_1..n and interactive roles only`
- `a ref from snapshot A is invalid on snapshot B (generation token)`
- `archive.remember then lookup on same origin; different origin misses`

**Implement:** `AxSnapshot` with `generation: number`. `bind(step, snap)`.
`Recipe` = `{ role, name, landmark?, origin, routePattern? }`.

---

### Slice 3 — classify and fail-closed extract (pure)

**Tests**

- `short chrome-shell text + #root marker → shell`
- `Wayback-sized article stats → static`
- `growth past thresholds without shell marker → injected`
- `tiny AX bump (+3 nodes) does not flip shell → injected`
- `extract on shell throws ShellNotReady and does not call ModelPort` (spy)
- `extract conservation status from compact AX of barn owl fixture without ModelPort`
- `page text passed to model is UntrustedDocument; system preamble does not include it as instructions`

**Implement:** move `classifyAfter` / shell regex into `ready/classify.ts`.
`Extractor.fromAx`. Loop extract path checks shape first.

---

### Slice 4 — policy

**Tests**

- `allowlist default-deny: https://evil.test blocked`
- `grant origin then permits path on that origin`
- `iframe discovery does not call Allowlist.grant`
- `act in a child frame whose origin is denied: Actuation spy 0, frame.discovered emitted`
- `goto is rejected before Navigation.goto is invoked` (spy)
- `submit / purchase / delete / send require confirm`
- `click on a link does not require confirm`
- `ProfileGuard throws if launch attempted without explicit pick when catalog is non-empty`
- `BindPolicy rejects 0.0.0.0 and ::`
- `BindPolicy accepts 127.0.0.1`

---

### Slice 5 — plan coerce (pure)

**Tests**

- `schema-shaped plan parses`
- `alternate JSON { action, label } coerces to click`
- `unknown op discarded; empty steps is a failed plan not a throw in adapter`
- `model returning prose with a fenced JSON block still coerces`
- `limit: AgentLoop calls ModelPort at most twice per page generation`

---

### Slice 6 — AgentLoop against fakes (the product, still no Chrome)

Compose **separate fakes** (ISP): `FakePerception`, `FakeActuation`,
`FakeObservation`, `FakeReadiness`, `FakeNavigation`, `FakeOccupancy`,
`FakeModel`. Factory `makeLoopHarness()` for tests only — production
never uses a combined fake type.

**Pages in the fake:** in-memory AX graphs keyed by URL.

**Tests**

- `paste goal on wikipedia-like search: think once, click Search, fill, press Enter`
- `after nav, snapshot generation increments; old refs do not bind`
- `WAIT completes on nav tape event, not on Clock.sleep(250) as the success path`
- `shell page: waitReady then inject; extract succeeds`
- `shell page that never grows: extract blocked; FakeModel.complete call count 0 for extract`
- `operatorActive true: loop does not call Actuation.perform`
- `interrupt mid-act: state Idle, refs dropped`
- `recipe replay: second visit same origin skips ModelPort when bind hits`
- `KILL client (do not save in UI): SessionStore still has plan after loop.stop()`

This slice is **Phase 1 feel-it**, minus real pixels. Do not open Chrome
until this suite is green and the POC scenarios are expressed as fakes.

---

### Slice 6b — hosted app / Workday-class frame graph (still no Chrome)

Fake two origins in one tab. Parent is a portal shell; child is the
tenant SPA. This is the crawl power: **operate the inner document**.

**Tests (write first)**

- `list frames: parent example.edu + child myworkday.com; child starts unattached → reasonEmpty, parent snapshot is chrome-only`
- `autoAttach then child snapshot is the app tree; compact tree labeled # frame https://wd5.myworkday.com`
- `pickWorkingDocument prefers injected tenant over parent shell`
- `pickWorkingDocument returns none if tenant origin not allowlisted`
- `operator grants tenant origin; next pick succeeds; grant is session-scoped`
- `recipe archive keys by child origin; replay works when parent URL is a different portal`
- `trusted click records frameRef of the child, not the parent`
- `waitReady is per-frame: parent static chrome does not satisfy child shell`
- `SPA view change with no top-level nav: tape frame event + AX growth; WAIT succeeds without Page.navigate`
- `virtualized list: scroll intent on focused frame → new rows in next snapshot`
- `SSO popup appears as RelatedTargets page; Occupancy yield until operator marks login done; then Workday frame leaves shell`
- `page postMessage from parent cannot focus or grant the child`

No Workday-specific types in `@tyto/core`. Fixtures are generic
`portal-shell` + `tenant-spa`. Workday is the documented example, not a
package.

---

### Slice 7 — protocol + host kernel

**JSON-RPC methods** (keep aligned with ports, not with CDP):

```
session.open | session.save | session.list
profiles.list
browser.launch | browser.disconnect
page.goto | page.snapshot | page.act | page.waitReady | page.extract
frames.list | frames.focus
tape.recent | tape.wait
operator.interrupt | operator.confirm | operator.grantOrigin
models.complete | models.list
```

`cdp.send` is **not** on the Perch/MCP surface. Optional method
`debug.cdp` behind an explicit host flag, typed as `RawCdpPort`.

**Tests**

- `listen on 127.0.0.1; refuse 0.0.0.0 in config`
- `request without token → error unauthorized`
- `wrong token → unauthorized`
- `page.goto to denied origin → policy error, Navigation spy 0`
- `session.save then new Host process session.open restores goal`
- `disconnect client mid-run does not delete session file`
- `MCP tool list equals Perch-safe methods (no debug.cdp)`

**Implement:** `@tyto/protocol`, `@tyto/host` using Fake* still.
SDK client `@tyto/sdk` talks RPC. Host tests use the SDK against a
real listen socket on an ephemeral loopback port.

---

### Slice 8 — Model adapters

**Tests (contract, nock or MockAgent, no real keys)**

- `GET /v1/models maps to ModelCatalog.list`
- `POST /v1/chat/completions mapped from CompleteRequest`
- `typed model id works when /v1/models is 404`
- `Anthropic adapter maps same CompleteRequest`
- `no symbol LiteLLM in adapter source` (grep test)
- `InjectionGuard wrap appears in user payload, not as system instructions`

---

### Slice 9 — CDP LAUNCH adapter (`@tyto/cdp`)

Still TDD: first **contract tests with recorded CDP JSON** (no process).

**Tests**

- `compactAx(fixture) matches golden tree`
- `trusted click: send DOM.getBoxModel then Input.dispatchMouseEvent down/up`
- `trusted click does not send Runtime.evaluate with .click()`
- `Accessibility.getFullAXTree per frame; missing OOPIF does not throw, logs tape`
- `Target.setAutoAttach flatten=true; child session used for click box model`
- `click in child uses child Input.dispatchMouseEvent, not parent coordinates`
- `Readiness.classify on shell fixture → shell`
- `spawn args include --remote-debugging-address=127.0.0.1`
- `ProfileCatalog reads Local State fixture names without launching`

Then **live** (opt-in):

- `LAUNCH Chrome with empty Tyto profile, goto example.com, snapshot non-empty`
- Wayback barn owl identity URL: `shape=static`, extract status, 0 screenshots

**Implement:** spawn Chrome/Edge ourselves (`which` + known OS paths).
Connect to `/json/version` WebSocket. Do not use `chromium.launch` from
Playwright in this package.

---

### Slice 9b — Identity vault (fakes first, live opt-in)

Placed after Slice 9 because capture requires a real `CredentialStorePort`
against Chrome. All tests below run against fakes in `npm test`.

**Tests (write first)**

- `AuthProfiler.identify: Set-Cookie evidence → cookieSession`
- `AuthProfiler.identify: Authorization Bearer header → oauthBearer`
- `AuthProfiler.identify: SAMLResponse form POST → samlSso`
- `AuthProfiler.identify: Negotiate challenge → negotiateIWA`
- `AuthProfiler.identify: no auth signals → unknown`
- `auth/expiry: bundle within TTL → fresh`
- `auth/expiry: bundle past expiry hint → expired`
- `auth/expiry: bundle within 10m of expiry → expiring`
- `capture: CredentialStorePort.readCookies + readStorage called; ciphertext written; plaintext never on disk`
- `capture: DEK stored via SecretStore (fake keychain); not in the bundle file`
- `capture: not-granted origin → refused; CredentialStorePort spy 0`
- `capture: confirm-gate called once; second capture same origin skips confirm if fresh`
- `restore: decrypt + writeCookies + writeStorage on allowed origin`
- `restore: SSO chain — IdP origin restored before SP origin`
- `restore: expired bundle → Occupancy yield; CredentialStorePort.writeCookies spy 0 until re-authed`
- `restore: negotiateIWA origin → no writeCookies; verify LAUNCH flag set; CredentialStorePort spy 0`
- `forget: ciphertext deleted; SecretStore DEK ref removed; no log of deleted content`
- `status: returns fresh | expiring | expired | none per origin`
- `session JSON after capture contains vault handle, not a cookie value` (extends Slice 1)
- `Redactor.tape: strips Set-Cookie header from tape event`
- `Redactor.tape: strips Authorization Bearer from tape event`
- `Redactor.prompt: CompleteRequest after redaction contains no cookie-shaped string`
- `Redactor.prompt: spy on ModelPort — no call ever receives raw vault content`
- `Redactor.safe: auth-material-shaped string → redacted; plain text unchanged`
- `AgentLoop: Redactor.prompt called before every ModelPort.complete` (spy)

**Live (TYTO_LIVE=1, real Chrome, real keychain):**

- LAUNCH empty Tyto profile; visit a cookie-session test site; capture; quit
  Chrome; relaunch; restore; site returns 200 without re-login
- Verify no cookie or token appears in the tape file after capture

**Implement:** `@tyto/core`: `auth/classify.ts`, `auth/expiry.ts`,
`identity/redact.ts`. `@tyto/secrets`: `IdentityVault` encryption layer.
`@tyto/cdp`: `CredentialStorePort` adapter. Wire `Redactor` into `AgentLoop`
before `ModelPort.complete` and into `Observation.subscribe` tape push.

---

### Slice 10 — Perch as SDK client

**Tests**

- `paste goal writes session then starts loop`
- `kill Perch process; session file intact; second Perch resume continues`
- `Stop button calls operator.interrupt`
- Perch bundle **does not import** `@tyto/cdp`

UI can be ugly. Occupancy and resume are the product.

---

### Slice 11 — ATTACH (extension + native messaging)

**Tests first (protocol)**

- native message `{ type: "cdp", method, params }` only from host
- `{ type: "fromPage" }` is ignored / never defined
- content script has no `browser.runtime` message type that executes CDP
- host rejects native messages whose origin is not the Tyto extension id
- `chrome.debugger.attach` auto on target tab (extension unit with fake
  `chrome` API)

Then live attach on a throwaway profile.

---

### Slice 12 — MCP adapter

**Tests**

- tool names ⊆ protocol Perch-safe set
- `resources` can read session file
- disconnect MCP, session remains
- no tool `cdp_raw` unless host flag (default off)

---

### Slice 13 — weave (live occupancy)

**Tests (fake first, then live)**

- FakeOccupancy: key event sets `operatorActive`; next tick no `perform`
- live: type in the same textbox the agent targeted; agent re-snapshots;
  does not overwrite mid-keystroke
- Esc → Idle

---

### Slice 14 — unattended runner

**Tests**

- exit 0 on `done`
- exit 2 on `ShellNotReady`
- exit 3 on allowlist deny
- exit 4 on confirm required and `--no-confirm`
- no HITL in runner unless `--allow-confirm-fail`

---

## 7. AgentLoop state machine (test every arrow)

```
Idle
  └─ start → Observing
Observing
  └─ tape attached → Classifying
Classifying
  ├─ static | injected → Browsing
  └─ shell → WaitingReady → Classifying
Browsing
  ├─ recipes bind all steps → Acting
  └─ need plan → Thinking → Acting
Thinking
  └─ at most 2 / snapshot generation
Acting
  ├─ Occupancy interrupt → Idle
  ├─ Occupancy operatorActive → Idle (yield)
  └─ performed → Waiting
Waiting
  └─ tape predicate | ready → Observing or Extracting
Extracting
  ├─ shell → Failed (no model)
  └─ ax hit → Idle done
Failed / Done → persist session
```

Illegal: Thinking while operatorActive. Acting with a stale generation.
Extracting via ModelPort when AX already has the field (optional later
optimization; Wayback test forbids model on extract).

---

## 8. Mapping to product phases

| Spec phase | Slices | Feel it when |
|---|---|---|
| 1 Host + SDK + LAUNCH + Perch paste + resume | 0–10, **6b**, **9b** | Kill Perch, reopen, continue; Wikipedia-class task; **portal+iframe fake green** |
| 2 ATTACH | 11 | Edge profile you picked (Workday cookies live here), debugger banner, same SDK |
| 3 MCP | 12 | Claude Code on the same session file |
| 4 Weave + recipe replay | 6 (fake) + 13 (live) | Type in the field; second visit skips think |
| 5 Unattended | 14 | Exit codes |

Do not implement Phase 2 UI before Slice 6 is green. That is how god
objects are born.

---

## 9. First week (concrete)

**Day 1.** Slice 0 + Slice 1 (session schema + tmp store).  
**Day 2.** Slice 2–3 (bind, classify, extract fixtures from POC dumps).  
**Day 3.** Slice 4–5 (policy + coerce).  
**Day 4–5.** Slice 6 + **6b** (fake Wikipedia **and** portal/tenant iframe).

End of week 1: `npm test` tells the Tyto story with no browser — including
“Workday housed on another site” as two origins and a focused frame.

**Week 2.** Slice 7–8 (host RPC + model adapters).  
**Week 3.** Slice 9–10 (LAUNCH + Perch). Phase 1 shippable internally.  
**Week 4+.** Attach, MCP, weave, runner.

---

## 10. Anti-patterns (reject in review)

- `page.click(selector)` / Playwright locators as the product path
- `sleep(250)` as wait-success
- Caching `backendNodeId` in the session file
- `complete()` inventing extract when shape is `shell`
- LiteLLM (or any vendor) types in `@tyto/core`
- Extension `window.tyto = { click }`
- Host listen `0.0.0.0`
- Silent default to a named Chrome/Edge profile
- One `Browser` interface “for convenience”
- MCP tools that are raw CDP method names
- Importing `@tyto/cdp` from Perch or MCP
- Acting in the parent when the working document is an unattached OOPIF
- Auto-granting every iframe origin the page happens to load
- Cookies or tokens in the session JSON (vault handles only)
- Any auth material (cookie value, bearer token) in a tape event, model prompt, or log
- Harvesting OS credential-store, Kerberos TGT, or LSASS (out of scope)
- Exporting auth material to non-browser callers via the SDK
- Logging `Set-Cookie` or `Authorization` header values
- Calling `document.cookie` to read httpOnly cookies (use `Network.getAllCookies`)
- Replaying an expired bundle without operator re-auth (prompt, do not silently 401)
- Workday-specific modules in core (`WorkdayDriver`, CSS selectors for
  `wd-CommandButton`) — that is a recipe archive, not a product fork

---

## 11. Definition of done (product, not slice)

From the spec one-line tests, now as CI:

1. Fake + live: paste-to-trusted-click does not screenshot.
2. Host restart: same session id continues.
3. Wayback fixture: static extract, `ModelPort` call count 0.
4. Shell fixture: extract blocked.
5. Security: unauthorized RPC, bind loopback, page has no command API
   (extension contract).
6. Occupancy: operator typing prevents `perform` (fake + live).
7. Hosted app: portal shell + tenant iframe; act in the granted child;
   recipes keyed by tenant origin.
8. Identity vault: quit browser, reopen session, agent resumes authenticated
   on a cookie-session origin without operator re-typing a password.
9. Redaction: full model transcript from authenticated run contains zero
   cookie or token values; verified by grep over the session file.
10. Vault at rest: bundle file is ciphertext; no fixture or test writes
    plaintext cookies to disk.

Until those six are green, we are not “done with Phase 1.”

---

## 12. Open only if forced

- Host rewrite in Rust/Go (packaging, code signing of native messaging)
- Perch as Chrome side panel vs standalone window (both remain SDK clients)
- Python SDK (after TS SDK is boring)

Do not bikeshed these in week 1. Ports already make them cheap later.
