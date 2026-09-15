/**
 * Scoring probabilistic claims.
 *
 * A Brier score on its own says very little: it moves with the base rate, it
 * moves with luck, and a forecaster can improve it either by knowing more or
 * by hedging more. Murphy's decomposition separates those, which is the only
 * way to tell "the advisor got better" from "the sample got easier".
 */

/** One settled claim: what was said, and whether it happened. */
export interface Claim {
  p: number
  /** 1 if it happened, 0 if it did not. */
  y: number
}

export interface Bin {
  from: number
  to: number
  count: number
  /** Mean claim inside this bin. */
  said: number
  /** Share of this bin that actually happened. */
  happened: number
}

export interface Decomposition {
  claims: number
  brier: number
  /** The base rate's own variance: what you score with no skill at all. */
  uncertainty: number
  /** How far the bins separate outcomes. Bigger is better; it is subtracted. */
  resolution: number
  /** What miscalibration costs. Smaller is better; it is added. */
  reliability: number
  /**
   * `brier − (reliability − resolution + uncertainty)`.
   *
   * The classical identity is exact only when every claim inside a bin is the
   * same number. Real claims are continuous, so binning leaves a remainder,
   * and reporting it is how you know whether the decomposition can be trusted
   * rather than assuming it.
   */
  residual: number
  bins: Bin[]
}

const Z = 1.96

export function brierOf(claims: readonly Claim[]): number {
  if (claims.length === 0) return 0
  return claims.reduce((sum, c) => sum + (c.p - c.y) ** 2, 0) / claims.length
}

/**
 * Wilson score interval. Stays inside [0, 1] and behaves at small counts,
 * which the textbook normal approximation does neither of.
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
export function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1))
}

/**
 * The 95% half-width of a Brier score, taken over *matches*.
 *
 * Never over claims. Every claim inside one match shares that match's single
 * outcome, so an interval over claims is several times too narrow and every
 * ordinary wobble reads as a real change.
 */
export function brierBand(perMatchBrier: readonly number[]): number {
  const n = perMatchBrier.length
  if (n < 2) return 0
  return (Z * stdev(perMatchBrier)) / Math.sqrt(n)
}

export const DEFAULT_EDGES = [0, 0.2, 0.4, 0.6, 0.8, 1.0001]

export function decompose(
  claims: readonly Claim[],
  edges: readonly number[] = DEFAULT_EDGES,
): Decomposition {
  if (claims.length === 0) {
    return {
      claims: 0,
      brier: 0,
      uncertainty: 0,
      resolution: 0,
      reliability: 0,
      residual: 0,
      bins: [],
    }
  }

  const n = claims.length
  const base = claims.reduce((sum, c) => sum + c.y, 0) / n
  const uncertainty = base * (1 - base)

  const bins: Bin[] = []
  let reliability = 0
  let resolution = 0
  for (let i = 0; i < edges.length - 1; i++) {
    const from = edges[i]!
    const to = edges[i + 1]!
    const inside = claims.filter((c) => c.p >= from && c.p < to)
    if (inside.length === 0) continue
    const said = inside.reduce((sum, c) => sum + c.p, 0) / inside.length
    const happened = inside.reduce((sum, c) => sum + c.y, 0) / inside.length
    const share = inside.length / n
    reliability += share * (said - happened) ** 2
    resolution += share * (happened - base) ** 2
    bins.push({ from, to: Math.min(to, 1), count: inside.length, said, happened })
  }

  const brier = brierOf(claims)
  return {
    claims: n,
    brier,
    uncertainty,
    resolution,
    reliability,
    residual: brier - (reliability - resolution + uncertainty),
    bins,
  }
}
