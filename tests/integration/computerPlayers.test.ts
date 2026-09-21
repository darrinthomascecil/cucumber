import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PrismaClient } from '@cucumber/database'
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
import { opponents, playAlone } from '../helpers/solo.ts'

/**
 * One person, two computer players, a real server, a real database. The
 * computer players are configured exactly as a deployment would configure
 * them, only quicker: no pause before acting and a smaller search.
 */
const COMPUTER_PLAYERS = {
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

beforeEach(async () => {
  await server?.kill()
  await resetTables(prisma)
  server = await ServerHandle.start(COMPUTER_PLAYERS)
}, 120_000)

async function alice(): Promise<{ cookie: string; client: TestClient }> {
  const token = await seedInvitee(prisma, 'alice@example.com', 'Alice')
  const cookie = await redeem(token)
  await joinRoom(cookie)
  return { cookie, client: await TestClient.connect(cookie) }
}

describe('computer players', () => {
  it('fill the empty seats and play a match through to the end', async () => {
    const { client } = await alice()

    const table = await client.waitFor((view) => view.players.length === 3, 'a full table')
    expect(opponents(table)).toEqual(['Bob', 'Charlie'])

    const over = await playAlone(client, (view) => view.phase === 'MATCH_OVER')
    expect(over.players.some((player) => player.score >= 21)).toBe(true)

    // A refusal other than losing a race to a computer player's move would
    // mean the human's client and the table disagree about the rules.
    const surprises = client.rejections.filter((rejection) => rejection.code !== 'VERSION_CONFLICT')
    expect(surprises).toEqual([])

    const match = await prisma.match.findFirstOrThrow({ include: { players: { include: { user: true } } } })
    expect(match.status).toBe('COMPLETE')
    expect(match.players.map((player) => player.user.email).sort()).toEqual([
      'alice@example.com',
      'bob@computer.local',
      'charlie@computer.local',
    ])
    expect(match.players.filter((player) => player.user.isAdmin)).toEqual([])
  }, 120_000)

  it('wait for the person to start the next match, then are ready for it', async () => {
    const { client } = await alice()
    await client.waitFor((view) => view.players.length === 3, 'a full table')
    const over = await playAlone(client, (view) => view.phase === 'MATCH_OVER')

    // Nobody deals while the person is looking at the result.
    await delay(1000)
    expect(client.view?.phase).toBe('MATCH_OVER')
    expect(client.view?.version).toBe(over.version)

    // The person starts the next match; the computer players are ready before
    // the person is, and the table deals as soon as the person is too.
    const dealt = await playAlone(client, (view) => view.handNumber === 1 && view.phase !== 'LOBBY')
    expect(dealt.players.every((player) => player.score === 0)).toBe(true)
    expect(opponents(dealt)).toEqual(['Bob', 'Charlie'])
  }, 120_000)

  it('follow the person into a fresh match after a reload', async () => {
    const { cookie, client } = await alice()
    await client.waitFor((view) => view.players.length === 3, 'a full table')
    await playAlone(client, (view) => view.phase === 'MATCH_OVER')
    await client.close()

    // Reloading after a finished match seats the person in a brand new one.
    const room = await joinRoom(cookie)
    const fresh = await TestClient.connect(cookie)
    const table = await fresh.waitFor(
      (view) => view.matchId === room.matchId && view.players.length === 3,
      'the computer players to follow',
    )
    expect(opponents(table)).toEqual(['Bob', 'Charlie'])
    expect(table.phase).toBe('LOBBY')

    const dealt = await playAlone(fresh, (view) => view.handNumber === 1 && view.phase !== 'LOBBY')
    expect(dealt.matchId).toBe(room.matchId)
    await fresh.close()
  }, 120_000)
})
