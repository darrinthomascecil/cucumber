# Second review: did the fixes actually fix anything?

You are reviewing a card-playing algorithm at commit `041eb4d`. A previous
reviewer found eight defects in it. All eight were reproduced and four were
fixed. **Your job is to check whether those fixes are correct, whether they
introduced new problems, and to find what the first review missed.**

Be adversarial, and be adversarial about the *fixes* specifically. The author
has now been wrong twice — once in the original design, once in believing the
design was finished — and is the same author who wrote the fixes you are
checking. Prefer "here is the line that is wrong and the experiment that proves
it" over "you might consider".

Read `PROPOSAL.md` first for what was claimed and measured, then
`ALGORITHM-REVIEW.md` for the original findings. Treat both as **claims to
audit**. `REVIEW-BRIEF.md` has the rules of the game and the information
constraint, which still bind.

---

## The central question

**Four real defects were fixed and match strength did not move.**

End to end, new advisor versus the pre-fix advisor: **+0.05 points, 95% CI
−1.52 to +1.62**, over 4,000 paired matches on identical deals against pinned
opponents. 1,024 of 4,000 outcomes changed, so play genuinely differs — the net
is simply zero.

Only one change measured an effect: a terminal guard stopping the heuristic
from finishing on a 7/Joker, worth −0.24 points (CI −0.28 to −0.20) over 60,000
paired matches.

There are at least four explanations and the author cannot distinguish them:

1. The defects were real but strategically inert — they mostly perturbed
   positions whose outcome was already determined.
2. The measurement is underpowered. Pairing by seed decays once play diverges,
   and a ±1.5-point half-width at 4,000 matches cannot see a half-point effect.
3. The fixes are individually correct but something larger dominates — most
   likely the two defects left unfixed.
4. One or more fixes is wrong in a way that cancels its own benefit.

**Deciding between these is the single most valuable thing you can do.** If (2),
say what design and sample size would settle it. If (4), find it.

---

## Audit these five fixes

### 1. `determinize.ts` — rejection-first sampling

Was: a 50/50 pick between branches of the failure disjunction, then a
card-by-card constrained draw; 22.6% where conditional-uniform is 42.1%, plus
1-in-256 worlds that contradicted a public failure.

Now: try up to 64 unconstrained draws and accept the first consistent one;
otherwise fall back to the constructive draw with branches rotated rather than
random; last resort repairs the hand by trading strong cards back to the pool.

Measured 41.976% against the correct 42.105%, and zero contradictions in
100,000 samples.

**Attack this hardest — it is the fix most likely to be subtly wrong.**

- **The bias is made rare, not eliminated.** When rejection exhausts its 64
  attempts the biased constructive path still runs. Worse, *which* path runs is
  correlated with how tight the constraint is, so the sampler is now exact for
  loose constraints and biased for tight ones. Is the resulting mixture better
  than uniformly-biased, or has one error been replaced by a harder one to
  reason about? Quantify the residual bias as a function of constraint
  tightness.
- Is 64 the right number? What is the acceptance rate distribution across real
  positions? 63% of real decisions carry at least one recorded failure, so this
  path is the common case, not an edge case.
- Does the `repair` last resort terminate and produce a consistent hand in
  every reachable case, or can it give up silently?
- Rejection conditions on **all** constrained seats jointly. Confirm that is
  actually what happens and that the joint draw is not still sequential in a
  way that biases the second seat.

### 2. `search.ts` — rollout screening replaces heuristic pruning

When there are more legal actions than `maxActions`, every action is now played
out over a small shared pool of worlds and the survivors get the full budget.
World count adapts so total work stays bounded.

- The screen is noisy by design (as few as 4 worlds when there are hundreds of
  actions). **Does it discard the true best action more often than the
  heuristic did?** It was never tested for this, only for the one position the
  first review found. Measure screen regret directly against an uncapped
  evaluation across many positions.
- The screen and the final evaluation draw from the same RNG stream in
  sequence. Is there any selection bias from screening and then re-evaluating —
  the screen picks winners partly on noise, and the second pass is independent,
  but confirm the reported `best` value is not optimistically biased.
- `screen: false` restores the old path. Is the comparison in `PROPOSAL.md`
  (+0.00 points, CI ±0.62 against tuned; +0.27, CI −0.38 to +0.91 against wide)
  adequately powered to conclude "no difference"?

### 3. `endgame.ts` — exhausted solver plays the position out

Was: scored an unfinished hand, reading each seat's lowest remaining card as
its final one.

- The fallback uses the modelled opponent policy for **all three seats**,
  including the solving seat. Is that the right estimate, or does it understate
  the solver's own position by assuming it stops searching?
- `searchActions` still never reads `exact`. Is that now acceptable because the
  fallback is honest, or should exhaustion still be surfaced?
- The node budget is shared across root candidates in order, so early
  candidates may be solved exactly and later ones estimated. Does the fix remove
  the action-order bias, or only make it smaller?
- This path is **opt-in** (`solveFrom` defaults to 0), so it does not affect the
  shipped advisor at all. Confirm.

### 4. `heuristic.ts` — terminal instant-loss guard

When a play would leave exactly one card and that card is a 7/Joker, it is
penalised beyond anything else the score can produce.

- Is the guard reachable in every position where it matters, or only when the
  play leaves exactly one card? What about two cards where both continuations
  are forced?
- The author also tried ranking the leftover card by its points and measured it
  **2.39 points worse**, then deleted it. Is that explanation — that keep and
  spend are complementary at the last decision, so scoring both just doubles the
  value weight — actually right? If so, does the same double-counting appear
  anywhere else?
- `INSTANT_LOSS = 1000` is a magic constant. Can any legitimate score reach it?

### 5. `rules.ts` — enumeration cap raised 400 → 4096

The claim is that a target is at most six cards and a hand at most thirteen, so
C(13,6) = 1716 bounds the distinct qualifying multisets and the cap can never
bind.

- **Verify that bound.** Is a seven-card target reachable under any legal
  sequence? Does the class abstraction change the count?
- `candidatesFor` is called in every rollout step. Does enumerating up to 1716
  multisets in a rare wide position cause a latency spike the author did not
  measure? Only the advisor's decision latency was measured, not rollout cost.

---

## The two defects deliberately left unfixed

Both are specified in `PROPOSAL.md` but not built. **If you think either is the
reason strength did not move, say so and make the case.**

**Exchange prior.** The sampler treats opponents' retained cards as unselected
random cards. It imagines each opponent holding ~0.96 eights when they actually
retain 0.005. This is the largest confirmed error in the system and it is
untouched.

**Continuation value.** `survivalValue` is provably invariant to adding a
constant to every score — `[2,5,8]` and `[12,15,18]` return identical values —
and its three outputs always sum to exactly 2, so it cannot represent multiple
losers. Simulated continuations differ from it by over 20 points in places. It
sits under every decision the advisor makes.

Also unfixed: failure memory stores only the target, losing both the lower bound
implied by the cards publicly surrendered and the tightening implied by that
seat's later plays. The live advisor keeps failures only from the current trick
while the benchmark keeps them for the whole hand.

---

## Audit the measurements, not just the code

The author's conclusions now rest on paired self-play, and a previous round of
conclusions rested on measurements that turned out to be tautological (a
symmetric self-play result reported as evidence of strength, when it is forced
to equal parity).

- Is pairing by match seed sound here? Both arms open on the same deal but
  diverge immediately; the author claims this removes the largest variance
  component. Is that true, and what is the actual variance reduction?
- Parity was re-measured at **36.4%** (ties produce multiple losers). Confirm.
- The 60,000-match terminal-guard result uses a legacy heuristic reimplemented
  inline as the opponent. Verify that reimplementation is faithful.
- What sample size would be needed to detect a 0.5-point effect? Is any
  conclusion in `PROPOSAL.md` overstated relative to its interval?

---

## What to hand back

1. **Verdict per fix**: correct, incomplete, or wrong — with the experiment.
2. **An answer, or a plan for an answer, to the central question**: why did
   fixing four real defects change nothing?
3. **New defects**, with file, line, failing scenario, and ideally a test.
4. **What you checked and found clean**, so a third review does not repeat it.
5. **What you could not evaluate** and what you would need.

Rules for claims: report confidence intervals and match counts, do not call a
win under two standard errors, and state when a result is a position-level
effect rather than a match-level one. At least one "improvement" in this
project's history was a regression that first looked like a win.

If the fixes are sound and the remaining gap really is the two unfixed defects,
say so plainly — but say it because you tried to break them and failed.
