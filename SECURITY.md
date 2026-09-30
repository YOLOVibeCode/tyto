# Security

Tyto replays browser tasks through agent-browser, sometimes with your logins. A replayed click is a real
click. Treat recipes as code.

## Report a vulnerability

Email **security@noctusoft.com** (or open a **private** GitHub security
advisory on this repo). Do not file a public issue with exploit details,
cookie dumps, or live credentials.

## Public-repo rules

This repository is public. **Never** commit:

- API keys (`TYTO_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`)
- Browser profiles and agent-browser state files (`~/.agent-browser/sessions/*`)
- Tyto traces (`~/.tyto/traces`)
- Cookies, `Set-Cookie` headers, bearer tokens
- Private keys (`.pem`, `.key`, SSH keys)

Copy [`.env.example`](./.env.example) to `.env` (gitignored).

## What we scan

| Layer | What |
|---|---|
| `.gitignore` | Profiles, `.env`, keys, local state |
| `npm run secrets:scan` | Pattern scan; **does not print secret values** |
| `.githooks/pre-commit` | Staged-file scan + core import boundary |
| GitHub Actions `gitleaks` | Default + Tyto rules in [`.gitleaks.toml`](./.gitleaks.toml) |
| GitHub secret scanning | Automatic on public repos |

Enable the local hook after clone:

```bash
git config core.hooksPath .githooks
```

## Product rules (not optional)

- Recipes must pass lint before they are stored or run: command allowlist, no templating inside eval code,
  rendered URLs inside the recipe's `origins`, read-only eval heuristics, no password-like fills.
- Replays run without saved logins by default. Recipes that need your login run only after you approve them.
- Traces replace typed values with placeholders and are redacted before they touch disk or a model.
- Tyto never exports cookies or tokens; agent-browser owns browser state.

See [docs/SPEC.md](./docs/SPEC.md) §6 and [docs/IMPLEMENTATION.md](./docs/IMPLEMENTATION.md) §3.
