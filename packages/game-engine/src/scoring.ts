import { SEATS, type CardId, type HandResult, type Seat } from '@cucumber/shared'
import { isSevenOrJoker, scoreValue } from './ranking.ts'

/** A cumulative score at or above this ends the match (spec §29). */
export const LOSS_LIMIT = 21

/**
 * Spec §26-§30. Two loss conditions, one of which dominates:
 *
 *  - Any player whose final card is a 7 or a Joker loses immediately, however
 *    the cumulative scores fall. Several such players all lose.
 *  - Otherwise, final card values are added; if anyone has reached 21 the
 *    highest cumulative score loses, and an exact tie at the top loses jointly.
 */
export function computeHandResult(
  handNumber: number,
  finalCards: Record<Seat, CardId>,
  scoresBefore: Record<Seat, number>,
): HandResult {
  const scoresAfter = { 1: 0, 2: 0, 3: 0 } as Record<Seat, number>
  for (const seat of SEATS) {
    scoresAfter[seat] = scoresBefore[seat] + scoreValue(finalCards[seat])
  }

  const instantLossSeats = SEATS.filter((seat) => isSevenOrJoker(finalCards[seat]))
  if (instantLossSeats.length > 0) {
    return {
      handNumber,
      finalCards,
      scoresBefore,
      scoresAfter,
      instantLossSeats,
      losers: instantLossSeats,
      matchOver: true,
      reason: 'SEVEN_OR_JOKER',
    }
  }

  const highest = Math.max(...SEATS.map((seat) => scoresAfter[seat]))
  if (highest >= LOSS_LIMIT) {
    return {
      handNumber,
      finalCards,
      scoresBefore,
      scoresAfter,
      instantLossSeats,
      losers: SEATS.filter((seat) => scoresAfter[seat] === highest),
      matchOver: true,
      reason: 'SCORE_LIMIT',
    }
  }

  return {
    handNumber,
    finalCards,
    scoresBefore,
    scoresAfter,
    instantLossSeats,
    losers: [],
    matchOver: false,
    reason: 'CONTINUE',
  }
}
