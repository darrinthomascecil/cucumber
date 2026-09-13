import type { Rng } from '@cucumber/game-engine'

/** Deterministic RNG for tests. Never used by the server, which uses
 *  node:crypto — this exists only so scenarios replay identically. */
export function seededRng(seed: number): Rng {
  let state = seed >>> 0
  return (maxExclusive: number) => {
    // xorshift32
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state % maxExclusive
  }
}

/** An RNG that always returns 0, so `deal` uses the deck exactly as given. */
export const identityRng: Rng = () => 0
