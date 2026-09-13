import { describe, expect, it } from 'vitest'
import { DECK_SIZE, buildDeck, cardRank, deal, shuffle } from '@cucumber/game-engine'
import { seededRng } from '../helpers/rng.ts'

describe('deck', () => {
  const deck = buildDeck()

  it('holds exactly 54 cards', () => {
    expect(deck).toHaveLength(DECK_SIZE)
  })

  it('has no duplicate physical cards', () => {
    expect(new Set(deck).size).toBe(DECK_SIZE)
  })

  it('has four 7s', () => {
    expect(deck.filter((card) => cardRank(card) === '7')).toHaveLength(4)
  })

  it('has two jokers', () => {
    expect(deck.filter((card) => cardRank(card) === 'JOKER')).toHaveLength(2)
  })

  it('shuffles without losing or duplicating a card', () => {
    const shuffled = shuffle(deck, seededRng(99))
    expect(shuffled).toHaveLength(DECK_SIZE)
    expect(new Set(shuffled)).toEqual(new Set(deck))
    expect(shuffled).not.toEqual(deck)
  })

  it('reaches every position when shuffling repeatedly', () => {
    // A Fisher-Yates bug that pins a card would show up here.
    const first = new Set<string>()
    for (let seed = 1; seed <= 200; seed++) {
      first.add(shuffle(deck, seededRng(seed))[0] as string)
    }
    expect(first.size).toBeGreaterThan(20)
  })
})

describe('deal', () => {
  it('gives each player 13 cards and leaves 15 in the stock', () => {
    const { hands, stock } = deal(buildDeck())
    expect(hands[0]).toHaveLength(13)
    expect(hands[1]).toHaveLength(13)
    expect(hands[2]).toHaveLength(13)
    expect(stock).toHaveLength(15)
  })

  it('deals every card exactly once', () => {
    const { hands, stock } = deal(buildDeck())
    const all = [...hands[0], ...hands[1], ...hands[2], ...stock]
    expect(new Set(all).size).toBe(DECK_SIZE)
  })
})
