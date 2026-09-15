import { describe, expect, it } from 'vitest'
import { TUNED, heuristicPlayer, searchPlayer, trial, xorshift } from '@cucumber/strategy'

/**
 * The advisor's own odds, observed from outside the policy.
 *
 * The offline harness has to score the same claims the browser panel scores,
 * and the only way to do that honestly is to watch the number the player
 * actually acts on. So the observer must see a real probability — and, far
 * more importantly, attaching it must not change a single card that gets
 * played. A measurement that perturbs what it measures is worse than none.
 */

const WORLDS = 24
const MATCHES = 24
const SEED = 8080

function play(onEstimate?: (value: number) => void) {
  const subject = searchPlayer(
    'search',
    TUNED,
    xorshift(SEED ^ 0x9e3779b9),
    WORLDS,
    3,
    true,
    0,
    'model',
    14,
    true,
    onEstimate,
  )
  // The same opponent the published benchmark uses.
  const opponent = heuristicPlayer('heuristic', TUNED, 3)
  return trial(subject, opponent, MATCHES, xorshift(SEED), 0)
}

describe('observing the advisor', () => {
  it('reports a probability at each searched decision', () => {
    const seen: number[] = []
    play((value) => seen.push(value))

    expect(seen.length).toBeGreaterThan(MATCHES)
    for (const value of seen) {
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
    // A run of identical numbers would mean the observer is reading something
    // constant rather than the position's odds.
    expect(new Set(seen.map((v) => v.toFixed(4))).size).toBeGreaterThan(5)
  })

  it('does not change how the player plays', () => {
    const without = play()
    const with_ = play(() => {})

    // Same seed, same cards, same decisions — to the last hand.
    expect(with_.lossRate).toBe(without.lossRate)
    expect(with_.averageHands).toBe(without.averageHands)
    expect(with_.matches).toBe(without.matches)
  })

  it('is silent when nothing was searched', () => {
    // No observer attached is the default path the app and every existing
    // benchmark take; it must stay free of any recording machinery.
    expect(() => play()).not.toThrow()
  })
})
