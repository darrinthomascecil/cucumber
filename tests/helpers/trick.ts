import { startTrick } from '@cucumber/game-engine'
import type { CardId, MatchState, Seat } from '@cucumber/shared'
import { newMatch } from './match.ts'

/** A match parked in trick play with exactly the hands a scenario needs. */
export function trickTable(
  hands: Record<Seat, CardId[]>,
  leaderSeat: Seat = 1,
): MatchState {
  const base = newMatch()
  return {
    ...base,
    phase: 'TRICK_PLAY',
    handNumber: 1,
    dealerSeat: leaderSeat,
    hands: { 1: [...hands[1]], 2: [...hands[2]], 3: [...hands[3]] },
    stock: [],
    trick: startTrick(leaderSeat),
  }
}
