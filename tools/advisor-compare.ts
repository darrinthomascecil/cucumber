/**
 * Which of the two forecasters is more honest, at equal cost?
 *
 *   node --experimental-strip-types tools/advisor-compare.ts [matches] [shard] [shards] [dump.json]
 *   node --experimental-strip-types tools/advisor-compare.ts combine dump.json...
 *
 * Both are asked the same question at the same position and scored against
 * the same outcome. The design decisions are all in ADVISOR-CHOICE.md; the
 * three that shape this file:
 *
 * **Matched cost, not matched parameters.** tools/advisor-cost.ts measured the
 * belief model at 126.6 ms/decision at its *cheapest* setting and the strategy
 * advisor at 96.3 ms at 2,560 worlds — 16× the 160 it ships with. Running it
 * at 160 would hand the belief model a 16× compute advantage and call the
 * result a difference of method.
 *
 * **The intersection only.** tools/advisor-coverage.ts found the belief model
 * answers 92.1% of observer decisions and the strategy advisor 84.5%, with
 * *zero* positions the strategy advisor answers and the belief model does not.
 * So the comparable set is the strict intersection and is not biased toward
 * either side.
 *
 * **This is the belief model's home field.** The opponents are drawn from
 * POLICY_NAMES, the same policy set its prior is over, so its model of the
 * opposition is correct by construction. That makes the reading asymmetric,
 * and it was written down before the run: the strategy advisor winning here is
 * decisive, the belief model winning here is confounded.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { SEATS, type PlayerView, type Seat } from '@cucumber/shared'
import { brierBand, decompose, type Claim } from '@cucumber/strategy'
import { actionSeat, applyCommand, createMatch, setConnection } from '../packages/game-engine/src/stateMachine.ts'
import { viewFor } from '../packages/game-engine/src/view.ts'
import { advisorCommand } from '../packages/game-engine/src/advisor/actions.ts'
import { forecastLoss } from '../packages/game-engine/src/advisor/forecast.ts'
import { advisorRng } from '../packages/game-engine/src/advisor/random.ts'
import { choosePolicyAction, POLICY_NAMES, type PolicyName } from '../packages/game-engine/src/advisor/policy.ts'
import { calibrate, fitCalibration } from '../packages/game-engine/src/advisor/metrics.ts'

import { strategyForecast } from './strategy-model.ts'

/** The matched pair from tools/advisor-cost.ts. */
const STRATEGY_WORLDS = 2560
const BELIEF = { particles: 24, simulations: 32 }

interface MatchRows {
  match: number
  /** P(observer loses), one pair per position both answered. */
  strategy: number[]
  belief: number[]
  lost: boolean
}

function rng(tag: string, index: number) {
  let hash = 2166136261
  const text = `${tag}:${index}`
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return advisorRng(hash >>> 0)
}

function playOne(m: number): MatchRows | null {
  const context = { rng: rng('deal', m) }
  const policies: Record<Seat, PolicyName> = {
    1: POLICY_NAMES[m % POLICY_NAMES.length]!,
    2: POLICY_NAMES[(m + 1) % POLICY_NAMES.length]!,
    3: POLICY_NAMES[(m + 2) % POLICY_NAMES.length]!,
  }
  const choices: Record<Seat, ReturnType<typeof advisorRng>> = {
    1: rng('a1', m), 2: rng('a2', m), 3: rng('a3', m),
  }
  const observer = ((m % 3) + 1) as Seat
  const rows: MatchRows = { match: m, strategy: [], belief: [], lost: false }

  let state = createMatch(`compare:${m}`, SEATS.map((s) => ({ userId: `seat-${s}`, displayName: `Seat ${s}` })))
  for (const seat of SEATS) state = setConnection(state, seat, 'ONLINE', context).state

  for (let turn = 0; turn < 512; turn++) {
    const seat = actionSeat(state) ?? state.players.find((p) => !p.ready)?.seat
    if (!seat) break
    const view: PlayerView = viewFor(state, seat)

    if (seat === observer && view.phase === 'TRICK_PLAY') {
      const s = strategyForecast(view, seat, { worlds: STRATEGY_WORLDS, seed: 4242 })
      let b: number | null = null
      try {
        const forecast = forecastLoss(view, BELIEF)
        const p = forecast.probabilities[seat]
        if (Number.isFinite(p)) b = p
      } catch {
        b = null
      }
      // Both or neither: a position one of them declined is not a comparison.
      if (s !== null && b !== null) {
        rows.strategy.push(s.probability)
        rows.belief.push(b)
      }
    }

    state = applyCommand(state, seat, advisorCommand(view, choosePolicyAction(view, policies[seat], choices[seat])), context).state
    if (state.phase === 'MATCH_OVER') break
  }

  if (rows.strategy.length === 0) return null
  rows.lost = state.losers.includes(observer)
  return rows
}

function report(all: MatchRows[]): void {
  const claims = (pick: (r: MatchRows) => number[]): Claim[] =>
    all.flatMap((r) => pick(r).map((p) => ({ p, y: r.lost ? 1 : 0 })))
  const perMatch = (pick: (r: MatchRows) => number[]): number[] =>
    all.map((r) => {
      const y = r.lost ? 1 : 0
      const ps = pick(r)
      return ps.reduce((sum, p) => sum + (p - y) ** 2, 0) / ps.length
    })

  const s = decompose(claims((r) => r.strategy))
  const b = decompose(claims((r) => r.belief))
  const sBand = brierBand(perMatch((r) => r.strategy))
  const bBand = brierBand(perMatch((r) => r.belief))

  // Paired, because both saw the identical positions: the difference per
  // match has far less variance than the difference of two independent means.
  const sm = perMatch((r) => r.strategy)
  const bm = perMatch((r) => r.belief)
  const diffs = sm.map((v, i) => v - bm[i]!)
  const mean = diffs.reduce((a, c) => a + c, 0) / diffs.length
  const sd = Math.sqrt(diffs.reduce((a, c) => a + (c - mean) ** 2, 0) / (diffs.length - 1))
  const se = sd / Math.sqrt(diffs.length)

  const f = (x: number) => x.toFixed(4)
  const positions = all.reduce((n, r) => n + r.strategy.length, 0)
  console.log(`advisor comparison — ${all.length} matches, ${positions} positions both answered`)
  console.log(`  strategy at ${STRATEGY_WORLDS} worlds vs belief at ${BELIEF.particles}/${BELIEF.simulations} — matched on measured cost`)
  console.log(`  observer lost ${(100 * all.filter((r) => r.lost).length / all.length).toFixed(1)}% of matches`)
  console.log('')
  console.log('                       Brier        uncertainty  − resolution  + reliability')
  console.log(`  strategy advisor   ${f(s.brier)} ± ${f(sBand)}   ${f(s.uncertainty)}     ${f(s.resolution)}       ${f(s.reliability)}`)
  console.log(`  belief model       ${f(b.brier)} ± ${f(bBand)}   ${f(b.uncertainty)}     ${f(b.resolution)}       ${f(b.reliability)}`)
  console.log('')
  console.log(`  paired difference (strategy − belief)  ${mean >= 0 ? '+' : ''}${f(mean)}  se ${f(se)}  ${(Math.abs(mean) / se).toFixed(1)}σ`)
  console.log(`  ${mean < 0 ? 'strategy advisor is better' : 'belief model is better'}${Math.abs(mean) / se < 2 ? ' — but inside 2σ, so not established' : ''}`)
}

/**
 * What each forecaster is worth once its miscalibration is removed.
 *
 * Reliability is the fixable half of a Brier score — a monotone recalibration
 * changes no ordering, so it cannot add information, only stop wasting it.
 * Resolution is the half that cannot be conjured. If one forecaster carries
 * much more resolution and loses it to reliability, the comparison at face
 * value is measuring the wrong thing.
 *
 * Fitted on the first half of the matches and scored on the second, never
 * in-sample: an earlier attempt at exactly this on browser data fitted
 * beautifully and made the out-of-sample Brier *worse*, which is what an
 * in-sample number would have hidden.
 */
function calibrated(all: MatchRows[]): void {
  const cut = Math.floor(all.length / 2)
  const train = all.slice(0, cut)
  const test = all.slice(cut)
  const rows = (set: MatchRows[], pick: (r: MatchRows) => number[]) =>
    set.flatMap((r) => pick(r).map((p) => ({ probability: p, outcome: r.lost ? 1 : 0, match: String(r.match) })))

  console.log('')
  console.log(`  recalibrated — fitted on ${train.length} matches, scored on ${test.length}`)
  for (const [name, pick] of [
    ['strategy advisor', (r: MatchRows) => r.strategy],
    ['belief model', (r: MatchRows) => r.belief],
  ] as const) {
    const model = fitCalibration(rows(train, pick))
    const before = rows(test, pick)
    const raw = before.reduce((sum, o) => sum + (o.probability - o.outcome) ** 2, 0) / before.length
    const after = before.reduce((sum, o) => sum + (calibrate(o.probability, model) - o.outcome) ** 2, 0) / before.length
    const arrow = after < raw ? 'better' : 'worse'
    console.log(`    ${name.padEnd(18)} ${raw.toFixed(4)} -> ${after.toFixed(4)}  (${arrow} by ${Math.abs(raw - after).toFixed(4)})`)
  }
}

const [first, ...rest] = process.argv.slice(2)

if (first === 'combine') {
  const all: MatchRows[] = rest.flatMap((file) => JSON.parse(readFileSync(file, 'utf8')) as MatchRows[])
  all.sort((x, y) => x.match - y.match)
  report(all)
  calibrated(all)
} else {
  const matches = Number(first ?? 200)
  const shard = Number(rest[0] ?? 0)
  const shards = Number(rest[1] ?? 1)
  const dump = rest[2]

  const out: MatchRows[] = []
  for (let m = 0; m < matches; m++) {
    if (m % shards !== shard) continue
    const row = playOne(m)
    if (row) out.push(row)
  }
  if (dump) {
    writeFileSync(dump, JSON.stringify(out))
    console.log(`shard ${shard}/${shards}: ${out.length} matches -> ${dump}`)
  } else {
    report(out)
  }
}
