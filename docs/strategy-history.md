# Strategy Public History Checkpoint

This checkpoint extends the existing `@cucumber/strategy` advisor. It does not
replace it with the parallel exact-advice prototype preserved on local `main`.

New hands retain their completed public tricks in the authoritative snapshot.
Per-seat views receive a deep copy, not opponent hands, stock cards, or hidden
discards. The existing strategy sampler now receives failed targets from those
earlier tricks as well as the current trick. Hands only shrink during play, so
these failures remain valid constraints.

Older snapshots stay playable. They expose the last available completed trick
and report `historyComplete: false`; missing earlier history is not invented.
New hands reset the history. Multi-card failures remain multi-card constraints,
not an incorrect ceiling on every individual card.

## Offline Checks

With Node 24, the local workspace loader runs the targeted regressions without
npm, pnpm, a registry, a database, or the application build:

```powershell
node --experimental-strip-types --import ./tools/register-workspace.mjs --test --test-timeout=20000 tests/strategy/history.node.ts
```

To typecheck the engine, strategy, and imported shared definitions, point
`TYPESCRIPT_PATH` at an existing TypeScript installation's `lib/typescript.js`:

```powershell
node tools/check-strategy-types.mjs
```

The fallback compiler can be VS Code's bundled compiler. This is not a full
application typecheck. The native tests supplement, rather than replace, the
existing Vitest suite. The web/server build and database integration tests are
not part of this offline checkpoint.

This fixes loss of previously observed evidence. It does not demonstrate lower
held-out Brier score or better match strength. The branch's documented sampler,
exchange-prior, continuation-value, and stronger failure-inference limitations
remain separate work; the parallel prototype's exactness claims do not apply
to this strategy advisor.