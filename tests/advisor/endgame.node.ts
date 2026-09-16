import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { test } from 'node:test'
import { SEATS, type CardId, type PlayerView, type Seat } from '@cucumber/shared'
import { applyCommand, buildDeck, isSevenOrJoker, scoreValue, trickStrength, viewFor } from '@cucumber/game-engine'
import { forecastLoss } from '../../packages/game-engine/src/advisor/forecast.ts'
import { chooseCards, runExchange } from '../helpers/autoplay.ts'
import { command, ctx, startedMatch } from '../helpers/match.ts'

function fixture() {
  let state = runExchange(startedMatch(973), 0, ctx())
  state.handNumber = 4
  for (const player of state.players) player.score = 20
  for (let turn = 0; turn < 35; turn++) {
    const seat = state.trick!.actionSeat
    state = applyCommand(state, seat, command({ type: 'PLAY_CARDS', cards: chooseCards(state, seat) }), ctx()).state
  }
  const seat = state.trick!.actionSeat
  return { state, view: viewFor(state, seat), cards: chooseCards(state, seat) }
}

function randomSingleChance(hand: CardId[], card: CardId, target: CardId | undefined, successful: boolean): number {
  if (!hand.includes(card) || hand.length < 2) return 0
  const counts = new Map<number, number>()
  for (const held of hand) counts.set(trickStrength(held), (counts.get(trickStrength(held)) ?? 0) + 1)
  const strength = trickStrength(card)
  if (!target) {
    if (!successful) return 0
    const actions = [...counts.values()].reduce((sum, count) => sum + Math.min(count, hand.length - 1), 0)
    return 1 / (actions * counts.get(strength)!)
  }
  const qualifying = [...counts.keys()].filter((value) => value >= trickStrength(target))
  if (qualifying.length > 0) return successful && qualifying.includes(strength) ? 1 / (qualifying.length * counts.get(strength)!) : 0
  return !successful && strength === Math.min(...counts.keys()) ? 1 / counts.get(strength)! : 0
}

function reference(view: PlayerView, cards: CardId[]) {
  // The fixture is an exact-enumeration position, which the belief model only
  // accepts when history is complete — so the field is present here.
  const tricks = [...view.completedTricks!, view.trick!]
  const plays = tricks.flatMap((trick) => trick.plays)
  const known = new Set([...view.you.hand, ...plays.flatMap((play) => play.cards)])
  const unseen = buildDeck().filter((card) => !known.has(card))
  const others = SEATS.filter((seat) => seat !== view.you.seat)
  const kept = view.you.hand.filter((card) => !cards.includes(card))
  assert.equal(kept.length, 1)
  assert.equal(unseen.length, 17)
  assert(SEATS.every((seat) => view.players.find((player) => player.seat === seat)!.score === 20))
  const probabilities = { 1: 0, 2: 0, 3: 0 }
  let totalWeight = 0
  let assignments = 0
  let consistentAssignments = 0
  for (const first of unseen) {
    for (const second of unseen) {
      if (first === second) continue
      assignments++
      const finals = { [view.you.seat]: kept[0]!, [others[0]!]: first, [others[1]!]: second } as Record<Seat, CardId>
      const hands = {} as Record<Seat, CardId[]>
      for (const seat of SEATS) hands[seat] = [
        ...plays.filter((play) => play.seat === seat).flatMap((play) => play.cards),
        ...(seat === view.you.seat ? view.you.hand : [finals[seat]]),
      ]
      let weight = 1
      for (const trick of tricks) {
        let target: CardId | undefined
        for (const play of trick.plays) {
          assert.equal(play.cards.length, 1)
          const chance = randomSingleChance(hands[play.seat], play.cards[0]!, target, play.successful)
          if (chance === 0) weight = 0
          else if (play.seat !== view.you.seat) weight *= chance
          hands[play.seat] = hands[play.seat].filter((card) => card !== play.cards[0])
          if (play.successful) target = play.cards[0]
        }
      }
      if (weight === 0) continue
      consistentAssignments++
      totalWeight += weight
      const instant = SEATS.filter((seat) => isSevenOrJoker(finals[seat]))
      const highest = Math.max(...SEATS.map((seat) => scoreValue(finals[seat])))
      const losers = instant.length > 0 ? instant : SEATS.filter((seat) => scoreValue(finals[seat]) === highest)
      for (const seat of losers) probabilities[seat] += weight
    }
  }
  assert(totalWeight > 0)
  for (const seat of SEATS) probabilities[seat] /= totalWeight
  return { probabilities, assignments, consistentAssignments }
}

test('closing forecast agrees with an independent exhaustive reference', { timeout: 15000 }, () => {
  const { view, cards } = fixture()
  const referenceStart = performance.now()
  const exact = reference(view, cards)
  const referenceMs = performance.now() - referenceStart
  assert.equal(exact.assignments, 272)
  assert(Object.values(exact.probabilities).some((value) => value > 0.01 && value < 0.99))
  const forecastStart = performance.now()
  const forecast = forecastLoss(view, {
    model: 'history', policyPrior: [0, 0, 1], exploration: 0,
    particles: 128, simulations: 256, maxAttempts: 4096, seed: 20260914,
  }, { type: 'PLAY_CARDS', cards })
  const forecastMs = performance.now() - forecastStart
  const maximumError = Math.max(...SEATS.map((seat) => Math.abs(exact.probabilities[seat] - forecast.probabilities[seat])))
  assert.equal(forecast.method, 'exact-final')
  assert.equal(forecast.simulations, 0)
  assert.equal(forecast.attempts, 272)
  assert(maximumError < 1e-12, `Maximum probability error: ${maximumError}`)
  const oracleBrierRisk = SEATS.reduce((sum, seat) => sum + exact.probabilities[seat] * (1 - exact.probabilities[seat]), 0) / SEATS.length
  const excessBrierRisk = SEATS.reduce((sum, seat) => sum + (forecast.probabilities[seat] - exact.probabilities[seat]) ** 2, 0) / SEATS.length
  console.log('ENDGAME_CHECK ' + JSON.stringify({
    target: 'eventual-match-loss', opponentPolicy: 'uniform rank-equivalent actions, uniform tied identities',
    observer: view.you.seat, hand: view.you.hand, proposedPlay: cards, scores: view.players.map((player) => ({ seat: player.seat, score: player.score })),
    ...exact, method: forecast.method, forecast: forecast.probabilities, maximumError, referenceMs, forecastMs,
    attempts: forecast.attempts, effectiveParticles: forecast.effectiveParticles, oracleBrierRisk, excessBrierRisk,
  }))
})

test('exact closing probabilities depend on the player view, not hidden cards or Monte Carlo settings', { timeout: 15000 }, () => {
  const { state, view, cards } = fixture()
  const options = { model: 'history', policyPrior: [0, 0, 1], exploration: 0, particles: 1, simulations: 1, maxAttempts: 1, seed: 1 } as const
  const action = { type: 'PLAY_CARDS', cards } as const
  const first = forecastLoss(view, options, action)
  const hidden = structuredClone(state)
  const other = SEATS.find((seat) => seat !== view.you.seat)!
  const saved = hidden.hands[other][0]!
  hidden.hands[other][0] = hidden.stock[0]!
  hidden.stock[0] = saved
  const secondView = viewFor(hidden, view.you.seat)
  assert.deepEqual(secondView, view)
  const second = forecastLoss(secondView, {
    ...options, seed: 999, particles: 8, simulations: 16, maxAttempts: 32,
    calibration: { thresholds: [0, 1], values: [0, 0], blend: 1 },
  }, action)
  assert.equal(first.method, 'exact-final')
  assert.equal(second.method, 'exact-final')
  assert.deepEqual(second.probabilities, first.probabilities)
  assert.deepEqual(second.rawProbabilities, first.rawProbabilities)
  assert.equal(second.attempts, 272)
  assert.equal(second.simulations, 0)
})