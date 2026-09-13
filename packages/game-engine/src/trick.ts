import { leftOf, type CardId, type Seat, type TrickState } from '@cucumber/shared'

export function startTrick(leaderSeat: Seat): TrickState {
  return {
    leaderSeat,
    playCount: 0,
    actionSeat: leaderSeat,
    targetCards: [],
    targetSeat: null,
    successfulSeat: null,
    plays: [],
  }
}

/** The leader's play always becomes the first target (spec §12/§13). */
export function applyLead(trick: TrickState, seat: Seat, cards: CardId[]): TrickState {
  return {
    ...trick,
    playCount: cards.length,
    targetCards: [...cards],
    targetSeat: seat,
    successfulSeat: seat,
    actionSeat: leftOf(seat),
    plays: [{ seat, cards: [...cards], successful: true }],
  }
}

/**
 * Spec §23: a forced-low play does not become the new target — the target
 * always reflects the most recent *successful* play.
 */
export function applyFollow(
  trick: TrickState,
  seat: Seat,
  cards: CardId[],
  successful: boolean,
): TrickState {
  return {
    ...trick,
    targetCards: successful ? [...cards] : trick.targetCards,
    targetSeat: successful ? seat : trick.targetSeat,
    successfulSeat: successful ? seat : trick.successfulSeat,
    actionSeat: leftOf(seat),
    plays: [...trick.plays, { seat, cards: [...cards], successful }],
  }
}

export function isTrickComplete(trick: TrickState): boolean {
  return trick.plays.length === 3
}

/** Spec §24: the last player to succeed leads the next trick. */
export function nextLeader(trick: TrickState): Seat {
  return trick.successfulSeat ?? trick.leaderSeat
}

export function trickCards(trick: TrickState): CardId[] {
  return trick.plays.flatMap((play) => play.cards)
}
