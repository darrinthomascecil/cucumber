/**
 * The shape of what the calibration panel writes down, kept apart from both
 * the React hook and the statistics so the sums can be tested without a DOM.
 */

export interface Sample {
  /** What the advisor said the chance of surviving the match was. */
  expected: number
  /** Whether this player did in fact survive it. */
  survived: boolean
}

/** One settled match: what the advisor averaged, and what happened. */
export interface MatchRecord {
  expected: number
  survived: boolean
  /**
   * That match's own Brier score, over every claim made inside it. Stored per
   * match because the interval on the headline Brier has to be taken over
   * matches — the independent events — and the raw samples cannot say which
   * match they came from.
   */
  brier?: number
}

export interface CalibrationStore {
  samples: Sample[]
  matches: number
  /** One entry per settled match, oldest first. */
  history: MatchRecord[]
  /** Unsettled claims for the match in progress, keyed by state version. */
  openMatch: string | null
  open: Record<string, number>
  /**
   * The advisor these claims were made by. A sample that mixes two advisors
   * measures neither, so a changed version starts the count again.
   */
  advisor?: string
}
