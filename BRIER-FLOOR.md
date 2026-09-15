# How good could the advisor's odds possibly be?

The advisor states a chance of surviving the match. The panel scores those
claims with a Brier score. The question this plan answers is what the *best
achievable* Brier is for this game — the number below which no forecaster can
go, however clever, because the outcome genuinely is not determined by what a
player is allowed to see.

## The floor, stated precisely

The optimal forecast at a decision point is `p* = P(survive | everything
legally visible)`, and the best possible Brier is

```
floor = E[ p*(1 − p*) ]
```

the average variance left in the outcome after conditioning on all knowable
information. It is zero only when what you can see determines what happens.
Here it does not: ADVISOR.md counts ~365 million distinct true positions behind
every position a player can tell apart.

## What is already known

From the 4,000-prediction sample of 2026-09-14, survival base rate 61%, via
Murphy's decomposition `Brier = Uncertainty − Resolution + Reliability`:

| quantity | value | meaning |
|---|---|---|
| Uncertainty | 0.238 | knowing only the base rate — no skill |
| − Resolution | 0.064 | how much the advisor's ordering separates outcomes |
| + Reliability | 0.021 | what its overconfidence costs |
| = measured | 0.195 | what the panel showed |

So a perfectly calibrated version of *today's* advisor scores ≈0.174, and the
floor is somewhere in [0, 0.174]. Narrowing that is the job.

A caution carried over from the first attempt: fitting a calibration map on
450 correlated matches made the out-of-sample Brier *worse* (0.1902 → 0.1909
for even a one-parameter fit). The 0.021 is real but not learnable from a
sample that small. Everything below is built to produce samples large enough
that this stops being the binding constraint — 1,200 matches take 36 seconds
in the offline harness against an evening in the browser.

## The plan, in hours

Each chunk is sized to about an hour and ends in something checkable. A chunk
is done when its test passes, not when its code exists.

- [x] **H1 — A probability the harness can see.**
      The search policy already computes its estimate of survival; nothing
      outside the policy can observe it. Add an optional observer, invoked
      once per decision, that reports the estimate without changing which move
      is chosen.
      *Done when:* a test asserts the observer fires once per subject decision
      with a value in [0,1], and `self-play search` at a fixed seed returns a
      loss rate identical to before the change.

- [x] **H2 — Record claims through the worker.**
      Carry the estimates out of the worker: settle each match's claims against
      whether the subject survived, and return per-match records.
      *Done when:* `pnpm self-play brier --matches 200` prints a Brier over
      real matches.

- [x] **H3 — Report with bands and the decomposition.**
      Print Brier ± 95% (over matches, never over predictions), plus
      uncertainty / resolution / reliability and the bucket table.
      *Done when:* a test pins the identity `U − R + Rel = Brier` to 1e-12,
      and the printed Brier agrees with the browser panel's definition.

- [ ] **H4 — The honest oracle.**
      `honestSurvival(view, worlds, random)`: sample hidden-card assignments
      consistent with what the seat can see, play each out with policies that
      see only their own hands, return the survival frequency. This is the
      estimator of `p*`, and the one place this work departs from what the
      advisor does today — it imagines worlds but plays them *face-up*, which
      is exactly why it is overconfident.
      *Done when:* unit tests show ≈1 from a won position, ≈0 from a lost one,
      and something between for a position that is genuinely uncertain.

- [ ] **H4a — Measure the floor's dependence on the opposition.** *(added after
      H3, which showed it matters more than expected.)*
      Run `brier` against the heuristic, against the archetypes, and against a
      copy of the advisor itself. The floor is not one number for "this game";
      it is a number per opponent field, and quoting it without saying who was
      across the table would be meaningless.
      *Done when:* a table of Brier and reliability per opponent exists.

- [ ] **H5 — Measure the floor.**
      `pnpm self-play floor --matches N --worlds K`. Sample decision points
      with the same distribution the panel sees, score `p̂*`, and subtract the
      finite-sample bias `E[p*(1−p*)]/K` that K playouts add.
      *Done when:* it prints floor ± band, and the bias correction has a test.

- [ ] **H6 — Validate the oracle before believing it.**
      `p*` is calibrated by construction, so its own bucket table must sit on
      the diagonal. If it does not, the estimator is wrong and every number
      after it is fiction.
      *Done when:* reliability < 0.005 over ≥300 matches. If it fails, stop
      and fix rather than reporting a floor.

- [ ] **H7 — Write down the answer.**
      Run at scale and record advisor Brier, floor, and base rate with bands in
      ADVISOR.md, plus the fraction of available skill the advisor captures.
      *Done when:* the table is in ADVISOR.md with its sample sizes.

- [ ] **H8 — Close the gap, only if there is one.**
      Conditional on H7. If the floor is materially below the advisor's Brier,
      test the honest estimate as the *displayed* probability, offline, and
      measure the change out-of-sample.
      *Done when:* a before/after is measured. Ship only if it wins on data it
      was not fitted to.

## Log

Newest last. Each entry records what was measured, not what was written. No
entry goes here before the thing it describes has actually been run.

- **H1 — done.** `SearchOptions.onEstimate` observes `result.best` — the same
  number the app shows — once per searched decision, and `searchPlayer` takes
  it as an optional last argument. Three tests in
  `tests/strategy/estimates.test.ts`: the values are probabilities and are not
  constant; and, the one that matters, a run with the observer attached returns
  a byte-identical loss rate and hand count to one without. End-to-end check:
  `self-play search --worlds 256 --matches 1200` still reports **23.58% ±
  2.45%**, the same as the run taken before the change.

- **H2 — done.** `claimTrial` in the strategy package plays matches while
  recording the subject's claims, settling each match's against that match's
  own outcome; `gatherClaims` splits it across the worker pool. First reading:
  `self-play brier --matches 200` → **Brier 0.1477**, 200 matches in 7.0s,
  3,583 claims. The browser needed an evening for 459 matches.

- **H3 — done.** `packages/strategy/src/brier.ts` holds the canonical scoring:
  `brierOf`, `wilson`, `brierBand` (over matches), and Murphy's `decompose`,
  which reports its own binning `residual` rather than pretending the identity
  is exact on continuous claims. 11 tests in `tests/strategy/brier.test.ts`
  pin the identity to 1e-12 on discrete claims and check that overconfidence
  is charged to reliability and not to resolution.

  **600 matches against two heuristics:**

  | | |
  |---|---|
  | Brier | **0.1318 ± 0.0162** |
  | uncertainty | 0.1672 |
  | − resolution | 0.0323 |
  | + reliability | **0.0008** |
  | survived | 77.17% (advisor said 80.32%) |

  The surprise is reliability of 0.0008 — against these opponents the advisor
  is *almost perfectly calibrated*, and its bands sit on the diagonal (said
  73% → 72% happened; said 91% → 90%). That is nothing like the browser
  panel's 15-point overconfidence, and the difference has to be the opposition:
  the browser's Bob and Charlie are not plain heuristics. So the overconfidence
  documented in ADVISOR.md is a fact about *who it is playing*, not a fixed
  property of the estimator. H4a added above to measure that directly, and the
  floor will have to be quoted per opponent field.
