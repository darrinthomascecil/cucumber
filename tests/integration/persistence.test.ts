import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@cucumber/database'
import type { PlayerView, Seat } from '@cucumber/shared'
import { nextCommand } from '../helpers/clientPlayer.ts'
import {
  ServerHandle,
  TestClient,
  delay,
  joinRoom,
  prepareDatabase,
  redeem,
  resetTables,
  seedInvitee,
  testDb,
} from '../helpers/server.ts'

let prisma: PrismaClient
let server: ServerHandle

const people = [
  { email: 'alice@example.com', name: 'Alice' },
  { email: 'bob@example.com', name: 'Bob' },
  { email: 'charlie@example.com', name: 'Charlie' },
]

beforeAll(async () => {
  await prepareDatabase()
  prisma = testDb()
}, 180_000)

afterAll(async () => {
  await server?.kill()
  await prisma?.$disconnect()
})

beforeEach(async () => {
  await server?.kill()
  await resetTables(prisma)
  server = await ServerHandle.start()
}, 120_000)

async function seatThreePlayers() {
  const cookies: string[] = []
  for (const person of people) {
    const token = await seedInvitee(prisma, person.email, person.name)
    const cookie = await redeem(token)
    await joinRoom(cookie)
    cookies.push(cookie)
  }
  const clients = []
  for (const cookie of cookies) clients.push(await TestClient.connect(cookie))
  return { cookies, clients }
}

/** Drive the table until it reaches a phase we want to stop at. */
async function playUntil(
  clients: TestClient[],
  stop: (view: PlayerView) => boolean,
  limit = 400,
): Promise<void> {
  for (let step = 0; step < limit; step++) {
    const anyView = clients.find((client) => client.view)?.view
    if (anyView && stop(anyView)) return
    let acted = false
    for (const client of clients) {
      const view = client.view
      if (!view) continue
      if (stop(view)) return
      const command = nextCommand(view)
      if (!command) continue
      client.send(command)
      acted = true
      await delay(40)
      break
    }
    if (!acted) await delay(40)
  }
  const diagnostics = clients.map((client) => ({
    seat: client.view?.you.seat,
    phase: client.view?.phase,
    prompt: client.view?.prompt,
    version: client.view?.version,
    rejections: client.rejections,
  }))
  throw new Error(`Never reached the target phase: ${JSON.stringify(diagnostics, null, 2)}`)
}

describe('sign-in and seating', () => {
  it('refuses an unknown invitation token', async () => {
    const response = await fetch('http://127.0.0.1:8099/api/auth/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'not-a-real-token' }),
    })
    expect(response.status).toBe(400)
  })

  it('refuses an invitation that has already been used', async () => {
    const token = await seedInvitee(prisma, 'dora@example.com', 'Dora')
    await redeem(token)
    const second = await fetch('http://127.0.0.1:8099/api/auth/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    expect(second.status).toBe(400)
  })

  it('rejects a websocket with no session', async () => {
    const { default: WebSocket } = await import('ws')
    const socket = new WebSocket('ws://127.0.0.1:8099/ws')
    const code = await new Promise<number>((resolve) => {
      socket.on('close', (value: number) => resolve(value))
      socket.on('error', () => resolve(-1))
    })
    expect(code).toBe(4401)
  })

  it('waits for three players before dealing', async () => {
    const first = await seedInvitee(prisma, 'alice@example.com', 'Alice')
    const cookie = await redeem(first)
    await joinRoom(cookie)
    const client = await TestClient.connect(cookie)
    await delay(200)
    expect(client.view).toBeNull()
    expect(client.room?.stage).toBe('SEATING')
    expect(client.room?.seats.filter((seat) => seat.userId).length).toBe(1)
    await client.close()
  })

  it('deals once the third player sits down and everyone is ready', async () => {
    const { clients } = await seatThreePlayers()
    // Wait for presence to settle so each Ready is built on a current version.
    for (const client of clients) {
      await client.waitFor(
        (view) => view.phase === 'LOBBY' && view.players.every((p) => p.connected === 'ONLINE'),
      )
    }
    for (const client of clients) {
      const command = nextCommand(client.view as PlayerView)
      if (command) client.send(command)
      await delay(120)
    }
    const view = await clients[0]!.waitFor((v) => v.phase === 'EXCHANGE_SIZE_SELECTION')
    expect(view.you.hand).toHaveLength(13)
    expect(view.stockCount).toBe(15)
    expect(view.players.every((player) => player.cardCount === 13)).toBe(true)
    for (const client of clients) await client.close()
  })
})

describe('presence', () => {
  it('keeps players present who sat down before the match existed', async () => {
    // The first two arrive while there is still nothing but chairs.
    const early = []
    for (const person of people.slice(0, 2)) {
      const token = await seedInvitee(prisma, person.email, person.name)
      const cookie = await redeem(token)
      await joinRoom(cookie)
      early.push(await TestClient.connect(cookie))
    }
    await delay(200)
    expect(early[0]!.room?.stage).toBe('SEATING')

    const lastPerson = people[2]!
    const lastToken = await seedInvitee(prisma, lastPerson.email, lastPerson.name)
    const lastCookie = await redeem(lastToken)
    await joinRoom(lastCookie)
    const last = await TestClient.connect(lastCookie)

    for (const client of [...early, last]) {
      const view = await client.waitFor(
        (v) => v.players.every((player) => player.connected === 'ONLINE'),
        'everyone present',
      )
      expect(view.players.map((player) => player.connected)).toEqual(['ONLINE', 'ONLINE', 'ONLINE'])
    }
    for (const client of [...early, last]) await client.close()
  }, 120_000)
})

describe('disconnect and resume', () => {
  it('survives an abrupt server restart mid-hand', async () => {
    const { cookies, clients } = await seatThreePlayers()
    await playUntil(clients, (view) => view.phase === 'TRICK_PLAY' && view.trick!.plays.length > 0)

    const before = clients.map((client) => client.view as PlayerView)
    const beforeVersion = before[0]!.version
    const beforeHands = before.map((view) => [...view.you.hand])
    const beforeTrick = JSON.stringify(before[0]!.trick)

    for (const client of clients) await client.close()
    await server.kill()

    // Nothing is held in memory: a brand new process reads the match back.
    server = await ServerHandle.start()
    const resumed: TestClient[] = []
    for (const cookie of cookies) resumed.push(await TestClient.connect(cookie))
    for (const client of resumed) client.send({ type: 'RESYNC' })

    for (const [index, client] of resumed.entries()) {
      const view = await client.waitFor((v) => v.handNumber > 0, `seat ${index + 1} resume`)
      expect(view.you.hand).toEqual(beforeHands[index])
      expect(view.phase).toBe('TRICK_PLAY')
      expect(view.handNumber).toBe(before[index]!.handNumber)
      // The version only moved for the reconnect bookkeeping.
      expect(view.version).toBeGreaterThanOrEqual(beforeVersion)
    }
    expect(JSON.stringify(resumed[0]!.view!.trick)).toBe(beforeTrick)

    // And play carries on from exactly where it stopped.
    await playUntil(resumed, (view) => view.phase === 'FINAL_REVEAL' || view.phase === 'MATCH_OVER')
    const final = resumed[0]!.view as PlayerView
    expect(final.handResult).not.toBeNull()
    for (const client of resumed) await client.close()
  }, 180_000)

  it('shows the others that a player has gone offline, and waits for them', async () => {
    const { cookies, clients } = await seatThreePlayers()
    await playUntil(clients, (view) => view.phase === 'TRICK_PLAY')

    const waitingOn = clients[0]!.view!.actionSeat as Seat
    const absent = clients.find((client) => client.view!.you.seat === waitingOn)!
    const watcher = clients.find((client) => client.view!.you.seat !== waitingOn)!
    await absent.close()

    const view = await watcher.waitFor(
      (v) => v.players.find((player) => player.seat === waitingOn)?.connected === 'OFFLINE',
      'offline notice',
    )
    // The match does not move on without them.
    expect(view.actionSeat).toBe(waitingOn)
    expect(view.phase).toBe('TRICK_PLAY')

    const back = await TestClient.connect(cookies[waitingOn - 1] as string)
    await watcher.waitFor(
      (v) => v.players.find((player) => player.seat === waitingOn)?.connected === 'ONLINE',
      'reconnect notice',
    )
    await back.close()
    for (const client of clients) await client.close().catch(() => {})
  }, 120_000)
})

describe('commands the server must refuse', () => {
  it('applies a replayed action only once', async () => {
    const { clients } = await seatThreePlayers()
    await playUntil(clients, (view) => view.phase === 'EXCHANGE_SIZE_SELECTION')
    const dealer = clients.find((client) => client.view!.prompt.kind === 'SELECT_EXCHANGE_SIZE')!
    const view = dealer.view as PlayerView
    const replay = {
      type: 'SELECT_EXCHANGE_SIZE' as const,
      size: 2,
      matchId: view.matchId,
      expectedVersion: view.version,
      actionId: 'replayed-once',
    }
    dealer.send(replay)
    await dealer.waitFor((v) => v.phase === 'EXCHANGE')
    const afterFirst = dealer.view!.version
    // A duplicate delivery must not draw a second time.
    dealer.send(replay)
    await delay(300)
    expect(dealer.view!.version).toBe(afterFirst)
    expect(dealer.view!.you.hand).toHaveLength(15)
    for (const client of clients) await client.close()
  }, 120_000)

  it('refuses a command built on a stale version', async () => {
    const { clients } = await seatThreePlayers()
    await playUntil(clients, (view) => view.phase === 'EXCHANGE_SIZE_SELECTION')
    const dealer = clients.find((client) => client.view!.prompt.kind === 'SELECT_EXCHANGE_SIZE')!
    const view = dealer.view as PlayerView
    dealer.send({
      type: 'SELECT_EXCHANGE_SIZE',
      size: 1,
      matchId: view.matchId,
      expectedVersion: view.version - 1,
      actionId: 'stale-command',
    })
    await delay(400)
    expect(dealer.rejections.map((r) => r.code)).toContain('VERSION_CONFLICT')
    expect(dealer.view!.phase).toBe('EXCHANGE_SIZE_SELECTION')
    for (const client of clients) await client.close()
  }, 120_000)

  it('refuses a play out of turn and one of the wrong size', async () => {
    const { clients } = await seatThreePlayers()
    await playUntil(clients, (view) => view.phase === 'TRICK_PLAY' && view.trick!.plays.length > 0)

    const acting = clients.find((client) => client.view!.prompt.kind !== 'WAIT')!
    const bystander = clients.find((client) => client.view!.prompt.kind === 'WAIT')!

    const idle = bystander.view as PlayerView
    bystander.send({
      type: 'PLAY_CARDS',
      cards: [idle.you.hand[0] as string],
      matchId: idle.matchId,
      expectedVersion: idle.version,
      actionId: 'out-of-turn',
    })
    await delay(300)
    expect(bystander.rejections.map((r) => r.code)).toContain('NOT_YOUR_TURN')

    const turn = acting.view as PlayerView
    const required = turn.prompt.requiredCards ?? 1
    acting.send({
      type: 'PLAY_CARDS',
      cards: turn.you.hand.slice(0, required + 1) as string[],
      matchId: turn.matchId,
      expectedVersion: turn.version,
      actionId: 'wrong-size',
    })
    await delay(300)
    expect(acting.rejections.map((r) => r.code)).toContain('WRONG_CARD_COUNT')
    for (const client of clients) await client.close()
  }, 120_000)
})

describe('the event log', () => {
  it('records how the match got where it is', async () => {
    const { clients } = await seatThreePlayers()
    await playUntil(clients, (view) => view.phase === 'TRICK_PLAY' && view.trick!.plays.length > 0)
    const events = await prisma.gameEvent.findMany({ orderBy: { sequence: 'asc' } })
    const types = events.map((event) => event.eventType)
    expect(types).toContain('MATCH_CREATED')
    expect(types).toContain('PLAYER_JOINED')
    expect(types).toContain('MATCH_STARTED')
    expect(types).toContain('HAND_DEALT')
    expect(types).toContain('CARDS_PLAYED')
    const sequences = events.map((event) => event.sequence)
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b))
    expect(new Set(sequences).size).toBe(sequences.length)
    for (const client of clients) await client.close()
  }, 120_000)
})
