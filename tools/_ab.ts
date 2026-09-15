/* Does the prior still help when its model of the opponent is WRONG? */
import { TUNED, archetypePlayer, heuristicPlayer, searchPlayer, trial, xorshift } from '@cucumber/strategy'
const N = Number(process.argv[2] ?? 1500)
const mk = () => searchPlayer('search', TUNED, xorshift(4242), 256, 3, true, 0, 'model', 14, true)
for (const [name, opp] of [
  ['tuned heuristic (model is exact)', heuristicPlayer('tuned', TUNED, 3)],
  ['dumper (model is wrong)', archetypePlayer('dumper', 3)],
  ['wide (model is wrong)', archetypePlayer('wide', 3)],
] as const) {
  const r = trial(mk(), opp, N, xorshift(8080))
  console.log(`  ${name.padEnd(34)} loses ${(r.lossRate*100).toFixed(2)}% ± ${(r.error*200).toFixed(2)}`)
}
