# Brief: why is the honest oracle optimistic?

You are being asked to find a bug or a modelling error in a measurement, not
to improve a card-playing algorithm. Everything below is reproducible from
this repository. Treat every claim in it as a claim to audit — the author has
already been wrong twice here, in ways recorded at the bottom.

**The blocking question:** an estimator that should be calibrated by
construction is systematically optimistic by 9.6 points. Why?

---

## 1. What is being measured, and why

The game's advisor states a probability: "84% chance you don't lose this
match". A Brier score says whether those numbers mean anything. But a Brier
score has a floor — no forecaster, however good, can score better than the
uncertainty that genuinely remains after conditioning on everything a player
is allowed to see.

For a forecaster with information set `I`:

```
p*    = P(this seat survives the match | I)
floor = E[ p*(1 − p*) ]
```

The floor is zero only if `I` determines the outcome. Here it does not:
`ADVISOR.md` counts ~365 million distinct true positions behind every position
a player can tell apart.

The point of measuring it: if the advisor's Brier is near the floor, its odds
are about as honest as anything can be and further calibration work is wasted.
If it is far above, there is measurable headroom.

## 2. The game, precisely

Three players, one deck of 54 (52 + 2 jokers). Each is dealt 13; 15 to stock.

**Exchange.** The dealer picks a size N (0–5; always 3 in every run here).
The dealer exchanges exactly N; each other player chooses N or 0. Exchanging
means drawing N from stock and then discarding N **face down**. Your own
discards are known to you and to nobody else.

**Trick play.** The leader plays 1..(handSize−1) cards, all of the same rank —
7s and Jokers count as one rank for this purpose. You may never play your whole
hand; one card is always kept back.

Following: sort your play and the target ascending and compare position by
position; each of your cards need only meet or exceed its counterpart. Values
are never summed. If you cannot meet the target you must **surrender your
lowest card**, which does not become the new target — the target always
reflects the most recent *successful* play.

**Trick strength** (note the last entry):

```
2 < 3 < 4 < 5 < 6 < 8 < 9 < 10 < J < Q < K < A < 7 = Joker
```

**Scoring the final card.** Each hand ends with every player holding exactly
one card. That card is added to a cumulative score:

```
2..6 = face value,  8=8, 9=9, 10=J=Q=K=10, A=15,  7 = JOKER = 21
```

A player left holding a **7 or a Joker loses the match immediately**, whatever
the scores. Otherwise, once anyone reaches 21 the highest cumulative score
loses; an exact tie at the top loses jointly.

So the two strongest cards in a trick are the two that kill you. That tension
is the whole game, and it is why the empirical distribution of final cards is
so skewed toward low ranks.

## 3. What has been built

| file | what it does |
|---|---|
| `packages/strategy/src/oracle-honest.ts` | `honestSurvival(info, trick, random, opts)` — the estimator under suspicion |
| `packages/strategy/src/determinize.ts` | `sampleFullWorld(info, random)` — samples a hidden-card assignment consistent with `info` |
| `packages/strategy/src/sim.ts` | `playOut(sim, policies)` — plays a hand with three policies, each seeing only its own `policyView` |
| `packages/strategy/src/selfPlay.ts` | `playHand(...)` deals and plays one whole hand, exchange included |
| `packages/strategy/src/outcome.ts` | `settleHand(before, finals)` — scores a hand, decides losses |
| `tools/floor.ts` | the measurement and both estimators |
| `tools/sampler-audit.ts` | audits the world sampler for impossible worlds |

`honestSurvival` does this, per sampled world:

1. `sampleFullWorld(info, random)` — a world consistent with what the seat sees
2. `buildSim(info, trick, hands)` — the same mid-hand position the search builds
3. `playOut(...)` with three tuned-heuristic policies — **blind**, each seeing
   only its own hand
4. `settleHand(info.scores, finalClasses(sim))`
5. while the match is not over, `playHand(...)` for subsequent hands
6. record whether this seat was among the losers

It returns the survival frequency and `bias = p(1−p)/K`, the variance its own
sampling adds.

**Correction, 2026-09-15.** An earlier version of this brief said the advisor
plays each imagined world face up and that blind playout was the point of
difference. That is false. `searchActions` rolls out with `heuristicPolicy`,
which receives a per-seat `PolicyView` and cannot see hidden hands; the
perfect-information path is `solveChoices`, gated on `solveFrom > 0`, off by
default. ADVISOR.md's "played as though all hands were visible" misnames the
mechanism, and the error was repeated here without checking the code.

So the oracle and the advisor share their sampler **and** their blind
rollouts. The one genuine difference left is the continuation: the advisor
stops at the hand boundary and applies a fitted value (two grid-searched
numbers), while the oracle plays to the end of the match.

That matters for diagnosis. Both estimators are optimistic — the advisor's
reliability is 0.0199, the oracle's 0.0102 — and they share almost all of
their machinery. A common cause is therefore more likely than two separate
ones, and the shared component that is known to be wrong is the sampler's
prior.

## 4. Reproduce it

```bash
pnpm install
docker compose up -d postgres            # not needed for the floor tools

node --experimental-strip-types tools/floor.ts 400 200
node --experimental-strip-types tools/sampler-audit.ts 150 40
```

## 5. The failure

`tools/floor.ts 400 200` — 400 matches, 7,154 positions, 200 oracle worlds per
position, 124 seconds. **All three seats play the tuned heuristic; the advisor
only observes.** That matters: `p*` must be the probability of the outcome that
actually occurs, so the oracle's assumed continuation and the real continuation
are deliberately the same policy.

```
THE FLOOR
  direct   E[p*(1−p*)]       0.1515     (+0.0008 sampling added back)
  scored   Brier of p*       0.1933     (−0.0008 removed)   ± 0.0194

  oracle's own calibration
    uncertainty              0.2354
  − resolution               0.0441
  + reliability              0.0102     <- must be ~0 if p* is real
      said  9% → happened 10%    n=343
      said 31% → happened 26%    n=387
      said 52% → happened 37%    n=810
      said 70% → happened 60%    n=2702
      said 91% → happened 82%    n=2912

  mean oracle claim 0.717     actually survived 0.621
```

Two independent symptoms of one problem:

- **The oracle is optimistic by 9.6 points.** With 400 independent matches the
  standard error on the survival side is ~2.4 points, so this is about 4σ.
- **The two estimators disagree by 0.0418**, more than twice their band. They
  are biased in opposite directions by the same term, so they should converge.

`p*` is calibrated by construction *if it is really p\**. It is not, so the
estimator is wrong somewhere, and no floor can be reported.

## 6. What this rules out

- **The world sampler returning impossible worlds.** A known defect
  (`ALGORITHM-REVIEW-2.md` §1: `repair` gives up silently and its caller
  returns the hand unchecked, 8.79% contradictions on a constructed position).
  Audited in ordinary play: **0 contradictions in 95,040 worlds across 2,376
  constrained decisions, 95% CI 0.000–0.004%.** Four hundred times too small to
  explain 9.6 points.
- **Policy mismatch between the oracle and reality.** An earlier version let
  the *advisor* play while the oracle imagined *heuristics* finishing the job.
  It produced a floor **above** the advisor's own Brier, which is impossible.
  Fixed: everything is the tuned heuristic now.
- **Plumbing.** Sanity values behave: at scores 0-0-0 the oracle gives 86.7%
  holding `2 3 4`, 56.7% holding `6 8 9`, 46.7% holding `Q K A`; at 18-18-18
  those become 97.2% / 52.6% / 1.1%. Monotone in hand quality, and the brink
  sharpens it. 8 tests in `tests/strategy/honestOracle.test.ts`.

## 7. The leading hypothesis, and why it is only a suspect

**The sampler's posterior ignores the exchange.** Independently confirmed by a
second reviewer (`REVIEW-BRIEF-2-FEEDBACK.md` §1): *"Accepting only consistent
joint deals is correct for the specified uniform prior, though that prior still
ignores exchange selection."* `sampleFullWorld` draws the opponents' hands
uniformly from the unseen pool. But every opponent has already
exchanged: they drew from stock and discarded their **worst** cards, face down.
So the unseen pool is polluted with cards known to be bad, and the opponents'
real hands are systematically better than a uniform draw suggests. Give
opponents weaker hands than they hold and the subject looks safer — which is
the direction of the error.

`ALGORITHM-REVIEW-2.md` independently identifies this as the largest
un-incorporated finding in the codebase: *"the exchange prior and continuation
function were **not incorporated**, despite being the largest prior findings"*,
and reports that a temporary generative exchange prior changed rollout value by
0.829 points on held-out positions.

**Why it is unproven.** The obvious test — rerun with exchange size 0, where a
uniform draw is correct — was run at n=400 and gave a *bias of the opposite
sign*:

```
exchange 3:  oracle 70.1%  actual 65.5%   +4.6 pts
exchange 0:  oracle 62.6%  actual 67.3%   −4.7 pts
```

Both are ~2σ at that sample size. That test was underpowered and should not be
believed in either direction. It needs rerunning with enough matches to resolve
an effect of a few points — the position-level effect is 4σ, so the power is
available, it just was not used.

## 8. What I am missing

Stated plainly, so you do not waste effort confirming what is already known:

1. **A proven cause.** I have one plausible mechanism and one underpowered test
   of it. I do not know whether the exchange prior explains 9.6 points, 2
   points, or none.
2. **Whether the bias is uniform or position-dependent.** The calibration table
   suggests it grows with confidence (91→82 is 9 points, 9→10 is −1), which
   might discriminate between explanations. I have not analysed it by hand
   size, by score, or by how many failures are recorded.
3. **Whether `E[p*]` should equal the base rate at the root.** At the first
   decision of a match the oracle averages 70.1% while the long-run base rate
   is 63.56% (200,000 matches, `pnpm self-play sanity`). If the estimator were
   unbiased these should agree. I believe that argument is sound but have not
   checked it against the position-weighting carefully.
4. **Other candidate mechanisms entirely.** I have not seriously considered:
   whether conditioning on `info.mine` (the seat's own discards) is handled
   correctly; whether the `failures` history is applied to the right seats;
   whether `buildSim` reconstructs a mid-trick position faithfully enough that
   the continuation is the same distribution as real play; or whether playing
   subsequent hands with a fresh `playHand` introduces a subtle difference from
   how the real match deals them.

## 9. What an answer looks like

Any of these would be worth more than a proposed fix:

- A demonstration that one specific mechanism accounts for most of the 9.6
  points, with a measurement that has the power to say so.
- A defect in `honestSurvival`, `sampleFullWorld`, or `buildSim` — a line, and
  an experiment that proves it.
- A proof that the comparison in §5 is invalid for a reason I have not seen, so
  that the "bias" is an artefact of the measurement rather than the estimator.
- A statement that the estimator cannot be unbiased in this game for a
  structural reason, with the argument.

Prefer "here is the line, and the experiment that proves it" over "you might
consider". If you think the whole framing is wrong, say so first and explain.

## 10. Traps — mistakes already made here

Recorded so you do not repeat them, and as a warning about the author's
reliability:

1. **Underpowered tests read as results.** The exchange-0 test above. Also an
   earlier episode where three "independent signals" of a live-vs-simulation
   discrepancy turned out to be one comparison error counted three times.
2. **Comparing configurations that are not comparable.** The live table runs
   three *searching* players; the published benchmark measures three
   *heuristics*. Their final-card distributions differ by 4× and it means
   nothing. Always state who is at the table.
3. **A sanity check that was itself rigged.** A probe showing 86.7% survival
   at level scores looked like a bug (three symmetric players should sit near
   65%). It was not: the probe handed the seat the three lowest cards in the
   deck. The oracle was right and the test was wrong — and the unit test
   covering it passed for the same wrong reason.
4. **Bands over the wrong unit.** Every claim inside one match shares that
   match's single outcome. An interval over positions is several times too
   narrow. All bands here are taken over matches.
