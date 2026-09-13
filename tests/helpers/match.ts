import {
  applyCommand,
  createMatch,
  setConnection,
  type EngineContext,
} from '@cucumber/game-engine'
import { SEATS, type CardId, type ClientCommand, type MatchState, type Seat } from '@cucumber/shared'
import { seededRng } from './rng.ts'

export function ctx(seed = 12345): EngineContext {
  return { rng: seededRng(seed) }
}

export function command(partial: Partial<ClientCommand> & { type: ClientCommand['type'] }): ClientCommand {
  return {
    matchId: 'test-match',
    expectedVersion: 0,
    actionId: 'test-action',
    ...partial,
  } as ClientCommand
}

export function newMatch(): MatchState {
  let state = createMatch('test-match', [
    { userId: 'u1', displayName: 'Alice' },
    { userId: 'u2', displayName: 'Bob' },
    { userId: 'u3', displayName: 'Charlie' },
  ])
  for (const seat of SEATS) state = setConnection(state, seat, 'ONLINE', ctx()).state
  return state
}

/** Three ready players; the match deals and waits on the dealer. */
export function startedMatch(seed = 12345): MatchState {
  const context = ctx(seed)
  let state = newMatch()
  for (const seat of SEATS) {
    state = applyCommand(state, seat, command({ type: 'READY', ready: true }), context).state
  }
  return state
}

export function act(
  state: MatchState,
  seat: Seat,
  cmd: ClientCommand,
  context: EngineContext = ctx(),
): MatchState {
  return applyCommand(state, seat, cmd, context).state
}

/** Overwrite the deal so a scenario can be set up exactly. */
export function stackHands(
  state: MatchState,
  hands: Record<Seat, CardId[]>,
): MatchState {
  return { ...state, hands: { 1: [...hands[1]], 2: [...hands[2]], 3: [...hands[3]] } }
}
