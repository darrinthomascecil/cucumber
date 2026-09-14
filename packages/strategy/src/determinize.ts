import {
  CLASS_COUNT,
  cloneCounts,
  emptyCounts,
  fullDeckCounts,
  totalOf,
  type Counts,
} from './classes.ts'
import type { Random } from './random.ts'
import type { SeatIndex } from './sim.ts'

/**
 * Everything one player is allowed to know. Built only from their own cards
 * and cards that have been played to a trick in front of everyone — never
 * from the true deal.
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
}

/** Cards that could be anywhere the player cannot see. */
export function unseenPool(info: InfoSet): Counts {
  const pool = fullDeckCounts()
  for (let c = 0; c < CLASS_COUNT; c++) {
    pool[c]! -= info.hand[c]! + info.played[c]! + info.mine[c]!
  }
  for (let c = 0; c < CLASS_COUNT; c++) {
    if (pool[c]! < 0) throw new Error('Information set counts more cards than the deck holds')
  }
  return pool
}

/**
 * Deal the unseen cards into one concrete possibility consistent with
 * everything the player knows. Whatever is left over is the stock and the
 * face-down discards, which are dead for this hand.
 */
export interface World {
  hands: [Counts, Counts, Counts]
  /** The stock and the face-down discards — dead for this hand, but a source
   *  of draws while the exchange is still running. */
  rest: number[]
}

export function sampleWorld(info: InfoSet, random: Random): [Counts, Counts, Counts] {
  return sampleFullWorld(info, random).hands
}

export function sampleFullWorld(info: InfoSet, random: Random): World {
  const pool = unseenPool(info)
  const bag: number[] = []
  for (let c = 0; c < CLASS_COUNT; c++) {
    for (let n = pool[c]!; n > 0; n--) bag.push(c)
  }
  // Fisher-Yates over the unseen cards.
  for (let i = bag.length - 1; i > 0; i--) {
    const j = random.int(i + 1)
    const a = bag[i]!
    bag[i] = bag[j]!
    bag[j] = a
  }

  const hands: [Counts, Counts, Counts] = [emptyCounts(), emptyCounts(), emptyCounts()]
  hands[info.seat] = cloneCounts(info.hand)
  let cursor = 0
  for (let seat = 0; seat < 3; seat++) {
    if (seat === info.seat) continue
    const wanted = info.handSizes[seat]!
    const counts = hands[seat as SeatIndex]
    for (let n = 0; n < wanted; n++) {
      const card = bag[cursor++]
      if (card === undefined) throw new Error('Not enough unseen cards to deal a world')
      counts[card]!++
    }
  }
  if (totalOf(hands[info.seat]) !== info.handSizes[info.seat]) {
    throw new Error('Hand size disagrees with the information set')
  }
  return { hands, rest: bag.slice(cursor) }
}
