# IRONVOW — build status

Written against `docs/BUILD_SPEC.md`. This is an honest account of what runs,
what does not, and what needs a decision.

## Done

### Phase 1 — single player on the server

| Spec | State |
|---|---|
| Auth, session in an httpOnly cookie | Email magic link, tokens stored only as SHA-256 hashes |
| Base persistence | Prisma on Postgres, schema as sketched in §3 plus two additions (below) |
| Lazy production | `accrueProduction`, capped at the 12-minute buffer and the 4-hour window |
| Build / upgrade / move / train / collect | All validated server-side, cost re-derived from `@ironvow/config` |
| Placement validation on the server | `cellsFree` ported; build and move share it |
| Training queue | Absolute `finishesAt`, resolved lazily on read |
| Row-level lock on resource changes | `SELECT … FOR UPDATE` inside one transaction per command |

### Phase 2 — real PvP

| Spec | State |
|---|---|
| Shared deterministic sim | `packages/sim`, fixed 1/30 s, seeded mulberry32, no `Date.now` |
| Snapshots | Frozen onto the `Raid` row when it opens |
| Command submission and server replay | Client sends deploys only; server decides |
| Trophy matchmaking | ±150 band, widened on each retry, excluding self, recent targets and shielded players |
| Shields | 12 h at 2+ stars, 8 h at 1, none if undamaged |
| Attack log | `/raids/incoming` and `/raid/:id/replay` |
| Divergence logging | `Divergence` table, written when a client's checksum disagrees |

### Onboarding and feel

| Feature | State |
|---|---|
| War Orders (12) | Ported, with progress derived server-side from real state |
| Guest play | One tap to a real hold; email attaches to that same hold later |
| Sound | The prototype's synth, ported, with a toggle that persists |
| Collect all | One button for every full producer |
| Raid result | Stars land one at a time with a sound each; loot counts up |

### Phase 4 — build timers and builders

ALFA's answer to the §8.4 question was **free, no in-app purchases**, and that
answer set every number. In a game that sells speed-ups, long timers are the
engine. In a game that sells nothing, a long timer is friction with nobody on
the other side of it benefiting. So these are a rhythm, not a wall:

| | |
|---|---|
| Builders | 3, free, from the first minute. Never purchasable. |
| Ramparts | No timer at all, so a run of twenty stays one fluid action |
| First Gold Mine | 15 seconds |
| A mid-game upgrade | Under 90 seconds |
| Keep 8 → 9 | 9m 18s, and that is the longest job in the game |
| Finish now | Gold, `max(10, remaining × 3)` — a convenience for a player with gold they cannot otherwise spend |

Timers derive from cost rather than a table, because cost already encodes how
significant a thing is and a second table would drift from the first. A square
root keeps the curve gentle: a job costing a hundred times more takes ten times
longer, not a hundred.

A building still going up occupies its cells but earns nothing, fires nothing,
and is left out of raid snapshots — it is scaffolding, not something to fight.
A building being *upgraded* keeps working at its current level the whole time,
because taking a defence offline for the duration of its own upgrade would make
upgrading defences a mistake.

### Phase 3

- **Scout before you raid (§8.1)** — done. The defender's real layout is drawn
  on the canvas before committing, with a gold-charged reroll.
- **A hero (§8.2)** — done. One Vowkeeper per player, unlocked at Keep 3,
  levels to 9 but never above the Keep, deployed once per raid, costs no
  warband room, and is away for `10 + level × 5` minutes if it falls. Its
  level is frozen onto the raid alongside the warband, so upgrading mid-raid
  cannot change what a replay may field.
- **Troop upgrade lab (§8.3)** — done. A War Lab building (one, from Keep 3)
  gates per-troop levels at +12% hit points and damage each. Levels are frozen
  onto the raid for the same reason.
- **Vaults actually protect (§8.6)** — done. Each Vault shields a fixed amount
  from looting rather than a flat percentage of everything.
- **Attack log and revenge (§8.5)** — done. The log, the replay, and a revenge
  button that reopens a raid on whoever hit you, listed in the same log.

### The six fixed bugs from §9

Each is either structurally unreachable now or covered by a test:

1. **Starting gold equalled storage.** `@ironvow/config` throws at module load
   if `START_GOLD >= BASE_STORAGE`; asserted again in the economy tests.
2. **Move was destructive.** There is one placement path. A move is a single
   `UPDATE` of `gx`/`gy`; the building is never removed from the set it is
   validated against.
3. **Confirming a move pushed the building twice.** Not reachable for the same
   reason; a concurrency test fires twenty overlapping moves and asserts one row
   survives with its original id.
4. **Hit flash never decayed on non-defensive buildings.** All per-frame entity
   state decays in `decayFx`, in one place.
5. **Camera clamp used the widest point of the diamond.** `clampCam` clamps the
   grid coordinate under the screen centre.
6. **Culling used a grid-space bounding box.** `onScreen` projects the point and
   tests it against the screen rectangle.

### Operations and delivery

| | |
|---|---|
| Matchmaking floor | A generated garrison when no human is in band, so RAID always does something |
| Revenge | `POST /raid/revenge` from the attack log; skips the band and the cooldown, respects shields |
| Ladder | `GET /leaderboard`, with the player's own rank pinned even when they are nowhere near the top |
| Email | Real SMTP via nodemailer; production refuses to start with `MAIL_TRANSPORT=smtp` and no host |
| Divergence alarm | `GET /ops/divergence` reports the rate and calls anything above 1% a determinism bug, not cheating |
| Health | `GET /ops/health` flags a maintenance worker that has stopped expiring raids |
| CI | Two jobs; the second exists only to guard determinism |
| Music | Generated at runtime — a chord progression, a bass note, a sparse melody, a pulse only in battle |
| Settings | Music and effects as sliders, graphics as a switch, sign out, claim account |

The `check` job sets `IRONVOW_REQUIRE_DB=1`, which turns a skipped database
suite into a hard failure. Those suites skip themselves without a database so a
contributor can run the pure tests with nothing installed, and a skipped run
still reports success — which is worse than red, because it looks fine.

The `determinism` job runs the simulation suite alone and greps
`packages/sim/src` for `Math.pow`, `hypot`, `sin`, `cos` and `atan2`. If that
property breaks, a client renders one outcome and the server writes down
another for every battle in the game, and the only visible symptom is a slow
rise in the `Divergence` table.

### Undoing things, and the rest of Phase 4

| | |
|---|---|
| Demolish | Half of everything invested comes back, upgrades counted; the count slot frees up |
| Cancel a build or upgrade | Full refund — nothing was consumed, the builder just stops |
| Cancel a training job | Full refund, and everything behind it moves up the queue |
| Layout editor (§8.7) | Two slots, defence and farming; the whole arrangement is validated before any of it is written |
| Push notifications | Web Push with VAPID — finished builders and raids on your hold. Entirely optional: with no keys configured the feature is off and the game is identical |
| Defend drill | The simulation has supported defending since it was written and nothing called it. Now `POST /defend` |
| Rename, delete account | Deleting cascades everything and needs the hold's name typed |
| Rate limits | Matchmaking is the most expensive endpoint and now has its own ceiling |

### A balance bug inherited from the specification

**Ramparts were unbuildable past seventeen, forever.**

§6 prices a new building at `firstCost × 1.55^owned` and, in the same section,
permits 320 ramparts at Keep 9. The most gold anyone can ever hold is 91,900
(Keep 9, six level-9 Vaults). Under 1.55 the eighteenth rampart costs 103,226 —
more than can be held at any point in the game. It also broke War Order q8,
which asks for eight ramparts costing 3,525 cumulative against a Keep 1 storage
cap of 2,500.

That formula is meant for buildings you own three to twelve of; ramparts landed
under it because one function priced everything. Ramparts now grow at 1.012,
which puts a full 320-rampart wall at about 222,000 gold — roughly six per cent
of the cost of taking every other building to level 9. Nothing else moved: a
third Gold Mine still costs exactly 360.

**This is a balance change and it needs sign-off.** It is one constant,
`RAMPART_COUNT_GROWTH` in `packages/config/src/buildings.ts`.

## Beyond the build document

Five things were added on ALFA's explicit instruction after they were each
described and signed off. None of them is in `docs/BUILD_SPEC.md`, so each is
written up here with what it costs and what it deliberately leaves out.

### Daily War Orders

The twelve War Orders are one-time, and the last one — win fifteen raids — is
cleared on a player's second day. After that, opening the game offers nothing
that was not there yesterday.

Three orders per player per day, drawn from a pool of fourteen. Which three is
a **pure function** of the player's id and the UTC day number, so a day turning
over costs nothing: no cron, no job, no row that can be missing when a player
logs in. The first settle after midnight zeroes the counters, and that settle
happens because the player turned up.

The reward scales with the Keep, because a flat number is generous at Keep 1
and an insult at Keep 9, and again with a streak that caps at eleven days.
Capping it matters: a streak that pays forever turns a habit into an
obligation, and missing one day after two months would cost something real.

Progress is measured from eight server-incremented counters, never from
anything a client says. A player cannot claim an order they were not given —
that is checked separately from whether the order exists, or the whole pool
would be claimable daily by anyone who read the ids out of the bundle.

### A fifth troop: the Scaler

With four troops a raid had no composition decision. Bring a ram, bring
whatever else fits.

The Scaler is the ram's opposite: the fastest and most fragile unit in the
game, and the only one a rampart does not stop. It walks over walls and never
targets one, which are two halves of the same idea — without the second it
would cross the wall and then turn round and attack it, because a wall is the
nearest thing there is.

That gives the wall something to be wrong about. Go over it with something
fragile, or through it with something slow, and the defender's layout is what
decides which was right. `packages/sim/test/battle-rules.test.ts` holds the
behaviour: at seven seconds a Scaler is on the Keep while a raider is still
working on the rampart, and every rampart is still standing.

### Vanity buildings

Every sink in the game closes. Mines cap, Vaults cap, ramparts cap, and a maxed
player is left with "finish now" on timers they were never waiting for.
Resources that pile up with nothing to buy make collecting — the interaction a
player performs more than any other — feel pointless.

A Vow Statue, a Brazier and a Standard. Gold only, expensive, steeply scaling
with count and again with level. They carry no loot, mount no defence, and are
**filtered out of raid snapshots entirely**, so nobody is ever rewarded for
attacking one and nobody is ever punished for owning one. Upgrading is visible
from across the base — a statue's sword is gilded from level 5 — which for a
game with no purchases is the honest version of something to spend on.

### Clans and chat

Everything else in IRONVOW is done alone: you raid a frozen snapshot of
somebody who is not there, and the only trace another human leaves is a line in
your attack log.

Founding, finding, joining, applications, roles, kicks, a member list, chat and
a clan ladder. Two rules run through all of it: a player is in at most one clan,
enforced by a unique index rather than by a check anyone can forget; and every
permission is decided from the row in the database, never from what the client
says its own role is. Founding costs 20,000 gold — partly a sink, mostly
because a free create button produces a server full of one-member clans called
"test", and then the find list is useless to the players it exists for.

Chat is polled, not socketed: a handful of lines a few times a minute does not
justify a second piece of infrastructure. It is rate limited per player in the
database, length capped, and control characters are stripped. There is **no
word filter** — a banned-word list is a moderation policy, it is
culture-specific, it is trivially evaded, and it would be a decision made on
ALFA's behalf about what their players may say. Elders delete and leaders kick,
which is moderation by people who know the room.

**Clan wars are deliberately not built.** A war is a second game mode with its
own matchmaking, its own clock, its own attack allocation and its own rewards,
and every one of those is a design decision nobody has made. Half a war would
be worse than none. It needs its own sign-off.

### One command to run it

`docker compose up --build` brings up Postgres, Redis, the API, the worker and
the web app; migrations run when the API container starts. See the Deploy
section of the README, including the caveat that the stack has not been run end
to end here, because this environment blocks pulling images from Docker Hub.

### The ground, and the logo on the site

The field was one flat green. What it is now, all of it procedural and all of
it in `apps/web/lib/render/terrain.ts` and `deco.ts`:

- **An isometric checkerboard** in two greens, painted as a canvas pattern —
  one fill for 3,136 tiles. The pattern is drawn one device pixel to one and
  never scaled: a scaled pattern fill measured at 9.2 ms a frame against 1.7 ms
  unscaled, on the phone-sized canvas the perf harness uses. That is only exact
  while a tile is a whole number of device pixels wide, so the zoom is snapped
  to that grid (`snapZoom` in `camera.ts`; the step is under one percent, and
  `test/terrain.test.ts` holds it there).
- **A plateau.** The buildable field stands a cliff above the apron, with two
  cut-earth faces lit like the buildings, a turf lip, wandering strata, buried
  stones and a shadow at the foot. The apron is a shade darker.
- **Ground cover** on the field — 500 tufts, flowers, pebbles and soft turf
  patches — drawn flat under everything, so a building placed on a tuft simply
  hides it. Off on low quality.
- **A thicker treeline**: 900 trees, pines, rocks, bushes and stumps, two in
  three crowded at the cliff foot and the rest out to the horizon. Pines are a
  new kind; a bush is sometimes a berry bush.

Beyond the ground itself, the world around it:

- **Water.** A lake off the south-east edge and a pond behind the hold, cut
  into the apron with a band of wet sand, a small drop at the bank, lighter
  shallows and sun on the water that brightens and fades out of step. The
  treeline is generated around them.
- **Cloud shadows** cross the field, three of them at different speeds, each
  rasterised once per size and blitted one device pixel to one. **A flight of
  birds** goes over every couple of minutes.
- **The rim** of the plateau, the ring between the buildable square and the
  cliff, has bushes, boulders and stumps of its own.
- **A vignette** at the edges of the screen, done in CSS on the compositor so
  it costs the canvas nothing.

Cost, measured in one sitting against the commit before it on the same
machine: 5.0 ms a frame before, 5.1 ms after, at full quality; low quality
unchanged, since everything above is off there. (Absolute numbers from this
container drift with whatever else it is doing — the same build measured
2.5 ms and 5.0 ms an hour apart — so only same-sitting comparisons are quoted.
The scaled-pattern figure above, 9.2 ms against 1.7 ms, is one.)

The site now wears the logo: `icon.svg` and PNG fallbacks in the tab, an Apple
touch icon, a web manifest with maskable icons so "add to home screen" gets a
proper tile, the wordmark on the sign-in card instead of a heading set in
Arial Black, and a 1200 x 630 card for links shared on X and elsewhere. All of
it is generated from the same polygon wordmark as the X profile, so it is the
same mark everywhere.

### The guide: a tutorial, and every order with a way there

Nobody had told the player what to do. The twelve War Orders were a list
behind a button, the daily orders another list under them, and moving a
building was a press-and-hold nobody was told about.

What there is now, in `apps/web/lib/game/coach.ts` and `components/Coach.tsx`:

- **One objective at a time**, on a card: the next tutorial step, then the
  next War Order, then the next of today's orders, then "nothing owed today"
  with the countdown to tomorrow's. Each says what to do, in words that name
  the buttons, and has one button that goes there — BUILD opens, ARMY opens,
  RAID finds a raid, SELECT KEEP selects it and brings the camera, COLLECT
  collects. When the server says the order is met, the button becomes
  CLAIM REWARD. The card folds to a chip.
- **A four-step tutorial** for a new hold: the Keep, the camera, gold and
  iron, and moving a building — which completes itself the first time a
  building is moved. Kept in the browser per hold; replayable from HOW TO
  PLAY.
- **Pointing.** The rail button the objective needs pulses; a building it
  names gets a bobbing gold chevron and a pulsing ring on the field.
- **GO on every open row** of the orders sheet, using the same map.
- **HOW TO PLAY**, from the ? button and from settings: the rules in the
  order a player meets them.

Three things found on the way, all fixed:

- The opening frame fitted the hold to the window, which on a desktop meant a
  Keep the size of the screen. It opens at zoom 0.8 now (`HOME_ZOOM`).
- The Keep could not be moved, by a rule in `planMove` and again in the
  client. The specification never asked for it and the first player to try
  it thought moving was broken. The Keep moves like anything else now.
- Tapping a mine with a full pouch collected it and did not select it, so the
  drag that followed panned the camera instead of moving the mine. It does
  both now.

### Clan wars

The second game mode, built after sign-off. The rules are one comment at the
top of `packages/config/src/war.ts`; what follows is why.

- **Declare, or challenge.** The leader or an elder presses DECLARE WAR and
  the clan waits for any other clan that does the same; the worker pairs them
  a minute later at the latest. Or they press WAR next to a clan on the ladder
  and that clan's elders ACCEPT or DECLINE. Both exist because a small server
  cannot promise a stranger will ever be searching at the same time.
- **Frozen rosters.** The strongest N of each side by trophies, N set by the
  smaller clan (at most ten). Every base is snapshotted the moment the war
  starts, exactly as a raid snapshots one, with an empty loot pool. Rebuilding
  during the war changes nothing.
- **Two attacks each, best result per base counts.** Any base, the same one
  twice if they like. A base's score is the best anyone got against it, so a
  weak second attempt costs nothing but the attack.
- **One day, then settled.** More stars wins; the tie-break is destruction;
  then a draw. The worker settles it, pays every member per star they earned
  (doubled on the winning side, scaled by the Keep like the daily orders),
  writes the result into both clans' chats, and pushes it to phones.
- **Nothing decided by the client.** A war attack is a raid row with a war id:
  it goes through the same replayed simulation, and the war reads the stars the
  server found. A war attack takes no loot, moves no trophies, and puts no
  shield on the defender — nobody is robbed for being on a roster.

Found on the way: `grant()` clamped a player's holdings *down* to the storage
cap, so a player above it (a reward landed, then a Vault was demolished) lost
gold on their next raid. It now never takes what was held.

### Sound

The battle is heard from the simulation's own event stream rather than
guessed at by the renderer: cannons, arrows, steel on stone, ramparts giving
way, buildings coming down, troops landing and falling, the hero taking the
field. Every effect is throttled so a volley is one whistle. The raid music
has a drum kit — kick, snare, hats, a fill every fourth bar — and the hold a
slow arpeggio. Victory and defeat have their own stingers; a war has a horn.
Still no audio files: all of it is oscillators and shaped noise.

### The small things

- **Push works on a fresh server.** The API generates a VAPID key pair on
  first start and keeps it in `ServerSetting`, so nobody has to run a key
  generator and paste the output into `.env` — the step that was skipped on
  the first deployment and left notifications dead.
- **The first screen says what the game is** in three lines before asking
  for anything.
- **REPORT A PROBLEM** in settings: stored with the player and their
  browser, read back at `/ops/feedback` with the ops token.

### The door

The game is by invitation for now: `ACCESS_CODE` in `.env` (1010 out of the
box in `docker-compose.yml`; set it empty to open the game). The first screen
stands over the game rather than a flat dark rectangle — `AttractField` runs
the same renderer on its own world, drawing a generated hold with the camera
drifting slowly around it, offset so the hold stands beside the card instead
of behind it. The door asks for the code before anything else — every time the page opens, refresh
included, signed in or not; nothing remembers it — and the server checks it in
constant time on every call that creates or reaches a hold. Twenty tries in
ten minutes per address. It is a door, not a lock: four digits typed on a phone.

### The first screen's links

Under the door's card: X, Telegram, and the contract address. All three come
from the environment rather than the source, because the accounts belong to
whoever runs the server and not to the code — `X_URL`, `TELEGRAM_URL` and
`CONTRACT` in `.env`, carried through `docker-compose.yml`, the `Dockerfile`
and `turbo.json` as `NEXT_PUBLIC_*` because Next bakes them at build time and
Turbo's strict env mode drops anything undeclared (which is exactly how the
first deployment lost `API_PROXY_URL`).

A link with no address is drawn dimmed and saying SOON rather than pointing
somewhere wrong — hiding it left the card looking unfinished, and looking
like a deploy that had not landed. The card compresses on a short window — a laptop at 150% scaling
leaves the page about 590 CSS pixels, and the card had been growing a
scrollbar and quietly putting the links below the fold, where nobody found
them; it now fits with nothing to scroll from 590 pixels up. `CONTRACT` empty means the chip reads COMING SOON; set, it shortens
the address the way an explorer does and copies it on a tap.

## Not done

- **Clan wars.** See above: a second game mode, and none of its decisions have
  been made.
- **A live defend.** You cannot watch a raid on your own hold as it happens,
  and you should not be able to: the attacker plays it on their phone, and the
  result is settled server-side from their commands. What exists instead is a
  drill against your own walls, started from the LOG sheet, and the attack log
  that replaces the prototype's random defend event (§8.5).

## A bug found while adding the above

**The BUILD sheet had no War Lab card.** The server has allowed one from
Keep 3 since the Lab was built, the cap table has always had a row for it, and
the ARMY sheet has always told the player to go and build one — but the sheet's
list of buildable types simply omitted it. A player could reach Keep 9 being
told to build something the game would not sell them. It was found by opening
the sheet to add the vanity section to it.

## Deviations from the spec, and why

**Deterministic maths (§4.2).** The spec says no `Math.random` and no
`Date.now`. That is necessary but not sufficient: `pow`, `hypot`, `sin`, `cos`
and `atan2` are not correctly rounded by IEEE-754 and genuinely differ between
JavaScript engines, so a client on Safari and a server on Node could disagree in
the last bits and diverge. None of them appear anywhere a result can change. See
`packages/config/src/math.ts`.

**The attacker's warband is frozen onto the raid.** Not in the §3 sketch. The
replay test forced it: reading the army at submission time lets a player train
troops mid-raid and change what a stored raid is allowed to deploy, at which
point the recorded result stops reproducing.

**A `Divergence` table.** Not in the sketch. §4.6 asks for divergences to be
logged; this is where.

**Minimum zoom lowered from 0.7 to 0.4.** The prototype generated its own
opponents in a tight ring around the map centre, so a whole enemy base always
fitted on screen. A real player's base can span the field, and at 0.7 a raider
cannot see the layout they are supposed to be planning against — which defeats
the scouting feature. The 26-cell apron already covers the wider view.

**Offline auto-collection dropped.** The prototype emptied every producer into
the purse on load so you never returned to a dead base. With lazy production
there is no "load" — every read accrues — so keeping it would mean collecting
on every request and removing the collect interaction entirely, including the
tap that the first War Order asks for. Producers now fill their buffer and wait.

## Numbers that need sign-off

These are marked `TUNABLE` in `packages/config`. The spec describes the
mechanic but not the value, and each one changes the feel of raiding.

Everything under **Beyond the build document** is TUNABLE in full — the spec
describes none of it. The numbers most worth a second look are the Scaler's
stats (`packages/config/src/troops.ts`), the vanity prices
(`packages/config/src/buildings.ts`), the daily reward curve and streak cap
(`packages/config/src/daily.ts`) and the clan founding cost
(`packages/config/src/clans.ts`). All of them are guesses until somebody plays
the game.

| Constant | Current | What it controls |
|---|---|---|
| `vaultProtectionOf(level)` | `0.2 × CAPACITY(level)` | How much each Vault shields from raiders |
| `LOOT_SHARE` | `0.2` | Share of a defender's unprotected stock on the table |
| `LOOT_CEILING` | `250,000` | Ceiling on one raid's take |
| `SCOUT_REROLL_COST` | `50` gold | Price of rerolling a scouted opponent |
| `BUILDERS` | `3` | How many jobs can run at once |
| `buildSeconds` | `sqrt(gold + iron × 2) × 1.2`, capped at 600s | The whole timer curve |
| `finishNowCost` | `max(10, remaining × 3)` gold | Price of skipping a wait |
| `stageFromTrophies` | one stage per 120 trophies | How hard a generated garrison is |
| `RAMPART_COUNT_GROWTH` | `1.012` | Whether a full rampart wall is reachable — see above |
| `DEMOLISH_REFUND_RATE` | `0.5` | What comes back when a building comes down |
| `HERO_BASE` + growth | 1400 hp, 55 dmg; ×1.18 / ×1.15 per rank | How much a hero swings a raid |
| `heroRespawnMinutes` | `10 + level × 5` | What losing the hero costs |
| `HERO_UNLOCK_KEEP_LEVEL` | `3` | When a hero first appears |
| `TROOP_POWER_STEP` | `0.12` per level | How much the War Lab is worth |
| `troopUpgradeCost` | derived from each troop's own price, ×1.8 per level | Lab pacing |

`stageFromTrophies` (one stage per 120 trophies) is also a judgement call: it is
what converts PvP matchmaking back into the `stage` the prototype's trophy
formulas expect, so §6's reward numbers could be kept exactly.

## Performance

The prototype's frame cost was 0.58 ms with roughly 30 structures and 16 units.
The port keeps what made that possible: procedural art with no asset pipeline,
exact screen-space culling, one depth-sorted draw list per frame, device pixel
ratio capped at 2, and no React state on the render path — the world is a single
mutable ref driven by `requestAnimationFrame`, and buildings are not components.

Measured: a 430 x 900 viewport at DPR 2, mid-raid against a 46-structure base
with 21 units and projectiles in flight, held a locked 60 fps over 230 frames —
median, p95 and max frame interval all 16.7-16.8 ms.

That was a small base. A maxed one is a
different game: 164 structures, Keep 8, 120 ramparts, on a 412 x 892 phone
viewport. Under Chrome's CPU throttle — the standard stand-in for a mid-range
handset, at 4x — that base ran at **10 fps**, and setting graphics to low
changed nothing. A single frame was issuing about 4,700 canvas path operations.
Three things were wrong:

1. **Buildings were never culled.** Deco was, units were, structures were not:
   every building went into the draw list every frame whatever the camera was
   looking at.
2. **Static art was redrawn every frame.** A rampart's fifteen paths do not
   depend on the clock, and there were a hundred and twenty of them.
3. **Low quality only skipped the treeline**, which the measurement proved was
   never the cost.

What it does now: each structure's static art is rasterised once per
(type, level, livery, size) into its own canvas and blitted — see
`apps/web/lib/render/sprites.ts`. Only the parts that actually move — banners,
forge smoke, the lab's vapour, a cannon's barrel — are still drawn as paths, and
`ANIMATED` in `buildings.ts` names exactly those types. The treeline is cached
the same way, a tree in two pieces so its canopy can still sway. Sprite bounds
are measured from the art by rendering it oversized once and scanning the alpha
extent, rather than from a table that would be wrong the first time anyone
changed a roof height. The sprite's scale is derived from a whole number of
device pixels, which makes the blit a one-to-one copy: no resampling, and the
outlines come out marginally crisper than drawing straight to the frame.

Two other things were pure overdraw. The terrain laid down three full-screen
fills — a sentinel rect and two diamonds each wider than the viewport — before
anything else; when the field already covers the screen, which is nearly always,
one rect now does it. And the apron was painted a tile at a time, up to 432
diamonds, in the same green a diamond above it had already laid down.

Low quality now also drops the device pixel ratio to 1. Fill cost is quadratic
in pixel ratio, so that one line is worth more than every path the other two
savings put together, and it is what turns the setting from cosmetic into the
thing a player on a slow phone actually reaches for.

Measured after, same base, same viewport, `median frame interval (dropped of
180)`:

| | before | after |
| --- | --- | --- |
| no throttle | 16.7 ms (19 dropped) | 16.7 ms (0 dropped) |
| 4x — mid-range phone | 99.9 ms (180) | 16.8 ms (83) |
| 6x — slow phone | 150 ms (180) | 33.4 ms (178) |
| 4x, graphics low | 100 ms (180) | 16.7 ms (0) |
| 6x, graphics low | 150 ms (180) | 16.7 ms (0) |
| 4x, mid-raid | — | 33.3 ms (152) |

CPU time per frame, which unlike the interval above is not quantised to the
display's cadence, went from 8.2 ms to 5.2 ms at full quality and 2.1 ms on low;
the JavaScript half of that is now 1.0 ms.

`apps/web/test/render.test.ts` guards the invariant the cache rests on: the
static half of a building must draw identically whatever the clock says. If
someone puts a flicker in a forge's body, the frame it happens to be rasterised
on is baked into the bitmap and every forge in the game freezes on it, and
nothing about the code would look wrong.

This is still headless Chromium in a container, and the throttle is a proxy for
a phone, not a phone. It is also a pessimistic one in a specific way: there is
no GPU here, so every pixel is filled on the CPU, which is exactly the work a
real handset's canvas implementation hands to hardware. §10 asks for 60 fps on a
mid-range Android handset and that measurement still has not been taken on one.
It remains the one that matters.

## Scale

The other unknown was what happens with a real population behind the
matchmaker, so `apps/api/scripts/seed-scale.ts` seeds one: N players with a
long-tail trophy distribution, a fifth of them shielded, layouts pruned for
overlap. `apps/api/scripts/scale-check.ts` then measures the endpoints a session
actually hits and asserts the two things that would be silently wrong.

At 5,000 players: `/me` 10 ms median, `/raid/find` 19 ms median and 23 ms p95,
`/leaderboard` 7 ms, thirty concurrent matchmaking requests in 177 ms with no
failures. Essentially flat against 500. And the assertions that matter held:
**zero open raids against a shielded player, zero against oneself.**

It surfaced two real bugs, both now covered by `apps/api/test/limits.test.ts`:

1. **Rate limiting was keyed on IP address.** Behind carrier-grade NAT that is
   one budget shared by a city. It is keyed on the player now, with the address
   as the fallback for requests that have not identified themselves yet, which
   needs the player resolved in an `onRequest` hook before the limiter runs.
2. **A 429 was being turned into a 500** by the error handler, so a client could
   not tell "slow down" from "the server is broken" — and neither could the
   scale test, which is how it was found.
