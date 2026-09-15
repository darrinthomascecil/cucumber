import {
  CLASS_COUNT,
  CLASS_SUPPLY,
  CLASS_VALUE,
  HIGH_CLASS,
  cloneCounts,
  emptyCounts,
  totalOf,
  type CardClass,
  type Counts,
} from './classes.ts'
import { heuristicPolicy, scoreCandidate, type Weights } from './heuristic.ts'
import { settleHand, type ContinuationModel, type HandOutcome } from './outcome.ts'
import type { Random } from './random.ts'
import { forcedLow } from './rules.ts'
import { searchPolicy } from './search.ts'
import {
  type Sim,
  finalClasses,
  leftOfIndex,
  newSim,
  playOut,
  type Policy,
  type SeatIndex,
} from './sim.ts'

const HAND_SIZE = 13

export interface Player {
  name: string
  policy: Policy
  /** Dealer only: how many cards the table may exchange, 0-5. */
  exchangeSize(hand: Counts, random: Random): number
  /** Non-dealers: 0 or the dealer's number. */
  takeExchange(hand: Counts, size: number, random: Random): number
  /** Which cards to throw away once drawn. */
  discards(hand: Counts, n: number): Counts
}

/** Discard the cards this weight vector would most like to be rid of. */
export function weightedDiscards(weights: Weights): (hand: Counts, n: number) => Counts {
  return (hand, n) => {
    const ranked: CardClass[] = []
    for (let c = 0; c < CLASS_COUNT; c++) if (hand[c]! > 0) ranked.push(c)
    const appetite = (c: CardClass): number => {
      const play = emptyCounts()
      play[c] = 1
      return scoreCandidate(
        { counts: play, successful: true, isLead: false },
        { hand, scores: [0, 0, 0], seat: 0 },
        weights,
      )
    }
    ranked.sort((a, b) => appetite(b) - appetite(a))
    const out = emptyCounts()
    let need = n
    for (const c of ranked) {
      if (need === 0) break
      const take = Math.min(need, hand[c]!)
      out[c] = take
      need -= take
    }
    return out
  }
}

export function heuristicPlayer(name: string, weights: Weights, exchange = 3): Player {
  const discards = weightedDiscards(weights)
  return {
    name,
    policy: heuristicPolicy(weights),
    exchangeSize: () => exchange,
    takeExchange: (_hand, size) => size,
    discards,
  }
}

/** Plays by searching. Far slower than the heuristic, and the yardstick the
 *  heuristic has to be measured against. */
export function searchPlayer(
  name: string,
  weights: Weights,
  random: Random,
  worlds = 48,
  exchange = 3,
  inference = true,
  solveFrom = 0,
  solveMode: 'optimal' | 'model' = 'model',
  /** Matches the advisor's default, so the benchmark measures what ships.
   *  It used to be 10 here and 14 there, which quietly benchmarked a
   *  different player from the one in the app. */
  maxActions = 14,
  screen = true,
  /** Observes this player's own odds at each searched decision. Passing it
   *  changes nothing about how the player plays; it is how the offline
   *  harness scores claims that were previously visible only in the browser. */
  onEstimate?: (value: number) => void,
): Player {
  return {
    name,
    policy: searchPolicy(random, {
      worlds,
      weights,
      maxActions,
      screen,
      inference,
      solveFrom,
      solveMode,
      // What the opponents exchanged, and the policy they threw cards with.
      // Both are this player's own, so nothing is assumed about them that is
      // not already true of the table it is sitting at.
      /*
       * Off unless asked for, and that is the finding rather than caution.
       *
       * The prior is worth 5 points of loss rate when its model of the
       * opponents' discarding is right (22.15% -> 17.08%, paired, 4,000
       * matches) and costs 2.4 when it is wrong (3.53% -> 5.93% against the
       * dumper archetype). It models the tuned discard policy, which is true
       * of self-play and false of a human — the case the app exists for. On by
       * default would optimise the benchmark at the expense of the players.
       */
      ...(process.env.EXCHANGE_PRIOR === '1'
        ? { exchanged: [exchange, exchange, exchange] as const, discards: weightedDiscards(weights) }
        : {}),
      ...(onEstimate ? { onEstimate } : {}),
    }),
    exchangeSize: () => exchange,
    takeExchange: (_hand, size) => size,
    discards: weightedDiscards(weights),
  }
}

/** A search policy with an explicit continuation model, for tuning it. */
export function searchPolicyWith(
  weights: Weights,
  random: Random,
  worlds: number,
  continuation: ContinuationModel,
): Policy {
  return searchPolicy(random, { worlds, weights, maxActions: 10, continuation })
}

/** A deliberately weak opponent: always legal, never thoughtful. */
export function simplePlayer(name: string): Player {
  return {
    name,
    policy: (_view, candidates) => 0,
    exchangeSize: () => 0,
    takeExchange: () => 0,
    discards: (hand, n) => forcedLow(hand, n),
  }
}

function shuffledDeck(random: Random): CardClass[] {
  const deck: CardClass[] = []
  for (let c = 0; c < CLASS_COUNT; c++) {
    for (let n = CLASS_SUPPLY[c]!; n > 0; n--) deck.push(c)
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = random.int(i + 1)
    const a = deck[i]!
    deck[i] = deck[j]!
    deck[j] = a
  }
  return deck
}

export interface HandRecord {
  outcome: HandOutcome
  finals: [CardClass, CardClass, CardClass]
  dealer: SeatIndex
}

/** One hand: deal, exchange, tricks, reveal. */
export function playHand(
  players: [Player, Player, Player],
  scores: [number, number, number],
  dealer: SeatIndex,
  random: Random,
  /** Diagnostics only: hands the caller the live Sim before play starts. */
  hook?: (sim: Sim) => void,
): HandRecord {
  const deck = shuffledDeck(random)
  const hands: [Counts, Counts, Counts] = [emptyCounts(), emptyCounts(), emptyCounts()]
  let index = 0
  for (let round = 0; round < HAND_SIZE; round++) {
    for (let seat = 0; seat < 3; seat++) hands[seat as SeatIndex][deck[index++]!]!++
  }
  const stock = deck.slice(index)
  const seen: [Counts, Counts, Counts] = [emptyCounts(), emptyCounts(), emptyCounts()]

  const size = Math.max(0, Math.min(5, Math.round(players[dealer].exchangeSize(hands[dealer], random))))
  if (size > 0) {
    let stockAt = 0
    const order: SeatIndex[] = [dealer, leftOfIndex(dealer), leftOfIndex(leftOfIndex(dealer))]
    for (const seat of order) {
      const take =
        seat === dealer ? size : players[seat].takeExchange(hands[seat], size, random) === 0 ? 0 : size
      if (take === 0) continue
      for (let n = 0; n < take; n++) hands[seat][stock[stockAt++]!]!++
      const thrown = players[seat].discards(hands[seat], take)
      for (let c = 0; c < CLASS_COUNT; c++) {
        hands[seat][c]! -= thrown[c]!
        seen[seat][c]! += thrown[c]!
      }
    }
  }

  const sim = newSim(hands, [...scores] as [number, number, number], dealer)
  sim.seen = seen
  hook?.(sim)
  playOut(sim, [players[0].policy, players[1].policy, players[2].policy])
  const finals = finalClasses(sim)
  return { outcome: settleHand(scores, finals), finals, dealer }
}

export interface MatchRecord {
  losers: SeatIndex[]
  hands: number
  scores: [number, number, number]
}

export function playMatch(
  players: [Player, Player, Player],
  random: Random,
  maxHands = 60,
  hook?: (sim: Sim) => void,
): MatchRecord {
  let scores: [number, number, number] = [0, 0, 0]
  let dealer = random.int(3) as SeatIndex
  for (let hand = 1; hand <= maxHands; hand++) {
    const record = playHand(players, scores, dealer, random, hook)
    scores = record.outcome.scores
    if (record.outcome.matchOver) {
      return { losers: record.outcome.losers, hands: hand, scores }
    }
    dealer = leftOfIndex(dealer)
  }
  // Should not happen: every hand adds at least 2 points to every score.
  const highest = Math.max(...scores)
  return {
    losers: ([0, 1, 2] as SeatIndex[]).filter((seat) => scores[seat] === highest),
    hands: maxHands,
    scores,
  }
}

export interface Trial {
  /** Fraction of matches in which the subject was among the losers. */
  lossRate: number
  matches: number
  averageHands: number
  /** Standard error of lossRate. */
  error: number
}

/**
 * Sit `subject` against two copies of `opponent`, rotating through all three
 * seats so dealing order cannot flatter either of them. Lower is better; three
 * identical players score about 0.36 once ties are counted.
 */
export function trial(
  subject: Player,
  opponent: Player,
  matches: number,
  random: Random,
  /** Where this chunk sits in a larger run, so splitting the work across
   *  workers keeps the same rotation through the three seats. */
  startIndex = 0,
): Trial {
  let losses = 0
  let handTotal = 0
  for (let m = 0; m < matches; m++) {
    const seat = ((startIndex + m) % 3) as SeatIndex
    const line: [Player, Player, Player] = [opponent, opponent, opponent]
    line[seat] = subject
    const record = playMatch(line, random)
    if (record.losers.includes(seat)) losses++
    handTotal += record.hands
  }
  const rate = losses / matches
  return {
    lossRate: rate,
    matches,
    averageHands: handTotal / matches,
    error: Math.sqrt((rate * (1 - rate)) / matches),
  }
}

/** One match's worth of claims, settled against what happened to the seat. */
export interface MatchClaims {
  /** Every number the advisor stated during this match, in order. */
  claims: number[]
  survived: boolean
}

export interface ClaimTrial {
  records: MatchClaims[]
  lossRate: number
  matches: number
}

/**
 * `trial`, but it also writes down what the subject claimed along the way.
 *
 * The subject is built per match rather than passed in, because the observer
 * has to be attached when the player is constructed and the claims have to be
 * attributable to one match — a single outcome is what settles them, and
 * mixing two matches' claims under one outcome is exactly the mistake the
 * browser panel takes care to avoid.
 */
export function claimTrial(
  makeSubject: (onEstimate: (value: number) => void) => Player,
  opponent: Player,
  matches: number,
  random: Random,
  startIndex = 0,
): ClaimTrial {
  const records: MatchClaims[] = []
  let losses = 0
  let claims: number[] = []
  const subject = makeSubject((value) => claims.push(value))

  for (let m = 0; m < matches; m++) {
    const seat = ((startIndex + m) % 3) as SeatIndex
    const line: [Player, Player, Player] = [opponent, opponent, opponent]
    line[seat] = subject
    // A fresh array per match; the observer pushes into whichever one this
    // variable currently holds, and the reference handed to `records` keeps
    // filling until the next match replaces it.
    claims = []
    const filling = claims
    const record = playMatch(line, random)
    const survived = !record.losers.includes(seat)
    if (!survived) losses++
    records.push({ claims: filling, survived })
  }

  return { records, lossRate: losses / matches, matches }
}

export interface FinalStats {
  hands: number
  /** Fraction of hands this player finished holding a 7 or a Joker. */
  sevenRate: number
  /** Average points the final card cost them. */
  meanValue: number
  /** How often each class was the card left over. */
  histogram: number[]
}

/**
 * What is this player actually left holding?
 *
 * Loss rate alone hides this. A policy can lose about as often as its rivals
 * while being wrong in a specific, visible way — and the card you are left
 * holding is the whole game, so it is worth counting directly.
 *
 * For reference: 6 of the 54 cards are 7s or Jokers, so finishing on one 11%
 * of the time is what indifference looks like. Good play should be far below.
 */
export function finalCardStats(
  subject: Player,
  opponent: Player,
  matches: number,
  random: Random,
): FinalStats {
  const histogram = new Array(CLASS_COUNT).fill(0)
  let hands = 0
  let sevens = 0
  let value = 0

  for (let m = 0; m < matches; m++) {
    const seat = (m % 3) as SeatIndex
    const line: [Player, Player, Player] = [opponent, opponent, opponent]
    line[seat] = subject
    let scores: [number, number, number] = [0, 0, 0]
    let dealer = random.int(3) as SeatIndex
    for (let hand = 1; hand <= 60; hand++) {
      const record = playHand(line, scores, dealer, random)
      const final = record.finals[seat]!
      histogram[final]!++
      hands++
      if (final === HIGH_CLASS) sevens++
      value += CLASS_VALUE[final]!
      scores = record.outcome.scores
      if (record.outcome.matchOver) break
      dealer = leftOfIndex(dealer)
    }
  }

  return { hands, sevenRate: sevens / hands, meanValue: value / hands, histogram }
}

/** Head-to-head: two of `a` against one `b`, and the mirror, to compare fairly. */
export function duel(
  a: Player,
  b: Player,
  matches: number,
  random: Random,
): { aLossRate: number; bLossRate: number; matches: number } {
  let aLosses = 0
  let bLosses = 0
  for (let m = 0; m < matches; m++) {
    const seat = (m % 3) as SeatIndex
    const line: [Player, Player, Player] = [a, a, a]
    line[seat] = b
    const record = playMatch(line, random)
    if (record.losers.includes(seat)) bLosses++
    const aSeats = ([0, 1, 2] as SeatIndex[]).filter((s) => s !== seat)
    if (aSeats.some((s) => record.losers.includes(s))) aLosses++
  }
  return { aLossRate: aLosses / matches, bLossRate: bLosses / matches, matches }
}
