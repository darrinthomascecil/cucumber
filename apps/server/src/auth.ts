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

/** The authenticated, still-approved user — or null. */
export async function currentUser(request: FastifyRequest): Promise<User | null> {
  const userId = readCookieUserId(request.cookies[COOKIE])
  if (!userId) return null
  const user = await db().user.findUnique({ where: { id: userId } })
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
