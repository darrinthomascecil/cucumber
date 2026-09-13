import { describe, expect, it } from 'vitest'
import { IllegalMoveError, maxLeadCount, validateLead } from '@cucumber/game-engine'

const hand = ['5S', '5H', '5D', '6C', 'QS', 'QH', 'QD', '7C', '7D', 'JOKER_1', 'JOKER_2', 'JS', '2C']

function lead(cards: string[]) {
  return () => validateLead(hand, cards)
}

describe('leading a trick', () => {
  it('accepts a single card', () => {
    expect(lead(['5S'])).not.toThrow()
  })

  it('accepts matching ranks', () => {
    expect(lead(['5S', '5H'])).not.toThrow()
    expect(lead(['QS', 'QH', 'QD'])).not.toThrow()
  })

  it('rejects mixed ranks', () => {
    expect(lead(['5S', '6C'])).toThrow(IllegalMoveError)
    expect(lead(['JS', 'QS'])).toThrow(IllegalMoveError)
  })

  it('rejects mixed ranks even when both score the same', () => {
    // 10, J, Q and K all score 10 but are four different ranks.
    expect(() => validateLead(['10S', 'JS', '2C'], ['10S', 'JS'])).toThrow(IllegalMoveError)
  })

  it('treats 7s and jokers as one rank', () => {
    expect(lead(['7C', 'JOKER_1'])).not.toThrow()
    expect(lead(['7C', '7D', 'JOKER_1'])).not.toThrow()
    expect(lead(['7C', '7D', 'JOKER_1', 'JOKER_2'])).not.toThrow()
  })

  it('does not let a 7 join a numeric run', () => {
    expect(lead(['6C', '7C'])).toThrow(IllegalMoveError)
  })

  it('rejects cards the player does not hold', () => {
    expect(lead(['5S', '5C'])).toThrow(/do not hold/)
  })

  it('rejects the same card twice', () => {
    expect(lead(['5S', '5S'])).toThrow(/twice/)
  })
})

describe('keeping the final card', () => {
  it('caps a lead at one below the hand size', () => {
    expect(maxLeadCount(4)).toBe(3)
    expect(maxLeadCount(2)).toBe(1)
  })

  it('refuses a lead that would empty the hand', () => {
    expect(() => validateLead(['5S', '5H', '5D', '5C'], ['5S', '5H', '5D', '5C'])).toThrow(
      /final reveal/,
    )
  })

  it('allows one fewer than the hand size', () => {
    expect(() => validateLead(['5S', '5H', '5D', '5C'], ['5S', '5H', '5D'])).not.toThrow()
  })

  it('forces a single card when two remain', () => {
    expect(() => validateLead(['5S', '5H'], ['5S'])).not.toThrow()
    expect(() => validateLead(['5S', '5H'], ['5S', '5H'])).toThrow(/final reveal/)
  })
})
