import {
  SEATS,
  type MatchState,
  type PlayerView,
  type PublicPlayer,
  type Seat,
  type TurnPrompt,
} from '@cucumber/shared'
import { canMeetTarget, forcedLowRequirement, maxLeadCount } from './legalMove.ts'
import { actionSeat, playerAt } from './stateMachine.ts'

function promptFor(state: MatchState, seat: Seat): TurnPrompt {
  const acting = actionSeat(state)
  const me = playerAt(state, seat)

  switch (state.phase) {
    case 'LOBBY': {
      const waiting = state.players.filter((p) => !p.ready || p.connected !== 'ONLINE').length
      return {
        kind: 'READY',
        message: me.ready
          ? `Ready. Waiting for ${waiting} more player${waiting === 1 ? '' : 's'}.`
          : 'Press Ready when you want to start.',
      }
    }
    case 'EXCHANGE_SIZE_SELECTION':
      return acting === seat
        ? {
            kind: 'SELECT_EXCHANGE_SIZE',
            message: 'You are dealing. Choose how many cards may be exchanged (0–5).',
            options: [0, 1, 2, 3, 4, 5],
          }
        : { kind: 'WAIT', message: 'The dealer is choosing the exchange size.' }
    case 'EXCHANGE': {
      const exchange = state.exchange!
      if (acting !== seat) {
        return { kind: 'WAIT', message: `Waiting for ${playerAt(state, acting as Seat).displayName} to exchange.` }
      }
      if (exchange.step === 'CHOICE') {
        return {
          kind: 'SELECT_EXCHANGE',
          message: `Exchange ${exchange.size} cards, or stand pat with 0.`,
          options: [0, exchange.size],
        }
      }
      return {
        kind: 'SUBMIT_DISCARDS',
        message: `You drew ${exchange.drawCount}. Choose ${exchange.drawCount} to discard face down.`,
        requiredCards: exchange.drawCount,
        selectableCards: [...state.hands[seat]],
      }
    }
    case 'TRICK_PLAY': {
      const trick = state.trick!
      if (acting !== seat) {
        return { kind: 'WAIT', message: `Waiting for ${playerAt(state, acting as Seat).displayName}.` }
      }
      const hand = state.hands[seat]
      if (trick.plays.length === 0) {
        const max = maxLeadCount(hand.length)
        return {
          kind: 'LEAD',
          message:
            max === 1
              ? 'You lead. Play one card — the last card is never played.'
              : `You lead. Play up to ${max} cards of the same rank.`,
          maxCards: max,
          selectableCards: [...hand],
        }
      }
      const n = trick.targetCards.length
      if (canMeetTarget(hand, trick.targetCards)) {
        return {
          kind: 'FOLLOW',
          message:
            n === 1
              ? 'Play a card that meets or beats the current play.'
              : `Play ${n} cards that meet or beat the current play.`,
          requiredCards: n,
          selectableCards: [...hand],
        }
      }
      const forced = forcedLowRequirement(hand, n)
      const lowest = n === 1 ? 'your lowest card' : `your ${n} lowest cards`
      return {
        kind: 'FORCED_LOW',
        message:
          forced.choices.length > forced.chooseCount
            ? `You cannot meet the current play. Surrender ${lowest} — you may choose between the tied ones.`
            : `You cannot meet the current play. Surrender ${lowest}.`,
        requiredCards: n,
        selectableCards: [...forced.mandatory, ...forced.choices],
      }
    }
    case 'FINAL_REVEAL':
      return {
        kind: 'READY',
        message: me.ready ? 'Waiting for the others to continue.' : 'Ready for the next hand?',
      }
    case 'MATCH_OVER':
      return { kind: 'NEXT_MATCH', message: 'The match is over. Start another?' }
    default:
      return { kind: 'WAIT', message: '' }
  }
}

/**
 * Spec §34. Build the only shape a client is ever allowed to see: their own
 * hand, public counts, and nothing about the stock, the discards, or anyone
 * else's cards.
 */
export function viewFor(state: MatchState, seat: Seat): PlayerView {
  const me = playerAt(state, seat)
  const revealing = state.phase === 'FINAL_REVEAL' || state.phase === 'MATCH_OVER'

  const players: PublicPlayer[] = SEATS.map((other) => {
    const player = playerAt(state, other)
    return {
      seat: other,
      displayName: player.displayName,
      score: player.score,
      ready: player.ready,
      connected: player.connected,
      cardCount: state.hands[other].length,
      finalCard: revealing ? (state.handResult?.finalCards[other] ?? null) : null,
    }
  })

  return {
    matchId: state.matchId,
    version: state.version,
    phase: state.phase,
    you: {
      seat,
      displayName: me.displayName,
      score: me.score,
      ready: me.ready,
      hand: [...state.hands[seat]],
    },
    players,
    handNumber: state.handNumber,
    dealerSeat: state.dealerSeat,
    stockCount: state.stock.length,
    played: [...state.played],
    completedTricks: structuredClone(state.completedTricks ?? (state.lastTrick ? [state.lastTrick] : [])),
    historyComplete: state.completedTricks !== undefined,
    exchange: state.exchange
      ? {
          size: state.exchange.size,
          actingSeat: (state.exchange.order[state.exchange.index] as Seat) ?? null,
          step: state.exchange.step,
        }
      : null,
    trick: state.trick ? structuredClone(state.trick) : null,
    lastTrick: state.lastTrick ? structuredClone(state.lastTrick) : null,
    handResult: state.handResult ? structuredClone(state.handResult) : null,
    losers: [...state.losers],
    actionSeat: actionSeat(state),
    prompt: promptFor(state, seat),
  }
}
