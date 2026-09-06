// Rasterise the site icons and the share card. Playwright is a dev dependency
// of packages/sim, which is where it is borrowed from; set CHROME to a Chromium
// binary if the bundled one is not installed.
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { chromium } = createRequire(path.resolve(__dirname, '../../packages/sim/package.json'))('playwright');
const OUT = path.resolve(__dirname, '../../apps/web/public');
(async () => {
  const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const jobs = [
    // [source, output, width, height, transparent?]
    ['out/site-icon-rounded.svg', 'icon-32.png', 32, 32, true],
    ['out/site-icon-rounded.svg', 'icon-192.png', 192, 192, true],
    ['out/site-icon-rounded.svg', 'icon-512.png', 512, 512, true],
    ['out/site-icon-square.svg', 'icon-maskable-512.png', 512, 512, false],
    ['out/site-icon-square.svg', 'apple-touch-icon.png', 180, 180, false],
    ['out/site-og.svg', 'og.png', 1200, 630, false],
  ];
  for (const [src, out, W, H, alpha] of jobs) {
    const svg = fs.readFileSync(path.resolve(__dirname, src), 'utf8')
      .replace(/width="\d+(?:\.\d+)?" height="\d+(?:\.\d+)?"/, `width="${W}" height="${H}"`);
    const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await p.waitForTimeout(100);
    await p.screenshot({ path: path.join(OUT, out), omitBackground: alpha, clip: { x: 0, y: 0, width: W, height: H } });
    await p.close();
    console.log(out, `${W}x${H}`, fs.statSync(path.join(OUT, out)).size, 'bytes');
  }
  await b.close();
})();
