import { describe, expect, it } from 'vitest'
import { computeHandResult } from '@cucumber/game-engine'
import type { CardId, Seat } from '@cucumber/shared'

function result(finals: [CardId, CardId, CardId], before: [number, number, number]) {
  return computeHandResult(
    1,
    { 1: finals[0], 2: finals[1], 3: finals[2] } as Record<Seat, CardId>,
    { 1: before[0], 2: before[1], 3: before[2] } as Record<Seat, number>,
  )
}

describe('normal hand scoring', () => {
  it('adds the final card values to the cumulative scores', () => {
    const scored = result(['3S', '9H', 'KD'], [11, 14, 8])
    expect(scored.scoresAfter).toEqual({ 1: 14, 2: 23, 3: 18 })
  })

  it('keeps playing while everyone is under 21', () => {
    const scored = result(['3S', '4H', '5D'], [0, 0, 0])
    expect(scored.matchOver).toBe(false)
    expect(scored.reason).toBe('CONTINUE')
    expect(scored.losers).toEqual([])
  })

  it('ends the match on the highest score once anyone reaches 21', () => {
    const scored = result(['3S', '9H', 'KD'], [11, 14, 8])
    expect(scored.matchOver).toBe(true)
    expect(scored.reason).toBe('SCORE_LIMIT')
    expect(scored.losers).toEqual([2])
  })

  it('does not punish a lower player who also crossed 21', () => {
    const scored = result(['2S', '2H', '2D'], [20, 24, 12])
    expect(scored.scoresAfter).toEqual({ 1: 22, 2: 26, 3: 14 })
    expect(scored.losers).toEqual([2])
  })

  it('records a tied loss on an exact tie at the top', () => {
    const scored = result(['3S', '3H', '2D'], [20, 20, 15])
    expect(scored.scoresAfter).toEqual({ 1: 23, 2: 23, 3: 17 })
    expect(scored.losers).toEqual([1, 2])
    expect(scored.matchOver).toBe(true)
  })

  it('exactly 21 is a loss, 20 is not', () => {
    expect(result(['2S', '3H', '4D'], [19, 0, 0]).losers).toEqual([1])
    expect(result(['2S', '3H', '4D'], [18, 0, 0]).matchOver).toBe(false)
  })
})

describe('7 and joker instant loss', () => {
  it('loses the match regardless of the cumulative scores', () => {
    const scored = result(['7S', 'KH', '2D'], [0, 19, 0])
    expect(scored.reason).toBe('SEVEN_OR_JOKER')
    expect(scored.losers).toEqual([1])
    expect(scored.instantLossSeats).toEqual([1])
    expect(scored.matchOver).toBe(true)
  })

  it('outranks a much higher score elsewhere', () => {
    const scored = result(['7S', 'KH', '2D'], [0, 19, 0])
    expect(scored.scoresAfter[2]).toBe(29)
    expect(scored.losers).not.toContain(2)
  })

  it('a joker loses exactly as a 7 does', () => {
    expect(result(['2S', 'JOKER_1', '3D'], [0, 0, 0]).losers).toEqual([2])
  })

  it('makes every holder of a 7 or joker a loser, with no tiebreaker', () => {
    const scored = result(['7S', 'JOKER_1', '9D'], [0, 0, 0])
    expect(scored.losers).toEqual([1, 2])
    expect(scored.losers).not.toContain(3)
  })

  it('can lose all three seats at once', () => {
    expect(result(['7S', '7H', 'JOKER_2'], [0, 0, 0]).losers).toEqual([1, 2, 3])
  })
})
