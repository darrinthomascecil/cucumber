import { describe, expect, it } from 'vitest'
import {
  IllegalMoveError,
  forcedLowRequirement,
  validateFollow,
  validateForcedLow,
} from '@cucumber/game-engine'

describe('mandatory qualifying play', () => {
  const hand = ['2C', '3D', 'KH', 'AS', '5C']

  it('rejects a deliberate failure when a qualifying play exists', () => {
    expect(() => validateFollow(hand, ['10S', 'JD'], ['2C', '3D'])).toThrow(/may not play under/)
  })

  it('accepts any qualifying combination the player chooses', () => {
    expect(validateFollow(hand, ['10S', 'JD'], ['KH', 'AS'])).toBe('SUCCESS')
  })

  it('does not force the cheapest qualifying combination', () => {
    const rich = ['JC', 'QD', 'KH', 'AS', '2C']
    expect(validateFollow(rich, ['10S', '10D'], ['JC', 'QD'])).toBe('SUCCESS')
    expect(validateFollow(rich, ['10S', '10D'], ['KH', 'AS'])).toBe('SUCCESS')
  })

  it('rejects the wrong number of cards', () => {
    expect(() => validateFollow(hand, ['10S', 'JD'], ['AS'])).toThrow(/exactly 2/)
    expect(() => validateFollow(hand, ['10S', 'JD'], ['KH', 'AS', '5C'])).toThrow(/exactly 2/)
  })
})

describe('forced low play', () => {
  const hopeless = ['2C', '3D', '4H', '9S', '10C']

  it('is required when no qualifying play exists', () => {
    expect(validateFollow(hopeless, ['JS', 'JD'], ['2C', '3D'])).toBe('FORCED_LOW')
  })

  it('rejects surrendering anything but the lowest cards', () => {
    expect(() => validateFollow(hopeless, ['JS', 'JD'], ['9S', '10C'])).toThrow(IllegalMoveError)
    expect(() => validateFollow(hopeless, ['JS', 'JD'], ['2C', '10C'])).toThrow(/too high/)
  })

  it('reports which cards are compulsory and which are a free choice', () => {
    const tied = ['2S', '2H', '2D', '3C', 'KS']
    const requirement = forcedLowRequirement(tied, 2)
    expect(requirement.mandatory).toEqual([])
    expect(requirement.choices.sort()).toEqual(['2D', '2H', '2S'])
    expect(requirement.chooseCount).toBe(2)
  })

  it('lets the player pick any two of three tied 2s', () => {
    const tied = ['2S', '2H', '2D', '3C', 'KS']
    expect(() => validateForcedLow(tied, ['2S', '2H'], 2)).not.toThrow()
    expect(() => validateForcedLow(tied, ['2H', '2D'], 2)).not.toThrow()
    expect(() => validateForcedLow(tied, ['2S', '2D'], 2)).not.toThrow()
  })

  it('still compels the cards below the tie', () => {
    const mixed = ['2S', '5H', '5D', '5C', 'KS']
    const requirement = forcedLowRequirement(mixed, 2)
    expect(requirement.mandatory).toEqual(['2S'])
    expect(requirement.chooseCount).toBe(1)
    expect(() => validateForcedLow(mixed, ['5H', '5D'], 2)).toThrow(/lowest/)
    expect(() => validateForcedLow(mixed, ['2S', '5D'], 2)).not.toThrow()
  })

  it('treats a joker as tied with a 7 at the top', () => {
    const highs = ['7S', 'JOKER_1', '2C']
    const requirement = forcedLowRequirement(highs, 2)
    expect(requirement.mandatory).toEqual(['2C'])
    expect(requirement.choices.sort()).toEqual(['7S', 'JOKER_1'])
  })
})
