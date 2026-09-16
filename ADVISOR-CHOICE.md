# Which advisor should ship?

The repository now carries two forecasters that answer the same question and
have never been compared.

- **`packages/strategy`** — determinized Monte Carlo. Samples worlds consistent
  with what the seat can see, plays each out blind with a heuristic policy,
  averages. Measured: Brier **0.2074 ± 0.0217** against a floor of **0.1667**
  in the three-tuned-heuristic field, reliability 0.0199, resolution 0.0411.
- **`packages/game-engine/src/advisor`** — a belief/particle model with an
  opponent-policy prior and an exact closing forecast. Merged from a branch
  based before `packages/strategy` existed. **Never measured on this axis.**

Its own tests check exactness, determinism and view-only access. None of them
ask whether its forecasts are *better*. Carrying 1,673 lines on faith is the
thing this plan ends.

**The deliverable is a decision, not a number:** ship one, keep both, or
establish that the question cannot be answered with the evidence available.
"Cannot be answered" is a real outcome and must be reportable.

## What is already known

- The floor is per-opponent-field and moves 0.0000 → 0.1667 across four fields,
  every adjacent pair separating by 10–40σ (`BRIER-FLOOR.md`, H4a). **A
  comparison in one field says nothing about another.**
- The headroom above the floor is far more stable — 0.0210 to 0.0407, no pair
  separating at 95% — so headroom is the more portable quantity to compare.
- The strategy advisor's error **changes sign with the field**: overconfident
  against strong opponents, underconfident against weak ones.
- `tools/floor-fields.ts` already measures a watching forecaster against an
  enumerated-and-gated floor, per field, with bands over matches.
- The belief advisor refuses positions lacking `historyComplete` or
  `exchangeCounts`, and refuses phases outside TRICK_PLAY/EXCHANGE.

## Scrutiny, before building anything

Three findings changed the design. Recorded because the first would have
produced a result that looked fine and meant nothing.

**1. The harness in this plan's first draft could not run the belief advisor
at all.** `forecastLoss` and `advise` take a **`PlayerView`** — the engine's
view. `tools/floor-fields.ts` runs in the *sim*, which produces `PolicyView`
and never builds an engine view. The two representations do not meet.

The fix inverts the plan: `tools/advisor-benchmark.ts`, which arrived with the
belief advisor, already plays matches through the real engine (`createMatch`,
`applyCommand`, `viewFor`) and scores forecasts with Brier. And our
`packages/strategy` `advise()` also takes a `PlayerView`. So **both
forecasters fit their harness**; neither fits ours. Extend theirs.

**2. Every field is somebody's home ground, and their harness is theirs.**
The benchmark's opponents are drawn from `POLICY_NAMES` — the same policy set
the belief model puts a prior over. Its model of the opposition is therefore
*correct by construction* there, exactly as ours is correct in the
tuned-heuristic field where we measured 0.2074. Neither field is neutral.

This makes the comparison deliberately **asymmetric, and that is the design**:

- If **our** advisor wins in **their** field, the result is decisive — it won
  away from home, against an opponent model its rival has right and it has
  wrong.
- If **theirs** wins there, it is confounded and proves little; a neutral
  field would then be required before any migration.

Stating this before running it is what stops the outcome being rationalised
afterwards.

**3. No floor is available in their harness.** The floor machinery is
sim-based. So this compares the two forecasters *to each other*, not to the
ceiling. That is enough for the decision and must not be dressed up as more.

Their `ForecastObservation` carries a `match` field, so bands over matches —
the only honest unit — are computable.

## The plan

- [x] **C1 — Score both forecasters in one harness, on identical positions.**
      Add `packages/strategy`'s `advise()` to `tools/advisor-benchmark.ts` as a
      second model. Both see the same `PlayerView` at the same decision; both
      emit P(this seat loses the match) for the observer.
      *Done when:* one run emits paired observations for both models over the
      same matches, and a test pins the strategy adapter's output against
      `exactFinalSurvival` where both apply.

- [x] **C2 — Measure coverage before quality.**
      The belief model refuses positions lacking `historyComplete` or
      `exchangeCounts`, and refuses phases outside TRICK_PLAY/EXCHANGE. If it
      declines the *hard* positions, comparing on the intersection flatters it.
      *Done when:* the share each forecaster answers is reported, the declined
      positions are characterised by hand size and score pressure, and the
      comparison is restricted to positions **both** answered.

- [x] **C3 — Equalise on time, not on parameters.**
      160 worlds against 128 simulations compares two arbitrary constants.
      *Done when:* per-decision wall-clock is measured for both, the comparison
      runs at a matched time budget, and the parameters that produced it are
      recorded.

- [x] **C4 — Compare, with bands over matches.**
      *Done when:* Brier, reliability and resolution are reported for both over
      enough matches to resolve the difference that would change the decision
      (see Open questions), with 95% bands taken over matches, not
      observations.

- [x] **C5 — Decide, and write down what would overturn it.**
      *Done when:* `ADVISOR.md` carries the comparison, the decision, the
      asymmetry above, and the evidence that would reverse it.

- [x] **C6 — Retire what lost.** *(conditional on C5 — may be nothing to do)*
      *Done when:* either the loser goes with its tests, or `ADVISOR.md` says
      why both are kept.

## Open questions

- **What difference would change the decision?** The strategy advisor's
  headroom is 0.0407. A rival beating it by 0.005 is not worth a migration; by
  0.02 probably is. At ±0.02 bands over 400 matches, resolving 0.01 needs
  roughly 1,600 matches per field per forecaster. That cost must be paid or the
  comparison cannot conclude — and saying so is better than a thin result.
- **Pre-commit to one primary field.** Their harness's population is the
  primary; anything else is secondary and reported as such. Running several and
  quoting the one that separated is how a null becomes a finding.
- **Can the strategy advisor even run at their budgets?** It samples worlds
  per decision through a different code path; if it is an order of magnitude
  slower on engine views than on sim views, C3's matched budget may leave it at
  a world count too small to be itself. Measure before concluding.

## Log

Newest last. Each entry records what was measured, not what was written.

- **C1 — adapter built; the wiring into the benchmark remains.**
  `tools/strategy-model.ts` puts the strategy advisor behind the benchmark's
  interface: `1 − winProbability`, one subtraction, no reweighting and no
  calibration, because a comparison is only worth running if neither side is
  helped on the way through. A declined position returns null rather than
  0.5 — scoring "no opinion" as a coin flip would quietly credit whichever
  model declines more often. 3 tests: the conversion, determinism under a
  fixed seed, and the refusal.

  **It was first written into `packages/game-engine/src/advisor/` and that was
  wrong.** `@cucumber/strategy` already depends on `@cucumber/game-engine`, so
  the adapter there makes a package cycle — one that resolves inside this
  workspace and breaks the moment either package is built alone. It lives in
  `tools/`, which may depend on both.

- **C2 — no selection effect.** 916 observer decisions across all phases: the
  belief model answers 92.1%, the strategy advisor 84.5%, and **zero** positions
  are answered by the strategy advisor but refused by the belief model. Every
  refusal is "no hidden-hand forecast in this phase" (lobby, final reveal), and
  both decline those. The intersection is unbiased, so C4 could proceed on it.
  A first version asked only inside trick play and reported a tidy 100%/100% —
  a scope limit dressed as a result.

- **C3 — a matched budget means pushing the cheap side up.** Per decision:
  strategy 1.9 / 3.3 / 6.3 / 12.3 ms at 40 / 80 / 160 / 320 worlds; belief
  126.6 / 260.0 / 511.8 / 1021.4 ms at 24/32 through 192/256. **The belief
  model's cheapest setting costs more than the strategy advisor's dearest.**
  Matched pair: strategy 2,560 worlds (96.3 ms) against belief 24/32
  (126.6 ms), 24% apart. At shipping defaults the gap is 82×.

- **C4 — a tie at face value, and not a tie underneath.** 1,000 matches,
  18,244 positions. Strategy 0.1642 ± 0.0086, belief 0.1591 ± 0.0147, paired
  difference 0.0080 at 1.9σ — not established, and below the 0.02 that would
  justify migrating anyway. But resolution 0.0583 against 0.0917 and
  reliability 0.0005 against 0.0373: the belief model carries 57% more
  information and loses nearly all of it to dishonesty.

- **C5 — decided: keep both, ship the strategy advisor, run the neutral test.**
  Recalibration, fitted on 500 matches and scored on a different 500, takes the
  belief model from 0.1567 to **0.1116** and leaves the strategy advisor at
  0.1604 unchanged — it had nothing to gain. That is 0.049 clear, well past the
  migration threshold. But this is the belief model's home field and the
  reading was pre-registered: its win here is confounded. The overturning
  experiment is the same comparison where neither models the opponents.
  Written into ADVISOR.md.

- **C6 — both kept, deliberately.** The loser is not obvious enough to retire:
  one is honest and cheap, the other is informative and expensive, and which
  matters depends on a test not yet run. The cost of carrying both is that
  every engine change must keep two forecasters alive — `pnpm test` now runs
  both suites, so that cost is at least visible.
