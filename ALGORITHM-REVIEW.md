# Cucumber algorithm review

Reviewed 2026-09-14 against commit `2f6e25445d169b38ce312eb46e70bbc6ba7f8fad` and the working-tree `REVIEW-BRIEF.md`.

## Verdict

**No: the claim that the design has reached its ceiling is not justified.** The advisor is substantially stronger than its heuristic on the reported benchmark, but there are confirmed defects in its beliefs, continuation values, and action selection. Several are addressable without replacing the search architecture.

**How close is it to optimal? Unknown, and the current measurements do not provide a useful numerical bound.** I would describe it as a strong, narrow benchmark player with demonstrable weaknesses, not a near-optimal Cucumber strategy. Neither “95% of optimal” nor “another ten match-loss points are available” would be supported by this review.

The most useful new findings are:

1. The sampler ignores opponents' exchange selection. In 30,000 simulated hands, its implied mean was **0.962 eights per opponent**, versus **0.005 actually retained** by the opponent it assumes it is modeling.
2. The continuation function cannot distinguish score vectors with identical gaps but radically different proximity to 21, and cannot represent multiple losers. Direct continuation experiments show large errors.
3. The 14-action trim discarded a move worth **44.04% survival**, retaining alternatives worth at most **35.08%**, in one observed position under the algorithm's own rollout model. Independent confirmation used 20,000 worlds; the paired difference was **8.96 percentage points, 95% CI 8.13–9.78**.
4. The constrained sampler is biased even relative to its simplified uniform prior, and its fallback can return worlds contradicting feasible public-failure constraints.
5. Budget-exhausted solver results are used as if trustworthy, although their values come from prematurely scoring unfinished hands.

These are different kinds of evidence. The pruning result proves a position-level loss under the current model, not an 8.96-point improvement in actual match loss. The distribution and continuation experiments establish model errors, not the match strength of hypothetical fixes. **No production algorithm was changed and no improved match-level policy is claimed.**

## What I did

Read the four requested functions in order, then their callers, the solver, oracle, exchange logic, restricted views, relevant rule/class mappings, tests, benchmark configuration, and the author's explanatory documents. The rules engine was not the focus.

Ran all existing strategy tests plus the Node runtime tests using a temporary Vitest configuration and a cache outside the repository: **42 tests passed in six files**. Ran independent diagnostic scripts against the existing source, including:

- 10,000 complete tuned self-play matches to measure branching and capture real positions;
- independent 20,000-world confirmation of one pruning failure;
- 30,000 complete continuations from each of three score vectors;
- 30,000 fresh hands to measure the exchange prior;
- 100,000 samples each for constrained-sampling bias and inconsistent fallback.

All code experiments were temporary diagnostic files. Reproduction scripts are included at the end of this document. Existing changes in `apps/web/src/styles.css` and the untracked review brief were left untouched.

## Confirmed defects and limitations

### 1. Opponents' retained cards are modeled as unselected random cards

**Location:** `packages/strategy/src/determinize.ts:170–205`; compare `selfPlay.ts:165–178`, `selfPlay.ts:41–63`.

Without recorded failures, the sampler draws uniformly without replacement from everything unseen. It treats other players' retained hands, their face-down discards, and the remaining stock as exchangeable locations. But the modeled opponents deliberately choose their discards. Consequently, a card's chance of being retained is very different from its chance of remaining unseen.

This is legal information to model: hypothesizing that an opponent discards according to a known policy does not reveal their actual discards.

**Experiment:** 30,000 independently shuffled hands, all players using `TUNED`, exchange size 3, dealer rotated. At the start of trick play, observe seat 0's hand and own discards. Its unseen pool has 38 cards; the sampler's exact marginal expectation for an opponent's count of class c is `13 * pool[c] / 38`. Compare this with the actual average count in the other two hands, aggregating uncertainty by hand rather than treating the two opponents as independent.

| Class | Sampler's mean count | Actual retained mean | Actual minus predicted, 95% CI |
|---|---:|---:|---:|
| 8 | 0.96184 | 0.00523 | −0.95661 ± 0.00341 |
| 9 | 0.96372 | 0.21012 | −0.75361 ± 0.00416 |
| 7/Joker | 1.44301 | 1.77325 | +0.33024 ± 0.00417 |
| Ace | 0.96681 | 1.17448 | +0.20767 ± 0.00357 |

This is not small-sample calibration noise. The advisor imagines opponents holding cards that this particular opponent almost always throws away. Its good opponent *action* model does not rescue its poor opponent *hand* model.

**Implication:** correcting the exchange prior is a higher-priority experiment than adding more worlds or starting a full CFR project. This result is specifically for the benchmark's three-card exchange and tuned discard policy; a human's prior needs a different or mixed model.

### 2. The continuation probability has two structural errors

**Location:** `outcome.ts:60–74`.

#### Absolute headroom cancels out

The exponent for player i is:

`[score_i − max(other scores) + headroom * score_i] / temperature`.

Add k to every score. Each exponent increases by the same `headroom*k/temperature`; normalization cancels this factor. Therefore:

`survivalValue(scores + k, seat) = survivalValue(scores, seat)`.

The parameter called `headroom` changes relative-score sensitivity, but **cannot encode actual distance to 21**. The implementation returns identical probabilities for `[2,5,8]` and `[12,15,18]`.

That invariance is inappropriate for this game's stopping rule. With little headroom, there are fewer future hands in which the standings can change.

**Experiment:** play 30,000 complete continuations per starting vector with the tuned heuristic at all seats, three-card exchange, dealer rotated, and reproducible seeds. This measures the policy actually used in default rollouts, not an optimal continuation.

| Starting scores | Seat | Model survival | Measured survival, approximate 95% CI |
|---|---:|---:|---:|
| `[2,5,8]` | 0 | 88.07% | 90.75% ± 0.33 points |
| | 1 | 77.75% | 72.24% ± 0.51 points |
| | 2 | 34.18% | 29.46% ± 0.52 points |
| `[12,15,18]` | 0 | 88.07% | 96.47% ± 0.21 points |
| | 1 | 77.75% | 86.55% ± 0.39 points |
| | 2 | 34.18% | 11.42% ± 0.36 points |

#### The normalization assumes exactly one loser

The three returned survival probabilities always sum to exactly 2. Equivalently, the loss probabilities sum to exactly 1. But tied highest scores and multiple final 7s/Jokers can produce multiple losers. In general, the correct sum of survival probabilities is `3 − E[number of losers]`, which can be less than 2.

From `[19,19,19]`, the next hand necessarily ends the match. The model gives 66.67% to every seat. In 30,000 continuations, observed survival was **54.74%, 54.44%, and 54.59%**, each with approximately ±0.56 points of 95% uncertainty. There were **9,324 matches with multiple losers**.

The terminal scoring function correctly handles ties and instant losses; the defect is the nonterminal approximation. Merely refitting its existing two parameters cannot remove either structural restriction.

**Additional missing variable:** next dealer/leader identity can matter to continuation, but `survivalValue` receives only scores and seat. A better model should retain this state and identify the continuation policy lineup.

### 3. The 14-action trim demonstrably excludes a better action

**Location:** `search.ts:108–115`.

In 10,000 tuned self-play matches, comprising 930,315 decisions:

| Candidate limit | Decisions exceeding it | Share of all decisions |
|---|---:|---:|
| 10 | 98,855 | 10.63% |
| 14 | 2,612 | 0.281% |

The largest observed candidate list had 61 actions. These frequencies are descriptive of this self-play population, not independent-decision confidence estimates or estimates for human opponents. The 14 cap is relatively rare here because these opponents usually lead narrow.

There is also a useful exact bound: a legal lead has at most one candidate per card in hand, so at most 13 during trick play. **The 14 cap never binds on a lead.** Its damage is in multi-card responses. The benchmark's cap of 10 can bind on ordinary leads too.

I inspected the first 20 observed positions exceeding 14 candidates. Five had an omitted move exceeding the best retained move by more than 0.1 points in an exploratory 512-world evaluation. This was a convenience sample, not a prevalence estimate. One position was then confirmed with a new seed and 20,000 worlds.

**Concrete position, using zero-based seats and class indices:**

```text
seat = 1
hand = [1,1,1,0,1,0,0,0,2,1,1,0,2]
played = [0,0,0,0,3,0,0,4,1,1,0,3,0]
own discards = [0,0,0,2,0,0,1,0,0,0,0,0,0]
hand sizes = [7,10,10]
scores = [15,20,19]
failures = [[],[],[]]
leader = successful seat = 0
target = [4,4,4]   # three 6s
plays made = 1
```

Our hand is `2,3,4,6,J,J,Q,K,HIGH,HIGH`. There are 18 legal responses.

- `HIGH + HIGH + 6` ranks **17th** under the heuristic and is excluded.
- Independent rollout survival: **44.035%**.
- Best retained action: `HIGH + Q + 6`, **35.080%**.
- Paired difference over common worlds: **8.955 points**, approximate 95% CI **8.131–9.779**.

The best retained action was selected from the retained set using the confirmation sample; the interval is a pointwise paired interval, not a simultaneous guarantee over all actions. The discarded move was fixed before confirmation. The gap is large enough to warrant a match-level ablation, but it remains a result under the current sampler and rollout model.

### 4. A second, undocumented cap drops legal responses before the trim

**Location:** `rules.ts:93–106`, called by `sim.ts:96–101`.

`qualifyingPlays` defaults to a limit of 400. Thus increasing `maxActions` cannot necessarily expose every legal action, and the “exact” solver uses this enumerator too.

**Concrete hand:** one each of `3,4,5,6,8,9,10,J,Q,K,A`, and two HIGH cards; target four 2s. This is deck-feasible and has **550 distinct qualifying responses**. Default enumeration returns **400**. For example, `HIGH + HIGH + A + K` is omitted. Calling `qualifyingPlays(hand, target, 100000)` returns all 550.

The comment says enumeration favors strongest answers first, but the loops ascend through class indices and the observed ordering contradicts that explanation.

This did not bind in the 10,000-match branching sample. I have not established match-level damage from this separate cap; it is a confirmed completeness limitation, particularly relevant against wide leads. The short-hand solver is not necessarily affected at its normal small thresholds.

### 5. Failure constraints are not sampled from the claimed distribution

**Location:** `determinize.ts:106–151`, `183–190`, `208–219`.

The disjunction used to express failure is mathematically correct. The sampling algorithm is not a uniform draw conditioned on that disjunction.

**Bias example:** an unseen pool contains 12 lower cards and four HIGH cards; an opponent currently holds two cards and previously failed a pair of HIGHs. Considering only the stored constraint, the permissible hands contain zero or one HIGH.

- Uniform two-card subsets conditioned on that failure have a HIGH with probability `12*4 / (C(12,2)+12*4) = 48/114 = 42.105%`.
- `limitsFor([HIGH,HIGH])` produces “at most one HIGH” and “zero HIGHs.” The sampler chooses these with equal probability, despite overlap and very different masses.
- Under its sequential draw with the first limit, the chance of at least one HIGH is `1 − 12*11/(16*15) = 45%`. Under the second it is zero. The implemented mixture therefore gives **22.5%**.
- Measured: **22,426 of 100,000 samples**, or **22.426%** (approximately ±0.259 points at 95%).

Even the first branch alone is biased: 45% differs from the conditional-uniform 42.105%. So weighting the failure branches differently is not a sufficient general fix. Sequentially dealing one constrained seat before another can add further bias through different numbers of valid completions.

These probabilities concern the sampler's own simplified prior and stored constraints. The correct behavioral posterior would additionally condition on exchanges and the actual public play sequence.

**Inconsistent fallback:** after eight construction failures, the code silently drops all constraints. A feasible test information set with three cards per player, an unseen pool containing two low cards and sixteen cards at least Jack, and a recorded failed pair of Jacks produced **400 contradictory worlds in 100,000 samples**. The compatible hand has exactly the two low cards and one high card. Randomly picking the stronger “zero high cards” branch can fail repeatedly even though that compatible hand exists.

The test uses 30 played cards, three own discards, and a three-card own hand, consistent with ordinary card-count totals. It is a constructed sampler input, not a captured full match history. Its complete vectors are in the reproduction script.

Existing inference tests check some support constraints but not distributional correctness. The “nearly impossible” fixture actually has no available cards below its single-card failure threshold, yet only asserts hand sizes; it therefore does not verify the advertised consistency guarantee.

### 6. Public failures reveal more than the sampler remembers

**Location:** `sim.ts:121–123`, `advise.ts:94–107`, `determinize.ts:39`.

Remembering only the target loses additional hard information. If a player fails a pair of 7s and publicly surrenders a 2 and a 3, their remaining hand contains **no card below 3**. The present constraint merely excludes hands capable of meeting the pair; it can still imagine an unplayed 2 in that hand.

Furthermore, later plays by that seat can tighten an earlier failure. If it previously failed a pair of Jacks, then subsequently plays a Queen, its remaining hand contains zero Jacks-or-higher, not merely at most one. Correct inference can reconstruct the earlier hand by adding back the seat's later public plays, or decrement the relevant capacity bounds.

The live advisor also retains failures from only the current trick, whereas the self-play search retains failures throughout the hand. Aggregated played counts do not preserve who played which card and when. This is information loss, **not hidden-information leakage**. The reported inference-on/off experiment does not establish the value of these richer constraints.

### 7. The tuned heuristic can choose a certain, avoidable instant loss

**Location:** `heuristic.ts:116–119`, `125–137`.

**Concrete final trick:**

```text
Seat 0 leads with [Ace, 7], cumulative score 0.
Seat 1 holds [2, 3], cumulative score 19.
Seat 2 holds [4, 5], cumulative score 18.
```

The tuned score favors playing Ace: **15.0705**, versus **11.3488** for playing 7. With either lead the opponents must surrender their lower card.

- Lead Ace: finish holding 7, instant loss for seat 0.
- Lead 7: finish holding Ace; final scores are `[15,22,23]`, seat 2 loses, seat 0 survives.

The default advisor searches both actions and can correct this at its own root. The defect remains in the bare heuristic and in its modeled future decisions. **It does not prove that changing the global negative `high` weight improves play.** That weight can be useful early; the missing behavior is a state-dependent terminal exception or a richer policy.

The exact `[Ace,HIGH]` two-card hand appeared only once in the 930,315-decision self-play sample, so this particular tactical repair is unlikely to transform benchmark strength alone.

Two explanatory claims also need correction: one HIGH cannot meet every multi-card target; and for hand sizes 2–12, `remaining^1.244 < remaining`, so increasing gamma above 1 reduces the strength penalty relative to a linear curve. The documents' claim that this necessarily preserves strength longer has the direction reversed for that term.

### 8. An exhausted solver scores unfinished hands and the caller trusts it

**Location:** `endgame.ts:111`, `162–176`; `search.ts:137–139`; `sim.ts:166–171`.

On budget exhaustion, the solver calls `terminalValues` even though the hand is unfinished. `finalClasses` then selects the lowest class still present in each hand as if it were the final card. Remaining dangerous cards disappear from that valuation. The solver reports `exact: false`, but `searchActions` ignores the flag.

The budget is shared across root candidates, so early candidates can receive deeper evaluation while later ones receive these artificial endings. That can introduce action-order bias.

**Reproduction:** hands `[2,3,7]`, `[4,5,6]`, `[8,9,10]`, scores zero, seat 0 leading, modeled opponents. With node budget zero, values for leading `2`, `3`, `7` are approximately `[0.86591,0.88825,0.88825]`, reported inexact. With adequate budget they are `[0.85707,0.88068,0.90726]`, exact in 17 nodes. Search consumes either result without distinguishing them.

This is an opt-in solver bug: the default advisor does not enable solving. I did **not** establish that the 200,000-node budget was reached in the published from-eight modeled experiment. Its reported typical size is much smaller. Budget failures must be instrumented before attributing that experiment's behavior to this bug or exclusively to strategy fusion.

## The ceiling argument and the architecture are mischaracterized

### Default rollouts do not give their policies perfect information

`search.ts:117–118,145` uses a fixed heuristic for all three future players. `heuristicPolicy` reads the acting player's own hand and public scores; it cannot adapt an action to another player's hidden cards. In worlds with the same acting player's observable state, this deterministic policy makes the same choice. Different choices for an opponent with different private hands are legal, since that opponent observes its own hand.

Thus the default algorithm is more precisely **root action evaluation by sampled hidden states under fixed observation-respecting continuation policies**. Sampling a full simulator state does not itself create strategy fusion. Its major default defects are a poor posterior, limited continuation policy, and inaccurate leaf utility.

The optional solver is different. It maximizes separately within each fully specified world, so the solving player can condition future choices on hidden distinctions it will not actually observe. That is a real strategy-fusion risk. In modeled mode the opponents still use their restricted heuristic; it is not accurate to say that all three become omniscient.

Likewise, the default rollouts fail to value concealment because their opponents ignore history, not because the heuristic is secretly shown everybody's cards. An observation-sensitive opponent model could value public signals within ordinary sampled rollouts.

### The oracle experiment does not measure the irreducible information gap

`oracle.ts:46–50` tries each root action and then uses heuristic continuations. It is not a solved perfect-information best response, despite the comment at lines 27–29. It also inherits the legal-action enumeration cap and continuation approximation.

Its low loss rate is evidence that knowing the hands is useful against this opponent. It does not partition the honest player's losses into reducible and irreducible components. A genuinely optimal full-information agent would provide a bound under matched conditions; this implemented diagnostic is not that agent. No optimal honest agent was evaluated, and no information-constrained lower bound was established.

The null results for one inference representation and one eight-parameter policy family say little about omitted inference, better leaf values, or richer honest policies. The new defects provide specific counterexamples to “nothing remains except unknowable cards.”

### Published measurements need a narrower interpretation

- **Different action caps:** `selfPlay.ts:95,113` uses 10, versus the advisor default 14. This matters on 10.63% versus 0.281% of observed heuristic decisions.
- **Different exchange policy:** benchmark search players use `weightedDiscards`; the live advisor searches a discard shortlist. Benchmark search also remembers more failure history. Reported loss rates should not be presented as an exact measurement of the live advisor.
- **The from-eight regression is not proven by the displayed marginal intervals alone.** A 0.95-point difference between `22.06% ±0.76` and `23.01% ±0.77`, where the harness prints approximately two standard errors, is about 1.76 independent standard errors. A paired comparison might establish significance, but paired outcome data are not supplied. Same seed alone does not provide its variance; differing match lengths change later random consumption.
- **Parity is not exactly one-third.** Ties create multiple losers. In my 10,000 symmetric matches there were 10,950 total losses, giving average per-seat loss 36.50%. Near-terminal parity can differ further.
- **Missing reproduction command:** `outcome.ts:45–46` says `pnpm self-play continuation` reproduces the grid search. The command switch at `tools/self-play.ts:574–605` has no `continuation` case. I could not audit the claimed parameter search through that entry point.

## Ranked improvements and falsifying experiments

Effort estimates below are rough engineering scope, not commitments. “Expected gain” distinguishes demonstrated local effects from unknown match-level effects. Establish a benchmark that calls the same configuration as the advisor before comparing changes.

| Rank | Change | Expected gain | Cost | Experiment that confirms or refutes it |
|---|---|---|---|---|
| 1 | Model post-exchange retention, initially for the known tuned opponent; later mix opponent types and condition on public actions. | Highest-priority belief improvement: large distribution error is confirmed. Match-loss gain unknown. | Several days for an initial exchange sampler and validation; longer for full history replay. | First reproduce observed post-exchange class marginals and joint hand statistics using only legal inputs. Then freeze policy and leaf model and run paired full matches against the same tuned opponents. Refute the strength hypothesis if calibrated beliefs produce no held-out loss improvement at useful compute budgets. |
| 2 | Replace the two-parameter continuation function with a score/dealer/policy-aware estimate that allows multiple losers. | Large value errors are confirmed; ranking and match-loss gains remain unknown. | A few days for a table or small fitted model plus data generation. | Fit on simulated complete continuations, hold out seeds and score regions, test error near threshold and ties, then perform a separate paired match-strength comparison. Refute if better prediction does not change useful decisions or improve loss. |
| 3 | Fix candidate completeness; evaluate all ordinary responses or use a cheap screening round before allocating more samples. | Confirmed 8.96-point local gap; aggregate gain likely limited against narrow-leading heuristics, potentially larger against wide players. | Small change for enumeration and instrumentation; a few days for adaptive allocation. | Compare cap 10, 14, and uncapped with identical model/settings, record discarded-action regret and latency, and test full matches against both tuned and wide-leading opponents. Reject a proposed budget scheme if its omitted-action regret or time-adjusted loss is worse. |
| 4 | Replace biased constrained draws and unconstrained fallback; retain forced-low bounds and per-seat public chronology. | Restores statistical/support correctness. Match gain unknown; old +0.18 result cannot answer this version. | Several days; exact counting or sequential importance weights take more work than simple rejection. | Compare to exact enumeration on small pools, including overlapping failures and two constrained seats. Assert zero contradictory worlds for feasible inputs. Then measure calibration and full-match loss with corrected inference on/off. |
| 5 | Give the rollout policy terminal safeguards and hand-shape features; tune against a diverse pool. Keep actual opponent behavior separately modeled. | Certain tactical defect removed; observed Ace/HIGH instance rare. Broader gain uncertain. | Hours for terminal checks, several days for richer features and evaluation. | Verify the Ace/HIGH counterexample, then compare frozen variants across tuned, historical, wide, and mixed opponents on held-out seeds. Refute the feature set if it only wins its training matchup. |
| 6 | Respect `exact:false`; replace unfinished-hand scoring with a valid common fallback and expose exhaustion counts. | Corrects an opt-in failure, probably no default-advisor gain. | Small implementation change plus focused validation. | Force tiny budgets, permute root action order, and compare against complete solves. Log exhaustion rates in the original from-eight workload before interpreting its regression. |
| 7 | Prototype information-set endgame planning against fixed heuristic opponents. | Potential legal planning gain; not quantified. | A bounded prototype over several days to a couple of weeks. | In small enumerable endings, group histories by our actual observations and require one action per information set. Compare its Bayes value against fixed rollouts and per-world solving on held-out states; then test match strength and latency. Expand only if this settles a real gap. |

For full-match comparisons, predeclare one primary opponent/configuration and loss metric, use independent per-match deal and search streams, pair results by match seed, rotate seats, and report a confidence interval on the **paired loss difference**. For reference, around 22% loss, 30,000 independent matches per arm give an unpaired 95% difference interval with roughly a 0.66-point half-width; smaller gains need more data or effective pairing. Do not treat overlapping decisions as independent trials.

### What a richer heuristic should represent

At fixed hand size and score context, `scoreCandidate` assigns the same per-class reward regardless of the remaining hand's composition. It sees `view.hand` essentially through total size. It cannot express the difference between spending the only low anchor and spending a redundant low card, preserving a pair to meet a wide target, or changing a plan based on which opponent will lead next. Opponents' scores are reduced to their maximum, so swapping their scores preserves the heuristic's appetite despite different turn-order consequences.

Useful features concern the **remaining** hand: its minimum and multiplicity, HIGH count relative to cards/tricks left, pairs and target coverage, and expected next leader. The current score is additive in played-card counts; the eight-parameter family is not fully linear in its raw weights because gamma and pressure interact with other terms. That distinction does not remove its hand-shape blind spots.

### IS-MCTS, CFR, and cheaper alternatives

I would not start by implementing full-game CFR. A count of current hand configurations is not a complete count of information sets when public histories and memory matter. Moreover, generic three-player Cucumber permits multiple losers and is not a two-player zero-sum game; a CFR implementation should not be sold with the usual two-player zero-sum equilibrium guarantee.

Against two fixed modeled opponents, the remaining problem is a single decision-maker planning under partial observation. The smallest informative prototype is a small ending with enumerated feasible worlds, Bayesian observation updates, and shared decisions for indistinguishable histories. That gives an honest benchmark for whether information-aware planning helps. An information-set Monte Carlo tree can then approximate this, keeping history, own remembered discards, and public played cards intact. `buildSim` currently resets those fields; this is harmless for the present history-blind heuristic, but must be corrected before installing a history-aware continuation policy.

A cheaper intermediate option is a better fixed observation-respecting rollout policy, or one extra future decision layer that groups worlds by observations before choosing actions. **Taking a separate best action per world and averaging it is precisely the relaxation to avoid.**

Do not add a generic cross-world variance penalty as a “strategy-fusion fix.” It changes the objective from expected survival toward risk aversion and does not enforce information consistency. High variance can describe a good gamble for a trailing player. Uncertainty estimates are useful for allocating samples and displaying precision; they are not automatically utility penalties.

## Calibration: improve predictions and play separately

The 62-match live sample is insufficient to attribute its bucket errors to one cause. Predictions within a match share an outcome and must be clustered by match; fit/validation splitting must also occur by match. For equal-match evaluation, additionally avoid allowing long matches to dominate through more predictions.

The current code already supplies several plausible sources of error: the wrong retained-hand prior, the structurally constrained continuation value, future self-play differing from actual repeated search, opponent mismatch, and selection optimism from reporting the maximum of noisy estimates. Default strategy fusion is not an established explanation.

An out-of-sample estimate of the selected action can measure selection optimism. A monotone recalibration of the final displayed probability preserves the action ordering and therefore cannot improve play by itself. Changing the leaf values **before averaging across worlds** can change ordering, even when the leaf transformation is monotone.

Use complete simulated continuations to learn the value function, and live held-out matches to assess transfer. The existing logged outcomes do not directly observe the counterfactual outcome of every rejected action. A Brier score of 0.173 should be compared with the held-out empirical-base-rate predictor, not only the arbitrary 50% predictor with score 0.25.

## Checked and found clean

- **No hidden-card access found in the advisor path.** `informationFrom` reads our hand, public plays/counts/scores and own discard memory. `policyView` supplies only the acting seat's hand, its own remembered discards, and public state. The existing rearranged-hidden-hands test passed.
- **The oracle is not called by the advisor.** It requires an explicit diagnostic `attach(sim)` closure in its harness. It is exported through the package barrel, so it is not technically inaccessible to arbitrary callers; no reviewed advisor path attaches or invokes it.
- **`handSizes` carries counts only.** No stronger hidden information was derived from it in the reviewed path.
- **`unseenPool` does not use actual stock or opponent cards.** Own remembered discards are permitted personal knowledge under the brief's interpretation. Its clamping is an explicitly documented tolerance for inconsistent memory, not evidence of a leak.
- **The 13-class abstraction preserves the specified mechanical actions and payoffs.** 7 and Joker share strength, score, instant-loss status, and lead group. HIGH supply is six, and draws weight class multiplicities rather than treating 13 classes as equiprobable. The constrained-sampler defects are separate from this abstraction. An identity-sensitive human signaling convention would require separate modeling; none is present here.
- **Terminal settlement matches the specified instant-loss precedence and tied-highest rule.** The faulty multiple-loser assumption is confined to nonterminal continuation values.
- **The order-statistic failure disjunction is valid.** Its probabilistic sampling and history compression are the problems.
- **Common worlds across root candidates are implemented correctly.** This reduces comparison noise.
- **The default heuristic rollouts are observation-respecting.** The optional per-world solver has different information assumptions.
- **The solver's memo key is adequate for the present fixed, history-blind heuristic within one call**, where cumulative scores are fixed. Arbitrary future history-sensitive policies would require revisiting that claim.
- **All 42 existing strategy/runtime checks passed.** These tests do not cover most of the defects above.

## What remains unestablished

I did not run a full match-strength comparison of any proposed improvement, retrain weights, reproduce the historical multi-million-match campaigns, access the live calibration database, or derive a best-response/equilibrium bound. I did not measure the 400-response cap's match impact, natural solver-budget exhaustion frequency, or the corrected sampler's runtime.

The exchange advisor's stand-pat assumption and restricted discard shortlist remain approximations (`advise.ts:172–220,223–256`). Exchange size and acceptance are not optimized by `advise`, which returns no advice for those prompts. I found no new execution failure in that path; a full exchange-policy study is separate from the trick-play evidence above.

The first useful milestone is a benchmark-consistent advisor with correct constrained sampling, a retention-aware prior, and a continuation model that can represent the actual stopping rule. Until those experiments are done, “at its ceiling” is an assertion the evidence does not support.

## Reproduction appendix

The following scripts only import the existing source and run diagnostics. Save each block under its indicated filename in a temporary directory and run it with Node 22 or newer with type stripping enabled. They use absolute imports for this checkout; replace `/Users/darrincecil/projects/cucumber` if reproducing elsewhere. They do not modify project source or save gameplay data.

The existing suite was run with `node node_modules/vitest/vitest.mjs run --config /tmp/cucumber-review-vitest.mjs` and this temporary configuration:

```js
export default {
  root: '/Users/darrincecil/projects/cucumber',
  cacheDir: '/tmp/cucumber-review-vite-cache',
  test: {
    environment: 'node',
    include: ['tests/strategy/**/*.test.ts', 'tests/rules/runtime.test.ts'],
    testTimeout: 30000,
    fileParallelism: false,
    pool: 'forks'
  }
}
```

### cucumber-review-play.mjs

```js
import { emptyCounts, countsOf, describeCounts, totalOf, fullDeckCounts } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/classes.ts';
import { newSim, candidatesFor, policyView, cloneSim, commit, playOut, finalClasses } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/sim.ts';
import { TUNED, heuristicPolicy, scoreCandidate } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/heuristic.ts';
import { heuristicPlayer, playMatch, playHand } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/selfPlay.ts';
import { settleHand, handValue, survivalValue } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/outcome.ts';
import { searchActions } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/search.ts';
import { sampleFullWorld } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/determinize.ts';
import { xorshift } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/random.ts';
const hp=heuristicPolicy(TUNED), policies=[hp,hp,hp];
const sim=newSim([countsOf(['AC','7C']),countsOf(['2D','3D']),countsOf(['4H','5H'])],[0,19,18],0);
const cs=candidatesFor(sim,0);
console.log('ACE_HIGH',JSON.stringify({chosen:describeCounts(cs[hp(policyView(sim,0),cs)].counts),actions:cs.map(c=>{const t=cloneSim(sim);commit(t,0,c);playOut(t,policies);return {play:describeCounts(c.counts),score:scoreCandidate(c,policyView(sim,0),TUNED),outcome:settleHand(t.scores,finalClasses(t))};})}));
// A valid-count late position: 33 cards played, 3 own discards, 2 in each live hand, 12 dead unseen.
const hand=countsOf(['2C','2D']),pool=emptyCounts();pool[4]=4;pool[5]=4;pool[6]=4;pool[12]=4;
const mine=countsOf(['KC','KD','KH']),played=fullDeckCounts();for(let c=0;c<13;c++)played[c]-=hand[c]+mine[c]+pool[c];
const info={seat:0,hand,played,mine,handSizes:[2,2,2],scores:[0,0,0],failures:[[],[[12,12]],[]]};
const rng=xorshift(919191);let h=0;for(let i=0;i<100000;i++)h+=sampleFullWorld(info,rng).hands[1][12]>0;
console.log('PAIR_BIAS_VALID_COUNTS',{n:100000,high:h,uniform:48/114,implementation:0.225});
// Distribution of candidate counts under actual tuned self-play, with exchanges enabled.
const p=heuristicPlayer('tuned',TUNED),hist={},shortlist=[];let decisions=0,cap10=0,cap14=0,max=0,aceHigh=0;
const observe=(view,candidates)=>{decisions++;hist[candidates.length]=(hist[candidates.length]||0)+1;cap10+=candidates.length>10;cap14+=candidates.length>14;max=Math.max(max,candidates.length);if(totalOf(view.hand)===2&&view.hand[11]===1&&view.hand[12]===1)aceHigh++;if(candidates.length>14&&shortlist.length<20)shortlist.push({info:{seat:view.seat,hand:view.hand.slice(),played:view.played.slice(),mine:view.mine.slice(),handSizes:[...view.handSizes],scores:[...view.scores],failures:structuredClone(view.failures)},trick:{leaderSeat:view.leaderSeat,successfulSeat:view.successfulSeat,target:[...view.target],playsMade:view.playsMade}});return hp(view,candidates);};
const observed={...p,policy:observe};const r=xorshift(12092026);let losses=0;
for(let i=0;i<10000;i++)losses+=playMatch([observed,observed,observed],r).losers.length;
console.log('BRANCHING',{matches:10000,decisions,cap10,cap14,max,aceHigh,losses,hist});
for(let i=0;i<shortlist.length;i++){const {info,trick}=shortlist[i];const all=searchActions(info,trick,xorshift(555+i),{worlds:512,maxActions:10000});const ranked=[...all.actions].sort((a,b)=>scoreCandidate(b.candidate,info,TUNED)-scoreCandidate(a.candidate,info,TUNED));const top14=new Set(ranked.slice(0,14).map(a=>describeCounts(a.candidate.counts)));const bestTrim=all.actions.find(a=>top14.has(describeCounts(a.candidate.counts)));if(all.best-bestTrim.value>0.001)console.log('TRIM_REGRET',JSON.stringify({index:i,info:{...info,hand:[...info.hand],played:[...info.played],mine:[...info.mine]},trick,n:all.actions.length,best:describeCounts(all.actions[0].candidate.counts),bestValue:all.best,trim:describeCounts(bestTrim.candidate.counts),trimValue:bestTrim.value}));}
```

### cucumber-review-confirm.mjs

```js
import { emptyCounts, fullDeckCounts, describeCounts } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/classes.ts';
import { newSim, candidatesFor, cloneSim, commit, playOut, finalClasses } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/sim.ts';
import { TUNED, heuristicPolicy, scoreCandidate } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/heuristic.ts';
import { heuristicPlayer, playHand } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/selfPlay.ts';
import { settleHand, handValue, survivalValue } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/outcome.ts';
import { sampleFullWorld } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/determinize.ts';
import { canMeet } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/rules.ts';
import { xorshift } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/random.ts';
const hp=heuristicPolicy(TUNED),policies=[hp,hp,hp], n=20000;
const info={seat:1,hand:Int8Array.from([1,1,1,0,1,0,0,0,2,1,1,0,2]),played:Int8Array.from([0,0,0,0,3,0,0,4,1,1,0,3,0]),mine:Int8Array.from([0,0,0,2,0,0,1,0,0,0,0,0,0]),handSizes:[7,10,10],scores:[15,20,19],failures:[[],[],[]]};
const trick={leaderSeat:0,successfulSeat:0,target:[4,4,4],playsMade:1};
function base(hands){const s=newSim(hands,[...info.scores],trick.leaderSeat);Object.assign(s,trick,{actionSeat:info.seat});return s;}
const actions=candidatesFor(base([info.hand,info.hand,info.hand]),1),ranked=[...actions].sort((a,b)=>scoreCandidate(b,info,TUNED)-scoreCandidate(a,info,TUNED));
const selected=actions.findIndex(a=>a.counts[12]===2&&a.counts[4]===1);
const sums=actions.map(()=>0),diffs=actions.map(()=>({sum:0,sq:0})),rng=xorshift(84726133);
for(let k=0;k<n;k++){const s=base(sampleFullWorld(info,rng).hands),v=actions.map(a=>{const t=cloneSim(s);commit(t,1,a);playOut(t,policies);return handValue(settleHand(t.scores,finalClasses(t)),1);});v.forEach((x,i)=>{sums[i]+=x;const d=v[selected]-x;diffs[i].sum+=d;diffs[i].sq+=d*d;});}
const trimIndices=ranked.slice(0,14).map(a=>actions.indexOf(a));const bestTrim=trimIndices.reduce((a,b)=>sums[a]>sums[b]?a:b);const d=diffs[bestTrim],mean=d.sum/n,se=Math.sqrt((d.sq/n-mean*mean)/(n-1));
console.log('CONFIRM_TRIM',JSON.stringify({n,seed:84726133,actions:actions.length,best:describeCounts(actions[selected].counts),heuristicRank:ranked.indexOf(actions[selected])+1,value:sums[selected]/n,trim:describeCounts(actions[bestTrim].counts),trimValue:sums[bestTrim]/n,gain:mean,ci95:[mean-1.96*se,mean+1.96*se],all:actions.map((a,i)=>({action:describeCounts(a.counts),value:sums[i]/n}))}));
const p=heuristicPlayer('tuned',TUNED),players=[p,p,p],runs=30000;
for(const start of [[2,5,8],[12,15,18],[19,19,19]]){const losses=[0,0,0];let multi=0;for(let m=0;m<runs;m++){const r=xorshift(291827+m*101),dealer=m%3;let scores=[...start],deal=dealer;for(let j=0;j<11;j++){const o=playHand(players,scores,deal,r).outcome;if(o.matchOver){for(const l of o.losers)losses[l]++;multi+=o.losers.length>1;break;}scores=o.scores;deal=(deal+1)%3;}}console.log('CONTINUATION',{start,n:runs,predicted:[0,1,2].map(s=>survivalValue(start,s)),observed:losses.map(x=>1-x/runs),ci95half:losses.map(x=>1.96*Math.sqrt(x/runs*(1-x/runs)/runs)),multi});}
const hand=emptyCounts();hand[1]=3;const mine=emptyCounts();mine[2]=3;const pool=Int8Array.from([2,0,0,0,0,0,0,0,2,4,4,4,2]);const played=fullDeckCounts();for(let c=0;c<13;c++)played[c]-=hand[c]+mine[c]+pool[c];
const f={seat:0,hand,played,mine,handSizes:[3,3,3],scores:[0,0,0],failures:[[],[[8,8]],[]]},r=xorshift(181818);let violates=0;for(let k=0;k<100000;k++)violates+=canMeet(sampleFullWorld(f,r).hands[1],[8,8]);console.log('FALLBACK',{n:100000,violates,hand:[...hand],mine:[...mine],played:[...played],pool:[...pool]});
```

### cucumber-review-exchange.mjs

```js
import { TUNED } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/heuristic.ts';
import { heuristicPlayer, playHand } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/selfPlay.ts';
import { fullDeckCounts } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/classes.ts';
import { xorshift } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/random.ts';
const p=heuristicPlayer('tuned',TUNED),r=xorshift(775577),n=30000,sums=Array.from({length:13},()=>({actual:0,pred:0,diff:0,sq:0}));
for(let i=0;i<n;i++)playHand([p,p,p],[0,0,0],i%3,r,s=>{const pool=fullDeckCounts();for(let c=0;c<13;c++){pool[c]-=s.hands[0][c]+s.seen[0][c];const actual=(s.hands[1][c]+s.hands[2][c])/2,pred=13*pool[c]/38,d=actual-pred;const q=sums[c];q.actual+=actual;q.pred+=pred;q.diff+=d;q.sq+=d*d;}});
console.log('EXCHANGE_PRIOR',JSON.stringify({n,classes:sums.map((q,c)=>({c,actual:q.actual/n,pred:q.pred/n,diff:q.diff/n,ci95half:1.96*Math.sqrt((q.sq/n-(q.diff/n)**2)/(n-1))}))}));
```

### cucumber-review-caps-budget.mjs

```js
import { emptyCounts, fullDeckCounts, countsOf, spread, totalOf, describeCounts } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/classes.ts';
import { sampleFullWorld } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/determinize.ts';
import { survivalValue } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/outcome.ts';
import { xorshift } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/random.ts';
import { qualifyingPlays, canMeet } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/rules.ts';
import { newSim, candidatesFor } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/sim.ts';
import { solveChoices } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/endgame.ts';
import { TUNED, heuristicPolicy } from '/Users/darrincecil/projects/cucumber/packages/strategy/src/heuristic.ts';
const C = (...cards) => {const h=emptyCounts();for(const c of cards)h[c]++;return h;};
console.log('TRANSLATION', [0,5,10].map(k => [k,...[0,1,2].map(s=>survivalValue([2+k,5+k,8+k],s))]));
const wide=C(1,2,3,4,5,6,7,8,9,10,11,12,12), target=[0,0,0,0];
const capped=qualifyingPlays(wide,target),all=qualifyingPlays(wide,target,100000);
console.log('ENUMERATION_CAP',{capped:capped.length,all:all.length,first:describeCounts(capped[0]),last:describeCounts(capped.at(-1)),omitted:describeCounts(all.at(-1))});
const sim=newSim([countsOf(['2C','3C','7C']),countsOf(['4D','5D','6D']),countsOf(['8H','9H','10H'])],[0,0,0],0);
const actions=candidatesFor(sim,0), opts={opponents:{kind:'model',seat:0,policy:heuristicPolicy(TUNED)}};
console.log('BUDGET',JSON.stringify({actions:actions.map(a=>describeCounts(a.counts)),zero:solveChoices(sim,0,actions,{...opts,nodeBudget:0}),full:solveChoices(sim,0,actions,opts)}));
```
