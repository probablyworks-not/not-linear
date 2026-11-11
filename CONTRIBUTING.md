# Contributing

Thanks for helping. A few ground rules keep this small and fast to review.

## Setup

See the README quick start and Development sections. Before opening a pull request, run:

```bash
pytest tests
cd web && pnpm typecheck && pnpm lint && pnpm test && pnpm check:licenses
```

`pnpm e2e` is slower; CI runs it, and you should run it if you touched UI or persistence.

## Conventions

- TypeScript strict. No `any` without a `// reason: ...` comment on the same line.
- Function components, named exports. Tailwind for styling; colours come from tokens, never literals
  (the lint rule enforces it).
- Anthropic/OpenAI/etc. calls go through `web/src/providers/`. Database writes go through the repo modules in
  `web/src/db/`, not directly from components.
- Persisted data shapes are a compatibility surface. If you change one, say so in the pull request.
- Keep scope tight: one change per pull request, with a test where behaviour changes.

## Sign your commits (DCO)

Sign off each commit to certify you wrote it or have the right to submit it under the project licence
([developercertificate.org](https://developercertificate.org)):

```bash
git commit -s -m "Fix the thing"
```

## Good first issues

Cross-platform file and folder pickers (the macOS-only `osascript` ones are the gap) and self-hosting the
fonts, icon font and pdf.js.
