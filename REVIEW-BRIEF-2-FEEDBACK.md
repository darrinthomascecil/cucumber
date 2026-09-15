# Review brief 2: verified feedback

Reviewed 2026-09-14 on `post-game-analysis`, HEAD `cba1bd451bf856008de5293ff17e44f1051f4b52`. The brief names `041eb4d`; the five fixes remain behaviorally unchanged at HEAD. Later changes include instrumentation and other components. Line references below use HEAD.

## Conclusion

**The claim that every fix is correct is false. The sampler still returns impossible worlds. The claim that the fixes changed nothing is also stronger than the evidence permits.** The omnibus interval cannot resolve a half-percentage-point gain. There is no demonstrated cancellation of benefits, and no basis for concluding that the two unfixed model defects explain the null result by themselves.

The existing `ALGORITHM-REVIEW-2.md` already contains substantial useful work. I read its diagnostic scripts, regenerated the instrumented modules from current source, and reran the principal experiments. These are reproductions of existing experiments, not a claim that I independently discovered their witnesses. I left that document and production source unchanged. No finite review guarantees absolute correctness; the distinctions between proof, reproduction, approximation, and unknown effects matter here.

## Verdict per fix

| Fix | Verdict | Evidence |
|---|---|---|
| Rejection-first sampling | **Incomplete; its advertised consistency guarantee is wrong** | A legally replayed position yielded 2,637 contradictory worlds out of 30,000: 8.79%, approximate 95% CI 8.47–9.11%. |
| Rollout screening | **Valid approximation, not a correctness guarantee** | Fresh screening and final worlds; remaining pruning regret and optimism in the reported maximum. A 550-action case uses 2,200 screening rollouts despite a 1,600 budget. |
| Exhausted solver rollout | **Corrects fabricated endings; incomplete treatment of exhaustion** | Reversing root order changed matched action values in 119/1,000 five-card diagnostic positions at a ten-node budget. |
| Instant-loss guard | **Correct for shipped weights and immediate endings** | 60,000 paired matches against the actual Git legacy policy: −0.225 loss percentage points, 95% CI −0.263 to −0.187. |
| Enumeration cap | **Correct** | Six is the largest possible lead width; the 1,716 subset bound is safe. A tighter reachable response bound is 550. |

## 1. Sampler: confirmed failing fix

Locations: `packages/strategy/src/determinize.ts:254`, `:285`, `:287`, `:312`.

The rejection stage samples both opponents jointly, then checks all stored failures. Sequential uniform draws without replacement do not bias the second seat. Accepting only consistent joint deals is correct for the specified uniform prior, though that prior still ignores exchange selection.

Construction is different. For a failed pair of Jacks, its branches require either at most one Jack-or-higher, or zero. With two copies of that same failure, `(attempt+t) % choices.length` always selects the strict zero-high branch for one copy. It never tries the feasible pair of weaker branches. Rotating branches together does not enumerate their Cartesian product.

The legal replay preserved in `ALGORITHM-REVIEW-2.md` and `/tmp/cucumber-review2/reachability.mjs` ends with:

- Our hand: three 3s; our known discards: three 4s.
- Opponent hand sizes: three each.
- Unseen pool: two 6s, four Queens, four Kings, four Aces, four HIGHs (7/Joker).
- Seat 1 publicly failed a Jack pair twice; its actual remaining hand is 6,6,Q.

Every replayed action was checked against `candidatesFor` before commitment. A consistent seat-1 hand must contain both 6s and one higher card. Construction instead requires three low cards. Repair sometimes cannot retrieve a needed 6 already assigned to seat 2, because it trades only with the leftover pool. It returns silently, and the caller returns that invalid world without checking it.

**Reproduced:** 2,637/30,000 contradictions, seed 87123. Removing the duplicate constraint gives 0/30,000. The duplicate conveys no extra information to this representation, but changes its support. This example applies to the benchmark's full failure history; the live advisor's current-trick memory does not retain both failures.

Repair terminates, but termination is not consistency. Deduplication repairs this witness, not the general incomplete branch search. Require final joint validation and a complete construction/sampling method or an explicit, detectable failure result. Preserve this replay as a regression test.

### Residual bias

For joint rejection acceptance probability p, fallback probability is exactly `(1-p)^64` under independent ideal draws. If P is the desired conditional distribution and Q is fallback output, output is `(1-f)P + fQ`, with total-variation error at most f. This is a useful guarantee for loose constraints and a weak one for tight constraints.

Rerun synthetic urn tests, 100,000 samples per row, for a hand constrained to contain at most one high card:

| Low/high cards; hand size | Acceptance p | Fallback probability | Exact probability of a high | Observed |
|---|---:|---:|---:|---:|
| 12/4; 2 | 95% | effectively zero | 42.105% | 42.422% |
| 8/10; 5 | 8.824% | 0.271% | 92.593% | 92.576% |
| 6/12; 5 | 2.171% | 24.545% | 96.774% | 97.551% |
| 5/13; 5 | 0.770% | 60.963% | 98.485% | 99.400% |

For the last two observed proportions, approximate 95% half-widths are 0.096 and 0.048 percentage points. Their bias is clear. The first row is approximately two standard errors from expectation; it does not overturn the rejection proof. These are distribution diagnostics, not reachable-game or match-strength claims.

Rerun ordinary workload collection: 1,000 matches each against tuned and wide opponents, with a heuristic subject. In tuned games, 54/7,820 constrained non-forced decisions entered construction on their one diagnostic sample (0.691%); mean rejection attempts were 2.54. In wide games, 0/2,629 did, with 1.26 attempts on average. Neither population entered repair. These correlated decision observations do not establish a universal failure rate or prove safety for searching subjects or humans. They support 64 as a plausible practical cutoff, not an optimal or exact one.

## 2. Screening and reported odds

Locations: `packages/strategy/src/search.ts:193`, `:194`, `:214`.

Screening and final evaluation use successive fresh draws. There is no direct reuse of winning screening samples in final estimates. Conditional on a fixed shortlist, each individual final estimate has the sampler/rollout model's expectation.

**But `best` is a maximum of noisy final estimates.** It remains subject to selection optimism. Independent screening does not make the selected final maximum unbiased. A separate evaluation of the chosen action would address this display issue, without itself improving selection.

The preserved ordinary bank contains 30 cap-binding positions from each opponent population. The rerun evaluates every action on 4,096 reference worlds, screens on 32 seeds, and runs eight default final evaluations per position. Reference values are Monte Carlo estimates, not the true best action. This selected bank is not a match-frequency-weighted experiment; its small regrets should not be overinterpreted.

Rerun mean reference regret, in percentage points: tuned positions, heuristic 0.0056 versus screen 0.0146; wide positions, heuristic 0.1172 versus screen 0.0306. Screen-minus-heuristic approximate across-position 95% intervals are −0.0055 to +0.0235 and −0.2697 to +0.0965 respectively. These descriptive intervals do not propagate reference-world uncertainty. Neither establishes a general improvement or regression. Reported-best optimism averaged +0.894 points (interval +0.429 to +1.360) and +0.563 (+0.393 to +0.734). Final action-selection regret exceeded average screening regret in both banks.

The 550-action stress case reproduced exactly: old heuristic pruning loses 11.743 percentage points of reference value; the screen loses 1.516 on average across 100 screens, with maximum observed regret 14.185 points. Forty screens have positive reference regret. This is strong evidence that screening can help in this position and can still miss important actions, not a measured match-level gain.

`Math.max(4, ...)` requires at least 4 × 550 = 2,200 rollouts, exceeding `screenBudget:1600`. The workload remains bounded by the game's legal action count. Twenty full default decisions measured median 71.7 ms and maximum 88.2 ms on this machine during concurrent diagnostics. These are local timings, not a portable latency guarantee or an isolated microbenchmark.

The proposal's ±0.62-point screening interval cannot establish equivalence within 0.5 points. Say “no detected improvement,” not “no difference.”

## 3. Solver exhaustion

Locations: `packages/strategy/src/endgame.ts:135`, `:192–198`; `packages/strategy/src/search.ts:176–177`.

Fallback now plays an actual ending. Using the modeled policy for our seat is a legitimate baseline estimate, but it may undervalue continued search. For fixed deterministic modeled opponents, an exhaustive best reply can do at least as well as following that policy ourselves. That statement does not extend to arbitrary opponent-model or imperfect-information optimality claims.

The shared root budget still distributes effort by enumeration order. Reproduced 119/1,000 positions with changed numerical values when roots were reversed at a ten-node budget. Example: hands `[4,5,8,J,HIGH]`, `[8,8,9,K,A]`, `[2,3,4,5,J]`, scores `[0,0,0]`. Leading HIGH evaluates to 0.60572 when late, 0.79832 when first; adequate-budget evaluation is 0.79832. This is a position-level approximation defect, not evidence that the production budget routinely exhausts.

The caller still ignores `exact`. Surface exhaustion and give root candidates comparable effort or explicitly label mixed estimates. `solveFrom` defaults to zero, and the live advisor does not enable it. This fix cannot explain the default advisor's match-level change.

## 4. Instant-loss guard

Locations: `packages/strategy/src/heuristic.ts:140–160`.

The guard correctly rejects immediate endings on HIGH under TUNED. It is deliberately not a proof about forced endings two or more cards ahead. Such tactical losses require lookahead and are not repaired by this local condition.

The constant 1,000 safely dominates shipped scores. A conservative bound for a legal play of at most 12 cards gives positive rewards below 262 and combined negative terms below 319, so an unguarded score difference is below 581. Arbitrarily large custom weights invalidate that guarantee; the exported weights interface does not restrict them.

The rerun used the actual legacy heuristic extracted from Git commit `4939cf3`, rather than an inline recreation. The diff confirms that the guard is the behavioral change in the heuristic. Against two pinned legacy opponents, rotating subject seat:

- 60,000 match pairs.
- Legacy subject losses: 21,874; guarded subject losses: 21,739.
- 135 improvements, zero regressions.
- Difference: −0.225 percentage points, approximate paired 95% CI −0.263 to −0.187.

This corroborates the proposed improvement in the bare heuristic. It does not prove the advisor improves equally: root search already scores terminal HIGH losses correctly.

For a fixed hand and alternatives that all end the hand, remaining points equal total hand points minus played points. A negative remaining-points feature therefore duplicates some reward for spending points. “Doubles” requires equal coefficients. If comparing ending versus continuing leads, the terminal-only constant does not cancel across every candidate. The deleted implementation prevents attributing the entire reported 2.39-point regression to this algebra alone.

## 5. Enumeration bound

Location: `packages/strategy/src/rules.ts:88–106`.

A lead uses one class: at most four ordinary cards or six HIGHs. Responses preserve its width, and hands never grow during trick play. Seven-card targets are impossible. Class merging only reduces distinct subsets, so C(13,6)=1,716 is a safe upper bound.

The tighter bound is 550: width-five and width-six leads must be HIGH and cannot be met from the remaining supply. A width-four ordinary lead exhausts its class, leaving at most twelve classes for a follower. Thirteen cards over twelve classes maximize four-card multisets at eleven singletons plus one doubleton: C(11,4)+C(11,3)+C(11,2)=550. Width-three or smaller responses have at most 286 combinations. The four-2 lead realizes 550. Thus 4,096 cannot bind in a reachable trick.

The proposal's larger random “legal” workloads and five-card extreme omit some deck/history reachability condition. They are not valid evidence about realistic tail workloads, even though the cap itself is safe.

## Central question: why no measured match gain?

The evidence supports **limited exposure plus insufficient precision**, with a real unresolved sampler defect. It does not identify a unique causal explanation.

1. The solver is off by default. Enumeration/screening fixes affect relatively few tuned-opponent decisions: the rerun observed 87/30,928 subject decisions with more than 14 actions (0.281%) under heuristic play.
2. The guard's bare-policy improvement is not directly transferable to a searching subject.
3. The reported 4,000-pair result permits useful positive or negative effects. With 1,024 discordant pairs, variance of the per-pair loss difference is approximately 0.256; standard error is 0.8 percentage points, producing the reported ±1.57-point interval.
4. Exchange selection and continuation defects persist in both arms. Their existence alone does not establish their strength impact or demonstrate that they suppress other fixes' benefits.
5. The sampler counterexample proves incomplete correctness, but the ordinary workload rerun did not encounter its repair failure. Attributing the omnibus null to cancellation would be speculation.

### Experiment that would answer it

Preserve a runnable paired harness with independently seeded deals and search randomness, fixed opponents, rotating subject seat, all parameters and per-pair outcomes. First isolate each fix, keeping root budgets and opponent policies fixed. Estimate discordance in a pilot; then set the final held-out sample size and primary contrasts before examining results.

At discordance variance 0.256, a two-sided 5% test for a true 0.5-percentage-point effect needs approximately **80,400 pairs for 80% power**, or **107,600 for 90% power**. About 39,400 pairs merely achieves a 0.5-point 95% half-width; it does not provide 80% power. A narrow ablation may have far lower discordance and need fewer pairs.

Pairing remains valid when play diverges; divergence affects covariance. With deterministic exchanges and separate deal/search RNGs, corresponding later hands can retain identical shuffles. The exact variance reduction in the deleted omnibus run cannot be recovered without marginal loss rates or pair records. For the rerun guard experiment it was approximately 206-fold. One cannot infer a similar benefit for the bundled changes.

Next test the generative exchange prior and a fitted continuation model separately and in a 2×2 design. Keep all other policy choices fixed and account for multiple primary comparisons. In a rerun of the existing held-out opening witness, scores `[20,18,20]`, leading 4 instead of 6 improved terminal survival from 62.264% to 68.392% over 50,000 new modeled worlds: **+6.128 points, paired 95% CI 5.716–6.540**. The generative model samples hypothetical opponent pre-discard hands and applies the fixed discard policy; it uses no actual hidden cards. All continuations terminate the match, avoiding the disputed leaf formula. This confirms decision relevance under that model, not a full-match advisor improvement.

## Additional measurement corrections and limits

- A fresh 30,000-match symmetric TUNED run, seed 9845231, yielded 32,809 losses: **36.454% per seat**, match-clustered approximate 95% CI **36.339–36.570%**. Consistent with 36.4%, but parity is policy-dependent: symmetry gives E[number of losers]/3, not a universal 36.4% constant.
- The proposal overcorrects in dismissing the symmetric heuristic baseline entirely. It is a valid control for search against the same two pinned heuristic opponents. It does not establish a ceiling or an irreducible information gap.
- `packages/strategy/src/selfPlay.ts:124` still sets `maxActions:10` in `searchPolicyWith`, while the advisor defaults to 14. Align this continuation-tuning helper before evaluating a replacement value function.
- The default rollout policy sees only its acting seat's hand and public state. I found no actual hidden-hand access through the advisor. Optional perfect-information solving is a different path. Later comments in `oracle-honest.ts` and `search.ts` describing the default advisor as playing “face up” reintroduce the already-corrected misconception; they do not match the default execution path.
- `survivalValue` still loses absolute score level and forces survival probabilities to sum to two. Those properties follow algebraically; the match-strength benefit of replacing it remains unmeasured here.
- The original author's inline legacy policy and omnibus pairing scripts were deleted. Reproduction with actual historical code corroborates the guard result but cannot certify vanished source or RNG wiring.

## Validation and reproducibility

**164 strategy/rules tests passed in 19 files; `pnpm typecheck` passed.** Existing tests passing does not cover the sampler witness. Production source and the pre-existing untracked review were unchanged.

Read and rerun scripts under `/tmp/cucumber-review2`: `setup.py`, `reachability.mjs`, `sampler.mjs`, `population.mjs`, `screen.mjs`, `wide-stress.mjs`, `endgame.mjs`, `guard-pair.mjs`, and `retention-confirm.mjs`. Their source is preserved in the repository's existing `ALGORITHM-REVIEW-2.md` reproduction appendix. `setup.py` imports current strategy source into temporary instrumented modules and extracts historical heuristic code. Position-bank collection was rerun and reproduced its original counts. Temporary diagnostic paths are machine-local; preserve the appendix and executable diagnostics in version control when addressing the findings.

Not established: optimal play, full-match benefit from either remaining model change, natural repair-failure frequency under human or searching subjects, production solver exhaustion rate, mobile/browser tail latency, or the precise design and raw results of the deleted omnibus experiment. No recommendation above assumes those unknowns have been settled.
