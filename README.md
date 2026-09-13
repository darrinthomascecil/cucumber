# cucumber

A Next.js (App Router) web app in TypeScript.

## Develop

```bash
pnpm install
pnpm dev        # http://localhost:3000
```

## Checks

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Layout

- `src/app/` — routes, layout, and global styles
- `src/app/api/health/` — `GET /api/health` liveness probe
- `src/lib/` — non-UI logic
- `tests/` — vitest suites
