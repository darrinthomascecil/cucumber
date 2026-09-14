import { cardLabel } from '@cucumber/game-engine'
import type { CardId, PlayerView, Seat } from '@cucumber/shared'
import {
  CLASS_COUNT,
  CLASS_LABELS,
  classOf,
  type CardClass,
  cloneCounts,
  countsOf,
  emptyCounts,
  pickCards,
  totalOf,
  type Counts,
} from './classes.ts'
import { sampleFullWorld, type InfoSet } from './determinize.ts'
import { heuristicPolicy, scoreCandidate, TUNED, type Weights } from './heuristic.ts'
import { handValue, settleHand, type ContinuationModel } from './outcome.ts'
import { xorshift, type Random } from './random.ts'
import { searchActions, type TrickContext } from './search.ts'
import {
  candidatesFor,
  cloneSim,
  commit,
  finalClasses,
  newSim,
  playOut,
  type Policy,
  type SeatIndex,
} from './sim.ts'
import { forcedLow } from './rules.ts'

/**
 * What a player has personally seen but no longer holds: the cards they threw
 * into their own face-down discard. Legal knowledge — they saw them — and
 * nobody else's discards are ever recorded here.
 */
export interface SeatMemory {
  discarded: CardId[]
}

export const emptyMemory = (): SeatMemory => ({ discarded: [] })

export interface Suggestion {
  cards: CardId[]
  description: string
  /** Probability of not losing the match if this is played. */
  winProbability: number
  /** How much worse than the best option, in probability. */
  cost: number
}

export interface Advice {
  kind: 'PLAY' | 'DISCARD' | 'EXCHANGE_SIZE' | 'ODDS_ONLY' | 'NONE'
  /** Probability the player does not lose the match from here. */
  winProbability: number
  suggestions: Suggestion[]
  worlds: number
  note?: string
}

export interface AdviseOptions {
  worlds?: number
  weights?: Weights
  continuation?: ContinuationModel
  seed?: number
  maxActions?: number
}

const NO_ADVICE: Advice = { kind: 'NONE', winProbability: 0, suggestions: [], worlds: 0 }

function seatIndex(seat: Seat): SeatIndex {
  return (seat - 1) as SeatIndex
}

/** Every card that has hit the table this hand, completed tricks and the one
 *  in progress. All three players watched each of them. */
function publicCards(view: PlayerView): CardId[] {
  const cards = [...view.played]
  for (const play of view.trick?.plays ?? []) cards.push(...play.cards)
  return cards
}

/**
 * What the table has publicly shown each seat cannot do. Walk the current
 * trick in order, tracking the target as it changes hands; every unsuccessful
 * play is a seat proving, in front of everyone, that its whole hand could not
 * answer the target standing at that moment.
 *
 * Only the trick in progress is available here — the per-seat view does not
 * carry earlier tricks. Measured across 80,000 matches this inference is worth
 * about 0.2 points, which is inside the noise, so the fuller version is not
 * worth the state it would cost. It is here because it is free and correct.
 */
function failuresFrom(view: PlayerView): CardClass[][][] {
  const failures: CardClass[][][] = [[], [], []]
  const trick = view.trick
  if (!trick || trick.plays.length === 0) return failures
  let target: CardClass[] = []
  for (const play of trick.plays) {
    const cards = play.cards.map(classOf).sort((a, b) => a - b)
    if (target.length === 0 || play.successful) {
      target = cards
      continue
    }
    failures[seatIndex(play.seat)]!.push([...target])
  }
  return failures
}

export function informationFrom(view: PlayerView, memory: SeatMemory): InfoSet {
  const sizes: [number, number, number] = [0, 0, 0]
  const scores: [number, number, number] = [0, 0, 0]
  for (const player of view.players) {
    sizes[seatIndex(player.seat)] = player.cardCount
    scores[seatIndex(player.seat)] = player.score
  }
  return {
    seat: seatIndex(view.you.seat),
    hand: countsOf(view.you.hand),
    played: countsOf(publicCards(view)),
    mine: countsOf(memory.discarded),
    handSizes: sizes,
    scores,
    failures: failuresFrom(view),
  }
}

function trickFrom(view: PlayerView): TrickContext {
  const trick = view.trick
  if (!trick) throw new Error('No trick in progress')
  return {
    leaderSeat: seatIndex(trick.leaderSeat),
    successfulSeat: seatIndex(trick.successfulSeat ?? trick.leaderSeat),
    target: trick.targetCards.map(classOf).sort((a, b) => a - b),
    playsMade: trick.plays.length,
  }
}

/** Odds from a position where it is somebody else's move. */
function positionOdds(
  info: InfoSet,
  trick: TrickContext,
  actionSeat: SeatIndex,
  random: Random,
  options: AdviseOptions,
): { value: number; worlds: number } {
  const worlds = options.worlds ?? 120
  const policy: Policy = heuristicPolicy(options.weights ?? TUNED)
  const policies: [Policy, Policy, Policy] = [policy, policy, policy]
  let total = 0
  for (let w = 0; w < worlds; w++) {
    const hands = sampleFullWorld(info, random).hands
    const sim = newSim(hands, [...info.scores] as [number, number, number], trick.leaderSeat)
    sim.actionSeat = actionSeat
    sim.target = [...trick.target]
    sim.successfulSeat = trick.successfulSeat
    sim.playsMade = trick.playsMade
    playOut(sim, policies)
    total += handValue(settleHand(sim.scores, finalClasses(sim)), info.seat, options.continuation)
  }
  return { value: total / worlds, worlds }
}

function describePlay(counts: Counts, cards: CardId[], isLead: boolean): string {
  if (cards.length === 1) return isLead ? `Lead ${cardLabel(cards[0] as CardId)}` : `Play ${cardLabel(cards[0] as CardId)}`
  const labels = cards.map(cardLabel).join(' + ')
  return `${isLead ? 'Lead' : 'Play'} ${labels}`
}

/** Candidate discard sets: the heuristic's least-wanted cards, plus nearby
 *  variations so the search has something to disagree with. */
function discardCandidates(hand: readonly CardId[], n: number, weights: Weights): Counts[] {
  const counts = countsOf(hand)
  const ranked: number[] = []
  for (let c = 0; c < CLASS_COUNT; c++) if (counts[c]! > 0) ranked.push(c)
  // Score each class by how gladly the heuristic would be rid of one copy.
  const single = (c: number): number => {
    const play = emptyCounts()
    play[c] = 1
    return scoreCandidate(
      { counts: play, successful: true, isLead: false },
      { hand: counts, scores: [0, 0, 0], seat: 0 },
      weights,
    )
  }
  ranked.sort((a, b) => single(b) - single(a))

  const sets: Counts[] = []
  const push = (set: Counts) => {
    if (totalOf(set) !== n) return
    if (sets.some((existing) => existing.every((v, i) => v === set[i]))) return
    sets.push(set)
  }
  // Greedy pick, then the same with each of the next few classes swapped in.
  const greedy = (skip: number | null): Counts => {
    const set = emptyCounts()
    const left = cloneCounts(counts)
    let need = n
    for (const c of ranked) {
      if (need === 0) break
      if (c === skip) continue
      const take = Math.min(need, left[c]!)
      set[c] = take
      need -= take
    }
    return set
  }
  push(greedy(null))
  for (const c of ranked.slice(0, 6)) push(greedy(c))
  // And the plain "throw the lowest" and "throw the highest" answers.
  push(forcedLow(counts, n))
  const highest = emptyCounts()
  let need = n
  for (let c = CLASS_COUNT - 1; c >= 0 && need > 0; c--) {
    const take = Math.min(need, counts[c]!)
    highest[c] = take
    need -= take
  }
  push(highest)
  return sets
}

function evaluateDiscards(
  view: PlayerView,
  info: InfoSet,
  candidates: Counts[],
  random: Random,
  options: AdviseOptions,
): { values: number[]; worlds: number } {
  const worlds = options.worlds ?? 90
  const policy: Policy = heuristicPolicy(options.weights ?? TUNED)
  const policies: [Policy, Policy, Policy] = [policy, policy, policy]
  const dealer = view.dealerSeat ? seatIndex(view.dealerSeat) : info.seat
  const totals = new Float64Array(candidates.length)

  for (let w = 0; w < worlds; w++) {
    const world = sampleFullWorld(info, random)
    for (let i = 0; i < candidates.length; i++) {
      const hands: [Counts, Counts, Counts] = [
        cloneCounts(world.hands[0]),
        cloneCounts(world.hands[1]),
        cloneCounts(world.hands[2]),
      ]
      const mine = cloneCounts(hands[info.seat])
      for (let c = 0; c < CLASS_COUNT; c++) mine[c]! -= candidates[i]![c]!
      hands[info.seat] = mine
      const sim = newSim(hands, [...info.scores] as [number, number, number], dealer)
      playOut(sim, policies)
      totals[i]! += handValue(
        settleHand(sim.scores, finalClasses(sim)),
        info.seat,
        options.continuation,
      )
    }
  }
  return { values: [...totals].map((total) => total / worlds), worlds }
}

/**
 * The whole advisor. It is handed nothing but the player's own sanitised view
 * and their memory of their own discards, so it cannot consult a card it is
 * not entitled to see — the constraint is structural, not a promise.
 */
export function advise(
  view: PlayerView,
  memory: SeatMemory = emptyMemory(),
  options: AdviseOptions = {},
): Advice {
  const random = xorshift(options.seed ?? 0x5eed1234)
  const weights = options.weights ?? TUNED

  if (view.phase === 'TRICK_PLAY' && view.trick) {
    const info = informationFrom(view, memory)
    const trick = trickFrom(view)
    const myTurn = view.actionSeat === view.you.seat
    if (!myTurn) {
      const seat = view.actionSeat ? seatIndex(view.actionSeat) : info.seat
      const odds = positionOdds(info, trick, seat, random, options)
      return {
        kind: 'ODDS_ONLY',
        winProbability: odds.value,
        suggestions: [],
        worlds: odds.worlds,
        note: 'Waiting for another player.',
      }
    }

    const result = searchActions(info, trick, random, {
      worlds: options.worlds ?? 160,
      weights,
      continuation: options.continuation,
      maxActions: options.maxActions,
    })
    const best = result.best
    const suggestions: Suggestion[] = result.actions.map((action) => {
      const cards = pickCards(view.you.hand, action.candidate.counts)
      return {
        cards,
        description: describePlay(action.candidate.counts, cards, action.candidate.isLead),
        winProbability: action.value,
        cost: best - action.value,
      }
    })
    const forced = result.actions.length === 1 && !result.actions[0]!.candidate.successful
    return {
      kind: 'PLAY',
      winProbability: best,
      suggestions,
      worlds: result.worlds,
      note: forced ? 'No choice here — you cannot meet this play.' : undefined,
    }
  }

  if (view.phase === 'EXCHANGE' && view.prompt.kind === 'SUBMIT_DISCARDS') {
    const info = informationFrom(view, memory)
    const n = view.prompt.requiredCards ?? 0
    if (n === 0) return NO_ADVICE
    const candidates = discardCandidates(view.you.hand, n, weights)
    const { values, worlds } = evaluateDiscards(view, info, candidates, random, options)
    const order = values.map((value, index) => ({ value, index })).sort((a, b) => b.value - a.value)
    const best = order[0]?.value ?? 0
    return {
      kind: 'DISCARD',
      winProbability: best,
      worlds,
      suggestions: order.map(({ value, index }) => {
        const cards = pickCards(view.you.hand, candidates[index]!)
        return {
          cards,
          description: `Discard ${cards.map(cardLabel).join(' + ')}`,
          winProbability: value,
          cost: best - value,
        }
      }),
      note: 'Assumes the others stand pat; the play advice below is the exact one.',
    }
  }

  return NO_ADVICE
}

export { CLASS_LABELS }
