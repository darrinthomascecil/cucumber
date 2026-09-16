/**
 * What does a forecast cost, and what budgets make the two comparable?
 *
 *   node --experimental-strip-types tools/advisor-cost.ts [positions]
 *
 * "160 worlds against 128 simulations" compares two arbitrary constants. One
 * of them may simply have been given more compute, and a forecaster with more
 * compute ought to be better — so a win at unmatched budgets tells you nothing
 * about which method is better.
 *
 * This measures wall-clock per decision for both across a grid of budgets, on
 * **the same positions**, so the comparison that follows can be run at a
 * matched cost rather than at whichever numbers each side happened to ship.
 */
import { SEATS, type PlayerView, type Seat } from '@cucumber/shared'
import { actionSeat, applyCommand, createMatch, setConnection } from '../packages/game-engine/src/stateMachine.ts'
import { viewFor } from '../packages/game-engine/src/view.ts'
import { advisorCommand } from '../packages/game-engine/src/advisor/actions.ts'
import { forecastLoss } from '../packages/game-engine/src/advisor/forecast.ts'
import { advisorRng } from '../packages/game-engine/src/advisor/random.ts'
import { choosePolicyAction, POLICY_NAMES, type PolicyName } from '../packages/game-engine/src/advisor/policy.ts'
import { strategyForecast } from './strategy-model.ts'

const wanted = Number(process.argv[2] ?? 40)

function rng(tag: string, index: number) {
  let hash = 2166136261
  const text = `${tag}:${index}`
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return advisorRng(hash >>> 0)
}

/** Real trick-play positions, collected once so every budget sees the same set. */
function collect(count: number): { view: PlayerView; seat: Seat }[] {
  const out: { view: PlayerView; seat: Seat }[] = []
  for (let m = 0; out.length < count && m < count * 4; m++) {
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
    let state = createMatch(`cost:${m}`, SEATS.map((s) => ({ userId: `seat-${s}`, displayName: `Seat ${s}` })))
    for (const seat of SEATS) state = setConnection(state, seat, 'ONLINE', context).state

    for (let turn = 0; turn < 512 && out.length < count; turn++) {
      const seat = actionSeat(state) ?? state.players.find((p) => !p.ready)?.seat
      if (!seat) break
      const view = viewFor(state, seat)
      // One position per match, mid-hand, so the set is not all openings.
      if (seat === observer && view.phase === 'TRICK_PLAY' && view.you.hand.length <= 9) {
        out.push({ view, seat })
        break
      }
      state = applyCommand(state, seat, advisorCommand(view, choosePolicyAction(view, policies[seat], choices[seat])), context).state
      if (state.phase === 'MATCH_OVER') break
    }
  }
  return out
}

const positions = collect(wanted)
if (positions.length === 0) {
  console.log('no positions collected')
  process.exit(1)
}

function time(label: string, run: (p: { view: PlayerView; seat: Seat }) => void): number {
  // One warm pass first: the first call pays for JIT and module init, and
  // charging that to the smallest budget would invert the ranking.
  run(positions[0]!)
  const started = process.hrtime.bigint()
  for (const p of positions) run(p)
  const ms = Number(process.hrtime.bigint() - started) / 1e6 / positions.length
  console.log(`  ${label.padEnd(34)} ${ms.toFixed(1).padStart(8)} ms/decision`)
  return ms
}

console.log(`cost — ${positions.length} real trick-play positions, hand size <= 9`)
console.log('')
console.log('strategy advisor (determinized Monte Carlo)')
const strategy: [number, number][] = []
// Extended far past anything that ships: the belief model's cheapest
// budget costs more than the strategy advisor's dearest, so matching on time
// means pushing the cheap side up, not the dear side down.
for (const worlds of [40, 80, 160, 320, 640, 1280, 2560, 5120]) {
  strategy.push([worlds, time(`worlds ${worlds}`, (p) => strategyForecast(p.view, p.seat, { worlds, seed: 4242 }))])
}

console.log('')
console.log('belief model (particles / simulations)')
const belief: [string, number][] = []
for (const [particles, simulations] of [[24, 32], [48, 64], [96, 128], [192, 256]] as const) {
  belief.push([
    `${particles}/${simulations}`,
    time(`particles ${particles}, sims ${simulations}`, (p) => {
      try {
        forecastLoss(p.view, { particles, simulations })
      } catch {
        // Counted as work attempted; coverage is measured elsewhere.
      }
    }),
  ])
}

console.log('')
console.log('closest matched pair, by wall-clock:')
let best: { s: [number, number]; b: [string, number]; gap: number } | null = null
for (const s of strategy) {
  for (const b of belief) {
    const gap = Math.abs(s[1] - b[1]) / Math.max(s[1], b[1])
    if (!best || gap < best.gap) best = { s, b, gap }
  }
}
console.log(
  `  strategy worlds ${best!.s[0]} (${best!.s[1].toFixed(1)} ms)  vs  belief ${best!.b[0]} (${best!.b[1].toFixed(1)} ms)` +
    `  — ${(best!.gap * 100).toFixed(0)}% apart`,
)
