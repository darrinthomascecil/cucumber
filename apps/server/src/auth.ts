import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { db, type User } from '@cucumber/database'
import { env } from './env.ts'

const COOKIE = 'cucumber_session'
const SESSION_DAYS = 30

export class AuthError extends Error {
  readonly statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'AuthError'
    this.statusCode = statusCode
  }
}

function sign(payload: string): string {
  return createHmac('sha256', env.sessionSecret).update(payload).digest('base64url')
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Sessions are a signed cookie rather than a table — revocation is handled by
 *  flipping the user's status, which is checked on every request. */
export function issueSession(reply: FastifyReply, userId: string): void {
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000
  const payload = `${userId}.${expires}`
  reply.setCookie(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProduction,
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  })
}

export function clearSession(reply: FastifyReply): void {
  reply.clearCookie(COOKIE, { path: '/' })
}

function readCookieUserId(raw: string | undefined): string | null {
  if (!raw) return null
  const parts = raw.split('.')
  if (parts.length !== 3) return null
  const [userId, expires, signature] = parts as [string, string, string]
  if (!safeEqual(sign(`${userId}.${expires}`), signature)) return null
  if (Number(expires) < Date.now()) return null
  return userId
}

/**
 * Microsoft writes the same person several ways. A personal account arrives
 * as "live.com#sam@example.com"; a guest's directory name is
 * "sam_example.com#EXT#@tenant.onmicrosoft.com". Both mean sam@example.com.
 */
export function principalEmail(raw: string): string | null {
  let value = raw.trim().toLowerCase()
  const guest = value.indexOf('#ext#')
  if (guest > 0) {
    const local = value.slice(0, guest)
    const at = local.lastIndexOf('_')
    if (at <= 0) return null
    value = `${local.slice(0, at)}@${local.slice(at + 1)}`
  } else if (value.includes('#')) {
    value = value.slice(value.lastIndexOf('#') + 1)
  }
  if (value.length === 0 || value.length > 254 || /\s/.test(value)) return null
  // The server's own players are not people and cannot be signed in as.
  if (value.endsWith('@computer.local')) return null
  return value
}

function header(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name]
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

/** The name Microsoft knows them by, or failing that the front of the address. */
function principalDisplayName(request: FastifyRequest, email: string): string {
  const fallback = (email.split('@')[0] ?? email).slice(0, 40)
  const encoded = header(request, 'x-ms-client-principal')
  if (!encoded) return fallback
  try {
    const principal = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as {
      claims?: { typ?: string; val?: string }[]
    }
    const name = principal.claims?.find((claim) => claim.typ === 'name')?.val?.trim()
    return name ? name.slice(0, 40) : fallback
  } catch {
    return fallback
  }
}

/**
 * The person the platform has already signed in, created on first sight.
 * Only consulted when TRUST_EASY_AUTH says the platform is really there.
 */
async function easyAuthUser(request: FastifyRequest): Promise<User | null> {
  if (!env.trustEasyAuth) return null
  const raw = header(request, 'x-ms-client-principal-name')
  if (!raw) return null
  const email = principalEmail(raw)
  if (!email) return null

  const existing = await db().user.findUnique({ where: { email } })
  if (existing) {
    // Somebody invited before the wall went up: signing in is accepting.
    if (existing.status === 'INVITED') {
      return db().user.update({ where: { id: existing.id }, data: { status: 'ACTIVE', inviteHash: null } })
    }
    return existing
  }
  try {
    return await db().user.create({
      data: { email, displayName: principalDisplayName(request, email), status: 'ACTIVE' },
    })
  } catch {
    // Their first two requests raced each other; the other one won.
    return db().user.findUnique({ where: { email } })
  }
}

/** True when the request already carries a session of ours that checks out. */
export function hasSession(request: FastifyRequest): boolean {
  return readCookieUserId(request.cookies[COOKIE]) !== null
}

/** The authenticated, still-approved user — or null. */
export async function currentUser(request: FastifyRequest): Promise<User | null> {
  const userId = readCookieUserId(request.cookies[COOKIE])
  const fromCookie = userId ? await db().user.findUnique({ where: { id: userId } }) : null
  const user = fromCookie ?? (await easyAuthUser(request))
  // Spec §35: authentication alone is not enough; the allowlist decides.
  if (!user || user.status === 'DISABLED') return null
  return user
}

export async function requireUser(request: FastifyRequest): Promise<User> {
  const user = await currentUser(request)
  if (!user) throw new AuthError(401, 'Sign in to continue.')
  return user
}

export async function requireAdmin(request: FastifyRequest): Promise<User> {
  const user = await requireUser(request)
  if (!user.isAdmin) throw new AuthError(403, 'Administrators only.')
  return user
}

/** Development only: the admin, seated without an invitation. Returns null
 *  whenever the bypass is off, so callers can treat it as "no session". */
export async function autoSignIn(reply: FastifyReply): Promise<User | null> {
  if (!env.devAutoSignIn || env.isProduction) return null
  const email = env.adminEmail.toLowerCase()
  if (!email) return null
  const user = await db().user.upsert({
    where: { email },
    update: { status: 'ACTIVE' },
    create: { email, displayName: env.adminDisplayName, isAdmin: true, status: 'ACTIVE' },
  })
  issueSession(reply, user.id)
  return user
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Issue a fresh single-use invitation for an approved email address. */
export async function createInvite(email: string, displayName: string, isAdmin = false) {
  const token = randomBytes(32).toString('base64url')
  const inviteHash = hashToken(token)
  const user = await db().user.upsert({
    where: { email: email.toLowerCase() },
    update: { inviteHash, inviteSentAt: new Date(), displayName },
    create: {
      email: email.toLowerCase(),
      displayName,
      isAdmin,
      status: 'INVITED',
      inviteHash,
      inviteSentAt: new Date(),
    },
  })
  return { user, token }
}

export async function redeemInvite(token: string): Promise<User> {
  const user = await db().user.findUnique({ where: { inviteHash: hashToken(token) } })
  if (!user) throw new AuthError(400, 'That invitation is not valid — it may already have been used.')
  if (user.status === 'DISABLED') throw new AuthError(403, 'That account has been disabled.')
  return db().user.update({
    where: { id: user.id },
    data: { status: 'ACTIVE', inviteHash: null },
  })
}
