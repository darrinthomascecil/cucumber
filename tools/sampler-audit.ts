/**
 * How often does the world sampler return a world that cannot exist?
 *
 *   node --experimental-strip-types tools/sampler-audit.ts [matches] [worldsPerDecision]
 *
 * ALGORITHM-REVIEW-2.md proves the sampler's consistency guarantee false: on a
 * constructed position it returns worlds contradicting a recorded failure
 * 8.79% of the time. The last fallback calls `repair`, which gives up silently
 * when the leftover pool cannot supply a weak enough card, and the caller
 * returns that hand without ever re-checking it.
 *
 * What that review could not say is how often it happens in *ordinary play* —
 * it noted the repair path "was not entered in the ordinary population I
 * sampled". That is the number this measures, because everything downstream
 * (the Brier harness, and the honest oracle H4 will build on) samples worlds
 * from positions that arise in real games, not from constructed ones.
 *
 * It audits without changing how anything plays: the wrapper samples worlds
 * from each position and then hands the decision straight to the real policy.
 */
import {
  TUNED,
  consistentWith,
  heuristicPlayer,
  sampleFullWorld,
  searchPolicy,
  trial,
  weightedDiscards,
  xorshift,
  type InfoSet,
  type Player,
  type Policy,
} from '@cucumber/strategy'

const matches = Number(process.argv[2] ?? 200)
const perDecision = Number(process.argv[3] ?? 40)
const WORLDS = 160

let decisions = 0
let audited = 0
let sampled = 0
let contradictory = 0
/** Decisions where at least one sampled world was impossible. */
let poisoned = 0
let withFailures = 0

const random = xorshift(87123)

/** Plays exactly as the search policy does, and counts what it samples. */
function auditing(inner: Policy): Policy {
  return (view, candidates) => {
    decisions++
    // The same InfoSet the search builds, full failure history included —
    // this is the benchmark path, the one the review says retains both
    // failures. The live browser advisor keeps only the current trick.
    const info: InfoSet = {
      seat: view.seat,
      hand: view.hand,
      played: view.played,
      mine: view.mine,
      handSizes: view.handSizes,
      scores: view.scores,
      failures: view.failures,
    }

    const constrained = ([0, 1, 2] as const).filter(
      (seat) => seat !== view.seat && (info.failures?.[seat]?.length ?? 0) > 0,
    )
    if (constrained.length > 0) {
      withFailures++
      audited++
      let bad = 0
      for (let i = 0; i < perDecision; i++) {
        const world = sampleFullWorld(info, random)
        sampled++
        for (const seat of constrained) {
          if (!consistentWith(world.hands[seat]!, info.failures![seat]!)) {
            bad++
            break
          }
        }
      }
      contradictory += bad
      if (bad > 0) poisoned++
    }

    return inner(view, candidates)
  }
}

const subject: Player = {
  name: 'audited',
  policy: auditing(searchPolicy(xorshift(4242), { worlds: WORLDS, weights: TUNED })),
  exchangeSize: () => 3,
  takeExchange: (_hand, size) => size,
  discards: weightedDiscards(TUNED),
}

const started = Date.now()
const outcome = trial(subject, heuristicPlayer('tuned', TUNED), matches, xorshift(8080))
const seconds = (Date.now() - started) / 1000

const pct = (n: number, d: number) => (d === 0 ? '—' : `${((100 * n) / d).toFixed(3)}%`)
/** Wilson 95%, because at a rate near zero the normal approximation lies. */
function wilson(k: number, n: number): string {
  if (n === 0) return '—'
  const z = 1.96
  const p = k / n
  const d = 1 + (z * z) / n
  const c = (p + (z * z) / (2 * n)) / d
  const s = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return `${(100 * Math.max(0, c - s)).toFixed(3)}–${(100 * Math.min(1, c + s)).toFixed(3)}%`
}

console.log(`sampler audit — ${matches} matches, ${perDecision} worlds per constrained decision`)
console.log(`  ${seconds.toFixed(1)}s, subject loses ${(outcome.lossRate * 100).toFixed(2)}%`)
console.log('')
console.log(`  decisions seen                 ${decisions}`)
console.log(`  with a recorded failure        ${withFailures}  (${pct(withFailures, decisions)} of decisions)`)
console.log(`  worlds sampled from those      ${sampled}`)
console.log(`  worlds that cannot exist       ${contradictory}  (${pct(contradictory, sampled)}, 95% CI ${wilson(contradictory, sampled)})`)
console.log(`  decisions with any bad world   ${poisoned}  (${pct(poisoned, audited)} of audited)`)
console.log('')
console.log('  For comparison, ALGORITHM-REVIEW-2 measured 8.79% on a constructed position.')
