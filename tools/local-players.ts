/**
 * Fills the empty seats so one person can exercise the app alone.
 *
 *   node --experimental-strip-types --env-file-if-exists=.env tools/local-players.ts Bob Charlie
 *
 * Each named player is created (or reused), signed in, seated, and then plays
 * legally from nothing but the sanitised view the server sends them — the same
 * information a browser gets. A development aid only; the game itself has no
 * computer opponents.
 */
import { createHash, randomBytes } from 'node:crypto'
import WebSocket from 'ws'
import { db, disconnect } from '@cucumber/database'
import { decideForSeat, type SeatMemory } from '@cucumber/strategy'
import type { ClientCommand, PlayerView, ServerMessage } from '@cucumber/shared'

const origin = process.env.LOCAL_ORIGIN ?? 'http://127.0.0.1:8080'
const names = process.argv.slice(2)
if (names.length === 0) {
  console.error('Usage: local-players.ts <name> [name...]')
  process.exit(1)
}

const WORLDS = Number(process.env.LOCAL_WORLDS ?? 160)

/** The same brain as the server's computer players, stamped with an envelope. */
function decide(view: PlayerView, memory: SeatMemory): ClientCommand | null {
  const decision = decideForSeat(view, memory, { worlds: WORLDS })
  if (!decision) return null
  return {
    ...decision,
    matchId: view.matchId,
    expectedVersion: view.version,
    actionId: randomBytes(8).toString('hex'),
  } as ClientCommand
}

async function signIn(name: string): Promise<string> {
  const email = `${name.toLowerCase()}@local.test`
  const token = randomBytes(24).toString('base64url')
  const inviteHash = createHash('sha256').update(token).digest('hex')
  await db().user.upsert({
    where: { email },
    update: { inviteHash, status: 'INVITED', displayName: name },
    create: { email, displayName: name, status: 'INVITED', inviteHash },
  })

  const redeemed = await fetch(`${origin}/api/auth/redeem`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  if (!redeemed.ok) throw new Error(`${name} could not sign in: ${await redeemed.text()}`)
  const cookie = redeemed.headers
    .getSetCookie()
    .find((value) => value.startsWith('cucumber_session='))
  if (!cookie) throw new Error(`${name} received no session`)
  const session = cookie.split(';')[0] as string

  const joined = await fetch(`${origin}/api/room/join`, { method: 'POST', headers: { cookie: session } })
  if (!joined.ok) throw new Error(`${name} could not take a seat: ${await joined.text()}`)
  return session
}

/**
 * Keep a seat filled for as long as this process runs.
 *
 * The first version opened one socket per player and, on close, logged
 * "<name> left" and stopped. That is fine until anything restarts the server —
 * and in development `--watch` restarts it on every edit to apps/server, which
 * drops every socket. The table was then left with a human and two empty
 * chairs, showing ONLINE because the server's own connection state had not
 * caught up, and the only symptom was that nobody moved. It happened three
 * times before it was worth fixing.
 *
 * So: reconnect, and sign in again while doing it. A stale cookie is the other
 * way this dies — rotating SESSION_SECRET invalidates every session — and
 * re-signing costs one row update and one request, so there is no reason to
 * try the old cookie first and guess at which failure it was.
 */
function keepSeated(name: string, index: number): void {
  let delay = 500
  const reconnect = (why: string) => {
    console.log(`${name} ${why}; reconnecting in ${delay}ms`)
    setTimeout(() => {
      void signIn(name)
        .then((session) => {
          delay = 500
          play(name, session, index)
        })
        .catch((error) => {
          // Cap the backoff: the server may be mid-restart, and hammering it
          // makes that take longer.
          delay = Math.min(delay * 2, 5000)
          reconnect(`could not sign in (${(error as Error).message.slice(0, 60)})`)
        })
    }, delay)
  }
  void signIn(name)
    .then((session) => play(name, session, index, reconnect))
    .catch((error) => reconnect(`could not sign in (${(error as Error).message.slice(0, 60)})`))
}

function play(
  name: string,
  cookie: string,
  index: number,
  onLost: (why: string) => void = () => {},
): void {
  const socket = new WebSocket(`${origin.replace('http', 'ws')}/ws`, { headers: { cookie } })
  // Act at most once per version, and stagger the seats, so two fillers
  // reacting to the same broadcast do not race each other into conflicts.
  let actedOn = -1
  let lastActed = Date.now()
  // Its own discards: cards it saw and parted with, which it may remember.
  let memory: SeatMemory = { discarded: [] }
  let handNumber = 0
  socket.on('open', () => {
    console.log(`${name} sat down`)
    socket.send(JSON.stringify({ type: 'RESYNC' }))
  })
  socket.on('message', (raw: Buffer) => {
    const message = JSON.parse(raw.toString()) as ServerMessage
    if (message.type === 'PLAY_REJECTED') {
      if (message.code !== 'VERSION_CONFLICT') {
        console.warn(`${name} was refused: ${message.code} — ${message.reason}`)
      }
      // A refusal comes back on the same version the command was built on, so
      // the "act once per version" guard would treat that version as already
      // handled and this player would sit there forever. Let it try again.
      actedOn = -1
      socket.send(JSON.stringify({ type: 'RESYNC' }))
      return
    }
    if (message.type !== 'STATE_UPDATED') return
    const view = message.view
    if (view.handNumber !== handNumber) {
      handNumber = view.handNumber
      memory = { discarded: [] }
    }
    if (view.version <= actedOn) return
    const command = decide(view, memory)
    if (!command) return
    if (command.type === 'SUBMIT_DISCARDS') memory.discarded.push(...command.cards)
    actedOn = view.version
    lastActed = Date.now()
    // A short pause so a human watching can follow what happened.
    setTimeout(() => socket.send(JSON.stringify(command)), 600 + index * 250)
  })
  socket.on('error', () => {
    // The close handler fires after this; let it do the reconnecting so the
    // seat is never refilled twice.
  })

  socket.on('close', () => onLost('left the table'))

  /*
   * A socket can stay open while the game waits forever on this seat: a
   * command refused for a reason the guard above does not clear, or a
   * broadcast missed during a reconnect, leaves `actedOn` pinned at a version
   * that will never arrive again. Ask for the state afresh if this seat has
   * been the one holding things up for a while.
   */
  const watchdog = setInterval(() => {
    if (socket.readyState !== socket.OPEN) return
    if (Date.now() - lastActed < 20_000) return
    lastActed = Date.now()
    actedOn = -1
    socket.send(JSON.stringify({ type: 'RESYNC' }))
  }, 10_000)
  socket.on('close', () => clearInterval(watchdog))
}

// The database stays open: reconnecting mints a fresh invitation, and that
// needs it. It is closed when the process is.
names.forEach((name, index) => keepSeated(name, index))
console.log(`${names.join(' and ')} are taking their seats. They reconnect on their own; Ctrl-C to stop.`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void disconnect().finally(() => process.exit(0))
  })
}
