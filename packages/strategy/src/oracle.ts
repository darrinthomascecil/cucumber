import { cloneCounts, type Counts } from './classes.ts'
import { heuristicPolicy, type Weights } from './heuristic.ts'
import { handValue, settleHand } from './outcome.ts'
import type { Random } from './random.ts'
import { playMatch, weightedDiscards, type Player } from './selfPlay.ts'
import {
  cloneSim,
  commit,
  finalClasses,
  playOut,
  type Candidate,
  type Policy,
  type SeatIndex,
  type Sim,
} from './sim.ts'

/**
 * A diagnostic, and only a diagnostic: a player that is shown every hand at
 * the table.
 *
 * It exists to answer one question — how much is the hidden information
 * actually worth? The gap between this cheat and the honest search is a
 * ceiling on what any amount of better reasoning about unseen cards could
 * buy. It is never reachable from the advisor, which is handed a PlayerView
 * and has nothing to cheat with.
 *
 * Because the rollout policy is deterministic, this player's evaluation of
 * each candidate is exact given how the others will play: it is the best
 * response to heuristic opponents under perfect information.
 */
export function oraclePlayer(name: string, weights: Weights, exchange = 3): {
  player: Player
  attach: (sim: Sim) => void
} {
  let table: Sim | null = null
  const rollout: Policy = heuristicPolicy(weights)
  const policies: [Policy, Policy, Policy] = [rollout, rollout, rollout]

  const policy: Policy = (view, candidates) => {
    if (candidates.length === 1) return 0
    const live = table
    if (!live) return rollout(view, candidates)
    const seat = view.seat as SeatIndex
    let bestIndex = 0
    let best = -Infinity
    for (let i = 0; i < candidates.length; i++) {
      const sim = cloneSim(live)
      commit(sim, seat, candidates[i] as Candidate)
      playOut(sim, policies)
      const value = handValue(settleHand(sim.scores, finalClasses(sim)), seat)
      if (value > best) {
        best = value
        bestIndex = i
      }
    }
    return bestIndex
  }

  return {
    player: {
      name,
      policy,
      exchangeSize: () => exchange,
      takeExchange: (_hand: Counts, size: number) => size,
      discards: weightedDiscards(weights),
    },
    attach: (sim: Sim) => {
      table = sim
    },
  }
}

/** One seat cheats, the other two play the heuristic. */
export function oracleTrial(
  weights: Weights,
  matches: number,
  random: Random,
  startIndex = 0,
): { lossRate: number; matches: number; error: number } {
  const oracle = oraclePlayer('oracle', weights)
  const honest = heuristicPolicy(weights)
  const opponent: Player = {
    name: 'heuristic',
    policy: honest,
    exchangeSize: () => 3,
    takeExchange: (_hand, size) => size,
    discards: weightedDiscards(weights),
  }

  let losses = 0
  for (let m = 0; m < matches; m++) {
    const seat = ((startIndex + m) % 3) as SeatIndex
    const line: [Player, Player, Player] = [opponent, opponent, opponent]
    line[seat] = oracle.player
    const record = playMatch(line, random, 60, oracle.attach)
    if (record.losers.includes(seat)) losses++
  }
  const rate = losses / matches
  return { lossRate: rate, matches, error: Math.sqrt((rate * (1 - rate)) / matches) }
}

export { cloneCounts }
