import {
  SEATS,
  leftOf,
  type CardId,
  type ClientCommand,
  type GameEventType,
  type MatchState,
  type PlayerState,
  type Seat,
} from '@cucumber/shared'
import { buildDeck, deal, shuffle, type Rng } from './deck.js'
import { illegal } from './errors.js'
import { validateFollow, validateLead } from './legalMove.js'
import { computeHandResult } from './scoring.js'
import { applyFollow, applyLead, isTrickComplete, nextLeader, startTrick, trickCards } from './trick.js'

export const MAX_EXCHANGE = 5

export interface EngineEvent {
  type: GameEventType
  seat: Seat | null
  payload: Record<string, unknown>
}

export interface ApplyResult {
  state: MatchState
  events: EngineEvent[]
}

export interface EngineContext {
  rng: Rng
}

export interface SeatAssignment {
  userId: string
  displayName: string
}

function emptyHands(): Record<Seat, CardId[]> {
  return { 1: [], 2: [], 3: [] }
}

export function createMatch(matchId: string, seats: SeatAssignment[]): MatchState {
  if (seats.length !== 3) throw new Error('A match needs exactly three players')
  const players: PlayerState[] = seats.map((seat, index) => ({
    seat: (index + 1) as Seat,
    userId: seat.userId,
    displayName: seat.displayName,
    score: 0,
    ready: false,
    connected: 'OFFLINE',
  }))
  return {
    matchId,
    version: 0,
    phase: 'LOBBY',
    players,
    handNumber: 0,
    dealerSeat: null,
    hands: emptyHands(),
    stock: [],
    discards: [],
    played: [],
    exchange: null,
    trick: null,
    lastTrick: null,
    handResult: null,
    losers: [],
  }
}

export function playerAt(state: MatchState, seat: Seat): PlayerState {
  const player = state.players.find((candidate) => candidate.seat === seat)
  if (!player) throw new Error(`No player in seat ${seat}`)
  return player
}

export function seatOfUser(state: MatchState, userId: string): Seat | null {
  return state.players.find((player) => player.userId === userId)?.seat ?? null
}

/** The seat the match is currently waiting on, or null if it waits on everyone. */
export function actionSeat(state: MatchState): Seat | null {
  switch (state.phase) {
    case 'EXCHANGE_SIZE_SELECTION':
      return state.dealerSeat
    case 'EXCHANGE':
      return state.exchange ? (state.exchange.order[state.exchange.index] as Seat) : null
    case 'TRICK_PLAY':
      return state.trick?.actionSeat ?? null
    default:
      return null
  }
}

function clone(state: MatchState): MatchState {
  return structuredClone(state)
}

function assertPhase(state: MatchState, ...phases: MatchState['phase'][]): void {
  if (!phases.includes(state.phase)) {
    illegal('WRONG_PHASE', `That action is not available right now (${state.phase}).`)
  }
}

function assertTurn(state: MatchState, seat: Seat): void {
  const expected = actionSeat(state)
  if (expected !== seat) {
    illegal('NOT_YOUR_TURN', 'It is not your turn.')
  }
}

function removeCards(hand: CardId[], cards: readonly CardId[]): CardId[] {
  const remove = new Set(cards)
  return hand.filter((card) => !remove.has(card))
}

/** Deal a fresh hand and hand control to the dealer for the exchange decision. */
function beginHand(state: MatchState, dealerSeat: Seat, ctx: EngineContext): EngineEvent[] {
  const deck = shuffle(buildDeck(), ctx.rng)
  const dealt = deal(deck)
  state.handNumber += 1
  state.dealerSeat = dealerSeat
  state.hands = { 1: dealt.hands[0], 2: dealt.hands[1], 3: dealt.hands[2] }
  state.stock = dealt.stock
  state.discards = []
  state.played = []
  state.exchange = null
  state.trick = null
  state.lastTrick = null
  state.handResult = null
  state.phase = 'EXCHANGE_SIZE_SELECTION'
  for (const player of state.players) player.ready = false
  return [
    {
      type: 'HAND_DEALT',
      seat: dealerSeat,
      payload: { handNumber: state.handNumber, dealerSeat, stockCount: state.stock.length },
    },
  ]
}

function beginTrickPlay(state: MatchState): EngineEvent[] {
  state.exchange = null
  state.phase = 'TRICK_PLAY'
  state.trick = startTrick(state.dealerSeat as Seat)
  return []
}

/** Move the exchange on, or start trick play when everyone has acted. */
function advanceExchange(state: MatchState): EngineEvent[] {
  const exchange = state.exchange
  if (!exchange) return []
  const next = exchange.index + 1
  if (next >= exchange.order.length) {
    return beginTrickPlay(state)
  }
  state.exchange = { ...exchange, index: next, step: 'CHOICE', drawCount: 0 }
  return []
}

function drawForSeat(state: MatchState, seat: Seat, count: number): void {
  if (state.stock.length < count) {
    illegal('STOCK_EXHAUSTED', 'There are not enough cards left in the stock.')
  }
  const drawn = state.stock.slice(0, count)
  state.stock = state.stock.slice(count)
  state.hands[seat] = [...state.hands[seat], ...drawn]
}

/** A hand is over once every player is down to their final card (spec §25). */
function everyoneHasOneCard(state: MatchState): boolean {
  return SEATS.every((seat) => state.hands[seat].length === 1)
}

function finishHand(state: MatchState): EngineEvent[] {
  const finalCards = {
    1: state.hands[1][0] as CardId,
    2: state.hands[2][0] as CardId,
    3: state.hands[3][0] as CardId,
  } as Record<Seat, CardId>
  const scoresBefore = {
    1: playerAt(state, 1).score,
    2: playerAt(state, 2).score,
    3: playerAt(state, 3).score,
  } as Record<Seat, number>

  const result = computeHandResult(state.handNumber, finalCards, scoresBefore)
  for (const seat of SEATS) playerAt(state, seat).score = result.scoresAfter[seat]
  state.handResult = result
  state.trick = null
  state.phase = result.matchOver ? 'MATCH_OVER' : 'FINAL_REVEAL'
  state.losers = result.losers
  for (const player of state.players) player.ready = false

  const events: EngineEvent[] = [
    { type: 'FINAL_REVEAL', seat: null, payload: { finalCards } },
    { type: 'HAND_COMPLETED', seat: null, payload: { ...result } },
  ]
  if (result.matchOver) {
    events.push({
      type: 'MATCH_COMPLETED',
      seat: null,
      payload: { losers: result.losers, reason: result.reason },
    })
  }
  return events
}

function allReady(state: MatchState): boolean {
  return state.players.every((player) => player.ready)
}

function allConnected(state: MatchState): boolean {
  return state.players.every((player) => player.connected === 'ONLINE')
}

function handleReady(state: MatchState, seat: Seat, ready: boolean, ctx: EngineContext): EngineEvent[] {
  assertPhase(state, 'LOBBY', 'FINAL_REVEAL')
  playerAt(state, seat).ready = ready
  const events: EngineEvent[] = [{ type: 'PLAYER_READY', seat, payload: { ready } }]
  if (!allReady(state)) return events

  if (state.phase === 'LOBBY') {
    // Spec §8: three occupied seats, all connected, all ready.
    if (!allConnected(state)) return events
    const dealerSeat = (ctx.rng(3) + 1) as Seat
    events.push({ type: 'MATCH_STARTED', seat: null, payload: { dealerSeat } })
    events.push(...beginHand(state, dealerSeat, ctx))
    return events
  }

  // Everyone has read the reveal; rotate the deal clockwise and continue.
  events.push(...beginHand(state, leftOf(state.dealerSeat as Seat), ctx))
  return events
}

function handleExchangeSize(state: MatchState, seat: Seat, size: number, _ctx: EngineContext): EngineEvent[] {
  assertPhase(state, 'EXCHANGE_SIZE_SELECTION')
  assertTurn(state, seat)
  if (!Number.isInteger(size) || size < 0 || size > MAX_EXCHANGE) {
    illegal('BAD_EXCHANGE_SIZE', `The exchange quantity must be between 0 and ${MAX_EXCHANGE}.`)
  }
  const events: EngineEvent[] = [
    { type: 'EXCHANGE_SIZE_SELECTED', seat, payload: { size } },
  ]
  if (size === 0) {
    // Spec §10: nobody exchanges.
    events.push(...beginTrickPlay(state))
    return events
  }
  const dealer = state.dealerSeat as Seat
  state.phase = 'EXCHANGE'
  state.exchange = {
    size,
    order: [dealer, leftOf(dealer), leftOf(leftOf(dealer))],
    index: 0,
    step: 'DISCARD',
    drawCount: size,
  }
  // The dealer does not get the 0-or-N choice; they exchange exactly N.
  drawForSeat(state, dealer, size)
  events.push({ type: 'CARDS_DRAWN', seat: dealer, payload: { count: size } })
  return events
}

function handleSelectExchange(state: MatchState, seat: Seat, size: number): EngineEvent[] {
  assertPhase(state, 'EXCHANGE')
  assertTurn(state, seat)
  const exchange = state.exchange!
  if (exchange.step !== 'CHOICE') {
    illegal('WRONG_PHASE', 'You have already drawn; discard to finish your exchange.')
  }
  if (size !== 0 && size !== exchange.size) {
    illegal(
      'BAD_EXCHANGE_SIZE',
      `You may exchange 0 or ${exchange.size} cards — nothing in between.`,
    )
  }
  if (size === 0) {
    return [{ type: 'CARDS_EXCHANGED', seat, payload: { count: 0 } }, ...advanceExchange(state)]
  }
  state.exchange = { ...exchange, step: 'DISCARD', drawCount: size }
  drawForSeat(state, seat, size)
  return [{ type: 'CARDS_DRAWN', seat, payload: { count: size } }]
}

function handleSubmitDiscards(state: MatchState, seat: Seat, cards: CardId[]): EngineEvent[] {
  assertPhase(state, 'EXCHANGE')
  assertTurn(state, seat)
  const exchange = state.exchange!
  if (exchange.step !== 'DISCARD') {
    illegal('WRONG_PHASE', 'You have not drawn any cards to discard.')
  }
  if (cards.length !== exchange.drawCount) {
    illegal('WRONG_CARD_COUNT', `You must discard exactly ${exchange.drawCount} cards.`)
  }
  const hand = state.hands[seat]
  const seen = new Set<CardId>()
  for (const card of cards) {
    if (seen.has(card)) illegal('DUPLICATE_CARD', 'The same card was selected twice.')
    seen.add(card)
    if (!hand.includes(card)) illegal('NOT_IN_HAND', 'You cannot discard a card you do not hold.')
  }
  state.hands[seat] = removeCards(hand, cards)
  // Spec §11: discards are dead for the hand and never return to the stock.
  state.discards = [...state.discards, ...cards]
  return [
    { type: 'CARDS_EXCHANGED', seat, payload: { count: cards.length } },
    ...advanceExchange(state),
  ]
}

function handlePlayCards(state: MatchState, seat: Seat, cards: CardId[]): EngineEvent[] {
  assertPhase(state, 'TRICK_PLAY')
  assertTurn(state, seat)
  const trick = state.trick!
  const hand = state.hands[seat]
  const events: EngineEvent[] = []

  if (trick.plays.length === 0) {
    validateLead(hand, cards)
    state.hands[seat] = removeCards(hand, cards)
    state.trick = applyLead(trick, seat, cards)
    events.push({ type: 'CARDS_PLAYED', seat, payload: { cards, lead: true } })
  } else {
    const outcome = validateFollow(hand, trick.targetCards, cards)
    state.hands[seat] = removeCards(hand, cards)
    state.trick = applyFollow(trick, seat, cards, outcome === 'SUCCESS')
    events.push({
      type: outcome === 'SUCCESS' ? 'CARDS_PLAYED' : 'FORCED_LOW_PLAY',
      seat,
      payload: { cards, lead: false },
    })
  }

  const current = state.trick!
  if (!isTrickComplete(current)) return events

  const leader = nextLeader(current)
  state.played = [...state.played, ...trickCards(current)]
  state.lastTrick = current
  events.push({
    type: 'TRICK_COMPLETED',
    seat: leader,
    payload: { nextLeader: leader, plays: current.plays },
  })

  if (everyoneHasOneCard(state)) {
    events.push(...finishHand(state))
    return events
  }
  state.trick = startTrick(leader)
  return events
}

function handleStartNextMatch(state: MatchState): EngineEvent[] {
  assertPhase(state, 'MATCH_OVER')
  // Spec §31: scores reset, players stay seated, the next dealer is random again.
  for (const player of state.players) {
    player.score = 0
    player.ready = false
  }
  state.phase = 'LOBBY'
  state.handNumber = 0
  state.dealerSeat = null
  state.hands = emptyHands()
  state.stock = []
  state.discards = []
  state.played = []
  state.exchange = null
  state.trick = null
  state.lastTrick = null
  state.handResult = null
  state.losers = []
  return [{ type: 'MATCH_CREATED', seat: null, payload: { continuation: true } }]
}

/**
 * The single entry point for changing a match. Pure: it returns a new state
 * and the events that describe the change, and throws `IllegalMoveError`
 * rather than mutating anything when a command is rejected.
 */
export function applyCommand(
  previous: MatchState,
  seat: Seat,
  command: ClientCommand,
  ctx: EngineContext,
): ApplyResult {
  const state = clone(previous)
  let events: EngineEvent[]

  switch (command.type) {
    case 'READY':
      events = handleReady(state, seat, command.ready, ctx)
      break
    case 'SELECT_EXCHANGE_SIZE':
      events = handleExchangeSize(state, seat, command.size, ctx)
      break
    case 'SELECT_EXCHANGE':
      events = handleSelectExchange(state, seat, command.size)
      break
    case 'SUBMIT_DISCARDS':
      events = handleSubmitDiscards(state, seat, command.cards)
      break
    case 'PLAY_CARDS':
      events = handlePlayCards(state, seat, command.cards)
      break
    case 'START_NEXT_MATCH':
      events = handleStartNextMatch(state)
      break
    default:
      illegal('UNKNOWN_COMMAND', 'Unrecognised command.')
  }

  state.version = previous.version + 1
  return { state, events }
}

/** Connection changes are state too, but they are never a player's move. */
export function setConnection(
  previous: MatchState,
  seat: Seat,
  connected: 'ONLINE' | 'OFFLINE',
): ApplyResult {
  const state = clone(previous)
  playerAt(state, seat).connected = connected
  if (connected === 'OFFLINE' && state.phase === 'LOBBY') {
    playerAt(state, seat).ready = false
  }
  state.version = previous.version + 1
  return {
    state,
    events: [
      {
        type: connected === 'ONLINE' ? 'PLAYER_CONNECTED' : 'PLAYER_DISCONNECTED',
        seat,
        payload: {},
      },
    ],
  }
}
