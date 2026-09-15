import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // The web component tests render with renderToStaticMarkup, so they need
    // no DOM and belong in the same run. Left out of `include`, they pass
    // locally and never run again.
    include: ['tests/**/*.test.ts', 'apps/web/src/**/*.test.tsx'],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    // The integration suite owns a port and a database; nothing runs beside it.
    fileParallelism: false,
    pool: 'forks',
  },
})
