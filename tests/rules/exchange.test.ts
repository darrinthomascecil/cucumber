import { describe, expect, it } from 'vitest'
import { IllegalMoveError, applyCommand, sortByTrickStrength } from '@cucumber/game-engine'
import { SEATS, leftOf, type Seat } from '@cucumber/shared'
import { command, ctx, startedMatch } from '../helpers/match.ts'
import { runExchange } from '../helpers/autoplay.ts'

describe('exchange size selection', () => {
  it('only the dealer may choose', () => {
    const state = startedMatch()
    const notDealer = leftOf(state.dealerSeat as Seat)
    expect(() =>
      applyCommand(state, notDealer, command({ type: 'SELECT_EXCHANGE_SIZE', size: 3 }), ctx()),
    ).toThrow(/not your turn/i)
  })

  it('accepts 0 through 5', () => {
    const state = startedMatch()
    for (const size of [0, 1, 2, 3, 4, 5]) {
      expect(() =>
        applyCommand(state, state.dealerSeat as Seat, command({ type: 'SELECT_EXCHANGE_SIZE', size }), ctx()),
      ).not.toThrow()
    }
  })

  it('rejects anything outside 0 to 5', () => {
    const state = startedMatch()
    for (const size of [-1, 6, 13, 1.5]) {
      expect(() =>
        applyCommand(state, state.dealerSeat as Seat, command({ type: 'SELECT_EXCHANGE_SIZE', size }), ctx()),
      ).toThrow(IllegalMoveError)
    }
  })

  it('goes straight to trick play when the dealer chooses 0', () => {
    const state = startedMatch()
    const after = applyCommand(
      state,
      state.dealerSeat as Seat,
      command({ type: 'SELECT_EXCHANGE_SIZE', size: 0 }),
      ctx(),
    ).state
    expect(after.phase).toBe('TRICK_PLAY')
    expect(after.stock).toHaveLength(15)
    for (const seat of SEATS) expect(after.hands[seat]).toHaveLength(13)
  })
})

describe('exchanging cards', () => {
  it('draws for the dealer immediately — the dealer must exchange exactly N', () => {
    const state = startedMatch()
    const dealer = state.dealerSeat as Seat
    const after = applyCommand(state, dealer, command({ type: 'SELECT_EXCHANGE_SIZE', size: 4 }), ctx())
      .state
    expect(after.phase).toBe('EXCHANGE')
    expect(after.hands[dealer]).toHaveLength(17)
    expect(after.exchange?.step).toBe('DISCARD')
    expect(after.stock).toHaveLength(11)
  })

  it('lets the other players take 0 or N and nothing between', () => {
    const state = startedMatch()
    const dealer = state.dealerSeat as Seat
    let current = applyCommand(state, dealer, command({ type: 'SELECT_EXCHANGE_SIZE', size: 4 }), ctx()).state
    const discards = sortByTrickStrength(current.hands[dealer]).slice(0, 4)
    current = applyCommand(current, dealer, command({ type: 'SUBMIT_DISCARDS', cards: discards }), ctx()).state

    const next = leftOf(dealer)
    for (const bad of [1, 2, 3, 5]) {
      expect(() =>
        applyCommand(current, next, command({ type: 'SELECT_EXCHANGE', size: bad }), ctx()),
      ).toThrow(/0 or 4/)
    }
    expect(() => applyCommand(current, next, command({ type: 'SELECT_EXCHANGE', size: 0 }), ctx())).not.toThrow()
    expect(() => applyCommand(current, next, command({ type: 'SELECT_EXCHANGE', size: 4 }), ctx())).not.toThrow()
  })

  it('returns every hand to exactly 13 cards', () => {
    for (const size of [1, 3, 5]) {
      const after = runExchange(startedMatch(size * 7), size, ctx())
      expect(after.phase).toBe('TRICK_PLAY')
      for (const seat of SEATS) expect(after.hands[seat]).toHaveLength(13)
    }
  })

  it('takes discards out of play rather than back to the stock', () => {
    const after = runExchange(startedMatch(), 5, ctx())
    expect(after.discards).toHaveLength(15)
    expect(after.stock).toHaveLength(0)
    const inPlay = new Set([...after.hands[1], ...after.hands[2], ...after.hands[3]])
    for (const card of after.discards) expect(inPlay.has(card)).toBe(false)
  })

  it('requires exactly N discards, from anywhere in the enlarged hand', () => {
    const state = startedMatch()
    const dealer = state.dealerSeat as Seat
    const drawn = applyCommand(state, dealer, command({ type: 'SELECT_EXCHANGE_SIZE', size: 2 }), ctx()).state
    const hand = drawn.hands[dealer]
    expect(() =>
      applyCommand(drawn, dealer, command({ type: 'SUBMIT_DISCARDS', cards: [hand[0] as string] }), ctx()),
    ).toThrow(/exactly 2/)
    // The two just drawn sit at the end of the hand and may be thrown straight back.
    const justDrawn = hand.slice(-2)
    expect(() =>
      applyCommand(drawn, dealer, command({ type: 'SUBMIT_DISCARDS', cards: justDrawn }), ctx()),
    ).not.toThrow()
  })

  it('exchanges in dealer order, clockwise', () => {
    const state = startedMatch()
    const dealer = state.dealerSeat as Seat
    const after = applyCommand(state, dealer, command({ type: 'SELECT_EXCHANGE_SIZE', size: 2 }), ctx()).state
    expect(after.exchange?.order).toEqual([dealer, leftOf(dealer), leftOf(leftOf(dealer))])
  })
})
