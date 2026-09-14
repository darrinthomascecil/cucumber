import { CLASS_COUNT, type Counts } from './classes.ts'
import { heuristicPolicy, TUNED } from './heuristic.ts'
import { handValue, settleHand, type ContinuationModel } from './outcome.ts'
import {
  type Candidate,
  candidatesFor,
  cloneSim,
  commit,
  finalClasses,
  handOver,
  playOut,
  policyView,
  type Policy,
  type SeatIndex,
  type Sim,
} from './sim.ts'

/**
 * An exact solver for the end of a hand.
 *
 * Once the hands are short the remaining game is small enough to walk to the
 * bottom, so there is no reason to guess at it. Where the search elsewhere
 * plays a position out with a heuristic and takes the result on trust, this
 * returns the true value of the position — for all three seats at once,
 * because in a three-handed game the others' prospects are part of your own.
 */

export type OpponentModel =
  /** All three seats play to maximise their own survival. A genuine solve. */
  | { kind: 'optimal' }
  /**
   * The other two follow a fixed policy and only the solving seat branches.
   * This is the best reply to opponents who really do play that way, and it
   * is much cheaper, because only one seat's choices multiply.
   */
  | { kind: 'model'; seat: SeatIndex; policy: Policy }

export interface SolveOptions {
  opponents: OpponentModel
  /** Give up and report failure rather than exploring past this many states. */
  nodeBudget?: number
  continuation?: ContinuationModel
}

export interface SolveResult {
  /** Probability each seat does not lose the match, under exact play. */
  values: [number, number, number]
  /** Distinct states visited. */
  nodes: number
  /** False when the budget ran out and the answer is not trustworthy. */
  exact: boolean
}

/**
 * Two positions are the same position if the three hands, whose turn it is,
 * and the state of the current trick all agree. Suits and card identity never
 * enter into it — the class model saw to that — so the table of positions is
 * far smaller than the number of deals that reach them.
 */
function keyOf(sim: Sim): string {
  const parts: number[] = []
  for (let seat = 0; seat < 3; seat++) {
    const hand = sim.hands[seat] as Counts
    for (let c = 0; c < CLASS_COUNT; c++) parts.push(hand[c]!)
  }
  parts.push(sim.actionSeat, sim.playsMade, sim.successfulSeat, sim.target.length)
  for (const card of sim.target) parts.push(card)
  return String.fromCharCode(...parts.map((n) => n + 33))
}

/**
 * Value of a position the solver ran out of budget on.
 *
 * This used to call `terminalValues` directly, which reads each seat's lowest
 * remaining card as though it were their last — so a hand still holding a
 * 7 alongside a 2 was scored as a 2, and every dangerous card left in play
 * simply vanished from the valuation. Playing the position out gives an
 * estimate that is at least about the game being played.
 */
function estimateValues(
  sim: Sim,
  options: SolveOptions,
): [number, number, number] {
  const policy =
    options.opponents.kind === 'model' ? options.opponents.policy : DEFAULT_FALLBACK
  const finished = cloneSim(sim)
  playOut(finished, [policy, policy, policy])
  return terminalValues(finished, options.continuation)
}

const DEFAULT_FALLBACK: Policy = heuristicPolicy(TUNED)

function terminalValues(
  sim: Sim,
  continuation: ContinuationModel | undefined,
): [number, number, number] {
  const outcome = settleHand(sim.scores, finalClasses(sim))
  return [
    handValue(outcome, 0, continuation),
    handValue(outcome, 1, continuation),
    handValue(outcome, 2, continuation),
  ]
}

class Budget {
  used = 0
  exhausted = false
  readonly limit: number

  constructor(limit: number) {
    this.limit = limit
  }

  spend(): boolean {
    if (this.used >= this.limit) {
      this.exhausted = true
      return false
    }
    this.used++
    return true
  }
}

function search(
  sim: Sim,
  options: SolveOptions,
  memo: Map<string, [number, number, number]>,
  budget: Budget,
): [number, number, number] {
  if (handOver(sim)) return terminalValues(sim, options.continuation)

  const key = keyOf(sim)
  const cached = memo.get(key)
  if (cached) return cached
  if (!budget.spend()) return estimateValues(sim, options)

  const seat = sim.actionSeat
  const candidates = candidatesFor(sim, seat)

  const model = options.opponents
  if (model.kind === 'model' && seat !== model.seat) {
    // The opponent is assumed to play one way, so this node has one child.
    const choice = candidates[model.policy(policyView(sim, seat), candidates)] ?? candidates[0]!
    const child = cloneSim(sim)
    commit(child, seat, choice)
    const value = search(child, options, memo, budget)
    memo.set(key, value)
    return value
  }

  let best: [number, number, number] | null = null
  for (const candidate of candidates) {
    const child = cloneSim(sim)
    commit(child, seat, candidate)
    const value = search(child, options, memo, budget)
    if (!best) {
      best = value
      continue
    }
    if (value[seat]! > best[seat]!) {
      best = value
      continue
    }
    if (value[seat]! === best[seat]!) {
      // Only the highest scorer loses, so among plays that are equally good
      // for you, prefer the one that leaves the others worst off.
      const others = ([0, 1, 2] as SeatIndex[]).filter((s) => s !== seat)
      const rival = (v: [number, number, number]) => Math.max(v[others[0]!]!, v[others[1]!]!)
      if (rival(value) < rival(best)) best = value
    }
  }

  const result = best ?? terminalValues(sim, options.continuation)
  memo.set(key, result)
  return result
}

/**
 * The exact value of every move available here, sharing one table of
 * positions between them.
 *
 * That sharing is the whole point: the lines after two different first moves
 * converge almost immediately, so pricing ten moves costs barely more than
 * pricing one.
 */
export function solveChoices(
  sim: Sim,
  seat: SeatIndex,
  candidates: readonly Candidate[],
  options: SolveOptions,
): { values: [number, number, number][]; nodes: number; exact: boolean } {
  const budget = new Budget(options.nodeBudget ?? 400_000)
  const memo = new Map<string, [number, number, number]>()
  const values: [number, number, number][] = []
  for (const candidate of candidates) {
    const child = cloneSim(sim)
    commit(child, seat, candidate)
    values.push(search(child, options, memo, budget))
  }
  return { values, nodes: budget.used, exact: !budget.exhausted }
}

/** Solve the position exactly. `sim` is not modified. */
export function solveEndgame(sim: Sim, options: SolveOptions): SolveResult {
  const budget = new Budget(options.nodeBudget ?? 400_000)
  const memo = new Map<string, [number, number, number]>()
  const values = search(cloneSim(sim), options, memo, budget)
  return { values, nodes: budget.used, exact: !budget.exhausted }
}

/** How many cards each seat is holding, when they are level. */
export function levelHandSize(sim: Sim): number {
  let total = 0
  const hand = sim.hands[0] as Counts
  for (let c = 0; c < CLASS_COUNT; c++) total += hand[c]!
  return total
}
