import { RANKS, SUITS, type Card, type CardId, type Rank, type Suit } from '@cucumber/shared'

export const JOKER_IDS: readonly CardId[] = ['JOKER_1', 'JOKER_2']

/**
 * Parse a physical card id. Ids are `<rank><suit>` — note that `10` is two
 * characters, so the suit is taken from the end rather than a fixed offset.
 */
export function parseCard(id: CardId): Card {
  if (id === 'JOKER_1' || id === 'JOKER_2') {
    return { id, rank: 'JOKER', suit: null }
  }
  const suit = id.slice(-1) as Suit
  const rank = id.slice(0, -1) as Rank
  if (!SUITS.includes(suit) || !RANKS.includes(rank)) {
    throw new Error(`Not a card id: ${id}`)
  }
  return { id, rank, suit }
}

export function cardRank(id: CardId): Rank {
  return parseCard(id).rank
}

export function makeCardId(rank: Rank, suit: Suit): CardId {
  return `${rank}${suit}`
}

/** Human-facing label, e.g. `10♦`, `A♠`, `Joker`. */
export function cardLabel(id: CardId): string {
  const card = parseCard(id)
  if (card.rank === 'JOKER') return 'Joker'
  const pip = { S: '♠', H: '♥', D: '♦', C: '♣' }[card.suit as Suit]
  return `${card.rank}${pip}`
}
