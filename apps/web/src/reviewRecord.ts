import type { CardId, PlayerView } from '@cucumber/shared'
import type { Advice, Decision } from '@cucumber/strategy'

/**
 * Writing down what you did, while you cannot see what you should have done.
 *
 * The advisor evaluates your position whether or not the panel is on screen,
 * and its evaluation is worth keeping: it is the only record of what the best
 * play was at the moment you were choosing. Afterwards it cannot be
 * reconstructed honestly — by then the cards are face up, and a judgement made
 * with that knowledge would not be judging the decision you actually faced.
 */

export interface RecorderState {
  matchId: string | null
  decisions: Decision[]
}

export const emptyRecorder: RecorderState = { matchId: null, decisions: [] }

export interface Played {
  view: PlayerView
  advice: Advice | null
  /** The state version the advice was computed for. */
  adviceVersion: number | null
  cards: CardId[]
}

/** Advice is only about this decision if it was computed for this position. */
function adviceFor(input: Played): Advice | null {
  if (!input.advice) return null
  if (input.adviceVersion !== input.view.version) return null
  if (input.advice.kind !== 'PLAY' && input.advice.kind !== 'DISCARD') return null
  return input.advice
}

/**
 * Add one decision. A new match starts a new record: claims about a match
 * that is over say nothing about the one being played.
 */
export function record(state: RecorderState, input: Played): RecorderState {
  const fresh =
    state.matchId === input.view.matchId ? state : { matchId: input.view.matchId, decisions: [] }

  const advice = adviceFor(input)
  // Recorded even when there was no advice in time — a decision the advisor
  // never evaluated is left unscored rather than dropped, so the count of
  // decisions stays honest about what the review could and could not judge.
  const decision: Decision = {
    handNumber: input.view.handNumber,
    kind: advice?.kind ?? 'NONE',
    options: advice?.suggestions ?? [],
    played: input.cards,
    odds: advice?.winProbability ?? 0,
  }

  return { matchId: fresh.matchId, decisions: [...fresh.decisions, decision] }
}
