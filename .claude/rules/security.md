# Security

Public repo. Never commit `.env`, profiles, cookies, tokens, keys, vault plaintext.

- `npm run secrets:scan` and gitleaks must stay green. Do not print secret values.
- Identity: encrypt at rest; restore into the browser only; grant per origin.
- Cookie/token values reach a caller only via the power scope with `reveal: true`;
  never persisted, never to `ModelPort`, never to the safe scope.
- Never serve a token to an unauthenticated request. Check `Host` and `Origin`.
- `Redactor` before model and tape. Loopback bind only. Confirm destructive acts.
