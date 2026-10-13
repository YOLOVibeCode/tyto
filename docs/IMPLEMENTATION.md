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
| `packages/agent-browser` | `BrowserRunner` and `EventSource` adapters: `execFile` argv, batch via stdin JSON, stream WebSocket, session lock |
| `packages/store` | `~/.tyto/{recipes,traces,locks}`, JSON, `0600`, atomic writes |
| `packages/compiler` | `ClaudeCodeCompiler` (default), `OpenAiCompatCompiler` (slice 9) |
| `packages/llm` | OpenAI-compatible and Anthropic HTTP `ModelPort`s (kept); tool calls added in slice 9 |
| `packages/cli` | `tyto` command |

## 2. Ports (`packages/core/src/ports/`)

| Port | Shape |
|---|---|
| `browser-runner.ts` | `run(argv, opts)`, `batch(steps, opts)` → typed step results; opts carry session, env, AbortSignal |
| `event-source.ts` | `subscribe(session, signal)` → `AsyncIterable<StreamEvent>` |
| `recipe-store.ts` | `get`, `list`, `save`, `remove` |
| `trace-store.ts` | `save`, `get`, `latest` |
| `compiler.ts` | `compile(trace)`, `repair(recipe, misses, passes)` → recipe JSON |
| `session-lock.ts` | `acquire(session, timeoutMs)` → release function |
| `clock.ts`, `model.ts`, `redactor.ts`, `injection-guard.ts` | kept |

## 3. Recipe format (v1)

```json
{ "name": "github-release-info", "version": 1, "status": "draft", "auth": false,
  "intent": "…", "examples": ["…"], "origins": ["https://github.com"],
  "params": { "repo": { "type": "string", "description": "owner/name", "example": "vercel-labs/agent-browser" },
              "n": { "type": "int", "description": "position", "example": "1", "default": "1" } },
  "steps": [["open", "https://github.com/{{repo|path}}/releases"], ["wait", "--load", "load"],
            ["eval", "…JS that reads params.repo and params.n, returns JSON.stringify({…, url: location.href})"]],
  "verify": { "required": ["tag", "published", "url"], "match": { "url": "github\\.com/{{repo}}/releases" } },
  "regression": [{ "params": { "repo": "vercel-labs/agent-browser" }, "expect": { "tag": "v0.38.1" } }] }
```

Filters: `{{p}}`, `{{p|lower}}`, `{{p|underscore}}`, `{{p|path}}` (percent-encode, keep `/`), `{{p|url}}`
(full URL; origin must be in `origins`). Param types: `string`, `int`, `enum` (with `values`).

**Executor.** lint → render (defaults, types) → prepend `const params = JSON.parse(<double-encoded>);` to eval
code → base64 (`eval -b`) → one `batch --bail --json` → last eval parsed as a JSON object → verify
(non-strings compared JSON-style; params regex-escaped in `match`).
Exit codes: 0 hit · 3 MISS `{miss, step}` · 64 usage · 69 agent-browser missing · 70 internal/agent-browser
error · 75 session busy · 77 auth recipe not approved.
Timeouts: `AGENT_BROWSER_DEFAULT_TIMEOUT=6000`, explicit `--timeout` on waits, 15 s overall deadline. Retry the
batch once only on browser launch errors.

**Sessions.** `tyto-rx`: Tyto-owned agent-browser config (copies `executablePath` from the user's config; no
restore) with `--allowed-domains <origins>`. `tyto-rx-auth`: `--restore main`, only for approved `auth` recipes.
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
- `a hit prints the result JSON and exits 0`
- `a failing step misses with exit 3 and the step index`
- `retries once on a browser launch error and never on element-not-found`
- `sets AGENT_BROWSER_DEFAULT_TIMEOUT and adds --timeout to wait steps`
- `stops at the overall deadline with exit 70`
- `an auth recipe runs in tyto-rx-auth only when approved, otherwise exits 77`
- `a busy session exits 75 after the lock wait`
- `a missing agent-browser binary exits 69`
- `recipes that fail lint are refused before any browser call`
- `BrowserRunner.batch sends steps as JSON on stdin and parses results` (stub executable, no browser)
- `FilesystemRecipeStore writes atomically with mode 0600 and rejects invalid recipes`
- `tyto recipes lists name, intent, and params`

### Slice 4 — brief, find, act
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

### Slice 5 — recorder and traces
- `learn opens the session and waits for the sync marker before recording`
- `pairs command and result events by id into trace steps`
- `marks the trace lossy on an orphan result, a missing result, or a socket close`
- `ignores frame messages`
- `replaces fill and type values with {{input_N}} placeholders`
- `keeps only inputs named with --param and drops the rest`
- `reduces cookie and storage values to names and lengths`
- `runs the Redactor before the trace is saved`

### Slice 6 — compiler (Claude Code)
- `the prompt fences trace page text with a random nonce and labels it as data`
- `claude runs with only Bash(tyto compile-tool:*) allowed and without ANTHROPIC_API_KEY`
- `compiler output that fails lint is rejected; valid output is stored as a draft`
- `compile-tool ab pins session tyto-compile with --allowed-domains from the trace origins`
- `compile-tool test runs the executor on the given params`
- `recipes approve shows the steps and marks the recipe approved after confirmation`
- live: `a compiled recipe passes lint and its self-test`; `compile-tool; rm is denied`

Compiler card rules (from the measured prototype): never `@eN` refs; stable locators (URLs, `find`, CSS); no
snapshot steps; parameterize what users vary; wait on signals; verification tied to page structure, not loose
regexes; resolve ambiguity by page signals (e.g. a "Latest" badge); position params count the items
themselves (`querySelectorAll(...)[n-1]`); never submit or delete unless the trace did; self-test at least three
inputs (original plus two varied), each confirmed independently on the live page.

### Slice 7 — repair
- `on a miss, repair receives the missed inputs with reasons and the regression inputs`
- `a repaired recipe keeps its name and params and must pass every regression input before replacing the old one`
- `passing inputs are appended to regression, deduplicated, capped at 10`
- `repair output that fails lint leaves the old recipe unchanged`

### Slice 8 — install and doctor
- `install writes the tyto skill for Claude Code and Cursor without overwriting user edits`
- `install updates the web-access rule to check tyto recipes first`
- `doctor reports an agent-browser older than 0.38.1`
- `doctor detects a tyto-rx daemon started with a different default timeout`

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
