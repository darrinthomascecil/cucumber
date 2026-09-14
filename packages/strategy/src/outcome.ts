import { CLASS_VALUE, HIGH_CLASS, type CardClass } from './classes.ts'
import type { SeatIndex } from './sim.ts'

export const LOSS_LIMIT = 21

export interface HandOutcome {
  scores: [number, number, number]
  losers: SeatIndex[]
  matchOver: boolean
}

/** Spec §26-§30, in the strategy's own terms. */
export function settleHand(
  before: readonly [number, number, number],
  finals: readonly [CardClass, CardClass, CardClass],
): HandOutcome {
  const scores: [number, number, number] = [
    before[0] + CLASS_VALUE[finals[0]]!,
    before[1] + CLASS_VALUE[finals[1]]!,
    before[2] + CLASS_VALUE[finals[2]]!,
  ]
  const instant: SeatIndex[] = []
  for (let seat = 0 as SeatIndex; seat < 3; seat = (seat + 1) as SeatIndex) {
    if (finals[seat] === HIGH_CLASS) instant.push(seat)
  }
  if (instant.length > 0) return { scores, losers: instant, matchOver: true }

  const highest = Math.max(scores[0], scores[1], scores[2])
  if (highest >= LOSS_LIMIT) {
    const losers: SeatIndex[] = []
    for (let seat = 0 as SeatIndex; seat < 3; seat = (seat + 1) as SeatIndex) {
      if (scores[seat] === highest) losers.push(seat)
    }
    return { scores, losers, matchOver: true }
  }
  return { scores, losers: [], matchOver: false }
}

/**
 * How safe a set of cumulative scores is for one seat, as a probability of
 * *not* losing the match. Only the highest scorer loses, so what matters is
 * the gap to the others, not the absolute total.
 *
 * The shape is fitted from self-play; `tools/fit-continuation.ts` regenerates
 * the constants and the test in tests/strategy checks they still hold.
 */
export interface ContinuationModel {
  /** Scale of the logistic in points. */
  temperature: number
  /** Weight on how much headroom remains before 21. */
  headroom: number
}

export const DEFAULT_CONTINUATION: ContinuationModel = {
  temperature: 6.5,
  headroom: 0.35,
}

export function survivalValue(
  scores: readonly [number, number, number],
  seat: SeatIndex,
  model: ContinuationModel = DEFAULT_CONTINUATION,
): number {
  // Risk rises as a player approaches 21 and as they lead the field.
  const risk: number[] = []
  for (let i = 0; i < 3; i++) {
    const others = [0, 1, 2].filter((o) => o !== i).map((o) => scores[o]!)
    const lead = scores[i]! - Math.max(...others)
    const pressure = lead / model.temperature + (model.headroom * scores[i]!) / model.temperature
    risk.push(Math.exp(pressure))
  }
  const total = risk[0]! + risk[1]! + risk[2]!
  return 1 - risk[seat]! / total
}

/** Terminal value of a finished hand for one seat: 1 is safe, 0 is lost. */
export function handValue(
  outcome: HandOutcome,
  seat: SeatIndex,
  model: ContinuationModel = DEFAULT_CONTINUATION,
): number {
  if (outcome.matchOver) return outcome.losers.includes(seat) ? 0 : 1
  return survivalValue(outcome.scores, seat, model)
}
