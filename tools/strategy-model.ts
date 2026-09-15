import type { PlayerView, Seat } from '@cucumber/shared'
import { advise, emptyMemory } from '@cucumber/strategy'

/**
 * The `packages/strategy` advisor, wearing this benchmark's interface.
 *
 * Two forecasters in one repository answer the same question — will this seat
 * lose the match — and had never been asked it side by side. They could not
 * be: the strategy advisor is normally driven from the *sim*, which produces a
 * `PolicyView` and never builds an engine view, while everything here takes a
 * `PlayerView`. The meeting point is that `strategy`'s own `advise()` also
 * takes a `PlayerView`, so it fits this harness even though the belief model
 * does not fit that one.
 *
 * It lives in tools/ rather than in the engine because `@cucumber/strategy`
 * already depends on `@cucumber/game-engine`. Putting it the other way round
 * makes a package cycle — one that happens to resolve inside this workspace
 * and would break the moment either package was built on its own.
 *
 * It converts and nothing else. `advise()` reports the probability of *not*
 * losing; this benchmark scores the probability of losing. One subtraction,
 * no reweighting, no calibration — a comparison is only worth running if
 * neither side is quietly helped on its way through.
 */

export interface StrategyForecast {
  /** P(the observing seat loses the match), to match LossForecast's sense. */
  probability: number
  /** Worlds the search actually sampled, for the budget record. */
  worlds: number
  kind: string
}

export interface StrategyOptions {
  worlds?: number
  seed?: number
}

/**
 * Returns null where the strategy advisor has no view-based opinion, rather
 * than substituting a default. A missing forecast and a confident 50% are
 * different things, and only one of them should reach a Brier score.
 */
export function strategyForecast(
  view: PlayerView,
  _observer: Seat,
  options: StrategyOptions = {},
): StrategyForecast | null {
  const advice = advise(view, emptyMemory(), {
    worlds: options.worlds ?? 160,
    seed: options.seed ?? 0x5eed1234,
  })

  // NONE means it declined the position; scoring that would invent an opinion.
  if (advice.kind === 'NONE') return null
  if (!Number.isFinite(advice.winProbability)) return null

  return {
    probability: 1 - advice.winProbability,
    worlds: advice.worlds,
    kind: advice.kind,
  }
}
