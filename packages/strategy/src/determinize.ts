import {
  CLASS_COUNT,
  cloneCounts,
  emptyCounts,
  fullDeckCounts,
  totalOf,
  type CardClass,
  type Counts,
} from './classes.ts'
import type { Random } from './random.ts'
import { canMeet } from './rules.ts'
import type { SeatIndex } from './sim.ts'

/**
 * Everything one player is allowed to know. Built only from their own cards
 * and what happened in front of everyone — never from the true deal.
 */
export interface InfoSet {
  seat: SeatIndex
  /** My hand, which I can obviously see. */
  hand: Counts
  /** Cards played out to tricks this hand, including the current one. */
  played: Counts
  /** Cards I personally saw and parted with — my own exchange discards. */
  mine: Counts
  /** How many cards each seat holds, including me. */
  handSizes: [number, number, number]
  scores: [number, number, number]
  /**
   * Per seat, every target that seat was publicly seen to fail against this
   * hand.
   *
   * This is the richest thing the game gives away for free. A player only
   * fails when their *whole hand* could not answer — and hands only ever
   * shrink, never grow, during trick play. So a failure witnessed at any point
   * is still true of the cards they are holding now, and it rules out worlds
   * that a naive deal would happily invent.
   */
  failures?: CardClass[][][]
}

/**
 * Cards that could be anywhere the player cannot see.
 *
 * The counts are supplied by the caller and can disagree with the deck if
 * their memory of their own discards has drifted — a submission that was
 * refused and re-sent used to be remembered twice. This clamps rather than
 * throws, because the caller is usually an advisor inside somebody's game,
 * and the right answer to a slightly stale belief is worse advice, not a dead
 * player. `unseenPoolExact` is available where the disagreement matters.
 */
export function unseenPool(info: InfoSet): Counts {
  const pool = fullDeckCounts()
  for (let c = 0; c < CLASS_COUNT; c++) {
    pool[c] = Math.max(0, pool[c]! - (info.hand[c]! + info.played[c]! + info.mine[c]!))
  }
  return pool
}

/** How far the information set disagrees with a 54-card deck, if at all. */
export function poolOvercount(info: InfoSet): number {
  const deck = fullDeckCounts()
  let over = 0
  for (let c = 0; c < CLASS_COUNT; c++) {
    const claimed = info.hand[c]! + info.played[c]! + info.mine[c]!
    if (claimed > deck[c]!) over += claimed - deck[c]!
  }
  return over
}

/**
 * How the opponents' hands came to be what they are.
 *
 * Without this, a world is drawn uniformly from the unseen cards — which is
 * correct only if nobody exchanged. Players who exchange throw their *worst*
 * cards away face down, so the unseen pool is systematically weak and the
 * hands they kept are systematically strong. Drawing uniformly hands them
 * worse cards than they hold, and every estimate built on those worlds
 * flatters the observer.
 *
 * Measured: with an exchange of 3 the honest oracle claimed 0.713 where 0.632
 * survived, 6.5 sigma, reliability 0.0071. With no exchange and nothing else
 * changed, 0.645 against 0.634 — 0.8 sigma, reliability 0.0005. The prior is
 * the difference. See `tools/exchange-control.ts`.
 *
 * The model is generative and uses no hidden cards: draw a hypothetical
 * pre-discard hand and let the seat's own discard policy choose what it would
 * have thrown.
 */
export interface WorldPrior {
  /** Cards each seat exchanged this hand. Public — everyone watched. */
  exchanged: readonly [number, number, number]
  /** What a hand would throw away, given the chance. */
  discards: (hand: Counts, n: number) => Counts
}

export interface World {
  hands: [Counts, Counts, Counts]
  /** The stock and the face-down discards — dead for this hand, but a source
   *  of draws while the exchange is still running. */
  rest: number[]
}

/**
 * A failure, expressed as something a hand cannot contain.
 *
 * `!canMeet(hand, target)` holds exactly when, for some position i in the
 * sorted target, the hand has fewer than (n - i) cards of class at least
 * target[i]. So every failure is a disjunction of simple counting statements:
 * "at most k cards at or above class c". A single-card failure collapses to
 * the strongest of them — at most zero cards at or above the target.
 */
interface CountLimit {
  atOrAbove: CardClass
  atMost: number
}

function limitsFor(target: readonly CardClass[]): CountLimit[] {
  const n = target.length
  const limits: CountLimit[] = []
  for (let i = 0; i < n; i++) {
    limits.push({ atOrAbove: target[i]!, atMost: n - i - 1 })
  }
  return limits
}

/**
 * Draw `count` cards from `pool` without breaking any limit. Cards are taken
 * one at a time from whatever is still allowed, so a constraint is satisfied
 * by construction rather than by throwing away deals that violate it.
 */
function drawWithin(
  pool: Counts,
  count: number,
  limits: readonly CountLimit[],
  random: Random,
): Counts | null {
  const taken = emptyCounts()
  const above = limits.map(() => 0)
  for (let n = 0; n < count; n++) {
    // A class is allowed if taking one more would not break any limit.
    let eligible = 0
    const allowed: boolean[] = new Array(CLASS_COUNT).fill(false)
    for (let c = 0; c < CLASS_COUNT; c++) {
      if (pool[c]! === 0) continue
      let ok = true
      for (let l = 0; l < limits.length; l++) {
        if (c >= limits[l]!.atOrAbove && above[l]! + 1 > limits[l]!.atMost) {
          ok = false
          break
        }
      }
      if (!ok) continue
      allowed[c] = true
      eligible += pool[c]!
    }
    if (eligible === 0) return null

    let index = random.int(eligible)
    let chosen = -1
    for (let c = 0; c < CLASS_COUNT; c++) {
      if (!allowed[c]) continue
      index -= pool[c]!
      if (index < 0) {
        chosen = c
        break
      }
    }
    if (chosen < 0) return null

    pool[chosen]!--
    taken[chosen]!++
    for (let l = 0; l < limits.length; l++) {
      if (chosen >= limits[l]!.atOrAbove) above[l]!++
    }
  }
  return taken
}

/** How tightly each seat is pinned down, for ordering the deal. */
function tightness(info: InfoSet, seat: SeatIndex): number {
  let tightest = CLASS_COUNT
  for (const target of info.failures?.[seat] ?? []) {
    for (const limit of limitsFor(target)) {
      if (limit.atMost === 0) tightest = Math.min(tightest, limit.atOrAbove)
    }
  }
  return tightest
}

/**
 * Deal the unseen cards into one concrete possibility consistent with
 * everything the player knows — including what the others have shown they
 * cannot hold. Whatever is left over is the stock and the face-down discards.
 */
/**
 * Does this hand satisfy every failure recorded against a seat? A seat that
 * was seen to fail a target cannot be holding a hand that could have met it.
 */
export function consistentWith(
  hand: Counts,
  targets: readonly (readonly CardClass[])[],
): boolean {
  for (const target of targets) {
    if (canMeet(hand, target)) return false
  }
  return true
}

export function sampleFullWorld(
  info: InfoSet,
  random: Random,
  /** Supplied where the exchange is known; omitted, the draw is uniform. */
  prior?: WorldPrior,
  attempts = 8,
  /**
   * Unconstrained draws to try before falling back to construction.
   *
   * A rejection draw that survives the check is an exact sample from the
   * posterior; the constructive draw below is not. `drawWithin` takes each
   * card uniformly from whatever is still allowed, which over-weights hands
   * that press against the limit, and picking one branch of the failure
   * disjunction uniformly over-weights the narrow branches. Together those
   * put a HIGH in a two-card hand that failed a pair of HIGHs 22.5% of the
   * time where the conditional-uniform answer is 42.1%. So: sample properly
   * when we can, and construct only when rejection is too slow.
   *
   * With no recorded failures this succeeds on the first try and costs
   * nothing, which is the common case.
   */
  rejectionAttempts = 64,
): World {
  const basePool = unseenPool(info)
  const others = ([0, 1, 2] as SeatIndex[]).filter((seat) => seat !== info.seat)
  // The most pinned-down seat picks first, while cards that can satisfy it
  // still remain in the pool.
  const order = [...others].sort((a, b) => tightness(info, a) - tightness(info, b))

  const constrained = others.filter((seat) => (info.failures?.[seat]?.length ?? 0) > 0)

  for (let attempt = 0; attempt < rejectionAttempts; attempt++) {
    const pool = cloneCounts(basePool)
    const dealt: [Counts, Counts, Counts] = [emptyCounts(), emptyCounts(), emptyCounts()]
    dealt[info.seat] = cloneCounts(info.hand)
    let ok = true
    // Cards the imagined opponents threw away. They are unseen but they are
    // not in anybody's hand, so they must leave the pool and reappear in the
    // leftovers rather than being dealt to the next seat.
    const thrown: number[] = []
    for (const seat of order) {
      const exchanged = prior?.exchanged[seat] ?? 0
      const drawn = drawWithin(pool, info.handSizes[seat]! + exchanged, [], random)
      if (!drawn) {
        ok = false
        break
      }
      if (exchanged > 0 && prior) {
        const away = prior.discards(drawn, exchanged)
        for (let c = 0; c < CLASS_COUNT; c++) {
          for (let n = away[c]!; n > 0; n--) thrown.push(c)
          drawn[c]! -= away[c]!
        }
      }
      dealt[seat] = drawn
    }
    if (!ok) break
    // Checked after the discard, because it is the kept hand that has to be
    // consistent with what the seat was seen to fail.
    let consistent = true
    for (const seat of constrained) {
      if (!consistentWith(dealt[seat], info.failures![seat]!)) {
        consistent = false
        break
      }
    }
    if (!consistent) continue
    return { hands: dealt, rest: [...leftovers(pool), ...thrown] }
  }

  for (let attempt = 0; attempt < attempts; attempt++) {
    const pool = cloneCounts(basePool)
    const dealt: [Counts, Counts, Counts] = [emptyCounts(), emptyCounts(), emptyCounts()]
    dealt[info.seat] = cloneCounts(info.hand)
    let ok = true

    for (const seat of order) {
      // Each failure is a disjunction. Walk the branches in a rotating order
      // rather than choosing one at random: a branch may be impossible for
      // this pool, and eight independent coin flips used to land on the
      // impossible branch every time about once in 256 samples, which then
      // fell through to a world that contradicted what everyone had watched.
      const limits: CountLimit[] = []
      const targets = info.failures?.[seat] ?? []
      for (let t = 0; t < targets.length; t++) {
        const choices = limitsFor(targets[t]!)
        limits.push(choices[(attempt + t) % choices.length]!)
      }
      const drawn = drawWithin(pool, info.handSizes[seat]!, limits, random)
      if (!drawn) {
        ok = false
        break
      }
      dealt[seat] = drawn
    }
    if (!ok) continue

    if (totalOf(dealt[info.seat]) !== info.handSizes[info.seat]) {
      throw new Error('Hand size disagrees with the information set')
    }
    return { hands: dealt, rest: leftovers(pool) }
  }

  /*
   * Neither rejection nor construction found a world. Deal unconstrained and
   * then repair: hand back the cards that make a constrained seat too strong
   * and take weaker ones in exchange. This used to return the unconstrained
   * deal untouched, which quietly told the search that a seat might hold a
   * card everybody had just watched it fail to produce.
   */
  const pool = cloneCounts(basePool)
  const dealt: [Counts, Counts, Counts] = [emptyCounts(), emptyCounts(), emptyCounts()]
  dealt[info.seat] = cloneCounts(info.hand)
  for (const seat of order) {
    dealt[seat] = drawWithin(pool, info.handSizes[seat]!, [], random) ?? emptyCounts()
  }
  for (const seat of constrained) {
    repair(dealt[seat], pool, info.failures![seat]!)
  }
  return { hands: dealt, rest: leftovers(pool) }
}

function leftovers(pool: Counts): number[] {
  const rest: number[] = []
  for (let c = 0; c < CLASS_COUNT; c++) for (let n = pool[c]!; n > 0; n--) rest.push(c)
  return rest
}

/**
 * Swap a seat's strongest cards back into the pool for the weakest available
 * until it can no longer meet any target it was seen to fail. Last resort, and
 * it gives up rather than looping if the pool cannot supply a weak enough
 * card — a consistent-where-possible world beats a contradictory one.
 */
function repair(
  hand: Counts,
  pool: Counts,
  targets: readonly (readonly CardClass[])[],
): void {
  for (let guard = 0; guard < CLASS_COUNT * 2 && !consistentWith(hand, targets); guard++) {
    let strongest = -1
    for (let c = CLASS_COUNT - 1; c >= 0; c--) if (hand[c]! > 0) { strongest = c; break }
    let weakest = -1
    for (let c = 0; c < CLASS_COUNT; c++) if (pool[c]! > 0) { weakest = c; break }
    if (strongest < 0 || weakest < 0 || weakest >= strongest) return
    hand[strongest]!--
    pool[strongest]!++
    hand[weakest]!++
    pool[weakest]!--
  }
}

export function sampleWorld(
  info: InfoSet,
  random: Random,
  prior?: WorldPrior,
): [Counts, Counts, Counts] {
  return sampleFullWorld(info, random, prior).hands
}
