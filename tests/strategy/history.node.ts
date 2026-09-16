import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyCommand, buildDeck, viewFor } from '@cucumber/game-engine'
import { SEATS, type CardId, type MatchState, type Seat } from '@cucumber/shared'
import { advise, canMeet, classOf, emptyMemory, informationFrom, sampleFullWorld, xorshift } from '@cucumber/strategy'
import { playOutHand } from '../helpers/autoplay.ts'
import { command, ctx, startedMatch } from '../helpers/match.ts'
import { trickTable } from '../helpers/trick.ts'

function historyFixture(plays = 6) {
  let state = startedMatch(973)
  const deck = buildDeck()
  state.dealerSeat = 1
  state.hands = {
    1: deck.filter((card) => card.endsWith('S')),
    2: [...deck.filter((card) => card.endsWith('D') && card !== '7D' && card !== 'AD'), '2C', '3C'],
    3: [...deck.filter((card) => card.endsWith('C') && card !== '2C' && card !== '3C'), '2H', '3H'],
  }
  const dealt = new Set(Object.values(state.hands).flat())
  state.stock = deck.filter((card) => !dealt.has(card))
  assert.equal(dealt.size, 39)
  state = applyCommand(state, 1, command({ type: 'SELECT_EXCHANGE_SIZE', size: 0 }), ctx()).state
  const actions: [Seat, CardId][] = [[1, 'AS'], [2, '2D'], [3, '7C'], [3, '4C'], [1, '4S'], [2, '4D']]
  for (const [seat, card] of actions.slice(0, plays)) {
    state = applyCommand(state, seat, command({ type: 'PLAY_CARDS', cards: [card] }), ctx()).state
  }
  return state
}

test('strategy uses current public failures without exposing hidden cards', () => {
  const state = historyFixture(2)
  const view = viewFor(state, 3)
  const info = informationFrom(view, emptyMemory())
  assert.deepEqual(info.failures, [[], [[classOf('AS')]], []])
  assert.equal(info.played[classOf('AS')], 1)
  assert.equal(info.played[classOf('2D')], 1)
  const hidden = structuredClone(state)
  const saved = hidden.hands[1][0]!
  hidden.hands[1][0] = hidden.stock[0]!
  hidden.stock[0] = saved
  assert.deepEqual(viewFor(hidden, 3), view)
  assert.deepEqual(informationFrom(viewFor(hidden, 3), emptyMemory()), info)
})

test('strategy retains a public failure after later tricks complete', () => {
  const state = historyFixture()
  const view = viewFor(state, 3)
  assert.equal(view.trick!.plays.length, 0)
  assert.equal(view.lastTrick!.plays.every((play) => play.successful), true)
  const info = informationFrom(view, emptyMemory())
  assert.deepEqual(info.failures, [[], [[classOf('AS')]], []])
  assert.equal(info.played.reduce((total, count) => total + count, 0), 6)
})

test('completed history survives snapshots and contains only copied public cards', () => {
  const state = historyFixture()
  const restored = JSON.parse(JSON.stringify(state)) as MatchState
  for (const seat of SEATS) {
    const view = viewFor(restored, seat)
    assert.equal(view.historyComplete, true)
    assert.deepEqual(view.completedTricks, state.completedTricks)
    assert.deepEqual(view.completedTricks!.flatMap((trick) => trick.plays.flatMap((play) => play.cards)), state.played)
    const serialized = JSON.stringify(view)
    for (const other of SEATS.filter((candidate) => candidate !== seat)) {
      for (const card of state.hands[other]) assert.equal(serialized.includes(JSON.stringify(card)), false)
    }
    for (const card of state.stock) assert.equal(serialized.includes(JSON.stringify(card)), false)
    view.completedTricks![0]!.plays[0]!.cards.length = 0
  }
  assert.deepEqual(restored, state)
})

test('sampled worlds honor earlier failures', () => {
  const info = informationFrom(viewFor(historyFixture(), 3), emptyMemory())
  const random = xorshift(314159)
  const baselineRandom = xorshift(314159)
  let contradictedWithoutHistory = 0
  for (let trial = 0; trial < 128; trial++) {
    const world = sampleFullWorld(info, random)
    assert.equal(canMeet(world.hands[1], [classOf('AS')]), false)
    for (let seat = 0; seat < world.hands.length; seat++) {
      assert.equal(world.hands[seat]!.reduce((total, count) => total + count, 0), info.handSizes[seat])
    }
    const baseline = sampleFullWorld({ ...info, failures: undefined }, baselineRandom)
    if (canMeet(baseline.hands[1], [classOf('AS')])) contradictedWithoutHistory++
  }
  assert(contradictedWithoutHistory > 0)
})

test('completed multi-card failures preserve the last successful target', () => {
  let state = trickTable({
    1: ['8S', '8D', '2C', '3C'],
    2: ['KS', 'KD', '4D', '5D'],
    3: ['2H', '3H', 'QH', 'AH'],
  })
  for (const [seat, cards] of [[1, ['8S', '8D']], [2, ['KS', 'KD']], [3, ['2H', '3H']]] as [Seat, CardId[]][]) {
    state = applyCommand(state, seat, command({ type: 'PLAY_CARDS', cards }), ctx()).state
  }
  const info = informationFrom(viewFor(state, 1), emptyMemory())
  const target = [classOf('KS'), classOf('KD')]
  assert.deepEqual(info.failures, [[], [], [target]])
  const random = xorshift(8675309)
  let worldsWithAce = 0
  for (let trial = 0; trial < 128; trial++) {
    const world = sampleFullWorld(info, random)
    assert.equal(canMeet(world.hands[2], target), false)
    if (world.hands[2][classOf('AH')]! > 0) worldsWithAce++
  }
  assert(worldsWithAce > 0, 'Failing a pair does not rule out holding one Ace')
})

test('legacy snapshots retain recent evidence without claiming complete history', () => {
  let state = historyFixture(3)
  delete state.completedTricks
  const view = viewFor(state, 3)
  assert.equal(view.historyComplete, false)
  assert.deepEqual(view.completedTricks, [state.lastTrick])
  assert.deepEqual(informationFrom(view, emptyMemory()).failures, [[], [[classOf('AS')]], []])
  state = applyCommand(state, 3, command({ type: 'PLAY_CARDS', cards: ['4C'] }), ctx()).state
  assert.equal(state.completedTricks, undefined)
  const olderView = viewFor(state, 1)
  delete olderView.completedTricks
  delete olderView.historyComplete
  assert.deepEqual(informationFrom(olderView, emptyMemory()).failures, [[], [[classOf('AS')]], []])
})

test('starting a new hand or match clears public failure history', () => {
  let state = playOutHand(historyFixture(), ctx())
  assert(state.completedTricks!.length > 1)
  if (state.phase === 'MATCH_OVER') {
    state = applyCommand(state, 1, command({ type: 'START_NEXT_MATCH' }), ctx()).state
    assert.deepEqual(state.completedTricks, [])
  } else assert.equal(state.phase, 'FINAL_REVEAL')
  for (const seat of SEATS) state = applyCommand(state, seat, command({ type: 'READY', ready: true }), ctx()).state
  assert.equal(state.phase, 'EXCHANGE_SIZE_SELECTION')
  assert.deepEqual(state.completedTricks, [])
  const view = viewFor(state, 1)
  assert.equal(view.historyComplete, true)
  assert.deepEqual(informationFrom(view, emptyMemory()).failures, [[], [], []])
})

test('the existing advisor consumes retained history and stays view-only', () => {
  const state = historyFixture(3)
  const view = viewFor(state, 3)
  const before = structuredClone(view)
  const options = { worlds: 8, maxActions: 4, seed: 42 }
  const advice = advise(view, emptyMemory(), options)
  assert.equal(advice.kind, 'PLAY')
  assert(advice.suggestions.length > 0)
  for (const suggestion of advice.suggestions) {
    const result = applyCommand(state, 3, command({ type: 'PLAY_CARDS', cards: suggestion.cards }), ctx())
    assert.equal(result.state.version, state.version + 1)
    assert(suggestion.winProbability >= 0 && suggestion.winProbability <= 1)
  }
  const hidden = structuredClone(state)
  const saved = hidden.hands[1][0]!
  hidden.hands[1][0] = hidden.stock[0]!
  hidden.stock[0] = saved
  assert.deepEqual(advise(viewFor(hidden, 3), emptyMemory(), options), advice)
  assert.deepEqual(view, before)
})