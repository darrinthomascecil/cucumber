# Response to the algorithm review

Reviewed against `ALGORITHM-REVIEW.md`, dated 2026-09-14, on top of commit
`2f6e254`.

**I reproduced all eight defects independently, on my own seeds and my own
scripts, before changing anything.** Every one is real. Two of the review's
corrections to my own published reasoning are also right, and one of them
invalidates a headline number I had been quoting.

What follows is, for each idea: my verification, my verdict, and what I did
about it. Measurements are mine unless stated; where mine and the review's
differ, both are given.

---

## Summary

| # | Defect | Verified | Action | Measured effect on play |
|---|---|---|---|---|
| 1 | Sampler ignores opponents' exchange choices | Yes | **Not fixed** — design below | — |
| 2 | Continuation is shift-invariant and assumes one loser | Yes | **Not fixed** — design below | — |
| 3 | Heuristic action trim discards the best move | Yes | **Fixed** — rollout screen | None measurable |
| 4 | Second silent cap drops legal responses | Yes | **Fixed** — cap raised past the true bound | None measurable |
| 5 | Constrained sampling is biased; fallback contradicts public facts | Yes | **Fixed** — rejection-first sampling | None measurable |
| 6 | Failure memory discards information | Yes | **Not fixed** — design below | — |
| 7 | Heuristic can choose a certain instant loss | Yes | **Fixed** — terminal guard | **−0.24 points** |
| 8 | Exhausted solver invents endings; caller ignores `exact` | Yes | **Fixed** — plays the position out | None measurable |

Plus: benchmark `maxActions` aligned to the advisor's (was 10 vs 14), and four
documentation claims corrected, one of which was a reversed sign.

**The honest headline: every fix is verified correct at the unit level, and the
whole set together moved match strength by +0.05 points, 95% CI −1.52 to
+1.62, over 4,000 paired matches. That is nothing.** Only the instant-loss
guard has a measurable effect. I am reporting the fixes as correctness work,
not as a strength improvement, because that is what the measurements support.

---

## The two corrections to my own reasoning

### Parity is 36.4%, not one third — and one of my headline numbers was a tautology

I asserted throughout that a symmetric three-player game has ~33% parity. It
does not: ties produce multiple losers, so the three seats' loss rates sum to
more than one. Measured over 30,000 symmetric matches, all seats playing the
tuned heuristic: **32,757 losses, 36.40% per seat**, 8.75% of matches with more
than one loser. The review got 36.50% on 10,000.

This is worse than a wrong constant. My oracle table reported "heuristic, no
search: 36.90% ± 0.56" as evidence about the heuristic's strength. That
configuration is all three seats playing the *same* policy, so it is forced to
land on parity whatever the policy is. I was quoting an identity and calling it
a measurement, then computing a "recoverable gap" of 36.9 → 22.2 from it.

The search result (22.22%) is a real measurement — that is one policy against
two different ones. The baseline it was compared against was not.

### "Strategy fusion" was the wrong diagnosis for the default path

I attributed the advisor's limits, and specifically the endgame-from-8
regression, to strategy fusion. The review is right that this does not apply to
the default configuration, and I verified it by reading the code path:
`playOut` drives all three seats with `heuristicPolicy`, which is handed a
`PolicyView` containing only the acting seat's own hand, the public pile, and
public counts. It cannot condition on another seat's hidden cards in any world.
A fixed observation-respecting rollout policy does not fuse strategies.

Fusion is a real risk in the *optional* solver, which maximises separately
inside each fully-specified world. The default advisor does not enable it.

So the default algorithm's defects are the ones the review names — a wrong
posterior, a weak continuation policy, and an inaccurate leaf value — not an
architectural pathology I had been invoking to explain away null results.

---

## Defect by defect

### 1. The sampler models retained hands as unselected random cards — **not fixed**

**Verified.** 30,000 hands, all seats tuned, three-card exchange. Seat 0's
unseen pool is 38 cards; the sampler's implied mean for an opponent's count of
a class is `13 × pool[c] / 38`. Against what those opponents actually kept:

| Class | Actual minus sampler-implied, 95% CI | Review's figure |
|---|---|---|
| 8 | **−0.95769 ± 0.00338** | −0.95661 ± 0.00341 |
| 9 | −0.75412 ± 0.00421 | −0.75361 ± 0.00416 |
| 7/Joker | +0.33496 ± 0.00412 | +0.33024 ± 0.00417 |
| Ace | +0.21075 ± 0.00356 | +0.20767 ± 0.00357 |

The advisor imagines each opponent holding about one 8 that they had, in
reality, almost certainly thrown away. This is the largest single error in the
system and I agree it is the highest-value target.

**Why not fixed here.** A retention model is not a patch, it is a component: it
needs a model of what a policy discards given a hand, fitted to simulated
post-exchange hands, then conditioned on the actual exchange sizes taken, and
then validated — and it is only correct against opponents who really do
exchange that way. A human opponent needs a different prior, and the live app
faces both. Shipping a prior tuned to one opponent type without a mixture would
trade a known error for a confidently wrong one.

**Proposed design.** Estimate `P(class c retained | class c held, hand shape)`
from simulated exchanges, and draw the opponent's hand from a weighted pool
rather than a uniform one, with weights normalised so hand sizes still come out
right. Mix against the uniform prior with a weight set by how much the
opponent's observed play looks like the modelled policy. Validate by
reproducing the table above using only legal inputs, then by paired matches.

### 2. The continuation function is structurally wrong — **not fixed**

**Verified, exactly.** Both errors are algebraic, not statistical.

*Shift invariance.* Adding `k` to every score adds the same
`headroom·k/temperature` to every exponent, which cancels in the
normalisation. `survivalValue([2,5,8], s)` and `survivalValue([12,15,18], s)`
return bit-identical values for every seat — 88.0681%, 77.7510%, 34.1809% —
though one position is three points from the end of the match. Simulation puts
the trailing seat at 29.5% in the first and 11.4% in the second. The parameter
named `headroom` cannot encode headroom.

*Exactly one loser.* The three survival values sum to exactly 2.000000000000
for every score vector I tried. From `[19,19,19]` the model gives every seat
66.67%; simulation gives about 54.6%, because ties and double instant-losses
make multiple losers. The correct sum is `3 − E[losers]`.

Neither is reachable by refitting the two parameters; they are properties of
the functional form.

**Why not fixed here.** This value sits under every decision the advisor makes.
Replacing it changes all play, so it needs a fit plus a paired match campaign
large enough to detect the difference — and my end-to-end pairing showed
±1.5 points of half-width at 4,000 matches, so this needs tens of thousands.
That is a campaign, not an edit. Doing it badly is worse than the current known
error.

**Proposed design.** Generate complete continuations from a grid of score
vectors and fit a small model that takes `(scores, seat, dealer)` and returns
three values free to sum below 2. Hold out seeds and score regions, test
specifically near 21 and on ties, then run the paired match comparison. I have
documented both limits in `outcome.ts` so the next person does not rediscover
them.

### 3. The action trim discards the best move — **fixed, no measurable gain**

**Verified on my own seed, 20,000 worlds.** In the review's position — ten
cards including two 7/Jokers, 20 points, answering three 6s — the heuristic
ranks `7/Joker + 7/Joker + 6` **17th of 18** and the cut removes it. Rollout
value **43.48%**; best surviving action **34.52%**; paired difference **8.960
points, 95% CI 8.139 to 9.781** (review: 8.955, CI 8.131 to 9.779).

Worse than the review reports: **four of the top five actions by value were
excluded by the trim.** The `high` weight that makes the policy hoard 7/Jokers
is exactly the weight that hides the escape from holding them.

**Fixed.** `searchActions` no longer prunes by heuristic score. When there are
more legal actions than the cap, every action is played out over a small shared
pool of worlds and the survivors get the full budget. World count adapts to the
action count so total work stays bounded — a few dozen worlds when there are
twenty actions, a handful when there are hundreds. `screen: false` restores the
old behaviour for comparison.

**Measured: nothing.** Paired, identical deals, 3,000 matches each:

| Opponents | Screen on | Screen off | Paired difference |
|---|---|---|---|
| Tuned heuristic | 26.60% | 26.60% | **+0.00 points**, CI −0.62 to +0.62 |
| Wide archetype | 3.10% | 2.83% | +0.27 points, CI −0.38 to +0.91 |

The review predicted this: the cap binds on 0.281% of decisions against
narrow-leading opponents. I also tested the wide-leading pool where it
predicted a possible gain, and found none — the loss rate there is 3%, so
there is little room to move. The fix removes a demonstrated failure mode at
negligible cost; it does not make the player stronger against anything I have
measured.

### 4. A second silent cap drops legal responses — **fixed**

**Verified.** `qualifyingPlays` defaulted to 400. The review's constructed hand
— one each of 3 through Ace plus two 7/Jokers, answering four 2s — has **550**
distinct qualifying responses; the default returned 400 and omitted
`7/Joker + 7/Joker + Ace + King`. Confirmed exactly, including that the 550 are
genuinely distinct.

The comment claiming enumeration favours the strongest answers first is also
wrong, as the review says.

**Fixed** by raising the default to 4096 with the bound written down: a target
is at most six cards and a hand at most thirteen, so the most distinct
qualifying multisets any legal position can offer is C(13,6) = 1716. I measured
the worst case across 200,000 random legal positions (957) and constructed the
extremes (1287 at target five). The cap can no longer bind. Silent truncation
beneath a cap the caller cannot see is the part that mattered.

### 5. Constrained sampling is biased and its fallback contradicts public facts — **fixed**

**Verified, both halves.**

*Bias.* Pool of 12 low and 4 high cards, opponent holding two, publicly failed a
pair of 7/Jokers. The true constraint is "at most one high card", so the
conditional-uniform answer is 48/114 = **42.105%**. The sampler produced
**22.577%** (review: 22.426%), because it picks uniformly between the two
branches of the failure disjunction although one is strictly contained in the
other, and because drawing card-by-card from whatever is still allowed is not
uniform over final hands.

*Contradiction.* Three cards, pool of two low cards and sixteen at least Jack,
failed a pair of Jacks: only one hand is consistent. Eight independent coin
flips all landing on the impossible branch happens once in 256, and the code
then dropped every constraint. Measured **374 contradictory worlds per
100,000** against the predicted 391.

**Fixed.** The sampler now tries plain rejection first — deal unconstrained,
check against `canMeet`, accept — which is an exact draw from the posterior when
it succeeds, and costs nothing when there are no recorded failures. If rejection
runs out of attempts it falls back to the constructive draw, now rotating
through the disjunction's branches instead of choosing randomly, so an
impossible branch cannot be picked every time. The last-resort path repairs a
hand by trading its strongest cards back to the pool rather than returning a
world that contradicts what everyone watched.

**Measured, same two experiments:**

| | Before | After | Correct |
|---|---|---|---|
| P(high card in the constrained hand) | 22.577% | **41.976%** | 42.105% |
| Contradictory worlds per 100,000 | 374 | **0** | 0 |

Match-strength effect is inside the end-to-end null result below.

### 6. Failure memory discards information — **not fixed**

**Verified by reading, agreed.** Storing only the target loses two things the
review names: the cards publicly surrendered in the failure bound the hand from
below, and a later play by the same seat tightens the earlier failure. The live
advisor also keeps failures only from the current trick while the self-play
search keeps them for the whole hand — so the app is inferring less than the
benchmark it is validated against.

This is information loss, not leakage, and everything involved is public.

**Why not fixed here.** It requires per-seat public chronology rather than
aggregate counts, which changes the `InfoSet` shape and every producer of it. It
is worth doing, and the +0.18-point null result for inference cannot speak to
it, because that measured a weaker representation. But it should be built
against the corrected sampler, not layered onto the one I have just replaced.

### 7. The heuristic can choose a certain, avoidable instant loss — **fixed, −0.24 points**

**Verified exactly.** Seat 0 holding `[Ace, 7]` at 0 points, opponents at 19 and
18. Tuned score: lead Ace **15.0705**, lead 7 **11.3488** — matching the review
to four decimals. Leading the Ace finishes the hand holding the 7, which loses
the match outright. Leading the 7 finishes on the Ace and wins.

**Fixed** with a terminal exception: when a play would leave exactly one card
and that card is a 7 or Joker, it is penalised beyond anything the rest of the
score can produce. `high` being negative is defensible while there are tricks
left to survive; at the reveal it is simply wrong, and no single global weight
is right in both places. After the change the heuristic leads the 7.

**Measured, and the measurement corrected my first attempt.** I initially also
ranked the leftover card by its points, which looks equally principled. Paired
over 60,000 matches on identical deals:

| Version | Loss rate | Paired difference vs old |
|---|---|---|
| Instant-loss guard **and** leftover-value term | 39.04% | **+2.39 points**, CI +2.23 to +2.55 — much worse |
| Instant-loss guard only | 36.41% | **−0.24 points**, CI −0.28 to −0.20 — better |

At the last decision what you keep and what you spend are complementary, so
scoring both just doubles the value weight at that one node and detunes it. I
kept the provably-correct half and deleted the plausible half. This is the only
change in the set with a measurable effect on play, and it changes the outcome
of 0.24% of matches — winning every one of them.

The review is right that this does not justify changing the global `high`
weight, and I have not.

### 8. An exhausted solver invents endings — **fixed**

**Verified, reproducing the review's numbers exactly.** Hands `[2,3,7]`,
`[4,5,6]`, `[8,9,10]`, seat 0 leading, modelled opponents. With a zero node
budget the values for leading 2, 3, 7 were `[0.86591, 0.88825, 0.88825]`; with
budget they are `[0.85707, 0.88068, 0.90726]`. The exhausted version does not
merely lose precision — it **ties for best a move that is third best**, because
`finalClasses` reads each seat's lowest remaining card as if it were their last
and every dangerous card left in the hand disappears from the valuation. And
`searchActions` never reads the `exact` flag that reports this.

**Fixed.** On budget exhaustion the solver now plays the position out with the
modelled policy and scores a genuine ending. With a zero budget the same
position now returns `[0.85707, 0.88068, 0.90726]` — identical to the exact
solve, and correctly ranked.

The review is careful to say it did not establish that the 200,000-node budget
was ever reached in the from-8 experiment, so this does not explain that
regression. I am not claiming it does.

---

## What I did not do, and why

**Nothing about the calibration display.** The review's point that a monotone
recalibration of the displayed probability cannot improve play is correct, and
its point that improving prediction and improving play are separate goals is
one I had blurred. Left alone pending the continuation work, which is the thing
that would actually move it.

**No IS-MCTS or CFR prototype.** The review argues against starting with
full-game CFR — three-player Cucumber is not two-player zero-sum, so the usual
equilibrium guarantee does not apply — and recommends a small enumerable ending
with grouped information sets as the first honest test. I agree, and I agree it
comes after the beliefs are correct. Planning well over a wrong posterior is
not obviously progress.

**No cross-world variance penalty.** The review warns this is not a
strategy-fusion fix but a change of objective toward risk aversion. Correct,
and since fusion was the wrong diagnosis for the default path anyway, the idea
had a bad premise.

---

## Documentation corrected

- **`heuristic.ts`** — the `gamma` comment had the sign backwards. Urgency is
  `remaining^gamma` with `remaining` in [0,1], so gamma above 1 sits *below*
  the linear curve everywhere and falls fastest at the end: strength stops
  mattering earlier, not later. Verified numerically at every hand size.
- **`STRATEGY.md`** — the conclusion drawn from that reading ("hold your armour
  slightly longer") was therefore backwards, and is corrected.
- **`outcome.ts`** — referenced `pnpm self-play continuation`, which does not
  exist; there is no such case in `tools/self-play.ts`. Reference removed and
  the two structural limits documented in its place.
- **`STRATEGY.md`** — parity, the oracle's meaning, and the "at its ceiling"
  conclusion, as described above.
- **`selfPlay.ts`** — benchmark `maxActions` was 10 while the advisor ships 14,
  so the published loss rates measured a player that was not the one in the
  app. Now 14, matching.

---

## Verdict on the ceiling claim

The review asks whether "the design is at its ceiling" is justified. It is not,
and I withdraw it.

What the evidence supported was narrower and I overstated it: the eight-weight
policy family is converged, and deeper search over the *current* beliefs does
not help. Both remain true. But three null results in a row do not show that no
lever exists — and a search cannot measure past a defect present in both arms
of every comparison it runs, which is what the sampler and continuation errors
were.

What I would not now claim in the other direction either: that fixing them will
make the player stronger. I fixed four of the eight and the aggregate effect was
zero. The two unfixed defects are larger, and the honest position is that their
match-strength value is **unknown** until someone builds them and runs the
paired campaign. "Unknown" is a worse headline than "at the ceiling" and a
better description of what is known.

---

## Reproducing this

All eight verifications were run with temporary scripts under `.verify/`, which
import the existing source and write nothing. They are deleted; the numbers
above are reproducible from the review's own appendix, which I followed for the
positions and constructed independently for the rest.

```bash
pnpm vitest run tests/strategy tests/rules   # 115 tests
pnpm typecheck
```
