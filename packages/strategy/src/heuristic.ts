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
  /** Extra reward for shedding a 7 or a Joker — an instant loss if it sticks.
   *  Self-play makes this negative early: a 7 is armour before it is a danger. */
  high: number
  /** Preference for leading several cards at once. */
  width: number
  /** Shape of the urgency curve — how sharply strength stops mattering as the
   *  hand runs down. 1 is linear; higher means strength matters right up to
   *  the end, lower means it stops mattering early. */
  gamma: number
  /** Late-hand panic: extra appetite for shedding a 7 or Joker as the reveal
   *  approaches, when there is no longer time to place it safely. */
  panic: number
  /** How much the score situation changes the appetite for shedding points.
   *  Only the highest scorer loses, so a player out in front should be keener
   *  to dump value than one trailing comfortably. */
  pressure: number
}

export const BASELINE: Weights = {
  value: 1,
  strength: 0,
  low: 0,
  high: 0,
  width: 0,
  gamma: 1,
  panic: 0,
  pressure: 0,
}

/**
 * Found by self-play: ten million matches of cross-entropy search against a
 * gauntlet of past champions. The honest headline is that it barely moved —
 * the family is converged, and the only real discovery was gamma, which says
 * trick strength keeps mattering slightly later into a hand than linearly.
 * See STRATEGY.md.
 */
export const TUNED: Weights = {
  value: 0.952,
  strength: 0.961,
  low: 0.985,
  high: -9.402,
  width: -2.309,
  gamma: 1.244,
  panic: -0.52,
  pressure: -0.089,
}

export const WEIGHT_KEYS: (keyof Weights)[] = [
  'value',
  'strength',
  'low',
  'high',
  'width',
  'gamma',
  'panic',
  'pressure',
]

/** Just enough of a PolicyView to rank a play; a PolicyView satisfies it. */
export interface ScoreContext {
  hand: Counts
  scores: readonly number[]
  seat: number
}

export function scoreCandidate(
  candidate: Candidate,
  view: ScoreContext,
  weights: Weights,
): number {
  const hand = view.hand
  const handSize = totalOf(hand)
  const remaining = Math.max(0, handSize - 1) / 12
  // Strength matters most while there are still tricks left to survive.
  const urgency = weights.gamma === 1 ? remaining : Math.pow(remaining, Math.max(0.05, weights.gamma))

  // Only the top scorer loses, so being out in front sharpens the appetite
  // for shedding points.
  let appetite = weights.value
  if (weights.pressure !== 0) {
    const mine = view.scores[view.seat]!
    const others = Math.max(
      ...[0, 1, 2].filter((s) => s !== view.seat).map((s) => view.scores[s]!),
    )
    const lead = Math.max(-1, Math.min(1, (mine - others) / 10))
    appetite = weights.value * (1 + weights.pressure * lead)
  }

  let score = 0
  let cards = 0
  for (let c = 0; c < candidate.counts.length; c++) {
    const n = candidate.counts[c]!
    if (n === 0) continue
    cards += n
    score += n * appetite * CLASS_VALUE[c]!
    score -= n * weights.strength * c * urgency
    score -= n * weights.low * Math.max(0, 3 - c)
    if (c === HIGH_CLASS) score += n * (weights.high + weights.panic * (1 - urgency))
  }
  if (candidate.isLead) score += weights.width * (cards - 1)
  return score
}

export function heuristicPolicy(weights: Weights): Policy {
  return (view: PolicyView, candidates: Candidate[]): number => {
    if (candidates.length === 1) return 0
    let bestIndex = 0
    let best = -Infinity
    for (let i = 0; i < candidates.length; i++) {
      const score = scoreCandidate(candidates[i]!, view, weights)
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
