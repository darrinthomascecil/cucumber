import { sortByTrickStrength } from '@cucumber/game-engine'
import type { ClientCommand, PlayerView } from '@cucumber/shared'
import { advise, type SeatMemory } from './advise.ts'

type WithoutEnvelope<T> = T extends unknown ? Omit<T, 'matchId' | 'expectedVersion' | 'actionId'> : never

/** A command before a connection stamps the match, version and action id on it. */
export type SeatDecision = WithoutEnvelope<ClientCommand>

export interface SeatDecisionOptions {
  /** Imagined deals per decision. Fewer is faster; 160 is what the tool used. */
  worlds?: number
  seed?: number
}

/**
 * What a seat should do next, from nothing but its sanitised view.
 *
 * This is the brain shared by every stand-in player: the development seat
 * fillers, the server's own computer players, and nothing else. It thinks with
 * the tuned strategy, searched over imagined deals, exactly as the in-game
 * advisor does — because it *is* the advisor, asked to commit.
 *
 * Starting the next match is deliberately not a decision it makes. A table
 * that deals itself a fresh match the instant one ends is not something a
 * person wants to walk away from.
 */
export function decideForSeat(
  view: PlayerView,
  memory: SeatMemory,
  options: SeatDecisionOptions = {},
): SeatDecision | null {
  const hand = view.you.hand
  /*
   * A discard that was refused and re-sent would otherwise be remembered
   * twice, and a card still in hand was plainly never discarded at all. Both
   * make the advisor believe more cards exist than the deck holds.
   */
  const seen: SeatMemory = {
    discarded: [...new Set(memory.discarded)].filter((card) => !hand.includes(card)),
  }
  const worlds = options.worlds ?? 160
  // Derived from the position, so the same position always gets the same answer.
  const seed = options.seed ?? (view.version * 2654435761 + view.you.seat) >>> 0

  switch (view.prompt.kind) {
    case 'READY':
      return view.you.ready ? null : { type: 'READY', ready: true }

    case 'SELECT_EXCHANGE_SIZE':
      // Never searched: the exchange size is the one decision self-play has
      // not been asked about. Three is the figure everything was tuned under.
      return { type: 'SELECT_EXCHANGE_SIZE', size: 3 }

    case 'SELECT_EXCHANGE':
      return { type: 'SELECT_EXCHANGE', size: view.prompt.options?.[1] ?? 0 }

    case 'SUBMIT_DISCARDS': {
      const required = view.prompt.requiredCards ?? 0
      const advice = advise(view, seen, { worlds, seed })
      const chosen = advice.suggestions[0]?.cards
      return {
        type: 'SUBMIT_DISCARDS',
        // The advisor is approximate here, so fall back on the worst cards.
        cards: chosen?.length === required ? chosen : sortByTrickStrength(hand).slice(0, required),
      }
    }

    case 'LEAD':
    case 'FOLLOW':
    case 'FORCED_LOW': {
      const advice = advise(view, seen, { worlds, seed })
      const chosen = advice.suggestions[0]?.cards
      if (chosen && chosen.length > 0) return { type: 'PLAY_CARDS', cards: chosen }
      // Only reachable if the search returned nothing; play something legal.
      const required = view.prompt.requiredCards ?? 1
      const allowed = view.prompt.selectableCards ?? hand
      return { type: 'PLAY_CARDS', cards: sortByTrickStrength(allowed).slice(0, required) }
    }

    case 'NEXT_MATCH':
      return null

    default:
      return null
  }
}
