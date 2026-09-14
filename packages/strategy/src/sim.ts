import {
  CLASS_COUNT,
  cloneCounts,
  emptyCounts,
  spread,
  totalOf,
  type CardClass,
  type Counts,
} from './classes.ts'
import { forcedLow, canMeet, legalLeads, leadCounts, qualifyingPlays } from './rules.ts'

/** Seats are 0, 1, 2 here — one subtraction from the engine's 1, 2, 3. */
export type SeatIndex = 0 | 1 | 2

export const leftOfIndex = (seat: SeatIndex): SeatIndex => ((seat + 1) % 3) as SeatIndex

export interface Sim {
  hands: [Counts, Counts, Counts]
  scores: [number, number, number]
  /** Public: everything played out to a trick this hand. */
  played: Counts
  leaderSeat: SeatIndex
  actionSeat: SeatIndex
  /** Ascending class list of the most recent successful play; empty before a lead. */
  target: CardClass[]
  successfulSeat: SeatIndex
  playsMade: number
  /** Per seat, the cards that seat discarded face down and therefore saw. */
  seen: [Counts, Counts, Counts]
}

/**
 * Everything a policy is handed. Deliberately not the Sim: a policy is given
 * its own hand, the cards everyone has watched being played, and the public
 * counts and scores — and has no way to reach another seat's cards, because
 * they are not in this object.
 */
export interface PolicyView {
  seat: SeatIndex
  hand: Counts
  /** Played out to tricks in front of everyone. */
  played: Counts
  /** Cards this seat personally saw and discarded. */
  mine: Counts
  target: CardClass[]
  playsMade: number
  leaderSeat: SeatIndex
  /** Who made the most recent successful play — public, everyone watched it. */
  successfulSeat: SeatIndex
  handSizes: [number, number, number]
  scores: [number, number, number]
}

export interface Candidate {
  counts: Counts
  /** False only for a forced low play, which never becomes the target. */
  successful: boolean
  isLead: boolean
}

export type Policy = (view: PolicyView, candidates: Candidate[]) => number

export function policyView(sim: Sim, seat: SeatIndex): PolicyView {
  return {
    seat,
    hand: sim.hands[seat],
    played: sim.played,
    mine: sim.seen[seat],
    target: sim.target,
    playsMade: sim.playsMade,
    leaderSeat: sim.leaderSeat,
    successfulSeat: sim.successfulSeat,
    handSizes: [totalOf(sim.hands[0]), totalOf(sim.hands[1]), totalOf(sim.hands[2])],
    scores: sim.scores,
  }
}

export function candidatesFor(sim: Sim, seat: SeatIndex): Candidate[] {
  const hand = sim.hands[seat]
  if (sim.playsMade === 0) {
    return legalLeads(hand).map((lead) => ({
      counts: leadCounts(lead),
      successful: true,
      isLead: true,
    }))
  }
  if (canMeet(hand, sim.target)) {
    return qualifyingPlays(hand, sim.target).map((counts) => ({
      counts,
      successful: true,
      isLead: false,
    }))
  }
  return [{ counts: forcedLow(hand, sim.target.length), successful: false, isLead: false }]
}

export function applyPlay(sim: Sim, seat: SeatIndex, candidate: Candidate): void {
  const hand = sim.hands[seat]
  for (let i = 0; i < CLASS_COUNT; i++) {
    const n = candidate.counts[i]!
    if (n === 0) continue
    hand[i]! -= n
    sim.played[i]! += n
  }
  if (candidate.isLead) {
    sim.target = spread(candidate.counts)
    sim.successfulSeat = seat
  } else if (candidate.successful) {
    // Spec §23: only a successful play replaces the target.
    sim.target = spread(candidate.counts)
    sim.successfulSeat = seat
  }
  sim.playsMade += 1
  sim.actionSeat = leftOfIndex(seat)
}

function finishTrick(sim: Sim): void {
  sim.leaderSeat = sim.successfulSeat
  sim.actionSeat = sim.successfulSeat
  sim.playsMade = 0
  sim.target = []
}

export function handOver(sim: Sim): boolean {
  return totalOf(sim.hands[0]) === 1 && totalOf(sim.hands[1]) === 1 && totalOf(sim.hands[2]) === 1
}

/** Force a specific choice, then close the trick if that was the third play. */
export function commit(sim: Sim, seat: SeatIndex, candidate: Candidate): void {
  applyPlay(sim, seat, candidate)
  if (sim.playsMade === 3) finishTrick(sim)
}

/** One player's move. Returns the candidate that was taken. */
export function step(sim: Sim, policies: [Policy, Policy, Policy]): Candidate {
  const seat = sim.actionSeat
  const candidates = candidatesFor(sim, seat)
  const choice = candidates[policies[seat](policyView(sim, seat), candidates)] ?? candidates[0]!
  applyPlay(sim, seat, choice)
  if (sim.playsMade === 3) finishTrick(sim)
  return choice
}

/** Play the hand out. The caller reads the final cards off `sim.hands`. */
export function playOut(sim: Sim, policies: [Policy, Policy, Policy], guard = 400): Sim {
  let steps = 0
  while (!handOver(sim)) {
    if (steps++ > guard) throw new Error('Hand did not terminate')
    step(sim, policies)
  }
  return sim
}

export function finalClasses(sim: Sim): [CardClass, CardClass, CardClass] {
  const last = (counts: Counts): CardClass => {
    for (let i = 0; i < CLASS_COUNT; i++) if (counts[i]! > 0) return i
    throw new Error('Empty hand at the reveal')
  }
  return [last(sim.hands[0]), last(sim.hands[1]), last(sim.hands[2])]
}

export function cloneSim(sim: Sim): Sim {
  return {
    hands: [cloneCounts(sim.hands[0]), cloneCounts(sim.hands[1]), cloneCounts(sim.hands[2])],
    scores: [...sim.scores] as [number, number, number],
    played: cloneCounts(sim.played),
    leaderSeat: sim.leaderSeat,
    actionSeat: sim.actionSeat,
    target: [...sim.target],
    successfulSeat: sim.successfulSeat,
    playsMade: sim.playsMade,
    seen: [cloneCounts(sim.seen[0]), cloneCounts(sim.seen[1]), cloneCounts(sim.seen[2])],
  }
}

export function newSim(
  hands: [Counts, Counts, Counts],
  scores: [number, number, number],
  leaderSeat: SeatIndex,
): Sim {
  return {
    hands,
    scores,
    played: emptyCounts(),
    leaderSeat,
    actionSeat: leaderSeat,
    target: [],
    successfulSeat: leaderSeat,
    playsMade: 0,
    seen: [emptyCounts(), emptyCounts(), emptyCounts()],
  }
}
