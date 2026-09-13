import type { CardId } from './cards.ts'

/** Seats are fixed and clockwise: 1 -> 2 -> 3 -> 1. */
export type Seat = 1 | 2 | 3

export const SEATS: readonly Seat[] = [1, 2, 3]

/** The player to a seat's left, i.e. the next to act clockwise. */
export function leftOf(seat: Seat): Seat {
  return ((seat % 3) + 1) as Seat
}

export type MatchPhase =
  | 'LOBBY'
  | 'EXCHANGE_SIZE_SELECTION'
  | 'EXCHANGE'
  | 'TRICK_PLAY'
  | 'FINAL_REVEAL'
  | 'MATCH_OVER'

export type ConnectionStatus = 'ONLINE' | 'OFFLINE'

export interface PlayerState {
  seat: Seat
  userId: string
  displayName: string
  /** Cumulative score across the hands of this match. */
  score: number
  ready: boolean
  connected: ConnectionStatus
}

/** What a player is being asked for during the exchange phase. */
export type ExchangeStep = 'CHOICE' | 'DISCARD'

export interface ExchangeState {
  /** The quantity the dealer fixed for the whole table, 0-5. */
  size: number
  /** Dealer first, then clockwise. */
  order: Seat[]
  /** Index into `order` of the player currently acting. */
  index: number
  step: ExchangeStep
  /** How many cards the acting player drew and must now discard. */
  drawCount: number
}

export interface TrickPlay {
  seat: Seat
  cards: CardId[]
  /** False when the player could not meet the target and was forced low. */
  successful: boolean
}

export interface TrickState {
  leaderSeat: Seat
  /** Cards per play for this trick; 0 until the leader has led. */
  playCount: number
  actionSeat: Seat
  /** The most recent *successful* play. Empty before the lead. */
  targetCards: CardId[]
  targetSeat: Seat | null
  successfulSeat: Seat | null
  plays: TrickPlay[]
}

export interface HandResult {
  handNumber: number
  finalCards: Record<Seat, CardId>
  scoresBefore: Record<Seat, number>
  scoresAfter: Record<Seat, number>
  /** Seats that ended the hand holding a 7 or a Joker. */
  instantLossSeats: Seat[]
  /** Seats that lose the match, if the match ended. */
  losers: Seat[]
  matchOver: boolean
  reason: 'SEVEN_OR_JOKER' | 'SCORE_LIMIT' | 'CONTINUE'
}

/**
 * The full authoritative state. This is what lives in `game_state.state_json`
 * and it contains secrets — never send it to a client unsanitised.
 */
export interface MatchState {
  matchId: string
  version: number
  phase: MatchPhase
  players: PlayerState[]
  handNumber: number
  dealerSeat: Seat | null
  hands: Record<Seat, CardId[]>
  stock: CardId[]
  /** Face-down and dead for the remainder of the hand. */
  discards: CardId[]
  /** Cards played out in completed tricks this hand. */
  played: CardId[]
  exchange: ExchangeState | null
  trick: TrickState | null
  lastTrick: TrickState | null
  handResult: HandResult | null
  losers: Seat[]
}

/** A seat's public view of another player. */
export interface PublicPlayer {
  seat: Seat
  displayName: string
  score: number
  ready: boolean
  connected: ConnectionStatus
  cardCount: number
  /** Only populated at the final reveal. */
  finalCard: CardId | null
}

/** What the acting player is allowed to do right now. */
export interface TurnPrompt {
  kind:
    | 'WAIT'
    | 'READY'
    | 'SELECT_EXCHANGE_SIZE'
    | 'SELECT_EXCHANGE'
    | 'SUBMIT_DISCARDS'
    | 'LEAD'
    | 'FOLLOW'
    | 'FORCED_LOW'
    | 'NEXT_MATCH'
  message: string
  /** For LEAD: the largest number of cards that may be led. */
  maxCards?: number
  /** For FOLLOW/FORCED_LOW: exactly how many cards must be played. */
  requiredCards?: number
  /** For SELECT_EXCHANGE: the two quantities that may be chosen. */
  options?: number[]
  /** Cards the player is permitted to include in the current action. */
  selectableCards?: CardId[]
}

/** The sanitised per-seat projection sent over the wire. */
export interface PlayerView {
  matchId: string
  version: number
  phase: MatchPhase
  you: {
    seat: Seat
    displayName: string
    score: number
    ready: boolean
    hand: CardId[]
  }
  players: PublicPlayer[]
  handNumber: number
  dealerSeat: Seat | null
  stockCount: number
  exchange: { size: number; actingSeat: Seat | null; step: ExchangeStep } | null
  trick: TrickState | null
  lastTrick: TrickState | null
  handResult: HandResult | null
  losers: Seat[]
  /** Whose action the match is waiting on, if anyone's. */
  actionSeat: Seat | null
  prompt: TurnPrompt
}
