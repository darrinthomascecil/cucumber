# Review brief: how Cucumber's advisor chooses what to play

You are reviewing a card-playing algorithm written by another AI. The author
believes it is close to the ceiling of what its design can reach. **Your job is
to find out whether that belief is justified, and to find the improvements the
author missed.**

Be adversarial. The author has already convinced themselves; that is the
failure mode you are here to correct. Prefer "here is the specific line that is
wrong and here is the experiment that proves it" over "you might consider".

---

## 0. Where to look

The repository is a pnpm monorepo. **Everything under review is in
`packages/strategy/src/`** — about 1,500 lines total. Nothing in `apps/`
matters for this review.

### Read these four functions, in this order

Everything else is scaffolding around them.

**1. `search.ts:91` — `searchActions`**
The algorithm itself. ~70 lines, and the entire play-selection decision happens
inside it. Three lines deserve direct attack:

- **`search.ts:108`** — candidates are trimmed to 14 by heuristic score
  *before* any search runs. Anything discarded here can never be recovered.
- **`search.ts:135`** — `sampleWorld` inside the world loop. This is the
  determinization, and therefore the source of strategy fusion (§5).
- **`search.ts:145`** — `playOut(sim, policies)`, where all three seats run the
  *same* heuristic. The self-referential opponent model lives on this line.

**2. `outcome.ts:60` — `survivalValue`**
The objective being maximised. 18 lines, resting on two hand-fitted constants
at `outcome.ts:55` (`temperature: 6.5, headroom: 0.35`). It is consulted at the
end of nearly every playout, so it sits underneath every decision the advisor
makes — and the live calibration data in §5 says it is miscalibrated. Probably
the highest value-per-line in the codebase for a reviewer.

**3. `heuristic.ts:87` — `scoreCandidate`**
The policy driving every playout, linear in 8 features. The structural question
is what a linear combination of those 8 terms *cannot* represent. Tuned weights
at `heuristic.ts:58`, including the negative `high: -9.402` (hoard your 7s and
Jokers) that the author believes is correct and wants challenged.

**4. `determinize.ts:52` — `unseenPool`, then `:170` — `sampleFullWorld`**
Where the user's hard information constraint (§2) is enforced. `unseenPool` is
9 lines and trivially auditable. `sampleFullWorld` is the harder read — it
enforces public-failure constraints by construction rather than by rejection,
and that is where a subtle leak would hide if one exists.

### Optional

- **`endgame.ts`** — the exact maxn solver, worth reading only if you want to
  dig into why solving *exactly* from 8 cards made play **worse** (§4). That
  regression is the most interesting anomaly in the project and the best
  evidence that something is structurally wrong rather than merely untuned.
- **`advise.ts:264`** — the entry point that wraps `searchActions`, plus the
  discard-phase logic, which is in scope but not the focus.
- **`oracle.ts`** — deserves two minutes to confirm the deliberate cheater it
  implements cannot reach the advisor (§2).

### Skip

`sim.ts`, `rules.ts`, `classes.ts` (game mechanics — well tested, assume
correct), `archetypes.ts`, `selfPlay.ts` (harnesses).

### Author's own documents

`STRATEGY.md` (what was tried and measured) and `ADVISOR.md` (how it is
explained to the user). Treat both as **claims to audit, not as established
fact** — they are the case for the defence, written by the defendant.

---

## 1. The game, precisely

Three players, 54 cards (standard deck plus two jokers). You must understand
these rules or you cannot evaluate the strategy.

**Card values.** Suits are irrelevant to everything — trick strength and score
alike. Trick strength ascends `2 3 4 5 6 8 9 10 J Q K A`, and **7 and Joker are
the strongest, tied with each other**. Note there is no 7 in the normal
ascending order: it jumps to the top.

**Scoring — this is the unusual part.** At the end of a hand, every player has
exactly one card left. That card's value is added to their cumulative score:

| Card | 2 | 3 | 4 | 5 | 6 | 8 | 9 | 10 | J | Q | K | A | 7 or Joker |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Points | 2 | 3 | 4 | 5 | 6 | 8 | 9 | 10 | 10 | 10 | 10 | 15 | **21** |

**You want a LOW score.** A player at or above **21** loses the match, and
**only the highest scorer loses** — ties at the top lose together. Finishing a
hand holding a 7 or Joker is an **instant loss**, regardless of score.

So the goal is to end each hand holding your *lowest* card, while shedding your
dangerous ones earlier.

**Trick play.** The leader plays any number of cards of one single rank (7 and
Joker count as the same rank), but **never their whole hand**. That multiset is
the *target*. Play proceeds left.

A follower must play **exactly as many cards** as the target. To *meet* the
target: sort both multisets ascending and compare position by position — every
one of your cards must be ≥ the target's card at the same position. If you can
meet it you **must**, and you choose which qualifying multiset to play; your
play becomes the new target and you become the successful player. If you
**cannot** meet it — meaning your entire hand cannot — you are forced to play
your *lowest* n cards, and this failure is **public**.

After three plays the trick ends and the last successful player leads the next
one. The hand ends when all three players hold exactly one card, which is then
revealed and scored.

**Exchange phase.** Before trick play there is a discard/exchange step
(`advise.ts` handles it). It is in scope but is **not** the focus of this review.

The rules encoding lives in `rules.ts`; `tests/rules/` verifies it against the
original spec. **Assume the rules are correct** — they are well tested. Review
the *strategy*, not the rules engine. If you do find a rules bug, that is a
critical finding, but do not spend your budget hunting for one.

---

## 2. The hard constraint you must verify

The user's requirement, stated verbatim:

> "your strategy has to be limited to cards you have in your hand, or cards
> that everyone has seen discarded. you cannot have knowledge of other players
> cards they havent played yet, or cards that were nevver dealt into the game."

Clarified by the user as: **public = cards that have already been played.**

This is non-negotiable. A strategy improvement that leaks hidden information is
not an improvement, it is a bug.

**Please independently verify the boundary holds.** The author's argument is
structural: `PolicyView` (`sim.ts`) physically does not contain other seats'
hands, and `unseenPool` (`determinize.ts`) is built by subtracting your hand,
the played pile, and your own discards from a full deck. `tests/strategy/`
contains an information-constraint test.

Specific things worth attacking:

- Does any code path reach a real hand rather than a sampled one? Check
  `oracle.ts` carefully — it is a **deliberate cheater** used only as a
  diagnostic upper bound. Confirm it cannot reach the advisor.
- `sampleFullWorld` enforces the public-failure constraint *by construction*
  via `CountLimit`/`drawWithin`. Is the constraint implemented correctly, and
  does it encode only genuinely public facts?
- Does `handSizes` leak anything it shouldn't? (It is public — everyone can
  count cards — but confirm nothing stronger is derived from it.)

---

## 3. The algorithm under review

Given a position where it is your turn, `searchActions` (`search.ts`) does:

1. **Enumerate legal plays.** A "play" is a multiset of cards, not a single
   card. Cards are collapsed to 13 equivalence classes first (`classes.ts`),
   since suits never matter and 7 ≡ Joker.
2. **Trim to 14 candidates** by `scoreCandidate` from `heuristic.ts`, *before*
   any search.
3. **Sample 160 worlds** — deal the unseen pool into the other two seats,
   consistent with public knowledge (`determinize.ts`).
4. **Evaluate every candidate against every world** (common random numbers).
   Each is played to the end of the hand with the tuned heuristic driving all
   three seats. If hands are short enough and `solveFrom` is set, the world is
   instead solved exactly by maxn backward induction (`endgame.ts`).
5. **Average and rank.** Value = mean over worlds. Highest wins; the rest are
   shown to the user with `cost = best − value`.

This is textbook **PIMC** (perfect-information Monte Carlo). There is no tree
search, no UCT, no backpropagation, no adaptive sampling.

**The objective** (`outcome.ts::handValue`) is *probability of not losing the
match*, not points. A terminal hand scores 1 if you survive and 0 if you are a
loser. If the match is not over, `survivalValue` maps the three cumulative
scores to a survival probability through a logistic on your lead over the
field and your headroom to 21, with hand-fitted constants
`temperature: 6.5, headroom: 0.35`.

**The heuristic** is 8 weights, found by cross-entropy self-play, currently:

```ts
value: 0.952, strength: 0.961, low: 0.985, high: -9.402,
width: -2.309, gamma: 1.244, panic: -0.52, pressure: -0.089
```

Note `high` is strongly **negative**: the policy is *reluctant* to play a 7 or
Joker, treating it as armour (it beats everything, so it can always meet a
target) rather than as the liability it becomes at the reveal. The author finds
this surprising but correct. **Test that belief.**

---

## 4. What has already been measured — do not re-propose these

The author ran these. Re-deriving them wastes your budget. **Challenging the
methodology behind them is fair game and possibly valuable.**

| Experiment | Result | Author's conclusion |
|---|---|---|
| Worlds 64 → 256 → 1024 | 25.31% → 21.89% ±0.75 → 21.00% ±1.29 loss | More sampling steadies the estimate; it does not make it smarter. |
| Public-failure inference on vs off | **+0.18 points over 80,000 matches** | Worthless. |
| Endgame exact solving from 4 / 6 / 8 cards | 21.95% / 21.96% / **23.01%** vs 22.06% baseline | Solving deeper made it **worse**. Attributed to strategy fusion. |
| CEM weight search, 10M matches | ~2 points, converged | The 8-weight family is exhausted. |
| Exploit probe, 4.95M matches | Best counter-strategy found was the champion itself | No exploitable hole within this family. |
| Oracle (sees all hands) vs honest search vs bare heuristic | **0.34% ±0.07** / **22.22% ±1.07** / **36.90% ±0.56** loss | Search captures most of the legally-available gain. |
| Advisor v1 vs v2 head-to-head | 21.18% ±0.65 vs 21.59% ±0.65 | No real improvement. |

The author's headline claim, which is the **central thing for you to accept or
refute**:

> The gap between the oracle (0.34%) and the honest search (22.22%) measures
> the value of *knowing* the hidden cards, which no legal advisor can ever
> collect. The recoverable gap is 36.90% → 22.22%, and search already takes it.
> Therefore the design is at its ceiling.

Is that reasoning sound? It smells convenient. A PIMC agent losing 22% in a
symmetric three-player game where parity is 36.4% is not obviously near any
ceiling, and "the rest is unobtainable" is exactly what a stuck optimiser would
conclude.

---

## 5. Where the author already suspects weakness

Start here, but do not stop here.

**Strategy fusion.** PIMC evaluates each determinized world as if it were
fully observable, so it implicitly assumes it can play differently in worlds it
cannot actually distinguish. This overvalues plays whose payoff depends on
information it will not have. The from-8 endgame regression is the author's
evidence that this is real and load-bearing. Known fixes are information-set
methods — IS-MCTS over information sets, or CFR over an abstracted game — and
**neither has been tried**. Is that the right next step, or is there something
cheaper that captures most of it?

**Non-locality.** The dual defect: PIMC cannot reason about *hiding*
information from opponents, because its imagined opponents already know
everything. In a game where public failures are the main signal, is there value
in play that manages what you reveal? The inference result (+0.18) suggests the
signal is weak, but that measures *consuming* the signal, not *controlling* it.

**Opponent model is self-referential.** All playouts assume the other two seats
follow the same tuned heuristic. The advisor is therefore optimised against
copies of itself. The in-app opponents *are* that heuristic, so the measured
numbers are self-consistent — but is the strategy overfit to a specific
opponent, and how would it fare against a human, or against a deliberately
different archetype? See `archetypes.ts` for the rule-based opponents that do
exist.

**The 14-candidate trim happens before any search.** If the heuristic is wrong
about which plays are worth considering, the search can never recover the
discarded option. Has anyone measured the trim's cost? What is the actual
branching factor distribution — is 14 even binding, and how often?

**The continuation model is two hand-fitted constants.** `temperature: 6.5,
headroom: 0.35` converts mid-match scores into a survival probability, and it
is consulted at the end of every playout that does not finish the match — so it
sits directly in the value of almost every decision. It was chosen by grid
search against play strength, not fitted to observed outcomes. The live
calibration data (below) suggests it is miscalibrated.

**Live calibration says the advisor is overconfident.** Over ~1,300 predictions
across 62 real matches, bucketed by stated confidence:

| advisor said | actually survived | n |
|---|---|---|
| 6% | 17% | 99 |
| 29% | 27% | 41 |
| 52% | 54% | 110 |
| 72% | 63% | 370 |
| 92% | 84% | 696 |

Brier 0.173 (0.25 = always guessing 50%). The middle is well calibrated; both
ends are too extreme. **Caveat you must respect: predictions within one match
all share a single outcome, so the effective sample size is ~62 matches, not
1,300 independent trials.** Is this overconfidence a real defect in the value
function, an artifact of strategy fusion, or noise? Does fixing the calibration
actually improve *play*, or only improve the reported number? Those are
different things and the author has not separated them.

---

## 6. Questions worth answering

Ranked by the author's guess at value. Disagree with the ranking if you have
reason to.

1. Is **IS-MCTS or CFR** worth building here, or will the abstraction
   (2.5 trillion information sets) defeat it? If worth it, what is the smallest
   version that would settle the question?
2. Is the **value function** right? "Probability of not losing" is correct for
   a single match, but is `survivalValue`'s shape defensible, and should it be
   *fitted* to the logged outcomes rather than grid-searched?
3. Is the **13-class abstraction lossless**? The author asserts suits never
   matter and 7 ≡ Joker. Verify this against `rules.ts` — particularly whether
   the *number* of cards in a class (`CLASS_SUPPLY` is 6 for 7/Joker, 4 for
   everything else) breaks any assumed symmetry in sampling or in play.
4. Is the **negative `high` weight** (hoarding 7s/Jokers) genuinely optimal, or
   an artifact of self-play against opponents that share the bias? A pool where
   everyone hoards 7s is a different game from one where they do not.
5. Does the **trim to 14** cost anything measurable?
6. Is there a **cheap fix for strategy fusion** short of a full rewrite — e.g.
   averaging over information sets rather than worlds, or penalising
   plays whose value has high variance across worlds?
7. Are there **tactical patterns** a human expert would know that no weight in
   this family can express? The heuristic is linear in eight features; what
   does that structurally prevent it from representing? (Interaction terms?
   Hand-shape awareness? Anything conditioned on *who* is dangerous?)

---

## 7. How to run things

```bash
pnpm install
pnpm vitest run tests/strategy    # correctness + the information-constraint test
pnpm typecheck

pnpm self-play sanity                         # throughput check
pnpm self-play gauntlet                       # vs rule-based archetypes
pnpm self-play matrix                         # round robin among policies
pnpm self-play oracle                         # what hidden information is worth
pnpm self-play search --worlds 256 --compare  # inference on vs off
pnpm self-play endgame                        # exact solving, on and off
pnpm self-play cem --budget 100000            # weight search (use a small budget)
pnpm self-play exploit                        # hunt for a counter-strategy
```

Self-play is parallel across cores and needs no database or server. The
`tools/` scripts run under `node --experimental-strip-types`, which **rejects
TypeScript constructor parameter properties and requires `.ts` extensions on
relative imports** — this has broken the build three times; `tests/rules/runtime.test.ts`
guards it. If you add code, run that test.

**Statistical discipline.** Loss rates here have standard errors around ±0.7
points at 12,000 matches. Parity here is 36.4%, not one third — ties make
multiple losers, so seat loss rates sum to more than one. Many
plausible-looking improvements in this codebase turned out to be noise, and at
least one "improvement" (endgame solving from 8) was a real regression that
initially looked like an improvement. **Report confidence intervals, state your
match counts, and do not claim a win under 2 standard errors.**

---

## 8. What to hand back

A markdown document containing:

1. **Verdict on the ceiling claim** (§4). Is the author right that the design is
   at its limit? Say yes or no and show your reasoning.
2. **Confirmed defects** — anything actually wrong, with the file and line, a
   concrete failing scenario, and ideally a test that demonstrates it.
3. **Ranked improvements**, each with: what to change, expected gain, cost to
   build, and **the experiment that would confirm or refute it**. An
   improvement without a falsifying experiment attached is not actionable here.
4. **What you checked and found clean** — explicitly, so the next reviewer does
   not repeat it.
5. **Anything you could not evaluate** and what you would need to.

If you conclude the algorithm is sound and near its ceiling, say so plainly.
That is a useful result. But say it because you tried to break it and failed,
not because the existing document argued it well.
