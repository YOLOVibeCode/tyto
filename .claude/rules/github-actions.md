# GitHub Actions

- Least-privilege `permissions`. Node 22, `npm ci`, the `npm run check` steps.
- Gitleaks with `--redact`. Never echo secrets.
- Default CI never installs a browser or agent-browser. No privileged secrets on fork PRs.
