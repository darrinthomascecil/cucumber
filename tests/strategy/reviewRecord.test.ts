import { describe, expect, it } from 'vitest'
import { review } from '@cucumber/strategy'
import type { Advice } from '@cucumber/strategy'
import type { PlayerView } from '@cucumber/shared'
import { emptyRecorder, record, type Played } from '../../apps/web/src/reviewRecord.ts'

/**
 * The recorder runs while the player is blind, so nothing it writes down can
 * be checked by looking at the screen. Its two jobs are to attach the advice
 * to the decision it was actually about, and to refuse to attach it when it
 * was about something else.
 */

function view(partial: Partial<PlayerView> = {}): PlayerView {
  return {
    matchId: 'm1',
    version: 10,
    handNumber: 2,
    ...partial,
  } as PlayerView
}

function advice(partial: Partial<Advice> = {}): Advice {
  return {
    kind: 'PLAY',
    winProbability: 0.8,
    worlds: 256,
    suggestions: [
      { cards: ['4S'], description: '4S', winProbability: 0.8, cost: 0 },
      { cards: ['3D'], description: '3D', winProbability: 0.55, cost: 0.25 },
    ],
    ...partial,
  } as Advice
}

const played = (over: Partial<Played> = {}): Played => ({
  view: view(),
  advice: advice(),
  adviceVersion: 10,
  cards: ['4S'],
  ...over,
})

describe('recording a decision', () => {
  it('keeps the advisor’s options alongside what was played', () => {
    const state = record(emptyRecorder, played())
    expect(state.decisions).toHaveLength(1)
    expect(state.decisions[0]!.options).toHaveLength(2)
    expect(state.decisions[0]!.played).toEqual(['4S'])
    expect(state.decisions[0]!.handNumber).toBe(2)
    expect(review(state.decisions).accuracy).toBe(1)
  })

  /*
   * The advisor answers a position asynchronously. If the player moves first,
   * the advice on hand is about the previous position, and attaching it would
   * judge them against a question they were not asked.
   */
  it('refuses advice computed for a different position', () => {
    const state = record(emptyRecorder, played({ adviceVersion: 9 }))
    expect(state.decisions).toHaveLength(1)
    expect(state.decisions[0]!.options).toEqual([])
    expect(review(state.decisions).unscored).toBe(1)
    expect(review(state.decisions).accuracy).toBe(1)
  })

  it('records a decision even when no advice arrived at all', () => {
    const state = record(emptyRecorder, played({ advice: null, adviceVersion: null }))
    expect(state.decisions).toHaveLength(1)
    expect(state.decisions[0]!.kind).toBe('NONE')
    expect(review(state.decisions).unscored).toBe(1)
  })

  it('ignores advice that is not about a play', () => {
    const odds = advice({ kind: 'ODDS_ONLY' })
    const state = record(emptyRecorder, played({ advice: odds }))
    expect(state.decisions[0]!.options).toEqual([])
  })

  it('keeps discard decisions, which are also played against a maximum', () => {
    const state = record(emptyRecorder, played({ advice: advice({ kind: 'DISCARD' }) }))
    expect(state.decisions[0]!.kind).toBe('DISCARD')
    expect(state.decisions[0]!.options).toHaveLength(2)
  })

  it('accumulates through a match', () => {
    let state = record(emptyRecorder, played())
    state = record(state, played({ view: view({ version: 11 }), adviceVersion: 11, cards: ['3D'] }))
    expect(state.decisions).toHaveLength(2)
    expect(state.matchId).toBe('m1')
    const summary = review(state.decisions)
    expect(summary.decisions).toBe(2)
    expect(summary.mistakes).toHaveLength(1)
    expect(summary.totalCost).toBeCloseTo(0.25, 12)
  })

  it('starts again when a new match begins', () => {
    let state = record(emptyRecorder, played())
    state = record(state, played({ view: view({ matchId: 'm2' }) }))
    expect(state.matchId).toBe('m2')
    expect(state.decisions).toHaveLength(1)
  })
})
