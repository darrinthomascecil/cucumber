import {
  IllegalMoveError,
  applyCommand,
  createMatch,
  seatOfUser,
  setConnection,
  viewFor,
  type EngineEvent,
} from '@cucumber/game-engine'
import { db, type Prisma } from '@cucumber/database'
import type {
  ClientCommand,
  ConnectionStatus,
  MatchState,
  PlayerView,
  Room,
  RoomSeat,
  Seat,
} from '@cucumber/shared'
import { cryptoRng } from './rng.ts'

export class VersionConflictError extends Error {
  readonly currentVersion: number

  constructor(currentVersion: number) {
    super('That action was based on an out-of-date view of the match.')
    this.name = 'VersionConflictError'
    this.currentVersion = currentVersion
  }
}

export class NotSeatedError extends Error {
  constructor() {
    super('You are not seated in this match.')
  }
}

const SEAT_NUMBERS: Seat[] = [1, 2, 3]

function toState(value: Prisma.JsonValue): MatchState {
  return value as unknown as MatchState
}

function toJson(state: MatchState): Prisma.InputJsonValue {
  return state as unknown as Prisma.InputJsonValue
}

/**
 * V1 has a single private room (spec §36): one match in progress at a time,
 * with three fixed seats. A finished match stays available so the players can
 * start another without re-seating.
 */
export async function joinRoom(userId: string): Promise<Room> {
  return db().$transaction(async (tx) => {
    const existing = await tx.match.findFirst({
      where: { status: { in: ['LOBBY', 'ACTIVE'] } },
      orderBy: { createdAt: 'asc' },
      include: { players: { include: { user: true } } },
    })

    let match = existing
    if (!match) {
      const created = await tx.match.create({ data: {} })
      await tx.gameEvent.create({
        data: {
          matchId: created.id,
          sequence: 1,
          eventType: 'MATCH_CREATED',
          payloadJson: {},
        },
      })
      match = { ...created, players: [] }
    }

    const seated = match.players.find((player) => player.userId === userId)
    if (!seated) {
      const taken = new Set(match.players.map((player) => player.seat))
      const free = SEAT_NUMBERS.find((seat) => !taken.has(seat))
      if (free === undefined) throw new NotSeatedError()
      await tx.matchPlayer.create({
        data: { matchId: match.id, userId, seat: free },
      })
      await appendEvents(tx, match.id, userId, [
        { type: 'PLAYER_JOINED', seat: free, payload: {} },
      ])
      match = await tx.match.findUniqueOrThrow({
        where: { id: match.id },
        include: { players: { include: { user: true } } },
      })
    }

    // The third player to sit down deals the match into existence.
    const hasState = await tx.gameState.findUnique({ where: { matchId: match.id } })
    if (!hasState && match.players.length === 3) {
      const ordered = [...match.players].sort((a, b) => a.seat - b.seat)
      const state = createMatch(
        match.id,
        ordered.map((player) => ({
          userId: player.userId,
          displayName: player.user.displayName,
        })),
      )
      await tx.gameState.create({
        data: { matchId: match.id, version: state.version, stateJson: toJson(state) },
      })
    }

    return roomOf(match)
  })
}

type MatchWithPlayers = Prisma.MatchGetPayload<{
  include: { players: { include: { user: true } } }
}>

function roomOf(match: MatchWithPlayers): Room {
  const seats: RoomSeat[] = SEAT_NUMBERS.map((seat) => {
    const player = match.players.find((candidate) => candidate.seat === seat)
    return {
      seat,
      displayName: player?.user.displayName ?? null,
      userId: player?.userId ?? null,
      connected: player?.connectionStatus === 'ONLINE',
    }
  })
  return {
    matchId: match.id,
    stage: match.players.length === 3 ? 'MATCH' : 'SEATING',
    seats,
  }
}

export async function roomFor(matchId: string): Promise<Room> {
  const match = await db().match.findUniqueOrThrow({
    where: { id: matchId },
    include: { players: { include: { user: true } } },
  })
  return roomOf(match)
}

export async function loadState(matchId: string): Promise<MatchState | null> {
  const row = await db().gameState.findUnique({ where: { matchId } })
  return row ? toState(row.stateJson) : null
}

export async function viewOf(matchId: string, userId: string): Promise<PlayerView | null> {
  const state = await loadState(matchId)
  if (!state) return null
  const seat = seatOfUser(state, userId)
  if (!seat) return null
  return viewFor(state, seat)
}

type Tx = Prisma.TransactionClient

async function appendEvents(
  tx: Tx,
  matchId: string,
  actorUserId: string | null,
  events: EngineEvent[],
): Promise<void> {
  if (events.length === 0) return
  const last = await tx.gameEvent.findFirst({
    where: { matchId },
    orderBy: { sequence: 'desc' },
    select: { sequence: true },
  })
  let sequence = (last?.sequence ?? 0) + 1
  for (const event of events) {
    await tx.gameEvent.create({
      data: {
        matchId,
        sequence: sequence++,
        eventType: event.type,
        actorUserId,
        payloadJson: { seat: event.seat, ...event.payload } as Prisma.InputJsonValue,
      },
    })
  }
}

/** Keep the relational mirror of the snapshot in step (spec §40). */
async function syncMatchRows(tx: Tx, state: MatchState): Promise<void> {
  const status =
    state.phase === 'LOBBY' ? 'LOBBY' : state.phase === 'MATCH_OVER' ? 'COMPLETE' : 'ACTIVE'
  const match = await tx.match.findUniqueOrThrow({ where: { id: state.matchId } })
  await tx.match.update({
    where: { id: state.matchId },
    data: {
      status,
      stateVersion: state.version,
      currentHandNumber: state.handNumber,
      startedAt: status === 'ACTIVE' ? (match.startedAt ?? new Date()) : match.startedAt,
      finishedAt:
        status === 'COMPLETE' ? (match.finishedAt ?? new Date()) : status === 'LOBBY' ? null : match.finishedAt,
    },
  })
  for (const player of state.players) {
    await tx.matchPlayer.update({
      where: { matchId_seat: { matchId: state.matchId, seat: player.seat } },
      data: {
        score: player.score,
        ready: player.ready,
        connectionStatus: player.connected,
      },
    })
  }
}

export interface ApplyOutcome {
  state: MatchState
  duplicate: boolean
}

/**
 * Apply one player command. The version guard and the action ledger together
 * make this safe against double clicks, duplicate socket delivery, two open
 * tabs and replayed commands (spec §46).
 */
export async function applyPlayerCommand(
  matchId: string,
  userId: string,
  command: ClientCommand,
): Promise<ApplyOutcome> {
  return db().$transaction(async (tx) => {
    const row = await tx.gameState.findUnique({ where: { matchId } })
    if (!row) throw new NotSeatedError()

    const already = await tx.appliedAction.findUnique({
      where: { matchId_actionId: { matchId, actionId: command.actionId } },
    })
    if (already) {
      return { state: toState(row.stateJson), duplicate: true }
    }

    const previous = toState(row.stateJson)
    if (previous.version !== command.expectedVersion) {
      throw new VersionConflictError(previous.version)
    }

    const seat = seatOfUser(previous, userId)
    if (!seat) throw new NotSeatedError()

    const { state, events } = applyCommand(previous, seat, command, { rng: cryptoRng })

    const updated = await tx.gameState.updateMany({
      where: { matchId, version: previous.version },
      data: { version: state.version, stateJson: toJson(state) },
    })
    if (updated.count !== 1) throw new VersionConflictError(previous.version)

    await tx.appliedAction.create({
      data: { matchId, actionId: command.actionId, version: state.version },
    })
    await appendEvents(tx, matchId, userId, events)
    await syncMatchRows(tx, state)

    return { state, duplicate: false }
  })
}

/** Connection changes are not player moves, so they carry no expected version
 *  — but they still race each other. Re-read and retry when another writer
 *  moved the snapshot underneath us, or the update is silently lost. */
export async function markConnection(
  matchId: string,
  userId: string,
  connected: ConnectionStatus,
): Promise<MatchState | null> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const outcome = await db().$transaction(async (tx) => {
      const row = await tx.gameState.findUnique({ where: { matchId } })
      if (!row) {
        // Still seating: only the relational row exists.
        await tx.matchPlayer.updateMany({
          where: { matchId, userId },
          data: { connectionStatus: connected },
        })
        return { settled: true, state: null as MatchState | null }
      }
      const previous = toState(row.stateJson)
      const seat = seatOfUser(previous, userId)
      if (!seat) return { settled: true, state: null }
      if (previous.players.find((player) => player.seat === seat)?.connected === connected) {
        return { settled: true, state: previous }
      }

      const { state, events } = setConnection(previous, seat, connected, { rng: cryptoRng })
      const updated = await tx.gameState.updateMany({
        where: { matchId, version: previous.version },
        data: { version: state.version, stateJson: toJson(state) },
      })
      if (updated.count !== 1) return { settled: false, state: null }

      await appendEvents(tx, matchId, userId, events)
      await syncMatchRows(tx, state)
      return { settled: true, state }
    })

    if (outcome.settled) return outcome.state
    await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)))
  }
  throw new VersionConflictError(-1)
}

export { IllegalMoveError }
