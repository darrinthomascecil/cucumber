import type { Rng } from '../deck.ts'

export function advisorRng(seed: number): Rng {
  let state = seed >>> 0
  return (limit) => {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('Random limit must be a positive integer')
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)
    return Math.floor((((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296) * limit)
  }
}

export function weightedIndex(weights: readonly number[], rng: Rng): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (!Number.isFinite(total) || total <= 0) throw new Error('Weights must have positive finite mass')
  let position = (rng(0x1000000) / 0x1000000) * total
  for (let index = 0; index < weights.length; index++) {
    position -= weights[index]!
    if (position < 0) return index
  }
  return weights.length - 1
}

export function logSumExp(values: readonly number[]): number {
  const highest = Math.max(...values)
  if (highest === -Infinity) return highest
  return highest + Math.log(values.reduce((sum, value) => sum + Math.exp(value - highest), 0))
}