import { describe, expect, it } from 'vitest'
import { validateFollow, validateLead, viewFor } from '@cucumber/game-engine'
import type { CardId, MatchState, Seat } from '@cucumber/shared'
import { advise, emptyMemory } from '@cucumber/strategy'
import { trickTable } from '../helpers/trick.ts'

type Hands = Record<Seat, CardId[]>

const options = { worlds: 40, seed: 20260913 }

function viewOf(state: MatchState, seat: Seat) {
  return viewFor(state, seat)
}

describe('the advisor only suggests legal plays', () => {
  it('suggests leads the engine accepts', () => {
    const state = trickTable({
      1: ['2C', '5H', '5D', 'QS', '7C', 'JOKER_1'],
      2: ['3D', '6H', '9D', 'KS', 'AC', '4H'],
      3: ['4S', '8H', '10D', 'JS', 'AD', '9C'],
    } as Hands)
    const advice = advise(viewOf(state, 1), emptyMemory(), options)
    expect(advice.kind).toBe('PLAY')
    expect(advice.suggestions.length).toBeGreaterThan(0)
    for (const suggestion of advice.suggestions) {
      expect(() => validateLead(state.hands[1], suggestion.cards)).not.toThrow()
    }
  })

  it('suggests follows the engine accepts', () => {
    let state = trickTable({
      1: ['QS', 'QD', '2C', '3C'],
      2: ['KS', 'KD', '4D', '5D'],
      3: ['AS', 'AD', '6H', '7H'],
    } as Hands)
    // Seat 1 leads a pair of queens; seat 2 must answer.
    state = {
      ...state,
      hands: { ...state.hands, 1: ['2C', '3C'] },
      trick: {
        leaderSeat: 1,
        playCount: 2,
        actionSeat: 2,
        targetCards: ['QS', 'QD'],
        targetSeat: 1,
        successfulSeat: 1,
        plays: [{ seat: 1, cards: ['QS', 'QD'], successful: true }],
      },
    }
    const advice = advise(viewOf(state, 2), emptyMemory(), options)
    expect(advice.kind).toBe('PLAY')
    for (const suggestion of advice.suggestions) {
      expect(suggestion.cards).toHaveLength(2)
      expect(() => validateFollow(state.hands[2], ['QS', 'QD'], suggestion.cards)).not.toThrow()
    }
  })

  it('offers the single forced play when nothing qualifies', () => {
    let state = trickTable({
      1: ['AS', 'AD', '2C', '3C'],
      2: ['2D', '3D', '4D', '5D'],
      3: ['KS', 'KD', '6H', '8H'],
    } as Hands)
    state = {
      ...state,
      hands: { ...state.hands, 1: ['2C', '3C'] },
      trick: {
        leaderSeat: 1,
        playCount: 2,
        actionSeat: 2,
        targetCards: ['AS', 'AD'],
        targetSeat: 1,
        successfulSeat: 1,
        plays: [{ seat: 1, cards: ['AS', 'AD'], successful: true }],
      },
    }
    const advice = advise(viewOf(state, 2), emptyMemory(), options)
    expect(advice.suggestions).toHaveLength(1)
    expect(advice.note).toMatch(/cannot meet/)
    expect(() => validateFollow(state.hands[2], ['AS', 'AD'], advice.suggestions[0]!.cards)).not.toThrow()
  })

  it('only ever names cards the player is holding', () => {
    const state = trickTable({
      1: ['2C', '5H', '5D', 'QS', '7C', 'JOKER_1'],
      2: ['3D', '6H', '9D', 'KS', 'AC', '4H'],
      3: ['4S', '8H', '10D', 'JS', 'AD', '9C'],
    } as Hands)
    const advice = advise(viewOf(state, 1), emptyMemory(), options)
    for (const suggestion of advice.suggestions) {
      for (const card of suggestion.cards) expect(state.hands[1]).toContain(card)
    }
  })
})

describe('the advice depends on legal information only', () => {
  /**
   * The real guarantee. Two deals that are identical from seat 1's chair but
   * completely different behind the other two players must produce identical
   * advice — if the advisor could see a card it is not entitled to, these two
   * would diverge.
   */
  it('is unchanged when the unseen cards are rearranged', () => {
    const mine: CardId[] = ['2C', '5H', '5D', 'QS', '7C', 'JOKER_1']
    const first = trickTable({
      1: mine,
      2: ['3D', '6H', '9D', 'KS', 'AC', '4H'],
      3: ['4S', '8H', '10D', 'JS', 'AD', '9C'],
    } as Hands)
    const second = trickTable({
      1: mine,
      2: ['4S', '8H', '10D', 'JS', 'AD', '9C'],
      3: ['3D', '6H', '9D', 'KS', 'AC', '4H'],
    } as Hands)
    const third = trickTable({
      1: mine,
      2: ['2S', '2D', '2H', '3S', '3H', '3C'],
      3: ['KH', 'KC', 'KD', 'AH', 'AS', '10S'],
    } as Hands)

    const a = advise(viewOf(first, 1), emptyMemory(), options)
    const b = advise(viewOf(second, 1), emptyMemory(), options)
    const c = advise(viewOf(third, 1), emptyMemory(), options)

    expect(b).toEqual(a)
    expect(c).toEqual(a)
  })

  it('does change when a card is played where everyone can see it', () => {
    const mine: CardId[] = ['2C', '5H', '5D', 'QS', '7C', 'JOKER_1']
    const base = trickTable({
      1: mine,
      2: ['3D', '6H', '9D', 'KS', 'AC', '4H'],
      3: ['4S', '8H', '10D', 'JS', 'AD', '9C'],
    } as Hands)
    const informed = { ...base, played: ['KH', 'KC', 'KD', 'AH', 'AS', 'JOKER_2'] }
    const before = advise(viewOf(base, 1), emptyMemory(), options)
    const after = advise(viewOf(informed, 1), emptyMemory(), options)
    // Watching six big cards leave the deck has to move the odds.
    expect(after.winProbability).not.toBe(before.winProbability)
  })

  it('takes account of the player’s own discards, which they saw', () => {
    const mine: CardId[] = ['2C', '5H', '5D', 'QS', '7C', 'JOKER_1']
    const state = trickTable({
      1: mine,
      2: ['3D', '6H', '9D', 'KS', 'AC', '4H'],
      3: ['4S', '8H', '10D', 'JS', 'AD', '9C'],
    } as Hands)
    const plain = advise(viewOf(state, 1), emptyMemory(), options)
    const remembered = advise(
      viewOf(state, 1),
      { discarded: ['KH', 'KC', 'KD', 'AH'] },
      options,
    )
    expect(remembered.winProbability).not.toBe(plain.winProbability)
  })
})
