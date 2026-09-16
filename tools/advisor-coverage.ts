/**
 * Which positions does each forecaster actually answer?
 *
 *   node --experimental-strip-types tools/advisor-coverage.ts [matches] [worlds]
 *
 * Before comparing two forecasters on quality, find out what each of them
 * declines. The belief model refuses positions without complete history or
 * exchange counts, and refuses phases outside trick play; the strategy advisor
 * declines where it has no view-based opinion. If one of them declines the
 * *hard* positions — short hands, scores near the limit — then scoring both on
 * the intersection flatters it, and the comparison that follows is measuring
 * the sampling, not the forecaster.
 *
 * So this counts, and characterises what was left out. It deliberately does
 * not score anything: coverage is a separate question from accuracy and
 * answering both at once is how a selection effect gets buried.
 */
import { SEATS, type PlayerView, type Seat } from '@cucumber/shared'
import { actionSeat, applyCommand, createMatch, setConnection } from '../packages/game-engine/src/stateMachine.ts'
import { viewFor } from '../packages/game-engine/src/view.ts'
import { advisorCommand } from '../packages/game-engine/src/advisor/actions.ts'
import { forecastLoss } from '../packages/game-engine/src/advisor/forecast.ts'
import { advisorRng } from '../packages/game-engine/src/advisor/random.ts'
import { choosePolicyAction, POLICY_NAMES, type PolicyName } from '../packages/game-engine/src/advisor/policy.ts'
import { LOSS_LIMIT } from '../packages/game-engine/src/scoring.ts'
import { strategyForecast } from './strategy-model.ts'

const matches = Number(process.argv[2] ?? 60)
const worlds = Number(process.argv[3] ?? 80)

interface Seen {
  handSize: number
  /** How close this seat is to losing: 0 at zero, 1 at the limit. */
  pressure: number
  phase: string
  belief: boolean
  strategy: boolean
  beliefWhy?: string
}

const seen: Seen[] = []

/** Deterministic per match, so a rerun measures the same positions. */
function rng(tag: string, index: number) {
  let hash = 2166136261
  const text = `${tag}:${index}`
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return advisorRng(hash >>> 0)
}

function ask(view: PlayerView, seat: Seat): Seen {
  const record: Seen = {
    handSize: view.you.hand.length,
    pressure: Math.min(1, view.you.score / LOSS_LIMIT),
    phase: view.phase,
    belief: false,
    strategy: false,
  }

  try {
    const forecast = forecastLoss(view, { particles: 24, simulations: 24 })
    record.belief = Number.isFinite(forecast.probabilities[seat])
  } catch (error) {
    // The refusal reason matters: "no history" is a data problem that could be
    // fixed, "wrong phase" is a scope choice that cannot.
    record.beliefWhy = String((error as Error).message).slice(0, 60)
  }

  record.strategy = strategyForecast(view, seat, { worlds, seed: 4242 }) !== null
  return record
}

for (let m = 0; m < matches; m++) {
  const identity = `coverage:${m}`
  const context = { rng: rng('deal', m) }
  const policies: Record<Seat, PolicyName> = {
    1: POLICY_NAMES[m % POLICY_NAMES.length]!,
    2: POLICY_NAMES[(m + 1) % POLICY_NAMES.length]!,
    3: POLICY_NAMES[(m + 2) % POLICY_NAMES.length]!,
  }
  const choices: Record<Seat, ReturnType<typeof advisorRng>> = {
    1: rng('a1', m),
    2: rng('a2', m),
    3: rng('a3', m),
  }
  const observer = ((m % 3) + 1) as Seat

  let state = createMatch(identity, SEATS.map((seat) => ({ userId: `seat-${seat}`, displayName: `Seat ${seat}` })))
  for (const seat of SEATS) state = setConnection(state, seat, 'ONLINE', context).state

  for (let turn = 0; turn < 512; turn++) {
    const seat = actionSeat(state) ?? state.players.find((player) => !player.ready)?.seat
    if (!seat) break
    const view = viewFor(state, seat)
    // Every decision of the observer's, in every phase. Restricting to trick
    // play would have measured coverage only where the comparison was already
    // expected to work, which is how a scope limit gets mistaken for a result.
    if (seat === observer) seen.push(ask(view, seat))
    const action = choosePolicyAction(view, policies[seat], choices[seat])
    state = applyCommand(state, seat, advisorCommand(view, action), context).state
    if (state.phase === 'MATCH_OVER') break
  }
}

const pct = (k: number, n: number) => (n === 0 ? '—' : `${((100 * k) / n).toFixed(1)}%`)
const both = seen.filter((s) => s.belief && s.strategy)
const beliefOnly = seen.filter((s) => s.belief && !s.strategy)
const strategyOnly = seen.filter((s) => !s.belief && s.strategy)
const neither = seen.filter((s) => !s.belief && !s.strategy)
const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length)

console.log(`coverage — ${matches} matches, ${seen.length} observer decisions in all phases`)
const byPhase = new Map<string, number>()
for (const s of seen) byPhase.set(s.phase, (byPhase.get(s.phase) ?? 0) + 1)
console.log('  phases: ' + [...byPhase].map(([p, n]) => `${p} ${n}`).join(', '))
console.log('')
console.log(`  belief model answered      ${seen.filter((s) => s.belief).length.toString().padStart(5)}  ${pct(seen.filter((s) => s.belief).length, seen.length)}`)
console.log(`  strategy advisor answered  ${seen.filter((s) => s.strategy).length.toString().padStart(5)}  ${pct(seen.filter((s) => s.strategy).length, seen.length)}`)
console.log(`  both (the comparable set)  ${both.length.toString().padStart(5)}  ${pct(both.length, seen.length)}`)
console.log(`  belief only                ${beliefOnly.length.toString().padStart(5)}`)
console.log(`  strategy only              ${strategyOnly.length.toString().padStart(5)}`)
console.log(`  neither                    ${neither.length.toString().padStart(5)}`)
console.log('')
console.log('  Are the declined positions different from the kept ones?')
console.log(`    hand size   both ${mean(both.map((s) => s.handSize)).toFixed(2)}   strategy-only ${mean(strategyOnly.map((s) => s.handSize)).toFixed(2)}`)
console.log(`    pressure    both ${mean(both.map((s) => s.pressure)).toFixed(3)}   strategy-only ${mean(strategyOnly.map((s) => s.pressure)).toFixed(3)}`)

const reasons = new Map<string, number>()
for (const s of seen) if (s.beliefWhy) reasons.set(s.beliefWhy, (reasons.get(s.beliefWhy) ?? 0) + 1)
if (reasons.size > 0) {
  console.log('')
  console.log('  why the belief model declined:')
  for (const [why, n] of [...reasons].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${n.toString().padStart(5)}  ${why}`)
  }
}
