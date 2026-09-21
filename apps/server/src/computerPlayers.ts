import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { db } from '@cucumber/database'
import type { ClientCommand, ClientMessage, ServerMessage } from '@cucumber/shared'
import { decideForSeat, type SeatMemory } from '@cucumber/strategy'
import { NotSeatedError, joinRoom, reserveSeatsFor } from './matchService.ts'
import { registerClient, type ClientSocket } from './realtime.ts'

/**
 * Computer players that live inside the server.
 *
 * Each one is an ordinary user in the database and an ordinary client of the
 * match: it is registered through the same `registerClient` the WebSocket
 * handler uses, receives nothing but its own sanitised view, and sends
 * commands that pass the same version guard and action ledger as a browser's.
 * The only difference is that the wire is an in-memory socket instead of a
 * network one. Nothing in the rules path knows or cares.
 *
 * They go wherever a person is: every open table with somebody at it gets the
 * computer players in its spare seats, so any number of people can each be
 * playing them at once. They come back after a restart, follow a person into a
 * fresh match, and never start the next match themselves.
 */
export interface ComputerPlayerOptions {
  /** Imagined deals per decision. */
  worlds: number
  /** Pause before acting, so a person watching can follow the play. */
  delayMs: number
  /** How often to check whether a person has opened a match without them. */
  pollMs: number
}

interface Log {
  info(msg: string): void
  warn(msg: string): void
}

/** The server's end of a socket that never touches the network. */
class InProcessSocket extends EventEmitter implements ClientSocket {
  readonly OPEN = 1
  readyState = 1
  private readonly inbox: (message: ServerMessage) => void

  constructor(inbox: (message: ServerMessage) => void) {
    super()
    this.inbox = inbox
  }

  /** Called by the server: what a browser would receive. */
  send(data: string): void {
    if (this.readyState !== this.OPEN) return
    const message = JSON.parse(data) as ServerMessage
    // Deliver asynchronously, as a network would, so the server finishes its
    // own bookkeeping before the player reacts.
    queueMicrotask(() => this.inbox(message))
  }

  /** Called by the player: what a browser would put on the wire. */
  push(message: ClientMessage): void {
    if (this.readyState !== this.OPEN) return
    this.emit('message', Buffer.from(JSON.stringify(message)))
  }

  close(): void {
    if (this.readyState !== this.OPEN) return
    this.readyState = 3
    this.emit('close')
  }
}

/** One computer player at one table. */
class ComputerSeat {
  readonly name: string
  private readonly userId: string
  private readonly matchId: string
  private readonly index: number
  private readonly options: ComputerPlayerOptions
  private readonly log: Log
  private socket: InProcessSocket | null = null
  private actedOn = -1
  private strikes = 0
  private memory: SeatMemory = { discarded: [] }
  private handNumber = 0
  private timer: NodeJS.Timeout | null = null

  constructor(
    user: ComputerUser,
    matchId: string,
    options: ComputerPlayerOptions,
    log: Log,
  ) {
    this.name = user.name
    this.userId = user.id
    this.index = user.index
    this.matchId = matchId
    this.options = options
    this.log = log
  }

  /** Sit down at this table (or sit back down, after a restart). */
  async attach(): Promise<void> {
    await joinRoom(this.userId, { matchId: this.matchId })
    const socket = new InProcessSocket((message) => this.receive(message))
    this.socket = socket
    await registerClient(socket, this.userId, this.matchId)
    socket.push({ type: 'RESYNC' })
    this.log.info(`${this.name} sat down`)
  }

  detach(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.socket?.close()
    this.socket = null
  }

  private receive(message: ServerMessage): void {
    const socket = this.socket
    if (!socket) return

    if (message.type === 'PLAY_REJECTED') {
      if (message.code === 'VERSION_CONFLICT') {
        // Somebody else's move landed first; the resync will show it.
        this.actedOn = -1
        return
      }
      this.strikes += 1
      this.log.warn(`${this.name} was refused: ${message.code} — ${message.reason}`)
      if (this.strikes >= 3) {
        // Refused three times on the same position: something is wrong with
        // the decision, not the timing. Stop rather than loop.
        this.log.warn(`${this.name} has stopped playing this position`)
        return
      }
      this.actedOn = -1
      socket.push({ type: 'RESYNC' })
      return
    }

    if (message.type !== 'STATE_UPDATED') return
    const view = message.view
    if (view.handNumber !== this.handNumber) {
      this.handNumber = view.handNumber
      this.memory = { discarded: [] }
    }
    if (view.version <= this.actedOn) return

    const decision = decideForSeat(view, this.memory, { worlds: this.options.worlds })
    if (!decision) return
    if (decision.type === 'SUBMIT_DISCARDS') this.memory.discarded.push(...decision.cards)
    this.actedOn = view.version
    this.strikes = 0

    const command = {
      ...decision,
      matchId: view.matchId,
      expectedVersion: view.version,
      actionId: randomBytes(8).toString('hex'),
    } as ClientCommand

    // A newer position makes a pending move stale; replace it rather than let
    // it go out and be refused. Seats are staggered so two computer players
    // reacting to one broadcast do not race each other into conflicts.
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(
      () => socket.push(command),
      this.options.delayMs + this.index * 250,
    )
  }
}

interface ComputerUser {
  id: string
  name: string
  index: number
}

/** Set once the computer players are running; a no-op until then. */
let tend: (() => void) | null = null

/** Ask the computer players to look round the tables now rather than soon. */
export function nudgeComputerPlayers(): void {
  tend?.()
}

/** Starts the named computer players. Returns a stop. */
export async function startComputerPlayers(
  names: string[],
  options: ComputerPlayerOptions,
  log: Log,
): Promise<() => void> {
  const users: ComputerUser[] = []
  for (const [index, name] of names.entries()) {
    const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@computer.local`
    const user = await db().user.upsert({
      where: { email },
      update: { displayName: name, status: 'ACTIVE', isAdmin: false, inviteHash: null },
      create: { email, displayName: name, status: 'ACTIVE', isAdmin: false },
    })
    users.push({ id: user.id, name, index })
  }
  reserveSeatsFor(users.map((user) => user.id))

  // One entry per computer player per table, kept for the life of the process:
  // a finished match still needs them the moment a person starts the next one.
  const seats = new Map<string, ComputerSeat>()
  const ids = new Set(users.map((user) => user.id))

  /**
   * Every open table with a person at it should have the computer players in
   * its spare seats. That covers all three ways they come to be missing: a
   * person has just sat down at a new table, the server has restarted, or a
   * finished match has been started again after one.
   */
  const lookRound = async (): Promise<void> => {
    const tables = await db().match.findMany({
      where: { status: { in: ['LOBBY', 'ACTIVE'] } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, players: { select: { userId: true } } },
    })
    for (const table of tables) {
      const people = table.players.filter((row) => !ids.has(row.userId)).length
      let occupied = table.players.length
      for (const user of users) {
        const key = `${table.id}:${user.id}`
        if (seats.has(key)) continue
        const alreadySeated = table.players.some((row) => row.userId === user.id)
        // Nobody to play with, or nowhere to sit.
        if (!alreadySeated && (people === 0 || occupied >= 3)) continue
        const seat = new ComputerSeat(user, table.id, options, log)
        try {
          await seat.attach()
          seats.set(key, seat)
          if (!alreadySeated) occupied += 1
        } catch (error) {
          seat.detach()
          if (!(error instanceof NotSeatedError)) throw error
        }
      }
    }
  }

  let busy = false
  let again = false
  const run = (): void => {
    if (busy) {
      again = true
      return
    }
    busy = true
    void lookRound()
      .catch((error) => {
        log.warn(`computer players could not look round the tables: ${(error as Error).message}`)
      })
      .finally(() => {
        busy = false
        if (again) {
          again = false
          run()
        }
      })
  }

  tend = run
  const timer = setInterval(run, options.pollMs)
  timer.unref()
  await lookRound()
  log.info(`computer players ready: ${names.join(', ')}`)

  return () => {
    clearInterval(timer)
    tend = null
    for (const seat of seats.values()) seat.detach()
    seats.clear()
    reserveSeatsFor([])
  }
}
