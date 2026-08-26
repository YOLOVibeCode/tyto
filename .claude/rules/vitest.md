# Vitest

- Tests belong next to behavior; names are spec sentences.
- Default suite: no Chrome, no `fetch`, no Playwright in `@tyto/core`.
- Inject port fakes. Do not mock private methods. No god fake.
- One behavior per `it`. No `it.skip` without an issue id.
- Vault tests: ciphertext on disk must not contain the cookie/token value.
- No `sleep` as the success condition; use `Clock` and tape predicates.
