/** One core's worth of self-play. Long-lived: the pool feeds it tasks. */
import { parentPort } from 'node:worker_threads'
import {
  archetypePlayer,
  heuristicPlayer,
  oracleTrial,
  searchPlayer,
  simplePlayer,
  trial,
  xorshift,
  type Player,
  type Weights,
} from '@cucumber/strategy'

/** A player is either a weight vector or the name of a rule-based archetype. */
export type PlayerSpec = Weights | string

export interface TrialTask {
  id: number
  subject: PlayerSpec
  opponent: PlayerSpec
  matches: number
  seed: number
  startIndex: number
  /** When set, the subject searches instead of guessing. */
  worlds?: number
  exchange?: number
  /** Diagnostic: the subject is shown every hand at the table. */
  oracle?: boolean
  /** Narrow the imagined deals using public failures. Default on. */
  inference?: boolean
}

export interface TrialResult {
  id: number
  losses: number
  matches: number
  hands: number
}

function build(
  spec: PlayerSpec,
  seed: number,
  worlds?: number,
  exchange = 3,
  inference = true,
): Player {
  if (typeof spec === 'string') {
    return spec === 'simple' ? simplePlayer('simple') : archetypePlayer(spec, exchange)
  }
  if (worlds && worlds > 0) {
    return searchPlayer('search', spec, xorshift(seed), worlds, exchange, inference)
  }
  return heuristicPlayer('heuristic', spec, exchange)
}

parentPort?.on('message', (task: TrialTask) => {
  if (task.oracle) {
    const measured = oracleTrial(
      task.subject as Weights,
      task.matches,
      xorshift(task.seed),
      task.startIndex,
    )
    parentPort?.postMessage({
      id: task.id,
      losses: Math.round(measured.lossRate * task.matches),
      matches: task.matches,
      hands: 0,
    } satisfies TrialResult)
    return
  }
  const subject = build(
    task.subject,
    task.seed ^ 0x9e3779b9,
    task.worlds,
    task.exchange,
    task.inference !== false,
  )
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
