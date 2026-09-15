/**
 * Self-play harness, spread across worker threads.
 *
 *   pnpm self-play sanity
 *   pnpm self-play cem --budget 10000000
 *   pnpm self-play matrix
 *   pnpm self-play search --worlds 256
 *   pnpm self-play brier --matches 400
 *
 * Every player sees only its own hand, the cards played in front of everyone,
 * and the public counts and scores — the PolicyView it is handed contains
 * nothing else.
 */
import {
  BASELINE,
  brierBand,
  decompose,
  DEFAULT_CONTINUATION,
  TUNED,
  WEIGHT_KEYS,
  xorshift,
  type Weights,
} from '@cucumber/strategy'
import { TrialPool, gatherClaims, measure, measureOne } from './pool.ts'

const args = process.argv.slice(2)
const command = args[0] ?? 'sanity'

function flag(name: string, fallback: number): number {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? fallback : Number(args[at + 1] ?? fallback)
}

function option(name: string): string | undefined {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? undefined : args[at + 1]
}

const pct = (value: number): string => `${(value * 100).toFixed(2)}%`

function show(w: Weights): string {
  return WEIGHT_KEYS.map((k) => `${k} ${w[k].toFixed(2)}`).join('  ')
}

function compact(w: Weights): string {
  const rounded = Object.fromEntries(WEIGHT_KEYS.map((k) => [k, Number(w[k].toFixed(3))]))
  return JSON.stringify(rounded)
}

function parseWeights(text: string | undefined, fallback: Weights): Weights {
  if (!text) return fallback
  if (text === 'tuned') return TUNED
  if (text === 'baseline') return BASELINE
  return { ...BASELINE, ...(JSON.parse(text) as Partial<Weights>) }
}

function thousands(n: number): string {
  return n.toLocaleString('en-US')
}

let spent = 0

async function sanity(pool: TrialPool): Promise<void> {
  const matches = flag('matches', 500_000)
  const started = Date.now()
  const result = await measure(pool, {
    subject: TUNED,
    opponent: TUNED,
    matches,
    seed: 20260913,
  })
  spent += result.matches
  const elapsed = (Date.now() - started) / 1000
  console.log(`${thousands(result.matches)} matches in ${elapsed.toFixed(1)}s across ${pool.size} workers`)
  console.log(`  ${thousands(Math.round(result.matches / elapsed))} matches/second`)
  console.log(`  ${((elapsed / result.matches) * 1e6).toFixed(1)}µs per match`)
  console.log(`  hands per match ${result.averageHands.toFixed(2)}`)
  console.log(`  a player against two of itself loses ${pct(result.lossRate)} of the time`)
}

/** Clamp a sampled candidate into a sane region. */
function clampWeights(w: Weights): Weights {
  return {
    value: Math.max(0.05, w.value),
    strength: w.strength,
    low: w.low,
    high: w.high,
    width: w.width,
    gamma: Math.max(0.1, Math.min(4, w.gamma)),
    panic: w.panic,
    pressure: Math.max(-2, Math.min(2, w.pressure)),
  }
}

/**
 * Cross-entropy method over a gauntlet.
 *
 * The first attempt at this scored candidates against the current champion
 * alone, and drifted: the champion wandered somewhere weak, later rounds
 * optimised against that weakness, and the final answer lost 65% of matches
 * to the player it started from. So a candidate is now measured against
 * several opponents at once — the incumbent, the one before it, and the
 * previously tuned player — and a new champion is only crowned if it beats
 * the incumbent head to head on that same gauntlet.
 */
async function cem(pool: TrialPool): Promise<void> {
  const budget = flag('budget', 10_000_000)
  const population = flag('population', 48)
  const elite = flag('elite', 8)
  const perOpponent = flag('matches', 6000)
  const random = xorshift(flag('seed', 8675309))

  const gaussian = (): number => {
    const u = Math.max(1e-9, random.next())
    const v = random.next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  let champion: Weights = parseWeights(option('start'), TUNED)
  let mean: Weights = { ...champion }
  // Tight on the dimensions earlier tuning already settled, wide on the three
  // the earlier tuning never had.
  let sigma: Weights = {
    value: 0.2,
    strength: 0.5,
    low: 0.7,
    high: 4,
    width: 1.2,
    gamma: 0.45,
    panic: 6,
    pressure: 0.6,
  }
  /**
   * Opponents every candidate must face. Kept at a fixed size and strength so
   * that a score from one round means the same as a score from the next — the
   * naive player is deliberately not here, because beating it is easy and
   * would dilute the selection.
   */
  const anchor = { name: 'anchor', weights: { ...champion } }
  let gauntlet: { name: string; weights: Weights }[] = [
    { name: 'incumbent', weights: champion },
    { name: 'previous', weights: champion },
    anchor,
  ]

  const perCandidate = perOpponent * gauntlet.length
  const rounds = flag('rounds', Math.max(4, Math.floor(budget / (population * perCandidate))))

  console.log('cross-entropy search over a gauntlet')
  console.log(
    `  ${rounds} rounds × ${population} candidates × ${gauntlet.length} opponents × ${thousands(perOpponent)} matches`,
  )
  console.log(`  = ${thousands(rounds * population * perCandidate)} matches on ${pool.size} workers`)
  console.log('')

  const score = async (weights: Weights, salt: number): Promise<number> => {
    const results = await Promise.all(
      gauntlet.map((opponent, index) =>
        measureOne(pool, {
          subject: weights,
          opponent: opponent.weights,
          matches: perOpponent,
          seed: (salt + index * 104729) >>> 0,
        }),
      ),
    )
    for (const result of results) spent += result.matches
    return results.reduce((sum, r) => sum + r.lossRate, 0) / results.length
  }

  const started = Date.now()

  for (let round = 1; round <= rounds; round++) {
    const candidates: Weights[] = [{ ...champion }]
    for (let i = 1; i < population; i++) {
      const sample = { ...mean }
      for (const key of WEIGHT_KEYS) sample[key] = mean[key] + gaussian() * sigma[key]
      candidates.push(clampWeights(sample))
    }

    const scored = await Promise.all(
      candidates.map(async (weights, index) => ({
        weights,
        loss: await score(weights, (round * 7919 + index * 104729) >>> 0),
      })),
    )
    // candidates[0] is the incumbent, scored this round against this gauntlet.
    // Comparing against a score from an earlier round would be comparing two
    // different examinations — which is exactly the mistake that made the
    // first version of this promote nothing after round one.
    const championScore = scored[0]!.loss
    scored.sort((a, b) => a.loss - b.loss)
    const top = scored.slice(0, elite)

    const nextMean = { ...mean }
    const nextSigma = { ...sigma }
    for (const key of WEIGHT_KEYS) {
      const values = top.map((entry) => entry.weights[key])
      const average = values.reduce((a, b) => a + b, 0) / values.length
      const variance = values.reduce((sum, v) => sum + (v - average) ** 2, 0) / values.length
      nextMean[key] = average
      nextSigma[key] = Math.max(Math.sqrt(variance), sigma[key] * 0.4)
    }
    mean = clampWeights(nextMean)
    sigma = nextSigma

    // Two challengers: the elite average, and the single best candidate. The
    // average is steadier, but on a noisy ridge it can land worse than every
    // point it was averaged from.
    const [meanScore, bestScore] = await Promise.all([
      score(mean, (round * 31 + 7) >>> 0),
      score(top[0]!.weights, (round * 31 + 11) >>> 0),
    ])
    const challenger = bestScore < meanScore ? top[0]!.weights : mean
    const challengerScore = Math.min(bestScore, meanScore)
    const elapsed = (Date.now() - started) / 1000
    if (challengerScore < championScore) {
      const previous = champion
      champion = challenger
      mean = challenger
      gauntlet = [
        { name: 'incumbent', weights: champion },
        { name: `round ${round - 1}`, weights: previous },
        anchor,
      ]
      console.log(
        `round ${String(round).padStart(2)}  promoted  gauntlet ${pct(challengerScore)}  best candidate ${pct(top[0]!.loss)}  ${elapsed.toFixed(0)}s`,
      )
      console.log(`          ${show(champion)}`)
    } else {
      console.log(
        `round ${String(round).padStart(2)}  held      challenger ${pct(challengerScore)} vs champion ${pct(championScore)}  ${elapsed.toFixed(0)}s`,
      )
    }
  }

  console.log('')
  console.log(`champion: ${compact(champion)}`)
  console.log('')
  console.log('head to head, large sample:')
  const validation = flag('validate', 120_000)
  const finals: { name: string; weights: Weights }[] = [
    { name: 'naive', weights: BASELINE },
    { name: 'previously tuned', weights: TUNED },
  ]
  let worst = 0
  for (const opponent of finals) {
    const result = await measure(pool, {
      subject: champion,
      opponent: opponent.weights,
      matches: validation,
      seed: 555_001,
    })
    spent += result.matches
    worst = Math.max(worst, result.lossRate)
    console.log(
      `  vs ${opponent.name.padEnd(18)} champion loses ${pct(result.lossRate)} ± ${pct(result.error * 2)}`,
    )
  }
  const mirror = await measure(pool, {
    subject: TUNED,
    opponent: champion,
    matches: validation,
    seed: 555_002,
  })
  spent += mirror.matches
  console.log(
    `  the mirror: one previously-tuned player against two champions loses ${pct(mirror.lossRate)} ± ${pct(mirror.error * 2)}`,
  )
  console.log('')
  console.log(`worst case for the champion: ${pct(worst)} (parity is about 36%)`)
}

async function matrix(pool: TrialPool): Promise<void> {
  const matches = flag('matches', 60_000)
  const entries: [string, Weights][] = [
    ['naive', BASELINE],
    ['tuned', TUNED],
  ]
  const extra = option('add')
  if (extra) entries.push([option('add-name') ?? 'other', parseWeights(extra, TUNED)])

  const names = entries.map(([name]) => name)
  console.log(`subject \\ opponent  ${names.map((n) => n.padStart(13)).join('')}`)
  for (const [name, weights] of entries) {
    const row: string[] = []
    for (const [, against] of entries) {
      const result = await measure(pool, {
        subject: weights,
        opponent: against,
        matches,
        seed: 5150,
      })
      spent += result.matches
      row.push(pct(result.lossRate).padStart(13))
    }
    console.log(`${name.padEnd(20)}${row.join('')}`)
  }
}

async function search(pool: TrialPool): Promise<void> {
  const matches = flag('matches', 4000)
  const worlds = flag('worlds', 256)
  const weights = parseWeights(option('weights'), TUNED)
  const against = parseWeights(option('opponent'), weights)
  const both = args.includes('--compare')

  const run = async (inference: boolean) => {
    const started = Date.now()
    const result = await measure(pool, {
      subject: weights,
      opponent: against,
      matches,
      seed: 8080,
      worlds,
      inference,
    })
    spent += result.matches
    return { result, seconds: (Date.now() - started) / 1000 }
  }

  console.log(`search, ${worlds} imagined deals per decision, against two heuristics`)
  const withInference = await run(true)
  if (!both) {
    console.log(
      `  ${thousands(withInference.result.matches)} matches in ${withInference.seconds.toFixed(1)}s`,
    )
    console.log(
      `  search loses ${pct(withInference.result.lossRate)} ± ${pct(withInference.result.error * 2)}`,
    )
    console.log('  (parity is about 36%; lower means searching is worth it)')
    return
  }
  const without = await run(false)
  console.log(
    `  imagining any consistent deal   ${pct(without.result.lossRate)} ± ${pct(without.result.error * 2)}`,
  )
  console.log(
    `  ruling out what they can't hold ${pct(withInference.result.lossRate)} ± ${pct(withInference.result.error * 2)}`,
  )
  console.log(
    `  reading the table is worth ${((without.result.lossRate - withInference.result.lossRate) * 100).toFixed(2)} points`,
  )
}

/**
 * Does solving the end of the hand exactly beat playing it out with a guess?
 */
async function endgame(pool: TrialPool): Promise<void> {
  const matches = flag('matches', 12_000)
  const worlds = flag('worlds', 256)
  const arms: { label: string; solveFrom: number; solveMode: 'optimal' | 'model' }[] = [
    { label: 'no solving', solveFrom: 0, solveMode: 'model' },
    { label: 'solve from 4, modelled', solveFrom: 4, solveMode: 'model' },
    { label: 'solve from 6, modelled', solveFrom: 6, solveMode: 'model' },
    { label: 'solve from 8, modelled', solveFrom: 8, solveMode: 'model' },
    { label: 'solve from 4, optimal', solveFrom: 4, solveMode: 'optimal' },
    { label: 'solve from 5, optimal', solveFrom: 5, solveMode: 'optimal' },
  ]
  console.log(`search, ${worlds} imagined deals, against two heuristics:`)
  for (const arm of arms) {
    const started = Date.now()
    const result = await measure(pool, {
      subject: TUNED,
      opponent: TUNED,
      matches,
      seed: 60_060,
      worlds,
      solveFrom: arm.solveFrom,
      solveMode: arm.solveMode,
    })
    spent += result.matches
    const seconds = (Date.now() - started) / 1000
    console.log(
      `  ${arm.label.padEnd(24)} ${pct(result.lossRate)} ± ${pct(result.error * 2)}   ${seconds.toFixed(0)}s`,
    )
  }
}

/**
 * How much is the hidden information actually worth?
 *
 * Three players, same rollout policy, measured the same way:
 *   - the plain heuristic, as a floor;
 *   - the honest search, which imagines the unseen cards;
 *   - a cheat that is simply shown them.
 *
 * The gap between the last two is a ceiling on what any amount of better
 * reasoning about unseen cards could possibly buy.
 */
async function oracle(pool: TrialPool): Promise<void> {
  const matches = flag('matches', 30_000)
  const worlds = flag('worlds', 256)
  const searchMatches = flag('search-matches', 6000)

  const floor = await measure(pool, {
    subject: TUNED,
    opponent: TUNED,
    matches,
    seed: 4242,
  })
  spent += floor.matches

  const honest = await measure(pool, {
    subject: TUNED,
    opponent: TUNED,
    matches: searchMatches,
    seed: 4243,
    worlds,
  })
  spent += honest.matches

  const cheat = await measure(pool, {
    subject: TUNED,
    opponent: TUNED,
    matches,
    seed: 4244,
    oracle: true,
  })
  spent += cheat.matches

  console.log('one seat against two heuristics, lower is better:')
  console.log(`  heuristic (no search)      ${pct(floor.lossRate)} ± ${pct(floor.error * 2)}   n=${thousands(floor.matches)}`)
  console.log(`  honest search, ${String(worlds).padStart(4)} deals  ${pct(honest.lossRate)} ± ${pct(honest.error * 2)}   n=${thousands(honest.matches)}`)
  console.log(`  shown every hand           ${pct(cheat.lossRate)} ± ${pct(cheat.error * 2)}   n=${thousands(cheat.matches)}`)
  console.log('')
  const searchGain = floor.lossRate - honest.lossRate
  const remaining = honest.lossRate - cheat.lossRate
  console.log(`  searching is worth      ${(searchGain * 100).toFixed(2)} points`)
  console.log(`  seeing everything adds  ${(remaining * 100).toFixed(2)} points more`)
  console.log('')
  console.log(
    `  so the search has captured ${((searchGain / (searchGain + remaining)) * 100).toFixed(0)}% of what perfect information is worth.`,
  )
}

/**
 * The champion against opponents that do not share its shape. A strategy that
 * only wins inside the family it was bred in has not been shown to be strong.
 */
async function gauntlet(pool: TrialPool): Promise<void> {
  const matches = flag('matches', 40_000)
  const worlds = flag('worlds', 0)
  const names = ['cheapest', 'dumper', 'panic', 'hoarder', 'wide', 'threshold']

  console.log(
    worlds > 0
      ? `search (${worlds} deals) against two of each, lower is better:`
      : 'the tuned heuristic against two of each, lower is better:',
  )
  let worst = 0
  let worstName = ''
  for (const name of names) {
    const result = await measure(pool, {
      subject: TUNED,
      opponent: name,
      matches,
      seed: 71_077_345,
      ...(worlds > 0 ? { worlds } : {}),
    })
    spent += result.matches
    if (result.lossRate > worst) {
      worst = result.lossRate
      worstName = name
    }
    console.log(`  vs ${name.padEnd(12)} ${pct(result.lossRate)} ± ${pct(result.error * 2)}`)
  }

  console.log('')
  console.log('and how those players do against each other, as a sanity check:')
  for (const name of names) {
    const result = await measure(pool, {
      subject: name,
      opponent: TUNED,
      matches,
      seed: 71_077_346,
    })
    spent += result.matches
    console.log(`  ${name.padEnd(12)} against two champions: ${pct(result.lossRate)}`)
  }
  console.log('')
  console.log(`worst case for the champion: ${pct(worst)} against ${worstName} (parity is about 36%)`)
}

/**
 * Best-response probe. How badly can a strategy tuned *specifically* to beat
 * the champion actually beat it? In game theory that gap is the honest measure
 * of distance from equilibrium: a strategy nobody can exploit is a strategy
 * with nothing left to fix.
 */
async function exploit(pool: TrialPool): Promise<void> {
  const population = flag('population', 40)
  const elite = flag('elite', 8)
  const rounds = flag('rounds', 6)
  const matches = flag('matches', 20_000)
  const target = parseWeights(option('target'), TUNED)
  const random = xorshift(flag('seed', 13_331))

  const gaussian = (): number => {
    const u = Math.max(1e-9, random.next())
    const v = random.next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  let mean: Weights = { ...target }
  let sigma: Weights = {
    value: 0.6,
    strength: 1.5,
    low: 2,
    high: 12,
    width: 3,
    gamma: 0.8,
    panic: 12,
    pressure: 1.2,
  }
  let best = { weights: { ...target }, loss: 1 }

  console.log('hunting for a strategy that beats the champion')
  console.log(`  ${rounds} rounds × ${population} candidates × ${thousands(matches)} matches`)
  console.log('')

  for (let round = 1; round <= rounds; round++) {
    const candidates: Weights[] = [{ ...mean }]
    for (let i = 1; i < population; i++) {
      const sample = { ...mean }
      for (const key of WEIGHT_KEYS) sample[key] = mean[key] + gaussian() * sigma[key]
      candidates.push(clampWeights(sample))
    }
    const scored = await Promise.all(
      candidates.map(async (weights, index) => {
        const result = await measureOne(pool, {
          subject: weights,
          opponent: target,
          matches,
          seed: (round * 6151 + index * 24593) >>> 0,
        })
        spent += result.matches
        return { weights, loss: result.lossRate }
      }),
    )
    scored.sort((a, b) => a.loss - b.loss)
    if (scored[0]!.loss < best.loss) best = scored[0]!

    const top = scored.slice(0, elite)
    const nextMean = { ...mean }
    const nextSigma = { ...sigma }
    for (const key of WEIGHT_KEYS) {
      const values = top.map((entry) => entry.weights[key])
      const average = values.reduce((a, b) => a + b, 0) / values.length
      const variance = values.reduce((sum, v) => sum + (v - average) ** 2, 0) / values.length
      nextMean[key] = average
      nextSigma[key] = Math.max(Math.sqrt(variance), sigma[key] * 0.5)
    }
    mean = clampWeights(nextMean)
    sigma = nextSigma
    console.log(`round ${round}  best exploiter so far ${pct(best.loss)}`)
  }

  console.log('')
  const confirm = await measure(pool, {
    subject: best.weights,
    opponent: target,
    matches: flag('validate', 150_000),
    seed: 909_090,
  })
  spent += confirm.matches
  console.log(`best exploiter: ${compact(best.weights)}`)
  console.log(
    `confirmed over ${thousands(confirm.matches)} matches: it loses ${pct(confirm.lossRate)} ± ${pct(confirm.error * 2)}`,
  )
  console.log('')
  console.log(
    `parity is about 36%. The champion is exploitable by roughly ${((0.3648 - confirm.lossRate) * 100).toFixed(1)} points.`,
  )
}

/**
 * Score the advisor's own odds, the way the browser panel does but at a
 * thousand matches a minute instead of a few an evening.
 */
async function brier(pool: TrialPool): Promise<void> {
  const matches = flag('matches', 400)
  const worlds = flag('worlds', 256)
  const weights = parseWeights(option('weights'), TUNED)
  const against = parseWeights(option('opponent'), weights)

  const started = Date.now()
  const { records, lossRate } = await gatherClaims(pool, {
    subject: weights,
    opponent: against,
    matches,
    seed: flag('seed', 8080),
    worlds,
    inference: true,
  })
  spent += matches
  const seconds = (Date.now() - started) / 1000

  const scored = records.filter((r) => r.claims.length > 0)
  const claims = scored.flatMap((r) => r.claims.map((p) => ({ p, y: r.survived ? 1 : 0 })))
  if (claims.length === 0) {
    console.log('no claims recorded — did the subject search at all?')
    return
  }
  // Per match, because matches are the independent events — every claim
  // inside one shares that match's single outcome.
  const perMatch = scored.map((r) => {
    const y = r.survived ? 1 : 0
    return r.claims.reduce((sum, p) => sum + (p - y) ** 2, 0) / r.claims.length
  })
  const d = decompose(claims)
  const band = brierBand(perMatch)

  console.log(`advisor odds, ${worlds} imagined deals per decision`)
  console.log(`  ${thousands(scored.length)} matches in ${seconds.toFixed(1)}s`)
  console.log(
    `  ${thousands(claims.length)} claims, ${(claims.length / scored.length).toFixed(1)} per match`,
  )
  console.log(`  survived ${pct(1 - lossRate)}, advisor said ${pct(d.bins.length ? claims.reduce((t, c) => t + c.p, 0) / claims.length : 0)}`)
  console.log(`  Brier ${d.brier.toFixed(4)} ± ${band.toFixed(4)}`)
  console.log(`    uncertainty  ${d.uncertainty.toFixed(4)}   (no skill at all)`)
  console.log(`  − resolution   ${d.resolution.toFixed(4)}   (what its ordering is worth)`)
  console.log(`  + reliability  ${d.reliability.toFixed(4)}   (what its overconfidence costs)`)
  console.log(`    residual     ${d.residual.toFixed(6)}   (binning remainder)`)
  console.log(`  perfectly calibrated, same ordering: ${(d.uncertainty - d.resolution).toFixed(4)}`)
  console.log('  said   happened      n')
  for (const b of d.bins) {
    console.log(
      `  ${pct(b.said).padStart(6)} ${pct(b.happened).padStart(9)} ${thousands(b.count).padStart(6)}`,
    )
  }
}

async function main(): Promise<void> {
  const pool = new TrialPool(flag('workers', Math.max(1, Math.min(12, 12))))
  try {
    switch (command) {
      case 'sanity':
        await sanity(pool)
        break
      case 'cem':
      case 'tune':
        await cem(pool)
        break
      case 'matrix':
        await matrix(pool)
        break
      case 'search':
        await search(pool)
        break
      case 'oracle':
        await oracle(pool)
        break
      case 'brier':
        await brier(pool)
        break
      case 'gauntlet':
        await gauntlet(pool)
        break
      case 'endgame':
        await endgame(pool)
        break
      case 'exploit':
        await exploit(pool)
        break
      default:
        console.error(`Unknown command: ${command}`)
        process.exitCode = 1
    }
  } finally {
    if (spent > 0) console.log(`\n${thousands(spent)} matches played.`)
    await pool.close()
  }
}

void main()
