/**
 * Self-play harness.
 *
 *   node --experimental-strip-types tools/self-play.ts sanity
 *   node --experimental-strip-types tools/self-play.ts tune --matches 2000 --rounds 6
 *   node --experimental-strip-types tools/self-play.ts duel '<weights-json>' '<weights-json>'
 *
 * Every player here sees only its own hand, the cards played in front of
 * everyone, and the public counts and scores — the Policy signature gives it
 * nothing else to look at.
 */
import {
  BASELINE,
  DEFAULT_CONTINUATION,
  TUNED,
  duel,
  heuristicPlayer,
  playMatch,
  searchPlayer,
  searchPolicyWith,
  simplePlayer,
  trial,
  xorshift,
  type Player,
  type Weights,
} from '@cucumber/strategy'

const args = process.argv.slice(2)
const command = args[0] ?? 'sanity'

function flag(name: string, fallback: number): number {
  const at = args.indexOf(`--${name}`)
  if (at === -1) return fallback
  return Number(args[at + 1] ?? fallback)
}

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`
}

function show(weights: Weights): string {
  return `value ${weights.value.toFixed(2)}  strength ${weights.strength.toFixed(2)}  low ${weights.low.toFixed(2)}  high ${weights.high.toFixed(2)}  width ${weights.width.toFixed(2)}`
}

function sanity(): void {
  const random = xorshift(20260913)
  const player = heuristicPlayer('baseline', BASELINE)
  const line: [Player, Player, Player] = [player, player, player]
  const losses = [0, 0, 0]
  const matches = flag('matches', 3000)
  let hands = 0
  const started = Date.now()
  for (let m = 0; m < matches; m++) {
    const record = playMatch(line, random)
    for (const seat of record.losers) losses[seat]!++
    hands += record.hands
  }
  const elapsed = (Date.now() - started) / 1000
  console.log(`${matches} matches in ${elapsed.toFixed(1)}s (${Math.round(matches / elapsed)}/s)`)
  console.log(`hands per match: ${(hands / matches).toFixed(2)}`)
  console.log(`loss share by seat: ${losses.map((l) => pct(l / matches)).join('  ')}`)
  console.log('(three identical players: the three shares should be close)')
}

const KNOBS: (keyof Weights)[] = ['value', 'strength', 'low', 'high', 'width']

function parseWeights(text: string | undefined, fallback: Weights): Weights {
  if (!text) return fallback
  if (text === 'tuned') return TUNED
  if (text === 'baseline') return BASELINE
  return JSON.parse(text) as Weights
}

function option(name: string): string | undefined {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? undefined : args[at + 1]
}

/**
 * Coordinate ascent, then random local search. The opponent is fixed for the
 * whole run, so the result is "what beats this player" — iterate by feeding
 * the winner back in as the opponent.
 */
function tune(): void {
  const matches = flag('matches', 6000)
  const rounds = flag('rounds', 6)
  const seed = flag('seed', 99991)
  const opponentWeights = parseWeights(option('opponent'), BASELINE)
  const start = parseWeights(option('start'), opponentWeights)
  const opponent = heuristicPlayer('opponent', opponentWeights)
  const random = xorshift(seed * 7 + 13)

  const rate = (weights: Weights, salt: number): number =>
    trial(heuristicPlayer('subject', weights), opponent, matches, xorshift(seed + salt)).lossRate

  let best: Weights = { ...start }
  let bestRate = rate(best, 0)
  console.log(`opponent  ${show(opponentWeights)}`)
  console.log(`start     ${show(best)}  loss ${pct(bestRate)}`)

  const steps: Record<keyof Weights, number[]> = {
    value: [0.25, 0.5, 1, 2],
    strength: [0.25, 0.5, 1, 2, 4],
    low: [0.5, 1, 2, 4, 8],
    high: [1, 2, 5, 10, 20, 40],
    width: [0.5, 1, 2, 4, 8],
  }

  for (let round = 1; round <= rounds; round++) {
    let improved = false
    for (const knob of KNOBS) {
      for (const step of steps[knob]) {
        for (const direction of [1, -1]) {
          const candidate: Weights = { ...best, [knob]: best[knob] + step * direction }
          if (candidate.value < 0) continue
          const loss = rate(candidate, round)
          if (loss < bestRate - 0.0015) {
            bestRate = loss
            best = candidate
            improved = true
            console.log(`  ascent r${round}  ${show(best)}  loss ${pct(loss)}`)
          }
        }
      }
    }
    if (!improved) break
  }

  // Coordinate ascent stops at ridges; jitter every knob at once to cross them.
  for (let attempt = 0; attempt < flag('jitter', 60); attempt++) {
    const candidate: Weights = { ...best }
    for (const knob of KNOBS) {
      const scale = Math.max(1, Math.abs(best[knob])) * 0.6
      candidate[knob] = best[knob] + (random.next() * 2 - 1) * scale
    }
    if (candidate.value < 0) continue
    const loss = rate(candidate, 1000 + attempt)
    if (loss < bestRate - 0.0015) {
      bestRate = loss
      best = candidate
      console.log(`  jitter ${attempt}  ${show(best)}  loss ${pct(loss)}`)
    }
  }

  console.log('')
  console.log('best weights:')
  console.log(JSON.stringify(best, (_k, v) => (typeof v === 'number' ? Number(v.toFixed(3)) : v)))
  const confirm = trial(
    heuristicPlayer('best', best),
    opponent,
    matches * 3,
    xorshift(seed + 777),
  )
  console.log(
    `confirmed over ${confirm.matches} fresh matches: loss ${pct(confirm.lossRate)} ± ${pct(confirm.error * 2)}`,
  )
}

function runDuel(): void {
  const a: Weights = args[1] ? JSON.parse(args[1]) : TUNED
  const b: Weights = args[2] ? JSON.parse(args[2]) : BASELINE
  const matches = flag('matches', 4000)
  const result = duel(heuristicPlayer('A', a), heuristicPlayer('B', b), matches, xorshift(4242))
  console.log(`A ${show(a)}`)
  console.log(`B ${show(b)}`)
  console.log(`over ${result.matches} matches, one B against two A:`)
  console.log(`  B lost ${pct(result.bLossRate)} of matches`)
  console.log(`  at least one A lost ${pct(result.aLossRate)} of matches`)
}

function versusSimple(): void {
  const matches = flag('matches', 3000)
  const result = trial(
    heuristicPlayer('tuned', TUNED),
    simplePlayer('first-legal'),
    matches,
    xorshift(31337),
  )
  console.log(`tuned against two first-legal players over ${result.matches} matches:`)
  console.log(`  tuned lost ${pct(result.lossRate)} ± ${pct(result.error * 2)}`)
}

/** Round robin: every named player as the lone subject against two of each
 *  other. Lower is better; about 36% is parity once ties are counted. */
function matrix(): void {
  const matches = flag('matches', 4000)
  const entries: [string, Weights][] = [
    ['naive', BASELINE],
    ['gen0', { value: 1, strength: 1.5, low: 3.5, high: -8, width: -2 }],
    ['gen1', { value: 1, strength: 1, low: 0.5, high: -10, width: -2 }],
    ['equilibrium', { value: 1, strength: 1, low: 1, high: -10, width: -2.5 }],
  ]
  const names = entries.map(([name]) => name)
  console.log(`subject \\ opponent    ${names.map((n) => n.padStart(12)).join('')}`)
  for (const [name, weights] of entries) {
    const row: string[] = []
    for (const [, against] of entries) {
      const result = trial(
        heuristicPlayer(name, weights),
        heuristicPlayer('opp', against),
        matches,
        xorshift(5150),
      )
      row.push(pct(result.lossRate).padStart(12))
    }
    console.log(`${name.padEnd(22)}${row.join('')}`)
  }
}

/** Does searching beat the best guessing? */
function search(): void {
  const matches = flag('matches', 400)
  const worlds = flag('worlds', 48)
  const weights = parseWeights(option('weights'), TUNED)
  const started = Date.now()
  const result = trial(
    searchPlayer('search', weights, xorshift(2718), worlds),
    heuristicPlayer('heuristic', weights),
    matches,
    xorshift(8080),
  )
  const elapsed = (Date.now() - started) / 1000
  console.log(`search (${worlds} worlds) against two heuristics, ${weights ? show(weights) : ''}`)
  console.log(`  ${result.matches} matches in ${elapsed.toFixed(1)}s`)
  console.log(`  search lost ${pct(result.lossRate)} ± ${pct(result.error * 2)}`)
  console.log('  (parity is about 36%; lower means searching is worth it)')
}

/**
 * The terminal value of a hand that does not end the match is a guess about
 * the future. This grid-searches that guess directly against play strength.
 */
function continuation(): void {
  const matches = flag('matches', 500)
  const worlds = flag('worlds', 32)
  const opponent = heuristicPlayer('heuristic', TUNED)
  console.log(`default ${JSON.stringify(DEFAULT_CONTINUATION)}`)
  console.log('temperature  headroom   loss')
  for (const temperature of [3, 6.5, 10, 16]) {
    for (const headroom of [0, 0.35, 0.8]) {
      const measured = trial(
        {
          ...searchPlayer('search', TUNED, xorshift(2718), worlds),
          policy: searchPolicyWith(TUNED, xorshift(2718), worlds, { temperature, headroom }),
        },
        opponent,
        matches,
        xorshift(606),
      )
      console.log(
        `${String(temperature).padStart(11)}  ${String(headroom).padStart(8)}   ${pct(measured.lossRate)}`,
      )
    }
  }
}

switch (command) {
  case 'continuation':
    continuation()
    break
  case 'matrix':
    matrix()
    break
  case 'search':
    search()
    break
  case 'sanity':
    sanity()
    break
  case 'tune':
    tune()
    break
  case 'duel':
    runDuel()
    break
  case 'simple':
    versusSimple()
    break
  default:
    console.error(`Unknown command: ${command}`)
    process.exit(1)
}
