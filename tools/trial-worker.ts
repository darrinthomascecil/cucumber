/** One core's worth of self-play. Long-lived: the pool feeds it tasks. */
import { parentPort } from 'node:worker_threads'
import {
  heuristicPlayer,
  searchPlayer,
  simplePlayer,
  trial,
  xorshift,
  type Player,
  type Weights,
} from '@cucumber/strategy'

export interface TrialTask {
  id: number
  subject: Weights | 'simple'
  opponent: Weights | 'simple'
  matches: number
  seed: number
  startIndex: number
  /** When set, the subject searches instead of guessing. */
  worlds?: number
  exchange?: number
}

export interface TrialResult {
  id: number
  losses: number
  matches: number
  hands: number
}

function build(spec: Weights | 'simple', seed: number, worlds?: number, exchange = 3): Player {
  if (spec === 'simple') return simplePlayer('simple')
  if (worlds && worlds > 0) return searchPlayer('search', spec, xorshift(seed), worlds, exchange)
  return heuristicPlayer('heuristic', spec, exchange)
}

parentPort?.on('message', (task: TrialTask) => {
  const subject = build(task.subject, task.seed ^ 0x9e3779b9, task.worlds, task.exchange)
  const opponent = build(task.opponent, task.seed ^ 0x51ed270b, undefined, task.exchange)
  const outcome = trial(subject, opponent, task.matches, xorshift(task.seed), task.startIndex)
  const result: TrialResult = {
    id: task.id,
    losses: Math.round(outcome.lossRate * task.matches),
    matches: task.matches,
    hands: outcome.averageHands * task.matches,
  }
  parentPort?.postMessage(result)
})
