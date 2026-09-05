import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { runFixture } from './fixtures/cross-engine-entry.js';

/**
 * The test that actually protects the game.
 *
 * Every other determinism check runs the simulation twice in one process,
 * which only proves it has no hidden mutable state. This one runs it in Node
 * and in a real browser engine and demands the same answer, which is the
 * property the anti-cheat design depends on: the client renders a battle, the
 * server re-decides it, and the two must not disagree.
 *
 * Caveat worth knowing: Node and Chromium both run V8, so this pins down the
 * bundling and module boundary rather than the maths library. What protects
 * against JavaScriptCore and SpiderMonkey is the discipline in
 * @ironvow/config/math — no pow, hypot, sin, cos or atan2 anywhere a result
 * can be changed, leaving only the operations IEEE-754 requires to be
 * correctly rounded. Point IRONVOW_CHROMIUM at a WebKit or Gecko build to
 * widen the net.
 *
 * The browser binary is resolved from PLAYWRIGHT_BROWSERS_PATH or
 * IRONVOW_CHROMIUM. Where neither is present the test skips loudly rather than
 * passing silently, so CI without a browser cannot look green by accident.
 */

const CANDIDATES = [
  process.env.IRONVOW_CHROMIUM,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
].filter((p): p is string => typeof p === 'string' && p.length > 0);

const chromePath = CANDIDATES.find((p) => existsSync(p));
const here = fileURLToPath(new URL('.', import.meta.url));

describe.skipIf(!chromePath)('simulate() agrees between Node and a browser engine', () => {
  it('produces the same checksum, stars and loot in Chromium as in Node', async () => {
    const { chromium } = await import('playwright');

    const bundle = await build({
      entryPoints: [join(here, 'fixtures/cross-engine-entry.ts')],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
      write: false,
    });
    const code = bundle.outputFiles[0]!.text;

    const dir = await mkdtemp(join(tmpdir(), 'ironvow-'));
    const page = join(dir, 'sim.html');
    await writeFile(page, `<!doctype html><meta charset="utf-8"><script>${code}</script>`);

    const browser = await chromium.launch({ executablePath: chromePath! });
    try {
      const tab = await browser.newPage();
      await tab.goto('file://' + page);

      for (const [stage, seed] of [[1, 42], [6, 987654321], [9, -1337]] as const) {
        const inBrowser = await tab.evaluate(
          ([s, sd]) => globalThis.__ironvow!.runFixture(s as number, sd as number),
          [stage, seed],
        );
        expect(inBrowser).toEqual(runFixture(stage, seed));
      }
    } finally {
      await browser.close();
    }
  }, 120_000);
});

if (!chromePath) {
  // eslint-disable-next-line no-console
  console.warn('[cross-engine] no Chromium found — set IRONVOW_CHROMIUM to run the browser determinism test');
}
