import { IllegalMoveError, seatOfUser, viewFor } from '@cucumber/game-engine'
import type { ClientCommand, MatchState, ServerMessage } from '@cucumber/shared'
import { clientMessageSchema } from './commandSchema.ts'
import {
  NotSeatedError,
  VersionConflictError,
  applyPlayerCommand,
  loadState,
  markConnection,
  roomFor,
} from './matchService.ts'

/**
 * What the match needs from a connection: enough to hand a client its view and
 * hear its commands. A `ws` socket satisfies it; so does an in-process one,
 * which is how the computer players attach without any of the rules path
 * knowing they are not browsers.
 */
export interface ClientSocket {
  readonly OPEN: number
  readyState: number
  send(data: string): void
  on(event: 'message', listener: (raw: Buffer) => void): unknown
  on(event: 'close', listener: () => void): unknown
}

interface Client {
  socket: ClientSocket
  userId: string
  matchId: string
}

const clients = new Set<Client>()

function send(socket: ClientSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message))
}

function clientsFor(matchId: string): Client[] {
  return [...clients].filter((client) => client.matchId === matchId)
}

/** Every client gets its own sanitised projection — never a shared payload. */
async function broadcast(matchId: string, state: MatchState | null): Promise<void> {
  const audience = clientsFor(matchId)
  if (audience.length === 0) return
  if (!state) {
    const room = await roomFor(matchId)
    for (const client of audience) {
      send(client.socket, { type: 'ROOM_WAITING', room })
    }
    return
  }
  for (const client of audience) {
    const seat = seatOfUser(state, client.userId)
    if (!seat) continue
    send(client.socket, { type: 'STATE_UPDATED', view: viewFor(state, seat) })
  }
}

export async function pushCurrentState(matchId: string): Promise<void> {
  await broadcast(matchId, await loadState(matchId))
}

export async function registerClient(
  socket: ClientSocket,
  userId: string,
  matchId: string,
): Promise<void> {
  const client: Client = { socket, userId, matchId }
  clients.add(client)

  const state = await markConnection(matchId, userId, 'ONLINE')
  await broadcast(matchId, state ?? (await loadState(matchId)))

  socket.on('message', (raw: Buffer) => {
    void handleMessage(client, raw)
  })

  socket.on('close', () => {
    clients.delete(client)
    void (async () => {
      // Other tabs of the same player keep the seat online.
      const stillHere = clientsFor(matchId).some((other) => other.userId === userId)
      if (stillHere) return
      const next = await markConnection(matchId, userId, 'OFFLINE')
      await broadcast(matchId, next ?? (await loadState(matchId)))
    })()
  })
}

async function handleMessage(client: Client, raw: Buffer): Promise<void> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.toString())
  } catch {
    send(client.socket, { type: 'ERROR', code: 'BAD_JSON', reason: 'Malformed message.' })
    return
  }

  const result = clientMessageSchema.safeParse(parsed)
  if (!result.success) {
    send(client.socket, { type: 'ERROR', code: 'BAD_COMMAND', reason: 'Unrecognised command.' })
    return
  }

  const message = result.data
  if (message.type === 'RESYNC') {
    const state = await loadState(client.matchId)
    if (!state) {
      send(client.socket, { type: 'ROOM_WAITING', room: await roomFor(client.matchId) })
      return
    }
    const seat = seatOfUser(state, client.userId)
    if (seat) send(client.socket, { type: 'STATE_UPDATED', view: viewFor(state, seat) })
    return
  }

  const command = message as ClientCommand
  if (command.matchId !== client.matchId) {
    send(client.socket, {
      type: 'PLAY_REJECTED',
      actionId: command.actionId,
      code: 'WRONG_MATCH',
      reason: 'That command is for a different match.',
    })
    return
  }

  try {
    const outcome = await applyPlayerCommand(client.matchId, client.userId, command)
    // A duplicate is not an error: resend the current truth and move on.
    await broadcast(client.matchId, outcome.state)
  } catch (error) {
    const rejection = describe(error, command)
    send(client.socket, rejection)
    // Re-sync the offender so their view cannot drift after a rejection.
    const state = await loadState(client.matchId)
    if (state) {
      const seat = seatOfUser(state, client.userId)
      if (seat) send(client.socket, { type: 'STATE_UPDATED', view: viewFor(state, seat) })
    }
  }
}

function describe(error: unknown, command: ClientCommand): ServerMessage {
  if (error instanceof IllegalMoveError) {
    return { type: 'PLAY_REJECTED', actionId: command.actionId, code: error.code, reason: error.message }
  }
  if (error instanceof VersionConflictError) {
    return {
      type: 'PLAY_REJECTED',
      actionId: command.actionId,
      code: 'VERSION_CONFLICT',
      reason: error.message,
    }
  }
  if (error instanceof NotSeatedError) {
    return { type: 'PLAY_REJECTED', actionId: command.actionId, code: 'NOT_SEATED', reason: error.message }
  }
  return {
    type: 'PLAY_REJECTED',
    actionId: command.actionId,
    code: 'SERVER_ERROR',
    reason: 'The server could not apply that action.',
  }
}
