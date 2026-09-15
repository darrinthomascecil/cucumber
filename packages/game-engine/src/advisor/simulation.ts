import { SEATS, type MatchState, type Seat } from '@cucumber/shared'
import { actionSeat, applyCommand } from '../stateMachine.ts'
import { viewFor } from '../view.ts'
import { advisorCommand, legalActions, type AdvisorAction } from './actions.ts'
import { DEFAULT_EXPLORATION, POLICY_NAMES, choosePolicyAction, policyProbabilities, type PolicyName } from './policy.ts'
import { advisorRng } from './random.ts'

export type LossProbabilities = Record<Seat, number>
export type SeatPolicies = Record<Seat, PolicyName>

function finalLosses(state: MatchState): LossProbabilities {
  return { 1: Number(state.losers.includes(1)), 2: Number(state.losers.includes(2)), 3: Number(state.losers.includes(3)) }
}

export function simulateMatch(
  initial: MatchState,
  policies: SeatPolicies,
  seed: number,
  exploration = DEFAULT_EXPLORATION,
): LossProbabilities {
  let state = initial
  const context = { rng: advisorRng(seed ^ 0x5f3759df) }
  const policyRng = { 1: advisorRng(seed ^ 101), 2: advisorRng(seed ^ 211), 3: advisorRng(seed ^ 307) }
  for (let turn = 0; turn < 1024; turn++) {
    if (state.phase === 'MATCH_OVER') return finalLosses(state)
    const seat = actionSeat(state) ?? state.players.find((player) => !player.ready)?.seat
    if (!seat) throw new Error('Simulation cannot identify an acting player')
    const view = viewFor(state, seat)
    const action = choosePolicyAction(view, policies[seat], policyRng[seat], exploration)
    state = applyCommand(state, seat, advisorCommand(view, action), context).state
  }
  throw new Error('Match simulation exceeded its finite-game guard')
}

function finalTrick(state: MatchState): boolean {
  if (state.phase !== 'TRICK_PLAY' || !state.trick) return false
  if (state.trick.plays.length === 0) return SEATS.every((seat) => state.hands[seat].length === 2)
  return SEATS.every((seat) => state.hands[seat].length === 1 || state.hands[seat].length === state.trick!.playCount + 1)
}

export function expectedContinuation(
  initial: MatchState,
  policies: SeatPolicies,
  seed: number,
  exploration = DEFAULT_EXPLORATION,
  firstAction?: AdvisorAction,
): LossProbabilities {
  let state = initial
  if (firstAction) {
    const seat = actionSeat(state)
    if (!seat) throw new Error('The proposed action has no acting seat')
    state = applyCommand(state, seat, advisorCommand(viewFor(state, seat), firstAction), { rng: advisorRng(seed ^ 997) }).state
  }
  if (state.phase === 'MATCH_OVER') return finalLosses(state)
  if (!finalTrick(state)) return simulateMatch(state, policies, seed, exploration)
  const seat = state.trick!.actionSeat
  const view = viewFor(state, seat)
  const result: LossProbabilities = { 1: 0, 2: 0, 3: 0 }
  const policyIndex = POLICY_NAMES.indexOf(policies[seat])
  for (const action of legalActions(view)) {
    const chance = policyProbabilities(view, action, exploration)[policyIndex]!
    if (chance === 0) continue
    const next = applyCommand(state, seat, advisorCommand(view, action), { rng: advisorRng(seed) }).state
    const outcome = expectedContinuation(next, policies, seed, exploration)
    for (const other of SEATS) result[other] += chance * outcome[other]
  }
  return result
}