import { CLASS_COUNT, CLASS_VALUE, HIGH_CLASS, totalOf, type Counts } from './classes.ts'
import { forcedLow } from './rules.ts'
import { weightedDiscards, type Player } from './selfPlay.ts'
import { TUNED } from './heuristic.ts'
import type { Candidate, Policy, PolicyView } from './sim.ts'

/**
 * Opponents built from rules rather than from a weighted sum.
 *
 * The tuned strategy and everything it was measured against share one shape —
 * a linear score over the same handful of features — so a weakness they all
 * share would be invisible to every experiment. These players think in a
 * different idiom on purpose. If the champion still wins comfortably here, its
 * strength is not an artefact of the family it grew up in.
 */

function cards(counts: Counts): number {
  return totalOf(counts)
}

function points(counts: Counts): number {
  let total = 0
  for (let c = 0; c < CLASS_COUNT; c++) total += counts[c]! * CLASS_VALUE[c]!
  return total
}

function topClass(counts: Counts): number {
  for (let c = CLASS_COUNT - 1; c >= 0; c--) if (counts[c]! > 0) return c
  return 0
}

function bottomClass(counts: Counts): number {
  for (let c = 0; c < CLASS_COUNT; c++) if (counts[c]! > 0) return c
  return 0
}

function highCount(counts: Counts): number {
  return counts[HIGH_CLASS]!
}

function pick(candidates: Candidate[], better: (a: Candidate, b: Candidate) => boolean): number {
  let best = 0
  for (let i = 1; i < candidates.length; i++) {
    if (better(candidates[i]!, candidates[best]!)) best = i
  }
  return best
}

/** Spend as little strength as possible, always. The classic miser. */
export const cheapest: Policy = (_view, candidates) =>
  pick(candidates, (a, b) => {
    if (topClass(a.counts) !== topClass(b.counts)) return topClass(a.counts) < topClass(b.counts)
    if (cards(a.counts) !== cards(b.counts)) return cards(a.counts) < cards(b.counts)
    return points(a.counts) < points(b.counts)
  })

/** Get rid of points at every opportunity. */
export const dumper: Policy = (_view, candidates) =>
  pick(candidates, (a, b) => points(a.counts) > points(b.counts))

/** Treat 7s and Jokers as radioactive: shed them the moment it is legal. */
export const panic: Policy = (view, candidates) => {
  const withHigh = candidates.filter((candidate) => highCount(candidate.counts) > 0)
  if (withHigh.length > 0) {
    const index = pick(withHigh, (a, b) => highCount(a.counts) > highCount(b.counts))
    return candidates.indexOf(withHigh[index]!)
  }
  return cheapest(view, candidates)
}

/** Never voluntarily part with an Ace or better; otherwise play cheap. */
export const hoarder: Policy = (view, candidates) => {
  const safe = candidates.filter((candidate) => topClass(candidate.counts) < 11)
  return safe.length > 0
    ? candidates.indexOf(safe[cheapest(view, safe)]!)
    : cheapest(view, candidates)
}

/** Lead as wide as the hand allows; follow cheaply. */
export const wide: Policy = (view, candidates) => {
  const leads = candidates.filter((candidate) => candidate.isLead)
  if (leads.length > 0) {
    const index = pick(leads, (a, b) => cards(a.counts) > cards(b.counts))
    return candidates.indexOf(leads[index]!)
  }
  return cheapest(view, candidates)
}

/**
 * Thresholds rather than a sum: a different functional form entirely. Hold the
 * top cards while the hand is long, shed them once it is short, and otherwise
 * spend as little as possible.
 */
export const threshold: Policy = (view: PolicyView, candidates: Candidate[]) => {
  const handSize = totalOf(view.hand)
  const wantsToShed = handSize <= 5
  if (wantsToShed) {
    const withHigh = candidates.filter((candidate) => highCount(candidate.counts) > 0)
    if (withHigh.length > 0) return candidates.indexOf(withHigh[0]!)
    const withAce = candidates.filter((candidate) => topClass(candidate.counts) === 11)
    if (withAce.length > 0) return candidates.indexOf(withAce[0]!)
  } else {
    const withoutTop = candidates.filter((candidate) => topClass(candidate.counts) < 11)
    if (withoutTop.length > 0) {
      return candidates.indexOf(withoutTop[cheapest(view, withoutTop)]!)
    }
  }
  return cheapest(view, candidates)
}

/** Play at random among the legal options — the true floor. */
export function chaos(pick01: () => number): Policy {
  return (_view, candidates) => Math.floor(pick01() * candidates.length) % candidates.length
}

export const ARCHETYPES: Record<string, Policy> = {
  cheapest,
  dumper,
  panic,
  hoarder,
  wide,
  threshold,
}

export function archetypePlayer(name: string, exchange = 3): Player {
  const policy = ARCHETYPES[name]
  if (!policy) throw new Error(`No archetype called ${name}`)
  return {
    name,
    policy,
    exchangeSize: () => exchange,
    takeExchange: (_hand, size) => size,
    // They all have to discard somehow; this is not the axis being varied.
    discards: (hand, n) => (name === 'dumper' ? forcedLow(hand, n) : weightedDiscards(TUNED)(hand, n)),
  }
}
