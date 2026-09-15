import { CLASS_COUNT, type CardClass } from './classes.ts'
import { unseenPool, type InfoSet } from './determinize.ts'
import { settleHand } from './outcome.ts'
import type { SeatIndex } from './sim.ts'

/**
 * The one corner of this game where the answer can be computed rather than
 * sampled.
 *
 * Every estimate elsewhere is Monte Carlo: sample worlds, play them out, take
 * the frequency. That is checkable only against itself — a calibration
 * statistic says an estimator is *consistent*, never that it is *right*. Here
 * there is a slice small enough to enumerate outright, which gives a number to
 * check the sampler against rather than another opinion.
 *
 * The slice: every seat holds exactly one card, so the hand is decided the
 * moment it is revealed, and the final cards settle the match. The observer
 * knows its own card; the other two are drawn from the unseen pool. There are
 * `|pool| × (|pool| − 1)` ordered assignments, every one equally likely under
 * a uniform deal, and each determines the outcome with no play left to model.
 *
 * The idea is borrowed from an exact closing forecast written against a
 * different representation (see `docs/advisor-endgame.md` on `origin/main`,
 * which enumerates 272 assignments for its fixture). Only the idea: this is
 * our own InfoSet, our own scoring, and it exists to check `honestSurvival`,
 * not to advise anybody.
 */

/** Ordered assignments of two distinct cards from a multiset of classes. */
function pairs(pool: Int8Array): { a: CardClass; b: CardClass; ways: number }[] {
  const out: { a: CardClass; b: CardClass; ways: number }[] = []
  for (let a = 0; a < CLASS_COUNT; a++) {
    if (pool[a]! === 0) continue
    for (let b = 0; b < CLASS_COUNT; b++) {
      // Two cards of the same class are distinguishable cards, so the count of
      // ordered draws is n(n−1) rather than n².
      const ways = a === b ? pool[a]! * (pool[a]! - 1) : pool[a]! * pool[b]!
      if (ways > 0) out.push({ a: a as CardClass, b: b as CardClass, ways })
    }
  }
  return out
}

export interface ExactFinal {
  /** P(this seat survives the match), computed by enumeration. */
  survival: number
  /** Ordered assignments considered — the enumeration's own size. */
  assignments: number
}

/**
 * Exact survival when every seat is down to its last card.
 *
 * Returns null when the position is outside the slice: any seat holding more
 * than one card, or a deal in which the match would continue past this hand,
 * because what follows is fresh deals and no longer enumerable. Refusing is
 * the point — a number produced outside the slice would be a sampled estimate
 * wearing an exact answer's clothes.
 */
export function exactFinalSurvival(info: InfoSet): ExactFinal | null {
  if (info.handSizes.some((n) => n !== 1)) return null

  let mine: CardClass | null = null
  for (let c = 0; c < CLASS_COUNT; c++) {
    if (info.hand[c]! === 1) {
      if (mine !== null) return null
      mine = c as CardClass
    } else if (info.hand[c]! !== 0) return null
  }
  if (mine === null) return null

  const others = ([0, 1, 2] as SeatIndex[]).filter((seat) => seat !== info.seat)
  const [left, right] = others as [SeatIndex, SeatIndex]
  const pool = unseenPool(info)

  let survived = 0
  let total = 0
  for (const { a, b, ways } of pairs(pool)) {
    const finals = [0, 0, 0] as [CardClass, CardClass, CardClass]
    finals[info.seat] = mine
    finals[left] = a
    finals[right] = b

    const outcome = settleHand(info.scores as [number, number, number], finals)
    // Outside the slice: the match would go on, and the rest is fresh deals.
    if (!outcome.matchOver) return null

    total += ways
    if (!outcome.losers.includes(info.seat as SeatIndex)) survived += ways
  }

  if (total === 0) return null
  return { survival: survived / total, assignments: total }
}
