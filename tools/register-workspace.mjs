import { registerHooks } from 'node:module'

const packages = new Map([
  ['@cucumber/shared', new URL('../packages/shared/src/index.ts', import.meta.url).href],
  ['@cucumber/game-engine', new URL('../packages/game-engine/src/index.ts', import.meta.url).href],
])

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(packages.get(specifier) ?? specifier, context)
  },
})