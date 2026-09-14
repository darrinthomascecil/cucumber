import { useEffect, useMemo, useState } from 'react'
import type { PlayerView } from '@cucumber/shared'
import type { Advice } from '@cucumber/strategy'

/**
 * Does "71%" mean anything?
 *
 * Every time the advisor states odds, that claim is written down. When the
 * match it was talking about finishes, the claim is settled against what
 * actually happened. Over enough matches the two numbers should agree — and if
 * they do not, the advisor is confidently wrong, which is worse than silent.
 */
export interface Sample {
  /** What the advisor said the chance of surviving the match was. */
  expected: number
  /** Whether this player did in fact survive it. */
  survived: boolean
}

export interface Bucket {
  from: number
  to: number
  count: number
  expected: number
  actual: number
}

export interface Calibration {
  /** Settled predictions. */
  count: number
  matches: number
  /** Predictions in the match still being played. */
  pending: number
  expected: number
  actual: number
  buckets: Bucket[]
}

interface Store {
  samples: Sample[]
  matches: number
  /** Unsettled claims for the match in progress, keyed by state version. */
  openMatch: string | null
  open: Record<string, number>
}

const KEY = 'cucumber.calibration.v1'
const LIMIT = 4000

const EMPTY: Store = { samples: [], matches: 0, openMatch: null, open: {} }

function load(): Store {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<Store>
    return {
      samples: Array.isArray(parsed.samples) ? parsed.samples.slice(-LIMIT) : [],
      matches: typeof parsed.matches === 'number' ? parsed.matches : 0,
      openMatch: typeof parsed.openMatch === 'string' ? parsed.openMatch : null,
      open: parsed.open && typeof parsed.open === 'object' ? parsed.open : {},
    }
  } catch {
    return EMPTY
  }
}

function summarise(store: Store): Calibration {
  const { samples } = store
  const count = samples.length
  const expected = count ? samples.reduce((sum, s) => sum + s.expected, 0) / count : 0
  const actual = count ? samples.filter((s) => s.survived).length / count : 0

  const edges = [0, 0.2, 0.4, 0.6, 0.8, 1.0001]
  const buckets: Bucket[] = []
  for (let i = 0; i < edges.length - 1; i++) {
    const from = edges[i]!
    const to = edges[i + 1]!
    const inside = samples.filter((s) => s.expected >= from && s.expected < to)
    if (inside.length === 0) continue
    buckets.push({
      from,
      to: Math.min(to, 1),
      count: inside.length,
      expected: inside.reduce((sum, s) => sum + s.expected, 0) / inside.length,
      actual: inside.filter((s) => s.survived).length / inside.length,
    })
  }

  return {
    count,
    matches: store.matches,
    pending: Object.keys(store.open).length,
    expected,
    actual,
    buckets,
  }
}

export function useCalibration(
  view: PlayerView | null,
  advice: Advice | null,
  adviceVersion: number | null,
): { calibration: Calibration; reset: () => void } {
  const [store, setStore] = useState<Store>(() => load())

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
      const fresh = current.openMatch === matchId ? current : { ...current, openMatch: matchId, open: {} }
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
      const settled = Object.values(current.open).map((expected) => ({ expected, survived }))
      if (settled.length === 0) return current
      return {
        samples: [...current.samples, ...settled].slice(-LIMIT),
        matches: current.matches + 1,
        openMatch: null,
        open: {},
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
