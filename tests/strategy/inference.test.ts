import { describe, expect, it } from 'vitest'
import {
  CLASS_COUNT,
  canMeet,
  countsOf,
  poolOvercount,
  sampleFullWorld,
  unseenPool,
  spread,
  xorshift,
  type InfoSet,
} from '@cucumber/strategy'

/**
 * A player who fails to meet a target has told the whole table something hard
 * about their hand. These tests check the sampler actually listens — the
 * measured benefit is small, so it matters to know the mechanism works rather
 * than assuming a null result means it is switched off.
 */
function baseInfo(overrides: Partial<InfoSet> = {}): InfoSet {
  return {
    seat: 0,
    hand: countsOf(['2C', '3D', '4H', '5S', '6C']),
    played: countsOf([]),
    mine: countsOf([]),
    handSizes: [5, 5, 5],
    scores: [0, 0, 0],
    ...overrides,
  }
}

describe('worlds respect what players have shown they cannot hold', () => {
  it('never deals a card at or above a single-card target a seat failed', () => {
    // Class 9 is a Queen. Seat 1 could not beat one.
    const info = baseInfo({ failures: [[], [[9]], []] })
    const random = xorshift(4242)
    for (let trial = 0; trial < 400; trial++) {
      const world = sampleFullWorld(info, random)
      for (let c = 9; c < CLASS_COUNT; c++) {
        expect(world.hands[1][c]).toBe(0)
      }
    }
  })

  it('takes the tightest of several failures', () => {
    const info = baseInfo({ failures: [[], [[9], [6], [11]], []] })
    const random = xorshift(99)
    for (let trial = 0; trial < 300; trial++) {
      const world = sampleFullWorld(info, random)
      for (let c = 6; c < CLASS_COUNT; c++) {
        expect(world.hands[1][c]).toBe(0)
      }
    }
  })

  it('respects a multi-card failure it cannot express as a ceiling', () => {
    // Failing a pair of Jacks does not forbid holding one Jack.
    const info = baseInfo({ failures: [[], [[8, 8]], []] })
    const random = xorshift(7)
    let held = 0
    for (let trial = 0; trial < 300; trial++) {
      const world = sampleFullWorld(info, random)
      expect(canMeet(world.hands[1], [8, 8])).toBe(false)
      if (world.hands[1][8]! > 0) held++
    }
    // A single Jack is still possible, and should actually turn up.
    expect(held).toBeGreaterThan(0)
  })

  it('constrains only the seat that failed', () => {
    const info = baseInfo({ failures: [[], [[6]], []] })
    const random = xorshift(555)
    let seatTwoHeldHigh = 0
    for (let trial = 0; trial < 300; trial++) {
      const world = sampleFullWorld(info, random)
      if (spread(world.hands[2]).some((c) => c >= 6)) seatTwoHeldHigh++
    }
    expect(seatTwoHeldHigh).toBeGreaterThan(200)
  })

  it('still deals a full, legal world when the constraint is nearly impossible', () => {
    // Almost every low card already gone, and a seat that can hold nothing high.
    const info = baseInfo({
      hand: countsOf(['2C', '2D', '2H', '2S', '3C']),
      played: countsOf(['3D', '3H', '3S', '4C', '4D', '4H', '4S', '5C', '5D', '5H']),
      failures: [[], [[2]], []],
      handSizes: [5, 5, 5],
    })
    const random = xorshift(31337)
    for (let trial = 0; trial < 100; trial++) {
      const world = sampleFullWorld(info, random)
      expect(world.hands[1].reduce((a, b) => a + b, 0)).toBe(5)
      expect(world.hands[2].reduce((a, b) => a + b, 0)).toBe(5)
    }
  })

  it('ignores failures when it is told to', () => {
    const info = baseInfo({ failures: undefined })
    const random = xorshift(11)
    let high = 0
    for (let trial = 0; trial < 300; trial++) {
      const world = sampleFullWorld(info, random)
      if (spread(world.hands[1]).some((c) => c >= 9)) high++
    }
    expect(high).toBeGreaterThan(100)
  })
})

describe('a stale information set degrades rather than dies', () => {
  /**
   * The counts come from whoever is asking, and a player's memory of their own
   * discards can drift — one that was refused and re-sent used to be recorded
   * twice. That threw, which killed the process the advisor was running in.
   */
  it('clamps when more cards are claimed than the deck holds', () => {
    const info = baseInfo({
      hand: countsOf(['2C', '2D', '2H', '2S', '3C']),
      // Claiming all four 2s a second time: impossible, and survivable.
      mine: countsOf(['2C', '2D', '2H', '2S']),
      handSizes: [5, 4, 4],
    })
    expect(poolOvercount(info)).toBe(4)
    const pool = unseenPool(info)
    for (let c = 0; c < CLASS_COUNT; c++) expect(pool[c]).toBeGreaterThanOrEqual(0)
    const random = xorshift(3)
    for (let trial = 0; trial < 50; trial++) {
      const world = sampleFullWorld(info, random)
      expect(world.hands[1].reduce((a, b) => a + b, 0)).toBe(4)
      expect(world.hands[2].reduce((a, b) => a + b, 0)).toBe(4)
    }
  })

  it('reports no disagreement for an ordinary information set', () => {
    expect(poolOvercount(baseInfo())).toBe(0)
  })
})
