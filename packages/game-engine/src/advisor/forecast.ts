import { SEATS, type PlayerView, type Seat } from '@cucumber/shared'
import { isSevenOrJoker, scoreValue } from '../ranking.ts'
import { LOSS_LIMIT } from '../scoring.ts'
import { actionCost, DEFAULT_EXPLORATION, POLICY_NAMES, type PolicyName } from './policy.ts'
import { actionKey, legalActions, type AdvisorAction } from './actions.ts'
import { enumerateClosingBelief, sampleBelief, type Belief, type BeliefOptions } from './belief.ts'
import { calibrate, type Calibration } from './metrics.ts'
import { advisorRng, weightedIndex } from './random.ts'
import { expectedContinuation, type LossProbabilities, type SeatPolicies } from './simulation.ts'

export interface ForecastOptions extends BeliefOptions {
  simulations?: number
  selfPolicy?: PolicyName
  calibration?: Calibration
  maxActions?: number
}

export interface LossForecast {
  target: 'eventual-match-loss'
  method: 'exact-final' | 'monte-carlo'
  probabilities: LossProbabilities
  rawProbabilities: LossProbabilities
  guaranteedLosses: Seat[]
  effectiveParticles: number
  particles: number
  simulations: number
  attempts: number
  opponentPolicies: Record<Seat, number[]>
  warnings: string[]
}

export interface Advice {
  recommendation: AdvisorAction
  alternatives: { action: AdvisorAction; forecast: LossForecast }[]
  legalActionCount: number
  evaluatedActionCount: number
  selfPolicy: PolicyName
}

function evaluate(view: PlayerView, belief: Belief, options: ForecastOptions, action?: AdvisorAction): LossForecast {
  const samples = options.simulations ?? 128
  if (!Number.isInteger(samples) || samples < 1 || samples > 100_000) throw new Error('Invalid simulation budget')
  const rng = advisorRng((options.seed ?? 73129) ^ 0x1f123bb5)
  const weights = belief.particles.map((particle) => particle.weight)
  const raw: LossProbabilities = { 1: 0, 2: 0, 3: 0 }
  const opponentPolicies = { 1: [0, 0, 0], 2: [0, 0, 0], 3: [0, 0, 0] }
  for (const particle of belief.particles) {
    for (const seat of SEATS) {
      for (let index = 0; index < POLICY_NAMES.length; index++) opponentPolicies[seat][index]! += particle.weight * particle.policyWeights[seat][index]!
    }
  }
  if (belief.enumerated) {
    if (!action) throw new Error('An exact closing forecast requires the final action')
    const policies: SeatPolicies = { 1: 'random', 2: 'random', 3: 'random' }
    for (const particle of belief.particles) {
      const losses = expectedContinuation(particle.state, policies, 0, 0, action)
      for (const seat of SEATS) raw[seat] += particle.weight * losses[seat]
    }
  } else {
    for (let sample = 0; sample < samples; sample++) {
      const particle = belief.particles[weightedIndex(weights, rng)]!
      const policies = {} as SeatPolicies
      for (const seat of SEATS) policies[seat] = seat === view.you.seat
        ? options.selfPolicy ?? 'careful'
        : POLICY_NAMES[weightedIndex(particle.policyWeights[seat], rng)]!
      const losses = expectedContinuation(particle.state, policies, rng(0x100000000), options.exploration ?? DEFAULT_EXPLORATION, action)
      for (const seat of SEATS) raw[seat] += losses[seat] / samples
    }
  }
  const probabilities = { 1: 0, 2: 0, 3: 0 }
  for (const seat of SEATS) {
    raw[seat] = Math.max(0, Math.min(1, raw[seat]))
    probabilities[seat] = belief.enumerated ? raw[seat] : calibrate(raw[seat], options.calibration)
  }
  const remaining = action?.type === 'PLAY_CARDS' ? view.you.hand.filter((card) => !action.cards.includes(card)) : view.you.hand
  const guaranteedLosses: Seat[] = []
  if (view.phase === 'TRICK_PLAY' && remaining.length === 1 && isSevenOrJoker(remaining[0]!)) {
    raw[view.you.seat] = 1
    probabilities[view.you.seat] = 1
    guaranteedLosses.push(view.you.seat)
  }
  const warnings = ['Probabilities are conditional on the modeled opponent policies and continuation policy, not guarantees against every opponent.']
  if (belief.enumerated) warnings.push('Exact for the declared hidden-deal and opponent-policy model; fitted calibration is not applied.')
  else {
    if (belief.effectiveSamples < 20) warnings.push('Low effective particle count; hidden-hand uncertainty is poorly resolved. Increase the particle budget.')
    if (!options.calibration) warnings.push('Uncalibrated model estimate; no fitted calibration was supplied.')
  }
  if (belief.model === 'uniform') warnings.push('Uniform baseline ignores behavioral and forced-low evidence.')
  return { target: 'eventual-match-loss', method: belief.enumerated ? 'exact-final' : 'monte-carlo', probabilities, rawProbabilities: raw, guaranteedLosses, effectiveParticles: belief.effectiveSamples, particles: belief.particles.length, simulations: belief.enumerated ? 0 : samples, attempts: belief.attempts, opponentPolicies, warnings }
}

export function forecastLoss(view: PlayerView, options: ForecastOptions = {}, action?: AdvisorAction): LossForecast {
  if (action) {
    if (view.actionSeat !== view.you.seat || !legalActions(view).some((candidate) => actionKey(candidate) === actionKey(action))) throw new Error('Forecast action is not available to this player')
  }
  const remaining = action?.type === 'PLAY_CARDS' ? view.you.hand.filter((card) => !action.cards.includes(card)) : []
  const closing = view.phase === 'TRICK_PLAY' && view.trick?.plays.length === 2 && remaining.length === 1
    && view.players.every((player) => player.seat === view.you.seat || player.cardCount === 1)
    && view.stockCount === 15 && SEATS.every((seat) => view.exchangeCounts?.[seat] === 0)
    && (isSevenOrJoker(remaining[0]!) || view.you.score + scoreValue(remaining[0]!) >= LOSS_LIMIT)
  return evaluate(view, closing ? enumerateClosingBelief(view, options) : sampleBelief(view, options), options, action)
}

export function advise(view: PlayerView, options: ForecastOptions = {}): Advice {
  if (view.actionSeat !== view.you.seat) throw new Error('Advice is available only on your turn')
  const actions = legalActions(view)
  if (actions.length === 0) throw new Error('No action available')
  const maxActions = options.maxActions ?? 24
  if (!Number.isInteger(maxActions) || maxActions < 1) throw new Error('Invalid action budget')
  const candidates = [...actions].sort((left, right) => actionCost(view, left) - actionCost(view, right)).slice(0, maxActions)
  const belief = sampleBelief(view, options)
  const alternatives = candidates.map((action) => ({ action, forecast: evaluate(view, belief, options, action) }))
  alternatives.sort((left, right) => left.forecast.probabilities[view.you.seat] - right.forecast.probabilities[view.you.seat]
    || actionCost(view, left.action) - actionCost(view, right.action))
  return { recommendation: alternatives[0]!.action, alternatives, legalActionCount: actions.length, evaluatedActionCount: alternatives.length, selfPolicy: options.selfPolicy ?? 'careful' }
}