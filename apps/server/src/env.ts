import { randomBytes } from 'node:crypto'

// A dev run should not need a secrets file to boot; a production one must.
if (!process.env.SESSION_SECRET && process.env.NODE_ENV !== 'production') {
  process.env.SESSION_SECRET = randomBytes(32).toString('hex')
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
