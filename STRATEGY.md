# How to play Cucumber

Everything here was found by self-play, not by opinion. The numbers are
reproducible with `pnpm self-play`; the commands are at the bottom.

## What "best" means

Cucumber does not punish points. It punishes being *the player with the most
points* once anyone reaches 21 — and it punishes, absolutely, finishing a hand
holding a 7 or a Joker. So the strategy maximises the probability of **not
being a loser**, which is a different thing from minimising your own score. A
hand where you take 10 and the leader takes 15 is a good hand.

## What the strategy is allowed to know

Only two things:

- the cards in your own hand, and the ones you personally saw and discarded;
- every card that has been played to a trick in front of all three players.

Not the stock, not anyone else's hand, not the face-down exchange discards,
not cards that were never dealt. This is enforced by shape rather than by
discipline: a policy is handed a `PolicyView` (`packages/strategy/src/sim.ts`)
that contains its own hand and the public record and *nothing else*, and the
in-game advisor runs in the browser, which has never been told the rest. The
test `tests/strategy/advisor.test.ts` deals three tables that are identical
from your chair and completely different behind the other two players, and
requires the advice to come out the same.

## The shape of the game

Suits are decorative. They affect neither trick strength nor score. And a 7
and a Joker are identical in both. So the 54 cards are really **13 equivalence
classes**, and "choose between the tied low cards" — which the rules go out of
their way to permit — is not a decision at all.

That collapse is what makes everything else possible: a full match simulates
in about 60 microseconds, so a strategy can be *searched for* rather than
argued about.

## The central tension

The rule that decides Cucumber is the forced-low rule. If you cannot meet the
current play, you must surrender your **lowest** cards — which are exactly the
cards you want to be holding at the reveal.

So high cards are not a liability to be dumped. They are the armour that stops
you being stripped of your 2s and 3s. The whole game is a negotiation between:

- **shed the points** — a 7 or Joker is 21 and an instant loss; an Ace is 15;
- **but keep the strength** — because spending it is what gets you forced low;
- **and protect the low cards** — they are your final card, and your score.

## What self-play concluded

Ten million matches of cross-entropy search, twelve worker threads, about two
minutes of wall clock. The equilibrium weights
(`packages/strategy/src/heuristic.ts`):

```
value     0.95   reward for shedding points
strength  0.96   penalty for spending trick strength, fading as the hand shortens
low       0.99   extra penalty for spending a low card you might finish on
high     -9.40   extra penalty for spending a 7 or a Joker
width    -2.31   preference for leading one card rather than several
gamma     1.24   how sharply strength stops mattering as the hand runs down
panic    -0.52   late-hand appetite for dumping a 7 or Joker
pressure -0.09   how much the score situation changes that appetite
```

**The honest headline is that ten million matches barely moved it.** The
starting point — found much earlier by plain coordinate ascent — was already
at a local optimum of this policy family. The champion beats it, consistently
and in both directions (35.6% against it, 37.6% for it against two champions),
but by about two points. The three new dimensions the bigger search was given
mostly came back as zero: `panic` and `pressure` found nothing.

The one real discovery is **gamma ≈ 1.24**: trick strength keeps mattering a
little later into a hand than a linear fade implies. You should hold your
armour slightly longer than instinct suggests.

That is a useful negative result. Further strength has to come from a richer
policy or from search — not from turning these dials.

Two of those are the opposite of the obvious play.

**Hold your 7s and Jokers — at first.** The naive instinct is to dump a 21-point
instant-loss card the moment you can. The tuner learned the reverse: a 7 is the
strongest card in the game, and while you hold one you can always meet any
target, so you are never forced to give up a low card. The penalty is constant
but the *strength* term fades as the hand shortens, so the policy hoards them
early and sheds them late. The naive "dump points immediately" player loses
**88%** of matches against this one.

**Lead narrow.** Leading several cards at once shortens the hand for everyone
equally, which spends your options without gaining anything. Leading one card
keeps the hand long and gives you more chances to shed safely.

The best moment to get rid of a 7 or a Joker is **on your own lead**, where
nobody can force you low and nothing can beat you — only equal you.

## Searching beats guessing

On top of that policy sits a perfect-information Monte Carlo search. For each
legal play it deals the unseen cards many different ways consistent with what
you know, plays each one out, and keeps the play that survives most often.
Every deal is scored against every candidate, so the *comparison* is far
steadier than the individual estimates.

Measured against two copies of the tuned heuristic, 12,000 matches per row
(parity is about 36%):

| deals imagined per decision | loss rate | matches sampled |
|---|---|---|
| 64 | 25.31% ± 0.79 | 12,000 |
| 256 | 21.89% ± 0.75 | 12,000 |
| 1024 | 21.00% ± 1.29 | 4,000 |

Thinking four times harder than 256 buys nothing measurable — the intervals
overlap. Returns have flattened, and the limit is no longer how many deals are
sampled but what the rollouts assume about the opponents.

So the in-game advisor samples 256: it is at the knee of the curve, and the
panel reports its own timing, typically 15-25ms for an early-hand decision
with a full hand of candidate plays.

## How the search itself had to be fixed twice

Worth recording, because both failures produced confident nonsense.

**Scoring against a single opponent drifts.** The first cross-entropy run
measured each candidate against the current champion alone. The champion
wandered somewhere weak, later rounds optimised against that weakness, and the
final answer lost **65%** of its matches to the player it had started from. A
candidate is now scored against a gauntlet — the incumbent, the champion
before it, and a fixed anchor — and a new champion is crowned only if it beats
the incumbent on that same gauntlet.

**Comparing two different examinations promotes nothing.** The second run then
promoted once and never again. The incumbent's score had been measured against
one gauntlet and every challenger against a different one; the bar was simply
from a different test. The incumbent now sits in the field each round and is
re-scored alongside everyone else, so the comparison is like for like.

Both bugs are the same mistake in different clothes: a number that looks like a
strength is only a strength if it came from the same measurement as the number
you are comparing it to.

## Round robin

`pnpm self-play matrix`, 60,000 matches per cell, lower is better. "previous"
is the five-parameter point the earlier coordinate ascent reached; "champion"
is what ten million matches made of it.

```
subject \ opponent        naive    previous    champion
naive                    37.13%      84.57%      85.20%
previous                  7.27%      36.61%      37.83%
champion                  6.08%      35.65%      36.48%
```

The champion is better than its predecessor in both directions — it loses
35.65% against two of them, and they lose 37.83% against two of it — and
better against the naive player too. Two points. That is what ten million
matches bought, and it is worth saying plainly rather than dressing up.

An earlier generation, from the first round of tuning, is the cautionary tale:

```
gen0 vs naive     3.38%        gen0 vs its own successors     46-48%
```

It demolishes the naive player and is *worse than parity* against its own
successors. It had learned to beat one specific opponent, not to play
Cucumber. That is why candidates are now scored against a gauntlet rather than
a single sparring partner.

## Where this is still wrong

Honest limits, not disclaimers:

- **The search assumes the opponents play the tuned heuristic.** Against a very
  different opponent its estimates are miscalibrated — although the round robin
  suggests the equilibrium policy is a reasonable stand-in for "a decent
  player".
- **Perfect-information Monte Carlo cannot value hiding.** Because every sampled
  world is played out as if all hands were face up, the search never discovers
  a play whose merit is that it *conceals* something. This is the standard
  weakness of the method.
- **The exchange advice is an approximation.** It assumes the other two players
  stand pat, and it evaluates a shortlist of discard sets rather than all of
  them. The advisor says so in the panel. The play advice has no such caveat.
- **The continuation value is a fitted guess.** When a hand ends without ending
  the match, the value of the resulting scores comes from a two-parameter
  model, grid-searched against play strength (`pnpm self-play continuation`).
  It is measurably better than a flat guess, and it is not exact.

## Speed

The harness runs on worker threads — `pnpm self-play sanity`:

```
500,000 matches in 4.6s across 12 workers
109,242 matches/second        9.2µs per match
```

About 5.7× a single core on this 14-core machine, which is what makes a
ten-million-match search a two-minute question rather than an overnight one.

## Reproducing all of it

```bash
pnpm self-play sanity                       # throughput
pnpm self-play cem --budget 10000000        # the full search above
pnpm self-play matrix                       # the round robin
pnpm self-play search --worlds 256          # search against the heuristic
pnpm vitest run tests/strategy              # correctness, including the
                                            # information-constraint test
```

## On the word "perfect"

There is no perfect strategy for Cucumber in the sense that there is one for
noughts and crosses. It is a game of imperfect information with three players,
so "perfect" would mean an equilibrium over a game tree that cannot be walked.
What is here instead, and what the numbers above actually support:

- a policy family searched to convergence, verified against its own history so
  it has not merely learned one opponent;
- a search on top of it that is measurably stronger than the policy alone;
- and every claim attached to a sample size and an error bar.
