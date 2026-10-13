# Vitest

- Tests live next to the behavior (`packages/*/test/`); names are spec sentences.
- Default suite: no browser, no agent-browser binary, no network, no keys. Live tests only in `test/live/`.
- Inject port fakes. Do not mock private methods. No god fake.
- One behavior per `it`. No `it.skip` without an issue id.
- No `sleep` as the success condition; use `FakeClock`.
