# The review: how well did you actually play?

You play the hand blind. The advisor says nothing, shows nothing, and is not
on screen. It is watching, though, and when the match ends it tells you what
it thought of every decision you made — and what the best available play was
worth instead.

The point is not to be told what to do. It is to find out, afterwards, how
much of the available edge you kept.

## What "against the maximum" means

At each of your decisions the search already evaluates *every* legal action
against the same imagined deals — common random numbers, so the comparison
between two actions is far steadier than either estimate alone. That gives:

```
best_t    = the value of the best action available
chosen_t  = the value of the action you played
regret_t  = best_t − chosen_t          ← win probability handed back
```

The maximum is `best_t`. Playing perfectly means `regret_t = 0` every time,
which is achievable and occasionally happens: most positions have an obvious
move, and the review should say so rather than manufacturing drama.

### The thing this must not do

`ADVISOR.md` is explicit that *"an alternative at −0% or −1% is not reliably
worse"*. The search is stochastic; two actions within noise of each other are
not a mistake, and a review that paints them red would be lying with
arithmetic. So every regret is compared against the estimator's own noise
before it is called anything, and differences inside that band are reported as
"either play was fine".

This is the same discipline as the calibration bands in `BRIER-FLOOR.md`: the
number is not the finding, the number against its uncertainty is.

### Two evaluations, not one

Live, the advisor thinks with a fixed budget because you are waiting. The
review is not waiting for anyone, so decisions that look like mistakes get
re-examined with a far larger world count before any verdict is printed. A
"mistake" that dissolves under deeper search was never a mistake; it was the
live estimate being noisy, and finding that out is worth the seconds.

## Plan, in hours

- [x] **R1 — Record every decision, silently.**
      Evaluate each of your decisions whether or not the panel is visible, and
      keep `{hand, trick, legal actions with values, what you played}`.
      *Done when:* a finished match yields one record per decision, and a pure
      reducer turning engine events into records is unit-tested.

- [x] **R2 — Regret, with a noise floor.** *(done first: it turned out the
      advisor already computes the regret, so this was the cheap half.)*
      Pure module: per-decision regret, per-match totals, biggest single cost,
      and the threshold below which two actions are called equivalent.
      *Done when:* a match of best-play-every-time scores zero mistakes, and a
      deliberately bad play is caught and costed.

- [x] **R3 — Blind mode.**
      A toggle that hides the advisor and disables autoplay for the match, then
      reveals the review at `MATCH_OVER`.
      *Done when:* with blind mode on, no advisor number appears anywhere in
      the DOM until the match is over — asserted in a test, not by looking.

- [x] **R4 — The review screen.**
      Hand-by-hand timeline: what you played, what was best, what it cost, and
      a headline for the match. Quiet where you played well.
      *Done when:* it renders from a fixture, and says "either play was fine"
      where the gap is inside the noise.

- [x] **R5 — Deep re-evaluation of the flagged moments.**
      Re-run the candidates at a large world count for the decisions that
      matter, and report how often the live verdict survives.
      *Done when:* the disagreement rate between live and deep search is
      measured and written down.

- [x] **R6 — Ask it in plain English.** *(Ollama + llama3.1:8b)*
      A question box over a finished match: "where did I lose it?", "should I
      have led the fours?". The model answers **from the recorded numbers**,
      with the evaluations supplied as grounding; it is never the thing that
      decides what a play was worth.
      *Done when:* a question is answered citing a specific decision and its
      recorded cost, and a question about a decision that never happened is
      declined rather than invented.

- [x] **R7 — Keep reviews.**
      Persist per-match reviews server-side so past matches can be revisited
      and asked about.
      *Done when:* a review survives a server restart.

## What answers the natural language

**Ollama, locally.** Chosen so that a private game stays on the machine it is
played on, and so that R6 costs nothing to run and needs no Azure resource.

Ollama 0.19.0 is installed and answering on :11434, but **no model is pulled**
— `/api/tags` returns an empty list. R6 therefore needs a multi-gigabyte
download, which will be asked for explicitly before it happens.

The division of labour matters more than the model does: every number in an
answer comes from the recorded evaluations, and the model's job is to find the
relevant decision and say what it means in English. It is never the thing that
decides what a play was worth. A local 7–8B model is entirely capable of that,
because it is reading a table, not playing cards.

## Log

Newest last. Nothing goes here before it has been run.

- **R2 — done, ahead of R1.** Writing the plan turned up that
  `Suggestion.cost` — "how much worse than the best option, in probability" —
  is already computed for every legal action at every decision. The regret
  against the maximum was being thrown away, not missing. So
  `packages/strategy/src/review.ts` pairs those evaluations with what was
  actually played: `judge()` for one decision, `review()` for a match, with
  `NOISE = 0.02` from ADVISOR.md's own statement that an alternative at −1% is
  not reliably worse.

  11 tests in `tests/strategy/review.test.ts`. The two that earn their keep:
  a play 1 point behind the best is *not* called a mistake, and a play the
  advisor never evaluated is left unscored rather than charged to the player —
  the action list is screened before the search, so inventing a value for it
  would be inventing evidence.

- **R1 — done.** `reviewRecord.ts` is the pure reducer, `useReview.ts` the hook,
  and `App.tsx` records on the command path — before the send, because once the
  command lands the view moves on and the advice on hand is about the position
  *after* the play. 7 tests in `tests/strategy/reviewRecord.test.ts`. The one
  that matters refuses advice computed for a different `version`: the advisor
  answers asynchronously, so if the player moves first the advice on hand
  belongs to the previous position, and scoring against it would judge them on
  a question they were never asked. Such decisions are kept and left unscored.

- **R3 — done, and nearly free.** The table was already passed
  `advice={advisorOn ? advisor.advice : null}`, so the advisor could always
  run while showing nothing. Blind mode is therefore: keep the worker enabled
  (`advisorOn || autoplayOn || blindOn`), withhold the advice from the table,
  and disable autoplay — which would otherwise be playing the very decisions
  the review is about. Verified in the browser: with Blind on the advisor panel
  is gone while the Advisor toggle stays lit, and the hand plays normally.

- **R4 — done, bar one sighting.** `components/Review.tsx` over the felt at
  `MATCH_OVER`, shown only for a match played blind — with the advisor on
  screen throughout there is nothing to find out afterwards. Styles were added
  before the markup, against the real tokens (`--felt-deep`, `--line`,
  `--warn`), not invented ones.

  It is deliberately quiet about decisions played well: a list of ticks beside
  every obvious play would bury the two that cost something. A flawless match
  gets one sentence; only costly decisions are listed, with what was played,
  what was best, and the points handed back.

  5 render tests in `apps/web/src/components/Review.test.tsx`, and one real
  finding while wiring them: the root `vitest.config.ts` included only
  `tests/**`, so web component tests would have passed locally and **never run
  again**. `include` now covers `apps/web/src/**/*.test.tsx`. Full suite: 198
  tests across 22 files.

  Still unseen end-to-end: nobody has yet played a blind match to `MATCH_OVER`
  in a browser. The component is proven from fixtures, the trigger condition is
  proven only by reading. That is the next thing to check, not a thing to claim.

- **R5 — done: 13% of flagged mistakes are not mistakes.** `tools/deep-check.ts`
  judges the same positions twice, at the live 256-world budget and at 2048,
  same seed, so the budget is the only difference. 30 matches, 517 decisions,
  54s:

  | | |
  |---|---|
  | flagged as a mistake at 256 | 145 (28.0% of decisions) |
  | still a mistake at 2048 | 126 (**86.9%** of those) |
  | missed at 256, found at 2048 | 15 (2.9%) |
  | mean \|live − deep\| cost | 0.0046 |

  So roughly one flagged mistake in seven dissolves under deeper search. That
  is the number the review's honesty rests on, and it also justifies the noise
  floor independently: the typical budget-induced wobble is 0.0046, comfortably
  inside NOISE = 0.02.

- **R6 — done.** `apps/server/src/reviewChat.ts` puts the recorded decisions in
  front of llama3.1:8b with the units spelled out; the browser sends the table
  it recorded, since the advisor runs there and nothing else has it. The model
  never computes a cost — the search did that while the hand was live.

  It took two attempts, and the first failure is the interesting one. Asked
  "where did I lose it?", the model got the decision, the cost and the units
  right and then **invented the position**: "you were playing a 5C-3D against
  their 2H-4S". Those cards are nowhere in the record. It has no positional
  data at all, so the prompt now forbids describing the situation outright —
  *a sentence that begins "you were facing" or "they had" is always wrong*.
  After that: the answer names hand 1, 3D against 4S, 23 points, and nothing
  else. Asked about a hand that never happened it declines:
  *"Hand 4 is not listed... does not include any information about hand 4."*

- **R7 — done.** `MatchReview` in Postgres, one row per (match, player): three
  people at one table each get their own, because the evaluations are about the
  seat. Stored whole rather than normalised — written once, read whole, never
  queried across matches. Writing is idempotent on (match, player), so a reload
  cannot leave two reviews of one match; verified by writing twice and getting
  the same id back with one row in the table. Survives a restart: the server
  was bounced and the review read back intact.
