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

- **It plays with its cards face up.** Each imagined deal is played as though all
  hands were visible, which assumes you can act differently in worlds you cannot
  tell apart. It can never value concealment. This is why solving each imagined deal
  exactly made play measurably *worse*.
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
