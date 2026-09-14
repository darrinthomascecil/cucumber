import { CLASS_VALUE, HIGH_CLASS, totalOf, type Counts } from './classes.ts'
import type { Candidate, Policy, PolicyView } from './sim.ts'

/**
 * The shape of a fast policy, in five numbers. Everything the strategy
 * believes about Cucumber is expressed here; `tools/self-play.ts` searches
 * this space and writes the winner back into TUNED.
 *
 * The tension the weights trade off:
 *  - shedding a valuable card now means you cannot be left holding it,
 *  - but the strength you spend doing it is what stops you being forced to
 *    surrender your low cards later,
 *  - and your low cards are exactly what you want to be holding at the reveal.
 */
export interface Weights {
  /** Reward for getting rid of points. */
  value: number
  /** Penalty for spending trick strength, scaled by how much hand is left. */
  strength: number
  /** Extra penalty for spending the low cards you hope to finish on. */
  low: number
  /** Extra reward for shedding a 7 or a Joker — an instant loss if it sticks. */
  high: number
  /** Preference for leading several cards at once. */
  width: number
}

export const BASELINE: Weights = { value: 1, strength: 0, low: 0, high: 0, width: 0 }

/**
 * Found by self-play: five generations, each tuned against the previous
 * champion until the tuner could no longer beat it. See STRATEGY.md for what
 * these numbers turn out to mean at the table, and `pnpm self-play matrix`
 * for the round robin they came from.
 */
export const TUNED: Weights = { value: 1, strength: 1, low: 1, high: -10, width: -2.5 }

export function scoreCandidate(
  candidate: Candidate,
  hand: Counts,
  weights: Weights,
): number {
  const handSize = totalOf(hand)
  // Strength matters most while there are still tricks left to survive.
  const urgency = Math.max(0, handSize - 1) / 12
  let score = 0
  let cards = 0
  for (let c = 0; c < candidate.counts.length; c++) {
    const n = candidate.counts[c]!
    if (n === 0) continue
    cards += n
    score += n * weights.value * CLASS_VALUE[c]!
    score -= n * weights.strength * c * urgency
    score -= n * weights.low * Math.max(0, 3 - c)
    if (c === HIGH_CLASS) score += n * weights.high
  }
  if (candidate.isLead) score += weights.width * (cards - 1)
  return score
}

export function heuristicPolicy(weights: Weights): Policy {
  return (view: PolicyView, candidates: Candidate[]): number => {
    if (candidates.length === 1) return 0
    const hand = view.hand
    let bestIndex = 0
    let best = -Infinity
    for (let i = 0; i < candidates.length; i++) {
      const score = scoreCandidate(candidates[i]!, hand, weights)
      if (score > best) {
        best = score
        bestIndex = i
      }
    }
    return bestIndex
  }
}

/** Plays the first legal option — the floor any real strategy must clear. */
export const firstLegalPolicy: Policy = () => 0

export function randomPolicy(pick: (max: number) => number): Policy {
  return (_view, candidates) => pick(candidates.length)
}
