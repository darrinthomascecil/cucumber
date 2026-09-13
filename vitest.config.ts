import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    // The integration suite owns a port and a database; nothing runs beside it.
    fileParallelism: false,
    pool: 'forks',
  },
})
