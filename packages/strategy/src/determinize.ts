import {
  CLASS_COUNT,
  cloneCounts,
  emptyCounts,
  fullDeckCounts,
  totalOf,
  type CardClass,
  type Counts,
} from './classes.ts'
import type { Random } from './random.ts'
import { canMeet } from './rules.ts'
import type { SeatIndex } from './sim.ts'

/**
 * Everything one player is allowed to know. Built only from their own cards
 * and what happened in front of everyone — never from the true deal.
 */
export interface InfoSet {
  seat: SeatIndex
  /** My hand, which I can obviously see. */
  hand: Counts
  /** Cards played out to tricks this hand, including the current one. */
  played: Counts
  /** Cards I personally saw and parted with — my own exchange discards. */
  mine: Counts
  /** How many cards each seat holds, including me. */
  handSizes: [number, number, number]
  scores: [number, number, number]
  /**
   * Per seat, every target that seat was publicly seen to fail against this
   * hand.
   *
   * This is the richest thing the game gives away for free. A player only
   * fails when their *whole hand* could not answer — and hands only ever
   * shrink, never grow, during trick play. So a failure witnessed at any point
   * is still true of the cards they are holding now, and it rules out worlds
   * that a naive deal would happily invent.
   */
  failures?: CardClass[][][]
}

/**
 * Cards that could be anywhere the player cannot see.
 *
 * The counts are supplied by the caller and can disagree with the deck if
 * their memory of their own discards has drifted — a submission that was
 * refused and re-sent used to be remembered twice. This clamps rather than
 * throws, because the caller is usually an advisor inside somebody's game,
 * and the right answer to a slightly stale belief is worse advice, not a dead
 * player. `unseenPoolExact` is available where the disagreement matters.
 */
export function unseenPool(info: InfoSet): Counts {
  const pool = fullDeckCounts()
  for (let c = 0; c < CLASS_COUNT; c++) {
    pool[c] = Math.max(0, pool[c]! - (info.hand[c]! + info.played[c]! + info.mine[c]!))
  }
  return pool
}

/** How far the information set disagrees with a 54-card deck, if at all. */
export function poolOvercount(info: InfoSet): number {
  const deck = fullDeckCounts()
  let over = 0
  for (let c = 0; c < CLASS_COUNT; c++) {
    const claimed = info.hand[c]! + info.played[c]! + info.mine[c]!
    if (claimed > deck[c]!) over += claimed - deck[c]!
  }
  return over
}

export interface World {
  hands: [Counts, Counts, Counts]
  /** The stock and the face-down discards — dead for this hand, but a source
   *  of draws while the exchange is still running. */
  rest: number[]
}

/**
 * A failure, expressed as something a hand cannot contain.
 *
 * `!canMeet(hand, target)` holds exactly when, for some position i in the
 * sorted target, the hand has fewer than (n - i) cards of class at least
 * target[i]. So every failure is a disjunction of simple counting statements:
 * "at most k cards at or above class c". A single-card failure collapses to
 * the strongest of them — at most zero cards at or above the target.
 */
interface CountLimit {
  atOrAbove: CardClass
  atMost: number
}

function limitsFor(target: readonly CardClass[]): CountLimit[] {
  const n = target.length
  const limits: CountLimit[] = []
  for (let i = 0; i < n; i++) {
    limits.push({ atOrAbove: target[i]!, atMost: n - i - 1 })
  }
  return limits
}

/**
 * Draw `count` cards from `pool` without breaking any limit. Cards are taken
 * one at a time from whatever is still allowed, so a constraint is satisfied
 * by construction rather than by throwing away deals that violate it.
 */
function drawWithin(
  pool: Counts,
  count: number,
  limits: readonly CountLimit[],
  random: Random,
): Counts | null {
  const taken = emptyCounts()
  const above = limits.map(() => 0)
  for (let n = 0; n < count; n++) {
    // A class is allowed if taking one more would not break any limit.
    let eligible = 0
    const allowed: boolean[] = new Array(CLASS_COUNT).fill(false)
    for (let c = 0; c < CLASS_COUNT; c++) {
      if (pool[c]! === 0) continue
      let ok = true
      for (let l = 0; l < limits.length; l++) {
        if (c >= limits[l]!.atOrAbove && above[l]! + 1 > limits[l]!.atMost) {
          ok = false
          break
        }
      }
      if (!ok) continue
      allowed[c] = true
      eligible += pool[c]!
    }
    if (eligible === 0) return null

    let index = random.int(eligible)
    let chosen = -1
    for (let c = 0; c < CLASS_COUNT; c++) {
      if (!allowed[c]) continue
      index -= pool[c]!
      if (index < 0) {
        chosen = c
        break
      }
    }
    if (chosen < 0) return null

    pool[chosen]!--
    taken[chosen]!++
    for (let l = 0; l < limits.length; l++) {
      if (chosen >= limits[l]!.atOrAbove) above[l]!++
    }
  }
  return taken
}

/** How tightly each seat is pinned down, for ordering the deal. */
function tightness(info: InfoSet, seat: SeatIndex): number {
  let tightest = CLASS_COUNT
  for (const target of info.failures?.[seat] ?? []) {
    for (const limit of limitsFor(target)) {
      if (limit.atMost === 0) tightest = Math.min(tightest, limit.atOrAbove)
    }
  }
  return tightest
}

/**
 * Deal the unseen cards into one concrete possibility consistent with
 * everything the player knows — including what the others have shown they
 * cannot hold. Whatever is left over is the stock and the face-down discards.
 */
export function sampleFullWorld(info: InfoSet, random: Random, attempts = 8): World {
  const basePool = unseenPool(info)
  const others = ([0, 1, 2] as SeatIndex[]).filter((seat) => seat !== info.seat)
  // The most pinned-down seat picks first, while cards that can satisfy it
  // still remain in the pool.
  const order = [...others].sort((a, b) => tightness(info, a) - tightness(info, b))

  for (let attempt = 0; attempt < attempts; attempt++) {
    const pool = cloneCounts(basePool)
    const dealt: [Counts, Counts, Counts] = [emptyCounts(), emptyCounts(), emptyCounts()]
    dealt[info.seat] = cloneCounts(info.hand)
    let ok = true

    for (const seat of order) {
      // Each failure is a disjunction; pick one way of failing per attempt, so
      // repeated sampling explores all of them rather than always the same one.
      const limits: CountLimit[] = []
      for (const target of info.failures?.[seat] ?? []) {
        const choices = limitsFor(target)
        limits.push(choices[random.int(choices.length)]!)
      }
      const drawn = drawWithin(pool, info.handSizes[seat]!, limits, random)
      if (!drawn) {
        ok = false
        break
      }
      dealt[seat] = drawn
    }
    if (!ok) continue

    if (totalOf(dealt[info.seat]) !== info.handSizes[info.seat]) {
      throw new Error('Hand size disagrees with the information set')
    }
    const rest: number[] = []
    for (let c = 0; c < CLASS_COUNT; c++) for (let n = pool[c]!; n > 0; n--) rest.push(c)
    return { hands: dealt, rest }
  }

  // Nothing consistent could be built — which should not happen, since the
  // real deal is always consistent. Fall back to an unconstrained one rather
  // than leaving the search with no world at all.
  const pool = cloneCounts(basePool)
  const dealt: [Counts, Counts, Counts] = [emptyCounts(), emptyCounts(), emptyCounts()]
  dealt[info.seat] = cloneCounts(info.hand)
  for (const seat of order) {
    dealt[seat] = drawWithin(pool, info.handSizes[seat]!, [], random) ?? emptyCounts()
  }
  const rest: number[] = []
  for (let c = 0; c < CLASS_COUNT; c++) for (let n = pool[c]!; n > 0; n--) rest.push(c)
  return { hands: dealt, rest }
}

export function sampleWorld(info: InfoSet, random: Random): [Counts, Counts, Counts] {
  return sampleFullWorld(info, random).hands
}
