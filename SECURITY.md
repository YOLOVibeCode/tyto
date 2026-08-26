# Security

Tyto drives a real Chrome or Edge profile with **trusted CDP input**. That is
indistinguishable from a human. Treat the host as a kernel.

## Report a vulnerability

Email **security@noctusoft.com** (or open a **private** GitHub security
advisory on this repo). Do not file a public issue with exploit details,
cookie dumps, or live credentials.

## Public-repo rules

This repository is public. **Never** commit:

- API keys (`TYTO_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`)
- Host tokens (`TYTO_HOST_TOKEN`)
- Browser profiles (`tmp/`, user-data-dir clones)
- Cookies, `Set-Cookie` headers, bearer tokens, vault ciphertext
- Private keys (`.pem`, `.key`, SSH keys)

Copy [`.env.example`](./.env.example) to `.env` (gitignored).

## What we scan

| Layer | What |
|---|---|
| `.gitignore` | Profiles, `.env`, vault dirs, keys |
| `npm run secrets:scan` | Pattern scan; **does not print secret values** |
| `.githooks/pre-commit` | Staged-file scan + core import boundary |
| GitHub Actions `gitleaks` | Default + Tyto rules in [`.gitleaks.toml`](./.gitleaks.toml) |
| GitHub secret scanning | Automatic on public repos |

Enable the local hook after clone:

```bash
git config core.hooksPath .githooks
```

## Product control plane (not optional)

- SDK and debug port bind **`127.0.0.1` only**. Never `0.0.0.0`.
- Page JavaScript cannot command Tyto.
- Auth material is encrypted at rest; the model never sees cookies or tokens.
- Identity is **your own**, restored **only** into Chrome/Edge. No OS ticket
  harvest, no impersonation, no export to non-browser clients.

See [docs/SPEC.md](./docs/SPEC.md) §6 and [docs/IMPLEMENTATION.md](./docs/IMPLEMENTATION.md) §3.7.
