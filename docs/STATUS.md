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
| Builders | 2 from the first minute, hired up to 10 for gold. Never purchasable with money. |
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
like a deploy that had not landed. Under the chip, in the faintest type on
the screen, is the moment the running build was made: twice a deploy landed
and looked exactly like one that had not, and a date answers that in a
glance without anyone reading markup. The card compresses on a short window — a laptop at 150% scaling
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

### The opening was a wait

The first player to reach the second War Order had 120 gold left and nothing
to do but watch a mine. Three numbers moved, all TUNABLE and all in
`packages/config/src/economy.ts`:

| | was | now | why |
| --- | --- | --- | --- |
| `START_GOLD` / `START_IRON` | 900 / 320 | 3,000 / 1,200 | The first four War Orders ask for 1,753 gold and 340 iron between them; 900 did not cover two of them. |
| `BASE_STORAGE` | 2,500 | 4,000 | A full mine was waste before the first Vault. |
| `STOCK_BUFFER_MINUTES` | 12 | 120 | A Gold Mine stopped at 444 gold, so the hold earned while it was watched and barely at all while it was not — the opposite of the promise on the first screen. |

The opening now runs: second mine, Cannon, Forge and a Keep to 2, with 1,247
gold and 860 iron still in hand.

Two tests failed on this and both were right to: they asserted the literals
`900` and `2500` rather than the constants. They read the constants now.

## The purse, and what a building looks like

Two complaints, one session, and they turn out to be the same complaint: the
game did not feel like it was giving anything back.

**The purse.** A new hold started on 900 gold and 320 iron against a first
upgrade that costs several hundred, so the opening move was to wait. Producers
also stopped filling long before a player who checks in once a day came back:
the buffer above the collectable stock was twelve minutes, then two hours, and
a hold left overnight was earning nothing for most of the night. Now:

| | before | now |
|---|---|---|
| `START_GOLD` / `START_IRON` | 900 / 320 | 6,000 / 3,600 |
| `BASE_STORAGE` | 2,500 | 40,000 |
| `mineRate(level)` | `18 + level × 12` | `40 + level × 26` |
| `forgeRate(level)` | `9 + level × 7` | `22 + level × 16` |
| `CAPACITY(level)` | `1200 + level × 1200` | `12000 + level × 12000` |
| `STOCK_BUFFER_MINUTES` | 12 | 240 |

The starting purse now covers the first four War Orders and leaves 4,247 gold
and 2,060 iron, which is the difference between opening the game and opening a
waiting room. `START_GOLD` and `START_IRON` are asserted below `BASE_STORAGE`
at module load: a hold that starts over its own cap silently loses the
difference on the first write, and that is not a bug anyone would find by
reading the balance table.

Existing holds keep the resources they already have — the constants only apply
where they are read, and a hold's stock lives in its own row.

**What the opening purse actually buys.** Asked to check it covered the
tutorial, `apps/api/test/economy.test.ts` now walks the whole thing. The four
coach steps — tap the Keep, look around, collect, move a Gold Mine — cost
nothing. The first nine War Orders ask for a second Gold Mine, a Cannon, five
Raiders, a Keep upgrade, an Iron Forge, eight Ramparts and a warband: 2,660
gold and 425 iron in total, against 6,000 and 2,400 in hand. The purse never
falls below **5,462 gold**, and because the rewards outrun the costs the nine
orders together leave a player **262 gold and 374 iron better off** than they
started. Nothing in the opening is a wait.

**And the bug that check found.** A Gold Mine makes 66 gold a *minute* at level
1 and holds four hours of it, so a player coming back in the morning was
offered 15,840 gold from one mine — against a storage cap of 9,000 with 6,000
already in the purse. All but 3,000 of it was discarded on collection. That is
bug #1 one layer up: the game showed a full pouch and took most of it away, and
neither number looked wrong on its own. `BASE_STORAGE` is now sized against the
producers rather than against the purse (40,000 banks a full night from two
mines with the starting purse untouched), `CAPACITY` moved with it so a first
Vault still adds sixty per cent rather than a rounding error, and
`packages/config/src/economy.ts` throws at module load if a full level-1
producer no longer fits in the room a new player has. Asserted again in the
economy tests, at the one moment a player has no Vault and no way to make room.

**What a building looks like.** The Gold Mine was a hut with a cart beside it,
which is a hut, and level 9 was level 1 with a bigger number floating over it.
Every producer and defence is now drawn from what it actually does, and every
building is drawn at one of four tiers — levels 1-2, 3-5, 6-7, 8+ — that change
the structure rather than the paint:

- **Gold Mine** — a terraced pit sunk into the dirt with the seam glinting in
  the wall of each step, a headframe standing over the shaft with a winch wheel
  and a bucket on a rope, rails with sleepers, an ore cart heaped with gold, and
  spoil heaps beside it. Timber prop → grey steel derrick → braced derrick over
  a deeper pit → gilded.
- **Iron Forge** — a furnace block with a glowing arched mouth, an anvil, ingot
  stacks that grow with the tier and a quench trough. One chimney → two →
  stone-clad with three → gilded caps. Smoke rises from each chimney the body
  actually drew.
- **Vault** — a wooden chest with a banded lid and coins, then a stone vault
  with a spoked wheel door and gold bars stacked beside it.
- **Keep** — four squat turrets, then taller turrets flying pennants, then a
  lantern storey standing above the roof, then the whole crown gilded. The
  banner flies from whichever ridge the body drew, lantern included.
- **Barracks** — a longhouse that gains a stone footing and a second storey,
  with another spear on the rack each tier.
- **War Lab** — crystals stood on the plinth, one a tier, and an observatory
  turret capped with a crystal once it is more than a shed with a pot in it.
- **Cannon**, **Arrow Tower**, **Rampart** — sandbags then iron plate, another
  arrow slit each tier, and a gilded roof at the top.

Three things this needed underneath:

1. `isoBox` gained a `base` argument, so a storey can be stacked on a roof.
   Without it every block starts at the plinth, and a Keep with a lantern above
   its hall could only be drawn as a spire growing out of the earth through the
   middle of the building. That was the bug behind the black spires on the first
   attempt: `isoBox` was being used to draw a cap and was drawing a whole box
   from the ground up. A flat cap is `isoDiamond` at a height.
2. `pipHeightOf` now clears the art. The tiers do not just scale a building,
   they add to it, so scaling `PIPH` by growth alone buried the level pip in the
   roof of exactly the buildings a player most wants to read the level of.
3. Everything in `drawBuildingFx` that hangs off the body — the Keep's banner,
   the Barracks' banner, the Forge's smoke, the Lab's glow — is derived from the
   same expression the body uses, not a copied literal. Smoke rising from where
   a chimney used to be is worse than no smoke at all.

`apps/web/app/art/page.tsx` is the workbench this was built on: every type down
the page, levels 1/3/6/9 across it, one camera per cell. The art is procedural
and varies with level, so the only way to see whether a level-6 Gold Mine reads
as a bigger level-3 one is to put them side by side, and playing to level 6 four
times is not a way to work. It is not linked from anywhere and is not part of
the game.

## Light, materials, and a wall that is a wall

The tier work above changed what each building *is*. This changed what all of
them are *made of*, because the answer was "one flat colour with a black line
round it", which reads as a diagram however good the silhouette is.

It is one change in `apps/web/lib/render/primitives.ts`, so every structure in
the game gets it at once:

- **Every face is lit.** A vertical gradient down each wall, up each roof
  slope, and across each flat slab. `shade()` blends toward a warm sun or a
  cool shadow rather than multiplying toward black — multiplying turns every
  dark end the same muddy grey and loses the material.
- **Every face has a surface.** Stone gets courses with staggered joints,
  timber gets planks, roofs get tile courses with an eave board and a ridge
  catching the light. Which one a face gets is inferred from its fill colour: a
  handful of greys and browns *are* the material vocabulary of this palette, so
  one map does it without touching forty call sites. A colour that is not
  listed gets no texture, which is exactly the old look.
- **Every box has a rim.** A thin warm line inside the two edges the sun
  reaches. One stroke, and most of the difference between a solid drawn on a
  screen and a thing standing in a light.
- **Every shadow is soft.** A radial gradient with a dense core instead of a
  flat ellipse at one alpha, which is the tell of a sprite pasted onto grass.

**The Rampart is the one that needed more than paint.** A Rampart is its own
one-tile building, so nothing in the data says a run of twenty is a wall — and
drawn as an island each one was a waist-high crate with its top face doing most
of the talking. A base defended by twenty of them looked like a delivery. Now
`link` carries which of the four neighbours is also a Rampart: the block
stretches to the shared edge on those sides so a run merges into one length of
masonry, and it is narrowed across the run and left square at a corner, because
a wall is a wall by being much longer than it is thick. The coping is a course
of stone standing proud of it, with merlons on top.

The mask is part of the sprite cache key — a linked wall is a different shape,
not a different position — and there are only sixteen combinations. It is
recomputed each frame rather than cached on the world, because a Rampart
breached mid-raid has to stop joining its neighbour the moment it falls, which
is how a hole in a wall reads as a hole.

### Paying for it

All of this lives in `drawBuildingBody`, which is rasterised once per (type,
level, livery, link, zoom) and blitted from then on, so steady-state cost is
unchanged — it is the rasterisation that got dearer. The first version issued a
`stroke()` per course: about six hundred for one Keep, and it showed as a
longer worst frame the first time a base was drawn. Batching every line of one
colour into a single path fixed it. Measured on the attract field, 200 frames,
headless Chromium with no GPU:

| | before | after |
| --- | --- | --- |
| no throttle | 16.7 ms median, 0 dropped | 16.7 ms, 0 dropped |
| 4x — mid-range phone | 33.3 ms median, 66.6 ms worst | 33.3 ms median, 50–67 ms worst |
| 6x — slow phone | 50.0 ms median | 50.0 ms median |

Run-to-run variance on a shared container is wider than the difference, which
is the honest summary: the median did not move and the worst frame is back
where it was. Detail is also skipped below the size it would read at — courses
need 14 px of wall, tiles 16 px of slope — so a base seen from far out pays
none of it.

`apps/web/test/render.test.ts` had to learn about gradients. Its recorder
compares two draws at different clock values, and a gradient it could not
create threw; now each gradient gets an identity and its colour stops are
logged against it, so a stop that moved with the clock — the exact bug the file
exists to catch, baked into a sprite on whichever frame it was first
rasterised — still fails the test.

## Troops you can see the upgrade on

ALFA: "karakter army harus dibuat sebagus mungkin, dan bisa upgrade pakai
laboratorium — setiap upgrade beda design dan tambah bagus, besar."

A troop upgrade was the most expensive thing in the game and the least
visible. The War Lab took gold and iron and gave back a number in a sheet and a
slightly longer health bar; nothing on the field changed, and the only place
the purchase could be seen was mid-raid, in a crowd of twenty identical
figures. So the kit now carries the level, on the same four tiers the buildings
use — levels 1-2, 3-5, 6-7, 8+:

| | |
|---|---|
| Tier 0 | Cloth and leather, one pauldron, a cap |
| Tier 1 | Banded steel: breastplate, greaves, a brow band, a shield rim |
| Tier 2 | Plate: gorget, both pauldrons, a nasal bar, a plume, a cloak |
| Tier 3 | Gilded: gold plate, gold plume, gold buckle, gilded weapon |

Each troop's own gear grows with it too: the Raider's blade lengthens, gains a
fuller and a boss on the shield; the Archer's bow lengthens and recurves and a
quiver appears on the back; the Lancer's polearm gains a pennon; the Scaler's
grapnel grows a third and fourth prong; the Ram gains iron banding down the
beam, four wheels, a hide roof on posts and a third crewman. And every level
adds 2.2% of height, so an upgrade *inside* a tier still shows.

**Where a player actually sees it.** Three places, all drawn by the same
`drawUnit` the battle uses, so none of them can drift from the real thing:

- The **War Lab** shows each troop as it stands today and, faded beside it, what
  the next level turns it into. What the gold buys is on the button.
- The **ARMY roster** draws the troop on its tile at the level the Lab has taken
  it to, so the army screen is a barracks rather than a price list.
- The **battle tray** draws each troop at the level the raid was frozen with, so
  a warband is picked by looking at it.

The level reaching the field comes from `w.raid.troopLevels` — the levels the
server froze onto the raid, which are the same numbers the simulation used for
hit points and damage. The kit on screen is the kit that is fighting.

### Paying for it, again

Troops were the last thing in the renderer with no sprite cache, and the kit is
not cheap: on the workbench bench at `/art#bench` — twenty-eight units, fixed
scale, so the measurement does not depend on which opponent the matchmaker
produced — the tiered art cost **83 ms a frame at 4x throttle** against 50 ms
without it. Measuring that inside a real raid was useless and briefly
misleading: the unit count and the state of the fight differ between runs, and
the first comparison showed a regression that was mostly noise.

So the units were split the way the buildings were. The kit — everything from
the belt to the plume, plus the shield, the quiver and the rope coil — does not
move, so it is rasterised once per (type, level, livery, facing, detail, scale)
and blitted; only the legs, the weapon and the hit bar are still path work. The
cloak is a second sprite because the legs are drawn between it and the body.
The Ram has no moving part at all, so it is one blit.

| 28 units | before tiers | tiers, live | tiers, cached |
| --- | --- | --- | --- |
| no throttle | 16.7 ms (p95 33.3) | 16.7 ms (p95 33.3) | 16.7 ms (p95 16.7) |
| 4x — mid-range phone | 50.0 ms | 83.3 ms | **33.3 ms** |
| 6x — slow phone | 66.7 ms | 100.0 ms | **50.0 ms** |

Full detail, and cheaper than the art it replaced.

Two things had to be got right and both would have been silent:

1. **`detail` is part of the cache key.** A shape's bounds are measured once, at
   scale 1, and reused at every scale after. A troop first seen zoomed out —
   without its plume or its cloak — would have handed those bounds to the same
   troop seen close up and clipped the kit off at the edge of the bitmap.
2. **A flashing unit is not cached.** The hit flash repaints every colour, so
   caching it would mean a second bitmap for every troop in the game, for a
   state that lasts a fifth of a second. It draws live instead, which is also
   the path `drawUnitUncached` exposes so `apps/web/test/render.test.ts` can
   reach the painters without a DOM: it asserts a standing troop draws
   identically at two clock values (a painter that read the clock would freeze
   every troop of its kind on one frame) and that levels 1, 4, 6 and 9 really do
   draw differently — otherwise the tiers could silently stop working and
   nothing about the code would look wrong.

## The order you can afford

ALFA, playing the live game: 9,300 gold, **20 iron**, and a task list saying
"Raise a Cannon". A Cannon costs 80 iron.

Iron has exactly one source a player can build. Gold comes out of the ground
from the first minute — a new hold starts with a Gold Mine — but iron needs an
Iron Forge, and the hold does not start with one. So a player's iron only ever
goes down until they decide to put one up.

The War Orders asked for the Forge **seventh**, and for a Cannon **third**. A
player who had spent their opening iron was therefore told, by the tutorial, to
build something they could not pay for — and the reward for completing that
order was iron. The way out existed (the Forge costs gold alone, and the BUILD
sheet offers it from Keep 1) but nothing pointed at it, and the guide pointed
somewhere else.

The Forge is now the third order, before anything asks for iron at all:

| | |
|---|---|
| 1 | Collect from the mine |
| 2 | Build a second mine |
| 3 | **Build an Iron Forge** — 400 gold, no iron |
| 4 | Raise a Cannon |
| 5 | Train 5 Raiders |
| … | … |

The ids stay attached to their own order rather than to a position, because a
player's claimed orders are stored by id and renumbering them would hand
someone a reward they had already taken. The list is displayed and counted in
array order, so moving an entry is the whole change. The coach follows, since
it maps guidance by id.

Iron rewards roughly doubled across the run, and `START_IRON` went from 2,400
to 3,600 — iron is the scarcer of the two and always will be, so the opening
purse should reach the Forge comfortably rather than exactly. Walked in order,
iron now never falls below the 3,600 a player starts with: the nine orders pay
out 1,674 more than they cost.

**The guard.** `packages/config/src/quests.ts` throws at module load if any
order needs iron before the one that builds the Forge, or if the Forge itself
ever costs iron — it is the only way out of an empty iron purse. Both are
derived from the price tables rather than listed, because the failure comes
from two tables disagreeing and a hand-written list would be a third thing to
keep in step. Asserted again in `apps/api/test/economy.test.ts`, which now also
walks the opening in iron as well as gold.

## A constant only applies where it is read

ALFA, after deploying the fix above: "sudah deploy masih aja tidak berubah."

The deploy had worked — the guide in the screenshot was asking for an Iron
Forge, which is the change. What had not changed was **his own hold's 20 iron**,
because `START_IRON` is read once, when a hold is created. Raising it does
nothing for anyone already playing. Twice now a deploy had gone out that was
about giving players more, and the player who asked for it saw the same number
as before.

So `apps/api/src/lib/backfill.ts` brings every existing hold *up to* what a hold
created today would start with, once, on boot:

```sql
UPDATE "Player"
SET gold = GREATEST(gold, 6000), iron = GREATEST(iron, 3600)
WHERE gold < 6000 OR iron < 3600
```

A floor, never a ceiling. It cannot take anything away and cannot grant more
than a new player gets, which is the only version of this that is defensible: a
player who has been here since the first week should not be worse off than one
who signs up after a balance change.

Two ordering details, both of which have a wrong answer that looks fine:

- **The work happens before the marker is written.** Writing the marker first
  would record the job as done even if the update then failed, and nobody would
  ever be lifted. It is safe in this order only because the update is a floor
  rather than an addition, so a second run changes nothing — which is also what
  makes two instances booting together harmless.
- **A failure does not stop the server.** The call is wrapped: a database still
  coming up must not keep the API down, and since the marker is only written on
  success the next boot simply tries again.

`KEY` carries a version. When the floor moves again and every hold should be
lifted to the new one, the version is bumped; the old row stays as a record of
what ran and when.

Verified on a real boot: a hold on 9,300 gold and 20 iron came back with 9,300
gold — already above the floor, so untouched — and 3,600 iron. Set back to 5
iron and booted again, it stayed at 5. `apps/api/test/backfill.test.ts` asserts
both, and that a hold already ahead of the floor is left alone.

## A crew you hire, one quality, and music that is written down

Three things ALFA asked for in one sitting.

### The graphics switch is gone

It offered FULL or LOW and it was there for a real reason: when it was added, a
full base ran at 10 fps against a CPU throttled to stand in for a mid-range
phone. Since then the buildings and then the troops were both moved into the
sprite cache, and the numbers it was protecting against are not the numbers any
more — 28 units at full detail now cost 16.7 ms a frame unthrottled and 33.3 ms
at 4x, which is what the *reduced* setting used to cost. A switch that trades
away trees and banners to buy back time the renderer no longer spends is a
worse game for nothing, so it is removed and everything runs at full.

That took the branch with it. `drawTerrain` no longer takes a `detail` flag,
`drawStruct` no longer picks between the animated half and a cannon barrel, and
`World` has no `quality` field: one path through the renderer instead of two.

### Builders are hired, not handed out

A hold used to start with three builders and could never have a fourth. That is
two problems at once: nothing to spend a windfall on in the first week, and the
one upgrade in the genre a player actually *feels* — a third builder — was
already spent before they arrived.

Now a hold starts with **two** and hires up to **ten**, for gold. The price
starts at 4,000 for the third and rises 85% each time, so the tenth is about
297,000: steep enough that each one is a decision rather than a purchase made
the moment it is affordable, and the only upgrade in the game a brand-new hold
can save toward from its first hour. No Keep gate — a builder is not a
building, it is how fast the hold works — and gold only, so an iron-poor hold
can still buy its way to building faster.

`BUILDERS` was a constant read at the point of use, which is exactly the shape
of thing that cannot become per-hold without touching everything that read it:
`buildersFree` now takes the crew size, `PlayerView` carries it, and the column
carries a default of two. The migration gives **existing holds three**, because
that is what they have been playing with since the first day and taking one
away would be a balance change dressed up as a migration.

The crew sits at the top of the BUILD sheet rather than in a settings menu,
because it is the same decision as everything under it — gold, spent on the
hold — and because "why can I only build one thing at a time" is a question a
player asks while looking at exactly that screen.

### The music was bad, and it is worth saying why

"musik sangat jelek." It was, and all three faults are the ones generative game
music usually has:

1. **The melody was random.** Notes were picked from the chord each bar so that
   "nothing ever repeats exactly". That is precisely backwards: music is
   memorable *because* it repeats — a phrase you have heard before coming back,
   changed a little. Random notes over a chord are noodling. Both themes are
   now written out note by note.
2. **The chords were not chords.** The pad voiced `SCALE[degree]` against
   `SCALE[degree + 2]`, which is a third only when the degree happens to land
   right; at the sixth it was an octave. Triads are built by stacking scale
   degrees now, which is also what keeps every chord diatonic.
3. **Everything was a bare oscillator.** A sine with an envelope is a test
   tone. There is a reverb now — two and a half seconds of decaying noise in a
   convolver — and the instruments are small stacks: two detuned saws through a
   moving filter for strings, a sawtooth with vibrato that fades in for a horn,
   two triangles through a falling bandpass for a pluck.

And one that is not about notes: bars were scheduled with `setTimeout`, which
drifts by tens of milliseconds. Timing jitter is heard as sloppiness even by
people who cannot name what is wrong. It runs a lookahead scheduler now,
queueing onto the audio clock 0.4 s ahead, which is sample-accurate.

The score is modal, which is what makes it sound medieval rather than merely
minor. The hold is **D Dorian** — i–VII–IV–i, Dm–C–G–Dm, the major fourth
against a minor tonic — at 68 bpm, with no drums at all, because silence is
what makes a base feel like somewhere you are safe. The raid is **D Aeolian**
at 132 with war drums, i–VI–VII–i. Same tonic, one note different: the sixth.
That single semitone is the whole difference between a village at peace and one
under siege, and it is why both moods sound like the same place.

Mood changes duck the master for a quarter of a second rather than cutting,
because two keys and two tempos colliding on one frame is the worst sound the
game can make and it would happen at exactly the moment a raid opens.

`apps/web/test/music.test.ts` checks the parts of this that are wrong silently:
that each melody is exactly as long as its chord loop (a tune that drifts a beat
against its own chords plays quite happily and is wrong forever), that every
note lands on a half beat the sequencer actually looks at, that the two modes
differ in exactly one note, and that every chord builds a real triad. Measured
in the browser with an analyser spliced in front of the destination: the hold
runs at 0.05 RMS, the cut into a raid holds level rather than dropping to
silence, and the raid peaks at 0.13 — louder and punchier, as a raid should be.

## How far a Cannon shoots

A player choosing where to put a Cannon is answering exactly one question —
what does it cover — and the game was not showing them. The Inspector printed
"range 4.4" and left the player to imagine 4.4 of something on an isometric
field.

Defences now paint their firing envelope on the ground, and there are two
questions to answer, not one. *Where does this one reach* comes up while a
defence is being placed or is selected, and that one gets a bright ring with
the others faint behind it. *Is anything not covered* is about the whole hold
at once, so it is a switch — the button under the sound toggle holds every
defence's ring on until it is turned off. It is hidden until the hold has a
defence, because a button that does nothing is worse than no button.

Three weights, because a ring that is always the same brightness cannot say
which one is being decided about: `primary` for the one in hand, `shown` for
every defence while the toggle is on, `context` for the rest while one is
primary. The washes are additive, so ground covered twice comes out brighter
than ground covered once and ground covered by nothing stays green — a player
reads the hole without counting rings. It all goes down before the buildings,
since it is paint on the ground rather than something standing on it.

**It is the real envelope, not a circle that looks about right.** The
simulation fires on plain Euclidean distance in grid space, and a circle in
grid space is not a circle on this screen. With `isoX = (gx - gy)·TW/2` and
`isoY = (gx + gy)·TH/2`, substituting `u = gx - gy` and `v = gx + gy` into
`gx² + gy² = r²` gives `u² + v² = 2r²` — an axis-aligned ellipse with semi-axes
`r·TW/√2` and `r·TH/√2`, wider than it is tall in the same ratio as a tile.
`apps/web/test/range.test.ts` walks the ring at every 15° and asserts each
point sits exactly on it, that a step further out is outside and a step in is
inside, and that only defences have a range at all. A ring that lied would be
worse than none: a Raider standing just inside it would walk past untouched and
nothing about the code would look wrong.

### And the three console errors on the first screen

Found while checking the above. The BUILD stamp calls `toLocaleString`, which
answers in the container's time zone during the server pass and the player's in
the browser — Jakarta is seven hours from UTC, so the two strings never matched.
React does not merely warn at a mismatch: it discards the tree and rebuilds it
client-side, which is what errors #418, #423 and #425 were. The stamp is
rendered after mount now. The first screen's console is clean.

## One tap puts a building down

ALFA: "dan kenapa kalo sudah naro ga auto ke build bangunannya?"

Because it took two taps, a long way apart. Tapping the ground moved the ghost;
building it needed a second tap on a bar pinned to the bottom of the screen —
so a player who had already decided where the Cannon goes had to travel to the
other end of the phone to say so again. The second tap was not a decision
anybody was making.

A tap is the whole gesture now. Tapping open ground puts the building there and
starts it going up; tapping the ghost itself means "yes, here". Dragging still
only repositions, so anyone lining a Rampart up against a wall can nudge it as
long as they like before committing, and the bar stays for CANCEL and for
anyone who reaches for PLACE out of habit. Moving a building works the same
way: pick it up, tap where it goes.

**A tap only ever commits a legal spot.** That check used to be visible — a
greyed-out button over a red footprint — and with the confirmation gone it is
the only thing between a stray tap and a Cannon dropped on the Keep. So
`apps/web/test/placing.test.ts` now asserts it directly: open ground is
placeable, an overlap is not, a building being moved may sit back down on its
own cells (otherwise nudging one a single tile would be refused by its own
footprint), and a tap in the far distance is pulled back to the nearest legal
cell rather than starting a job off the map. That last one matters more than it
did: the ghost is clamped inside the field, and one-tap placement means the
clamp is now load-bearing.

## Train MAX, and a field to stand the army on

ALFA: "harus ada setingan latih max dan harus ada lapanhgan kaya coc yang
kumpulin armnya"

Two asks, one subject: the army was something you did paperwork for and then
could not see.

**Training a warband was fourteen taps.** The server had accepted a `count`
since the day training was written — `POST /train` takes 1 to 50, checks every
unit against the camp and the purse, and queues what it can afford — so the
whole of the ask was a control the finger could reach. The ARMY sheet now has a
×1 / ×5 / MAX selector in its head, and each troop card trains that many. MAX
is not a magic number: it is `floor((armyCap - armyUsed) / slots)`, the honest
answer to "how many more of these fit", capped at the 50 the route accepts. One
tap took the queue from nothing to thirty-two in the browser.

**And then the warband was still a number on a sheet.** Fourteen Raiders looked
exactly like none, which is a strange thing in a game where half of what a
player is proud of is the army. So they stand on the grass now: a parade ground
of packed earth with a rope line and four corner posts, with the warband ranked
up on it in the kit its War Lab paid for. (The ground was painted in front of
each Barracks at this point. It is a building of its own in the next section —
the same picture, bought and upgraded rather than conjured.) It is derived from the roster every frame rather than remembered, so it
costs nothing to keep honest — train one and a figure appears, lose them on a
raid and the yard empties, and what is standing there is exactly what a raid
will field. The figures sort with the buildings by depth, so one in front of
its hall is drawn over it and one behind is drawn under.

Two things went wrong on the way, and both are now in
`apps/web/test/muster.test.ts`:

1. **A gap that looks generous in grid units is not.** The first layout used
   0.62 of a tile and rendered as one mass of helmets. A figure is about 34
   device pixels across at zoom 1 and one step sideways in the grid is `TW / 2`
   — 32 — so shoulders were inside each other before the second rank existed.
   It is 1.5 tiles now, and you can count them.
2. **Centring the field on the hall's `gx` slid it half its depth to the left.**
   The screen's horizontal axis is `gx - gy`, not `gx`. The layout is done in
   the projection's own axes — `u = gx - gy` across, `v = gx + gy` into the
   screen — which puts the field under the hall it belongs to and starts it
   exactly where the hall's south corner ends. The test asserts both, plus that
   every figure lands inside the ground that was painted for it, that the yard
   is capped at twenty-four (past that it is a crowd, and nobody counts a
   crowd), and that a second Barracks gets half the warband rather than a
   number that went up.

## The field is a building now

ALFA: "lapanganya harus di beli dan awal pemain udh dpt 2 maximal 10 bisa beli
setiap beli harga naik dan bisa di upgrade juga ke level 10 tambah besar dan
tambah beda designya"

The parade ground above was scenery. It appeared because troops existed; it
could not be bought, moved, upgraded or destroyed, and it cost nothing. Scenery
is the one thing a base builder cannot afford to make of the army, because room
for troops is one of the two things a player is ever saving up for.

So it is a building: the **Muster Field**, four cells square, `camp` in the
code. It is bought at a price that climbs with how many you already own
(`1.55^owned`, the same curve as everything else), placed and moved where you
want it, upgraded with the Keep, and knocked down in a raid like anything else
standing on the ground. Two come with a new hold and ten is the ceiling, which
is the cap table's Keep 1 and Keep 9 rows, asserted against `STARTING_CAMPS` and
`MAX_CAMPS` at module load so the two ways of writing the same promise cannot
drift apart.

**Warband room moved off the Barracks and onto the field.** It had been one
building doing two unrelated jobs — deciding *which* troops exist and *how many*
— which meant there was no way to buy room without also buying another trainer.
The Barracks keeps the job it was always better at: training, and gating which
troops unlock. Two level-1 fields is 16 slots, a little over the 14 the opening
Barracks used to hand over, so the tutorial's five Raiders still fit and then
some; ten level-9 fields is 320, which is exactly where the old ceiling of five
level-9 Barracks stood.

**Every hold that already exists gets its two.** A hold raised before this owns
no fields, and left alone would have opened to a warband capacity of zero, an
army over its own limit and a TRAIN button that refuses — the game breaking, not
a balance change. `backfillMusterFields` tops each one up on free ground beside
its own Keep, through the same free-spot search a new base is seeded with. Like
the purse backfill it is a floor and it runs once: a hold that has already
bought fields is left exactly as it is.

**What a level buys is the ground.** The middle has to stay empty — the warband
stands on it — so the upgrade is spent around the edge: bare earth roped off
between four posts, then a gravelled yard behind a paling, then flagstone inside
a palisade, then flagstone with a gilded kerb and a pavilion at every corner.
The yard widens toward its own plot as it rises, one more tent appears each
tier, and there is a fire in the pit on the north-east run. Levels stop at
KEEP_MAX, which is 9 — nothing in a hold may outrank its Keep, and a field that
could would be the only thing in the game that does.

The troops stand on it, six to a field in two ranks of three. That is far fewer
than a field holds, and deliberately: nine of them hid the field they were
standing on, which is the thing the player actually bought. The rest are not
drawn — nobody counts a crowd, and it is also what keeps ten fields from costing
a frame a hundred sprites.

Three things this broke, all now covered:

1. **Every training test in the API suite was passing for the wrong reason.**
   The fixtures laid down a Keep, a mine and a Barracks, so once capacity moved
   the fixture's capacity was zero — and `planTrain` answers `warbandFull` at
   zero for every input, which is what three of those tests were asserting. The
   fixtures lay down the opening two fields now, and `economy.test.ts` asserts
   from the other side as well (a warband with room in it trains) so a zero
   cannot pass silently again.
2. **The muster was laid out on the Barracks.** It follows the fields now, and
   `muster.test.ts` pins that every figure lands inside the four cells of its
   own field and clear of the corners the tents occupy.
3. **A generated opponent had no camp.** Garrisons from stage 2 up carry one to
   three, added after the producers so they take leftover ground rather than
   pushing a mine off the layout.

## Four things a raid was not telling anybody

ALFA, over one session, from inside a raid:

> "mengapa tidak bisa kerahkan pasukan?? kalo kaya gni lebih baik persegiin
> garis merah loh apakah anda paham??"
> "dan animasinya harus ada kalo mukul atau yang lain"
> "dan kalo misal buka chrome lain otomatis berhnti nyerang mengapa"
> "nextnya juga ga pindah apa2 ga ada kerajaan yang baru dan harusnya ketika
> pilih harus beda gold dan dll juga beda"

Four separate complaints, and every one of them turned out to be a thing the
game already did and never showed, or wiring that was in place and connected to
nothing.

**The no-deploy zone was invisible.** A tap inside a structure's footprint plus
`DEPLOY_CLEARANCE` is refused, and all the player got back was "Too close to
their buildings" — which answers "why did that fail" and never answers "then
where". Tapping around a base hunting for a legal cell is not a decision anybody
is making. The zone is painted now, and painted from the same constant the
simulation refuses on: `DEPLOY_CLEARANCE` and `DEPLOY_MARGIN` moved out of
`simulate.ts` into the config, because a boundary drawn from a second copy of a
number is a boundary that will one day be a lie.

It is the union of a circle per building rather than one rectangle round the
hold, and that is a deliberate difference from what was asked for: a rectangle
reads more cleanly, but it colours in a great deal of ground the server is
perfectly happy to take troops on — a base with two Muster Fields at opposite
corners has a lot of legal grass between them, and a boundary that lies in the
"you may not" direction costs the player real options.

Getting one clean line round that union is the whole of the work. Stroking the
circles draws the arcs buried inside the blob too, and a zone with lines across
the middle of it reads as several zones. Clipping does not rescue it either:
"outside the union" is not expressible in either fill rule once three circles
overlap — under non-zero, ground covered twice winds to −1 and comes back;
under even-odd it comes back at three. So the band is cut where boolean geometry
actually exists, on a layer of its own: fill the union, then erase the union
shrunk by the line width, and what is left is exactly the boundary. It is cached
on the camera and only the union's own bounding rectangle is ever cleared or
blitted, because clearing a phone's whole backing store every frame to outline a
base that covers a third of the screen is three megapixels of work for nothing.

**Two animations were wired up to nothing at all.** `unitSwing` and `unitFlash`
were both created, decayed every frame and read by the renderer, and neither was
ever written to. Every weapon painter in the game takes a swing and rotates on
it; every troop in every raid stood at a wall holding its sword out horizontally
for the whole fight, and a Raider under cannon fire looked exactly like a Raider
standing still.

The swing is derived rather than stored, because the simulation already knows:
`cd` is the attack cooldown, reset to the weapon's full period the instant a
blow lands. `cd / period` is one exactly when the unit strikes and falls to zero
as it recovers — a fast strike and a slow follow-through, which is what a swing
is, and it cannot drift out of step with the damage because it *is* the damage
clock. The bow reads it backwards, since an arrow leaves as the string is
released, and the ram has no arm to swing so the whole engine lunges instead —
by moving the cached sprite, so a siege costs no more to draw than it did when
it was doing nothing visible. The flash now follows unit hit points the same way
it has always followed a building's.

**A raid stopped the moment the window lost focus.** `requestAnimationFrame`
does not fire in a background tab, and the delta on the way back was clamped to
50 ms so nothing would teleport — so two minutes in another window advanced the
battle by a twentieth of a second. The troops did not pause politely; the timer
in the corner is the same clock, so the whole attack stood still. There are two
clocks now and they are not the same clock: everything the eye follows keeps the
clamped delta, and the battle takes real elapsed time. `stepBattle` paces the
backlog at up to eight seconds of battle per frame, so two minutes away is paid
off inside a quarter of a second of wall time, and it goes quiet while it does —
a wall of sword-hits from ninety seconds ago is not information. Every tick still
happens, in order, so the commands the server replays are the ones that were
played.

**Every generated garrison was the same garrison.** `generateBase` was seeded on
the stage and nothing else, so every opponent a player at a given trophy count
could ever be shown was one base, cell for cell, holding one purse to the coin —
only the name over it changed. NEXT charged fifty gold to redraw the same
picture, which is the worst thing a paid button can do. The seed is threaded
through now and it moves more than the noise: which of three layouts the hold
uses, how far each ring sits, how many of everything, the level of each
individual building, and the purse, which swings by a third either way with gold
and iron drawn separately. `seed` defaults to zero, which reproduces the one
fixed layout the older tests were written against, and `garrisons.test.ts`
asserts that twenty-four seeds give at least twenty-two different bases and
twenty different purses — while every one of them still has a Keep, defences,
producers and a wall, and no building outside levels 1 to 9.

## Watching a raid, and being handed a building

ALFA, twice more:

> "kasih estimasi waktu selesai dan ada percepat 1x 2 x sampai 4x"
> "saya baru ngerjain task d suruh bangun mala ga ada bangunan perbaiki ini
> harusnya ada tugas kita cuman mindahin ke tempat yang kita suka aja"

**A raid you have already decided is the part of the game nobody enjoys.** The
tray is empty, the warband is committed, and there is a clock counting down from
two and a half minutes while four Raiders finish a wall. Worse, the clock is the
wrong number: it says when the raid *may* end, not when it will.

Two things now. A speed control — 1×, 2×, 3×, 4× — which multiplies nothing but
how many ticks a second of real time is worth. Every tick still runs, in order,
and a deploy is still recorded at the tick it happened on, so the commands the
server replays are unchanged by it and a raid watched at four times over scores
exactly what it would have at one. It is remembered between raids, because a
player who wants four times over wants it every time.

And an ENDS IN box beside the clock, once there is nothing left in the tray:
remaining structure hit points over the damage rate of the warband still
standing, capped by the clock. It is deliberately an estimate and labelled as
one — it does not know how far a unit still has to walk or which of them are
about to be shot off the field, so it reads early on a base with long gaps and
late on one whose cannons are still up. It is shown in the player's own seconds
rather than the battle's, which is the point of it: forty seconds on the clock
at four times over is ten seconds of sitting there. A hero still in hand is the
one case that needs care — the simulation only calls a raid off early when there
is nothing left to send at all, so with one held back and nobody on the field the
answer is the clock, not zero.

**And the other one was a plain bug, of the worst kind: the game told them to do
something and then refused to let them.** A War Order said build a Rampart, they
opened BUILD, and the ghost arrived on "Blocked — pick another spot", sitting on
top of their own buildings. `startPlacement` had always dropped it four cells
south of the Keep, which was open ground right up until the day a new hold
started coming with two Muster Fields in exactly that spot. The first thing a
player following an order saw was a refusal, and the only way out was to guess
where the game would say yes.

A building is never offered on ground it cannot stand on now. It opens on the
nearest free footprint — the same outward shell walk the server seeds a new base
with, so both answer "where does this fit" the same way — and a tap on something
already built slides to the nearest free footprint within five cells rather than
doing nothing. A drag still shows the footprint red wherever the finger is,
because seeing what does not fit is how a player learns the shape of their own
base; it is only the moment of building that is forgiving. Picking an existing
building up leaves it exactly where it stands, because a move that begins by
teleporting the building is not a move.

Which is the shape ALFA asked for: the order puts the building in your hands,
and all that is left is moving it somewhere you like.

### And then the fix went too far

ALFA, next screenshot, ramparts sprayed in a diagonal blob across the middle of
the hold: **"palce klik2 mala jelek"**.

Two things in the change above were wrong, and both made a base look like
nobody had planned it.

**Sliding a blocked tap to the nearest gap is worse than refusing it.** It
sounds helpful and it is not: a stray tap beside a Rampart quietly lays another
one somewhere the finger was not pointing, and a player laying a wall along a
line gets a scatter instead. A tap now puts a building exactly where it landed
or nowhere at all, and the red footprint does the explaining — which is what the
footprint is for. The opening position was the real complaint and that fix
stays: BUILD still opens on ground the building fits on.

**And PLACE could build on its own.** A Rampart keeps the tool loaded so a run
can be laid in one go, but it re-armed four cells south of the Keep and then
went looking for the nearest free ground — so holding the button down walked a
spiral of walls outward from the middle of the hold, each one costing gold. The
tool now re-arms exactly where the last one was laid, which means it re-arms
standing on it: red, PLACE greyed out, and the bar reading "Tap where the next
one goes" rather than "Blocked", because nothing is wrong. Laying a run is
tapping along the line you want, and the button cannot lay anything by itself.

Twelve clicks on PLACE built twelve walls before. It builds one now.

## The army could already level up

ALFA: "saya ingin armya juga bisa upgrade naik level"

It already could, and that is the whole story. The War Lab has been in the game
since the day troop levels were added: one Lab, a row per troop, +12% hit points
and damage a level, kept for good and applied by the same `statsFor` the raid
runs on. The route is written, the cap rules are written, and
`progression.test.ts` has been asserting since then that a troop cannot outrank
its Lab and a Lab cannot outrank the Keep.

Nobody was ever told. No War Order pointed at it. The tutorial does not mention
it. The ARMY screen's only mention was a grey line — "No War Lab. Build one to
make your troops stronger, not just more numerous" — with nothing behind it: no
button, no price, and no word about the Keep level that unlocks one. A player at
Keep 2 read that, could not act on it, and reasonably concluded their army does
not level up.

A feature nobody is told about is a feature nobody has. So:

**The roster says the level out loud.** Every troop card in ARMY carries `Lv N`
opposite its count — what you own on one corner, how strong it is on the other.
The art already changed with the level (leather, banded steel, plate and a
plume, gilded); a coat of paint is not a number a player can plan around.

**The empty-Lab row does the job the hero row has always done.** It says what a
level buys, shows a Raider beside a faded level-5 Raider so the point is visible
before it is bought, and then either names the Keep level that opens a Lab or
offers a BUILD button that goes straight into placing one. The Keep level is
read out of the cap table rather than typed in, so it cannot drift.

**And there is an order for it.** `q13`, "Raise a War Lab", sits after the Keep 4
order — the Lab needs Keep 3, and an order a player cannot yet act on is worse
than no order. `quests.test.ts` asserts both halves of that from the cap table
and the reward totals: a Keep order for at least the unlock level comes first,
and the orders before it pay for the Lab.

End to end in the browser: ARMY → BUILD → the War Lab in hand → placed → five
UPGRADE rows → three taps takes the Raider from Lv 1 to Lv 4, and the badge on
the roster card follows.

## The hold behind the door

ALFA: "landing page gamenya yang sudah level semua maximal"

The attract screen was a generated garrison at stage four: level-three
buildings, a thin ring of walls, drawn in enemy red because that is what the
preview renderer had always been for. That is the first thing anybody ever sees
of IRONVOW, and it was showing them the middle of the game rather than the end
of it — none of the gilding, none of the pavilions, none of the art every level
is spent on.

It is a finished hold now. Every building at the Keep's own ceiling, laid out by
hand in `showcase.ts` rather than generated, because the door is the one screen
where composition matters more than variety: four-fold symmetry about the Keep,
a curtain wall with four gates, defences covering it from outside, an economy
ring, the army halls, four Muster Fields, and the statues and braziers only a
hold with nothing left to buy ever puts up.

**A showcase that breaks the game's own rules would be a lie about the game**,
so `showcase.test.ts` checks it is a hold somebody could actually own: nothing
overlapping, nothing off the field, no type over its Keep-9 cap, every building
at KEEP_MAX, one of each category present, and compact enough to frame. The
builder drops anything that would violate those rather than shipping a picture
of an illegal base.

**And it wears the player's own colours.** `renderPreview` had `enemy` hardcoded
to true, which is right for scouting — that is a hold you are about to hit — and
wrong here. The hold behind the sign-in card is the one somebody is being
invited to build, so it is blue and gold.

Two framings, because the two screens have nothing in common. A wide screen fits
the whole hold beside the card; that needed a zoom floor below `ZOOM_MIN`, which
exists so a *player* cannot fight a raid from orbit and has no business
constraining a login screen — `centerOn` takes an optional floor now and only
the attract screen passes one. A phone has about a hundred and fifty pixels
above the card, and a thirty-tile hold cannot be both inside that strip and
worth looking at: fitted, it is a smudge. So the phone gets a detail instead —
the Keep at the top of its levels, gilded, with the wall and the statues around
it. One good building beats a whole base nobody can make out.

## Every box in the game was missing a wall

ALFA: "bangunanya masih patah2 itu perbaiki"

They were right, and it was not the composition — it was `isoBox`, which draws
every solid in the game.

With `isoX = (gx - gy)·TW/2` and `isoY = (gx + gy)·TH/2`, the corner at
`(gx, gy)` is the **north** point of the footprint diamond, `(gx, gy + h)` the
west, `(gx + w, gy + h)` the south and `(gx + w, gy)` the east. The two faces
turned toward the camera are therefore the run west→south and the run
east→south. `isoBox` drew west→south — and *north→west*, which is on the far
side and can never be seen.

So the whole east half of every box in the game had no wall on it. The top face
floated over open ground and you could see the terrain, or whatever stood
behind, straight through the right-hand side of a Keep, a Vault, a Barracks, a
Cannon. It is why a hold read as a pile of slabs rather than buildings.

Nothing about the code looked wrong, which is why it lasted: the hidden face was
drawn first, the top face covered most of the evidence, and the outline made the
rest look deliberate. It was only obvious on a low wide box — the Vault, which
came out as a lid on stilts — and once seen it is in every screenshot in this
document.

`render.test.ts` pins it now, and pins it against the geometry rather than
against coordinates: the south corner is the box's lowest point and the place
the two visible faces meet, so exactly two filled shapes must reach it, one
running west of it and one running east. The old code reached it with one.

**And while it was open: the Keep was hollow too.** Its hall was inset 0.72 on a
three-cell footprint — a 1.56-cell tower standing between four 0.85-cell corner
towers, overlapping each of them by less than a fifth of a cell. They touched at
the corners and nowhere else, so daylight came through the middle of the Keep
from every side. The hall is inset 0.40 now: half a cell of overlap with each
turret, and the walls are walls.

## A code of your own, and the clanmate who answers

Two things went in together because they are the same shape: a reason to bring
somebody in, and a reason to stay once you are.

**Invitations.** ALFA was going to launch by handing out one access code in
replies on X, one person at a time. That is already a referral programme; it was
just one nobody was writing down. Every player has a code now (`inviteCode`,
drawn from an alphabet with no O/0, I/1 or S/5 in it, because these get read off
a phone screen and typed into another one), the door takes it as readily as the
operator's `ACCESS_CODE`, and the person whose code it was is credited.

Two rules keep it off the farms, and both live in `apps/api/src/domain/invites.ts`
rather than in a route:

- **The inviter is paid at Keep 3, never at sign-up.** A code that pays on a
  fresh account pays for account farms, and a launch farmed on day one is worse
  than one nobody joins. `settleInvite` hangs off the single line in
  `settleAndLoad` where a Keep level can change, so both the instant upgrade path
  and the timed one reach it on the very next read.
- **It is paid once, and the row enforces the once.** `updateMany` with
  `invitePaidAt: null` in the `where` clause *is* the lock; paying first and
  marking after pays twice under a burst, which `apps/api/test/invites.test.ts`
  fires fifty of.

The invited player gets a smaller welcome purse immediately. That half can be
paid at sign-up safely: farming it costs the farmer an account per payout and
returns less than the account is worth.

`openDoor` tries the invitation **first** and the operator gate second. The other
way round, `ACCESS_CODE` being set meant every invited player came in
uncredited — which is what the first version did, and what the test now pins.

**A garrison your clan fills.** A clan was a chat room with a war attached: you
could talk to people you would never otherwise interact with. `POST /clan/donate`
sends troops from your warband into a clanmate's hold, where they stand until
somebody raids it and then fight on the defending side.

The parts that had to be right:

- **Capacity is the Keep's, not the donor's** — `garrisonSlots(keepLevel) = 6 +
  lv*4`, and a donation is clamped to `garrisonRoomFor` rather than rejected, so
  two clanmates answering the same request at once both give something.
- **Both rows are locked in sorted order.** Donor and recipient are two players
  and the pair can be requested in either direction; sorting the lock order is
  the whole of the deadlock prevention.
- **The donor is paid for it** — `donationReward` returns gold by troop supply,
  because a donation that costs the donor their own next raid is one nobody
  makes twice.
- **The garrison is spent, not permanent.** A real raid clears it; a war raid
  does not, because war attacks are scheduled and clearing on the first would
  make the donation a lottery on attack order.

Placement is the server's (`placeGarrison` in `apps/api/src/domain/raid.ts`): a
ring round the Keep, seeded off the raid's own seed, so the attacker cannot learn
the standing spots from a previous raid on the same hold, and so a replay of a
raid puts them back exactly where the live fight had them. The sim spawns them
before the first tick rather than releasing them on a trigger — a garrison the
attacker cannot see coming is one they cannot play around, and playing around it
is the point.

## The ladder ends, pays, and starts again

Trophies had a top and no bottom of the calendar: a number that only ever goes
up, which stops being a competition roughly a month in, because the people who
started first are permanently ahead of the people who play better. A season is
the fix — the board is paid out and pulled back to a floor on a fixed clock, so
climbing is something you do repeatedly rather than once.

Three decisions carry it, all in `packages/config/src/seasons.ts` so the worker
that closes a season and the banner that counts down to it cannot disagree:

- **You are paid on the highest you reached, not where you finished.** Paying on
  the final number makes the last night of a season the only one that matters
  and rewards sitting on a total instead of pushing it. `seasonPeak` is a
  watermark moved in the same write that moves the trophies, so a lost raid
  leaves it exactly where it was.
- **The reset keeps the floor and half of everything above it.** A full wipe
  throws away the season's work; no wipe is not a season. A hold *below* the
  floor is left where it is rather than raised to it — a season must not be a
  way to gain trophies by losing them.
- **Nothing is paid below the first band.** A season reward every account
  collects for existing is a faucet, not a prize.

The bands run Stone → Iron Crown, 200 to 3,800 trophies, 2,000g to 75,000g.
Payouts go through `grant` and are capped by storage like every other payout in
the game.

**Closing is one transaction, and that is the deliberate part.** It is not the
cheapest shape — a few thousand player rows go through it — but it is the only
one where "paid but not reset" and "reset but not paid" are both unreachable,
and it runs once a fortnight rather than once a minute. The claim is
`updateMany ... where closedAt is null`: two workers reaching the same due
season each issue that statement and exactly one gets a count of 1, so the
other returns without paying anybody. `apps/api/test/seasons.test.ts` fires
three closes at once and asserts one receipt.

The reset itself is a single raw `UPDATE`, because a per-row loop over every
player in the game is the one part of this that would not stay fast. It
duplicates `seasonReset`'s arithmetic in SQL, so a test walks every tier
boundary through the real close and compares the row against the pure function
the client previewed it with.

One smaller thing worth writing down: the next season starts from the previous
one's **scheduled** end, not from when the worker noticed. Otherwise a worker
that was down for three hours moves every future season three hours later,
permanently — and that error accumulates.

## Something to decide during a raid

Everything else in IRONVOW is decided before the fight. The warband is trained,
the hero is levelled, the base is scouted — and then three minutes run their
course with nothing left to decide but where to tap. Battle items are the
decision you make *inside* a raid, and, because there are two of them solving
opposite problems, a decision about what to bring as well.

- **Warhorn** (2,600 gold, Keep 4): a circle on the ground. Attacking troops
  standing in it move 1.55× and hit 1.45× for eleven seconds.
- **Firepot** (1,900 iron, Keep 5): bursts once. 1,250 damage in the circle, and
  three times that to a rampart — a flat number that dents a Cannon does nothing
  at all to a wall, and burning a hole in the ramparts is what a Firepot is for.

Three rules make them safe to add to a deterministic simulation, and they are
the whole design:

- **An item is a command, not an effect.** The client sends "Warhorn at
  (24.5, 31.2) on tick 900". The server replays that through the same code and
  reaches the same fight. Nothing about what an item *did* crosses the wire, so
  there is nothing to forge. The commands are folded into the running checksum,
  so moving one by a grid cell changes the digest — `packages/sim/test/items.test.ts`
  asserts that.
- **The pouch is frozen onto the raid**, exactly like the warband and the hero.
  Buying a Warhorn while a raid is open cannot spend it inside that raid, and a
  replay years later still has the pouch the fight was fought with. Both halves
  ride on the replay endpoint: without the pouch, a replay would reject the very
  command the live raid accepted.
- **You are charged for what the simulation accepted**, never for the list the
  client sent. Ten Firepots submitted against one in the pouch is nine
  rejections and one charge, and the debit is taken from the *live* pouch rather
  than the frozen one, so two raids resolving out of order cannot restore an
  item the other spent.

A Warhorn is a circle with a lifetime rather than a mark on a unit. Nothing is
written onto a troop that a later tick would have to remember to undo; a unit
that walks in halfway through gets exactly what a unit that stood there from the
start gets, from that moment on. Horns do not stack, which is the rule that
stops "buy three and drop them on one spot" from being the only way anybody
plays. And the aura is read on the attacking side only — a horn dropped on the
defender's garrison must not make the attack go *worse*.

One thing had to move to make the tray honest. `useItem` takes the item out of
the pouch at the tap rather than when the tick runs, because a count that lags
by a tick lets a player arm and spend the same last Firepot twice, watch both
land, and then have one silently vanish when the server replays it. The tick
that applies it skips the debit for a command the battle scheduled itself.

Old raids need no migration and no version check: `items` is simply absent, so
they replay as raids where none were used.

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
