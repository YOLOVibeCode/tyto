# Agent instructions (Cursor, Claude Code, other coding agents)

Tyto is a thin layer on [agent-browser](https://github.com/vercel-labs/agent-browser): recipes (learn once,
replay with no model, repair) and a one-call page brief. It is **TDD + ISP**. Detailed rules:
[`.cursor/rules/`](.cursor/rules/) and [`.claude/rules/`](.claude/rules/); Claude Code also reads [`CLAUDE.md`](./CLAUDE.md).

## Non-negotiable

1. **Red–green–refactor.** A failing spec-sentence test exists before production code.
2. **`npm test` is offline.** No browser, no agent-browser binary, no network, no keys. Live tests: `npm run test:live`.
3. **No god interfaces.** Ports in `packages/core/src/ports/`, one job each; separate fakes.
4. **`@tyto/core` is pure.** No processes, files, network, WebSocket, browser drivers, vendor LLM SDKs.
5. **Never re-implement agent-browser.** Call its CLI with an argv array; listen to its event stream.
6. **Recipes pass lint before store or run.** Logged-in replay only for approved `auth` recipes.
7. **No secrets in git, traces, recipes, or prompts.** `Redactor` first.
8. After changes: `npm run check`.

Full contract: [docs/IMPLEMENTATION.md](./docs/IMPLEMENTATION.md).

## Noctusoft LLM Relay (optional endpoint)

When this app talks to Noctusoft models, the base URL is `https://ai.noctusoft.com/v1` on litellm-vm. Tyto still treats it as a generic OpenAI-compatible URL. No LiteLLM types.
