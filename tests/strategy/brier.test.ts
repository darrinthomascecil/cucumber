import { describe, expect, it } from 'vitest'
import { brierBand, brierOf, decompose, wilson, type Claim } from '@cucumber/strategy'

/**
 * The decomposition is the instrument every later claim about the advisor
 * rests on, so it is pinned against cases whose answers are known by hand
 * rather than by running it and writing down what came out.
 */

describe('brierOf', () => {
  it('is zero for claims that were always right', () => {
    expect(brierOf([{ p: 1, y: 1 }, { p: 0, y: 0 }])).toBe(0)
  })

  it('is one for claims that were always confidently wrong', () => {
    expect(brierOf([{ p: 1, y: 0 }, { p: 0, y: 1 }])).toBe(1)
  })

  it('is 0.25 for always saying fifty-fifty', () => {
    expect(brierOf([{ p: 0.5, y: 1 }, { p: 0.5, y: 0 }])).toBeCloseTo(0.25, 12)
  })
})

describe('decompose', () => {
  /*
   * The classical identity holds exactly only when every claim inside a bin
   * is the same number, so it is pinned on discrete claims. On continuous
   * ones the remainder is reported rather than hidden, and the test below
   * checks that it is reported honestly.
   */
  it('satisfies brier = reliability − resolution + uncertainty on discrete claims', () => {
    const claims: Claim[] = []
    const add = (p: number, yes: number, no: number) => {
      for (let i = 0; i < yes; i++) claims.push({ p, y: 1 })
      for (let i = 0; i < no; i++) claims.push({ p, y: 0 })
    }
    add(0.1, 5, 45)
    add(0.5, 30, 30)
    add(0.9, 80, 20)

    const d = decompose(claims, [0, 0.2, 0.4, 0.6, 0.8, 1.0001])
    expect(d.residual).toBeCloseTo(0, 12)
    expect(d.brier).toBeCloseTo(d.reliability - d.resolution + d.uncertainty, 12)
  })

  it('reports no skill as zero resolution', () => {
    // The same claim every time cannot separate anything, whatever happened.
    const claims: Claim[] = []
    for (let i = 0; i < 100; i++) claims.push({ p: 0.6, y: i < 60 ? 1 : 0 })
    const d = decompose(claims)
    expect(d.resolution).toBeCloseTo(0, 12)
    expect(d.uncertainty).toBeCloseTo(0.24, 12)
    // Said 60%, 60% happened: perfectly calibrated, so nothing lost there.
    expect(d.reliability).toBeCloseTo(0, 12)
  })

  it('charges overconfidence to reliability', () => {
    const honest: Claim[] = []
    const cocky: Claim[] = []
    for (let i = 0; i < 100; i++) {
      const y = i < 70 ? 1 : 0
      honest.push({ p: 0.7, y })
      cocky.push({ p: 0.95, y })
    }
    // Same ordering, same outcomes — only the confidence differs.
    expect(decompose(honest).reliability).toBeLessThan(decompose(cocky).reliability)
    expect(decompose(honest).resolution).toBeCloseTo(decompose(cocky).resolution, 12)
    expect(decompose(honest).brier).toBeLessThan(decompose(cocky).brier)
  })

  it('does not hide the remainder left by binning continuous claims', () => {
    const claims: Claim[] = []
    for (let i = 0; i < 200; i++) {
      const p = 0.01 + (i / 200) * 0.98
      claims.push({ p, y: i % 3 === 0 ? 1 : 0 })
    }
    const d = decompose(claims)
    // It is allowed to be non-zero; it is not allowed to be wrong.
    expect(d.residual).toBeCloseTo(d.brier - (d.reliability - d.resolution + d.uncertainty), 12)
  })

  it('says nothing from nothing', () => {
    const d = decompose([])
    expect(d.claims).toBe(0)
    expect(d.bins).toEqual([])
  })
})

describe('bands', () => {
  it('takes the Brier band over matches', () => {
    const steady = new Array(50).fill(0.2)
    expect(brierBand(steady)).toBeCloseTo(0, 12)
    const mixed = new Array(50).fill(0).map((_, i) => (i % 2 === 0 ? 0 : 1))
    expect(brierBand(mixed)).toBeGreaterThan(0.1)
    expect(brierBand([0.2])).toBe(0)
  })

  it('narrows as matches accumulate', () => {
    const jitter = (n: number) => new Array(n).fill(0).map((_, i) => (i % 2 === 0 ? 0.1 : 0.3))
    expect(brierBand(jitter(400))).toBeLessThan(brierBand(jitter(40)))
  })

  it('keeps wilson inside the unit interval', () => {
    expect(wilson(20, 20).high).toBeLessThanOrEqual(1)
    expect(wilson(0, 20).low).toBeGreaterThanOrEqual(0)
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 })
  })
})
