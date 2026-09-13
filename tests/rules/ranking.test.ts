import { describe, expect, it } from 'vitest'
import { scoreValue, sortByTrickStrength, trickStrength } from '@cucumber/game-engine'

describe('trick strength', () => {
  it('orders 10 below J below Q below K below A', () => {
    const ascending = ['10S', 'JS', 'QS', 'KS', 'AS']
    for (let i = 1; i < ascending.length; i++) {
      expect(trickStrength(ascending[i]!)).toBeGreaterThan(trickStrength(ascending[i - 1]!))
    }
  })

  it('promotes 7s and jokers above the ace', () => {
    expect(trickStrength('7C')).toBeGreaterThan(trickStrength('AS'))
    expect(trickStrength('JOKER_1')).toBeGreaterThan(trickStrength('AS'))
  })

  it('treats a 7 and a joker as identical', () => {
    expect(trickStrength('7C')).toBe(trickStrength('JOKER_2'))
  })

  it('places the 7 outside the numeric run', () => {
    expect(trickStrength('6H')).toBeLessThan(trickStrength('8H'))
    expect(trickStrength('8H')).toBeGreaterThan(trickStrength('6H'))
  })

  it('sorts ascending by strength, not by face value', () => {
    expect(sortByTrickStrength(['7D', '2C', 'AS', '10H'])).toEqual(['2C', '10H', 'AS', '7D'])
  })
})

describe('score value', () => {
  it('scores the pip cards at face value', () => {
    expect(scoreValue('2S')).toBe(2)
    expect(scoreValue('6D')).toBe(6)
    expect(scoreValue('9C')).toBe(9)
  })

  it('scores 10, J, Q and K all at ten despite ranking apart', () => {
    for (const card of ['10S', 'JS', 'QS', 'KS']) expect(scoreValue(card)).toBe(10)
    expect(trickStrength('KS')).toBeGreaterThan(trickStrength('10S'))
  })

  it('scores the ace at 15 and 7s and jokers at 21', () => {
    expect(scoreValue('AH')).toBe(15)
    expect(scoreValue('7H')).toBe(21)
    expect(scoreValue('JOKER_1')).toBe(21)
  })
})
