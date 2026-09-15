/**
 * How good could the advisor's odds possibly be?
 *
 *   node --experimental-strip-types tools/floor.ts [matches] [oracleWorlds]
 *
 * The best forecast at a position is p* = P(survive | everything visible), and
 * no forecaster can score better than E[p*(1 − p*)] — the variance left once
 * you condition on all knowable information. That is the floor. This measures
 * it, and measures the advisor against it, over the same positions.
 *
 * Two estimators, because they fail in opposite directions:
 *
 *   direct   mean of p̂*(1 − p̂*). Needs no outcomes, so far less variance.
 *            Biased *low* by the oracle's own sampling:
 *            E[p̂(1−p̂)] = p(1−p) − v, with v = p(1−p)/K. Add v back.
 *
 *   scored   the Brier of p̂* against what happened. Biased *high* by the same
 *            v, since E[(p̂−y)²] = E[(p−y)²] + v. Subtract v.
 *
 * If they disagree by more than their bands, something is wrong and no floor
 * should be reported. That check is the whole point of computing both.
 *
 * THE CONFIGURATION MATTERS, and getting it wrong produced a nonsense result
 * the first time this ran. p* has to be the probability of the outcome that
 * actually occurs, so whatever the oracle assumes about how the game continues
 * must be what continues. Version one let the *advisor* play the subject seat
 * while the oracle imagined heuristics finishing the job: the oracle said
 * 0.812 where 0.890 survived, and the floor came out above the advisor's
 * Brier — impossible, and the tell. So here the subject plays the tuned
 * heuristic and the advisor only watches. Simulating the advisor inside the
 * oracle is the alternative and costs about a thousand times more: a search
 * playout is 2,300× a heuristic one, and there are hundreds per position.
 *
 * Stated exactly, then: how honest are the advisor's odds about a position in
 * a heuristic-played game, against the best any forecaster could do about that
 * same game.
 */
import {
  TUNED,
  brierBand,
  decompose,
  heuristicPlayer,
  honestSurvival,
  searchActions,
  trial,
  weightedDiscards,
  xorshift,
  type Claim,
  type InfoSet,
  type Player,
  type Policy,
  type TrickContext,
} from '@cucumber/strategy'

const matches = Number(process.argv[2] ?? 150)
const oracleWorlds = Number(process.argv[3] ?? 200)
const SEARCH_WORLDS = 160

interface Point {
  advisor: number
  oracle: number
  /** Variance the oracle's own sampling contributed. */
  v: number
  survived?: boolean
}

const points: Point[] = []
let pending: Point[] = []
const random = xorshift(20260915)
const tuned = heuristicPlayer('tuned', TUNED)

/** Plays the heuristic; asks both forecasters what they think on the way past. */
const watching: Policy = (view, candidates) => {
  if (candidates.length > 1) {
    const info: InfoSet = {
      seat: view.seat,
      hand: view.hand,
      played: view.played,
      mine: view.mine,
      handSizes: view.handSizes,
      scores: view.scores,
      failures: view.failures,
    }
    const trick: TrickContext = {
      leaderSeat: view.leaderSeat,
      successfulSeat: view.successfulSeat,
      target: view.target,
      playsMade: view.playsMade,
    }
    const advisor = searchActions(info, trick, xorshift(4242), {
      worlds: SEARCH_WORLDS,
      weights: TUNED,
      ...(process.env.NO_EXCHANGE_PRIOR === '1'
        ? {}
        : { exchanged: [3, 3, 3] as const, discards: weightedDiscards(TUNED) }),
    }).best
    // Everyone here exchanges three, and it is public. Without this the
    // sampled worlds are uniform over unseen cards, which flatters the seat by
    // eight points of survival — see tools/exchange-control.ts.
    const honest = honestSurvival(info, trick, random, {
      worlds: oracleWorlds,
      exchanged: [3, 3, 3],
    })
    pending.push({ advisor, oracle: honest.survival, v: honest.bias })
  }
  return tuned.policy(view, candidates)
}

const subject: Player = {
  name: 'watched',
  policy: watching,
  exchangeSize: () => 3,
  takeExchange: (_hand, size) => size,
  discards: weightedDiscards(TUNED),
}

/*
 * Outcomes settle per match: every claim inside one match shares that match's
 * single outcome, which is also why the bands are taken over matches.
 */
const perMatchOracleBrier: number[] = []
const perMatchAdvisorBrier: number[] = []
const started = Date.now()

for (let m = 0; m < matches; m++) {
  pending = []
  const record = trial(subject, tuned, 1, xorshift(8080 + m), m)
  const survived = record.lossRate === 0
  if (pending.length === 0) continue
  const y = survived ? 1 : 0
  perMatchOracleBrier.push(pending.reduce((s, p) => s + (p.oracle - y) ** 2, 0) / pending.length)
  perMatchAdvisorBrier.push(pending.reduce((s, p) => s + (p.advisor - y) ** 2, 0) / pending.length)
  for (const p of pending) points.push({ ...p, survived })
}

const seconds = (Date.now() - started) / 1000
const n = points.length
if (n === 0) {
  console.log('no positions measured')
  process.exit(1)
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const v = mean(points.map((p) => p.v))
const direct = mean(points.map((p) => p.oracle * (1 - p.oracle))) + v

const oracleClaims: Claim[] = points.map((p) => ({ p: p.oracle, y: p.survived ? 1 : 0 }))
const advisorClaims: Claim[] = points.map((p) => ({ p: p.advisor, y: p.survived ? 1 : 0 }))
const scored = decompose(oracleClaims)
const advisor = decompose(advisorClaims)
const f = (x: number) => x.toFixed(4)

console.log(`floor — ${matches} matches, ${n} positions, ${oracleWorlds} oracle worlds each`)
console.log(`  ${seconds.toFixed(1)}s   (subject and opponents all tuned; the advisor watches)`)
console.log('')
console.log('  THE FLOOR')
console.log(`    direct   E[p*(1−p*)]       ${f(direct)}   (+${f(v)} sampling added back)`)
console.log(
  `    scored   Brier of p*       ${f(scored.brier - v)}   (−${f(v)} removed)  ± ${f(brierBand(perMatchOracleBrier))}`,
)
console.log(`    the oracle's own calibration:`)
console.log(`      uncertainty              ${f(scored.uncertainty)}`)
console.log(`    − resolution               ${f(scored.resolution)}`)
console.log(`    + reliability              ${f(scored.reliability)}   <- must be ~0 if p* is real`)
for (const b of scored.bins) {
  console.log(`      said ${(b.said * 100).toFixed(0).padStart(3)}%  happened ${(b.happened * 100).toFixed(0).padStart(3)}%   n=${b.count}`)
}
console.log('')
console.log('  THE ADVISOR, same positions')
console.log(`    Brier                      ${f(advisor.brier)}   ± ${f(brierBand(perMatchAdvisorBrier))}`)
console.log(`      uncertainty              ${f(advisor.uncertainty)}`)
console.log(`    − resolution               ${f(advisor.resolution)}`)
console.log(`    + reliability              ${f(advisor.reliability)}`)
console.log('')
console.log(`  headroom (advisor − floor)   ${f(advisor.brier - direct)}`)
console.log(
  `  mean claim: advisor ${mean(points.map((p) => p.advisor)).toFixed(3)}, oracle ${mean(points.map((p) => p.oracle)).toFixed(3)}, survived ${mean(points.map((p) => (p.survived ? 1 : 0))).toFixed(3)}`,
)
