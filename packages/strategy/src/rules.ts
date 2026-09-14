import {
  CLASS_COUNT,
  cloneCounts,
  emptyCounts,
  spread,
  totalOf,
  type CardClass,
  type Counts,
} from './classes.ts'

/**
 * Spec §17 in class terms: sort both sides ascending and compare position by
 * position. Because the class index is the trick strength, that is an integer
 * comparison and nothing is ever summed.
 */
export function beats(play: Counts, target: readonly CardClass[]): boolean {
  const mine = spread(play)
  if (mine.length !== target.length) return false
  for (let i = 0; i < mine.length; i++) {
    if (mine[i]! < target[i]!) return false
  }
  return true
}

/** The n strongest cards in the hand, as a class list ascending. */
export function strongest(hand: Counts, n: number): CardClass[] {
  const out: CardClass[] = []
  for (let i = CLASS_COUNT - 1; i >= 0 && out.length < n; i--) {
    for (let k = hand[i]!; k > 0 && out.length < n; k--) out.push(i)
  }
  return out.reverse()
}

/**
 * Spec §44: a qualifying play exists exactly when the n strongest cards
 * qualify, since taking the largest n maximises every order statistic.
 */
export function canMeet(hand: Counts, target: readonly CardClass[]): boolean {
  const n = target.length
  if (totalOf(hand) < n) return false
  const best = strongest(hand, n)
  for (let i = 0; i < n; i++) {
    if (best[i]! < target[i]!) return false
  }
  return true
}

/**
 * Spec §21/§45. Cards tied at the cutoff are interchangeable in every way
 * that matters, so the forced play is a single determined multiset rather
 * than a choice.
 */
export function forcedLow(hand: Counts, n: number): Counts {
  const out = emptyCounts()
  let left = n
  for (let i = 0; i < CLASS_COUNT && left > 0; i++) {
    const take = Math.min(left, hand[i]!)
    out[i] = take
    left -= take
  }
  return out
}

export interface Lead {
  /** Every card in a lead shares one class (spec §13, with 7/Joker as one). */
  cardClass: CardClass
  count: number
}

/** Spec §13/§14: uniform in rank, and never the whole hand. */
export function legalLeads(hand: Counts): Lead[] {
  const handSize = totalOf(hand)
  const max = handSize - 1
  const leads: Lead[] = []
  for (let i = 0; i < CLASS_COUNT; i++) {
    const available = Math.min(hand[i]!, max)
    for (let count = 1; count <= available; count++) leads.push({ cardClass: i, count })
  }
  return leads
}

export function leadCounts(lead: Lead): Counts {
  const counts = emptyCounts()
  counts[lead.cardClass] = lead.count
  return counts
}

/**
 * Every distinct multiset of `n` cards from the hand that meets the target.
 * Enumerated from the top down so the strongest, least interesting answers
 * appear first and the cap (if hit) trims from the expensive tail.
 */
export function qualifyingPlays(
  hand: Counts,
  target: readonly CardClass[],
  limit = 400,
): Counts[] {
  const n = target.length
  const results: Counts[] = []
  const current = emptyCounts()
  const remaining = cloneCounts(hand)

  // Assign the target's cards from the highest requirement down; for each we
  // may spend any class at least as strong as it still left in hand.
  const walk = (index: number, minClass: CardClass): void => {
    if (results.length >= limit) return
    if (index < 0) {
      results.push(cloneCounts(current))
      return
    }
    const need = Math.max(target[index]!, minClass)
    for (let c = need; c < CLASS_COUNT; c++) {
      if (remaining[c]! === 0) continue
      remaining[c]!--
      current[c]!++
      // Later (lower) target positions may not use a stronger class than this
      // one, which is what keeps each multiset from being produced twice.
      walkDown(index - 1, c)
      current[c]!--
      remaining[c]!++
      if (results.length >= limit) return
    }
  }

  const walkDown = (index: number, maxClass: CardClass): void => {
    if (results.length >= limit) return
    if (index < 0) {
      results.push(cloneCounts(current))
      return
    }
    const need = target[index]!
    for (let c = need; c <= maxClass; c++) {
      if (remaining[c]! === 0) continue
      remaining[c]!--
      current[c]!++
      walkDown(index - 1, c)
      current[c]!--
      remaining[c]!++
      if (results.length >= limit) return
    }
  }

  if (n === 0) return results
  walk(n - 1, 0)
  return results
}

export interface Response {
  counts: Counts
  successful: boolean
}

/** Everything a follower is allowed to do, given the target. */
export function legalResponses(hand: Counts, target: readonly CardClass[]): Response[] {
  if (canMeet(hand, target)) {
    return qualifyingPlays(hand, target).map((counts) => ({ counts, successful: true }))
  }
  return [{ counts: forcedLow(hand, target.length), successful: false }]
}
