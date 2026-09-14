import { useEffect, useRef, useState } from 'react'
import type { CardId, PlayerView } from '@cucumber/shared'
import type { Advice } from '@cucumber/strategy'
import type { AdvisorRequest, AdvisorResponse } from './advisor.worker.ts'

export interface AdvisorState {
  advice: Advice | null
  /** The state version this advice was computed for. */
  version: number | null
  thinking: boolean
  milliseconds: number
}

const IDLE: AdvisorState = { advice: null, version: null, thinking: false, milliseconds: 0 }

/**
 * Asks the worker for advice whenever the position changes. Only the newest
 * request counts; answers to positions that have already moved on are dropped.
 */
export function useAdvisor(
  view: PlayerView | null,
  discarded: CardId[],
  enabled: boolean,
  worlds = 256,
): AdvisorState {
  const [state, setState] = useState<AdvisorState>(IDLE)
  const workerRef = useRef<Worker | null>(null)
  const latestRef = useRef(0)

  useEffect(() => {
    if (!enabled) {
      setState(IDLE)
      return
    }
    const worker = new Worker(new URL('./advisor.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker
    worker.onmessage = (event: MessageEvent<AdvisorResponse>) => {
      if (event.data.id !== latestRef.current) return
      setState({
        advice: event.data.advice,
        version: event.data.id,
        thinking: false,
        milliseconds: event.data.milliseconds,
      })
    }
    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [enabled])

  const version = view?.version ?? -1
  const phase = view?.phase
  useEffect(() => {
    const worker = workerRef.current
    if (!enabled || !worker || !view) return
    if (phase !== 'TRICK_PLAY' && view.prompt.kind !== 'SUBMIT_DISCARDS') {
      setState(IDLE)
      return
    }
    const id = version
    latestRef.current = id
    setState((previous) => ({ ...previous, thinking: true }))
    const request: AdvisorRequest = {
      id,
      view,
      // Cards still in hand were never actually discarded — a rejected
      // submission should not leave the advisor believing a lie.
      memory: { discarded: discarded.filter((card) => !view.you.hand.includes(card)) },
      worlds,
    }
    worker.postMessage(request)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, version, phase, worlds])

  return state
}
