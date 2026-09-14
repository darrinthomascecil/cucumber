import { cloneCounts, type Counts } from './classes.ts'
import { sampleWorld, type InfoSet } from './determinize.ts'
import { heuristicPolicy, scoreCandidate, TUNED, type Weights } from './heuristic.ts'
import { solveChoices, type SolveOptions } from './endgame.ts'
import { handValue, settleHand, type ContinuationModel } from './outcome.ts'
import type { Random } from './random.ts'
import {
  candidatesFor,
  cloneSim,
  commit,
  finalClasses,
  newSim,
  playOut,
  type Candidate,
  type Policy,
  type SeatIndex,
  type Sim,
} from './sim.ts'

/** Where the current trick has got to — all of it public. */
export interface TrickContext {
  leaderSeat: SeatIndex
  successfulSeat: SeatIndex
  target: number[]
  playsMade: number
}

export interface SearchOptions {
  /** How many consistent deals to sample. More is steadier, not smarter. */
  worlds?: number
  weights?: Weights
  continuation?: ContinuationModel
  /** Cap on actions evaluated; the rest are dropped by heuristic score. */
  maxActions?: number
  /**
   * Whether to narrow the imagined deals using what the other players have
   * publicly failed to do. On by default; the switch exists so the gain can
   * be measured rather than assumed.
   */
  inference?: boolean
  /**
   * Hand size at or below which each imagined deal is solved exactly instead
   * of played out with the heuristic. 0 disables it.
   */
  solveFrom?: number
  /** Whether the solve assumes the others play well, or play the heuristic. */
  solveMode?: 'optimal' | 'model'
  solveNodeBudget?: number
}

export interface ActionValue {
  candidate: Candidate
  /** Probability of not losing the match, estimated over the sampled worlds. */
  value: number
}

export interface SearchResult {
  actions: ActionValue[]
  worlds: number
  /** The value of playing the best action — the position's own odds. */
  best: number
}

/** Cards in hand for the seat doing the thinking. */
function handSizeOf(info: InfoSet): number {
  return info.handSizes[info.seat]!
}

function buildSim(
  info: InfoSet,
  trick: TrickContext,
  hands: [Counts, Counts, Counts],
): Sim {
  const sim = newSim(hands, [...info.scores] as [number, number, number], trick.leaderSeat)
  sim.actionSeat = info.seat
  sim.target = [...trick.target]
  sim.successfulSeat = trick.successfulSeat
  sim.playsMade = trick.playsMade
  return sim
}

/**
 * Perfect-information Monte Carlo. Deal the unseen cards many different ways
 * that are all consistent with what the player knows, play each one out, and
 * keep the action that survives most often.
 *
 * Every world is evaluated against every action (common random numbers), so
 * the comparison between two actions is far steadier than their individual
 * estimates are.
 */
export function searchActions(
  info: InfoSet,
  trick: TrickContext,
  random: Random,
  options: SearchOptions = {},
): SearchResult {
  const worlds = options.worlds ?? 160
  const weights = options.weights ?? TUNED
  const maxActions = options.maxActions ?? 14

  const probe = buildSim(info, trick, [
    cloneCounts(info.hand),
    cloneCounts(info.hand),
    cloneCounts(info.hand),
  ])
  let actions = candidatesFor(probe, info.seat)
  const context = { hand: info.hand, scores: info.scores, seat: info.seat }
  if (actions.length > maxActions) {
    actions = [...actions]
      .sort(
        (a, b) =>
          scoreCandidate(b, context, weights) - scoreCandidate(a, context, weights),
      )
      .slice(0, maxActions)
  }

  const policy: Policy = heuristicPolicy(weights)
  const policies: [Policy, Policy, Policy] = [policy, policy, policy]
  const totals = new Float64Array(actions.length)

  // Once the hands are short enough, stop guessing at each imagined deal and
  // work it out exactly.
  const solveFrom = options.solveFrom ?? 0
  const solving = solveFrom > 0 && handSizeOf(info) <= solveFrom
  const solveOptions: SolveOptions = {
    opponents:
      options.solveMode === 'optimal'
        ? { kind: 'optimal' }
        : { kind: 'model', seat: info.seat, policy },
    nodeBudget: options.solveNodeBudget ?? 200_000,
    ...(options.continuation ? { continuation: options.continuation } : {}),
  }

  for (let w = 0; w < worlds; w++) {
    const hands = sampleWorld(info, random)
    const base = buildSim(info, trick, hands)
    if (solving) {
      const solved = solveChoices(base, info.seat, actions, solveOptions)
      for (let a = 0; a < actions.length; a++) totals[a]! += solved.values[a]![info.seat]!
      continue
    }
    for (let a = 0; a < actions.length; a++) {
      const sim = cloneSim(base)
      commit(sim, info.seat, actions[a]!)
      playOut(sim, policies)
      const outcome = settleHand(sim.scores, finalClasses(sim))
      totals[a]! += handValue(outcome, info.seat, options.continuation)
    }
  }

  const values: ActionValue[] = actions.map((candidate, index) => ({
    candidate,
    value: totals[index]! / worlds,
  }))
  values.sort((a, b) => b.value - a.value)
  return { actions: values, worlds, best: values[0]?.value ?? 0 }
}

/**
 * A policy that searches instead of guessing. It is handed the same restricted
 * view as any other policy — its strength comes from imagining the unseen
 * cards many ways, not from being told what they are.
 */
export function searchPolicy(random: Random, options: SearchOptions = {}): Policy {
  return (view, candidates) => {
    if (candidates.length === 1) return 0
    const info: InfoSet = {
      seat: view.seat,
      hand: view.hand,
      played: view.played,
      mine: view.mine,
      handSizes: view.handSizes,
      scores: view.scores,
      ...(options.inference === false ? {} : { failures: view.failures }),
    }
    const trick: TrickContext = {
      leaderSeat: view.leaderSeat,
      successfulSeat: view.successfulSeat,
      target: view.target,
      playsMade: view.playsMade,
    }
    const result = searchActions(info, trick, random, options)
    const best = result.actions[0]
    if (!best) return 0
    // Map the chosen multiset back to the caller's candidate list.
    for (let i = 0; i < candidates.length; i++) {
      const counts = candidates[i]!.counts
      let same = true
      for (let c = 0; c < counts.length; c++) {
        if (counts[c] !== best.candidate.counts[c]) {
          same = false
          break
        }
      }
      if (same) return i
    }
    return 0
  }
}
