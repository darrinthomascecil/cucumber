import type { CardId, PlayerView } from '@cucumber/shared'
import { shuffle, type Rng } from '../deck.ts'
import { findQualifyingPlay } from '../legalMove.ts'
import { isSevenOrJoker, leadGroup, scoreValue, sortByTrickStrength, trickStrength } from '../ranking.ts'
import { actionKey, legalActions, type AdvisorAction } from './actions.ts'

export const POLICY_NAMES = ['greedy', 'careful', 'random'] as const
export type PolicyName = (typeof POLICY_NAMES)[number]
export const DEFAULT_EXPLORATION = 0.05

export function identityProbability(hand: readonly CardId[], action: AdvisorAction): number {
  if (!('cards' in action)) return 1
  if (new Set(action.cards).size !== action.cards.length || action.cards.some((card) => !hand.includes(card))) return 0
  const groups = new Map<string, number>()
  for (const card of action.cards) groups.set(leadGroup(card), (groups.get(leadGroup(card)) ?? 0) + 1)
  let probability = 1
  for (const [group, count] of groups) {
    const available = hand.filter((card) => leadGroup(card) === group).length
    for (let index = 1; index <= count; index++) probability *= index / (available - index + 1)
  }
  return probability
}

function chooseIdentities(view: PlayerView, action: AdvisorAction, rng: Rng): AdvisorAction {
  if (!('cards' in action)) return action
  const groups = new Map<string, number>()
  for (const card of action.cards) groups.set(leadGroup(card), (groups.get(leadGroup(card)) ?? 0) + 1)
  return { ...action, cards: [...groups].flatMap(([group, count]) => shuffle(view.you.hand.filter((card) => leadGroup(card) === group), rng).slice(0, count)) }
}

export function handCost(hand: readonly CardId[]): number {
  if (hand.length === 0) return Infinity
  if (hand.length === 1) return scoreValue(hand[0]!) + (isSevenOrJoker(hand[0]!) ? 100 : 0)
  const groups = new Map<string, number>()
  for (const card of hand) groups.set(leadGroup(card), (groups.get(leadGroup(card)) ?? 0) + 1)
  const grouping = [...groups.values()].reduce((sum, count) => sum + count * (count - 1), 0)
  return Math.min(...hand.map(scoreValue)) * 1.8
    + hand.reduce((sum, card) => sum + scoreValue(card), 0) / hand.length * 0.25
    + hand.filter(isSevenOrJoker).length * 2.5
    - hand.reduce((sum, card) => sum + trickStrength(card), 0) * 0.06
    - grouping * 0.3
}

export function actionCost(view: PlayerView, action: AdvisorAction): number {
  if (!('cards' in action)) return 0
  const remaining = view.you.hand.filter((card) => !action.cards.includes(card))
  const control = view.prompt.kind === 'LEAD'
    ? action.cards.reduce((sum, card) => sum + trickStrength(card), 0) * 0.08
    : 0
  return handCost(remaining) - control
}

export function preferredAction(view: PlayerView, policy: Exclude<PolicyName, 'random'>, available?: AdvisorAction[]): AdvisorAction {
  if (view.prompt.kind === 'SELECT_EXCHANGE_SIZE') return { type: 'SELECT_EXCHANGE_SIZE', size: 3 }
  if (view.prompt.kind === 'SELECT_EXCHANGE') return { type: 'SELECT_EXCHANGE', size: view.prompt.options?.[1] ?? 0 }
  if (policy === 'greedy') {
    const hand = sortByTrickStrength([...view.you.hand].sort())
    if (view.prompt.kind === 'LEAD') return { type: 'PLAY_CARDS', cards: [hand[0]!] }
    if (view.prompt.kind === 'FOLLOW') return { type: 'PLAY_CARDS', cards: findQualifyingPlay(hand, view.trick!.targetCards)! }
    if (view.prompt.kind === 'SUBMIT_DISCARDS') return { type: 'SUBMIT_DISCARDS', cards: hand.slice(0, view.prompt.requiredCards) }
  }
  if (view.prompt.kind === 'SUBMIT_DISCARDS') {
    let remaining = [...view.you.hand].sort()
    const cards: CardId[] = []
    for (let count = 0; count < (view.prompt.requiredCards ?? 0); count++) {
      const candidates = [...new Map(remaining.map((card) => [leadGroup(card), card])).values()]
      let best = candidates[0]!
      let bestCost = Infinity
      for (const candidate of candidates) {
        const cost = handCost(remaining.filter((card) => card !== candidate))
        if (cost < bestCost) { best = candidate; bestCost = cost }
      }
      cards.push(best)
      remaining = remaining.filter((card) => card !== best)
    }
    return { type: 'SUBMIT_DISCARDS', cards }
  }
  const actions = available ?? legalActions(view)
  if (actions.length === 0) throw new Error('No action available for this player')
  let best = actions[0]!
  let bestCost = actionCost(view, best)
  for (const action of actions.slice(1)) {
    const cost = actionCost(view, action)
    if (cost < bestCost) { best = action; bestCost = cost }
  }
  return best
}

export function choosePolicyAction(
  view: PlayerView,
  policy: PolicyName,
  rng: Rng,
  exploration = DEFAULT_EXPLORATION,
): AdvisorAction {
  if (policy !== 'random' && rng(1_000_000) >= exploration * 1_000_000) return chooseIdentities(view, preferredAction(view, policy), rng)
  const actions = legalActions(view)
  const action = actions[rng(actions.length)]
  if (!action) throw new Error('No action available for this player')
  return chooseIdentities(view, action, rng)
}

export function policyProbabilities(
  view: PlayerView,
  observed: AdvisorAction,
  exploration = DEFAULT_EXPLORATION,
): number[] {
  const actions = legalActions(view)
  const observedKey = actionKey(observed)
  if (!actions.some((action) => actionKey(action) === observedKey)) return POLICY_NAMES.map(() => 0)
  const randomChance = 1 / actions.length
  return POLICY_NAMES.map((policy) => policy === 'random'
    ? randomChance
    : exploration * randomChance + (actionKey(preferredAction(view, policy, actions)) === observedKey ? 1 - exploration : 0))
}