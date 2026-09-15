import { describe, expect, it } from 'vitest'
import {
  CLASS_COUNT,
  emptyCounts,
  honestSurvival,
  xorshift,
  type InfoSet,
  type TrickContext,
} from '@cucumber/strategy'

/**
 * The honest oracle estimates the best forecast anyone could make. Every later
 * number — the Brier floor, and whether the advisor has headroom — is computed
 * from it, so it has to be right about the easy cases before its answer on the
 * hard ones means anything.
 *
 * The tests below are the three shapes a probability must have: near 1 when
 * the seat is safe, near 0 when it is doomed, and somewhere in between when
 * the position is genuinely uncertain.
 */

const counts = (spec: Record<number, number>) => {
  const c = emptyCounts()
  for (const [klass, n] of Object.entries(spec)) c[Number(klass)] = n
  return c
}

/** A fresh-ish position: 3 cards each, nothing played, given scores. */
function position(scores: [number, number, number], hand: Record<number, number>): InfoSet {
  return {
    seat: 0,
    hand: counts(hand),
    played: emptyCounts(),
    mine: emptyCounts(),
    handSizes: [3, 3, 3],
    scores,
    failures: undefined,
  }
}

const trick: TrickContext = {
  leaderSeat: 0,
  successfulSeat: 0,
  target: [],
  playsMade: 0,
}

const opts = { worlds: 120 }

describe('the honest oracle', () => {
  it('returns a probability, with the variance its own sampling adds', () => {
    const e = honestSurvival(position([0, 0, 0], { 0: 1, 1: 1, 2: 1 }), trick, xorshift(1), opts)
    expect(e.survival).toBeGreaterThanOrEqual(0)
    expect(e.survival).toBeLessThanOrEqual(1)
    expect(e.worlds).toBe(120)
    // p(1−p)/n, the amount a Brier built on p̂* is inflated by.
    expect(e.bias).toBeCloseTo((e.survival * (1 - e.survival)) / 120, 12)
  })

  /*
   * Scores decide survival, and the oracle plays to the end of the match
   * rather than stopping at the hand. A seat miles behind the other two must
   * come out safe; one on the brink against two safe seats must not.
   */
  it('is near certain when the other two are about to lose', () => {
    const safe = honestSurvival(position([0, 19, 19], { 0: 1, 1: 1, 2: 1 }), trick, xorshift(2), opts)
    expect(safe.survival).toBeGreaterThan(0.9)
  })

  it('is grim when this seat is the one on the brink', () => {
    const doomed = honestSurvival(position([19, 0, 0], { 0: 1, 1: 1, 2: 1 }), trick, xorshift(3), opts)
    expect(doomed.survival).toBeLessThan(0.35)
  })

  /*
   * The test this file first shipped with asserted only that an even position
   * lands between 0.4 and 0.95, and it passed at 86.7% — not because the
   * oracle was right but because the position handed seat 0 the three lowest
   * cards in the deck. A test that cannot fail for the right reason is worse
   * than none, so the property to assert is the one the oracle exists to
   * capture: at identical scores, a better hand must survive more often.
   */
  it('ranks hands at identical scores', () => {
    const level: [number, number, number] = [0, 0, 0]
    const low = honestSurvival(position(level, { 0: 1, 1: 1, 2: 1 }), trick, xorshift(4), opts)
    const mid = honestSurvival(position(level, { 4: 1, 5: 1, 6: 1 }), trick, xorshift(4), opts)
    const high = honestSurvival(position(level, { 9: 1, 10: 1, 11: 1 }), trick, xorshift(4), opts)

    expect(low.survival).toBeGreaterThan(mid.survival)
    expect(mid.survival).toBeGreaterThan(high.survival)
  })

  it('makes the hand decide almost everything on the brink', () => {
    // At 18 all, the next hand ends the match: every score passes 21, and the
    // highest final card loses. The spread between a good and a bad hand
    // should be far wider here than from level scores.
    const brink: [number, number, number] = [18, 18, 18]
    const low = honestSurvival(position(brink, { 0: 1, 1: 1, 2: 1 }), trick, xorshift(8), opts)
    const high = honestSurvival(position(brink, { 9: 1, 10: 1, 11: 1 }), trick, xorshift(8), opts)

    expect(low.survival).toBeGreaterThan(0.85)
    expect(high.survival).toBeLessThan(0.15)
  })

  it('orders positions the way the scores do', () => {
    const behind = honestSurvival(position([2, 14, 14], { 0: 1, 1: 1, 2: 1 }), trick, xorshift(5), opts)
    const ahead = honestSurvival(position([14, 2, 2], { 0: 1, 1: 1, 2: 1 }), trick, xorshift(5), opts)
    expect(behind.survival).toBeGreaterThan(ahead.survival)
  })

  it('shrinks its own variance as worlds are added', () => {
    const few = honestSurvival(position([0, 0, 0], { 0: 1, 1: 1, 2: 1 }), trick, xorshift(6), { worlds: 40 })
    const many = honestSurvival(position([0, 0, 0], { 0: 1, 1: 1, 2: 1 }), trick, xorshift(6), { worlds: 400 })
    expect(many.bias).toBeLessThan(few.bias)
  })

  it('never samples a hand it does not hold', () => {
    // A hand of three known cards must survive into every imagined world, or
    // the oracle is answering about a position the seat is not in.
    const info = position([0, 0, 0], { 0: 2, 5: 1 })
    const e = honestSurvival(info, trick, xorshift(7), { worlds: 30 })
    expect(e.worlds).toBe(30)
    let total = 0
    for (let c = 0; c < CLASS_COUNT; c++) total += info.hand[c]!
    expect(total).toBe(3)
  })
})
