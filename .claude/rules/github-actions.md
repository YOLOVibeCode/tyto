# GitHub Actions

- Least-privilege `permissions`. Node 22, `npm ci`, `npm run check`.
- Gitleaks with `--redact`. Never echo secrets.
- Do not download Chromium in default CI. No privileged secrets on fork PRs.
