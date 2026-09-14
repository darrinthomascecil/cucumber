/**
 * Self-play harness, spread across worker threads.
 *
 *   pnpm self-play sanity
 *   pnpm self-play cem --budget 10000000
 *   pnpm self-play matrix
 *   pnpm self-play search --worlds 256
 *
 * Every player sees only its own hand, the cards played in front of everyone,
 * and the public counts and scores — the PolicyView it is handed contains
 * nothing else.
 */
import {
  BASELINE,
  DEFAULT_CONTINUATION,
  TUNED,
  WEIGHT_KEYS,
  xorshift,
  type Weights,
} from '@cucumber/strategy'
import { TrialPool, measure, measureOne } from './pool.ts'

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
  const started = Date.now()
  const result = await measure(pool, {
    subject: weights,
    opponent: weights,
    matches,
    seed: 8080,
    worlds,
  })
  spent += result.matches
  const elapsed = (Date.now() - started) / 1000
  console.log(`search (${worlds} deals per decision) against two heuristics`)
  console.log(`  ${thousands(result.matches)} matches in ${elapsed.toFixed(1)}s`)
  console.log(`  search loses ${pct(result.lossRate)} ± ${pct(result.error * 2)}`)
  console.log('  (parity is about 36%; lower means searching is worth it)')
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
