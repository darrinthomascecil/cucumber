/**
 * What is each strategy left holding at the reveal?
 *
 *   node --experimental-strip-types tools/finals.ts [matches]
 */
import {
  BASELINE,
  CLASS_LABELS,
  TUNED,
  archetypePlayer,
  finalCardStats,
  heuristicPlayer,
  xorshift,
  type Player,
  type Weights,
} from '@cucumber/strategy'

const matches = Number(process.argv[2] ?? 4000)

const variants: [string, Player][] = [
  ['tuned (current)', heuristicPlayer('tuned', TUNED)],
  ['tuned, high = 0', heuristicPlayer('t0', { ...TUNED, high: 0 } as Weights)],
  ['naive', heuristicPlayer('naive', BASELINE)],
  // What the seat-fillers used to do: lead your lowest card, every trick.
  ['lead-lowest', archetypePlayer('cheapest')],
  ['dump-points', archetypePlayer('dumper')],
]

console.log(`each played as one seat against two tuned opponents, ${matches} matches`)
console.log('')
console.log('strategy              ends on 7/Joker   mean final card   most common final')
for (const [name, player] of variants) {
  const stats = finalCardStats(player, heuristicPlayer('tuned', TUNED), matches, xorshift(606_060))
  const top = stats.histogram
    .map((count, index) => ({ count, index }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((entry) => `${CLASS_LABELS[entry.index]} ${Math.round((entry.count / stats.hands) * 100)}%`)
    .join('  ')
  console.log(
    `${name.padEnd(20)}${`${(stats.sevenRate * 100).toFixed(1)}%`.padStart(14)}${stats.meanValue
      .toFixed(2)
      .padStart(18)}   ${top}`,
  )
}
console.log('')
console.log('6 of the 54 cards are 7s or Jokers, so 11% is what indifference looks like.')
