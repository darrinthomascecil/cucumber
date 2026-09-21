import { randomBytes } from 'node:crypto'

// A dev run should not need a secrets file to boot; a production one must.
if (!process.env.SESSION_SECRET && process.env.NODE_ENV !== 'production') {
  process.env.SESSION_SECRET = randomBytes(32).toString('hex')
}

/**
 * COMPUTER_PLAYERS names the seats the server fills itself, e.g. "Bob,Charlie".
 * At most two: a table with three computer players has nobody at it.
 */
function parseComputerPlayers(raw: string | undefined): string[] {
  const names = (raw ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
  if (names.length > 2) {
    throw new Error('COMPUTER_PLAYERS names at most two players; the third seat is yours')
  }
  for (const name of names) {
    if (!/^[A-Za-z][A-Za-z0-9 _-]{0,23}$/.test(name)) {
      throw new Error(`COMPUTER_PLAYERS: "${name}" is not a usable name`)
    }
  }
  if (new Set(names.map((name) => name.toLowerCase())).size !== names.length) {
    throw new Error('COMPUTER_PLAYERS names must be different from each other')
  }
  return names
}

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`)
  }
  return value
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  sessionSecret: required('SESSION_SECRET'),
  adminEmail: process.env.ADMIN_EMAIL ?? '',
  adminDisplayName: process.env.ADMIN_DISPLAY_NAME ?? 'Admin',
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  /** Where the browser app is served from during development. */
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  /** Directory of the built web app, served in production. */
  webRoot: process.env.WEB_ROOT ?? '',
  isProduction: process.env.NODE_ENV === 'production',
  /** Seat ADMIN_EMAIL straight away instead of demanding an invitation. This
   *  is an authentication bypass, so it is a development convenience only and
   *  the checks below refuse to let it boot anywhere it could matter. */
  devAutoSignIn: process.env.DEV_AUTO_SIGN_IN === '1',
  /**
   * Behind Azure's built-in authentication, the platform has already signed
   * the visitor in with Microsoft and says who they are in request headers
   * that outside callers cannot set. With this on, that identity is enough:
   * no invitation, no second sign-in. It must never be on anywhere a request
   * can reach the server without passing through that wall, because then the
   * header is just a header.
   */
  trustEasyAuth: process.env.TRUST_EASY_AUTH === '1',
  /** Seats the server fills with its own players; empty means three people. */
  computerPlayers: parseComputerPlayers(process.env.COMPUTER_PLAYERS),
  computerWorlds: Number(process.env.COMPUTER_WORLDS ?? 96),
  computerDelayMs: Number(process.env.COMPUTER_DELAY_MS ?? 600),
  computerPollMs: Number(process.env.COMPUTER_POLL_MS ?? 2000),
}

for (const [name, value] of [
  ['COMPUTER_WORLDS', env.computerWorlds],
  ['COMPUTER_DELAY_MS', env.computerDelayMs],
  ['COMPUTER_POLL_MS', env.computerPollMs],
] as const) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`)
}

if (env.devAutoSignIn && env.isProduction) {
  throw new Error('DEV_AUTO_SIGN_IN is a development convenience and cannot be used in production')
}

if (env.devAutoSignIn && !env.adminEmail) {
  throw new Error('DEV_AUTO_SIGN_IN needs ADMIN_EMAIL: it says who to seat')
}

if (env.sessionSecret.length < 24) {
  throw new Error('SESSION_SECRET must be at least 24 characters')
}
