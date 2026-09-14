/**
 * The advisor runs here, off the main thread and — more importantly — in the
 * browser, where the only thing available to it is the player's own sanitised
 * view. The hidden cards live on the server and never arrive, so the rule that
 * advice may use nothing but your hand and the cards everyone has watched
 * being played is enforced by what is physically in this process.
 */
import { advise, type Advice, type SeatMemory } from '@cucumber/strategy'
import type { PlayerView } from '@cucumber/shared'

export interface AdvisorRequest {
  id: number
  view: PlayerView
  memory: SeatMemory
  worlds: number
}

export interface AdvisorResponse {
  id: number
  advice: Advice
  milliseconds: number
}

self.onmessage = (event: MessageEvent<AdvisorRequest>) => {
  const { id, view, memory, worlds } = event.data
  const started = performance.now()
  // The seed is derived from the position, so the same position always gives
  // the same answer and the numbers do not shimmer as you look at them.
  const seed = (view.version * 2654435761 + view.you.seat) >>> 0
  const advice = advise(view, memory, { worlds, seed })
  const response: AdvisorResponse = {
    id,
    advice,
    milliseconds: performance.now() - started,
  }
  ;(self as unknown as Worker).postMessage(response)
}
