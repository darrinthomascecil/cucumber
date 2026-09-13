import { PrismaClient } from '@prisma/client'

export * from '@prisma/client'

let client: PrismaClient | null = null

/** One client per process; Prisma pools connections internally. */
export function db(): PrismaClient {
  if (!client) client = new PrismaClient()
  return client
}

export async function disconnect(): Promise<void> {
  if (client) {
    await client.$disconnect()
    client = null
  }
}
