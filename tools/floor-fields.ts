/**
 * How much does the Brier floor move when the opponents change?
 *
 *   node --experimental-strip-types tools/floor-fields.ts <field> [matches] [oracleWorlds]
 *   node --experimental-strip-types tools/floor-fields.ts list
 *
 * `tools/floor.ts` measured the floor once, for one table: three tuned
 * heuristics exchanging three. It came out at 0.1667 against an advisor Brier
 * of 0.2074. That number is *about that table* and nothing else, because the
 * floor is `E[p*(1 − p*)]` and `p*` is the probability of surviving a match
 * against those particular opponents. Swap them and the whole quantity moves:
 * against an opponent that cannot lose the subject to save itself, survival
 * sits near 1, the variance left in the outcome collapses, and the floor goes
 * with it. A headroom quoted across fields would be comparing two different
 * games.
 *
 * So this runs the same measurement over several fields and reports each as its
 * own row. Nothing here should be read as a comparison *between* rows beyond
 * "the floor is not a constant"; each row is a different game with a different
 * base rate.
 *
 * WHAT IS MEASURED PER FIELD
 *
 *   floor, two ways        `direct` = mean p̂(1−p̂) + v, and `scored` = Brier of
 *                          p̂ − v, where v = p̂(1−p̂)/worlds is the variance the
 *                          oracle's own sampling contributes. They are biased
 *                          in opposite directions, so agreement inside the
 *                          band is the check that makes the number quotable.
 *                          (Both copied from tools/floor.ts.)
 *   oracle reliability     THE GATE. p* is calibrated by construction if it
 *                          really is p*, so reliability must be ~0. Above
 *                          0.005 the estimator is not p* and the row's floor
 *                          is not reportable. This gate has already caught one
 *                          fictional floor (H6).
 *   advisor Brier          the live advisor's odds over the same positions,
 *                          with uncertainty / resolution / reliability.
 *   headroom               advisor Brier − floor.
 *
 * TWO CONSTRAINTS, each of which has broken this measurement once.
 *
 * 1. THE ORACLE'S CONTINUATION MUST BE THE POLICIES THAT ACTUALLY PLAY. `p*` is
 *    the probability of the outcome that actually occurs. Version one of
 *    floor.ts let the advisor play the subject seat while the oracle imagined
 *    heuristics finishing the job, and produced a floor *above* the advisor's
 *    own Brier — impossible, and the tell. Every field below therefore builds
 *    one seat-ordered line and hands the *same* line to `honestSurvival`. There
 *    is no assertion guarding this and there does not need to be: `oracleLine`
 *    is built once per match and the played line is copied from it, so the two
 *    cannot drift apart without someone deleting that copy.
 *
 * 2. THE EXCHANGE PRIOR MUST BE PASSED. Without `exchanged`, worlds are drawn
 *    uniformly from the unseen pool, which is right only if nobody exchanged.
 *    Players throw their *worst* cards face down, so the leftover pool is
 *    systematically weak and a uniform draw flatters the subject by 8.2 points
 *    of survival, 6.5σ (tools/exchange-control.ts). It is derived from the
 *    field's own exchange size here rather than hard-coded, and omitted when
 *    that size is 0, where the uniform draw is correct by construction.
 *
 * THE MIRROR FIELD IS THE EXPENSIVE ONE and it is the one that matters, since
 * three searching advisors is what the live game runs. The oracle plays
 * hundreds of worlds per position and each world plays a whole match, so with
 * search players in the line every world costs ~2,300× a heuristic world.
 * `cost` below measures that price directly instead of guessing at it. Measured
 * here: one mirror oracle world costs 0.44s against 0.058ms for a heuristic one,
 * a factor of 7,600. So the four heuristic fields are 44–136s each on one core
 * at 400 matches and 200 worlds, while the mirror field at 360 matches and 40
 * worlds is 18.2 CPU-hours — 100 minutes across twelve shards.
 *
 * BOTH CHECKS HAVE A NOISE FLOOR, AND AT SMALL n IT REACHES THE GATE. Measured,
 * not assumed: the tuned field — whose oracle passes at 0.0016 over 400
 * matches — was re-run as ten *independent* samples at 40 worlds, to see what a
 * known-good oracle reports at the sizes the mirror field can afford.
 *
 *   ten samples of 120 matches, reliability:
 *     0.0028 0.0029 0.0016 0.0010 0.0029 0.0014 0.0063 0.0055 0.0009 0.0018
 *   ten samples of 360 matches, reliability:
 *     0.0013 0.0012 0.0023 0.0007 0.0014 0.0010 0.0017 0.0017 0.0013 0.0015
 *   ten samples of 360 matches, |direct − scored|:
 *     0.0116 0.0051 0.0007 0.0019 0.0100 0.0015 0.0090 0.0006 0.0082 0.0033
 *
 * Two of ten cross the 0.005 gate at n=120 with a perfectly good oracle, so a
 * failure there means nothing; by n=360 the worst reading is 0.0023 and the gate
 * is a real test. Read a mirror row against these columns, not against the
 * constant alone — passing 0.005 while sitting at twice the null maximum is not
 * the same as passing.
 *
 * Matches are the lever and worlds are not. Holding 400 matches, dropping 200
 * worlds to 40 moved the reliability 0.0016 → 0.0015; holding 40 worlds,
 * dropping 400 matches to 120 moved it 0.0015 → 0.0028. Spend the budget on
 * matches.
 *
 * WHAT THIS FOUND, 2026-09-15. Four fields cleared both checks and their floors
 * are 0.0000 (vs cheapest), 0.0212 (vs wide), 0.0448 (vs dumper) and 0.1667
 * (three tuned), against bands of ±0.0045 or tighter — the floor is not remotely
 * a constant, and every adjacent pair separates by more than ten sigma.
 *
 * The mirror field did not clear. At 360 matches its reliability is 0.0043,
 * inside the gate but twice the worst of the ten null samples, and `direct` and
 * `scored` differ by 0.0361 against a band of 0.0207 and a null range whose
 * maximum is 0.0116. Its oracle claims 0.7160 where 0.6668 survives and every
 * bin bends the same way (91→83, 69→64). That is the H6 signature at about half
 * the amplitude, so no floor is reported for the field the live game actually
 * runs. `honestSurvival`'s sampler models the exchange and the public failures,
 * but nothing about what a seat's *choices* imply about its hand — and a
 * searching opponent's choices carry far more of that than a heuristic's. That
 * is a hypothesis, untested, and the obvious next control is to vary opponent
 * search strength and see whether the gap tracks it.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import {
  TUNED,
  archetypePlayer,
  brierBand,
  cloneCounts,
  decompose,
  heuristicPlayer,
  honestSurvival,
  playMatch,
  searchActions,
  searchPolicy,
  weightedDiscards,
  xorshift,
  type Claim,
  type InfoSet,
  type Player,
  type Policy,
  type Random,
  type SeatIndex,
  type TrickContext,
} from '@cucumber/strategy'

/** The advisor the app ships: tuned weights, 160 worlds. Fixed across fields —
 *  it is the thing being measured, not part of the field. */
const SEARCH_WORLDS = 160
const GATE = 0.005

interface Field {
  name: string
  note: string
  /** Cards every seat exchanges. 0 means no exchange prior is passed. */
  exchange: number
  /** The seat under the microscope. */
  subject: (random: Random) => Player
  /** The other two seats. Two entries so an asymmetric field stays possible. */
  opponents: (random: Random) => [Player, Player]
  /**
   * True when the subject plays by searching, i.e. the subject *is* the
   * advisor. Then the claim is taken from that same search through
   * `onEstimate`, rather than running a second identical search beside it —
   * which is not a shortcut but the accurate thing, since the number the app
   * displays is exactly the one its own move came from. It also halves the
   * cost of the only field expensive enough for that to matter.
   */
  subjectSearches: boolean
}

const tuned = () => heuristicPlayer('tuned', TUNED, 3)

const FIELDS: Field[] = [
  {
    name: 'tuned',
    note: 'three tuned heuristics — reproduces tools/floor.ts',
    exchange: 3,
    subject: tuned,
    opponents: () => [tuned(), tuned()],
    subjectSearches: false,
  },
  {
    name: 'cheapest',
    note: 'tuned subject vs two cheapest — the weakest archetype (subject loses 0.01%)',
    exchange: 3,
    subject: tuned,
    opponents: () => [archetypePlayer('cheapest', 3), archetypePlayer('cheapest', 3)],
    subjectSearches: false,
  },
  {
    name: 'wide',
    note: 'tuned subject vs two wide — weak but not hopeless (subject loses 3.99%)',
    exchange: 3,
    subject: tuned,
    opponents: () => [archetypePlayer('wide', 3), archetypePlayer('wide', 3)],
    subjectSearches: false,
  },
  {
    name: 'dumper',
    note: 'tuned subject vs two dumper — the toughest archetype (subject loses 8.91%)',
    exchange: 3,
    subject: tuned,
    // Its own discard rule is `forcedLow`, not `weightedDiscards`, and the
    // oracle's exchange prior models the opponents with whatever they actually
    // use — so passing these same Players to `honestSurvival` keeps the prior
    // honest as well as the continuation.
    opponents: () => [archetypePlayer('dumper', 3), archetypePlayer('dumper', 3)],
    subjectSearches: false,
  },
  {
    name: 'mirror',
    note: `three searching advisors at ${SEARCH_WORLDS} worlds — what the live game runs`,
    exchange: 3,
    subject: (random) => searchPlayerAt(random, 'advisor-subject'),
    opponents: (random) => [
      searchPlayerAt(random, 'advisor-left'),
      searchPlayerAt(random, 'advisor-right'),
    ],
    subjectSearches: true,
  },
]

/**
 * A searching player built the way the app builds one. Written out rather than
 * using `searchPlayer` so the subject seat can reuse the search it already did
 * for its claim; the options must stay identical between the two so the field
 * is one policy and not two.
 */
function searchOptions() {
  return { worlds: SEARCH_WORLDS, weights: TUNED, maxActions: 14, screen: true, inference: true }
}

function searchPlayerAt(random: Random, name: string): Player {
  return {
    name,
    policy: searchPolicy(random, searchOptions()),
    exchangeSize: () => 3,
    takeExchange: (_hand, size) => size,
    discards: weightedDiscards(TUNED),
  }
}

interface Point {
  advisor: number
  oracle: number
  /** Variance the oracle's own sampling contributed: p(1−p)/worlds. */
  v: number
  survived: boolean
}

/**
 * A shard's raw measurements, so the mirror field can be split across cores and
 * put back together. Only the per-match Briers and the points are kept, because
 * those are the only things every statistic here is computed from — and keeping
 * `perMatch` separate is what lets `brierBand` stay a band over matches after
 * the shards are joined.
 */
interface Dump {
  field: string
  matches: number
  oracleWorlds: number
  seconds: number
  points: Point[]
  perMatchOracle: number[]
  perMatchAdvisor: number[]
  /** May be absent in a dump written before it was recorded. */
  perMatchDirect?: number[]
  /** May be absent in a dump written before it was recorded. */
  perMatchSurvived?: number[]
}

interface Row {
  field: Field
  matches: number
  oracleWorlds: number
  points: Point[]
  perMatchOracle: number[]
  perMatchAdvisor: number[]
  /**
   * Per match, the mean of p̂(1−p̂) + v — the `direct` floor restricted to that
   * match's positions.
   *
   * Kept per match for the same reason the Briers are: `direct` needs no
   * outcomes, but its positions are still not independent. Seventeen decisions
   * inside one match share one deal, one score line and one set of opponents,
   * so a band taken over positions would be several times too narrow. It is
   * `direct` that gets quoted as the floor, so it is `direct` that most needs
   * an honest interval.
   */
  perMatchDirect: number[]
  /**
   * 1 or 0 per match: did the subject survive it.
   *
   * The `base` rate printed below is the mean over *positions*, which is the
   * right weighting for a Brier over positions and is what `uncertainty` uses —
   * but it is not the match-level survival rate, and the two differ by several
   * points because long matches contribute more positions than short ones. Both
   * are printed so neither gets mistaken for the other.
   */
  perMatchSurvived: number[]
  seconds: number
}

/**
 * A contiguous block of match indices, for splitting one field across
 * processes. Contiguous and not strided on purpose: the subject's seat is
 * `m % 3`, so a stride of 3 would sit one shard in seat 0 for its whole run and
 * the shards would not be measuring the same thing.
 */
interface Shard {
  index: number
  count: number
}

function measure(
  field: Field,
  matches: number,
  oracleWorlds: number,
  progress: boolean,
  shard: Shard = { index: 0, count: 1 },
  /**
   * Called after every settled match. The mirror field takes minutes per match,
   * so a shard that writes only at the end throws away an hour of work on any
   * interruption; this exists so the dump is always current.
   */
  checkpoint?: (row: Row) => void,
): Row {
  const points: Point[] = []
  const perMatchOracle: number[] = []
  const perMatchAdvisor: number[] = []
  const perMatchDirect: number[] = []
  const perMatchSurvived: number[] = []
  // One long-lived stream for the oracle's worlds, as tools/floor.ts does, so
  // successive positions are not handed the same sample. Seeded per shard, or
  // every shard would draw the identical sequence of worlds.
  const oracleRandom = xorshift(20260915 + shard.index)
  const searchRandom = xorshift(31337 + shard.index)
  const exchanged =
    field.exchange > 0
      ? ([field.exchange, field.exchange, field.exchange] as const)
      : undefined
  const started = Date.now()

  const size = Math.ceil(matches / shard.count)
  const from = shard.index * size
  const to = Math.min(matches, from + size)

  for (let m = from; m < to; m++) {
    /*
     * Seat rotation copies `trial`: subject seat m % 3, and the match's RNG is
     * xorshift(8080 + m). With the tuned field that reproduces floor.ts's deals
     * exactly, which is what makes row one a check on this harness rather than
     * another measurement.
     */
    const seat = (m % 3) as SeatIndex
    const base = field.subject(searchRandom)
    const [left, right] = field.opponents(searchRandom)

    // The line the oracle will assume, in seat order. Built once, used both to
    // play and to forecast, so constraint 1 cannot be violated by construction.
    const others = [left, right]
    const oracleLine: [Player, Player, Player] = [base, base, base]
    for (let s = 0; s < 3; s++) {
      if (s !== seat) oracleLine[s as SeatIndex] = others.shift()!
    }

    let pending: Point[] = []

    /** Reports where the subject's own search landed, when it searches. */
    let stated: number | undefined
    const play: Policy = field.subjectSearches
      ? searchPolicy(searchRandom, {
          ...searchOptions(),
          onEstimate: (value) => {
            stated = value
          },
        })
      : base.policy

    const watching: Policy = (view, candidates) => {
      stated = undefined
      const choice = play(view, candidates)
      if (candidates.length <= 1) return choice

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
      // Either the search the subject just did, or — when the subject plays
      // something else — the advisor watching over its shoulder. floor.ts uses
      // a fresh xorshift(4242) per position for the watching case; kept, so the
      // tuned row reproduces rather than merely resembles.
      const advisor =
        stated ?? searchActions(info, trick, xorshift(4242), searchOptions()).best
      /*
       * `oracleWorlds = 0` skips the oracle entirely and measures only the
       * advisor. That is not a cheaper floor, and no floor is printed for such
       * a run — it exists because the oracle costs ~99.8% of the runtime in the
       * mirror field, so a few hundred matches is all the floor can afford, and
       * 360 of them still leave the advisor's Brier with a band near ±0.025. Without a way
       * to run the advisor alone at large n, a difference of 0.02 between two
       * fields' advisor Briers could not be told from noise — which is exactly
       * the mistake this project has already made once at n=400.
       */
      const honest =
        oracleWorlds > 0
          ? honestSurvival(info, trick, oracleRandom, {
              worlds: oracleWorlds,
              players: oracleLine,
              ...(exchanged ? { exchanged } : {}),
            })
          : undefined
      pending.push({
        advisor,
        oracle: honest?.survival ?? Number.NaN,
        v: honest?.bias ?? 0,
        survived: false,
      })
      return choice
    }

    const subject: Player = { ...base, name: 'watched', policy: watching }
    const line: [Player, Player, Player] = [oracleLine[0], oracleLine[1], oracleLine[2]]
    line[seat] = subject

    const record = playMatch(line, xorshift(8080 + m))
    const survived = !record.losers.includes(seat)
    if (pending.length === 0) continue

    /*
     * Outcomes settle per match. Every claim made inside one match shares that
     * match's single outcome, which is why the bands below are taken over
     * matches and never over positions.
     */
    const y = survived ? 1 : 0
    perMatchSurvived.push(y)
    perMatchOracle.push(pending.reduce((s, p) => s + (p.oracle - y) ** 2, 0) / pending.length)
    perMatchDirect.push(
      pending.reduce((s, p) => s + p.oracle * (1 - p.oracle) + p.v, 0) / pending.length,
    )
    perMatchAdvisor.push(pending.reduce((s, p) => s + (p.advisor - y) ** 2, 0) / pending.length)
    for (const p of pending) points.push({ ...p, survived })
    pending = []

    const spentSoFar = (Date.now() - started) / 1000
    checkpoint?.({
      field,
      matches: perMatchAdvisor.length,
      oracleWorlds,
      points,
      perMatchOracle,
      perMatchAdvisor,
      perMatchDirect,
      perMatchSurvived,
      seconds: spentSoFar,
    })

    if (progress) {
      const spent = spentSoFar
      const done = m - from + 1
      process.stderr.write(
        `  [${field.name} shard ${shard.index}] match ${done}/${to - from}  ${points.length} positions  ` +
          `${spent.toFixed(0)}s  (${(spent / done).toFixed(1)}s/match)\n`,
      )
    }
  }

  return {
    field,
    matches: to - from,
    oracleWorlds,
    points,
    perMatchOracle,
    perMatchAdvisor,
    perMatchDirect,
    perMatchSurvived,
    seconds: (Date.now() - started) / 1000,
  }
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const f = (x: number) => x.toFixed(4)

interface Summary {
  name: string
  matches: number
  positions: number
  seconds: number
  base: number
  direct: number
  directBand: number
  scored: number
  v: number
  oracleReliability: number
  oracleBand: number
  advisorBrier: number
  advisorBand: number
  advisorUncertainty: number
  advisorResolution: number
  advisorReliability: number
  headroom: number
  passed: boolean
  agree: boolean
  measured: boolean
}

function report(row: Row): Summary {
  const { points } = row
  const v = mean(points.map((p) => p.v))
  const direct = mean(points.map((p) => p.oracle * (1 - p.oracle))) + v

  const oracleClaims: Claim[] = points.map((p) => ({ p: p.oracle, y: p.survived ? 1 : 0 }))
  const advisorClaims: Claim[] = points.map((p) => ({ p: p.advisor, y: p.survived ? 1 : 0 }))
  const oracle = decompose(oracleClaims)
  const advisor = decompose(advisorClaims)
  const oracleBand = brierBand(row.perMatchOracle)
  const advisorBand = brierBand(row.perMatchAdvisor)
  // Same estimator as brierBand — 1.96·sd/√n over matches — applied to the
  // quantity that is actually quoted as the floor.
  const directBand = brierBand(row.perMatchDirect)
  const scored = oracle.brier - v
  // An advisor-only run (0 worlds) has no oracle to gate, and must not be able
  // to print a floor of NaN that a later reader mistakes for a measurement.
  const measured = row.oracleWorlds > 0
  const passed = measured && oracle.reliability < GATE
  const agree = Math.abs(direct - scored) <= Math.max(oracleBand, advisorBand)

  console.log('')
  console.log(`=== ${row.field.name} — ${row.field.note}`)
  console.log(
    `    ${row.matches} matches, ${points.length} positions, ${row.oracleWorlds} oracle worlds each, ${row.seconds.toFixed(1)}s`,
  )
  console.log(
    `    exchange ${row.field.exchange}${row.field.exchange > 0 ? ' (prior passed to the oracle)' : ' (no prior needed)'}` +
      `, subject ${row.field.subjectSearches ? 'searches — its own odds are the claim' : 'plays the heuristic — the advisor watches'}`,
  )
  // Standard error over matches, the independent events — never over positions.
  const matchBase = row.perMatchSurvived.length > 0 ? mean(row.perMatchSurvived) : Number.NaN
  const matchSe = Math.sqrt((matchBase * (1 - matchBase)) / row.perMatchSurvived.length)
  console.log(
    `    survived ${f(mean(points.map((p) => (p.survived ? 1 : 0))))} of positions` +
      `${row.perMatchSurvived.length > 0 ? `, ${f(matchBase)} ± ${f(1.96 * matchSe)} of matches` : ''}` +
      `${measured ? `   oracle said ${f(mean(points.map((p) => p.oracle)))}` : ''}` +
      `   advisor said ${f(mean(points.map((p) => p.advisor)))}`,
  )
  console.log('')
  if (measured) {
    console.log(`    THE GATE  oracle reliability  ${f(oracle.reliability)}   ${passed ? `PASS (< ${GATE})` : `FAIL (>= ${GATE}) — no floor reportable`}`)
    console.log(`              direct vs scored    ${f(direct)} vs ${f(scored)}   differ ${f(Math.abs(direct - scored))} against band ${f(oracleBand)}   ${agree ? 'AGREE' : 'DISAGREE'}`)
    console.log('')
    const caveat = passed && agree ? '' : '   <- NOT A FLOOR, a check failed above'
    console.log(`    floor direct  E[p*(1−p*)]     ${f(direct)}   ± ${f(directBand)}   (+${f(v)} sampling added back)${caveat}`)
    console.log(`    floor scored  Brier of p* −v  ${f(scored)}   ± ${f(oracleBand)}${caveat}`)
    console.log(`      oracle  uncertainty ${f(oracle.uncertainty)}  − resolution ${f(oracle.resolution)}  + reliability ${f(oracle.reliability)}`)
    for (const b of oracle.bins) {
      console.log(`        said ${(b.said * 100).toFixed(0).padStart(3)}%  happened ${(b.happened * 100).toFixed(0).padStart(3)}%   n=${b.count}`)
    }
  } else {
    console.log('    NO FLOOR — oracle skipped (0 worlds). The advisor block below is the')
    console.log('    whole result; nothing here bounds what a forecaster could achieve.')
  }
  console.log('')
  console.log(`    advisor Brier                 ${f(advisor.brier)}   ± ${f(advisorBand)}`)
  console.log(`      advisor uncertainty ${f(advisor.uncertainty)}  − resolution ${f(advisor.resolution)}  + reliability ${f(advisor.reliability)}`)
  for (const b of advisor.bins) {
    console.log(`        said ${(b.said * 100).toFixed(0).padStart(3)}%  happened ${(b.happened * 100).toFixed(0).padStart(3)}%   n=${b.count}`)
  }
  console.log('')
  if (measured) {
    console.log(
      `    headroom (advisor − floor)    ${f(advisor.brier - direct)}` +
        `${passed && agree ? '' : '   <- meaningless, there is no floor for this row'}`,
    )
  }

  return {
    name: row.field.name,
    matches: row.perMatchAdvisor.length,
    positions: points.length,
    seconds: row.seconds,
    base: mean(points.map((p) => (p.survived ? 1 : 0))),
    direct,
    scored,
    v,
    oracleReliability: oracle.reliability,
    oracleBand,
    directBand,
    advisorBrier: advisor.brier,
    advisorBand,
    advisorUncertainty: advisor.uncertainty,
    advisorResolution: advisor.resolution,
    advisorReliability: advisor.reliability,
    headroom: advisor.brier - direct,
    passed,
    agree,
    measured,
  }
}

/**
 * What a mirror-field position costs, measured rather than assumed.
 *
 * Reported as seconds per oracle world per position, which is the number that
 * decides whether the field is affordable: everything else (positions per
 * match, worlds, matches) multiplies it. Run this before committing hours.
 */
function cost(oracleWorlds: number): void {
  console.log(`cost probe — mirror field, one position, ${oracleWorlds} oracle worlds`)
  const random = xorshift(4242)
  const line: [Player, Player, Player] = [
    searchPlayerAt(random, 'a'),
    searchPlayerAt(random, 'b'),
    searchPlayerAt(random, 'c'),
  ]

  let captured: { info: InfoSet; trick: TrickContext } | undefined
  let decisions = 0
  const probe: Policy = (view, candidates) => {
    if (candidates.length > 1) {
      decisions++
      // Cloned, because the sim mutates these arrays in place. The first
      // version of this probe held the live ones, priced a position an hour of
      // play later, and crashed inside playOut on a hand it no longer had.
      captured ??= {
        info: {
          seat: view.seat,
          hand: cloneCounts(view.hand),
          played: cloneCounts(view.played),
          mine: cloneCounts(view.mine),
          handSizes: [...view.handSizes] as [number, number, number],
          scores: [...view.scores] as [number, number, number],
          failures: view.failures.map((seat) => seat.map((t) => [...t])),
        },
        trick: {
          leaderSeat: view.leaderSeat,
          successfulSeat: view.successfulSeat,
          target: [...view.target],
          playsMade: view.playsMade,
        },
      }
    }
    return line[0]!.policy(view, candidates)
  }

  // One searching match, to learn both the per-match search cost and how many
  // forecastable positions a match actually contains.
  const played: [Player, Player, Player] = [{ ...line[0]!, policy: probe }, line[1]!, line[2]!]
  const t0 = Date.now()
  const record = playMatch(played, xorshift(8080))
  const matchSeconds = (Date.now() - t0) / 1000
  console.log(`  one searching match: ${matchSeconds.toFixed(1)}s, ${record.hands} hands, ${decisions} subject decisions`)

  if (!captured) {
    console.log('  no multi-candidate decision found; nothing to price')
    return
  }
  const t1 = Date.now()
  honestSurvival(captured.info, captured.trick, xorshift(7), {
    worlds: oracleWorlds,
    players: line,
    exchanged: [3, 3, 3],
  })
  const oracleSeconds = (Date.now() - t1) / 1000
  const perWorld = oracleSeconds / oracleWorlds
  console.log(`  one oracle call at ${oracleWorlds} worlds: ${oracleSeconds.toFixed(1)}s  (${perWorld.toFixed(3)}s per world)`)
  console.log('')
  console.log(`  so one match costs about ${(matchSeconds + decisions * oracleWorlds * perWorld).toFixed(0)}s at ${oracleWorlds} oracle worlds`)
  for (const worlds of [40, 100, 200]) {
    const per = matchSeconds + decisions * worlds * perWorld
    console.log(
      `    ${String(worlds).padStart(3)} worlds: ${per.toFixed(0)}s/match  →  ` +
        [30, 100, 400].map((m) => `${m} matches ${((per * m) / 3600).toFixed(1)}h`).join(', '),
    )
  }
  console.log('')
  console.log('  Note the first column is per *subject decision*, and the oracle')
  console.log('  cost dominates the match cost by two orders of magnitude, so the')
  console.log('  only lever with real weight is the world count.')
}

const which = process.argv[2] ?? 'tuned'

if (which === 'list') {
  for (const field of FIELDS) console.log(`${field.name.padEnd(10)} ${field.note}`)
  console.log('')
  console.log('floor-fields.ts <field|cheap> [matches] [oracleWorlds] [shardIndex] [shardCount] [dump.json]')
  console.log('floor-fields.ts cost [worlds]            price one mirror-field position')
  console.log('floor-fields.ts combine dump.json...     join shards and report once')
  process.exit(0)
}

if (which === 'cost') {
  cost(Number(process.argv[3] ?? 20))
  process.exit(0)
}

if (which === 'combine') {
  const paths = process.argv.slice(3)
  if (paths.length === 0) {
    console.log('combine needs at least one dump')
    process.exit(1)
  }
  const dumps: Dump[] = paths.map((p) => JSON.parse(readFileSync(p, 'utf8')) as Dump)
  const names = new Set(dumps.map((d) => d.field))
  const worlds = new Set(dumps.map((d) => d.oracleWorlds))
  // Joining two fields, or two world counts, would silently average different
  // games into one row. That is the exact error this whole file is about.
  if (names.size !== 1 || worlds.size !== 1) {
    console.log(`refusing to combine across fields ${[...names]} / worlds ${[...worlds]}`)
    process.exit(1)
  }
  const field = FIELDS.find((x) => x.name === dumps[0]!.field)
  if (!field) {
    console.log(`unknown field ${dumps[0]!.field}`)
    process.exit(1)
  }
  report({
    field,
    matches: dumps.reduce((s, d) => s + d.matches, 0),
    oracleWorlds: dumps[0]!.oracleWorlds,
    points: dumps.flatMap((d) => d.points),
    perMatchOracle: dumps.flatMap((d) => d.perMatchOracle),
    perMatchDirect: dumps.flatMap((d) => d.perMatchDirect ?? []),
    perMatchSurvived: dumps.flatMap((d) => d.perMatchSurvived ?? []),
    perMatchAdvisor: dumps.flatMap((d) => d.perMatchAdvisor),
    // Wall clock across shards that ran at once, so the total is the longest,
    // not the sum; the sum is reported too since it is the real CPU price.
    seconds: Math.max(...dumps.map((d) => d.seconds)),
  })
  console.log(`    ${dumps.length} shards, ${dumps.reduce((s, d) => s + d.seconds, 0).toFixed(0)}s of CPU across them`)
  process.exit(0)
}

const matches = Number(process.argv[3] ?? 400)
const oracleWorlds = Number(process.argv[4] ?? 200)
const shard: Shard = { index: Number(process.argv[5] ?? 0), count: Number(process.argv[6] ?? 1) }
const dumpTo = process.argv[7]
const chosen =
  which === 'cheap'
    ? FIELDS.filter((field) => !field.subjectSearches)
    : FIELDS.filter((field) => field.name === which)

if (chosen.length === 0) {
  console.log(`no field called ${which}; try: list, cost, combine, cheap, ${FIELDS.map((x) => x.name).join(', ')}`)
  process.exit(1)
}

const write = (row: Row): void => {
  if (!dumpTo) return
  const dump: Dump = {
    field: row.field.name,
    matches: row.perMatchAdvisor.length,
    oracleWorlds: row.oracleWorlds,
    seconds: row.seconds,
    points: row.points,
    perMatchOracle: row.perMatchOracle,
    perMatchDirect: row.perMatchDirect,
    perMatchSurvived: row.perMatchSurvived,
    perMatchAdvisor: row.perMatchAdvisor,
  }
  writeFileSync(dumpTo, JSON.stringify(dump))
}

const summaries: Summary[] = []
for (const field of chosen) {
  const row = measure(field, matches, oracleWorlds, field.subjectSearches, shard, write)
  if (row.points.length === 0) {
    console.log(`${field.name}: no positions measured`)
    continue
  }
  write(row)
  summaries.push(report(row))
}

console.log('')
console.log('field      base     floor direct  floor scored  oracle rel  advisor Brier      headroom  matches  positions  runtime')
for (const s of summaries) {
  console.log(
    `${s.name.padEnd(10)} ${f(s.base)} ${(s.measured ? `${f(s.direct)} ± ${f(s.directBand)}` : 'not measured').padStart(17)} ${(s.measured ? f(s.scored) : '—').padStart(13)} ` +
      `${(s.measured ? f(s.oracleReliability) : '—').padStart(11)} ${`${f(s.advisorBrier)} ± ${f(s.advisorBand)}`.padStart(17)} ` +
      `${(s.measured ? f(s.headroom) : '—').padStart(13)} ${String(s.matches).padStart(8)} ${String(s.positions).padStart(10)} ${`${s.seconds.toFixed(0)}s`.padStart(8)}` +
      `${s.measured && !s.passed ? '   GATE FAILED' : ''}${s.measured && !s.agree ? '   ESTIMATORS DISAGREE — no floor' : ''}`,
  )
}
console.log('')
console.log('Each row is a different game. The floor and the advisor Brier are')
console.log('comparable down a column only in the sense that they are all floors;')
console.log('a headroom from one row says nothing about another.')
