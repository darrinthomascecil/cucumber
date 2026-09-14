/**
 * How large is the end of a Cucumber hand, really?
 *
 *   node --experimental-strip-types tools/endgame-size.ts [maxCards]
 *
 * Deals random positions with k cards each and solves them exactly, reporting
 * how many distinct positions that took and how long. This is what decides how
 * early the advisor can stop guessing and start knowing.
 */
import {
  CLASS_SUPPLY,
  TUNED,
  emptyCounts,
  heuristicPolicy,
  newSim,
  solveEndgame,
  xorshift,
  type Counts,
  type SeatIndex,
} from '@cucumber/strategy'

const maxCards = Number(process.argv[2] ?? 7)
const samples = Number(process.argv[3] ?? 40)
const random = xorshift(20260913)
const policy = heuristicPolicy(TUNED)

function deal(k: number): [Counts, Counts, Counts] {
  const deck: number[] = []
  for (let c = 0; c < CLASS_SUPPLY.length; c++) {
    for (let n = CLASS_SUPPLY[c]!; n > 0; n--) deck.push(c)
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = random.int(i + 1)
    const a = deck[i]!
    deck[i] = deck[j]!
    deck[j] = a
  }
  const hands: [Counts, Counts, Counts] = [emptyCounts(), emptyCounts(), emptyCounts()]
  let at = 0
  for (let n = 0; n < k; n++) {
    for (let seat = 0; seat < 3; seat++) hands[seat as SeatIndex][deck[at++]!]!++
  }
  return hands
}

interface Row {
  cards: number
  mode: string
  nodes: number
  worst: number
  ms: number
  exact: number
}

const rows: Row[] = []
for (let k = 2; k <= maxCards; k++) {
  for (const mode of ['model', 'optimal'] as const) {
    let nodes = 0
    let worst = 0
    let exact = 0
    const started = Date.now()
    for (let s = 0; s < samples; s++) {
      const sim = newSim(deal(k), [0, 0, 0], 0)
      const result = solveEndgame(sim, {
        opponents:
          mode === 'optimal' ? { kind: 'optimal' } : { kind: 'model', seat: 0, policy },
        nodeBudget: 3_000_000,
      })
      nodes += result.nodes
      worst = Math.max(worst, result.nodes)
      if (result.exact) exact++
    }
    const ms = (Date.now() - started) / samples
    rows.push({ cards: k, mode, nodes: nodes / samples, worst, ms, exact })
    if (ms > 400) break
  }
}

console.log('cards  mode      mean nodes   worst nodes   ms/solve   solved exactly')
for (const row of rows) {
  console.log(
    `${String(row.cards).padStart(5)}  ${row.mode.padEnd(9)}${Math.round(row.nodes)
      .toLocaleString('en-US')
      .padStart(11)}   ${row.worst.toLocaleString('en-US').padStart(11)}   ${row.ms
      .toFixed(2)
      .padStart(8)}   ${row.exact}/${samples}`,
  )
}
console.log('')
console.log('The advisor samples 256 deals per decision, so a decision costs 256× ms/solve.')
