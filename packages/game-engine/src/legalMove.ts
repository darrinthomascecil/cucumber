import type { CardId } from '@cucumber/shared'
import { cardLabel } from './cards.js'
import { illegal } from './errors.js'
import { leadGroup, sortByTrickStrength, trickStrength } from './ranking.js'

/** Cards must be a distinct subset of the hand. */
export function assertHoldsAll(hand: readonly CardId[], cards: readonly CardId[]): void {
  if (cards.length === 0) illegal('NO_CARDS', 'Select at least one card.')
  const seen = new Set<CardId>()
  for (const card of cards) {
    if (seen.has(card)) illegal('DUPLICATE_CARD', `${cardLabel(card)} was selected twice.`)
    seen.add(card)
    if (!hand.includes(card)) illegal('NOT_IN_HAND', `You do not hold ${cardLabel(card)}.`)
  }
}

/**
 * Spec §13/§14. A lead must be uniform in rank (7s and Jokers counting as one
 * rank) and must leave the leader at least one card for the final reveal.
 */
export function validateLead(hand: readonly CardId[], cards: readonly CardId[]): void {
  assertHoldsAll(hand, cards)
  const max = maxLeadCount(hand.length)
  if (cards.length > max) {
    illegal(
      'MUST_KEEP_FINAL_CARD',
      `You must keep one card for the final reveal, so you may lead at most ${max}.`,
    )
  }
  const group = leadGroup(cards[0] as CardId)
  for (const card of cards) {
    if (leadGroup(card) !== group) {
      illegal('MIXED_LEAD_RANKS', 'A lead must be all of the same rank (7s and Jokers count as one rank).')
    }
  }
}

/** Spec §14: never play your whole hand. */
export function maxLeadCount(handSize: number): number {
  return Math.max(0, handSize - 1)
}

/**
 * Spec §17/§18. Sort both sides ascending and compare position by position;
 * each card need only meet or exceed its counterpart. Values are never summed.
 */
export function beatsTarget(cards: readonly CardId[], target: readonly CardId[]): boolean {
  if (cards.length !== target.length) return false
  const mine = sortByTrickStrength(cards)
  const theirs = sortByTrickStrength(target)
  return mine.every((card, i) => trickStrength(card) >= trickStrength(theirs[i] as CardId))
}

/**
 * Spec §44. A qualifying play exists iff the player's N strongest cards
 * qualify: taking the largest N maximises every order statistic, so if that
 * set fails, no other set of N can succeed.
 */
export function canMeetTarget(hand: readonly CardId[], target: readonly CardId[]): boolean {
  const n = target.length
  if (hand.length < n) return false
  const strongest = sortByTrickStrength(hand).slice(hand.length - n)
  return beatsTarget(strongest, target)
}

/** One qualifying combination, or null. Used for UI hints only — the player
 *  always chooses which combination to actually play (spec §51). */
export function findQualifyingPlay(
  hand: readonly CardId[],
  target: readonly CardId[],
): CardId[] | null {
  const n = target.length
  if (hand.length < n) return null
  const ascending = sortByTrickStrength(hand)
  const wanted = sortByTrickStrength(target)
  const chosen: CardId[] = []
  let cursor = 0
  // Walk the targets low to high, taking the cheapest card that still meets each.
  for (const targetCard of wanted) {
    const need = trickStrength(targetCard)
    while (cursor < ascending.length && trickStrength(ascending[cursor] as CardId) < need) cursor++
    if (cursor >= ascending.length) return null
    chosen.push(ascending[cursor] as CardId)
    cursor++
  }
  return chosen
}

export interface ForcedLowRequirement {
  /** Cards strictly below the cutoff — these must all be played. */
  mandatory: CardId[]
  /** Cards tied at the cutoff rank — the player picks freely among these. */
  choices: CardId[]
  /** How many of `choices` must be added to `mandatory`. */
  chooseCount: number
}

/**
 * Spec §21/§22/§45. When no qualifying play exists the player must surrender
 * their N lowest cards — but keeps a free choice among cards tied at the
 * cutoff rank, so suits are never picked for them.
 */
export function forcedLowRequirement(hand: readonly CardId[], n: number): ForcedLowRequirement {
  if (n > hand.length) {
    throw new Error(`Cannot force ${n} cards from a hand of ${hand.length}`)
  }
  const ascending = sortByTrickStrength(hand)
  const cutoff = trickStrength(ascending[n - 1] as CardId)
  const mandatory = hand.filter((card) => trickStrength(card) < cutoff)
  const choices = hand.filter((card) => trickStrength(card) === cutoff)
  return { mandatory, choices, chooseCount: n - mandatory.length }
}

export function validateForcedLow(
  hand: readonly CardId[],
  cards: readonly CardId[],
  n: number,
): void {
  assertHoldsAll(hand, cards)
  if (cards.length !== n) {
    illegal('WRONG_CARD_COUNT', `You must play exactly ${n} card${n === 1 ? '' : 's'}.`)
  }
  const { mandatory, choices } = forcedLowRequirement(hand, n)
  const selected = new Set(cards)
  for (const card of mandatory) {
    if (!selected.has(card)) {
      illegal(
        'MUST_PLAY_LOWEST',
        `You cannot meet this play, so you must surrender your lowest cards — ${cardLabel(card)} is one of them.`,
      )
    }
  }
  const allowed = new Set([...mandatory, ...choices])
  for (const card of cards) {
    if (!allowed.has(card)) {
      illegal(
        'MUST_PLAY_LOWEST',
        `${cardLabel(card)} is too high — you must surrender your ${n} lowest cards.`,
      )
    }
  }
}

export type FollowOutcome = 'SUCCESS' | 'FORCED_LOW'

/**
 * Spec §19/§20/§21. The single decision point for a follower's play: if any
 * qualifying combination exists the player must make one — a deliberate
 * failure is rejected. Otherwise the forced-low rule applies.
 */
export function validateFollow(
  hand: readonly CardId[],
  target: readonly CardId[],
  cards: readonly CardId[],
): FollowOutcome {
  const n = target.length
  assertHoldsAll(hand, cards)
  if (cards.length !== n) {
    illegal('WRONG_CARD_COUNT', `You must play exactly ${n} card${n === 1 ? '' : 's'}.`)
  }
  if (canMeetTarget(hand, target)) {
    if (!beatsTarget(cards, target)) {
      illegal(
        'MUST_BEAT_TARGET',
        'You hold a combination that meets this play, so you may not play under it.',
      )
    }
    return 'SUCCESS'
  }
  validateForcedLow(hand, cards, n)
  return 'FORCED_LOW'
}
