import {
  applyCommand,
  canMeetTarget,
  findQualifyingPlay,
  forcedLowRequirement,
  sortByTrickStrength,
  type EngineContext,
} from '@cucumber/game-engine'
import type { CardId, MatchState, Seat } from '@cucumber/shared'
import { command } from './match.ts'

/** Picks a legal play without any strategy — enough to drive a hand to its end. */
export function chooseCards(state: MatchState, seat: Seat): CardId[] {
  const trick = state.trick!
  const hand = state.hands[seat]
  if (trick.plays.length === 0) {
    return [sortByTrickStrength(hand)[0] as CardId]
  }
  const target = trick.targetCards
  if (canMeetTarget(hand, target)) {
    return findQualifyingPlay(hand, target) as CardId[]
  }
  const forced = forcedLowRequirement(hand, target.length)
  return [...forced.mandatory, ...forced.choices.slice(0, forced.chooseCount)]
}

/** Plays out trick after trick until the hand (or the match) ends. */
export function playOutHand(state: MatchState, ctx: EngineContext): MatchState {
  let current = state
  let guard = 0
  while (current.phase === 'TRICK_PLAY') {
    if (guard++ > 200) throw new Error('Hand did not terminate')
    const seat = current.trick!.actionSeat
    current = applyCommand(
      current,
      seat,
      command({ type: 'PLAY_CARDS', cards: chooseCards(current, seat) }),
      ctx,
    ).state
  }
  return current
}

/** Dealer picks `size`; the other two take the same number. */
export function runExchange(state: MatchState, size: number, ctx: EngineContext): MatchState {
  let current = applyCommand(
    state,
    state.dealerSeat as Seat,
    command({ type: 'SELECT_EXCHANGE_SIZE', size }),
    ctx,
  ).state
  let guard = 0
  while (current.phase === 'EXCHANGE') {
    if (guard++ > 20) throw new Error('Exchange did not terminate')
    const exchange = current.exchange!
    const seat = exchange.order[exchange.index] as Seat
    if (exchange.step === 'CHOICE') {
      current = applyCommand(current, seat, command({ type: 'SELECT_EXCHANGE', size }), ctx).state
    } else {
      const discards = sortByTrickStrength(current.hands[seat]).slice(0, exchange.drawCount)
      current = applyCommand(current, seat, command({ type: 'SUBMIT_DISCARDS', cards: discards }), ctx)
        .state
    }
  }
  return current
}
