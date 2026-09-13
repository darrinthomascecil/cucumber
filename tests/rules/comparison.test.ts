import { describe, expect, it } from 'vitest'
import { beatsTarget, canMeetTarget, findQualifyingPlay } from '@cucumber/game-engine'

describe('position-by-position comparison', () => {
  it('accepts a play where every card meets its counterpart', () => {
    expect(beatsTarget(['6H', '9S'], ['5S', '8D'])).toBe(true)
  })

  it('accepts equality', () => {
    expect(beatsTarget(['5C', '5D'], ['5S', '5H'])).toBe(true)
    expect(beatsTarget(['8H', '8C'], ['5S', '8D'])).toBe(true)
  })

  it('accepts one card far above and one equal', () => {
    expect(beatsTarget(['5C', 'AS'], ['5S', '8D'])).toBe(true)
  })

  it('accepts a pair of top-rank cards', () => {
    expect(beatsTarget(['7C', 'JOKER_1'], ['5S', '8D'])).toBe(true)
  })

  it('rejects a play where any single card falls short', () => {
    expect(beatsTarget(['2C', '8H'], ['5S', '8D'])).toBe(false)
  })

  it('never sums card values', () => {
    // A lone ace vastly outvalues 5+8 but is only one card against two.
    expect(beatsTarget(['AS'], ['5S', '8D'])).toBe(false)
    // And 2+K beats neither position despite a large total.
    expect(beatsTarget(['2C', 'KH'], ['8S', '9D'])).toBe(false)
  })

  it('matches the spec worked example for a 10 + J target', () => {
    const target = ['10S', 'JD']
    expect(beatsTarget(['JH', 'QC'], target)).toBe(true)
    expect(beatsTarget(['QH', 'QC'], target)).toBe(true)
    expect(beatsTarget(['KH', 'AC'], target)).toBe(true)
    expect(beatsTarget(['9H', 'AC'], target)).toBe(false)
    expect(beatsTarget(['10H', '10C'], target)).toBe(false)
  })

  it('lets a promoted 7 satisfy a high target position', () => {
    // Consequence of §5: a 7 outranks every ordinary card, so 6+7 meets 5+8.
    expect(beatsTarget(['6H', '7C'], ['5S', '8D'])).toBe(true)
  })
})

describe('can the player meet the target at all', () => {
  it('is true when the strongest cards qualify', () => {
    expect(canMeetTarget(['2C', '3D', 'KH', 'AS'], ['10S', 'JD'])).toBe(true)
  })

  it('is false when they do not', () => {
    expect(canMeetTarget(['2C', '3D', '9H', '10S'], ['JS', 'JD'])).toBe(false)
  })

  it('is false when the hand is shorter than the target', () => {
    expect(canMeetTarget(['AS'], ['5S', '5H'])).toBe(false)
  })

  it('agrees with an exhaustive search over every combination', () => {
    const hand = ['2C', '5D', '8H', '10S', 'JD', 'QC', 'AS', '7H']
    const targets = [
      ['5S', '5H'],
      ['JS', 'JH'],
      ['AS', 'AH'],
      ['7S', '7D'],
      ['9S', '9H', '9D'],
      ['KS', 'KH', 'KD'],
    ]
    for (const target of targets) {
      const brute = combinations(hand, target.length).some((combo) => beatsTarget(combo, target))
      expect(canMeetTarget(hand, target)).toBe(brute)
    }
  })

  it('returns an actual qualifying combination when one exists', () => {
    const hand = ['2C', '5D', '8H', '10S', 'JD', 'QC', 'AS']
    const target = ['10D', 'JS']
    const play = findQualifyingPlay(hand, target)
    expect(play).not.toBeNull()
    expect(beatsTarget(play!, target)).toBe(true)
  })

  it('returns null when no combination exists', () => {
    expect(findQualifyingPlay(['2C', '3D'], ['KS', 'KH'])).toBeNull()
  })
})

function combinations<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) return [[]]
  if (items.length < size) return []
  const [head, ...rest] = items
  return [
    ...combinations(rest, size - 1).map((combo) => [head as T, ...combo]),
    ...combinations(rest, size),
  ]
}
