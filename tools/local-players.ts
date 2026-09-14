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
import { sortByTrickStrength } from '@cucumber/game-engine'
import { advise, type SeatMemory } from '@cucumber/strategy'
import type { ClientCommand, PlayerView, ServerMessage } from '@cucumber/shared'

const origin = process.env.LOCAL_ORIGIN ?? 'http://127.0.0.1:8080'
const names = process.argv.slice(2)
if (names.length === 0) {
  console.error('Usage: local-players.ts <name> [name...]')
  process.exit(1)
}

/**
 * These players think with the same brain as the in-game advisor: the tuned
 * strategy, searched over a few hundred imagined deals, from nothing but the
 * sanitised view the server sends them.
 *
 * An earlier version of this file led its lowest card every trick, which is
 * how you arrive at the reveal holding your highest — and it was doing that
 * long after there was a real strategy sitting in the repository unused.
 */
const WORLDS = Number(process.env.LOCAL_WORLDS ?? 160)

function decide(view: PlayerView, memory: SeatMemory): ClientCommand | null {
  const hand = view.you.hand
  const envelope = {
    matchId: view.matchId,
    expectedVersion: view.version,
    actionId: randomBytes(8).toString('hex'),
  }

  switch (view.prompt.kind) {
    case 'READY':
      return view.you.ready ? null : { type: 'READY', ready: true, ...envelope }

    case 'SELECT_EXCHANGE_SIZE':
      // Never searched: the exchange size is the one decision self-play has
      // not been asked about. Three is the figure everything was tuned under.
      return { type: 'SELECT_EXCHANGE_SIZE', size: 3, ...envelope }

    case 'SELECT_EXCHANGE':
      return { type: 'SELECT_EXCHANGE', size: view.prompt.options?.[1] ?? 0, ...envelope }

    case 'SUBMIT_DISCARDS': {
      const required = view.prompt.requiredCards ?? 0
      const advice = advise(view, memory, { worlds: WORLDS })
      const chosen = advice.suggestions[0]?.cards
      return {
        type: 'SUBMIT_DISCARDS',
        // The advisor is approximate here, so fall back on the worst cards.
        cards: chosen?.length === required ? chosen : sortByTrickStrength(hand).slice(0, required),
        ...envelope,
      }
    }

    case 'LEAD':
    case 'FOLLOW':
    case 'FORCED_LOW': {
      const advice = advise(view, memory, { worlds: WORLDS })
      const chosen = advice.suggestions[0]?.cards
      if (chosen && chosen.length > 0) {
        return { type: 'PLAY_CARDS', cards: chosen, ...envelope }
      }
      // Only reachable if the search returned nothing; play something legal.
      const required = view.prompt.requiredCards ?? 1
      const allowed = view.prompt.selectableCards ?? hand
      return {
        type: 'PLAY_CARDS',
        cards: sortByTrickStrength(allowed).slice(0, required),
        ...envelope,
      }
    }

    case 'NEXT_MATCH':
      // Starting a fresh match is a human decision, not a filler's.
      return null

    default:
      return null
  }
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

function play(name: string, cookie: string, index: number): void {
  const socket = new WebSocket(`${origin.replace('http', 'ws')}/ws`, { headers: { cookie } })
  // Act at most once per version, and stagger the seats, so two fillers
  // reacting to the same broadcast do not race each other into conflicts.
  let actedOn = -1
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
    // A short pause so a human watching can follow what happened.
    setTimeout(() => socket.send(JSON.stringify(command)), 600 + index * 250)
  })
  socket.on('close', () => console.log(`${name} left`))
}

const sessions = await Promise.all(names.map(signIn))
await disconnect()
names.forEach((name, index) => play(name, sessions[index] as string, index))
console.log(`${names.join(' and ')} are waiting at the table. Ctrl-C to stop.`)
