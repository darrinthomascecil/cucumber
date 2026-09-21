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

### Playing alone

Cucumber needs three at the table. The server can fill the other two seats
itself:

```bash
COMPUTER_PLAYERS=Bob,Charlie pnpm dev:server
```

Bob and Charlie are ordinary players as far as the match is concerned: they
receive the same sanitised view a browser receives, their moves pass the same
version guard and action ledger, and they think with the same searched
strategy as the in-game advisor. `COMPUTER_WORLDS` (default 96) sets how many
imagined deals they search per move and `COMPUTER_DELAY_MS` (default 600) how
long they pause before acting.

With computer players there is no longer one room. A full table of people is
smaller — one person, with two computer players — so each arrival is seated at
the table they already have, or one with a seat left for a person, or a new
one, and the computer players join them there. Any number of people can be
playing them at once. They come back after a restart, follow you into a fresh
match, and never start the next match — that is your decision.

The same players can be run outside the server, against any origin, while you
build:

```bash
pnpm local:players Bob Charlie
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
PostgreSQL Flexible Server; set `DATABASE_URL`, `SESSION_SECRET`, `ADMIN_EMAIL`
and `WEB_ORIGIN` (the public HTTPS origin, used in invitation links), add
`COMPUTER_PLAYERS=Bob,Charlie` for a table one person can play at, and run
`prisma db push` against the database once.

Behind Container Apps' built-in authentication, `TRUST_EASY_AUTH=1` makes the
Microsoft sign-in the only door: whoever the platform says is signed in is
given an account on first sight and seated, with no invitation. The platform
strips those identity headers from outside requests; nothing else does, so the
setting belongs only on a deployment that cannot be reached any other way.
Disabling a user still keeps them out.
