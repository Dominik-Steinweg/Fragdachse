import { openGame, installHooks, hud, stepFrames, recordShot } from './harness.mjs';
const { browser, page } = await openGame({ dpr: 2 });
await page.waitForTimeout(3000);
await installHooks(page);
await hud(page, false);
await page.evaluate(() => { window.__T.dev.clock.paused = true; });
await stepFrames(page, 30);
await recordShot(page, { out: 'shots/lobby_title_4k.mp4', frames: 480, native: true, quality: 95 });
await browser.close();
