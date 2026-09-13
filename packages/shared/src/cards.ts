/**
 * Physical card identity. Every one of the 54 cards in a deck has a unique id,
 * so the server can track an individual card through deal, exchange and play.
 *
 *   "5S" "10D" "JC" "AH" "JOKER_1"
 */
export type CardId = string

export type Suit = 'S' | 'H' | 'D' | 'C'

export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C']

/** `JOKER` is a rank of its own; it shares a trick rank with `7` but not an identity. */
export type Rank =
  | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10'
  | 'J' | 'Q' | 'K' | 'A'
  | 'JOKER'

export const RANKS: readonly Rank[] = [
  '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A',
]

export interface Card {
  readonly id: CardId
  readonly rank: Rank
  /** Jokers have no suit. */
  readonly suit: Suit | null
}
