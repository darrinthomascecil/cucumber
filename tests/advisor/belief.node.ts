import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyCommand, buildDeck, viewFor } from '@cucumber/game-engine'
import { sampleBelief } from '../../packages/game-engine/src/advisor/belief.ts'
import { command, ctx, startedMatch } from '../helpers/match.ts'
import { chooseCards, runExchange } from '../helpers/autoplay.ts'

function observedState() {
  let state = runExchange(startedMatch(4321), 3, ctx())
  for (let turn = 0; turn < 15; turn++) {
    const seat = state.trick!.actionSeat
    state = applyCommand(state, seat, command({ type: 'PLAY_CARDS', cards: chooseCards(state, seat) }), ctx()).state
  }
  return state
}

test('sampled worlds conserve the deck and satisfy every public play', () => {
  const state = observedState()
  const view = viewFor(state, state.trick!.actionSeat)
  const belief = sampleBelief(view, { particles: 16, maxAttempts: 3000, seed: 903 })
  assert.equal(belief.particles.length, 16)
  assert(belief.effectiveSamples >= 1 - 1e-10)
  assert(Math.abs(belief.particles.reduce((sum, particle) => sum + particle.weight, 0) - 1) < 1e-10)
  for (const particle of belief.particles) {
    const sampled = particle.state
    const all = [...sampled.played, ...Object.values(sampled.hands).flat(), ...sampled.stock, ...sampled.discards]
    assert.equal(all.length, 54)
    assert.deepEqual([...new Set(all)].sort(), buildDeck().sort())
    assert.deepEqual(viewFor(sampled, view.you.seat), view)
    const replay = structuredClone(sampled)
    for (const seat of [1, 2, 3] as const) {
      replay.hands[seat].push(...sampled.completedTricks!.flatMap((trick) => trick.plays.filter((play) => play.seat === seat).flatMap((play) => play.cards)))
    }
    replay.played = []
    replay.completedTricks = []
    replay.lastTrick = null
    replay.trick = { leaderSeat: sampled.dealerSeat!, actionSeat: sampled.dealerSeat!, targetCards: [], targetSeat: null, successfulSeat: null, playCount: 0, plays: [] }
    let current = replay
    for (const trick of sampled.completedTricks!) {
      for (const play of trick.plays) current = applyCommand(current, play.seat, command({ type: 'PLAY_CARDS', cards: play.cards }), ctx()).state
    }
    assert.deepEqual(current.hands, sampled.hands)
  }
})

test('identical public views produce identical beliefs despite different hidden state', () => {
  const state = observedState()
  const seat = state.trick!.actionSeat
  const hidden = structuredClone(state)
  const other = hidden.players.find((player) => player.seat !== seat)!.seat
  const old = hidden.hands[other][0]!
  hidden.hands[other][0] = hidden.stock[0]!
  hidden.stock[0] = old
  const first = viewFor(state, seat)
  const second = viewFor(hidden, seat)
  assert.deepEqual(first, second)
  assert.deepEqual(sampleBelief(first, { particles: 8, seed: 173 }), sampleBelief(second, { particles: 8, seed: 173 }))
})

test('invalid budgets and incomplete history cause abstention, not fabricated probabilities', () => {
  const view = viewFor(observedState(), 1)
  assert.throws(() => sampleBelief(view, { particles: 0 }))
  assert.throws(() => sampleBelief(view, { policyPrior: [0, 0, 0] }))
  view.historyComplete = false
  assert.throws(() => sampleBelief(view), /history/)
})