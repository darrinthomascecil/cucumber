import { z } from 'zod'
import type { ClientMessage } from '@cucumber/shared'

const envelope = {
  matchId: z.string().min(1),
  expectedVersion: z.number().int().nonnegative(),
  actionId: z.string().min(1).max(100),
}

const cards = z.array(z.string().min(2).max(10)).min(1).max(13)

/** Nothing reaches the engine without passing this gate first. */
export const clientMessageSchema: z.ZodType<ClientMessage> = z.union([
  z.object({ type: z.literal('RESYNC') }),
  z.object({ type: z.literal('READY'), ready: z.boolean(), ...envelope }),
  z.object({ type: z.literal('SELECT_EXCHANGE_SIZE'), size: z.number().int(), ...envelope }),
  z.object({ type: z.literal('SELECT_EXCHANGE'), size: z.number().int(), ...envelope }),
  z.object({ type: z.literal('SUBMIT_DISCARDS'), cards, ...envelope }),
  z.object({ type: z.literal('PLAY_CARDS'), cards, ...envelope }),
  z.object({ type: z.literal('START_NEXT_MATCH'), ...envelope }),
]) as z.ZodType<ClientMessage>
