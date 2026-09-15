import type { CalibrationStore } from './calibrationTypes.ts'

export interface Bucket {
  from: number
  to: number
  count: number
  expected: number
  actual: number
}

/** A running read of both numbers after each match, for the chart. */
export interface SeriesPoint {
  matches: number
  expected: number
  actual: number
}

export interface Calibration {
  /** Settled predictions. */
  count: number
  matches: number
  /** Predictions in the match still being played. */
  pending: number
  expected: number
  actual: number
  buckets: Bucket[]
  series: SeriesPoint[]
  /**
   * Brier score: the mean squared distance between each claim and what
   * happened. Zero is perfect; 0.25 is what you score by always saying 50%.
   * It punishes confident mistakes far harder than hedged ones, which is
   * exactly the failure worth watching for here.
   */
  brier: number
  /**
   * Matches the intervals below were computed from. Not the same as `matches`:
   * the per-match history is capped, while the counter is not.
   */
  scored: number
  /**
   * Half-width of the 95% interval on `actual`, taken over matches. Claims
   * inside one match share that match's single outcome, so an interval over
   * the 4000 predictions would be several times too narrow and every ordinary
   * wobble would read as a real change.
   */
  actualMargin: number
  /** Half-width of the 95% interval on `brier`, likewise over matches. */
  brierMargin: number
}

const Z = 1.96

/**
 * Wilson score interval. Preferred over the textbook normal approximation
 * because it stays inside [0, 1] and still behaves at the small match counts
 * this panel spends its first evening showing.
 */
export function wilson(successes: number, n: number): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 1 }
  const p = successes / n
  const denom = 1 + (Z * Z) / n
  const centre = (p + (Z * Z) / (2 * n)) / denom
  const spread = (Z * Math.sqrt((p * (1 - p)) / n + (Z * Z) / (4 * n * n))) / denom
  return { low: Math.max(0, centre - spread), high: Math.min(1, centre + spread) }
}

/** Sample standard deviation; 0 for fewer than two observations. */
function stdev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const variance =
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

export function summarise(store: CalibrationStore): Calibration {
  const { samples, history } = store
  const count = samples.length
  const expected = count ? samples.reduce((sum, s) => sum + s.expected, 0) / count : 0
  const actual = count ? samples.filter((s) => s.survived).length / count : 0

  const edges = [0, 0.2, 0.4, 0.6, 0.8, 1.0001]
  const buckets: Bucket[] = []
  for (let i = 0; i < edges.length - 1; i++) {
    const from = edges[i]!
    const to = edges[i + 1]!
    const inside = samples.filter((s) => s.expected >= from && s.expected < to)
    if (inside.length === 0) continue
    buckets.push({
      from,
      to: Math.min(to, 1),
      count: inside.length,
      expected: inside.reduce((sum, s) => sum + s.expected, 0) / inside.length,
      actual: inside.filter((s) => s.survived).length / inside.length,
    })
  }

  const brier = count
    ? samples.reduce((sum, s) => sum + (s.expected - (s.survived ? 1 : 0)) ** 2, 0) / count
    : 0

  // Running means after each match. Cumulative, not per match: one match is a
  // single outcome shared by all its claims, so plotting it alone would be a
  // chart of coin flips.
  const series: SeriesPoint[] = []
  let claimed = 0
  let lived = 0
  history.forEach((match, index) => {
    claimed += match.expected
    lived += match.survived ? 1 : 0
    series.push({
      matches: index + 1,
      expected: claimed / (index + 1),
      actual: lived / (index + 1),
    })
  })

  // Both intervals are taken over matches, which are the independent events.
  const scored = history.length
  const survivorCount = history.filter((m) => m.survived).length
  const band = wilson(survivorCount, scored)
  const actualMargin = scored > 0 ? (band.high - band.low) / 2 : 0

  // Records written before the panel scored each match keep only its mean
  // claim; squaring that is the best available stand-in for the real thing.
  const perMatchBrier = history.map((m) =>
    typeof m.brier === 'number' ? m.brier : (m.expected - (m.survived ? 1 : 0)) ** 2,
  )
  const brierMargin = scored > 1 ? (Z * stdev(perMatchBrier)) / Math.sqrt(scored) : 0

  return {
    count,
    matches: store.matches,
    pending: Object.keys(store.open).length,
    expected,
    actual,
    buckets,
    series,
    brier,
    scored,
    actualMargin,
    brierMargin,
  }
}
