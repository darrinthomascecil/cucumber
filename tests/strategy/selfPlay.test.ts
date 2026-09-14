import { describe, expect, it } from 'vitest'
import {
  BASELINE,
  TUNED,
  heuristicPlayer,
  playMatch,
  searchPlayer,
  simplePlayer,
  trial,
  xorshift,
  type Player,
} from '@cucumber/strategy'

/** Three identical players share the blame; ties push this above a third. */
const PARITY = 0.36

describe('self-play produces finished matches', () => {
  it('every match ends, with at least one loser', () => {
    const random = xorshift(12345)
    const player = heuristicPlayer('tuned', TUNED)
    const line: [Player, Player, Player] = [player, player, player]
    for (let m = 0; m < 300; m++) {
      const record = playMatch(line, random)
      expect(record.losers.length).toBeGreaterThan(0)
      expect(record.hands).toBeGreaterThan(0)
      expect(record.hands).toBeLessThan(60)
      const highest = Math.max(...record.scores)
      // Either somebody finished on a 7 or a Joker, or the top score reached 21.
      expect(highest >= 21 || record.hands < 60).toBe(true)
    }
  })

  it('shares the losses evenly between three identical players', () => {
    const random = xorshift(777)
    const player = heuristicPlayer('tuned', TUNED)
    const line: [Player, Player, Player] = [player, player, player]
    const losses = [0, 0, 0]
    const matches = 1500
    for (let m = 0; m < matches; m++) {
      for (const seat of playMatch(line, random).losers) losses[seat]!++
    }
    for (const count of losses) {
      expect(count / matches).toBeGreaterThan(0.25)
      expect(count / matches).toBeLessThan(0.5)
    }
  })
})

describe('the tuned strategy is actually better', () => {
  it('beats the naive points-shedding player', () => {
    const result = trial(
      heuristicPlayer('tuned', TUNED),
      heuristicPlayer('naive', BASELINE),
      1200,
      xorshift(2024),
    )
    // Naive loses far more than its share; anything near parity would mean the
    // self-play tuning achieved nothing.
    expect(result.lossRate).toBeLessThan(PARITY - 0.15)
  })

  it('beats a player that always takes the first legal option', () => {
    const result = trial(
      heuristicPlayer('tuned', TUNED),
      simplePlayer('first-legal'),
      1200,
      xorshift(4048),
    )
    expect(result.lossRate).toBeLessThan(PARITY - 0.1)
  })
})

describe('searching beats guessing', () => {
  it('loses less often than the heuristic it is built on', () => {
    const result = trial(
      searchPlayer('search', TUNED, xorshift(2718), 48),
      heuristicPlayer('heuristic', TUNED),
      400,
      xorshift(8080),
    )
    // A loose bound: the measured edge is around 12 points, and this guards
    // against the search silently degrading into the heuristic.
    expect(result.lossRate).toBeLessThan(PARITY - 0.04)
  }, 120_000)
})
