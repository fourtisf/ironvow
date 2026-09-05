# CI

Two jobs, deliberately separate.

**`check`** builds, typechecks and runs everything against a real Postgres and
Redis. It sets `IRONVOW_REQUIRE_DB=1`, which turns a skipped database suite into a
hard failure: those suites skip themselves when `TEST_DATABASE_URL` is missing
so a contributor can run the pure tests with nothing installed, and a skipped
run still reports success — worse than a failure, because it looks fine.

**`determinism`** runs the simulation suite on its own and greps
`packages/sim/src` for `Math.pow`, `hypot`, `sin`, `cos` and `atan2`. IEEE-754
requires `+ - * /` and `sqrt` to be correctly rounded, so those agree on every
engine; it says nothing about the rest, which genuinely differ between V8,
JavaScriptCore and SpiderMonkey.

If that property breaks, a client renders one outcome and the server writes
down another for every battle in the game, and the only visible symptom is a
slow rise in the `Divergence` table. It gets its own job so it fails loudly
rather than as one line inside a longer run.
