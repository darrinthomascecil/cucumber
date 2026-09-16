import { SEATS, leftOf, type CardId, type MatchState, type PlayerView, type Seat, type TrickState } from '@cucumber/shared'
import { buildDeck, shuffle, type Rng } from '../deck.ts'
import { validateFollow, validateLead } from '../legalMove.ts'
import { trickStrength } from '../ranking.ts'
import { applyFollow, applyLead, isTrickComplete, nextLeader, startTrick, trickCards } from '../trick.ts'
import { viewFor } from '../view.ts'
import { actionKey, type AdvisorAction } from './actions.ts'
import { DEFAULT_EXPLORATION, POLICY_NAMES, identityProbability, policyProbabilities } from './policy.ts'
import { advisorRng, logSumExp } from './random.ts'

export interface BeliefOptions {
  particles?: number
  maxAttempts?: number
  seed?: number
  model?: 'history' | 'uniform'
  exploration?: number
  policyPrior?: readonly number[]
}

export interface BeliefParticle {
  state: MatchState
  weight: number
  policyWeights: Record<Seat, number[]>
}

export interface Belief {
  particles: BeliefParticle[]
  effectiveSamples: number
  attempts: number
  model: 'history' | 'uniform'
  enumerated: boolean
}

interface Observation {
  seat: Seat
  cards: CardId[]
  target: CardId[]
  lead: boolean
  successful: boolean
}

function observations(view: PlayerView): Observation[] {
  const tricks = [...(view.completedTricks ?? []), ...(view.trick ? [view.trick] : [])]
  return tricks.flatMap((trick) => {
    let target: CardId[] = []
    return trick.plays.map((play, index) => {
      const observation = { ...play, target: [...target], lead: index === 0 }
      if (play.successful) target = play.cards
      return observation
    })
  })
}

function logChoose(total: number, count: number): number {
  if (count < 0 || count > total) return -Infinity
  let result = 0
  for (let index = 1; index <= count; index++) result += Math.log(total - index + 1) - Math.log(index)
  return result
}

function emptyCards(): Record<Seat, CardId[]> {
  return { 1: [], 2: [], 3: [] }
}

function sampleState(
  view: PlayerView,
  pool: CardId[],
  bounds: Record<Seat, { low: number; high: number }>,
  rng: Rng,
  assigned?: Partial<Record<Seat, CardId[]>>,
): { state: MatchState; correction: number } | null {
  const hands = emptyCards()
  hands[view.you.seat] = [...view.you.hand]
  const others = view.players.filter((player) => player.seat !== view.you.seat).sort((left, right) => {
    const available = (seat: Seat) => pool.filter((card) => trickStrength(card) >= bounds[seat].low && trickStrength(card) <= bounds[seat].high).length
    return available(left.seat) - left.cardCount - (available(right.seat) - right.cardCount)
  })
  let remaining = [...pool]
  let correction = 0
  for (const player of others) {
    const allowed = remaining.filter((card) => trickStrength(card) >= bounds[player.seat].low && trickStrength(card) <= bounds[player.seat].high)
    if (allowed.length < player.cardCount) return null
    correction += logChoose(allowed.length, player.cardCount)
    const fixed = assigned?.[player.seat]
    if (fixed && (fixed.length !== player.cardCount || fixed.some((card) => !allowed.includes(card)))) return null
    hands[player.seat] = fixed ? [...fixed] : shuffle(allowed, rng).slice(0, player.cardCount)
    const taken = new Set(hands[player.seat])
    remaining = remaining.filter((card) => !taken.has(card))
  }
  remaining = shuffle(remaining, rng)
  const discardedBySeat = emptyCards()
  discardedBySeat[view.you.seat] = [...view.you.discards]
  for (const player of others) {
    const playedThisTrick = view.trick?.plays.find((play) => play.seat === player.seat)?.cards.length ?? 0
    const initialCount = player.cardCount + view.played.length / 3 + playedThisTrick
    const pending = Math.max(0, initialCount - 13)
    const count = view.exchangeCounts![player.seat] - pending
    if (!Number.isInteger(count) || count < 0 || count > remaining.length) throw new Error('Inconsistent exchange evidence')
    discardedBySeat[player.seat] = remaining.splice(0, count)
  }
  if (remaining.length !== view.stockCount) throw new Error('Public card counts do not account for the deck')
  const dealer = view.dealerSeat!
  const order = [dealer, leftOf(dealer), leftOf(leftOf(dealer))]
  const exchange = view.exchange ? {
    size: view.exchange.size,
    order,
    index: order.indexOf(view.exchange.actingSeat!),
    step: view.exchange.step,
    drawCount: view.exchange.step === 'DISCARD' ? view.exchange.size : 0,
  } : null
  return {
    correction,
    state: {
      matchId: view.matchId,
      version: view.version,
      phase: view.phase,
      players: view.players.map((player) => ({
        seat: player.seat,
        userId: `simulation-${player.seat}`,
        displayName: player.displayName,
        score: player.score,
        ready: player.ready,
        connected: 'ONLINE',
      })),
      handNumber: view.handNumber,
      dealerSeat: dealer,
      hands,
      stock: remaining,
      discards: SEATS.flatMap((seat) => discardedBySeat[seat]),
      discardedBySeat,
      exchangeCounts: { ...view.exchangeCounts! },
      played: [...view.played],
      completedTricks: structuredClone(view.completedTricks),
      exchange,
      trick: view.trick ? structuredClone(view.trick) : null,
      lastTrick: view.lastTrick ? structuredClone(view.lastTrick) : null,
      handResult: view.handResult ? structuredClone(view.handResult) : null,
      losers: [...view.losers],
    },
  }
}

function evidence(
  state: MatchState,
  observer: Seat,
  history: Observation[],
  prior: number[],
  exploration: number,
  cache: Map<string, number[]>,
): { logWeight: number; policyWeights: Record<Seat, number[]> } | null {
  const reconstructed = structuredClone(state.hands)
  for (const observation of [...history].reverse()) {
    reconstructed[observation.seat].push(...observation.cards)
    try {
      if (observation.lead) validateLead(reconstructed[observation.seat], observation.cards)
      else {
        const result = validateFollow(reconstructed[observation.seat], observation.target, observation.cards)
        if ((result === 'SUCCESS') !== observation.successful) return null
      }
    } catch { return null }
  }
  const hands = emptyCards()
  for (const seat of SEATS) hands[seat] = [...state.hands[seat], ...history.filter((play) => play.seat === seat).flatMap((play) => play.cards)]
  const logs = { 1: prior.map(Math.log), 2: prior.map(Math.log), 3: prior.map(Math.log) }
  function choiceKey(prompt: PlayerView['prompt'], hand: CardId[], target: CardId[] | undefined, action: AdvisorAction): string {
    return `${prompt.kind}|${prompt.options}|${hand.map(trickStrength).sort((left, right) => left - right)}|${target?.map(trickStrength)}|${actionKey(action)}`
  }
  function record(seat: Seat, hand: CardId[], action: AdvisorAction, values: number[]): void {
    const identity = identityProbability(hand, action)
    for (let index = 0; index < POLICY_NAMES.length; index++) logs[seat][index]! += Math.log(values[index]! * identity)
  }
  function update(view: PlayerView, action: AdvisorAction): void {
    if (view.you.seat === observer) return
    const key = choiceKey(view.prompt, view.you.hand, view.trick?.targetCards, action)
    let values = cache.get(key)
    if (!values) {
      values = policyProbabilities(view, action, exploration)
      if (cache.size < 30_000) cache.set(key, values)
    }
    record(view.you.seat, view.you.hand, action, values)
  }
  const replay: MatchState = {
    ...state,
    hands,
    phase: 'TRICK_PLAY',
    played: [],
    completedTricks: [],
    lastTrick: null,
    exchange: null,
    trick: startTrick(state.dealerSeat!),
  }
  if (state.phase !== 'EXCHANGE_SIZE_SELECTION') {
    const dealer = state.dealerSeat!
    const size = state.exchangeCounts![dealer]
    const dealerView = viewFor(replay, dealer)
    dealerView.prompt = { kind: 'SELECT_EXCHANGE_SIZE', message: '', options: [0, 1, 2, 3, 4, 5] }
    update(dealerView, { type: 'SELECT_EXCHANGE_SIZE', size })
    if (size > 0) {
      const order = [dealer, leftOf(dealer), leftOf(leftOf(dealer))]
      for (const seat of order.slice(1)) {
        const index = order.indexOf(seat)
        if (state.exchange && (index > state.exchange.index || (index === state.exchange.index && state.exchange.step === 'CHOICE'))) continue
        const exchangeView = viewFor(replay, seat)
        exchangeView.prompt = { kind: 'SELECT_EXCHANGE', message: '', options: [0, size] }
        update(exchangeView, { type: 'SELECT_EXCHANGE', size: state.exchangeCounts![seat] })
      }
    }
  }
  for (const seat of SEATS) {
    if (seat === observer) continue
    const discarded = state.discardedBySeat![seat]
    if (discarded.length === 0) continue
    const discardView = viewFor(replay, seat)
    discardView.you.hand = [...hands[seat], ...discarded]
    discardView.prompt = { kind: 'SUBMIT_DISCARDS', message: '', requiredCards: discarded.length }
    update(discardView, { type: 'SUBMIT_DISCARDS', cards: discarded })
  }
  for (const observation of history) {
    if (replay.trick!.actionSeat !== observation.seat) return null
    try {
      if (observation.lead) validateLead(hands[observation.seat], observation.cards)
      else {
        const outcome = validateFollow(hands[observation.seat], observation.target, observation.cards)
        if ((outcome === 'SUCCESS') !== observation.successful) return null
      }
    } catch {
      return null
    }
    if (observation.seat !== observer) {
      const action: AdvisorAction = { type: 'PLAY_CARDS', cards: observation.cards }
      const prompt: PlayerView['prompt'] = { kind: observation.lead ? 'LEAD' : observation.successful ? 'FOLLOW' : 'FORCED_LOW', message: '' }
      const key = choiceKey(prompt, hands[observation.seat], observation.target, action)
      const cached = cache.get(key)
      if (cached) record(observation.seat, hands[observation.seat], action, cached)
      else update(viewFor(replay, observation.seat), action)
    }
    hands[observation.seat] = hands[observation.seat].filter((card) => !observation.cards.includes(card))
    const current: TrickState = observation.lead
      ? applyLead(replay.trick!, observation.seat, observation.cards)
      : applyFollow(replay.trick!, observation.seat, observation.cards, observation.successful)
    replay.trick = current
    if (isTrickComplete(current)) {
      replay.played.push(...trickCards(current))
      replay.completedTricks!.push(current)
      replay.lastTrick = current
      replay.trick = startTrick(nextLeader(current))
    }
  }
  let logWeight = 0
  const policyWeights = { 1: [...prior], 2: [...prior], 3: [...prior] }
  for (const seat of SEATS) {
    if (seat === observer) continue
    const normalizer = logSumExp(logs[seat])
    if (!Number.isFinite(normalizer)) return null
    logWeight += normalizer
    policyWeights[seat] = logs[seat].map((value) => Math.exp(value - normalizer))
  }
  return { logWeight, policyWeights }
}

function buildBelief(view: PlayerView, options: BeliefOptions, enumerateFinal: boolean): Belief {
  if (!view.historyComplete || !view.exchangeCounts || !view.completedTricks) throw new Error('This saved hand lacks complete observation history; a new hand is required for the advisor')
  const completedTricks = view.completedTricks
  if (!['TRICK_PLAY', 'EXCHANGE', 'EXCHANGE_SIZE_SELECTION'].includes(view.phase)) throw new Error('No hidden-hand forecast is available in this phase')
  if (enumerateFinal && (view.phase !== 'TRICK_PLAY' || view.trick?.plays.length !== 2 || view.actionSeat !== view.you.seat
    || view.players.some((player) => player.seat !== view.you.seat && player.cardCount !== 1)
    || view.stockCount !== 15 || SEATS.some((seat) => view.exchangeCounts![seat] !== 0))) {
    throw new Error('Exact closing-hand enumeration requires two hidden final cards and no exchanges')
  }
  const desired = options.particles ?? 96
  const maxAttempts = options.maxAttempts ?? desired * 100
  if (!Number.isSafeInteger(desired) || desired < 1 || desired > 100_000) throw new Error('Invalid particle budget')
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new Error('Invalid attempt budget')
  const exploration = options.exploration ?? DEFAULT_EXPLORATION
  if (!Number.isFinite(exploration) || exploration < 0 || exploration > 1) throw new Error('Invalid exploration probability')
  const prior = [...(options.policyPrior ?? [1 / 3, 1 / 3, 1 / 3])]
  if (prior.length !== POLICY_NAMES.length || prior.some((value) => !Number.isFinite(value) || value < 0)) throw new Error('Invalid policy prior')
  const total = prior.reduce((sum, value) => sum + value, 0)
  if (total <= 0) throw new Error('Empty policy prior')
  for (let index = 0; index < prior.length; index++) prior[index]! /= total
  const publicCards = [...view.played, ...(view.trick?.plays.flatMap((play) => play.cards) ?? [])]
  const known = [...view.you.hand, ...view.you.discards, ...publicCards]
  const knownSet = new Set(known)
  if (knownSet.size !== known.length || known.some((card) => !buildDeck().includes(card))) throw new Error('Invalid or duplicated known card')
  if (completedTricks.flatMap(trickCards).join(',') !== view.played.join(',')) throw new Error('Completed trick history is incomplete')
  if (view.phase === 'TRICK_PLAY') {
    for (const player of view.players) {
      const currentCount = view.trick?.plays.find((play) => play.seat === player.seat)?.cards.length ?? 0
      if (player.cardCount + view.played.length / 3 + currentCount !== 13) throw new Error('Public history does not account for the dealt hand')
    }
  }
  const pool = buildDeck().filter((card) => !knownSet.has(card))
  const history = observations(view)
  const model = options.model ?? 'history'
  const bounds = { 1: { low: 2, high: 14 }, 2: { low: 2, high: 14 }, 3: { low: 2, high: 14 } }
  if (model === 'history') {
    for (const play of history) {
      if (play.successful) continue
      bounds[play.seat].low = Math.max(bounds[play.seat].low, ...play.cards.map(trickStrength))
      if (play.target.length === 1) bounds[play.seat].high = Math.min(bounds[play.seat].high, trickStrength(play.target[0]!) - 1)
    }
  }
  const rng = advisorRng(options.seed ?? 73129)
  const candidates: { particle: BeliefParticle; logWeight: number }[] = []
  const cache = new Map<string, number[]>()
  let attempts = 0
  function consider(sampled: ReturnType<typeof sampleState>): void {
    if (!sampled) return
    const evaluated = model === 'history'
      ? evidence(sampled.state, view.you.seat, history, prior, exploration, cache)
      : { logWeight: 0, policyWeights: { 1: [...prior], 2: [...prior], 3: [...prior] } }
    if (!evaluated) return
    candidates.push({
      particle: { state: sampled.state, weight: 0, policyWeights: evaluated.policyWeights },
      logWeight: (enumerateFinal ? 0 : sampled.correction) + evaluated.logWeight,
    })
  }
  if (enumerateFinal) {
    const others = SEATS.filter((seat) => seat !== view.you.seat)
    if (pool.length !== 17) throw new Error('Exact closing-hand enumeration expects seventeen unseen cards')
    for (const first of pool) {
      for (const second of pool) {
        if (first === second) continue
        attempts++
        consider(sampleState(view, pool, bounds, rng, { [others[0]!]: [first], [others[1]!]: [second] }))
      }
    }
  } else {
    while (candidates.length < desired && attempts < maxAttempts) {
      attempts++
      consider(sampleState(view, pool, bounds, rng))
    }
  }
  if (candidates.length === 0) throw new Error('No consistent hidden hands found within the sampling budget; no probability was produced')
  const normalizer = logSumExp(candidates.map((candidate) => candidate.logWeight))
  for (const candidate of candidates) candidate.particle.weight = Math.exp(candidate.logWeight - normalizer)
  const particles = candidates.map((candidate) => candidate.particle)
  const effectiveSamples = 1 / particles.reduce((sum, particle) => sum + particle.weight ** 2, 0)
  return { particles, effectiveSamples, attempts, model, enumerated: enumerateFinal }
}

export function sampleBelief(view: PlayerView, options: BeliefOptions = {}): Belief {
  return buildBelief(view, options, false)
}

export function enumerateClosingBelief(view: PlayerView, options: BeliefOptions = {}): Belief {
  return buildBelief(view, options, true)
}