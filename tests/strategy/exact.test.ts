import { describe, expect, it } from 'vitest'
import {
  CLASS_COUNT,
  emptyCounts,
  exactFinalSurvival,
  honestSurvival,
  xorshift,
  type InfoSet,
  type TrickContext,
} from '@cucumber/strategy'

/**
 * The exact enumerator, and the sampler checked against it.
 *
 * Every other number in this project is Monte Carlo, and a calibration
 * statistic can only say an estimator is consistent — never that it is right.
 * This slice is small enough to compute outright, so it is the one place
 * `honestSurvival` can be checked against a truth rather than against itself.
 */

/** Every seat on its last card, with the observer holding `mine`. */
function endgame(scores: [number, number, number], mine: number, played: number[] = []): InfoSet {
  const hand = emptyCounts()
  hand[mine] = 1
  const out = emptyCounts()
  for (const c of played) out[c]!++
  return {
    seat: 0,
    hand,
    played: out,
    mine: emptyCounts(),
    handSizes: [1, 1, 1],
    scores,
    failures: undefined,
  }
}

const trick: TrickContext = { leaderSeat: 0, successfulSeat: 0, target: [], playsMade: 0 }

describe('the exact endgame enumerator', () => {
  it('refuses positions outside its slice', () => {
    // More than one card left: there is play still to model.
    const midHand = endgame([20, 20, 20], 0)
    midHand.handSizes = [3, 1, 1]
    expect(exactFinalSurvival(midHand)).toBeNull()

    // A hand that does not end the match: what follows is fresh deals.
    expect(exactFinalSurvival(endgame([0, 0, 0], 0))).toBeNull()
  })

  it('counts ordered assignments of two distinct cards', () => {
    const e = exactFinalSurvival(endgame([20, 20, 20], 0))
    expect(e).not.toBeNull()
    // Pool is 54 less my one card less nothing played: 53 cards, and the two
    // opponents take an ordered pair from it.
    expect(e!.assignments).toBe(53 * 52)
  })

  it('is certain when this seat cannot lose', () => {
    // Holding a 2 at 0 while both opponents sit on 20: any card they hold
    // takes them past 21, and the highest score loses.
    const safe = exactFinalSurvival(endgame([0, 20, 20], 0))
    expect(safe).not.toBeNull()
    expect(safe!.survival).toBe(1)
  })

  it('is certain when this seat cannot survive', () => {
    // A 7 or Joker in hand loses outright, whatever anyone else holds.
    const doomed = exactFinalSurvival(endgame([0, 0, 0], CLASS_COUNT - 1))
    expect(doomed).not.toBeNull()
    expect(doomed!.survival).toBe(0)
  })

  /*
   * The check this file exists for. `honestSurvival` samples; this enumerates.
   * On the slice where both apply they must agree, and the sampler's error
   * should shrink as its budget grows — if it converged to the wrong number,
   * no amount of calibration testing would have found it.
   */
  it('agrees with the sampled oracle, and the sampler converges to it', () => {
    for (const scores of [
      [20, 20, 20],
      [19, 20, 21 - 1],
      [0, 20, 20],
    ] as [number, number, number][]) {
      for (const mine of [0, 4, 9]) {
        const info = endgame(scores, mine)
        const exact = exactFinalSurvival(info)
        if (exact === null) continue

        const few = honestSurvival(info, trick, xorshift(7), { worlds: 60 })
        const many = honestSurvival(info, trick, xorshift(7), { worlds: 4000 })

        // Four standard errors of the larger sample, floored so a certainty
        // does not demand exactness from a finite draw.
        const tolerance = Math.max(0.02, 4 * Math.sqrt(exact.survival * (1 - exact.survival) / 4000))
        expect(Math.abs(many.survival - exact.survival)).toBeLessThan(tolerance)
        // More worlds must not be further away than fewer.
        expect(Math.abs(many.survival - exact.survival)).toBeLessThanOrEqual(
          Math.abs(few.survival - exact.survival) + 0.02,
        )
      }
    }
  })
})
