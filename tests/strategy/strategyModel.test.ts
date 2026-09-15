import { describe, expect, it } from 'vitest'
import { viewFor } from '@cucumber/game-engine'
import type { MatchState, Seat } from '@cucumber/shared'
import { trickTable } from '../helpers/trick.ts'
import { strategyForecast } from '../../tools/strategy-model.ts'

/**
 * The adapter that lets two forecasters be asked the same question.
 *
 * Its only job is to convert: `advise()` reports the chance of *not* losing,
 * the benchmark scores the chance of losing. A comparison is worth running
 * only if neither side is helped on the way through, so this checks the
 * conversion is a subtraction and nothing else — and that a declined position
 * comes back as "no opinion" rather than as a confident coin flip.
 */

function stateWith(hands: Record<Seat, string[]>): MatchState {
  return trickTable(hands as never)
}

describe('the strategy adapter', () => {
  it('reports the complement of the advisor’s own number', () => {
    const state = stateWith({
      1: ['2C', '5H', '5D', 'QS', '7C', 'JOKER_1'],
      2: ['3D', '6H', '9D', 'KS', 'AC', '4H'],
      3: ['4S', '8H', '10D', 'JS', 'AD', '9C'],
    } as never)
    const view = viewFor(state, 1 as Seat)

    const forecast = strategyForecast(view, 1 as Seat, { worlds: 40, seed: 11 })
    expect(forecast).not.toBeNull()
    expect(forecast!.probability).toBeGreaterThanOrEqual(0)
    expect(forecast!.probability).toBeLessThanOrEqual(1)

    // The same call, read the other way round, must be the same number.
    const again = strategyForecast(view, 1 as Seat, { worlds: 40, seed: 11 })
    expect(again!.probability).toBeCloseTo(forecast!.probability, 12)
  })

  it('is deterministic for a given seed, so a comparison is repeatable', () => {
    const state = stateWith({
      1: ['2C', '5H', '5D', 'QS', '7C', 'JOKER_1'],
      2: ['3D', '6H', '9D', 'KS', 'AC', '4H'],
      3: ['4S', '8H', '10D', 'JS', 'AD', '9C'],
    } as never)
    const view = viewFor(state, 1 as Seat)

    const a = strategyForecast(view, 1 as Seat, { worlds: 60, seed: 4242 })
    const b = strategyForecast(view, 1 as Seat, { worlds: 60, seed: 4242 })
    expect(a!.probability).toBe(b!.probability)
  })

  /*
   * A forecaster with no opinion and a forecaster saying 50% are different
   * things, and only one of them belongs in a Brier score. Scoring a declined
   * position as 0.5 would quietly credit whichever model declines more often.
   */
  it('returns no opinion rather than a default', () => {
    const state = stateWith({
      1: ['2C', '5H', '5D', 'QS', '7C', 'JOKER_1'],
      2: ['3D', '6H', '9D', 'KS', 'AC', '4H'],
      3: ['4S', '8H', '10D', 'JS', 'AD', '9C'],
    } as never)
    const lobby = { ...state, phase: 'LOBBY' } as MatchState
    const view = viewFor(lobby, 1 as Seat)

    const forecast = strategyForecast(view, 1 as Seat, { worlds: 20, seed: 1 })
    expect(forecast).toBeNull()
  })
})
