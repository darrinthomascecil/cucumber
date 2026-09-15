import { sampleFullWorld, type InfoSet } from './determinize.ts'
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
 * The one thing that makes it *honest*, and the whole reason it is not the
 * advisor's own estimate: each imagined world is played out by policies that
 * see only their own hand. The advisor plays its imagined worlds **face up**,
 * which credits every player with knowledge nobody has and is exactly why its
 * odds are optimistic. ADVISOR.md is explicit that this is its known weakness:
 * "it assumes you can act differently in worlds you cannot tell apart".
 *
 * It is also played to the end of the *match*, not the end of the hand. The
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

  let survived = 0

  for (let w = 0; w < worlds; w++) {
    // A world consistent with everything this seat can see.
    const hands = sampleFullWorld(info, random).hands
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
