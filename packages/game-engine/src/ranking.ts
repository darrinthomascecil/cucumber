import type { CardId, Rank } from '@cucumber/shared'
import { cardRank } from './cards.ts'

/**
 * Trick strength (spec §5). Traditional order, except that 7s and Jokers are
 * promoted above the Ace and share a single strength — a 7 and a Joker are
 * interchangeable in play.
 *
 *   2 < 3 < 4 < 5 < 6 < 8 < 9 < 10 < J < Q < K < A < 7/Joker
 */
const TRICK_STRENGTH: Record<Rank, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '8': 7,
  '9': 8,
  '10': 9,
  J: 10,
  Q: 11,
  K: 12,
  A: 13,
  '7': 14,
  JOKER: 14,
}

/** Score value (spec §6). Deliberately unrelated to trick strength: 10/J/Q/K
 *  all score 10 while ranking differently. */
const SCORE_VALUE: Record<Rank, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 21,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 10,
  Q: 10,
  K: 10,
  A: 15,
  JOKER: 21,
}

export const HIGH_STRENGTH = TRICK_STRENGTH['7']

export function trickStrength(id: CardId): number {
  return TRICK_STRENGTH[cardRank(id)]
}

export function scoreValue(id: CardId): number {
  return SCORE_VALUE[cardRank(id)]
}

export function isSevenOrJoker(id: CardId): boolean {
  const rank = cardRank(id)
  return rank === '7' || rank === 'JOKER'
}

/**
 * The rank a lead must be uniform in (spec §7). Every rank is its own group
 * except 7 and Joker, which share one — so `7 + Joker` is a legal lead.
 */
export function leadGroup(id: CardId): string {
  return isSevenOrJoker(id) ? 'HIGH' : cardRank(id)
}

export function compareByTrickStrength(a: CardId, b: CardId): number {
  return trickStrength(a) - trickStrength(b)
}

/** Ascending by trick strength. Does not mutate the input. */
export function sortByTrickStrength(cards: readonly CardId[]): CardId[] {
  return [...cards].sort(compareByTrickStrength)
}

export function strengths(cards: readonly CardId[]): number[] {
  return sortByTrickStrength(cards).map(trickStrength)
}
