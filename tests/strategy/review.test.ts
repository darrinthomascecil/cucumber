import { describe, expect, it } from 'vitest'
import { NOISE, judge, review, type Decision } from '@cucumber/strategy'
import type { CardId } from '@cucumber/shared'

/**
 * The review is the only thing the player sees about their own play, and it
 * arrives when they can no longer do anything about it. So it has to be
 * right about two things in particular: it must not call a play a mistake
 * when the search cannot tell it from the best one, and it must not quietly
 * score a play the advisor never actually evaluated.
 */

function option(cards: CardId[], winProbability: number, cost: number) {
  return { cards, description: cards.join(' '), winProbability, cost }
}

function decision(played: CardId[], options: ReturnType<typeof option>[]): Decision {
  return { handNumber: 1, kind: 'PLAY', options, played, odds: options[0]?.winProbability ?? 0 }
}

describe('judging one decision', () => {
  it('costs nothing when the best play was found', () => {
    const d = decision(['4S', '4H'], [option(['4S', '4H'], 0.84, 0), option(['3D'], 0.61, 0.23)])
    const j = judge(d)
    expect(j.cost).toBe(0)
    expect(j.withinNoise).toBe(true)
    expect(j.chosen?.cards).toEqual(['4S', '4H'])
  })

  it('costs the difference when a better play existed', () => {
    const d = decision(['3D'], [option(['4S'], 0.84, 0), option(['3D'], 0.61, 0.23)])
    expect(judge(d).cost).toBeCloseTo(0.23, 12)
    expect(judge(d).withinNoise).toBe(false)
  })

  it('does not care what order the cards were played in', () => {
    const d = decision(['4H', '4S'], [option(['4S', '4H'], 0.84, 0)])
    expect(judge(d).chosen).not.toBeNull()
    expect(judge(d).cost).toBe(0)
  })

  /*
   * The one that matters. ADVISOR.md: "an alternative at −0% or −1% is not
   * reliably worse." Painting that red would be inventing a finding out of
   * the estimator's own noise.
   */
  it('calls a difference inside the noise no mistake at all', () => {
    const d = decision(['3D'], [option(['4S'], 0.8, 0), option(['3D'], 0.79, 0.01)])
    const j = judge(d)
    expect(j.cost).toBeCloseTo(0.01, 12)
    expect(j.withinNoise).toBe(true)
    expect(review([d]).mistakes).toHaveLength(0)
    expect(review([d]).accuracy).toBe(1)
  })

  it('takes a stricter noise floor when told to', () => {
    const d = decision(['3D'], [option(['4S'], 0.8, 0), option(['3D'], 0.79, 0.01)])
    expect(judge(d, 0.005).withinNoise).toBe(false)
  })

  it('does not assume the options arrived in order', () => {
    const d = decision(['3D'], [option(['3D'], 0.61, 0.23), option(['4S'], 0.84, 0)])
    expect(judge(d).best?.cards).toEqual(['4S'])
    expect(judge(d).cost).toBeCloseTo(0.23, 12)
  })

  it('scores nothing for a play the advisor never evaluated', () => {
    // The action list is screened before the search, so a play it never
    // considered has no value. Charging the player for it would be fiction.
    const d = decision(['7C'], [option(['4S'], 0.84, 0), option(['3D'], 0.61, 0.23)])
    const j = judge(d)
    expect(j.chosen).toBeNull()
    expect(j.cost).toBe(0)
    expect(review([d]).unscored).toBe(1)
    expect(review([d]).accuracy).toBe(1)
  })
})

describe('reviewing a match', () => {
  const perfect = [
    decision(['4S'], [option(['4S'], 0.84, 0), option(['3D'], 0.61, 0.23)]),
    decision(['9H'], [option(['9H'], 0.9, 0), option(['2C'], 0.88, 0.02)]),
  ]

  it('finds no mistakes in a match played at the maximum', () => {
    const r = review(perfect)
    expect(r.mistakes).toHaveLength(0)
    expect(r.totalCost).toBe(0)
    expect(r.accuracy).toBe(1)
    expect(r.worstMoment).toBeNull()
  })

  it('adds up what was handed back, and names the worst moment', () => {
    const r = review([
      ...perfect,
      decision(['3D'], [option(['4S'], 0.84, 0), option(['3D'], 0.61, 0.23)]),
      decision(['2C'], [option(['KD'], 0.5, 0), option(['2C'], 0.44, 0.06)]),
    ])
    expect(r.decisions).toBe(4)
    expect(r.mistakes).toHaveLength(2)
    expect(r.totalCost).toBeCloseTo(0.29, 12)
    expect(r.worstMoment?.cost).toBeCloseTo(0.23, 12)
    expect(r.accuracy).toBeCloseTo(0.5, 12)
  })

  it('says nothing went wrong when nothing was played', () => {
    const r = review([])
    expect(r.decisions).toBe(0)
    expect(r.accuracy).toBe(1)
    expect(r.worstMoment).toBeNull()
  })

  it('uses the documented noise floor by default', () => {
    expect(NOISE).toBe(0.02)
  })
})
