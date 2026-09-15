import { useEffect, useMemo, useState } from 'react'
import { ADVISOR_VERSION } from '@cucumber/strategy'
import type { PlayerView } from '@cucumber/shared'
import type { Advice } from '@cucumber/strategy'
import type { CalibrationStore, MatchRecord, Sample } from './calibrationTypes.ts'
import { summarise, type Calibration } from './calibrationStats.ts'

/**
 * Does "71%" mean anything?
 *
 * Every time the advisor states odds, that claim is written down. When the
 * match it was talking about finishes, the claim is settled against what
 * actually happened. Over enough matches the two numbers should agree — and if
 * they do not, the advisor is confidently wrong, which is worse than silent.
 *
 * What the panel reports is a sample statistic, so it wanders even when
 * nothing has changed: the headline numbers carry a 95% interval taken over
 * matches, and a move smaller than that band is noise rather than progress.
 */
export type { Sample, MatchRecord } from './calibrationTypes.ts'
export type { Bucket, SeriesPoint, Calibration } from './calibrationStats.ts'

const KEY = 'cucumber.calibration.v1'
/** Where a sample from a superseded advisor is kept. Discarding it outright
 *  would throw away hundreds of matches that are still worth reading — they
 *  just are not evidence about the advisor running now. */
const ARCHIVE = 'cucumber.calibration.previous'
const LIMIT = 4000

const HISTORY_LIMIT = 600

const EMPTY: CalibrationStore = {
  samples: [],
  matches: 0,
  history: [],
  openMatch: null,
  open: {},
  advisor: ADVISOR_VERSION,
}

function load(): CalibrationStore {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<CalibrationStore>
    // Claims made by a different advisor are not evidence about this one. The
    // alternative is a score that quietly stops describing anything — which is
    // how a window of 4000 predictions came to span more than one advisor.
    if (parsed.advisor !== ADVISOR_VERSION) {
      try {
        window.localStorage.setItem(ARCHIVE, raw)
      } catch {
        // Keeping the old sample is a courtesy, not a requirement.
      }
      return EMPTY
    }
    return {
      samples: Array.isArray(parsed.samples) ? parsed.samples.slice(-LIMIT) : [],
      matches: typeof parsed.matches === 'number' ? parsed.matches : 0,
      history: Array.isArray(parsed.history) ? parsed.history.slice(-HISTORY_LIMIT) : [],
      openMatch: typeof parsed.openMatch === 'string' ? parsed.openMatch : null,
      open: parsed.open && typeof parsed.open === 'object' ? parsed.open : {},
      advisor: ADVISOR_VERSION,
    }
  } catch {
    return EMPTY
  }
}

export function useCalibration(
  view: PlayerView | null,
  advice: Advice | null,
  adviceVersion: number | null,
): { calibration: Calibration; reset: () => void } {
  const [store, setStore] = useState<CalibrationStore>(() => load())

  // Write down every claim the advisor makes about a move of yours.
  const version = view?.version ?? null
  const matchId = view?.matchId ?? null
  const claim =
    advice && advice.kind === 'PLAY' && adviceVersion === version ? advice.winProbability : null

  useEffect(() => {
    if (claim === null || version === null || matchId === null) return
    setStore((current) => {
      // A new match abandons any claims never settled — a match left half
      // played proves nothing either way.
      const fresh =
        current.openMatch === matchId ? current : { ...current, openMatch: matchId, open: {} }
      if (fresh.open[String(version)] !== undefined) return fresh
      return { ...fresh, open: { ...fresh.open, [String(version)]: claim } }
    })
  }, [claim, version, matchId])

  // Settle them when the match they were about actually ends.
  const finished = view?.phase === 'MATCH_OVER'
  const survived = view ? !view.losers.includes(view.you.seat) : false
  useEffect(() => {
    if (!finished || !matchId) return
    setStore((current) => {
      if (current.openMatch !== matchId) return current
      const claims = Object.values(current.open)
      if (claims.length === 0) return current
      const settled: Sample[] = claims.map((expected) => ({ expected, survived }))
      const meanClaim = claims.reduce((sum, p) => sum + p, 0) / claims.length
      const outcome = survived ? 1 : 0
      const record: MatchRecord = {
        expected: meanClaim,
        survived,
        // This match's own Brier, kept so the headline can carry an interval
        // taken over matches rather than over correlated predictions.
        brier: claims.reduce((sum, p) => sum + (p - outcome) ** 2, 0) / claims.length,
      }
      return {
        samples: [...current.samples, ...settled].slice(-LIMIT),
        matches: current.matches + 1,
        history: [...current.history, record].slice(-HISTORY_LIMIT),
        openMatch: null,
        open: {},
        advisor: ADVISOR_VERSION,
      }
    })
  }, [finished, matchId, survived])

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(store))
    } catch {
      // A full or unavailable store is not worth interrupting a game for.
    }
  }, [store])

  const calibration = useMemo(() => summarise(store), [store])
  return { calibration, reset: () => setStore(EMPTY) }
}
