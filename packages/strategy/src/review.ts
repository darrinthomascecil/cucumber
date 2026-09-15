import type { CardId } from '@cucumber/shared'
import type { Advice, Suggestion } from './advise.ts'

/**
 * Judging a match after it is over.
 *
 * The advisor already evaluates every legal action at every decision, and
 * already knows what each one is worth relative to the best — that is what
 * `Suggestion.cost` is. Nothing here computes anything the advisor did not
 * already work out; it pairs those evaluations with what the player actually
 * did, once the match is finished and the advice can no longer help them.
 */

/**
 * Below this, two plays are not distinguishable by the search.
 *
 * ADVISOR.md, on its own known weaknesses: "an alternative at −0% or −1% is
 * not reliably worse". Calling such a play a mistake would be lying with
 * arithmetic — the estimator cannot tell those two apart, so neither can the
 * review. R5 replaces this constant with a measured one.
 */
export const NOISE = 0.02

/** One decision the player faced, with what the advisor thought of it. */
export interface Decision {
  handNumber: number
  kind: Advice['kind']
  /** Every option the advisor evaluated, best first. */
  options: Suggestion[]
  /** The cards the player actually played. */
  played: CardId[]
  /** Where the advisor thought the player stood before they chose. */
  odds: number
}

export interface Judged extends Decision {
  /** The evaluated option matching what was played, if there was one. */
  chosen: Suggestion | null
  best: Suggestion | null
  /** Win probability handed back: 0 when the best play was found. */
  cost: number
  /** True when the gap is inside the noise and either play was fine. */
  withinNoise: boolean
}

export interface ReviewSummary {
  decisions: number
  judged: Judged[]
  /** Only the decisions where a clearly better play existed. */
  mistakes: Judged[]
  /** Probability handed back across the whole match. */
  totalCost: number
  /** The single most expensive decision, if any cost anything. */
  worstMoment: Judged | null
  /**
   * Share of decisions where the player found the best play, or one the
   * search cannot tell from it. Plays the advisor never evaluated do not
   * count against the player — see `unscored`.
   */
  accuracy: number
  /**
   * Decisions where what was played is not among the evaluated options. The
   * advisor screens the action list down before searching, so a play it
   * never considered has no score, and guessing one would be inventing
   * evidence.
   */
  unscored: number
}

/** Same cards, in any order. */
function samePlay(a: readonly CardId[], b: readonly CardId[]): boolean {
  if (a.length !== b.length) return false
  const left = [...a].sort()
  const right = [...b].sort()
  return left.every((card, i) => card === right[i])
}

export function judge(decision: Decision, noise = NOISE): Judged {
  const chosen = decision.options.find((o) => samePlay(o.cards, decision.played)) ?? null
  // Options arrive best first, but nothing here depends on that holding.
  const best =
    decision.options.reduce<Suggestion | null>(
      (top, o) => (top === null || o.winProbability > top.winProbability ? o : top),
      null,
    ) ?? null

  const cost = chosen && best ? Math.max(0, best.winProbability - chosen.winProbability) : 0
  return {
    ...decision,
    chosen,
    best,
    cost,
    withinNoise: cost <= noise,
  }
}

export function review(decisions: readonly Decision[], noise = NOISE): ReviewSummary {
  const judged = decisions.map((d) => judge(d, noise))
  const scored = judged.filter((j) => j.chosen !== null)
  const mistakes = judged.filter((j) => j.chosen !== null && !j.withinNoise)
  const totalCost = judged.reduce((sum, j) => sum + j.cost, 0)

  const worstMoment =
    mistakes.reduce<Judged | null>(
      (worst, j) => (worst === null || j.cost > worst.cost ? j : worst),
      null,
    ) ?? null

  return {
    decisions: decisions.length,
    judged,
    mistakes,
    totalCost,
    worstMoment,
    accuracy: scored.length === 0 ? 1 : (scored.length - mistakes.length) / scored.length,
    unscored: judged.length - scored.length,
  }
}
