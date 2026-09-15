import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyCommand, buildDeck, shuffle, validateFollow, validateLead, viewFor } from '@cucumber/game-engine'
import { actionKey, advisorCommand, legalActions, rankSelections } from '../../packages/game-engine/src/advisor/actions.ts'
import { preferredAction, policyProbabilities } from '../../packages/game-engine/src/advisor/policy.ts'
import { advisorRng } from '../../packages/game-engine/src/advisor/random.ts'
import { trickTable } from '../helpers/trick.ts'
import { ctx } from '../helpers/match.ts'

test('rank selections cover every legal subset without suit-equivalent duplicates', () => {
  const rng = advisorRng(19203)
  for (let sample = 0; sample < 150; sample++) {
    const hand = shuffle(buildDeck(), rng).slice(0, 8)
    const count = 1 + rng(6)
    const brute = new Set<string>()
    for (let mask = 0; mask < 1 << hand.length; mask++) {
      const cards = hand.filter((_, index) => (mask & (1 << index)) !== 0)
      if (cards.length === count) brute.add(actionKey({ type: 'PLAY_CARDS', cards }))
    }
    const actions = rankSelections(hand, count).map((cards) => actionKey({ type: 'PLAY_CARDS', cards }))
    assert.equal(actions.length, new Set(actions).size)
    assert.deepEqual(new Set(actions), brute)
  }
})

test('all enumerated leads and follows pass engine validation', () => {
  const state = trickTable({ 1: ['2C', 'KC', 'KD'], 2: ['3C', '4C', '7C'], 3: ['3D', '7D', '7H'] })
  const view = viewFor(state, 1)
  for (const action of legalActions(view)) {
    assert.equal(action.type, 'PLAY_CARDS')
    if (!('cards' in action)) continue
    validateLead(view.you.hand, action.cards)
    const after = applyCommand(state, 1, advisorCommand(view, action), ctx()).state
    const follower = viewFor(after, 2)
    for (const response of legalActions(follower)) {
      if ('cards' in response) validateFollow(follower.you.hand, follower.trick!.targetCards, response.cards)
    }
  }
  assert.equal(actionKey(preferredAction(view, 'careful')), 'PLAY_CARDS:12,12')
})

test('careful policy does not voluntarily retain a seven at the final lead or follow', () => {
  const state = trickTable({ 1: ['2C', '7C'], 2: ['2D', '7D'], 3: ['3H', '4H'] })
  const view = viewFor(state, 1)
  assert.equal(actionKey(preferredAction(view, 'careful')), 'PLAY_CARDS:14')
  const after = applyCommand(state, 1, advisorCommand(view, { type: 'PLAY_CARDS', cards: ['2C'] }), ctx()).state
  assert.equal(actionKey(preferredAction(viewFor(after, 2), 'careful')), 'PLAY_CARDS:14')
})

test('each opponent policy defines a normalized probability distribution', () => {
  const view = viewFor(trickTable({ 1: ['2C', 'KC', 'KD'], 2: ['3C', '4C', '7C'], 3: ['3D', '7D', '7H'] }), 1)
  const probabilities = legalActions(view).map((action) => policyProbabilities(view, action))
  for (const index of [0, 1, 2]) {
    assert(Math.abs(probabilities.reduce((sum, values) => sum + values[index]!, 0) - 1) < 1e-12)
  }
})