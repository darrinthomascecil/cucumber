import type { CardId, ClientCommand, PlayerView } from '@cucumber/shared'
import { beatsTarget, forcedLowRequirement } from '../legalMove.ts'
import { leadGroup, sortByTrickStrength, trickStrength } from '../ranking.ts'

export type AdvisorAction =
  | { type: 'PLAY_CARDS'; cards: CardId[] }
  | { type: 'SUBMIT_DISCARDS'; cards: CardId[] }
  | { type: 'SELECT_EXCHANGE_SIZE'; size: number }
  | { type: 'SELECT_EXCHANGE'; size: number }
  | { type: 'READY'; ready: boolean }
  | { type: 'START_NEXT_MATCH' }

export function rankSelections(hand: readonly CardId[], count: number): CardId[][] {
  if (!Number.isInteger(count) || count < 0 || count > hand.length) return []
  const groups = new Map<string, CardId[]>()
  for (const card of sortByTrickStrength([...hand].sort())) {
    const group = leadGroup(card)
    groups.set(group, [...(groups.get(group) ?? []), card])
  }
  const values = [...groups.values()]
  const result: CardId[][] = []
  function visit(index: number, needed: number, chosen: CardId[]): void {
    if (needed === 0) {
      result.push(chosen)
      return
    }
    const group = values[index]
    if (!group) return
    for (let take = 0; take <= Math.min(group.length, needed); take++) {
      visit(index + 1, needed - take, [...chosen, ...group.slice(0, take)])
    }
  }
  visit(0, count, [])
  return result
}

export function legalActions(view: PlayerView): AdvisorAction[] {
  const hand = view.you.hand
  switch (view.prompt.kind) {
    case 'LEAD': {
      const groups = new Map<string, CardId[]>()
      for (const card of sortByTrickStrength([...hand].sort())) {
        const group = leadGroup(card)
        groups.set(group, [...(groups.get(group) ?? []), card])
      }
      return [...groups.values()].flatMap((cards) =>
        Array.from({ length: Math.min(cards.length, hand.length - 1) }, (_, index) => ({
          type: 'PLAY_CARDS' as const,
          cards: cards.slice(0, index + 1),
        })),
      )
    }
    case 'FOLLOW':
      return rankSelections(hand, view.prompt.requiredCards ?? 0)
        .filter((cards) => beatsTarget(cards, view.trick!.targetCards))
        .map((cards) => ({ type: 'PLAY_CARDS', cards }))
    case 'FORCED_LOW': {
      const forced = forcedLowRequirement([...hand].sort(), view.prompt.requiredCards ?? 0)
      return [{ type: 'PLAY_CARDS', cards: [...forced.mandatory, ...forced.choices.slice(0, forced.chooseCount)] }]
    }
    case 'SUBMIT_DISCARDS':
      return rankSelections(hand, view.prompt.requiredCards ?? 0).map((cards) => ({ type: 'SUBMIT_DISCARDS', cards }))
    case 'SELECT_EXCHANGE_SIZE':
      return (view.prompt.options ?? [0, 1, 2, 3, 4, 5]).map((size) => ({ type: 'SELECT_EXCHANGE_SIZE', size }))
    case 'SELECT_EXCHANGE':
      return (view.prompt.options ?? []).map((size) => ({ type: 'SELECT_EXCHANGE', size }))
    case 'READY':
      return view.you.ready ? [] : [{ type: 'READY', ready: true }]
    case 'NEXT_MATCH':
      return [{ type: 'START_NEXT_MATCH' }]
    default:
      return []
  }
}

export function actionKey(action: AdvisorAction): string {
  if ('cards' in action) return `${action.type}:${action.cards.map(trickStrength).sort((left, right) => left - right).join(',')}`
  if ('size' in action) return `${action.type}:${action.size}`
  if ('ready' in action) return `${action.type}:${action.ready}`
  return action.type
}

export function advisorCommand(view: PlayerView, action: AdvisorAction): ClientCommand {
  return { ...action, matchId: view.matchId, expectedVersion: view.version, actionId: `advisor-${view.version}` }
}