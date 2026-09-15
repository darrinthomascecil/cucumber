/**
 * Is the exchange why the honest oracle is optimistic?
 *
 *   node --experimental-strip-types tools/exchange-control.ts [matches] [worlds]
 *
 * The oracle claims 0.717 survival where 0.621 happens — about 4 sigma — and
 * its own reliability is 0.0102 against a gate of 0.005. Since p* is
 * calibrated by construction *if it is really p\**, something in the estimator
 * is wrong. The prime suspect is the world sampler's prior.
 *
 * THE CONTROL. `sampleFullWorld` draws opponents' hands uniformly from the
 * unseen pool. That is wrong when players have exchanged, because they threw
 * away their *worst* cards face down: the leftover pool is systematically weak
 * and their real hands systematically strong, so a uniform draw hands them
 * worse cards than they hold and flatters the subject. But with **no
 * exchange** there is no selection to model and the uniform draw is correct by
 * construction.
 *
 * So the hypothesis makes a falsifiable prediction: the bias must vanish at
 * exchange 0 and persist at exchange 3. If both arms are equally biased, the
 * cause is elsewhere and building a generative exchange prior would be wasted
 * work.
 *
 * ON SAMPLE SIZE. This control was run once before at n=400, where the
 * standard error on survival is ~2.4 points against an effect near 4.6. It
 * read noise, flipped sign, and the hypothesis was wrongly called dead.
 * Default here is 1500 matches per arm, se ~1.25 points.
 *
 * The advisor is deliberately not consulted: the question is about the oracle
 * alone, and skipping the search roughly halves the runtime.
 */
import {
  TUNED,
  brierBand,
  decompose,
  heuristicPlayer,
  honestSurvival,
  trial,
  weightedDiscards,
  xorshift,
  type Claim,
  type InfoSet,
  type Player,
  type Policy,
  type TrickContext,
} from '@cucumber/strategy'

const matches = Number(process.argv[2] ?? 1500)
const worlds = Number(process.argv[3] ?? 150)

interface Arm {
  exchange: number
  claims: Claim[]
  perMatch: number[]
}

function run(exchange: number): Arm {
  // The oracle must assume the same exchange the game actually uses, or this
  // reintroduces the policy mismatch that produced a nonsense floor before.
  const tuned = heuristicPlayer('tuned', TUNED, exchange)
  const line: [Player, Player, Player] = [tuned, tuned, tuned]
  const random = xorshift(20260915 + exchange)

  const claims: Claim[] = []
  const perMatch: number[] = []
  let pending: number[] = []

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
      pending.push(
        honestSurvival(info, trick, random, {
          worlds,
          players: line,
          // Everyone at this table exchanges the same number, and it is public.
          ...(exchange > 0 ? { exchanged: [exchange, exchange, exchange] as const } : {}),
        }).survival,
      )
    }
    return tuned.policy(view, candidates)
  }

  const subject: Player = {
    name: 'watched',
    policy: watching,
    exchangeSize: () => exchange,
    takeExchange: (_hand, size) => size,
    discards: weightedDiscards(TUNED),
  }

  for (let m = 0; m < matches; m++) {
    pending = []
    const survived = trial(subject, tuned, 1, xorshift(8080 + m), m).lossRate === 0
    if (pending.length === 0) continue
    const y = survived ? 1 : 0
    perMatch.push(pending.reduce((s, p) => s + (p - y) ** 2, 0) / pending.length)
    for (const p of pending) claims.push({ p, y })
  }

  return { exchange, claims, perMatch }
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const f = (x: number) => x.toFixed(4)

console.log(`exchange control — ${matches} matches per arm, ${worlds} oracle worlds, WITH generative prior`)
console.log('')

for (const exchange of [3, 0]) {
  const started = Date.now()
  const arm = run(exchange)
  const claimed = mean(arm.claims.map((c) => c.p))
  const happened = mean(arm.claims.map((c) => c.y))
  const d = decompose(arm.claims)
  // Standard error on survival, over matches — the independent events.
  const se = Math.sqrt((happened * (1 - happened)) / arm.perMatch.length)
  const gap = claimed - happened

  console.log(`exchange ${exchange}  —  ${arm.perMatch.length} matches, ${arm.claims.length} positions, ${((Date.now() - started) / 1000).toFixed(0)}s`)
  console.log(`  oracle claimed        ${f(claimed)}`)
  console.log(`  actually survived     ${f(happened)}`)
  console.log(`  gap                   ${gap >= 0 ? '+' : ''}${f(gap)}   se ${f(se)}   ${(Math.abs(gap) / se).toFixed(1)} sigma`)
  console.log(`  reliability           ${f(d.reliability)}   (gate < 0.005)`)
  console.log(`  Brier                 ${f(d.brier)} ± ${f(brierBand(arm.perMatch))}`)
  for (const b of d.bins) {
    console.log(`    said ${(b.said * 100).toFixed(0).padStart(3)}% → happened ${(b.happened * 100).toFixed(0).padStart(3)}%   n=${b.count}`)
  }
  console.log('')
}

console.log('If the exchange prior is the cause: exchange 0 is calibrated,')
console.log('exchange 3 is not. If both are biased, the cause is elsewhere.')
