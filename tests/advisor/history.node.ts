import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyCommand, viewFor } from '@cucumber/game-engine'
import { command, ctx, startedMatch } from '../helpers/match.ts'
import { trickTable } from '../helpers/trick.ts'
import { runExchange } from '../helpers/autoplay.ts'

function stringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(stringValues)
  return []
}

test('public plays and outcomes survive snapshots without leaking private cards', () => {
  let state = trickTable({
    1: ['2C', '3C', '4C', '5C'],
    2: ['2D', '3D', '4D', '5D'],
    3: ['2H', '3H', '4H', '5H'],
  })
  for (const card of ['2C', '2D', '2H', '3H', '3C', '3D']) {
    state = applyCommand(state, state.trick!.actionSeat, command({ type: 'PLAY_CARDS', cards: [card] }), ctx()).state
  }
  state.stock = ['AS']
  const view = viewFor(structuredClone(state), 1)
  assert.deepEqual(view.played, ['2C', '2D', '2H', '3H', '3C', '3D'])
  assert.equal(view.completedTricks.length, 2)
  assert.equal(view.historyComplete, true)
  for (const card of ['AS', '4D', '5D', '4H', '5H']) assert(!stringValues(view).includes(card))
  view.played.pop()
  view.completedTricks[0]!.plays[0]!.cards.pop()
  assert.equal(state.played.length, 6)
  assert.equal(state.completedTricks![0]!.plays[0]!.cards.length, 1)
})

test('a player can remember only their own face-down discards', () => {
  const state = runExchange(startedMatch(777), 3, ctx())
  for (const seat of [1, 2, 3] as const) {
    const view = viewFor(state, seat)
    assert.deepEqual(view.you.discards, state.discardedBySeat![seat])
    assert.equal(view.you.discards.length, 3)
    assert.deepEqual(view.exchangeCounts, { 1: 3, 2: 3, 3: 3 })
    for (const other of [1, 2, 3] as const) {
      if (other === seat) continue
      for (const card of state.discardedBySeat![other]) assert(!stringValues(view).includes(card))
    }
    for (const card of state.stock) assert(!stringValues(view).includes(card))
  }
})

test('legacy snapshots explicitly report incomplete evidence', () => {
  const state = startedMatch()
  delete state.completedTricks
  delete state.discardedBySeat
  delete state.exchangeCounts
  const view = viewFor(state, 1)
  assert.equal(view.historyComplete, false)
  assert.deepEqual(view.you.discards, [])
  assert.equal(view.exchangeCounts, null)
})