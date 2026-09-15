import { sampleFullWorld, type InfoSet, type WorldPrior } from './determinize.ts'
import { settleHand } from './outcome.ts'
import { buildSim, type TrickContext } from './search.ts'
import { heuristicPlayer, playHand, type Player } from './selfPlay.ts'
import { finalClasses, leftOfIndex, playOut, type SeatIndex } from './sim.ts'
import { TUNED } from './heuristic.ts'
import type { Random } from './random.ts'

/**
 * The honest oracle: P(this seat survives the match | everything it can see).
 *
 * This is the quantity the Brier floor is built on. The best possible forecast
 * at a position is `p* = P(survive | legally visible information)`, and the
 * lowest Brier any forecaster can reach is `E[p*(1 − p*)]` — the uncertainty
 * that remains after conditioning on everything knowable.
 *
 * Each imagined world is played out by policies that see only their own hand.
 *
 * NOTE, corrected 2026-09-15: earlier comments here claimed the advisor plays
 * its imagined worlds **face up** and that this was the point of difference.
 * That is false, and an outside review caught it. `searchActions` rolls out
 * with `heuristicPolicy`, which receives a per-seat `PolicyView` and has no
 * access to hidden hands; the perfect-information path is `solveChoices`,
 * gated on `solveFrom > 0`, which defaults to off. ADVISOR.md's "played as
 * though all hands were visible" describes a real weakness — these rollouts
 * cannot value concealment, because the policies do not reason about
 * information at all — but it misnames the mechanism, and I repeated it
 * without checking the code.
 *
 * What remains genuinely different here: it is played to the end of the
 * *match*, not the end of the hand. The
 * advisor stops at the hand boundary and applies a fitted continuation value —
 * two grid-searched numbers, by its own account the least-measured component
 * it has. A floor resting on a fitted guess would be measuring the guess.
 */
export interface HonestOracleOptions {
  /** Worlds to sample. The estimate's own variance is p(1−p)/worlds. */
  worlds?: number
  /** Who plays the imagined worlds out. Must not see other hands. */
  players?: [Player, Player, Player]
  /** Safety valve; every hand adds at least 2 points to every score. */
  maxHands?: number
  /**
   * Cards each seat exchanged this hand. Public information, and without it
   * the sampled worlds are drawn uniformly from the unseen cards — correct
   * only when nobody exchanged. Supplying it is worth 8 points of calibration;
   * see WorldPrior and tools/exchange-control.ts.
   */
  exchanged?: readonly [number, number, number]
}

export interface HonestEstimate {
  /** Share of sampled worlds this seat survived. */
  survival: number
  worlds: number
  /**
   * Variance this estimate adds on top of the true `p*`, being `p(1−p)/worlds`.
   *
   * It matters because a Brier computed from `p̂*` rather than `p*` is inflated
   * by exactly this much, and the floor is only honest once it is subtracted.
   */
  bias: number
}

function tunedLine(): [Player, Player, Player] {
  const p = heuristicPlayer('tuned', TUNED)
  return [p, p, p]
}

export function honestSurvival(
  info: InfoSet,
  trick: TrickContext,
  random: Random,
  options: HonestOracleOptions = {},
): HonestEstimate {
  const worlds = options.worlds ?? 400
  const players = options.players ?? tunedLine()
  const maxHands = options.maxHands ?? 60
  const seat = info.seat

  // The opponents' own discard policy models what they threw. Nothing is
  // invented and no hidden card is touched: it draws a hypothetical
  // pre-discard hand and asks that policy what it would have parted with.
  const prior: WorldPrior | undefined = options.exchanged
    ? {
        exchanged: options.exchanged,
        discards: (hand, n) => players[seat === 0 ? 1 : 0]!.discards(hand, n),
      }
    : undefined

  let survived = 0

  for (let w = 0; w < worlds; w++) {
    // A world consistent with everything this seat can see.
    const hands = sampleFullWorld(info, random, prior).hands
    const sim = buildSim(info, trick, hands)

    // Finish the hand in progress, blind on all three sides.
    playOut(sim, [players[0].policy, players[1].policy, players[2].policy])
    let outcome = settleHand(info.scores as [number, number, number], finalClasses(sim))

    // Then keep dealing until the match actually ends. No continuation model.
    let dealer = trick.leaderSeat
    for (let hand = 1; !outcome.matchOver && hand <= maxHands; hand++) {
      dealer = leftOfIndex(dealer)
      const record = playHand(players, outcome.scores, dealer, random)
      outcome = record.outcome
    }

    if (!outcome.losers.includes(seat as SeatIndex)) survived++
  }

  const survival = survived / worlds
  return { survival, worlds, bias: (survival * (1 - survival)) / worlds }
}
