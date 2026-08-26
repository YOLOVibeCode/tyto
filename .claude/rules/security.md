# Security

Public repo. Never commit `.env`, profiles, cookies, tokens, keys, vault plaintext.

- `npm run secrets:scan` and gitleaks must stay green. Do not print secret values.
- Identity: encrypt at rest; restore into Chrome/Edge only; grant per origin.
- `Redactor` before model and tape. Loopback bind only. Confirm destructive acts.
