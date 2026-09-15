# The advisor, and keeping score of it

How the advisor decides what to play, why its percentages are the number they are,
and how the table checks whether it was telling the truth.

A designed version of this document is published as an artifact; this is the copy
that lives with the code.

## The question it answers

The advisor is not trying to win tricks and it is not trying to score few points.
Cucumber punishes exactly one player — whoever has the most points once anybody
reaches 21, and absolutely anyone left holding a 7 or a Joker at the reveal. So
every number it shows answers one question:

> What is the probability that I am **not** a loser of this match?

That is why a hand where you take ten points and the leader takes fifteen is a good
hand, and why the advisor will sometimes recommend a play that costs you points.

## What it is allowed to know

Two things:

- the cards in your own hand, and the ones you personally saw and discarded;
- every card played to a trick in front of all three players.

Not the stock, not another hand, not the face-down exchange discards, not cards that
were never dealt. This is enforced by *where the code runs*: the advisor executes in
a Web Worker in your browser, and the browser is only ever sent your own sanitised
view. The hidden cards live on the server and never travel. A test makes the point
from the other side — three deals identical from your chair but different behind the
other two players must produce identical advice.

## Why the deck is only thirteen cards

Suits affect neither trick strength nor score, and a 7 and a Joker are identical on
both. So the 54 cards collapse to **13 equivalence classes**, losslessly.

| counting | distinct 13-card hands |
|---|---|
| all 54 cards distinct | 1,108,176,102,180 |
| suits ignored | 6,766,150 |
| suits ignored, 7 = Joker | **3,700,282** |

A hand becomes thirteen small integers and a whole match simulates in about 9µs.
That budget is why the advisor can imagine hundreds of deals before every move.

## How it decides

Perfect-information Monte Carlo:

1. **Enumerate every legal play.** When you cannot meet the target there is exactly
   one, and the panel says so.
2. **Trim to fourteen**, ranked by the fast heuristic. A real limitation — see below.
3. **Imagine 256 deals**, each consistent with everything you know, including what
   the others have publicly failed to do.
4. **Play every candidate in every deal.** The same deals are used for all
   candidates, so the comparison rests on identical hands.
5. **Value the ending.** One or zero if the match ends; otherwise a two-parameter
   model of how dangerous the resulting scores are.
6. **Rank and show.** First is *Play*; the next three are *Else*, with what each
   costs. "Else" is simply second, third and fourth — nothing else distinguishes it.

15–25ms, off the main thread, re-run whenever the position changes.

## Where its instincts came from

Inside each imagined deal the play is carried to the end by a weighted score over
eight features, searched for over ~16 million matches of self-play:

| weight | value | what it trades |
|---|---|---|
| value | 0.95 | reward for shedding points |
| strength | 0.96 | penalty for spending trick strength |
| low | 0.99 | penalty for spending a low card you might finish on |
| **high** | **−9.40** | reluctance to part with a 7 or Joker |
| width | −2.31 | preference for leading one card, not several |
| gamma | 1.24 | how sharply strength stops mattering |
| panic | −0.52 | late appetite for dumping the top cards |
| pressure | −0.09 | how much the score situation changes that |

The negative `high` is the surprise: the policy is *reluctant* to play a 7 or Joker.
The forced-low rule is why — if you cannot meet a play you surrender your *lowest*
cards, which are the ones you want at the reveal. High cards are the armour that
stops you being stripped. The moment to let a 7 go is on your own lead.

## Keeping score

Every claim the advisor makes is recorded against the position it was made in, and
settled when the match it was about finishes — did you survive it or not.

The panel shows:

- **Two headline numbers** — average claim, and the share that survived. The second
  turns amber past an eight-point drift.
- **A chart over time** — both numbers as they stood after each match, cumulative.
  Cumulative on purpose: one match is a single outcome shared by all its claims.
- **A Brier score** — mean squared distance between claim and outcome. Zero is
  perfect, 0.25 is what you score by always saying 50%. It punishes confident
  mistakes much harder than hedged ones.
- **Bands** — predictions grouped by what was claimed against what happened.

**Read the sample size carefully.** The number that matters is *matches*, not
predictions: every claim inside one match shares that match's single outcome.
Autoplay exists for this — left running it plays every prompt and starts the next
match itself, so the sample grows while you do something else.

## The first reading

Twelve matches, which is twelve independent outcomes and nowhere near enough:

| it said | actually survived | predictions |
|---|---|---|
| 8% | 0% | 23 |
| 28% | 0% | 18 |
| 51% | 31% | 26 |
| 71% | 60% | 75 |
| 93% | 97% | 112 |

Overall claimed 70%, survived 64%, Brier 0.116. The bands rise together, which is
the first thing you want, and the confident end behaves best. The middle sags — 71%
delivered 60%, 51% delivered 31%. If that holds over hundreds of matches it is mild
overconfidence in the uncertain middle, which is exactly what the method's known
weakness predicts.

## How it could be wrong

- **It cannot value concealment.** The rollout policies do not reason about
  information at all, so nothing it imagines rewards keeping a card hidden. This is
  why solving each imagined deal exactly made play measurably *worse*.

  *Corrected 2026-09-15.* This bullet used to say the advisor "plays with its cards
  face up", each deal played "as though all hands were visible". That is wrong about
  the mechanism, and an outside review caught it. `searchActions` rolls out with
  `heuristicPolicy`, which receives a per-seat `PolicyView` and has no access to
  hidden hands; the perfect-information path is `solveChoices`, gated on
  `solveFrom > 0`, off by default. The weakness is real, its description was not —
  and the wrong version was repeated in `oracle-honest.ts`, `search.ts` and
  `FLOOR-BRIEF.md` before anyone checked it against the code.
- **Its beliefs about the unseen cards ignore the exchange.** `sampleFullWorld`
  draws opponents' hands uniformly from the cards it cannot see. Players who
  exchange throw their *worst* cards away face down, so that pool is systematically
  weak and the hands they kept are systematically strong; drawing uniformly hands
  them worse cards than they hold, and the advisor is flattered. Measured at **8.2
  points of survival** — see below. A generative prior fixes it and is currently
  wired into the measurement only, not into the advisor.
- **It assumes the others play like it does.** Against a human who reasons about
  what your plays reveal, its estimates are miscalibrated in a direction no amount
  of self-play can detect.
- **The weaker judge guards the door.** The trim to fourteen happens *before* the
  search, using the heuristic. A play it dislikes can never reach the panel.
- **Small gaps are noise.** An alternative at −0% or −1% is not reliably worse.
- **The continuation value is a fitted guess.** Two numbers grid-searched against
  play strength; the least-measured component, consulted on nearly every evaluation.

## What is already measured

One seat against two plain heuristics. Parity is about 36%; lower is better.

| player | loses | sample |
|---|---|---|
| heuristic, no search | 36.90% ± 0.56 | 30,000 |
| **the advisor, 256 deals** | **22.22% ± 1.07** | 6,000 |
| shown every hand (a cheat) | 0.34% ± 0.07 | 30,000 |

The last row measures the value of *knowing*, not of *guessing better* — almost all
of that gap is irreducible. At a trick boundary there are ~9.2 × 10²⁰ distinct
positions but only ~2.5 × 10¹² a player can tell apart: about **365 million true
positions behind every one thing you can perceive**.

## How honest are its odds?

Loss rate says whether it plays well. This says whether "84%" means 84% — a
different axis, and the one with room left in it.

No forecaster can score better than the uncertainty that survives conditioning on
everything a player may legally see. For `p* = P(survive | what this seat can
see)`, the best possible Brier score is `E[p*(1 − p*)]`. That is not zero here:
this document counts ~365 million true positions behind every distinguishable
one. It has now been measured.

**Against two tuned heuristics, exchange 3, 400 matches and 7,154 positions:**

| | |
|---|---|
| the floor, `E[p*(1−p*)]` | **0.1667** |
| the advisor | **0.2074 ± 0.0217** |
| headroom | **0.0407** |

Decomposed (`Brier = uncertainty − resolution + reliability`), against the best
possible forecaster over the same positions:

| | advisor | best possible |
|---|---|---|
| uncertainty | 0.2354 | 0.2354 |
| − resolution | 0.0411 | 0.0535 |
| + reliability | **0.0199** | **0.0016** |

**Roughly half the gap is honesty, not skill.** Its resolution is already close to
the ceiling: it *orders* positions nearly as well as anything could. What it does
is state the wrong numbers about positions it has ranked correctly — claiming
0.752 where 0.621 survived.

### How the floor was measured, and how it could still be wrong

`p*` is estimated by `honestSurvival`: sample worlds consistent with the seat's
information, play each out with policies that see only their own hand, and
continue to the end of the *match* rather than stopping at the hand boundary — no
fitted continuation value, so the floor does not inherit the least-measured
component in the advisor.

Two estimators are computed, biased in **opposite** directions by the oracle's own
sampling variance `v = p(1−p)/K`: a direct one (`mean p̂(1−p̂)`, add `v` back) and
a scored one (Brier of `p̂` against outcomes, subtract `v`). They approach the
answer from either side, and disagreement beyond their bands means the instrument
is broken rather than the answer being interesting. Here they differ by 0.0117
inside a band of 0.0152.

The gate that matters: `p*` is calibrated **by construction** if it really is
`p*`, so its own reliability must be ~0. It measures **0.0016** against a gate of
0.005. Before the exchange prior it measured 0.0102 and no floor was reported.

**What this number is not.** It is the floor for *three tuned heuristics at
exchange 3*, and nothing else. The uncertainty term alone moves with the field —
0.2354 here against 0.238 in the browser's live sample of three advisors — so it
does not transfer to your table. Opponent field decides these numbers, which is
worth stating twice: an earlier comparison of live play against this document's
heuristic benchmark produced three confident "discrepancies" that were one
category error counted three times.

**Bands are over matches, never over positions.** Every claim inside one match
shares that match's single outcome, so an interval over the 7,154 positions would
be several times too narrow and ordinary luck would read as a real change.

### The evidence that the exchange prior was the cause

A control with the prediction written down first. The sampler's uniform draw is
correct when nobody exchanges, so the bias must vanish in that arm and persist in
the other — and if both were biased, the hypothesis was dead. 1,500 matches per
arm:

| | exchange 3 | exchange 0 |
|---|---|---|
| oracle claimed | 0.7133 | 0.6445 |
| actually survived | 0.6317 | 0.6344 |
| gap | +0.0816, **6.5σ** | +0.0101, **0.8σ** |
| reliability | 0.0071 | **0.0005** |

Same code, same rollouts, everything but the exchange. With the generative prior
added, the exchange-3 arm becomes +0.0262 at 1.1σ, reliability 0.0015.

An earlier run of this same control at n=400 gave −4.7 points in the exchange-0
arm and was read as a refutation. At n=1500 that arm is +1.0 points. The design
was right; the sample was a third of what the effect needed.

Reproduce:

```bash
node --experimental-strip-types tools/exchange-control.ts 1500 150
node --experimental-strip-types tools/floor.ts 400 200
```

## Things that turned out not to help

| attempt | result |
|---|---|
| Ten million matches of weight search | ≈2 points; already at a local optimum |
| Reasoning about what players reveal | 0.18 points — inside the noise |
| Solving the endgame exactly | nothing at 4–6 cards, *worse* at 8 |
| Four times the imagined deals | 21.00% vs 21.89% — intervals overlap |
| Five million matches hunting a counter-strategy | the best it found was the strategy itself |

Five consecutive negative results is not five failures. It is the shape of a ceiling.

## Reproducing

```bash
pnpm self-play          # the measurements
pnpm record             # watch the table play itself
pnpm vitest run tests/strategy
```
