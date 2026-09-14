# Exact Closing Forecast Checkpoint

## Scope

This is one small forecasting check, not a full-match strength benchmark.
The advisor accepts only the acting player's public view and a proposed action.
Its exact path applies only when:

- Nobody exchanged cards this hand and complete public history is available.
- The other two players have played in the final trick and each holds one card.
- The proposed play leaves the observer one card and necessarily ends the match:
  that card is a 7/Joker or raises the observer's cumulative score to at least 21.

Other forecasts retain the existing Monte Carlo path. The general advice selector
and web interface are unchanged by this checkpoint.

## Why Enumeration Is Exact Here

Fifteen unseen cards are in the stock and two are the opponents' final cards.
There are 17 * 16 = 272 ordered assignments to the two opponent seats. Under a
uniform initial deal, with no exchange, every assignment has the same prior
weight. Stock permutations have equal multiplicity and cannot affect a match
that ends on the proposed action.

For each assignment, the advisor rejects histories that violate the rules and
weights legal histories by the declared opponent policies' action probabilities.
It then sums the normalized weights of the assignments where each seat loses.
There is no sampling of hidden hands, opponent types, or future play on this path.

The independent reference uses single-play rank-count formulas for the observed
history, not the advisor's belief sampler, action generator, policy probability
helper, or continuation solver. The checked opponent model chooses uniformly
among legal rank-equivalent actions, then uniformly among tied card identities.
The two opponents independently use this random policy; the observer's recorded
actions and proposed final action are conditioned on, not optimized.

## Evidence

The fixture uses deal seed 973, no exchange, 35 publicly recorded single-card
plays, and fourth-hand cumulative scores of 20 for every seat. The reference
examines all 272 assignments. Its per-seat loss probabilities are:

| Seat | Exact conditional probability |
| --- | --- |
| 1 | 1.0000000000000000 |
| 2 | 0.2100033787261858 |
| 3 | 0.0415583320838726 |

The regression requires maximum absolute error below 1e-12. It also swaps hidden
opponent/stock cards without changing the public view and changes the random
seed and sampling budgets; the resulting probabilities must remain identical.
Fitted calibration is deliberately not applied to exact model probabilities.

For true conditional probability p and forecast q, expected Brier score is
p * (1 - p) + (q - p)^2. Thus the enumerated probability minimizes expected
Brier score **under this declared model**. The checked mean irreducible risk is
0.06857773225601703; the forecast's excess risk is approximately 5.8e-32.
This is not a zero Brier score, a held-out human result, or evidence that the
opponent model itself is correct. General positions still use approximate inference.

## Reproduce

The known-working environment is Node 24 with the repository's dependency-free
workspace loader. No package installation is required for these checks.

```powershell
node --experimental-strip-types --import ./tools/register-workspace.mjs --test --test-timeout=20000 --test-reporter=spec --test-reporter-destination=stdout --test-reporter=tap --test-reporter-destination=artifacts/advisor-endgame.tap tests/advisor/endgame.node.ts
node --experimental-strip-types --import ./tools/register-workspace.mjs --test --test-timeout=30000 tests/advisor/*.node.ts
```

The saved TAP report contains probabilities, maximum error, reference/forecast
timings, and both test results. Timings vary with concurrent work and are reported
as individual measurements, not a performance guarantee. The isolated checkpoint
measured about 58 ms for the reference and 679 ms for the advisor.