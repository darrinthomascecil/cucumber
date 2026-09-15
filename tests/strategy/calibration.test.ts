import { describe, expect, it } from 'vitest'
import { summarise, wilson } from '../../apps/web/src/calibrationStats.ts'
import type { CalibrationStore, MatchRecord, Sample } from '../../apps/web/src/calibrationTypes.ts'

/** A store of `matches` matches, each one `claims` claims at the same odds. */
function store(matches: number, claims: number, said: number, survives: number): CalibrationStore {
  const samples: Sample[] = []
  const history: MatchRecord[] = []
  for (let m = 0; m < matches; m++) {
    const survived = m < survives
    const outcome = survived ? 1 : 0
    for (let c = 0; c < claims; c++) samples.push({ expected: said, survived })
    history.push({ expected: said, survived, brier: (said - outcome) ** 2 })
  }
  return { samples, matches, history, openMatch: null, open: {}, advisor: 'test' }
}

describe('wilson', () => {
  it('knows nothing from no observations', () => {
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 })
  })

  it('stays inside [0, 1] even when every match went the same way', () => {
    const all = wilson(20, 20)
    expect(all.high).toBeLessThanOrEqual(1)
    expect(all.low).toBeGreaterThan(0.8)
    const none = wilson(0, 20)
    expect(none.low).toBeGreaterThanOrEqual(0)
    expect(none.high).toBeLessThan(0.2)
  })

  it('narrows as the sample grows', () => {
    const width = (n: number) => {
      const b = wilson(n / 2, n)
      return b.high - b.low
    }
    expect(width(400)).toBeLessThan(width(40))
  })
})

describe('summarise', () => {
  it('scores the claims it was given', () => {
    // Said 100% every time and survived half of them: (1-1)² and (1-0)², so 0.5.
    const stats = summarise(store(10, 4, 1, 5))
    expect(stats.count).toBe(40)
    expect(stats.matches).toBe(10)
    expect(stats.brier).toBeCloseTo(0.5, 10)
    expect(stats.actual).toBeCloseTo(0.5, 10)
  })

  /*
   * The bug this panel had: an interval over 400 correlated predictions is
   * several times too narrow, so ordinary luck reads as the advisor changing.
   * Forty matches is forty independent outcomes however many times the advisor
   * was asked inside each one.
   */
  it('takes the interval over matches, not over predictions', () => {
    const tenClaims = summarise(store(40, 10, 0.7, 20))
    const oneClaim = summarise(store(40, 1, 0.7, 20))

    expect(tenClaims.scored).toBe(40)
    expect(tenClaims.count).toBe(400)
    // Same 40 outcomes, so the same band — asking the advisor more often
    // inside a match does not make the evidence stronger.
    expect(tenClaims.actualMargin).toBeCloseTo(oneClaim.actualMargin, 10)
    // And it is the wide band: n=40 is about ±0.15, n=400 would be about ±0.05.
    expect(tenClaims.actualMargin).toBeGreaterThan(0.1)
  })

  it('narrows the band as matches accumulate', () => {
    const few = summarise(store(20, 5, 0.7, 10))
    const many = summarise(store(200, 5, 0.7, 100))
    expect(many.actualMargin).toBeLessThan(few.actualMargin)
  })

  it('gives no band until there is something to band', () => {
    const empty = summarise(store(0, 0, 0, 0))
    expect(empty.actualMargin).toBe(0)
    expect(empty.brierMargin).toBe(0)
    const one = summarise(store(1, 3, 0.8, 1))
    // One match cannot say how much its Brier varies.
    expect(one.brierMargin).toBe(0)
  })

  it('bands the Brier by how much it varied from match to match', () => {
    // Every match identical: no variation, so nothing to be uncertain about.
    const steady = summarise(store(50, 4, 1, 50))
    expect(steady.brierMargin).toBeCloseTo(0, 10)
    // Half survived, half did not: the per-match Brier is 0 or 1, and the
    // headline number genuinely could be somewhere else.
    const mixed = summarise(store(50, 4, 1, 25))
    expect(mixed.brierMargin).toBeGreaterThan(0.1)
  })

  it('falls back to the mean claim for records written before per-match Brier', () => {
    const s = store(10, 2, 0.6, 5)
    const old = { ...s, history: s.history.map(({ expected, survived }) => ({ expected, survived })) }
    expect(summarise(old).brierMargin).toBeGreaterThan(0)
  })
})
