import { scoreValue, trickStrength } from '@cucumber/game-engine'
import type { CardId } from '@cucumber/shared'

/**
 * Suits never affect anything in Cucumber — not trick strength, not score —
 * and a 7 and a Joker are identical in both. So for every decision the game
 * makes, the 54 cards collapse to 13 equivalence classes, ordered so that the
 * class index *is* the trick strength. Comparing two cards is comparing two
 * small integers, and "choose between the tied low cards" stops being a
 * decision at all.
 */
export const CLASS_COUNT = 13

/** Class index 0..12, ascending by trick strength. HIGH (index 12) is 7/Joker. */
export type CardClass = number

export const HIGH_CLASS: CardClass = 12

export const CLASS_LABELS = [
  '2', '3', '4', '5', '6', '8', '9', '10', 'J', 'Q', 'K', 'A', '7/Joker',
] as const

/** Score added when a card of this class is the final card held. */
export const CLASS_VALUE = [2, 3, 4, 5, 6, 8, 9, 10, 10, 10, 10, 15, 21] as const

/** How many of each class exist in a 54-card deck. */
export const CLASS_SUPPLY = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 6] as const

export function classOf(card: CardId): CardClass {
  // trickStrength runs 2..14; shift it to a 0-based index.
  return trickStrength(card) - 2
}

export function classValue(card: CardId): number {
  return scoreValue(card)
}

/** Counts per class. Length is always CLASS_COUNT. */
export type Counts = Int8Array

export function emptyCounts(): Counts {
  return new Int8Array(CLASS_COUNT)
}

export function countsOf(cards: readonly CardId[]): Counts {
  const counts = emptyCounts()
  for (const card of cards) counts[classOf(card)]!++
  return counts
}

export function fullDeckCounts(): Counts {
  return Int8Array.from(CLASS_SUPPLY)
}

export function totalOf(counts: Counts): number {
  let total = 0
  for (let i = 0; i < CLASS_COUNT; i++) total += counts[i]!
  return total
}

export function cloneCounts(counts: Counts): Counts {
  return counts.slice()
}

/** Expand to an ascending list of class indices — one entry per card. */
export function spread(counts: Counts): CardClass[] {
  const out: CardClass[] = []
  for (let i = 0; i < CLASS_COUNT; i++) {
    for (let n = counts[i]!; n > 0; n--) out.push(i)
  }
  return out
}

/** Turn a chosen multiset of classes back into concrete cards from a hand. */
export function pickCards(hand: readonly CardId[], counts: Counts): CardId[] {
  const remaining = cloneCounts(counts)
  const chosen: CardId[] = []
  for (const card of hand) {
    const index = classOf(card)
    if (remaining[index]! > 0) {
      remaining[index]!--
      chosen.push(card)
    }
  }
  return chosen
}

export function describeCounts(counts: Counts): string {
  const parts: string[] = []
  for (let i = CLASS_COUNT - 1; i >= 0; i--) {
    const n = counts[i]!
    if (n > 0) parts.push(n > 1 ? `${n}×${CLASS_LABELS[i]}` : `${CLASS_LABELS[i]}`)
  }
  return parts.join(' + ')
}
