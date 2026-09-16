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
import { askAboutReview, type AskRequest } from './reviewChat.ts'

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

  /**
   * Keep a finished match's review, so it outlives the tab that made it.
   *
   * The browser is the only thing that has these evaluations — the advisor
   * runs there — so the client posts them when a match ends. Writing is
   * idempotent on (match, player): a reload must not leave two reviews of one
   * match, and the second write is the same data anyway.
   */
  app.post<{ Body: { matchId?: string; advisor?: string; summary?: unknown } }>(
    '/api/review',
    async (request, reply) => {
      const user = await requireUser(request)
      const { matchId, advisor, summary } = request.body ?? {}
      if (!matchId || !advisor || summary === undefined) {
        return reply.code(400).send({ error: 'A review needs a match, an advisor and a summary.' })
      }
      const existing = await db().matchReview.findFirst({ where: { matchId, userId: user.id } })
      if (existing) {
        await db().matchReview.update({
          where: { id: existing.id },
          data: { advisor, summary: summary as object },
        })
        return { id: existing.id, replaced: true }
      }
      const saved = await db().matchReview.create({
        data: { matchId, userId: user.id, advisor, summary: summary as object },
      })
      return { id: saved.id, replaced: false }
    },
  )

  /** Your reviews, newest first. */
  app.get('/api/review', async (request) => {
    const user = await requireUser(request)
    const reviews = await db().matchReview.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return {
      reviews: reviews.map((r) => ({
        id: r.id,
        matchId: r.matchId,
        advisor: r.advisor,
        createdAt: r.createdAt,
        summary: r.summary,
      })),
    }
  })

  /**
   * Ask a question about a finished match.
   *
   * The client sends the evaluations it recorded while playing blind, because
   * it is the only thing that has them — the advisor runs in the browser. The
   * server's job is to put them in front of a local model with the units
   * spelled out, and to keep the model's answer separate from the numbers it
   * is describing.
   */
  app.post<{ Body: AskRequest }>('/api/review/ask', async (request, reply) => {
    await requireUser(request)
    const body = request.body
    const question = body?.question?.trim()
    if (!question) return reply.code(400).send({ error: 'Ask a question first.' })
    if (question.length > 500) return reply.code(400).send({ error: 'That question is too long.' })
    if (!Array.isArray(body.decisions)) {
      return reply.code(400).send({ error: 'No review was attached to the question.' })
    }
    try {
      return await askAboutReview(body)
    } catch (error) {
      // A missing local model is the ordinary case here, not an emergency.
      app.log.warn({ err: error }, 'review chat failed')
      return reply.code(503).send({
        error: 'The local model did not answer. Is ollama running?',
      })
    }
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
