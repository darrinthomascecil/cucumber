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

- [x] **H3a — Bound the sampler before anything depends on it.** *(added after
      reading ALGORITHM-REVIEW-2.md, which I should have read before planning
      H4 at all.)*
      That review reports the world sampler still returning impossible worlds:
      **2,637 of 30,000 draws, 8.79%, contradict a recorded failure** on a
      reachable position. H4's oracle samples worlds with that same sampler, so
      a floor measured on top of it is biased by worlds that cannot exist — and
      H6 would only catch it after H4 and H5 were already built.
      *Done when:* the reviewer's reproduction is re-run and the rate measured
      here, and either fixed or quantified as a known bias with a bound. H4
      does not start until this is answered.

- [x] **H4 — The honest oracle.**
      `honestSurvival(view, worlds, random)`: sample hidden-card assignments
      consistent with what the seat can see, play each out with policies that
      see only their own hands, return the survival frequency. This is the
      estimator of `p*`, and the one place this work departs from what the
      advisor does today — it imagines worlds but plays them *face-up*, which
      is exactly why it is overconfident.
      *Done when:* unit tests show ≈1 from a won position, ≈0 from a lost one,
      and something between for a position that is genuinely uncertain.

- [x] **H4a — Measure the floor's dependence on the opposition.** *(added after
      H3, which showed it matters more than expected.)*
      Run `brier` against the heuristic, against the archetypes, and against a
      copy of the advisor itself. The floor is not one number for "this game";
      it is a number per opponent field, and quoting it without saying who was
      across the table would be meaningless.
      *Done when:* a table of Brier and reliability per opponent exists.

- [x] **H5 — Measure the floor.**
      `pnpm self-play floor --matches N --worlds K`. Sample decision points
      with the same distribution the panel sees, score `p̂*`, and subtract the
      finite-sample bias `E[p*(1−p*)]/K` that K playouts add.
      *Done when:* it prints floor ± band, and the bias correction has a test.

- [x] **H6a — CONFIRMED: the exchange prior is the cause.** *(the next thing
      to do, in this order — the first step needs no new code and could settle
      it outright.)*

      **Step 1, the control. Cheap, decisive, ~10 minutes.** With no exchange,
      the sampler's uniform draw over unseen cards is *correct* — there is no
      selection to model. So if the exchange prior is the cause, the oracle
      must be calibrated in no-exchange games and miscalibrated with exchange 3.
      `tools/floor.ts` hardcodes `exchangeSize: () => 3`; give it a flag and
      run both arms at **n ≥ 1500 matches**, not 400. The earlier attempt at
      this used n=400, where the standard error is 2.4 points against an effect
      of ~4.6, and it read noise — that failure is the reason for the sample
      size, not caution for its own sake.
      *Settles it if:* reliability drops to ~0 at exchange 0 and stays at
      ~0.010 at exchange 3. *Refutes it if:* both arms are equally biased, in
      which case the cause is elsewhere and step 2 is wasted work.

      **Step 2, only if step 1 confirms.** Build an exchange-aware prior into
      `sampleFullWorld`. The method is in `REVIEW-BRIEF-2-FEEDBACK.md`: sample
      hypothetical opponent *pre-discard* hands and apply the fixed discard
      policy, using no actual hidden cards. That review measured such a prior
      moving terminal survival on a held-out position from **62.264% to
      68.392%, +6.128 points, 95% CI 5.716–6.540** — the right magnitude to
      explain the oracle's 9.6-point optimism.

      **Step 3.** Rerun `tools/floor.ts 400 200` and check H6's gate:
      reliability < 0.005, and `direct` and `scored` agreeing inside their
      bands. If both pass, H6 unblocks and H7 finally has a number.

      **Independent corroboration already in hand**, from two directions
      neither of which was looking for it: `REVIEW-BRIEF-2-FEEDBACK.md` §1
      ("that prior still ignores exchange selection"), and the exact endgame
      work on `origin/main`, whose scope conditions require "nobody exchanged
      cards this hand" for its uniform prior to be valid.

- [x] **H6 — Validate the oracle before believing it.**
      `p*` is calibrated by construction, so its own bucket table must sit on
      the diagonal. If it does not, the estimator is wrong and every number
      after it is fiction.
      *Done when:* reliability < 0.005 over ≥300 matches. If it fails, stop
      and fix rather than reporting a floor.

- [x] **H7 — Write down the answer.**
      Run at scale and record advisor Brier, floor, and base rate with bands in
      ADVISOR.md, plus the fraction of available skill the advisor captures.
      *Done when:* the table is in ADVISOR.md with its sample sizes.

- [x] **H8 — Done: a conditional win, off by default is not the answer either.**
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

- **H4a — mostly answered, by accident.** Chasing an apparent live-vs-sim
  discrepancy showed there was none: `tools/finals-advisor.ts` reproduces the
  live table once the *configuration* matches it. Three searching players
  against each other end on a 7 or Joker **2.13%** of the time (live: 2.45%),
  mean final card **6.10** (live: 6.25), same three commonest ranks in the same
  order. The heuristic benchmark's 0.6% was never a comparable number.

  The finding that matters: the advisor ends on a lethal card **0.44% against
  heuristics and 2.13% against other advisors**. Against the same field as the
  heuristic it is slightly *better* (0.44% vs 0.49%), so this is not bad
  shedding — it is that a mirror field will not take the tricks that let you
  unload. Safety here depends on opponents being exploitable.

  This is also why reliability measured 0.0008 offline against ~15 points of
  overconfidence in the browser: the offline run played heuristics. H4a's Brier
  sweep still needs doing — the `brier` command can only build heuristic
  opponents — but the prior is now strong, and the floor must be quoted per
  opponent field. 300 matches per row; wants ~2,000 before it goes in
  ADVISOR.md.

- **H3a — done: the defect is real but does not reach us.** `tools/sampler-audit.ts`
  wraps the search policy, builds the same full-history `InfoSet` the benchmark
  path uses, samples worlds at every decision that carries a recorded failure,
  and checks each against `consistentWith` — the very check the sampler's last
  fallback omits. It changes no play: the decision is handed straight to the
  real policy.

  Over 150 matches: **4,322 decisions, 2,376 of them constrained (55%),
  95,040 worlds sampled, 0 that cannot exist — 95% CI 0.000–0.004%.**

  So the bias H4 would inherit is bounded above by 0.004%, against a Brier band
  of ±0.016. Negligible. H4 may proceed.

  **What this is not:** I did not reproduce the review's 8.79%. Its reproduction
  script is not in the repo, and that figure came from a constructed position
  with a duplicated failure target, not from ordinary play — the review says so
  itself ("its repair path was not entered in the ordinary population I
  sampled"). The defect stands unfixed: `repair` still gives up silently and
  its caller still returns the hand unchecked. What is now measured is that the
  path is not reached by the population these measurements draw from. A
  position with tight enough constraints would still produce impossible worlds,
  and the one-line fix — re-check after repair, and reject — remains worth
  doing on its own merits.

- **H4 — done.** `packages/strategy/src/oracle-honest.ts`. For each sampled
  world it builds the same mid-hand position the search builds (`buildSim`,
  now exported), then departs from the search in the two ways that matter:

  1. **It plays the world blind.** `playOut` drives three policies, each seeing
     only its own `policyView`. The advisor plays its imagined worlds face up,
     which is precisely why its odds are optimistic.
  2. **It plays to the end of the match, not the end of the hand.** No
     continuation model — that is two grid-searched numbers, by ADVISOR.md's
     own account the least-measured component in the advisor, and a floor
     resting on it would be measuring the guess.

  It also reports `bias = p(1−p)/worlds`, the variance its own sampling adds,
  which H5 subtracts.

  8 tests. Real values at 2,000 worlds:

  | hand | scores 0-0-0 | scores 18-18-18 |
  |---|---|---|
  | 2 3 4 | 86.7% | 97.2% |
  | 6 8 9 | 56.7% | 52.6% |
  | Q K A | 46.7% | 1.1% |

  Monotone in hand quality, and the brink amplifies it — at 18 all, the hand
  decides almost everything.

  **A caught mistake worth recording.** The first sanity check read 86.7% from
  a level position and I took it for a bug, since three symmetric players
  should sit near 65%. It was not: the position handed seat 0 the three lowest
  cards in the deck, so it could not help but end cheap. The oracle was right
  and my probe was rigged — and the original test ("lands between 0.4 and
  0.95") passed for that same wrong reason. It has been replaced by the
  property the oracle exists to capture: at identical scores, a better hand
  must survive more often.

- **H5 — the harness is built; it works; it refuses to answer.** `tools/floor.ts`
  computes the floor two ways that fail in opposite directions — `direct`
  (mean of p̂(1−p̂), biased low by the oracle's sampling, so v is added back) and
  `scored` (Brier of p̂ against outcomes, biased high by the same v, so v is
  subtracted). They approach the truth from either side, and disagreement
  beyond their bands means no floor should be reported.

  Getting the configuration right took two attempts. The first let the
  *advisor* play while the oracle imagined *heuristics* finishing the job, so
  p̂ was the probability of a game nobody was playing — it said 0.812 where
  0.890 survived, and produced a floor **above** the advisor's own Brier.
  Impossible, and the tell. The subject now plays the heuristic and the advisor
  only watches, so the oracle's assumption and the actual continuation match.

- **H6 — FAILED, and the floor is therefore not reported.** 400 matches, 7,154
  positions, 200 oracle worlds each, 124s:

  | | |
  |---|---|
  | oracle mean claim | 0.717 |
  | actually survived | 0.621 |
  | gap | **0.096, about 4σ** |
  | reliability | **0.0102** (gate: < 0.005) |
  | direct vs scored | 0.1515 vs 0.1933 ± 0.0194 — disagree by 2× the band |

  Bins: said 91% → 82% happened, 70% → 60%, 52% → 37%. Monotone, always
  optimistic. p* is calibrated by construction *if it is really p\**, so this
  says it is not.

  **Leading suspect: the world sampler's posterior.** Opponents' hands are
  drawn uniformly from unseen cards, but opponents discarded their *worst*
  cards during the exchange — so the leftover pile is systematically weak and
  their real hands systematically strong. Sampling uniformly hands them worse
  cards than they hold, which makes the subject look safer. ALGORITHM-REVIEW-2
  independently names this the largest un-incorporated finding: "the exchange
  prior and continuation function were **not incorporated**, despite being the
  largest prior findings".

  **What I have not established:** that this is the cause. A first attempt to
  test it by disabling the exchange was underpowered — n=400 gave ±2.4 points
  against an effect of 4.6, and the sign flipped when rerun without the
  exchange. That was reading noise. The effect at position level is now
  measured at 4σ, so the test can be repeated with enough power to mean
  something. Until then the honest statement is: the oracle is optimistic, the
  reason is unproven, and no floor exists yet.

- **H6a — confirmed, 6.5σ against 0.8σ.** `tools/exchange-control.ts`, 1,500
  matches per arm, 150 oracle worlds, the prediction written down before the
  run:

  | | exchange 3 | exchange 0 |
  |---|---|---|
  | oracle claimed | 0.7133 | 0.6445 |
  | actually survived | 0.6317 | 0.6344 |
  | gap | **+0.0816, 6.5σ** | **+0.0101, 0.8σ** |
  | reliability | 0.0071 | **0.0005** — passes H6's gate |

  With no exchange the oracle is calibrated and its bins sit on the diagonal
  (52→53, 69→67, 91→88). With the exchange on, the identical code goes 6.5σ
  optimistic and every bin bends one way (52→40, 70→61, 91→84).

  So the defect is `sampleFullWorld`'s prior: uniform over the unseen pool,
  which is correct only when nobody exchanged. Players discard their *worst*
  cards face down, so the leftover pool is systematically weak and the sampled
  opponents are handed worse hands than they hold — which flatters the subject.

  Yesterday's attempt at this same control was not the wrong experiment, only
  too small: n=400 gave −4.7 points in the exchange-0 arm and it was read as a
  refutation. At n=1500 that arm is +1.0 points, 0.8σ. The design was right and
  the sample was a third of what the effect needed.

  Next: the generative prior — sample hypothetical opponent *pre-discard* hands
  and apply the fixed discard policy, using no hidden cards
  (`REVIEW-BRIEF-2-FEEDBACK.md`). Then rerun `tools/floor.ts` against H6's gate.

- **H6 — PASSED, and there is a floor.** The generative exchange prior went
  into `sampleFullWorld` as an optional `WorldPrior`: draw a hypothetical
  pre-discard hand and let the seat's own discard policy choose what it would
  have thrown. No hidden card is touched, and nothing is invented — the model
  is the opponents' actual discard policy. Wired into `honestSurvival` only,
  deliberately: the advisor uses the same sampler, and changing it changes how
  it plays.

  The control arm, rerun with the prior: gap +0.0816 at 6.5σ becomes **+0.0262
  at 1.1σ**, reliability 0.0071 becomes **0.0015**.

  `tools/floor.ts 400 200`, 7,154 positions:

  | | |
  |---|---|
  | oracle reliability | **0.0016** (gate < 0.005) ✓ |
  | direct `E[p*(1−p*)]` | **0.1667** |
  | scored `Brier − v` | **0.1784 ± 0.0152** |
  | the two disagree by | 0.0117, inside the band ✓ |

  Both gates clear. Yesterday the estimators differed by 0.0418 against
  ±0.0194; they now agree, which is the check that makes the number worth
  quoting at all.

  **The floor is ≈0.167** for this configuration.

  | | |
  |---|---|
  | advisor Brier | 0.2074 ± 0.0217 |
  | floor | 0.1667 |
  | **headroom** | **0.0407** |

  And the decomposition says what the headroom *is*. The advisor's reliability
  is 0.0199 against the oracle's 0.0016, so about half the gap is
  miscalibration rather than missing skill: its resolution, 0.0411 against
  0.0535, already orders positions nearly as well as the best possible
  forecaster. It says the wrong numbers about positions it ranks correctly.

  Which points at the obvious next move: the advisor samples worlds with the
  same function and is optimistic in the same direction. Giving it the prior is
  H8, and it changes play, so it needs re-benchmarking against 23.58% ± 2.45%
  and another ADVISOR_VERSION bump.

  **Scope.** Three tuned heuristics, exchange 3. Your live game is three
  advisors, where the uncertainty term differs; this number does not transfer.
  That is H4a.

- **H7 — done.** ADVISOR.md now carries "How honest are its odds?": the floor
  0.1667, the advisor 0.2074 ± 0.0217, headroom 0.0407, and the decomposition
  showing resolution 0.0411 against a ceiling of 0.0535 while reliability is
  0.0199 against 0.0016 — about half the gap is honesty rather than skill.

  It also corrects that file. "It plays with its cards face up" was wrong about
  the mechanism and was the origin of the error that spread into three other
  files. And it writes in the three cautions rather than leaving them to
  memory: the number is for one opponent field, bands are over matches, and
  the control that proved the cause reached the opposite conclusion at n=400.

- **H4a — done. The floor does not transfer; the headroom might.**
  `tools/floor-fields.ts`, all rows exchange 3 with the oracle simulating the
  line that actually played. Bands 95% over matches.

  | field | floor (direct) | oracle reliability | advisor Brier | headroom |
  |---|---|---|---|---|
  | 2× `cheapest` | 0.0000 ± 0.0000 | 0.0000 ✓ | 0.0348 ± 0.0021 | 0.0348 |
  | 2× `wide` | 0.0212 ± 0.0017 | 0.0000 ✓ | 0.0490 ± 0.0104 | 0.0279 |
  | 2× `dumper` | 0.0448 ± 0.0039 | 0.0003 ✓ | 0.0657 ± 0.0136 | 0.0210 |
  | three tuned | 0.1667 ± 0.0045 | 0.0016 ✓ | 0.2074 ± 0.0217 | 0.0407 |
  | **mirror** (3 advisors) | **no floor** | 0.0043 — refused | 0.1945 ± 0.0261 | — |

  Row 1 reproduces `tools/floor.ts` exactly, same 7,154 positions: the harness
  is the same measurement.

  **The floor moves 0.0000 → 0.1667**, every adjacent pair separating by
  10–40σ. It cannot be quoted without naming the opponents.

  **The headroom barely moves** — 0.0210 to 0.0407, and no pair separates at
  95%. That does not establish it is constant; it establishes that its movement
  is below what this n can resolve while the floor beneath it swings 17 points.

  **No floor for the mirror field, and the refusal is the good part.** Its
  reliability of 0.0043 sits *inside* the 0.005 gate, so the agent built a null
  distribution: ten independent runs of the known-good tuned oracle at the
  mirror's configuration fail the gate two times in ten. The second estimator
  settled it — `|direct − scored|` is 0.0361 against a worst null of 0.0116,
  and 1.7× its own band. The two estimators disagree, so no floor was reported.
  Its first mirror run was discarded as uninformative rather than published.

  Worlds are not the cause: dropping 200 → 40 moves tuned reliability
  0.0016 → 0.0015. Untested hypothesis: the sampler models the exchange and the
  public failures but nothing about what a seat's *choices* imply about its
  hand, and a searching opponent's choices carry far more of that. Predicts the
  gap tracks opponent search strength.

  **The finding that shapes H8: the advisor's error changes sign with the
  field.** Hard fields, says 90% → 81% happens. Easy fields, says 89% → 100%,
  92% → 98%. A calibration map fitted on one field would damage the others —
  which is an argument against a fitted correction and *for* fixing beliefs.
  Against `cheapest` the floor is exactly zero, so 100% of the advisor's 0.0348
  is miscalibration: it states 75–89% about a certainty.

  Cost, measured: one mirror oracle world 0.44 s against 0.058 ms heuristic —
  7,600×. 360 mirror matches at 40 worlds is 18.2 CPU-hours. Shard on a fixed
  count, never a wall clock: stopping on time over-samples fast shards, which
  are short matches, which is a biased set of outcomes.

- **H8 — the prior helps enormously when its model is right, and hurts when it
  is wrong.** Wired into the search path (`SearchOptions.exchanged` +
  `discards`, threaded to both `sampleWorld` sites including the screen, so the
  screen prunes on the same beliefs the survivors are judged on). Behind
  `NO_EXCHANGE_PRIOR=1` so both arms can be measured at identical seeds.

  **Play strength, paired, 4,000 matches, seed 8080:**

  | | loses |
  |---|---|
  | prior OFF | 22.15% ± 1.31% |
  | prior ON | **17.08% ± 1.19%** |

  5.07 points, ~5.7σ, a 23% relative reduction. The OFF arm reproduces
  ADVISOR.md's documented 22.22% ± 1.07%, which validates the harness. After
  five consecutive negative results in this codebase, that is a real gain.

  **But it is conditional on the opponent model being right.** The benchmark's
  opponents are tuned heuristics and the prior models exactly their discard
  policy. Against an archetype it does not model:

  | opponent | model | OFF | ON |
  |---|---|---|---|
  | tuned heuristic | exact | 22.15% | **17.08%** |
  | `dumper` | wrong | **3.53% ± 0.95** | 5.93% ± 1.22 |

  Loss rate rises 68% relative, intervals not overlapping. A confident wrong
  belief about the unseen cards is worse than no belief.

  **Calibration splits the same way**, which H4a predicted from the
  sign-change finding:

  | field | Brier OFF → ON | reliability OFF → ON |
  |---|---|---|
  | tuned | 0.2074 → **0.1885** | 0.0199 → **0.0076** |
  | dumper | 0.0657 → 0.0979 | 0.0213 → 0.0533 |
  | wide | 0.0490 → 0.0679 | 0.0237 → 0.0421 |

  Headroom against tuned nearly halves, 0.0407 → 0.0218. Against the weak
  archetypes the advisor was already *under*confident — saying 83% where 95%
  happened — and the prior pushes it further down, away from the truth.

  **A measurement bug caught on the way.** The first calibration run came back
  byte-identical to the pre-change table. Not a null result: `floor-fields.ts`
  and `floor.ts` call `searchActions` directly, so they never saw a change made
  in `searchPlayer`. Both now pass the prior. Had the numbers differed slightly
  instead of exactly, this would have shipped as "calibration unchanged".

  **Not shipped on by default.** The gain requires knowing the opponents'
  discard policy, which is true in self-play and false against a human — the
  case the app exists for. Shipping it on would optimise the benchmark at the
  expense of the actual users. What it argues for is an *adaptive* prior that
  learns the opponents' discard behaviour rather than assuming it, which is new
  work and not this chunk.
