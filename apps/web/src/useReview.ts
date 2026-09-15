import { useCallback, useMemo, useRef, useState } from 'react'
import { review, type Decision, type ReviewSummary } from '@cucumber/strategy'
import type { CardId, PlayerView } from '@cucumber/shared'
import type { Advice } from '@cucumber/strategy'
import { emptyRecorder, record, type RecorderState } from './reviewRecord.ts'

/**
 * Keeps what the advisor thought, for afterwards.
 *
 * The advisor is asked about your position whether or not you can see it, so
 * in blind mode this is the only trace of what the best play was at the moment
 * you were choosing. It has to be captured then: once the hand is over the
 * cards are face up, and judging the decision with knowledge you did not have
 * would be judging a different decision.
 */
export interface Reviewer {
  /** Call as the player commits to a play, before the view moves on. */
  note: (cards: CardId[]) => void
  summary: ReviewSummary
  decisions: Decision[]
  reset: () => void
}

export function useReview(
  view: PlayerView | null,
  advice: Advice | null,
  adviceVersion: number | null,
): Reviewer {
  const [state, setState] = useState<RecorderState>(emptyRecorder)

  // Held in a ref so `note` keeps a stable identity: it is called from the
  // command path, and a changing callback there would re-render the table on
  // every advisor answer.
  const latest = useRef({ view, advice, adviceVersion })
  latest.current = { view, advice, adviceVersion }

  const note = useCallback((cards: CardId[]) => {
    const current = latest.current
    if (!current.view) return
    setState((previous) =>
      record(previous, {
        view: current.view as PlayerView,
        advice: current.advice,
        adviceVersion: current.adviceVersion,
        cards,
      }),
    )
  }, [])

  const summary = useMemo(() => review(state.decisions), [state.decisions])
  const reset = useCallback(() => setState(emptyRecorder), [])

  return { note, summary, decisions: state.decisions, reset }
}
