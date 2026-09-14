# Cucumber

A private, three-handed implementation of the card game Cucumber. Three
invited players, one table, and a server that owns every card.

The rules live in `packages/game-engine` and know nothing about React, HTTP,
WebSockets or Postgres — which is why they can be argued with directly in
tests. The browser only ever asks; the server decides.

## Requirements

- Node 22 or newer
- pnpm 9
- Docker (for Postgres)

## Getting started

```bash
pnpm install
cp .env.example .env          # then edit ADMIN_EMAIL and SESSION_SECRET
pnpm db:up                    # Postgres on localhost:5432
pnpm db:generate && pnpm db:push
pnpm dev                      # server on :8080, web on :5173
```

On first boot the server prints a one-time invitation link for `ADMIN_EMAIL`.
Open it to sign in. From **Invitations** you can create a link for each of the
other two players; each link works once.

### Playing alone while you build

Cucumber needs three people. To fill the other two seats:

```bash
pnpm local:players Bob Charlie
```

They play legally from the same sanitised view a browser receives. This is a
development aid — the game itself has no computer opponents.

## The advisor

Toggle **Advisor** in the top bar and the table shows your odds of surviving
the match and which card to play, with what the alternatives cost you. The
setting is remembered per browser.

It runs in a Web Worker *in your browser*, from your own sanitised view. The
hidden cards live on the server and are never sent, so the rule that advice
may use nothing but your hand and the cards everyone has watched being played
is enforced by what is physically in the process — not by good intentions.
`STRATEGY.md` explains what it believes and how it was found.

## Self-play

```bash
pnpm self-play sanity      # 16,000 matches a second
pnpm self-play matrix      # round robin between candidate strategies
pnpm self-play tune        # search the weight space against a fixed opponent
pnpm self-play search      # does searching beat the tuned heuristic?
```

## Checks

```bash
pnpm typecheck
pnpm test          # rules, scenarios, and the integration suite
```

The integration suite starts a real server against a `cucumber_test`
database, kills it mid-hand with `SIGKILL`, restarts it, and carries on
playing the same cards. It needs `pnpm db:up` to be running.

## Layout

```
packages/game-engine   rules: ranking, legality, tricks, scoring, state machine
packages/strategy      self-play, search, and the advisor (STRATEGY.md)
packages/shared        types shared by the server and the browser
packages/database      Prisma schema and client
apps/server            Fastify, WebSockets, sessions, persistence
apps/web               React + Vite
tools/local-players.ts fills empty seats during development
tools/self-play.ts     the strategy harness
tests/                 rules, scenarios, strategy, integration
```

## How the rules are enforced

The browser sends intentions (`PLAY_CARDS`, `SUBMIT_DISCARDS`) and the server
answers with a per-seat view. A client never learns another player's hand, the
stock, or the discards, and never decides whether a move is legal.

Two rules are worth calling out because they are where cheating would happen:

- **You must beat what you can beat.** Before accepting a play the server
  checks whether *any* combination in your hand meets the target. If one
  exists you must make a qualifying play — a deliberate loss is rejected. You
  still choose which qualifying combination to spend.
- **Otherwise you surrender your lowest.** When nothing qualifies you must
  play your lowest cards, though you keep a free choice among cards tied at
  the cutoff rank, so suits are never picked for you.

Every accepted command carries the version it was based on and an action id.
The version guard rejects anything built on a stale view; the action ledger
makes a replayed command a no-op. Double clicks, duplicate socket delivery and
two open tabs are all handled by those two together.

## Persistence

The authoritative state is one JSONB snapshot per match, written inside the
same transaction as the events that explain it. Nothing important lives only
in memory: a player can close their laptop mid-hand, and the match — or the
server — can be restarted underneath them.

## Two places this departs from the specification

The specification contradicts itself twice, and the stated rules won over the
worked examples:

1. §17 lists `6, 7` as failing to meet a target of `5, 8`. Under §5 a 7 is the
   highest rank in the game, so `6, 7` comfortably meets `5, 8`. The promotion
   rule is implemented; the example is not.
2. §16 illustrates followers mixing ranks with a leader playing `10 + Jack`,
   but §13 requires a lead to be rank-uniform. Followers may mix; leaders may
   not.

One gap is filled by choice rather than by contradiction: the specification
lists no command for leaving the final-reveal screen, so continuing to the
next hand reuses `READY`. Everyone sees the cards and the score change, and
the next hand deals when all three are ready again.

## Deployment

`Dockerfile` builds the web bundle and the server into one image that serves
both. `docker-compose.yml` runs Postgres, and `--profile app` runs the image
beside it:

```bash
docker compose --profile app up --build
```

For Azure, the image is intended for Container Apps with Azure Database for
PostgreSQL Flexible Server; set `DATABASE_URL`, `SESSION_SECRET` and
`ADMIN_EMAIL`, and run `prisma db push` against the database once.
