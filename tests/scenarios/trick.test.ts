import { describe, expect, it } from 'vitest'
import { applyCommand } from '@cucumber/game-engine'
import type { Seat } from '@cucumber/shared'
import { command, ctx } from '../helpers/match.js'
import { trickTable } from '../helpers/trick.js'

type Hands = Record<Seat, string[]>

describe('playing a trick', () => {
  const hands: Hands = {
    1: ['JS', 'JD', '2C', '3C'],
    2: ['QS', 'QD', '2D', '3D'],
    3: ['4S', '5S', '2H', '3H'],
  }

  it('makes followers match the leader card count', () => {
    const led = applyCommand(trickTable(hands), 1, command({ type: 'PLAY_CARDS', cards: ['JS', 'JD'] }), ctx()).state
    expect(led.trick?.playCount).toBe(2)
    expect(() => applyCommand(led, 2, command({ type: 'PLAY_CARDS', cards: ['QS'] }), ctx())).toThrow(
      /exactly 2/,
    )
    expect(() =>
      applyCommand(led, 2, command({ type: 'PLAY_CARDS', cards: ['QS', 'QD', '2D'] }), ctx()),
    ).toThrow(/exactly 2/)
  })

  it('lets followers mix ranks as long as each card meets its counterpart', () => {
    // Only the lead must be rank-uniform; the responses need not be.
    const table = trickTable({
      1: ['10S', '10D', '2C', '3C'],
      2: ['JH', 'QD', '2D', '3D'],
      3: ['QH', 'QC', '2H', '3H'],
    } as Hands)
    let state = applyCommand(table, 1, command({ type: 'PLAY_CARDS', cards: ['10S', '10D'] }), ctx()).state
    state = applyCommand(state, 2, command({ type: 'PLAY_CARDS', cards: ['JH', 'QD'] }), ctx()).state
    expect(state.trick?.successfulSeat).toBe(2)
    state = applyCommand(state, 3, command({ type: 'PLAY_CARDS', cards: ['QH', 'QC'] }), ctx()).state
    expect(state.lastTrick?.successfulSeat).toBe(3)
  })

  it('turns clockwise', () => {
    const table = trickTable(hands, 2)
    expect(table.trick?.actionSeat).toBe(2)
    const led = applyCommand(table, 2, command({ type: 'PLAY_CARDS', cards: ['QS'] }), ctx()).state
    expect(led.trick?.actionSeat).toBe(3)
  })

  it('refuses a play out of turn', () => {
    expect(() =>
      applyCommand(trickTable(hands), 3, command({ type: 'PLAY_CARDS', cards: ['4S'] }), ctx()),
    ).toThrow(/not your turn/i)
  })

  it('keeps the target on the last successful play after a forced low', () => {
    const table = trickTable({
      1: ['JS', 'JD', '2C', '3C'],
      2: ['2D', '3D', '4D', '5D'],
      3: ['QS', 'QD', '2H', '3H'],
    } as Hands)
    let state = applyCommand(table, 1, command({ type: 'PLAY_CARDS', cards: ['JS', 'JD'] }), ctx()).state
    state = applyCommand(state, 2, command({ type: 'PLAY_CARDS', cards: ['2D', '3D'] }), ctx()).state
    // Seat 2 could not qualify, so the Jacks still stand as the target.
    expect(state.trick?.targetCards).toEqual(['JS', 'JD'])
    expect(state.trick?.successfulSeat).toBe(1)
    // Seat 3 must therefore beat the Jacks, not the 2 and 3.
    expect(() =>
      applyCommand(state, 3, command({ type: 'PLAY_CARDS', cards: ['2H', '3H'] }), ctx()),
    ).toThrow(/may not play under/)
    state = applyCommand(state, 3, command({ type: 'PLAY_CARDS', cards: ['QS', 'QD'] }), ctx()).state
    expect(state.lastTrick?.successfulSeat).toBe(3)
  })
})

describe('who leads next', () => {
  it('stays with the leader when both followers fail', () => {
    const table = trickTable({
      1: ['JS', 'JD', '2C', '3C'],
      2: ['QS', '3D', '2D', '4D'],
      3: ['KS', '3H', '2H', '4H'],
    } as Hands)
    let state = applyCommand(table, 1, command({ type: 'PLAY_CARDS', cards: ['JS', 'JD'] }), ctx()).state
    state = applyCommand(state, 2, command({ type: 'PLAY_CARDS', cards: ['2D', '3D'] }), ctx()).state
    state = applyCommand(state, 3, command({ type: 'PLAY_CARDS', cards: ['2H', '3H'] }), ctx()).state
    expect(state.trick?.leaderSeat).toBe(1)
  })

  it('passes to the middle player when only they succeed', () => {
    const table = trickTable({
      1: ['JS', '2C', '3C', '4C'],
      2: ['QS', '2D', '3D', '4D'],
      3: ['2H', '3H', '4H', '5H'],
    } as Hands)
    let state = applyCommand(table, 1, command({ type: 'PLAY_CARDS', cards: ['JS'] }), ctx()).state
    state = applyCommand(state, 2, command({ type: 'PLAY_CARDS', cards: ['QS'] }), ctx()).state
    state = applyCommand(state, 3, command({ type: 'PLAY_CARDS', cards: ['2H'] }), ctx()).state
    expect(state.trick?.leaderSeat).toBe(2)
  })

  it('passes to the last player when everyone succeeds', () => {
    const table = trickTable({
      1: ['JS', '2C', '3C', '4C'],
      2: ['QS', '2D', '3D', '4D'],
      3: ['KS', '2H', '3H', '4H'],
    } as Hands)
    let state = applyCommand(table, 1, command({ type: 'PLAY_CARDS', cards: ['JS'] }), ctx()).state
    state = applyCommand(state, 2, command({ type: 'PLAY_CARDS', cards: ['QS'] }), ctx()).state
    expect(state.played).toHaveLength(0)
    state = applyCommand(state, 3, command({ type: 'PLAY_CARDS', cards: ['KS'] }), ctx()).state
    expect(state.trick?.leaderSeat).toBe(3)
    // Once all three have acted the cards leave play and a fresh trick starts.
    expect(state.played).toEqual(['JS', 'QS', 'KS'])
    expect(state.trick?.plays).toHaveLength(0)
    expect(state.trick?.targetCards).toEqual([])
  })
})

describe('the final card', () => {
  const runLastTrick = (hands: Hands) => {
    let state = trickTable(hands)
    state = applyCommand(state, 1, command({ type: 'PLAY_CARDS', cards: [hands[1][0] as string] }), ctx()).state
    state = applyCommand(state, 2, command({ type: 'PLAY_CARDS', cards: [hands[2][0] as string] }), ctx()).state
    return applyCommand(state, 3, command({ type: 'PLAY_CARDS', cards: [hands[3][0] as string] }), ctx()).state
  }

  it('reveals and scores once everyone is down to one card', () => {
    const state = runLastTrick({ 1: ['2C', '9S'], 2: ['3D', 'KH'], 3: ['4H', '5D'] } as Hands)
    expect(state.phase).toBe('FINAL_REVEAL')
    expect(state.trick).toBeNull()
    expect(state.handResult?.finalCards).toEqual({ 1: '9S', 2: 'KH', 3: '5D' })
    expect(state.handResult?.scoresAfter).toEqual({ 1: 9, 2: 10, 3: 5 })
    expect(state.handResult?.matchOver).toBe(false)
  })

  it('ends the match when a final card is a 7', () => {
    const state = runLastTrick({ 1: ['2C', '7S'], 2: ['3D', 'KH'], 3: ['4H', '5D'] } as Hands)
    expect(state.phase).toBe('MATCH_OVER')
    expect(state.losers).toEqual([1])
    expect(state.handResult?.reason).toBe('SEVEN_OR_JOKER')
  })

  it('never lets a player run out of cards early', () => {
    // With two cards each, only a single-card lead is possible.
    const table = trickTable({ 1: ['2C', '9S'], 2: ['3D', 'KH'], 3: ['4H', '5D'] } as Hands)
    expect(() =>
      applyCommand(table, 1, command({ type: 'PLAY_CARDS', cards: ['2C', '9S'] }), ctx()),
    ).toThrow(/final reveal/)
  })
})
