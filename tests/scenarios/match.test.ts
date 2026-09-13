import { describe, expect, it } from 'vitest'
import { applyCommand, createMatch, setConnection, viewFor } from '@cucumber/game-engine'
import { SEATS, leftOf, type Seat } from '@cucumber/shared'
import { command, ctx, newMatch, startedMatch } from '../helpers/match.js'
import { chooseCards, playOutHand, runExchange } from '../helpers/autoplay.js'

describe('starting a match', () => {
  it('stays in the lobby until all three are ready', () => {
    const context = ctx()
    let state = newMatch()
    state = applyCommand(state, 1, command({ type: 'READY', ready: true }), context).state
    expect(state.phase).toBe('LOBBY')
    state = applyCommand(state, 2, command({ type: 'READY', ready: true }), context).state
    expect(state.phase).toBe('LOBBY')
    state = applyCommand(state, 3, command({ type: 'READY', ready: true }), context).state
    expect(state.phase).toBe('EXCHANGE_SIZE_SELECTION')
  })

  it('will not start while a player is offline', () => {
    const context = ctx()
    let state = createMatch('m', [
      { userId: 'a', displayName: 'Alice' },
      { userId: 'b', displayName: 'Bob' },
      { userId: 'c', displayName: 'Charlie' },
    ])
    state = setConnection(state, 1, 'ONLINE').state
    state = setConnection(state, 2, 'ONLINE').state
    for (const seat of SEATS) {
      state = applyCommand(state, seat, command({ type: 'READY', ready: true }), context).state
    }
    expect(state.phase).toBe('LOBBY')
    state = setConnection(state, 3, 'ONLINE').state
    state = applyCommand(state, 3, command({ type: 'READY', ready: true }), context).state
    expect(state.phase).toBe('EXCHANGE_SIZE_SELECTION')
  })

  it('deals 13 to each seat and 15 to the stock', () => {
    const state = startedMatch()
    for (const seat of SEATS) expect(state.hands[seat]).toHaveLength(13)
    expect(state.stock).toHaveLength(15)
    expect(state.handNumber).toBe(1)
    expect(state.dealerSeat).not.toBeNull()
  })

  it('picks the first dealer at random', () => {
    const dealers = new Set<Seat>()
    for (let seed = 1; seed < 60; seed++) dealers.add(startedMatch(seed).dealerSeat as Seat)
    expect(dealers.size).toBeGreaterThan(1)
  })
})

describe('a whole hand', () => {
  it('runs from the deal to the reveal with every seat losing cards in step', () => {
    const context = ctx(4242)
    let state = runExchange(startedMatch(4242), 3, context)
    const sizes: number[] = []
    while (state.phase === 'TRICK_PLAY') {
      const seat = state.trick!.actionSeat
      if (state.trick!.plays.length === 0) {
        // Everyone plays the same count, so hands are level at each new trick.
        const level = SEATS.map((s) => state.hands[s].length)
        expect(new Set(level).size).toBe(1)
        sizes.push(level[0] as number)
      }
      state = applyCommand(
        state,
        seat,
        command({ type: 'PLAY_CARDS', cards: chooseCards(state, seat) }),
        context,
      ).state
    }
    expect(sizes[0]).toBe(13)
    expect(state.phase === 'FINAL_REVEAL' || state.phase === 'MATCH_OVER').toBe(true)
    for (const seat of SEATS) expect(state.hands[seat]).toHaveLength(1)
    expect(state.handResult).not.toBeNull()
  })

  it('accounts for all 54 cards at the reveal', () => {
    const context = ctx(777)
    const state = playOutHand(runExchange(startedMatch(777), 5, context), context)
    const all = [
      ...state.hands[1],
      ...state.hands[2],
      ...state.hands[3],
      ...state.stock,
      ...state.discards,
      ...state.played,
    ]
    expect(all).toHaveLength(54)
    expect(new Set(all).size).toBe(54)
  })
})

describe('a whole match', () => {
  it('rotates the deal clockwise and accumulates scores until someone loses', () => {
    const context = ctx(31337)
    let state = startedMatch(31337)
    const dealers: Seat[] = []
    let hands = 0

    while (state.phase !== 'MATCH_OVER') {
      dealers.push(state.dealerSeat as Seat)
      state = playOutHand(runExchange(state, hands % 6, context), context)
      hands++
      if (state.phase !== 'FINAL_REVEAL') break
      const before = state.handResult!.scoresBefore
      const after = state.handResult!.scoresAfter
      for (const seat of SEATS) expect(after[seat]).toBeGreaterThanOrEqual(before[seat])
      for (const seat of SEATS) {
        state = applyCommand(state, seat, command({ type: 'READY', ready: true }), context).state
      }
      if (hands > 40) throw new Error('Match did not finish')
    }

    expect(hands).toBeGreaterThan(0)
    for (let i = 1; i < dealers.length; i++) {
      expect(dealers[i]).toBe(leftOf(dealers[i - 1] as Seat))
    }
    expect(state.losers.length).toBeGreaterThan(0)
    const result = state.handResult!
    if (result.reason === 'SCORE_LIMIT') {
      const top = Math.max(...SEATS.map((seat) => result.scoresAfter[seat]))
      expect(top).toBeGreaterThanOrEqual(21)
      expect(state.losers.every((seat) => result.scoresAfter[seat] === top)).toBe(true)
    }
  })

  it('starts a fresh match with scores reset and everyone still seated', () => {
    const context = ctx(2024)
    let state = startedMatch(2024)
    let guard = 0
    while (state.phase !== 'MATCH_OVER') {
      if (guard++ > 40) throw new Error('Match did not finish')
      state = playOutHand(runExchange(state, 2, context), context)
      if (state.phase !== 'FINAL_REVEAL') break
      for (const seat of SEATS) {
        state = applyCommand(state, seat, command({ type: 'READY', ready: true }), context).state
      }
    }
    const next = applyCommand(state, 1, command({ type: 'START_NEXT_MATCH' }), context).state
    expect(next.phase).toBe('LOBBY')
    expect(next.handNumber).toBe(0)
    expect(next.losers).toEqual([])
    for (const seat of SEATS) {
      expect(next.players.find((p) => p.seat === seat)?.score).toBe(0)
      expect(next.players.find((p) => p.seat === seat)?.ready).toBe(false)
      expect(next.players.find((p) => p.seat === seat)?.userId).toBe(
        state.players.find((p) => p.seat === seat)?.userId,
      )
    }
  })
})

describe('hidden information', () => {
  it('shows a player their own hand and nobody else’s', () => {
    const state = startedMatch()
    const view = viewFor(state, 1)
    expect(view.you.hand).toEqual(state.hands[1])
    const serialised = JSON.stringify(view)
    for (const card of [...state.hands[2], ...state.hands[3]]) {
      expect(serialised).not.toContain(card)
    }
  })

  it('never leaks the stock or the discards', () => {
    const context = ctx()
    const state = runExchange(startedMatch(), 5, context)
    const view = viewFor(state, 1)
    const serialised = JSON.stringify(view)
    for (const card of state.discards) expect(serialised).not.toContain(card)
    expect(view.stockCount).toBe(state.stock.length)
  })

  it('reports opponents only as card counts until the reveal', () => {
    const state = startedMatch()
    const view = viewFor(state, 2)
    const others = view.players.filter((player) => player.seat !== 2)
    for (const player of others) {
      expect(player.cardCount).toBe(13)
      expect(player.finalCard).toBeNull()
    }
  })

  it('reveals all three final cards at the end of a hand', () => {
    const context = ctx(55)
    const state = playOutHand(runExchange(startedMatch(55), 0, context), context)
    const view = viewFor(state, 3)
    for (const player of view.players) expect(player.finalCard).not.toBeNull()
  })
})

