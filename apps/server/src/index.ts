import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cookie from '@fastify/cookie'
import staticFiles from '@fastify/static'
import websocket from '@fastify/websocket'
import Fastify from 'fastify'
import { db, disconnect } from '@cucumber/database'
import { createInvite, currentUser } from './auth.ts'
import { env } from './env.ts'
import { joinRoom } from './matchService.ts'
import { registerRoutes } from './routes.ts'
import { registerClient } from './realtime.ts'

const here = path.dirname(fileURLToPath(import.meta.url))

/** Make sure there is somebody who can invite everybody else (spec §35). */
async function bootstrapAdmin(log: { info: (msg: string) => void }): Promise<void> {
  if (!env.adminEmail) return
  const existing = await db().user.findUnique({ where: { email: env.adminEmail.toLowerCase() } })
  if (existing && existing.status === 'ACTIVE') return
  const { token } = await createInvite(env.adminEmail, env.adminDisplayName, true)
  log.info(`Admin invitation for ${env.adminEmail}: ${env.webOrigin}/invite/${token}`)
}

async function main(): Promise<void> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } })

  await app.register(cookie, { secret: env.sessionSecret })
  await app.register(websocket)
  await registerRoutes(app)

  app.register(async (instance) => {
    instance.get('/ws', { websocket: true }, async (socket, request) => {
      const user = await currentUser(request)
      if (!user) {
        socket.close(4401, 'Not signed in')
        return
      }
      try {
        const room = await joinRoom(user.id)
        await registerClient(socket, user.id, room.matchId)
      } catch (error) {
        app.log.warn({ err: error }, 'websocket join failed')
        socket.close(4403, 'No seat available')
      }
    })
  })

  const webRoot = env.webRoot || path.resolve(here, '../../web/dist')
  if (env.isProduction) {
    await app.register(staticFiles, { root: webRoot, wildcard: false })
    // Client-side routing: anything that is not an API call renders the app.
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api') || request.url.startsWith('/ws')) {
        return reply.code(404).send({ error: 'Not found' })
      }
      return reply.sendFile('index.html')
    })
  }

  await bootstrapAdmin(app.log)
  await app.listen({ port: env.port, host: env.host })

  const shutdown = async () => {
    await app.close()
    await disconnect()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
