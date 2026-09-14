import { useEffect, useRef } from 'react'
import { sortByTrickStrength } from '@cucumber/game-engine'
import type { CardId, PlayerView } from '@cucumber/shared'
import type { Advice } from '@cucumber/strategy'
import type { Intent } from './useGame.ts'

/**
 * Plays your seat for you, taking the advisor's first choice every time.
 *
 * It is not only a convenience: it is how the calibration panel gets a sample
 * worth looking at. A person plays a few matches an evening, which will never
 * tell you whether "71%" means anything.
 */
export function useAutoplay(
  view: PlayerView | null,
  advice: Advice | null,
  adviceVersion: number | null,
  enabled: boolean,
  send: (command: Intent) => void,
  delayMs = 650,
): void {
  /*
   * Held in a ref rather than in the dependency list. The move is scheduled on
   * a timer, and every re-render used to cancel that timer and re-run the
   * effect — which then found the version already marked as acted on and
   * scheduled nothing. The move was cancelled and never replaced.
   *
   * Now the effect only re-runs when the position changes, or when advice for
   * this position arrives.
   */
  const latest = useRef({ view, advice, send })
  latest.current = { view, advice, send }

  const version = view?.version ?? -1
  const kind = view?.prompt.kind ?? 'WAIT'
  const needsAdvice =
    kind === 'LEAD' || kind === 'FOLLOW' || kind === 'FORCED_LOW' || kind === 'SUBMIT_DISCARDS'
  const adviceReady = !needsAdvice || adviceVersion === version

  useEffect(() => {
    if (!enabled || !adviceReady) return
    const current = latest.current.view
    if (!current || current.version !== version) return

    const command = decide(current, latest.current.advice)
    if (!command) return

    const timer = window.setTimeout(() => latest.current.send(command), delayMs)
    return () => window.clearTimeout(timer)
  }, [enabled, version, kind, adviceReady, delayMs])
}

function decide(view: PlayerView, advice: Advice | null): Intent | null {
  const hand = view.you.hand
  const suggested = advice?.suggestions[0]?.cards

  switch (view.prompt.kind) {
    case 'READY':
      return view.you.ready ? null : { type: 'READY', ready: true }
    case 'NEXT_MATCH':
      return { type: 'START_NEXT_MATCH' }
    case 'SELECT_EXCHANGE_SIZE':
      // The one decision self-play has never been asked about; three is the
      // number everything else was tuned under.
      return { type: 'SELECT_EXCHANGE_SIZE', size: 3 }
    case 'SELECT_EXCHANGE':
      return { type: 'SELECT_EXCHANGE', size: view.prompt.options?.[1] ?? 0 }
    case 'SUBMIT_DISCARDS': {
      const required = view.prompt.requiredCards ?? 0
      const cards =
        suggested?.length === required ? suggested : sortByTrickStrength(hand).slice(0, required)
      return { type: 'SUBMIT_DISCARDS', cards }
    }
    case 'LEAD':
    case 'FOLLOW':
    case 'FORCED_LOW': {
      if (suggested?.length) return { type: 'PLAY_CARDS', cards: suggested as CardId[] }
      return null
    }
    default:
      return null
  }
}
