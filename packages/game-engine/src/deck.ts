import { RANKS, SUITS, type CardId } from '@cucumber/shared'
import { JOKER_IDS, makeCardId } from './cards.ts'

export const DECK_SIZE = 54
export const HAND_SIZE = 13
export const PLAYER_COUNT = 3
export const STOCK_SIZE = DECK_SIZE - HAND_SIZE * PLAYER_COUNT

/** Returns a number in [0, maxExclusive). Injected so the engine stays free of
 *  Node built-ins; the server supplies a `crypto.randomInt` implementation. */
export type Rng = (maxExclusive: number) => number

/** 52 standard cards plus two jokers, in a fixed order. */
export function buildDeck(): CardId[] {
  const deck: CardId[] = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(makeCardId(rank, suit))
    }
  }
  deck.push(...JOKER_IDS)
  return deck
}

/** Fisher-Yates, unbiased given an unbiased `rng` (spec §48). */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng(i + 1)
    const a = out[i] as T
    const b = out[j] as T
    out[i] = b
    out[j] = a
  }
  return out
}

export interface Deal {
  hands: [CardId[], CardId[], CardId[]]
  stock: CardId[]
}

/** 13 each, 15 to stock. Dealt one card at a time round the table. */
export function deal(deck: readonly CardId[]): Deal {
  if (deck.length !== DECK_SIZE) {
    throw new Error(`Expected a ${DECK_SIZE}-card deck, got ${deck.length}`)
  }
  const hands: [CardId[], CardId[], CardId[]] = [[], [], []]
  let index = 0
  for (let round = 0; round < HAND_SIZE; round++) {
    for (let player = 0; player < PLAYER_COUNT; player++) {
      hands[player]!.push(deck[index++] as CardId)
    }
  }
  return { hands, stock: deck.slice(index) }
}
