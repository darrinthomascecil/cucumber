import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@cucumber/database'
import {
  ServerHandle,
  TestClient,
  asPrincipal,
  base,
  joinRoom,
  prepareDatabase,
  resetTables,
  testDb,
} from '../helpers/server.ts'
import { opponents, playAlone } from '../helpers/solo.ts'

/**
 * The deployment that sits behind Azure's sign-in wall: whoever the platform
 * says is there may sit down and play the computer, with no invitation.
 */
const BEHIND_THE_WALL = {
  TRUST_EASY_AUTH: '1',
  COMPUTER_PLAYERS: 'Bob,Charlie',
  COMPUTER_WORLDS: '24',
  COMPUTER_DELAY_MS: '0',
  COMPUTER_POLL_MS: '250',
}

let prisma: PrismaClient
let server: ServerHandle | undefined

beforeAll(async () => {
  await prepareDatabase()
  prisma = testDb()
}, 180_000)

afterAll(async () => {
  await server?.kill()
  await prisma?.$disconnect()
})

async function me(headers: Record<string, string>): Promise<Response> {
  return fetch(`${base}/api/me`, { headers })
}

describe('behind the sign-in wall', () => {
  beforeEach(async () => {
    await server?.kill()
    await resetTables(prisma)
    server = await ServerHandle.start(BEHIND_THE_WALL)
  }, 120_000)

  it('knows a person by the name the platform gives, and needs no invitation', async () => {
    const response = await me(asPrincipal('Alice@Example.com'))
    expect(response.status).toBe(200)
    const body = (await response.json()) as { email: string; status: string; isAdmin: boolean }
    expect(body).toMatchObject({ email: 'alice@example.com', status: 'ACTIVE', isAdmin: false })
    // A session of our own comes back, so nothing later depends on the header.
    expect(response.headers.getSetCookie().some((value) => value.startsWith('cucumber_session='))).toBe(true)
  })

  it('still turns away a request the platform has not vouched for', async () => {
    expect((await me({})).status).toBe(401)
    expect((await fetch(`${base}/api/room/join`, { method: 'POST' })).status).toBe(401)
  })

  it('sees one person behind the several ways Microsoft writes them', async () => {
    const ids = new Set<string>()
    for (const name of [
      'sam@example.com',
      'live.com#Sam@Example.com',
      'sam_example.com#EXT#@tenant.onmicrosoft.com',
    ]) {
      const response = await me(asPrincipal(name))
      expect(response.status).toBe(200)
      ids.add(((await response.json()) as { id: string }).id)
    }
    expect(ids.size).toBe(1)
    expect(await prisma.user.count({ where: { email: 'sam@example.com' } })).toBe(1)
  })

  it('keeps a disabled person out, whatever the platform says', async () => {
    await prisma.user.create({ data: { email: 'mallory@example.com', displayName: 'Mallory', status: 'DISABLED' } })
    expect((await me(asPrincipal('mallory@example.com'))).status).toBe(401)
  })

  it('will not sign anybody in as one of its own computer players', async () => {
    expect((await me(asPrincipal('bob@computer.local'))).status).toBe(401)
  })

  it('picks up a table that was already in play when the server came back', async () => {
    // What a deployment does to a game in progress: the process is replaced
    // underneath a person who is part-way through a hand.
    const alice = asPrincipal('alice@example.com')
    const room = await joinRoom(alice)
    let client = await TestClient.connect(alice)
    await client.waitFor((view) => view.players.length === 3, 'the table to fill')
    const before = await playAlone(client, (view) => view.phase === 'TRICK_PLAY' && view.played.length >= 3)

    await server!.kill()
    server = await ServerHandle.start(BEHIND_THE_WALL)

    client = await TestClient.connect(alice)
    const after = await client.waitFor((view) => view.version >= before.version, 'the same match to come back')
    expect(after.matchId).toBe(room.matchId)
    expect(after.handNumber).toBe(before.handNumber)
    expect((await joinRoom(alice)).matchId).toBe(room.matchId)

    // The computer players have found their old seats and carry on.
    const over = await playAlone(client, (view) => view.phase === 'MATCH_OVER')
    expect(over.matchId).toBe(room.matchId)
    expect(await prisma.match.count()).toBe(1)
    await client.close()
  }, 180_000)

  it('gives each person a table of their own with the computer players at it', async () => {
    const alice = asPrincipal('alice@example.com')
    const dora = asPrincipal('dora@example.com')

    const aliceRoom = await joinRoom(alice)
    const doraRoom = await joinRoom(dora)
    expect(doraRoom.matchId).not.toBe(aliceRoom.matchId)

    // Header alone, no cookie: the socket is recognised the same way.
    const aliceClient = await TestClient.connect(alice)
    const doraClient = await TestClient.connect(dora)

    const aliceTable = await aliceClient.waitFor((view) => view.players.length === 3, "Alice's table to fill")
    const doraTable = await doraClient.waitFor((view) => view.players.length === 3, "Dora's table to fill")
    expect(aliceTable.matchId).toBe(aliceRoom.matchId)
    expect(doraTable.matchId).toBe(doraRoom.matchId)
    expect(opponents(aliceTable)).toEqual(['Bob', 'Charlie'])
    expect(opponents(doraTable)).toEqual(['Bob', 'Charlie'])

    // Both matches run at once, to the end, without treading on each other.
    const [aliceOver, doraOver] = await Promise.all([
      playAlone(aliceClient, (view) => view.phase === 'MATCH_OVER'),
      playAlone(doraClient, (view) => view.phase === 'MATCH_OVER'),
    ])
    expect(aliceOver.matchId).toBe(aliceRoom.matchId)
    expect(doraOver.matchId).toBe(doraRoom.matchId)
    for (const client of [aliceClient, doraClient]) {
      expect(client.rejections.filter((rejection) => rejection.code !== 'VERSION_CONFLICT')).toEqual([])
    }

    // Coming back finds your own table, not somebody else's.
    expect((await joinRoom(dora)).matchId).not.toBe(aliceRoom.matchId)

    expect(await prisma.match.count({ where: { status: 'COMPLETE' } })).toBe(2)
    await aliceClient.close()
    await doraClient.close()
  }, 180_000)
})

describe('anywhere else', () => {
  beforeEach(async () => {
    await server?.kill()
    await resetTables(prisma)
    server = await ServerHandle.start()
  }, 120_000)

  it('treats the platform header as the unverified text it is', async () => {
    expect((await me(asPrincipal('alice@example.com'))).status).toBe(401)
    expect(await prisma.user.count()).toBe(0)
  })
})
