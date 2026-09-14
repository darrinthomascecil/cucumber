import { describe, expect, it } from 'vitest'
import {
  IllegalMoveError,
  beatsTarget,
  buildDeck,
  canMeetTarget,
  forcedLowRequirement,
  scoreValue,
  sortByTrickStrength,
  trickStrength,
  validateLead,
} from '@cucumber/game-engine'
import {
  CLASS_SUPPLY,
  CLASS_VALUE,
  beats,
  canMeet,
  classOf,
  countsOf,
  forcedLow,
  legalLeads,
  pickCards,
  spread,
  xorshift,
} from '@cucumber/strategy'
import type { CardId } from '@cucumber/shared'

/**
 * The strategy package re-expresses the rules over 13 equivalence classes so
 * self-play can run fast. That makes it a second implementation, so it is
 * pinned to the first one here: if the engine and the strategy ever disagree
 * about a legal move, these fail.
 */
const deck = buildDeck()

function randomHand(random: ReturnType<typeof xorshift>, size: number): CardId[] {
  const pool = [...deck]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = random.int(i + 1)
    const a = pool[i] as CardId
    pool[i] = pool[j] as CardId
    pool[j] = a
  }
  return pool.slice(0, size)
}

describe('the class model agrees with the engine', () => {
  it('maps every card to a class ordered by trick strength', () => {
    for (const card of deck) {
      expect(classOf(card)).toBe(trickStrength(card) - 2)
    }
  })

  it('gives every class the engine’s score value', () => {
    for (const card of deck) {
      expect(CLASS_VALUE[classOf(card)]).toBe(scoreValue(card))
    }
  })

  it('accounts for all 54 cards', () => {
    expect(CLASS_SUPPLY.reduce((a, b) => a + b, 0)).toBe(54)
    const counts = countsOf(deck)
    for (let c = 0; c < CLASS_SUPPLY.length; c++) expect(counts[c]).toBe(CLASS_SUPPLY[c])
  })
})

describe('comparison agrees with the engine', () => {
  it('matches beatsTarget over many random pairs', () => {
    const random = xorshift(4711)
    for (let trial = 0; trial < 3000; trial++) {
      const n = 1 + random.int(3)
      const cards = randomHand(random, n * 2)
      const play = cards.slice(0, n)
      const target = cards.slice(n)
      const mine = beats(countsOf(play), sortByTrickStrength(target).map(classOf))
      expect(mine).toBe(beatsTarget(play, target))
    }
  })

  it('matches canMeetTarget over many random hands', () => {
    const random = xorshift(1009)
    for (let trial = 0; trial < 2000; trial++) {
      const n = 1 + random.int(3)
      const cards = randomHand(random, 8 + n)
      const hand = cards.slice(0, 8)
      const target = cards.slice(8)
      const mine = canMeet(countsOf(hand), sortByTrickStrength(target).map(classOf))
      expect(mine).toBe(canMeetTarget(hand, target))
    }
  })
})

describe('the forced low play agrees with the engine', () => {
  it('produces a set the engine accepts', () => {
    const random = xorshift(2027)
    for (let trial = 0; trial < 1500; trial++) {
      const n = 1 + random.int(3)
      const hand = randomHand(random, 5 + random.int(8))
      if (hand.length <= n) continue
      const counts = forcedLow(countsOf(hand), n)
      const cards = pickCards(hand, counts)
      expect(cards).toHaveLength(n)
      // The engine is the authority on whether this is the required surrender.
      const requirement = forcedLowRequirement(hand, n)
      const allowed = new Set([...requirement.mandatory, ...requirement.choices])
      for (const card of cards) expect(allowed.has(card)).toBe(true)
      for (const card of requirement.mandatory) expect(cards).toContain(card)
    }
  })

  it('picks the same multiset of ranks the engine would', () => {
    const random = xorshift(31)
    for (let trial = 0; trial < 1000; trial++) {
      const n = 1 + random.int(3)
      const hand = randomHand(random, 6 + random.int(6))
      if (hand.length <= n) continue
      const mine = spread(forcedLow(countsOf(hand), n))
      const engine = sortByTrickStrength(hand).slice(0, n).map(classOf)
      expect(mine).toEqual(engine)
    }
  })
})

describe('generated leads are legal', () => {
  it('every lead the strategy offers is one the engine accepts', () => {
    const random = xorshift(8123)
    for (let trial = 0; trial < 400; trial++) {
      const hand = randomHand(random, 2 + random.int(12))
      for (const lead of legalLeads(countsOf(hand))) {
        const counts = countsOf([])
        counts[lead.cardClass] = lead.count
        const cards = pickCards(hand, counts)
        expect(() => validateLead(hand, cards)).not.toThrow()
      }
    }
  })

  it('and it offers every lead the engine would accept', () => {
    const hand = ['5S', '5H', '5D', '7C', 'JOKER_1', '2C']
    const offered = legalLeads(countsOf(hand)).map((lead) => `${lead.cardClass}x${lead.count}`)
    // Three 5s, a 7 and a Joker sharing the top class, and a lone 2.
    expect(offered).toContain('3x3')
    expect(offered).toContain('12x2')
    expect(offered).toContain('0x1')
    // Never the whole hand.
    expect(offered).not.toContain('3x6')
  })

  it('refuses to lead a whole hand, as the engine does', () => {
    const hand = ['5S', '5H']
    expect(legalLeads(countsOf(hand)).every((lead) => lead.count < 2)).toBe(true)
    expect(() => validateLead(hand, hand)).toThrow(IllegalMoveError)
  })
})
