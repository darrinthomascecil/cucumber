import { describe, expect, it } from 'vitest'
import {
  TUNED,
  candidatesFor,
  cloneSim,
  commit,
  countsOf,
  emptyCounts,
  finalClasses,
  handValue,
  heuristicPolicy,
  newSim,
  playOut,
  settleHand,
  solveChoices,
  solveEndgame,
  type Counts,
  type Sim,
} from '@cucumber/strategy'

const policy = heuristicPolicy(TUNED)
const MODEL = { opponents: { kind: 'model' as const, seat: 0 as const, policy } }
const OPTIMAL = { opponents: { kind: 'optimal' as const } }

function table(hands: [string[], string[], string[]], scores: [number, number, number] = [0, 0, 0]): Sim {
  return newSim(
    [countsOf(hands[0]), countsOf(hands[1]), countsOf(hands[2])] as [Counts, Counts, Counts],
    scores,
    0,
  )
}

describe('the solver gets the endgame right by inspection', () => {
  /**
   * Two cards each, so exactly one trick then the reveal. Seat 0 holds a 2 and
   * a 7. Leading the 7 keeps the 2 and scores two points; leading the 2 keeps
   * the 7, which loses the match outright. There is no judgement involved —
   * the solver must see it.
   */
  const hands: [string[], string[], string[]] = [
    ['2C', '7S'],
    ['3D', '4D'],
    ['5H', '6H'],
  ]

  it('leads the 7 rather than being left holding it', () => {
    const sim = table(hands)
    const candidates = candidatesFor(sim, 0)
    const solved = solveChoices(sim, 0, candidates, OPTIMAL)

    const leadSeven = candidates.findIndex((c) => c.counts[12]! === 1)
    const leadTwo = candidates.findIndex((c) => c.counts[0]! === 1)
    expect(leadSeven).toBeGreaterThanOrEqual(0)
    expect(leadTwo).toBeGreaterThanOrEqual(0)

    // Keeping the 7 is an instant loss: exactly zero, not merely worse.
    expect(solved.values[leadTwo]![0]).toBe(0)
    expect(solved.values[leadSeven]![0]).toBeGreaterThan(0)
  })

  it('reports a value for every seat, all of them probabilities', () => {
    const result = solveEndgame(table(hands), OPTIMAL)
    expect(result.exact).toBe(true)
    for (const value of result.values) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('sees an instant loss coming even when the scores are comfortable', () => {
    // Seat 0 is far behind on points, and it makes no difference at all.
    const sim = table([['2C', 'JOKER_1'], ['3D', '4D'], ['5H', '6H']], [0, 18, 18])
    const candidates = candidatesFor(sim, 0)
    const solved = solveChoices(sim, 0, candidates, OPTIMAL)
    const keepJoker = candidates.findIndex((c) => c.counts[0]! === 1)
    expect(solved.values[keepJoker]![0]).toBe(0)
  })
})

describe('the solver is never worse than the guess it replaces', () => {
  /**
   * In model mode the opponents are assumed to play the heuristic, and the
   * heuristic's own choice is one of the moves the solver considers. So the
   * solved value can never come out below simply playing the heuristic line —
   * if it ever does, the search has a bug.
   */
  function heuristicValue(sim: Sim): number {
    const played = cloneSim(sim)
    playOut(played, [policy, policy, policy])
    return handValue(settleHand(played.scores, finalClasses(played)), 0)
  }

  it('beats or matches the heuristic on many random endings', () => {
    let strictlyBetter = 0
    for (let trial = 0; trial < 200; trial++) {
      const sim = randomEnding(trial, 4)
      const candidates = candidatesFor(sim, sim.actionSeat)
      if (sim.actionSeat !== 0) continue
      const solved = solveChoices(sim, 0, candidates, MODEL)
      const best = Math.max(...solved.values.map((v) => v[0]!))
      const guess = heuristicValue(sim)
      expect(best).toBeGreaterThanOrEqual(guess - 1e-9)
      if (best > guess + 1e-9) strictlyBetter++
    }
    // And it should actually find improvements, not just tie every time.
    expect(strictlyBetter).toBeGreaterThan(0)
  })
})

describe('the solver is stable', () => {
  it('gives the same answer twice', () => {
    const sim = randomEnding(7, 5)
    const a = solveEndgame(sim, OPTIMAL)
    const b = solveEndgame(sim, OPTIMAL)
    expect(a.values).toEqual(b.values)
    expect(a.nodes).toBe(b.nodes)
  })

  it('leaves the position it was given untouched', () => {
    const sim = randomEnding(9, 4)
    const before = JSON.stringify([...sim.hands.map((h) => [...h])])
    solveEndgame(sim, OPTIMAL)
    expect(JSON.stringify([...sim.hands.map((h) => [...h])])).toBe(before)
  })

  it('says so when it runs out of budget', () => {
    const sim = randomEnding(3, 7)
    const result = solveEndgame(sim, { ...OPTIMAL, nodeBudget: 50 })
    expect(result.exact).toBe(false)
  })
})

/** A random position with `k` cards in every hand. */
function randomEnding(seed: number, k: number): Sim {
  let state = (seed * 2654435761) >>> 0
  const next = (max: number) => {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state % max
  }
  const supply = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 6]
  const deck: number[] = []
  for (let c = 0; c < supply.length; c++) for (let n = supply[c]!; n > 0; n--) deck.push(c)
  for (let i = deck.length - 1; i > 0; i--) {
    const j = next(i + 1)
    const a = deck[i]!
    deck[i] = deck[j]!
    deck[j] = a
  }
  const hands: [Counts, Counts, Counts] = [emptyCounts(), emptyCounts(), emptyCounts()]
  let at = 0
  for (let n = 0; n < k; n++) for (let seat = 0; seat < 3; seat++) hands[seat]![deck[at++]!]!++
  return newSim(hands, [0, 0, 0], 0)
}
