import type { FastifyInstance } from 'fastify'
import { db } from '@cucumber/database'
import {
  AuthError,
  autoSignIn,
  clearSession,
  createInvite,
  currentUser,
  issueSession,
  redeemInvite,
  requireAdmin,
  requireUser,
} from './auth.ts'
import { env } from './env.ts'
import { joinRoom, roomFor, viewOf } from './matchService.ts'

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AuthError) {
      return reply.code(error.statusCode).send({ error: error.message })
    }
    app.log.error(error)
    return reply.code(500).send({ error: 'Something went wrong.' })
  })

  app.get('/api/health', async () => ({ ok: true, service: 'cucumber' }))

  app.get('/api/me', async (request, reply) => {
    // With DEV_AUTO_SIGN_IN the first visit mints its own session, so a local
    // game needs neither an invitation nor a sign-in form.
    const user = (await currentUser(request)) ?? (await autoSignIn(reply))
    if (!user) return reply.code(401).send({ error: 'Not signed in.' })
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
      status: user.status,
    }
  })

  app.post<{ Body: { token?: string } }>('/api/auth/redeem', async (request, reply) => {
    const token = request.body?.token?.trim()
    if (!token) return reply.code(400).send({ error: 'An invitation token is required.' })
    const user = await redeemInvite(token)
    issueSession(reply, user.id)
    return { id: user.id, displayName: user.displayName, isAdmin: user.isAdmin }
  })

  app.post('/api/auth/logout', async (_request, reply) => {
    clearSession(reply)
    return { ok: true }
  })

  app.post('/api/room/join', async (request) => {
    const user = await requireUser(request)
    return joinRoom(user.id)
  })

  app.get('/api/room', async (request, reply) => {
    const user = await requireUser(request)
    const match = await db().match.findFirst({
      where: { status: { in: ['LOBBY', 'ACTIVE'] }, players: { some: { userId: user.id } } },
      orderBy: { createdAt: 'asc' },
    })
    if (!match) return reply.code(404).send({ error: 'You are not seated in a match.' })
    const room = await roomFor(match.id)
    const view = await viewOf(match.id, user.id)
    return { room, view }
  })

  // --- Administration (spec §35) -------------------------------------------

  app.post<{ Body: { email?: string; displayName?: string; isAdmin?: boolean } }>(
    '/api/admin/invites',
    async (request, reply) => {
      await requireAdmin(request)
      const email = request.body?.email?.trim().toLowerCase()
      const displayName = request.body?.displayName?.trim()
      if (!email || !email.includes('@')) {
        return reply.code(400).send({ error: 'A valid email address is required.' })
      }
      if (!displayName) return reply.code(400).send({ error: 'A display name is required.' })
      const { user, token } = await createInvite(email, displayName, request.body?.isAdmin === true)
      return {
        email: user.email,
        displayName: user.displayName,
        inviteUrl: `${env.webOrigin}/invite/${token}`,
      }
    },
  )

  app.get('/api/admin/users', async (request) => {
    await requireAdmin(request)
    const users = await db().user.findMany({ orderBy: { createdAt: 'asc' } })
    return users.map((user) => ({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      status: user.status,
      isAdmin: user.isAdmin,
      hasPendingInvite: user.inviteHash !== null,
    }))
  })

  app.post<{ Params: { id: string }; Body: { status?: 'ACTIVE' | 'DISABLED' } }>(
    '/api/admin/users/:id/status',
    async (request, reply) => {
      await requireAdmin(request)
      const status = request.body?.status
      if (status !== 'ACTIVE' && status !== 'DISABLED') {
        return reply.code(400).send({ error: 'Status must be ACTIVE or DISABLED.' })
      }
      const user = await db().user.update({ where: { id: request.params.id }, data: { status } })
      return { id: user.id, status: user.status }
    },
  )
}
