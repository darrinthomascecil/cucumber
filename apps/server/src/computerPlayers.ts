import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { db } from '@cucumber/database'
import type { ClientCommand, ClientMessage, ServerMessage } from '@cucumber/shared'
import { decideForSeat, type SeatMemory } from '@cucumber/strategy'
import { NotSeatedError, joinRoom } from './matchService.ts'
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
 * They are meant for a table with one person at it. They fill whichever seats
 * are empty, sit through restarts (they are re-seated on boot), and follow a
 * person into a fresh match. They never start the next match themselves.
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

class ComputerPlayer {
  readonly userId: string
  readonly name: string
  private readonly index: number
  private readonly options: ComputerPlayerOptions
  private readonly log: Log
  private socket: InProcessSocket | null = null
  private matchId: string | null = null
  private actedOn = -1
  private strikes = 0
  private memory: SeatMemory = { discarded: [] }
  private handNumber = 0
  private timer: NodeJS.Timeout | null = null

  constructor(userId: string, name: string, index: number, options: ComputerPlayerOptions, log: Log) {
    this.userId = userId
    this.name = name
    this.index = index
    this.options = options
    this.log = log
  }

  /** Take a seat in the open match, if there is one to take. Idempotent. */
  async seat(): Promise<boolean> {
    let matchId: string
    try {
      matchId = (await joinRoom(this.userId)).matchId
    } catch (error) {
      if (error instanceof NotSeatedError) return false
      throw error
    }
    if (this.socket && this.matchId === matchId) return true

    this.leave()
    this.matchId = matchId
    const socket = new InProcessSocket((message) => this.receive(message))
    this.socket = socket
    await registerClient(socket, this.userId, matchId)
    socket.push({ type: 'RESYNC' })
    this.log.info(`${this.name} sat down`)
    return true
  }

  isSeatedIn(matchId: string): boolean {
    return this.socket !== null && this.matchId === matchId
  }

  leave(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.socket?.close()
    this.socket = null
    this.matchId = null
    this.actedOn = -1
    this.strikes = 0
    this.memory = { discarded: [] }
    this.handNumber = 0
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

/** Seats the named computer players and keeps them seated. Returns a stop. */
export async function startComputerPlayers(
  names: string[],
  options: ComputerPlayerOptions,
  log: Log,
): Promise<() => void> {
  const players: ComputerPlayer[] = []
  for (const [index, name] of names.entries()) {
    const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@computer.local`
    const user = await db().user.upsert({
      where: { email },
      update: { displayName: name, status: 'ACTIVE', isAdmin: false, inviteHash: null },
      create: { email, displayName: name, status: 'ACTIVE', isAdmin: false },
    })
    players.push(new ComputerPlayer(user.id, name, index, options, log))
  }

  for (const player of players) {
    if (!(await player.seat())) log.warn(`${player.name} found no free seat`)
  }

  let busy = false
  const timer = setInterval(() => {
    if (busy) return
    busy = true
    void followThePerson(players).catch((error) => {
      log.warn(`computer players could not check the table: ${(error as Error).message}`)
    }).finally(() => {
      busy = false
    })
  }, options.pollMs)
  timer.unref()

  return () => {
    clearInterval(timer)
    for (const player of players) player.leave()
  }
}

/**
 * A finished match is left where it lies — starting the next one is a
 * person's decision. But a person who reloads after a match has ended is
 * dealt a brand new match, one the computer players were never part of. Follow
 * them into it.
 */
async function followThePerson(players: ComputerPlayer[]): Promise<void> {
  const open = await db().match.findFirst({
    where: { status: { in: ['LOBBY', 'ACTIVE'] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, players: { select: { userId: true } } },
  })
  if (!open) return
  for (const player of players) {
    if (player.isSeatedIn(open.id)) continue
    if (open.players.some((row) => row.userId === player.userId)) {
      // Seated in the database but not connected: a restart, or a match it
      // was dealt into before it was running. Reconnect.
      await player.seat()
      continue
    }
    await player.seat()
  }
}
