import { createHash, randomBytes } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { PrismaClient } from '@cucumber/database'
import WebSocket from 'ws'
import type { ClientCommand, PlayerView, Room, ServerMessage } from '@cucumber/shared'

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://cucumber:cucumber@localhost:5432/cucumber_test?schema=public'

export const TEST_PORT = Number(process.env.TEST_PORT ?? 8099)
const SESSION_SECRET = 'integration-test-secret-integration-test-secret'
const ROOT = new URL('../..', import.meta.url).pathname

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function prepareDatabase(): Promise<void> {
  await run(
    'packages/database/node_modules/.bin/prisma',
    [
      'db',
      'push',
      '--schema=packages/database/prisma/schema.prisma',
      '--skip-generate',
      '--accept-data-loss',
    ],
    { DATABASE_URL: TEST_DATABASE_URL },
  )
}

function run(command: string, args: string[], env: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: 'pipe',
    })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} failed (${code}):\n${output}`)),
    )
  })
}

export function testDb(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } })
}

export async function resetTables(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE applied_actions, game_events, game_state, match_players, matches, users RESTART IDENTITY CASCADE',
  )
}

/** Create an approved user holding a known invitation token. */
export async function seedInvitee(
  prisma: PrismaClient,
  email: string,
  displayName: string,
): Promise<string> {
  const token = randomBytes(24).toString('base64url')
  await prisma.user.create({
    data: { email, displayName, status: 'INVITED', inviteHash: hashToken(token) },
  })
  return token
}

export class ServerHandle {
  private constructor(private child: ChildProcess) {}

  static async start(extraEnv: Record<string, string> = {}): Promise<ServerHandle> {
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', 'apps/server/src/index.ts'],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          DATABASE_URL: TEST_DATABASE_URL,
          SESSION_SECRET,
          PORT: String(TEST_PORT),
          HOST: '127.0.0.1',
          ADMIN_EMAIL: '',
          LOG_LEVEL: 'error',
          NODE_ENV: 'test',
          ...extraEnv,
        },
        stdio: 'pipe',
      },
    )
    let stderr = ''
    child.stderr.on('data', (chunk) => (stderr += chunk))

    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(`Server exited early:\n${stderr}`)
      try {
        const response = await fetch(`http://127.0.0.1:${TEST_PORT}/api/health`)
        if (response.ok) return new ServerHandle(child)
      } catch {
        // not listening yet
      }
      await delay(100)
    }
    child.kill('SIGKILL')
    throw new Error(`Server never became healthy:\n${stderr}`)
  }

  /** Kill it outright — no graceful shutdown, no chance to flush anything. */
  async kill(): Promise<void> {
    const exited = new Promise<void>((resolve) => this.child.once('exit', () => resolve()))
    this.child.kill('SIGKILL')
    await exited
  }
}

export const base = `http://127.0.0.1:${TEST_PORT}`

export async function redeem(token: string): Promise<string> {
  const response = await fetch(`${base}/api/auth/redeem`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  if (!response.ok) throw new Error(`redeem failed: ${response.status} ${await response.text()}`)
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith('cucumber_session='))
  if (!cookie) throw new Error('no session cookie returned')
  return cookie.split(';')[0] as string
}

export async function joinRoom(cookie: string): Promise<Room> {
  const response = await fetch(`${base}/api/room/join`, { method: 'POST', headers: { cookie } })
  if (!response.ok) throw new Error(`join failed: ${response.status} ${await response.text()}`)
  return (await response.json()) as Room
}

/** A player's browser: one socket, the latest view it has been sent. */
export class TestClient {
  view: PlayerView | null = null
  room: Room | null = null
  rejections: { code: string; reason: string }[] = []
  private socket: WebSocket

  private constructor(socket: WebSocket, readonly cookie: string) {
    this.socket = socket
  }

  static async connect(cookie: string): Promise<TestClient> {
    const socket = new WebSocket(`ws://127.0.0.1:${TEST_PORT}/ws`, { headers: { cookie } })
    const client = new TestClient(socket, cookie)
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve())
      socket.once('error', reject)
    })
    socket.on('message', (raw: Buffer) => {
      const message = JSON.parse(raw.toString()) as ServerMessage
      if (message.type === 'STATE_UPDATED') client.view = message.view
      if (message.type === 'ROOM_WAITING') client.room = message.room
      if (message.type === 'PLAY_REJECTED') {
        client.rejections.push({ code: message.code, reason: message.reason })
      }
    })
    return client
  }

  send(command: ClientCommand | { type: 'RESYNC' }): void {
    this.socket.send(JSON.stringify(command))
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return
    const closed = new Promise<void>((resolve) => this.socket.once('close', () => resolve()))
    this.socket.close()
    await closed
  }

  async waitFor(predicate: (view: PlayerView) => boolean, label = 'state'): Promise<PlayerView> {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (this.view && predicate(this.view)) return this.view
      await delay(25)
    }
    throw new Error(`Timed out waiting for ${label}; last view: ${JSON.stringify(this.view)?.slice(0, 400)}`)
  }
}

export { delay }
