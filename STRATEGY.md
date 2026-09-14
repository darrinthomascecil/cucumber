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

Five generations, each tuned against the previous champion until the tuner
could no longer beat it. The equilibrium weights
(`packages/strategy/src/heuristic.ts`):

```
value  1      reward for shedding points
strength 1    penalty for spending trick strength, fading as the hand shortens
low    1      extra penalty for spending a low card you might finish on
high  -10     extra penalty for spending a 7 or a Joker
width -2.5    preference for leading one card rather than several
```

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

Measured against two copies of the tuned heuristic (parity is about 36%):

| worlds sampled | loss rate | cost |
|---|---|---|
| 24 | 30.8% ± 3.1 | — |
| 48 | 24.2% ± 2.9 | ~1ms/decision |
| 128 | 25.0% ± 2.9 | — |
| 256 | 21.4% ± 2.7 | ~3ms/decision |

Returns flatten after about 48 deals. The in-game advisor uses 256 because it
costs nothing noticeable — the panel reports its own timing, typically 15-25ms.

## Round robin

`pnpm self-play matrix`, 4000 matches per cell, lower is better:

```
subject \ opponent        naive        gen0        gen1 equilibrium
naive                    37.43%      88.20%      82.30%      84.05%
gen0                      3.38%      35.45%      46.38%      47.88%
gen1                      8.15%      23.97%      36.63%      36.15%
equilibrium               7.40%      24.15%      35.75%      36.68%
```

Note `gen0`. It demolishes the naive player (3.38%) and is *worse than parity*
against its own successors. It had learned to beat one specific opponent, not
to play Cucumber. That is why the tuning iterates against the current champion
rather than against a fixed sparring partner.

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

## Reproducing all of it

```bash
pnpm self-play sanity                      # the harness itself
pnpm self-play tune --opponent baseline    # one generation of improvement
pnpm self-play matrix                      # the round robin above
pnpm self-play search --worlds 256         # search against the heuristic
pnpm self-play continuation                # the terminal-value grid
pnpm vitest run tests/strategy             # correctness, including the
                                           # information-constraint test
```
