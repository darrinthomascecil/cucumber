import type { CardId } from './cards.ts'
import type { PlayerView, Seat } from './state.ts'

/** A seat in the private room, before the table is full. */
export interface RoomSeat {
  seat: Seat
  displayName: string | null
  userId: string | null
  connected: boolean
}

export interface Room {
  matchId: string
  /** SEATING until three players have sat down; the match state only exists
   *  once the table is full. */
  stage: 'SEATING' | 'MATCH'
  seats: RoomSeat[]
}

/** Every state-changing command carries a version and an id (spec §46). */
export interface CommandEnvelope {
  matchId: string
  expectedVersion: number
  actionId: string
}

export type ClientCommand =
  | ({ type: 'READY'; ready: boolean } & CommandEnvelope)
  | ({ type: 'SELECT_EXCHANGE_SIZE'; size: number } & CommandEnvelope)
  | ({ type: 'SELECT_EXCHANGE'; size: number } & CommandEnvelope)
  | ({ type: 'SUBMIT_DISCARDS'; cards: CardId[] } & CommandEnvelope)
  | ({ type: 'PLAY_CARDS'; cards: CardId[] } & CommandEnvelope)
  | ({ type: 'START_NEXT_MATCH' } & CommandEnvelope)

export type ClientMessage = ClientCommand | { type: 'RESYNC' }

export type ServerMessage =
  | { type: 'STATE_UPDATED'; view: PlayerView }
  | { type: 'ROOM_WAITING'; room: Room }
  | { type: 'PLAY_REJECTED'; actionId: string; reason: string; code: string }
  | { type: 'ERROR'; reason: string; code: string }

export type GameEventType =
  | 'MATCH_CREATED'
  | 'PLAYER_JOINED'
  | 'PLAYER_READY'
  | 'MATCH_STARTED'
  | 'HAND_DEALT'
  | 'EXCHANGE_SIZE_SELECTED'
  | 'CARDS_DRAWN'
  | 'CARDS_EXCHANGED'
  | 'CARDS_PLAYED'
  | 'FORCED_LOW_PLAY'
  | 'TRICK_COMPLETED'
  | 'FINAL_REVEAL'
  | 'HAND_COMPLETED'
  | 'MATCH_COMPLETED'
  | 'PLAYER_CONNECTED'
  | 'PLAYER_DISCONNECTED'
