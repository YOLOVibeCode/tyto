# Tyto — Implementation plan (TDD + ISP)

Noctusoft, Inc. · Status: draft 3 (2026-09-30) — the engineering contract
Product: [`SPEC.md`](./SPEC.md). Previous design (own CDP stack) is archived at tag `archive/tyto-v0`.

## 0. Laws

**TDD.** A failing spec-sentence test exists before production code. `npm test` is offline: no browser, no
agent-browser binary, no network, no keys. Live tests live in `packages/*/test/live/` (`npm run test:live`).

**ISP.** One port per file in `packages/core/src/ports/`. `@tyto/core` is pure (no processes, files, network,
WebSocket, browser drivers, or vendor LLM SDKs — `scripts/check-core-imports.mjs`). Adapters implement ports.
Separate fakes in `@tyto/core/testing`.

## 1. Packages

| Package | Role |
|---|---|
| `packages/core` | Recipe schema, lint, render, verify; trace model; brief assembly and rendering; find; redaction; ports; fakes |
| `packages/agent-browser` | `BrowserRunner` and `EventSource` adapters: spawn with an argv array, batch via stdin JSON, stream WebSocket |
| `packages/store` | `~/.tyto/{recipes,traces,locks}`: recipe store, session lock, replay config files; JSON, `0600`, atomic writes |
| `packages/compiler` | `ClaudeCodeCompiler` (default), `OpenAiCompatCompiler` (slice 9) |
| `packages/llm` | OpenAI-compatible and Anthropic HTTP `ModelPort`s (kept); tool calls added in slice 9 |
| `packages/cli` | `tyto` command |

## 2. Ports (`packages/core/src/ports/`)

| Port | Shape |
|---|---|
| `browser-runner.ts` | `run(argv, opts)`, `batch(steps, opts)` → typed step results; opts carry session, env, AbortSignal |
| `browser-events.ts` | `BrowserEventSource.subscribe(session, signal)` → `AsyncIterable<StreamEvent>` |
| `recipe-store.ts` | `get`, `list`, `save`, `remove` |
| `trace-store.ts` | `save`, `get` |
| `compiler.ts` | `Compiler.run({system, prompt, context})` → the model's final message (a session limited to `tyto compile-tool`) |
| `session-lock.ts` | `acquire(session, timeoutMs)` → release function |
| `log-marks.ts` | `get(session)`, `set(session, counts)`: log offsets taken when a page is opened |
| `clock.ts`, `model.ts`, `redactor.ts`, `injection-guard.ts` | kept |

## 3. Recipe format (v1)

```json
{ "name": "github-release-info", "version": 1, "status": "draft", "auth": false,
  "intent": "…", "examples": ["…"], "origins": ["https://github.com"],
  "domains": ["github.githubassets.com", "*.githubusercontent.com"],
  "params": { "repo": { "type": "string", "description": "owner/name", "example": "vercel-labs/agent-browser" },
              "n": { "type": "int", "description": "position", "example": "1", "default": "1" } },
  "steps": [["open", "https://github.com/{{repo|path}}/releases"], ["wait", "--load", "load"],
            ["eval", "…JS that reads params.repo and params.n, returns JSON.stringify({…, url: location.href})"]],
  "verify": { "required": ["tag", "published", "url"], "match": { "url": "github\\.com/{{repo}}/releases" } },
  "regression": [{ "params": { "repo": "vercel-labs/agent-browser" }, "expect": { "tag": "v0.38.1" } }] }
```

Filters: `{{p}}`, `{{p|lower}}`, `{{p|underscore}}`, `{{p|path}}` (percent-encode, keep `/`), `{{p|url}}`
(full URL; origin must be in `origins`). Param types: `string`, `int`, `enum` (with `values`).
`origins` limits what the recipe may open; `domains` adds hosts the page may load resources from (CDNs); both
feed agent-browser's `--allowed-domains` in `tyto-rx`.

**Executor.** lint → render (defaults, types) → prepend `const params = JSON.parse(<double-encoded>);` to eval
code → base64 (`eval -b`) → one `batch --bail --json` → last eval parsed as a JSON object → verify
(non-strings compared JSON-style; params regex-escaped in `match`).
Exit codes: 0 hit · 3 MISS `{miss, step}` · 64 usage/bad params · 65 recipe fails parse or lint · 69
agent-browser missing · 70 internal/agent-browser error · 75 session busy · 77 auth recipe not approved.
Timeouts: `AGENT_BROWSER_DEFAULT_TIMEOUT=6000` in the batch environment (waits read it per call; clicks and fills
read it when the `tyto-rx` daemon starts, which Tyto does), 15 s overall deadline. Retry the batch once only on
browser launch errors.

**Sessions.** `tyto-rx`: Tyto-owned agent-browser config via `AGENT_BROWSER_CONFIG`, which replaces the user's
config entirely (keeps only `executablePath`; no restore), with `--allowed-domains <origin hosts + domains>`. `tyto-rx-auth`: `--restore main`, only for approved `auth` recipes.
Both use an action policy denying download and upload.

## 4. Slices and spec sentences

Each slice: tests first, then code, `npm run check` green, one PR.

### Slice 1 — reset (done in this PR)
- `core import boundary rejects child_process, fs, net, fetch, and WebSocket in core source`
- `SecretRedactor masks token, password, api_key and sid values in JSON and query strings`

### Slice 2 — recipe core (`packages/core/src/recipe/`)
- `parseRecipe accepts a valid recipe and returns typed params`
- `parseRecipe rejects a recipe whose last step is not eval`
- `lint rejects {{ inside eval code`
- `lint rejects commands outside the allowlist (cookies, storage, network, download, upload, auth, state, snapshot, screenshot)`
- `lint rejects @eN refs in steps`
- `lint rejects an open URL whose origin is not in origins`
- `lint rejects eval code using fetch, XMLHttpRequest, sendBeacon, WebSocket, import(, document.cookie, localStorage, sessionStorage, location assignment, or .submit(`
- `lint rejects fills whose locator looks like a password, token, OTP, or card field`
- `lint rejects :nth-of-type selectors built from a param`
- `render applies lower, underscore, path, and url filters`
- `render fills defaults and rejects missing required params`
- `render rejects non-integer int params and values outside an enum`
- `render rejects a param value that would start an argv element with "-"`
- `render keeps rendered open URLs inside origins`
- `eval preamble carries params as JSON and survives quotes, backslashes, and </script>`
- `verify hits when required fields are present and matches pass`
- `verify misses naming the first empty required field`
- `verify escapes params inside match patterns`
- `verify compares non-string values JSON-style`
- `verify misses when the final eval result is not a JSON object`

### Slice 3 — executor, adapter, store, `tyto run`
- `runs all steps as one batch in session tyto-rx with --allowed-domains from origins`
- `the domain allowlist also includes the recipe's extra network domains`
- `a hit returns the verified result`; `tyto run prints the result JSON and exits 0 on a hit`
- `a failing step misses with the step index`; `tyto run prints the miss and exits 3`
- `a verify failure after a successful batch misses at the last step`
- `retries once on a browser launch error and never on element-not-found`
- `sets AGENT_BROWSER_DEFAULT_TIMEOUT and the Tyto config for the batch`
- `stops at the overall deadline with exit 70`
- `an auth recipe runs in tyto-rx-auth only when approved, otherwise exits 77`
- `a busy session exits 75`; `the session lock is released after the run`
- `a missing agent-browser binary exits 69`
- `recipes that fail lint exit 65 before any browser call`; `bad params exit 64 before any browser call`
- `BrowserRunner.batch sends steps as JSON on stdin and parses results` (stub executable, no browser)
- `run puts --session and session args before the command`; `abort kills the child process`
- `FilesystemRecipeStore writes atomically with mode 0600 and rejects invalid recipes`
- `FileSessionLock gives the lock to one holder at a time` and `reclaims a lock whose holder process is gone`
- `ensureReplayFiles writes a Tyto agent-browser config with only executablePath and a policy denying download and upload`
- `tyto recipes lists name, intent, and params`; `tyto test runs every regression case and exits 3 if any fails`
- live: `a fixture recipe hits, then misses after the page changes`; `a missing locator fails in under 7 s`

### Slice 4 — brief, find, act
Browse commands run in the agent's own session (`--session`, default `$AGENT_BROWSER_SESSION` or `default`) with
the user's agent-browser config. They never pass env overrides: agent-browser restarts a session's browser when
launch settings change mid-session, and the page is lost (observed: Edge fell back to its new-tab page).
- `brief lists failed Fetch/XHR requests with a redacted response snippet`
- `brief lists uncaught errors and console errors and warnings`
- `brief scopes console, errors, and requests to the current navigation by offsets`
- `brief shows cookie names, httpOnly, and lifetime, never values`
- `brief ignores favicon 404s`
- `brief caps interactive elements at 40 and reports the remainder`
- `find returns lines containing all words with following context, at most 8`
- `find with a locator keyword passes through to agent-browser find`
- `act reports navigation, new requests, errors, and console since the action`
- `bare e12 refs are rewritten to @e12`
- `tyto open marks the logs, opens the page, and prints the brief`; `tyto brief --json prints the brief as JSON`
- `--session selects the agent-browser session`
- `browse commands never change agent-browser settings mid-session (a changed setting restarts the browser)`
- `agent-browser restore status lines are not echoed`
- `FileLogMarks returns zero offsets for an unknown session and round-trips saved offsets with mode 0600`
- live: `the brief shows a planted 500 with its body and the console error`; `a click reports the uncaught TypeError`;
  `find locates text anywhere on the page`

### Slice 5 — recorder and traces
agent-browser's event stream (`<socketDir>/<session>.stream` holds the WebSocket port; socketDir follows
`AGENT_BROWSER_SOCKET_DIR`, then `$XDG_RUNTIME_DIR/agent-browser`, then `~/.agent-browser`) reports **internal**
action names (`navigate`, `getbylabel`, `waitforurl`, …), which `actionToArgv` maps back to CLI argv. Its
`success` field is `false` even for successful commands, so success comes from the result's `error`. Typed values
arrive in plaintext: the listener holds them in memory only; `tyto learn stop --param input_N=name` keeps chosen
ones as params. `tyto learn` talks to its detached listener over a unix socket in `~/.tyto/learn/` (dir 0700).
- `learn waits for the sync marker before recording`
- `pairs command and result events by id into trace steps`
- `marks the trace lossy on an orphan result, a missing result, or a socket close`
- `ignores frame messages`
- `replaces fill and type values with {{input_N}} placeholders`
- `keeps only inputs named with --param and drops the rest`
- `reduces cookie and storage values to names and lengths`
- `runs the Redactor before the trace is returned`
- `actionToArgv maps navigate, click, fill, type, press, select, check, waits, eval, get, snapshot, and find locators`
- `masks values typed into password-like fields and never offers them as params`
- `collects the origins the task opened`; `keeps snapshot text and eval results as step output`
- `StreamEventSource reads the port file and yields parsed events, dropping frames`; `yields a closed event when the socket closes`
- `agentBrowserSocketDir follows agent-browser's socket directory rules`
- `FileTraceStore saves traces with mode 0600 and loads them by name`
- `tyto learn starts the session and a listener, then prints how to finish`; `tyto learn stop requires --task`
- `tyto learn stop sends the task and kept params, then prints the trace summary`
- `tyto learn status lists typed inputs by name and locator, never values`
- `the listener records after the marker and saves the trace with kept params when stopped`
- `control client and server exchange messages over a private socket`
- live: `records command/result pairs from the event stream and keeps only the named input`

### Slice 6 — compiler (Claude Code)
`tyto compile <name>` builds the prompt (task and kept params outside the fence; every step and output inside a
random-nonce fence labelled untrusted), runs `claude -p` in `~/.tyto/compile/<name>-*/` with `ANTHROPIC_API_KEY`
removed, `--allowedTools "Bash(tyto compile-tool:*)"`, Write/Edit/Web/Task denied, and a `tyto` shim on PATH.
`compile-tool draft` reads recipe JSON on stdin, validates, lints, and checks origins ⊆ the trace's origins;
`compile-tool test dN --p v` runs a draft; `compile-tool ab …` probes in session `tyto-compile` (Tyto config, no
logins, `--allowed-domains`, `--content-boundaries`). The final recipe is re-checked and stored as a draft.
Verified: Claude Code refuses `tyto compile-tool … && touch …` as a whole (permission denial, nothing ran).
- `the prompt fences trace page text with a random nonce and labels it as data`
- `claude runs with only Bash(tyto compile-tool:*) allowed and without ANTHROPIC_API_KEY`
- `compiler output that fails lint is rejected; valid output is stored as a draft`
- `compile-tool ab pins session tyto-compile with --allowed-domains from the trace origins`
- `compile-tool test runs the executor on the given params`
- `recipes approve shows the steps and marks the recipe approved after confirmation`
- `the prompt includes the task, kept params with examples, origins, and every step's argv`; `warns the compiler when the trace is lossy`
- `extracts recipe JSON from the final message, fenced or bare`
- `a compiled recipe whose origins are outside the trace's origins is rejected`
- `puts a tyto shim on PATH and sets TYTO_COMPILE_DIR with the compile context`; `a failed claude run is an error`
- `compile-tool refuses to run outside a compile`; `compile-tool draft validates, lints, and saves a draft`
- `tyto compile saves a valid compiled recipe as a draft and prints how to run it`
- `recipes approve leaves the recipe a draft when not confirmed`; `--yes approves without asking`
- live (`TYTO_LIVE_COMPILER=1`): `a compiled recipe passes lint and its self-test, then answers unseen inputs`

Compiler card rules (from the measured prototype): never `@eN` refs; stable locators (URLs, `find`, CSS); no
snapshot steps; parameterize what users vary; wait on signals; verification tied to page structure, not loose
regexes; resolve ambiguity by page signals (e.g. a "Latest" badge); position params count the items
themselves (`querySelectorAll(...)[n-1]`); never submit or delete unless the trace did; self-test at least three
inputs (original plus two varied), each confirmed independently on the live page.

### Slice 7 — repair
`tyto repair <name> --p v` reruns the input; on a MISS it sends the current recipe, the miss (reason fenced as
untrusted), and the regression inputs to the compiler with a repair addendum. The candidate must keep the name,
param names, and origins, pass lint, and hit on the missed input and every regression input before it replaces
the old recipe. Repaired recipes are drafts; `auth` recipes skip live validation and must be approved again.
Successful `tyto run`s append their inputs to `regression` (first case kept, most recent kept, max 10); a MISS
prints a ready-to-run `tyto repair` command on stderr.
- `on a miss, repair receives the missed inputs with reasons and the regression inputs`
- `a repaired recipe keeps its name and params and must pass every regression input before replacing the old one`
- `passing inputs are appended to regression, deduplicated, capped at 10`
- `repair output that fails lint leaves the old recipe unchanged`
- `a repaired recipe must keep its name and param names`; `a repaired recipe may not open new origins`
- `a successful repair replaces the recipe and remembers the missed input`
- `an input the recipe already answers needs no repair`
- `a repaired auth recipe is saved as a draft that needs approval again`
- `tyto run records passing inputs in the regression list`; `tyto run prints a repair hint on a miss`

### Slice 8 — install and doctor
`tyto install` writes `~/.local/bin/tyto` pinned to the installing Node (the user's default Node may be too old),
the `tyto` skill for Claude Code and Cursor (tracked by hash in `~/.tyto/installed.json`; edited copies are kept),
and replaces step 4 of the web-access rule once. agent-browser stores only a hash of a session's launch settings,
so the doctor cannot read a daemon's timeout; it lists Tyto's running sessions and `--fix` closes them so they
restart with Tyto's settings.
- `writes the tyto launcher into the bin dir, pinned to this Node`
- `install writes the tyto skill for Claude Code and Cursor`; `install does not overwrite a skill the user edited`
- `install updates the web-access rule to check tyto recipes first, once`
- `doctor reports an agent-browser older than 0.38.1`; `doctor reports a missing agent-browser and a missing launcher`
- `doctor --fix closes Tyto's running sessions so they restart with Tyto's settings`

### Slice 9 — OpenAI-compatible compiler
- `the tool-call loop runs compile-tool calls and stops on the final recipe JSON`
- `config selects the compiler: claude (default) or openai with baseUrl and model`

Later: request → recipe routing without a model (local embeddings), session pool, MCP.

## 5. Verification

- Every slice: `npm run check`, gitleaks `--redact`, CI green.
- Live (`npm run test:live`, local `node:http` fixture): batch output shape; stream command/result pairing;
  a missing locator fails in under 7 s; a fixture recipe hits, then misses after the page changes; the brief
  shows a planted 500 and TypeError.
- Compiler live (`TYTO_LIVE_COMPILER=1`): recompile the four benchmark tasks and run the 18 new inputs against
  API ground truth — ≥ 17/18 correct, 0 wrong after one repair; warm hits under 0.5 s.

## 6. Anti-patterns (reject in review)

Shell strings for child processes · `sleep` as success · templating inside eval code · recipes that submit,
purchase, send, or delete without the trace doing so · running an `auth` recipe without approval · secrets in
traces, recipes, logs, or prompts · a god port or god fake · anything that re-implements agent-browser.
