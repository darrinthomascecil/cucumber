/**
 * What is the *advisor* left holding, when it plays other advisors?
 *
 *   node --experimental-strip-types tools/finals-advisor.ts [matches]
 *
 * `finals.ts` measures heuristics against heuristics. The live table is three
 * searching players against each other — a configuration nothing had ever
 * measured — and its final cards look markedly worse than the heuristic's:
 * 2.45% ending on a 7 or Joker against 0.6%, mean final card 6.25 against 4.95.
 *
 * Either the advisor really is worse at shedding its last card, or the two
 * numbers were never comparable. This is the experiment that tells them apart,
 * so it reproduces the live setup exactly: search on both sides, 160 imagined
 * deals, the same figure the seat-fillers use.
 */
import {
  CLASS_LABELS,
  TUNED,
  finalCardStats,
  heuristicPlayer,
  searchPlayer,
  xorshift,
  type Player,
} from '@cucumber/strategy'

const matches = Number(process.argv[2] ?? 400)
const worlds = Number(process.env.LOCAL_WORLDS ?? 160)

const search = (seed: number): Player =>
  searchPlayer('search', TUNED, xorshift(seed), worlds, 3, true, 0, 'model', 14, true)

const rows: [string, Player, Player][] = [
  // The live table: everyone searching.
  ['search vs two search', search(11), search(22)],
  // The same subject against the field finals.ts uses, to separate "the
  // advisor sheds badly" from "the opponents were different".
  ['search vs two tuned', search(33), heuristicPlayer('tuned', TUNED)],
  // The published baseline, re-run here so every row uses one code path.
  ['tuned vs two tuned', heuristicPlayer('tuned', TUNED), heuristicPlayer('tuned', TUNED)],
]

console.log(`${matches} matches per row, ${worlds} imagined deals per decision`)
console.log('')
console.log('configuration            ends on 7/Joker   mean final card   most common')

for (const [label, subject, opponent] of rows) {
  const started = Date.now()
  const stats = finalCardStats(subject, opponent, matches, xorshift(8080))
  const top = stats.histogram
    .map((n, c) => ({ label: CLASS_LABELS[c] ?? String(c), share: n / stats.hands }))
    .sort((a, b) => b.share - a.share)
    .slice(0, 3)
    .map((t) => `${t.label} ${Math.round(t.share * 100)}%`)
    .join('  ')
  const seconds = ((Date.now() - started) / 1000).toFixed(0)
  console.log(
    `${label.padEnd(24)} ${(stats.sevenRate * 100).toFixed(2).padStart(6)}%` +
      `${stats.meanValue.toFixed(2).padStart(18)}   ${top}   (${seconds}s)`,
  )
}

console.log('')
console.log('live table, for comparison:    2.45%              6.25   4 19%  3 18%  2 12%')
