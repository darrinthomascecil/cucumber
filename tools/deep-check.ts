/**
 * Does a mistake stay a mistake when you look harder?
 *
 *   node --experimental-strip-types tools/deep-check.ts [matches] [deepWorlds]
 *
 * The review tells you what a decision cost by comparing the play you made
 * against the best the search found. Live, the search has a fixed budget
 * because you are waiting for it. The review is not waiting for anyone, so the
 * question is whether its verdicts are an artefact of that budget: a "mistake"
 * that dissolves under deeper search was never a mistake, it was the estimate
 * being noisy, and telling someone they blundered on that basis is worse than
 * saying nothing.
 *
 * This measures the disagreement rate directly — the same positions judged at
 * the live budget and at a much larger one.
 */
import {
  NOISE,
  TUNED,
  heuristicPlayer,
  searchActions,
  trial,
  weightedDiscards,
  xorshift,
  type ActionValue,
  type Counts,
  type InfoSet,
  type Player,
  type Policy,
  type TrickContext,
} from '@cucumber/strategy'

const matches = Number(process.argv[2] ?? 40)
const deepWorlds = Number(process.argv[3] ?? 2048)
const LIVE_WORLDS = 256

interface Judged {
  liveCost: number
  deepCost: number
}

const judged: Judged[] = []
const tuned = heuristicPlayer('tuned', TUNED)

/** Value of the action whose card multiset matches `counts`. */
function valueOf(actions: ActionValue[], counts: Counts): number | null {
  for (const a of actions) {
    let same = true
    for (let c = 0; c < counts.length; c++) {
      if (a.candidate.counts[c] !== counts[c]) {
        same = false
        break
      }
    }
    if (same) return a.value
  }
  return null
}

const watching: Policy = (view, candidates) => {
  const choice = tuned.policy(view, candidates)
  if (candidates.length < 2) return choice

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
  const played = candidates[choice]!.counts

  // Same seed both times: the budget is the only thing that differs.
  const live = searchActions(info, trick, xorshift(4242), { worlds: LIVE_WORLDS, weights: TUNED })
  const deep = searchActions(info, trick, xorshift(4242), { worlds: deepWorlds, weights: TUNED })

  const liveValue = valueOf(live.actions, played)
  const deepValue = valueOf(deep.actions, played)
  // A play the screen dropped before searching has no value at that budget,
  // and the review leaves such decisions unscored rather than inventing one.
  if (liveValue === null || deepValue === null) return choice

  judged.push({
    liveCost: Math.max(0, live.best - liveValue),
    deepCost: Math.max(0, deep.best - deepValue),
  })
  return choice
}

const subject: Player = {
  name: 'watched',
  policy: watching,
  exchangeSize: () => 3,
  takeExchange: (_hand, size) => size,
  discards: weightedDiscards(TUNED),
}

const started = Date.now()
trial(subject, tuned, matches, xorshift(8080))
const seconds = (Date.now() - started) / 1000

const isMistake = (cost: number) => cost > NOISE
const liveFlag = judged.filter((j) => isMistake(j.liveCost))
const survived = liveFlag.filter((j) => isMistake(j.deepCost))
const missed = judged.filter((j) => !isMistake(j.liveCost) && isMistake(j.deepCost))
const pct = (k: number, n: number) => (n === 0 ? '—' : `${((100 * k) / n).toFixed(1)}%`)
const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length)

console.log(`deep check — ${matches} matches, ${judged.length} decisions`)
console.log(`  ${seconds.toFixed(1)}s   live ${LIVE_WORLDS} worlds vs deep ${deepWorlds}`)
console.log('')
console.log(`  flagged as a mistake live     ${liveFlag.length}  (${pct(liveFlag.length, judged.length)} of decisions)`)
console.log(`  still a mistake when deep     ${survived.length}  (${pct(survived.length, liveFlag.length)} of those flagged)`)
console.log(`  missed live, found when deep  ${missed.length}  (${pct(missed.length, judged.length)} of decisions)`)
console.log('')
console.log(`  mean cost, live               ${mean(judged.map((j) => j.liveCost)).toFixed(4)}`)
console.log(`  mean cost, deep               ${mean(judged.map((j) => j.deepCost)).toFixed(4)}`)
console.log(`  mean |live − deep|            ${mean(judged.map((j) => Math.abs(j.liveCost - j.deepCost))).toFixed(4)}`)
console.log('')
console.log(`  noise floor in use            ${NOISE}`)
