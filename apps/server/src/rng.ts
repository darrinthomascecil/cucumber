import { randomInt } from 'node:crypto'
import type { Rng } from '@cucumber/game-engine'

/**
 * Spec §48: the shuffle uses the platform CSPRNG, not Math.random, so deck
 * order is not predictable from anything a player can observe.
 */
export const cryptoRng: Rng = (maxExclusive: number) => randomInt(maxExclusive)
