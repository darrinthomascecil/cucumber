import {
  findQualifyingPlay,
  forcedLowRequirement,
  sortByTrickStrength,
} from '@cucumber/game-engine'
import type { ClientCommand, PlayerView } from '@cucumber/shared'

let counter = 0

function envelope(view: PlayerView) {
  return {
    matchId: view.matchId,
    expectedVersion: view.version,
    actionId: `auto-${view.version}-${view.you.seat}-${counter++}`,
  }
}

/**
 * Decides a legal action from nothing but the sanitised view — the same
 * information a real browser has. If this can do it, a client can.
 */
export function nextCommand(view: PlayerView): ClientCommand | null {
  const hand = view.you.hand
  switch (view.prompt.kind) {
    case 'READY':
      return view.you.ready ? null : { type: 'READY', ready: true, ...envelope(view) }
    case 'SELECT_EXCHANGE_SIZE':
      return { type: 'SELECT_EXCHANGE_SIZE', size: 2, ...envelope(view) }
    case 'SELECT_EXCHANGE':
      return { type: 'SELECT_EXCHANGE', size: view.prompt.options?.[1] ?? 0, ...envelope(view) }
    case 'SUBMIT_DISCARDS':
      return {
        type: 'SUBMIT_DISCARDS',
        cards: sortByTrickStrength(hand).slice(0, view.prompt.requiredCards ?? 0),
        ...envelope(view),
      }
    case 'LEAD':
      return {
        type: 'PLAY_CARDS',
        cards: [sortByTrickStrength(hand)[0] as string],
        ...envelope(view),
      }
    case 'FOLLOW': {
      const target = view.trick?.targetCards ?? []
      const play = findQualifyingPlay(hand, target)
      if (!play) return null
      return { type: 'PLAY_CARDS', cards: play, ...envelope(view) }
    }
    case 'FORCED_LOW': {
      const n = view.prompt.requiredCards ?? 0
      const forced = forcedLowRequirement(hand, n)
      return {
        type: 'PLAY_CARDS',
        cards: [...forced.mandatory, ...forced.choices.slice(0, forced.chooseCount)],
        ...envelope(view),
      }
    }
    case 'NEXT_MATCH':
      return { type: 'START_NEXT_MATCH', ...envelope(view) }
    default:
      return null
  }
}
