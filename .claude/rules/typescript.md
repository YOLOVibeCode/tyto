# TypeScript

`tsconfig.base.json` is law: `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `verbatimModuleSyntax`, Node16 ESM.

- `import type` for types. Named exports from packages. No `any`, no empty `catch`.
- No default exports from libraries. Exhaustive `switch` on unions (`never`).
- Omit optional keys; do not assign `undefined` into `exactOptionalPropertyTypes` fields.
- Explicit return types on exported ports and domain functions.
- `.ts` import extensions. Core must not import Playwright or vendor LLM SDKs.
