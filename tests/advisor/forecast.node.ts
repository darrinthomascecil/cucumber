import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyCommand, viewFor } from '@cucumber/game-engine'
import { forecastLoss } from '../../packages/game-engine/src/advisor/forecast.ts'
import { identityProbability } from '../../packages/game-engine/src/advisor/policy.ts'
import { expectedContinuation } from '../../packages/game-engine/src/advisor/simulation.ts'
import { brierScore, calibrate, fitCalibration, reliabilityBins } from '../../packages/game-engine/src/advisor/metrics.ts'
import { command, ctx, startedMatch } from '../helpers/match.ts'
import { chooseCards, runExchange } from '../helpers/autoplay.ts'
import { trickTable } from '../helpers/trick.ts'

test('tied card identities receive their correct subset probability', () => {
  assert.equal(identityProbability(['2C', '2D', '7C'], { type: 'PLAY_CARDS', cards: ['2C'] }), 0.5)
  assert.equal(identityProbability(['2C', '2D', '2H', '7C'], { type: 'PLAY_CARDS', cards: ['2C', '2D'] }), 1 / 3)
  assert.equal(identityProbability(['2C', '2D'], { type: 'PLAY_CARDS', cards: ['7C'] }), 0)
})

test('terminal integration is exact for all policy branches and joint losses', () => {
  const state = trickTable({ 1: ['2C', '7C'], 2: ['2D', '7D'], 3: ['3H', '4H'] })
  const policies = { 1: 'random', 2: 'random', 3: 'random' } as const
  const result = expectedContinuation(state, policies, 812, 0, { type: 'PLAY_CARDS', cards: ['2C'] })
  assert.equal(result[1], 1)
  assert.equal(result[2], 0.5)
  assert.equal(result[3], 0)
  assert.equal(result[1] + result[2] + result[3], 1.5)
})

test('Brier score and monotonic calibration respect binary marginal targets', () => {
  const rows = [
    { probability: 0.1, outcome: 0, match: 'one' },
    { probability: 0.4, outcome: 1, match: 'two' },
    { probability: 0.6, outcome: 0, match: 'three' },
    { probability: 0.9, outcome: 1, match: 'four' },
  ]
  assert(Math.abs(brierScore(rows) - 0.185) < 1e-12)
  const calibration = fitCalibration(rows)
  assert.deepEqual(calibration.values, [0, 0.5, 1])
  const fitted = rows.map((row) => calibrate(row.probability, calibration))
  assert.deepEqual(fitted, [0, 0.5, 0.5, 1])
  assert.equal(reliabilityBins(rows).reduce((sum, bin) => sum + bin.count, 0), 4)
  assert.throws(() => brierScore([]))
  assert.throws(() => brierScore([{ probability: 2, outcome: 0, match: 'bad' }]))
})

test('forecasts are deterministic, view-only and contain finite marginal probabilities', () => {
  let state = runExchange(startedMatch(973), 0, ctx())
  for (let turn = 0; turn < 30; turn++) {
    const seat = state.trick!.actionSeat
    state = applyCommand(state, seat, command({ type: 'PLAY_CARDS', cards: chooseCards(state, seat) }), ctx()).state
  }
  const seat = state.trick!.actionSeat
  const view = viewFor(state, seat)
  const options = { particles: 24, simulations: 32, maxAttempts: 4000, seed: 2013 }
  const first = forecastLoss(view, options)
  const hidden = structuredClone(state)
  hidden.stock.reverse()
  assert.deepEqual(viewFor(hidden, seat), view)
  assert.deepEqual(forecastLoss(viewFor(hidden, seat), options), first)
  for (const probability of Object.values(first.probabilities)) assert(probability >= 0 && probability <= 1)
  assert.equal(first.target, 'eventual-match-loss')
})

test('calibration aggregates tied forecasts before pooling adjacent violations', () => {
  const rows = [
    ...[1, 1, 1, 0, 0].map((outcome) => ({ probability: 0.1, outcome, match: 'low' })),
    ...[0, 1, 1, 1].map((outcome) => ({ probability: 0.2, outcome, match: 'high' })),
  ]
  assert.deepEqual(fitCalibration(rows).values, [0.6, 0.75])
  assert.deepEqual(fitCalibration([...rows].reverse()), fitCalibration(rows))
})