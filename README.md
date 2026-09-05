# IRONVOW

A Clash-of-Clans-style base builder with async raiding, rebuilt from a working
single-file prototype into a server-authoritative game.

The prototype (`prototype/IRONVOW_v0.6.html`, 96 KB, no external assets) is the
source of truth for feel, art and balance, and is kept in the repo so any
question about intended behaviour has an answer that can be run.

## The idea in one paragraph

A player's base lives on the server. Other real players' bases are the raid
targets. The client is a renderer that cannot invent resources or fake a battle
result: it sends intent — "upgrade this cannon", "deploy a ram here on tick
412" — and the server re-derives every cost and re-fights every battle itself.

## Layout

```
apps/
  web/          Next.js 14 client, canvas renderer ported from the prototype
  api/          Fastify server, Prisma, the authority on every number
packages/
  sim/          the shared deterministic battle simulation
  config/       balance constants, the single source of truth
  types/        shared TypeScript types
deploy/         PM2 and Nginx configuration for the VPS
prototype/      the original single-file game
docs/           the build specification this was written against
```

`packages/sim` and `packages/config` are imported by both `web` and `api`. That
is the whole architecture: the client renders a battle by running the same
function the server uses to decide it.

## Why the simulation is written the way it is

`simulate(snapshot, commands, seed)` is pure, runs on a fixed 1/30 s timestep,
and touches neither `Math.random` nor `Date.now`. Two consequences are worth
knowing about:

**No trigonometry on a path that can change a result.** IEEE-754 requires `+`,
`-`, `*`, `/` and `sqrt` to be correctly rounded, so those give identical
answers on every engine. It says nothing about `pow`, `hypot`, `sin`, `cos` or
`atan2`, which are library routines and genuinely differ between V8,
JavaScriptCore and SpiderMonkey. The prototype moved units with
`atan2` + `cos`/`sin`; the port normalises the delta vector instead, which is
the same motion using only exact operations. `hypot` became `sqrt` of a dot
product and `pow` with an integer exponent became repeated multiplication. The
trigonometry that remains runs once on the server, in the snapshot generators,
and its output is frozen into the raid row.

**The client and the server share one loop body.** `createBattle().step()`
advances exactly one tick. The client calls it once per fixed step so it can
draw the fight; `simulate()` is a `while` loop over the same function. There is
no second implementation to drift.

A test asserts that a battle played live through `step()` and `deploy()`
reproduces byte-identically when the recorded commands are replayed through
`simulate()`, which is the property everything else depends on.

## Server authority

- **Production is lazy.** No tick loop. Any read or write touching a player
  settles what its producers earned since `lastTickAt`, capped at each
  building's twelve-minute buffer and at a four-hour offline window, then moves
  the watermark. A base with nobody online costs nothing to run.
- **Every mutation is a validated command.** `/build`, `/upgrade`, `/move`,
  `/train` and `/collect` re-derive their cost from `@ironvow/config` and check
  the Keep-level cap and the placement rules server-side. No request body in the
  API names a price, a resource total or an outcome.
- **Commands take a row lock.** Each runs in one transaction that opens with
  `SELECT … FOR UPDATE` on the player. Fifty simultaneous upgrades of one
  building resolve to exactly one success.
- **A raid is decided by replay.** The defender's base and the attacker's
  warband are frozen onto the `Raid` row when it opens. The client submits only
  its ordered deploys; the server replays them and writes down what it finds. A
  client that claims otherwise is ignored, and the disagreement is recorded in
  a `Divergence` row — a spike there means a determinism bug, not necessarily a
  cheat.

## Running it

Requires Node 20+, pnpm, PostgreSQL and Redis.

```bash
pnpm install
pnpm build                      # packages must build before the apps

cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env

cd apps/api && pnpm prisma:migrate && cd ../..

pnpm dev                        # api on :4000, web on :3000
```

With `MAIL_TRANSPORT=console` the magic link is written to the API log instead
of emailed, which is what makes local sign-in possible. Production refuses to
start with that setting.

## Tests

```bash
pnpm test
```

- **Determinism** — `simulate()` 1000 times on one input, byte-identical every
  time; and the same battle bundled and run inside Chromium, compared against
  Node.
- **Live versus replay** — a scripted live playthrough, then the recorded
  commands replayed, asserting the same checksum, stars, loot and tick count.
- **Economy** — resources never exceed capacity, never go negative, and no
  sequence of commands increases them without a server-side source.
- **Placement** — bounds and overlap rejection, with build and move proved to
  agree cell by cell.
- **Concurrency** — 50 simultaneous upgrades against a player who can afford
  one, run against a real Postgres.
- **Matchmaking** — a lone player still finds an opponent, never themselves.
- **Replay** — a raid persisted, then reproduced from stored seed, snapshot,
  commands and warband alone.

The concurrency and raid suites need a database; point `TEST_DATABASE_URL` at
one, or they skip and say so rather than passing quietly. The cross-engine test
looks for Chromium via `PLAYWRIGHT_BROWSERS_PATH` or `IRONVOW_CHROMIUM` and
skips loudly the same way.

Turbo strips the environment by default, so those variables are declared in
`turbo.json` under `tasks.test.env`. If you add a test that reads a new one,
declare it there too — otherwise the suite skips and the run still reports
success, which is the worst of both worlds.

```bash
createdb ironvow_test
TEST_DATABASE_URL=postgresql://localhost/ironvow_test pnpm test
```

## Optional services

Two features degrade to off rather than failing:

- **Email.** `MAIL_TRANSPORT=console` writes login links to the log for local
  development; production refuses to start with it. `smtp` needs `SMTP_HOST`,
  and the server refuses to start without one rather than dropping mail.
- **Push notifications.** With no `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` the
  feature is off and every send is a no-op, so the game runs identically.
  Generate a pair with `npx web-push generate-vapid-keys`. Notifications should
  never be load-bearing.

## Operations

`GET /ops/divergence` and `GET /ops/health` are guarded by a bearer token in
`OPS_TOKEN`. Unset means the endpoints are off, not open: an unauthenticated
divergence feed tells an attacker exactly how close their forged client is to
matching the server.

The number that matters on the first is the rate, not the count. Divergence
should be effectively zero, because the client and the server run the same code
on the same inputs. Anything above one in a thousand is worth looking at, and
one in a hundred means the shared simulation is broken rather than that a
hundredth of players are cheating.

## Deployment

`deploy/ecosystem.config.cjs` runs the API clustered, the worker as a single
instance (repeatable BullMQ jobs must not be registered twice) and the Next
server behind `deploy/nginx.conf`. The API and client share one origin so the
session cookie can stay `SameSite=Lax`.

## Where this is up to

See `docs/STATUS.md` for what is built, what is deliberately deferred, and the
handful of numbers that need sign-off before launch.
