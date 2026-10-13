// Shot recipes. Each shot opens its own scenario, stages the action and records a 4K master.
// Action shots are overcranked (OC: half simulation speed per frame) so the edit can ramp freely
// between real time (every 2nd frame) and slow motion.
import { open, run, status, step, until, record, path, ramp, drift, krakenPos, playerPos, follower } from './harness.mjs';

const OC = 1000 / 120;
const KRAKEN = { version: 1, classId: 'dachs_nukem', mapId: 'kraken-abyss-lab', seed: 12345, timeOfDay: 780,
  suppressWaves: true, freezeMission: true, hideAim: true, hideTutorial: true };
const at = (s, gx, gy) => ({ x: s.metrics.offsetX + (gx + .5) * 32, y: s.metrics.offsetY + (gy + .5) * 32 });
const toGrid = (s, p) => ({ gridX: (p.x - s.metrics.offsetX) / 32 - .5, gridY: (p.y - s.metrics.offsetY) / 32 - .5 });
const world = (page, g) => page.evaluate(g => window.__C.world(g), g);
const shake = (c, f, amp = 2.5) => ({ x: c.x + drift(f, amp).x, y: c.y + drift(f, amp).y, zoom: c.zoom });
const mid = (a, b, t = .5) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** krakenMission restarts the scenario with defaults, so options and the player are staged afterwards. */
async function kraken({ skipIntro = true, player = { gridX: 35, gridY: 33.6 }, time = 780 } = {}) {
  const { browser, page } = await open(KRAKEN);
  await run(page, { action: 'krakenMission', skipIntro });
  await page.waitForFunction(() => window.devScenario.status().ready);
  await run(page, { action: 'quality', level: 'high' });
  await run(page, { action: 'options', values: { refillHp: true, hideAim: true, hideTutorial: true, timeOfDay: time } });
  await run(page, { action: 'teleport', ...player });
  await page.evaluate(() => { window.__C.cleanHits = true; });
  await step(page, 2);
  return { browser, page, s: await status(page) };
}
async function act(page, act, max = 900) {
  await run(page, { action: 'krakenAct', act });
  return until(page, s => { const a = s.krakenDevAction; if (a?.status === 'failed') throw Error(a.error); return a?.status === 'started'; }, max, 1);
}
async function session(open, body) { const ctx = await open(); try { await body(ctx); } finally { await ctx.browser.close(); } }
const enemy = (page, kind) => page.evaluate(k => window.devScenario.status().enemies.find(e => e.kind === k) ?? null, kind);

export const shots = {
  /** Cold open: still water, slow-motion eruption, pull back to reveal its size. */
  rise: (frames = 560) => session(() => kraken({ skipIntro: false }), async ({ page, s }) => {
    const pond = at(s, 35, 22), wide = at(s, 35, 26.5);
    await record(page, 'rise', frames, f => ({
      dt: 1000 / 60 * ramp([[0, 1], [40, .32], [300, .32], [380, 1]], f),
      cam: shake(path([[0, { x: pond.x, y: pond.y + 10, zoom: 2.7 }], [300, { x: pond.x, y: pond.y + 20, zoom: 2.95 }],
        [470, { x: wide.x, y: wide.y, zoom: 1.6 }], [560, { x: wide.x, y: wide.y - 10, zoom: 1.55 }]], f), f),
    }));
  }),

  /** It dives; arms burst out of the pond at the bank and hammer down next to the badger. */
  tentacles: (frames = 960) => session(() => kraken({ player: { gridX: 36, gridY: 34 } }), async ({ page, s }) => {
    await run(page, { action: 'target', gridX: 35, gridY: 26 });
    await act(page, 'dive');
    await until(page, st => st.krakenResidency?.state?.phase?.kind === 'submerged', 900);
    const p = await playerPos(page);
    await run(page, { action: 'holdWeapon', slot: 'weapon2' });
    await record(page, 'tentacles', frames, f => ({ dt: OC,
      cam: shake(path([[0, { x: p.x, y: p.y - 130, zoom: 2.6 }], [960, { x: p.x, y: p.y - 110, zoom: 2.9 }]], f), f, 3) }));
  }),

  /** Ink: the kraken spits across the bank, the badger is engulfed. */
  ink: (frames = 640) => session(() => kraken({ player: { gridX: 40, gridY: 34 } }), async ({ page, s }) => {
    await run(page, { action: 'krakenTarget', gridX: 40, gridY: 34 });
    await run(page, { action: 'target', gridX: 36, gridY: 24 });
    await run(page, { action: 'holdWeapon', slot: 'weapon2' });
    await act(page, 'ink');
    const p = await playerPos(page), follow = follower(.06);
    await record(page, 'ink', frames, async f => {
      const k = await krakenPos(page), c = follow(mid(k, p, .5));
      return { dt: OC, cam: shake({ ...c, zoom: path([[0, { x: 0, y: 0, zoom: 1.75 }], [200, { x: 0, y: 0, zoom: 1.85 }], [640, { x: 0, y: 0, zoom: 1.95 }]], f).zoom }, f) };
    });
  }),

  /** Spine volley: the kraken rears and fires six homing spines at the badger. */
  spines: (frames = 560) => session(() => kraken({ player: { gridX: 52, gridY: 37 } }), async ({ page, s }) => {
    await run(page, { action: 'krakenTarget', gridX: 52, gridY: 37 });
    await act(page, 'spines');
    const p = await playerPos(page), follow = follower(.05);
    await record(page, 'spines', frames, async f => {
      // Close on the rearing body for the launch, then ride with the spines to the badger.
      const k = await krakenPos(page), t = Math.min(1, Math.max(0, (f - 150) / 230)), e = t * t * (3 - 2 * t);
      const c = follow(mid(k, p, .08 + .8 * e));
      return { dt: OC, cam: shake({ ...c, zoom: 2.5 - .7 * e }, f) };
    });
  }),

  /** Brood: six eggs arc over the bank and hatch around the badger. */
  eggs: (frames = 760) => session(() => kraken({ player: { gridX: 35, gridY: 35 } }), async ({ page, s }) => {
    await run(page, { action: 'krakenTarget', gridX: 35, gridY: 35 });
    await act(page, 'eggs');
    const p = await playerPos(page);
    await record(page, 'eggs', frames, f => ({
      dt: f < 380 ? OC : 1000 / 60,
      cam: shake(path([[0, { x: p.x, y: p.y - 90, zoom: 2.05 }], [380, { x: p.x, y: p.y - 40, zoom: 2.3 }], [760, { x: p.x, y: p.y - 20, zoom: 2.55 }]], f), f),
    }));
  }),

  /** Phase two: it hauls itself out of the pond and comes for the badger. */
  ashore: (frames = 960) => session(() => kraken({ player: { gridX: 37, gridY: 41 } }), async ({ page, s }) => {
    await run(page, { action: 'krakenHp', hp: 5400 });
    await run(page, { action: 'holdWeapon', slot: 'weapon2' });
    await act(page, 'ashore', 1800);
    const follow = follower(.05);
    await record(page, 'ashore', frames, async f => {
      const k = await krakenPos(page), c = follow({ x: k.x, y: k.y + 60 });
      if (f % 8 === 0) await run(page, { action: 'target', ...toGrid(s, k) });
      return { dt: OC, cam: shake({ ...c, zoom: path([[0, { x: 0, y: 0, zoom: 2.35 }], [960, { x: 0, y: 0, zoom: 2.0 }]], f).zoom }, f) };
    });
  }),

  /** On land: telegraph, then the claw lunge tears across the ground. */
  lunge: (frames = 520) => session(() => kraken({ player: { gridX: 30, gridY: 41 } }), async ({ page, s }) => {
    await run(page, { action: 'krakenHp', hp: 5400 });
    await act(page, 'ashore', 1800);
    await until(page, st => st.krakenResidency?.state?.phase?.kind === 'land', 2400);
    await step(page, 60);
    // Badger level with the kraken, away from the map's bottom edge; give it time to turn before the lunge.
    const k0 = await krakenPos(page), p0 = { x: k0.x + 430, y: k0.y + 40 };
    await run(page, { action: 'teleport', ...toGrid(s, p0) });
    await run(page, { action: 'krakenTarget', ...toGrid(s, p0) });
    await step(page, 20);
    await run(page, { action: 'holdWeapon', slot: 'weapon2' });
    await act(page, 'lunge', 600);
    const follow = follower(.07);
    await record(page, 'lunge', frames, async f => {
      const k = await krakenPos(page), c = follow(mid(k, p0, .4));
      return { dt: OC, cam: shake({ x: c.x, y: Math.min(c.y, s.metrics.offsetY + 36.5 * 32), zoom: path([[0, { x: 0, y: 0, zoom: 2.05 }], [520, { x: 0, y: 0, zoom: 2.35 }]], f).zoom }, f, 3) };
    });
  }),

  /** Map 10: a void meteor tears down and the inferno colossus rises from the crater. */
  meteor: (frames = 900) => session(async () => {
    const r = await open({ version: 1, classId: 'dachs_nukem', mapId: '10', seed: 4242, timeOfDay: 1260,
      suppressWaves: false, freezeMission: false, hideAim: true, hideTutorial: true });
    return r;
  }, async ({ page }) => {
    let intro = null;
    for (let i = 0; i < 40 && !intro; i++) {
      await run(page, { action: 'clearEnemies' });
      await step(page, 20);
      intro = await page.evaluate(() => window.__C.bridge.getRoundState?.()?.coopDefenseBossIntro ?? null);
    }
    if (!intro) throw Error('boss intro did not start');
    console.log('intro', JSON.stringify(intro));
    // Map 10 drops the meteor near the west edge: keep the view inside the map (no black void) and
    // let the edit push in on the impact (zx/zy logged below).
    const m = (await status(page)).metrics;
    const inside = c => { const hw = 960 / c.zoom + 10, hh = 540 / c.zoom + 10;
      return { x: Math.min(Math.max(c.x, m.offsetX + hw), m.maxX - hw), y: Math.min(Math.max(c.y, m.offsetY + hh), m.maxY - hh), zoom: c.zoom }; };
    const keys = [[0, { x: intro.x, y: intro.y - 40, zoom: 1.3 }], [900, { x: intro.x, y: intro.y, zoom: 1.5 }]];
    const c0 = inside(path(keys, 700));
    console.log('impact frame position', JSON.stringify({ zx: +(.5 + (intro.x - c0.x) * c0.zoom / 1920).toFixed(3), zy: +(.5 + (intro.y - c0.y) * c0.zoom / 1080).toFixed(3) }));
    await record(page, 'meteor', frames, f => ({ dt: OC, cam: inside(shake(path(keys, f), f, 4)) }));
  }),

  /** Mortar badgers lay a barrage around the badger. */
  // Mortar and firestarter play on the bright forest/pond map (no kraken), matching the trailer's look.
  mortar: (frames = 840) => session(() => open({ ...KRAKEN, player: { gridX: 18, gridY: 40 } }),
  async ({ page }) => {
    await run(page, { action: 'quality', level: 'high' });
    for (const [gx, gy] of [[44, 38], [45, 42], [43, 45]]) {
      await run(page, { action: 'target', gridX: gx, gridY: gy });
      await run(page, { action: 'findFree' }); await run(page, { action: 'spawn', kind: 'mortar-badger', pinned: true });
    }
    await run(page, { action: 'target', gridX: 26, gridY: 40 });
    await step(page, 30);
    const p = await playerPos(page);
    await record(page, 'mortar', frames, f => ({ dt: OC,
      cam: shake(path([[0, { x: p.x + 70, y: p.y - 10, zoom: 2.1 }], [840, { x: p.x + 40, y: p.y, zoom: 2.4 }]], f), f, 3) }));
  }),

  /** Firestarter: purple orbs drift in, a lance ignites them into a firestorm. */
  fire: (frames = 1080) => session(() => open({ ...KRAKEN, player: { gridX: 14, gridY: 41 } }),
  async ({ page }) => {
    await run(page, { action: 'quality', level: 'high' });
    await run(page, { action: 'target', gridX: 42, gridY: 42 }); await run(page, { action: 'findFree' });
    await run(page, { action: 'spawn', kind: 'firestarter-badger', pinned: true });
    await run(page, { action: 'target', gridX: 29, gridY: 44 }); await run(page, { action: 'findFree' });
    await run(page, { action: 'spawn', kind: 'firestarter-badger', pinned: true });
    await run(page, { action: 'target', gridX: 24, gridY: 41 });
    await step(page, 30);
    const c = await world(page, { gridX: 23, gridY: 42 });
    await record(page, 'fire', frames, f => ({ dt: OC,
      cam: shake(path([[0, { ...c, zoom: 1.8 }], [1080, { x: c.x - 50, y: c.y, zoom: 2.1 }]], f), f, 3) }));
  }),

  /** Shield charger: two badgers pour fire into the raised shield, then it drops it and charges. */
  charger: (frames = 900) => session(() => open({ ...KRAKEN, weapon2: 'NEGEV', player: { gridX: 31, gridY: 37.5 },
    bots: [{ name: 'Grimbart', weapon1: 'GLOCK', weapon2: 'AK47', player: { gridX: 29.5, gridY: 36.4 } }] }),
  async ({ page }) => {
    await run(page, { action: 'quality', level: 'high' });
    await run(page, { action: 'spawn', kind: 'shield-charger-badger', pinned: false, hp: 6000, gridX: 48, gridY: 37.5 }); // far enough to finish its slow turn
    await run(page, { action: 'settle', frames: 60 }); await step(page, 2);
    const s = await status(page), p = await playerPos(page), follow = follower(.08), fast = follower(.2);
    // Phases: approach (tight on the shield) → windup (corridor and badger) → charge (ride the streak).
    let windup = null, charge = null, last = null;
    await record(page, 'charger', frames, async f => {
      const e = await enemy(page, 'shield-charger-badger') ?? last; last = e;
      // Open fire once it faces the badgers, so every round lands on the shield.
      if (f === 200) { await run(page, { action: 'holdWeapon', slot: 'weapon2' }); await run(page, { action: 'bot', index: 0, fire: 'weapon2' }); }
      const speed = Math.hypot(e.vx, e.vy);
      if (!windup && f > 40 && !e.moving) { windup = f; console.log('  windup at', f, JSON.stringify({ e, p: await playerPos(page) })); }
      if (windup && !charge && speed > 300) { charge = f; console.log('  charge at', f); }
      if (windup && f === windup + 24) await run(page, { action: 'move', dx: -.3, dy: -1, durationMs: 420 }); // dive out of the lane
      if (!charge && f % 6 === 0) { const g = toGrid(s, e); await run(page, { action: 'target', ...g }); await run(page, { action: 'bot', index: 0, aim: g }); }
      const k = windup ? Math.min(1, (f - windup) / 50) : 0, ease = k * k * (3 - 2 * k);
      const focus = charge ? e : mid(e, p, .2 + .3 * ease);
      const c = charge ? fast(focus) : follow(focus);
      return { dt: OC, cam: shake({ ...c, zoom: charge ? 2.8 : 4.2 - 1.3 * ease }, f, charge ? 4 : 2.5) };
    });
  }),

  /** The watchtower: the badger fires down into a horde, then the tower collapses. */
  tower: (frames = 840) => session(async () => {
    const r = await open({ version: 1, classId: 'dachs_nukem', mapId: '1', seed: 12345, timeOfDay: 760,
      suppressWaves: true, freezeMission: true, hideAim: true, hideTutorial: true });
    await run(r.page, { action: 'watchtowerReview', step: 'start' });
    await r.page.waitForFunction(() => window.devScenario.status().ready);
    await run(r.page, { action: 'options', values: { hideAim: true, hideTutorial: true, refillHp: true, timeOfDay: 760 } });
    return r;
  }, async ({ page }) => {
    await run(page, { action: 'watchtowerReview', step: 'enter' }); await step(page, 10);
    await run(page, { action: 'watchtowerReview', step: 'hunters' });
    for (const gx of [11, 14, 22, 25]) for (const gy of [5, 8]) { await run(page, { action: 'target', gridX: gx, gridY: gy }); await run(page, { action: 'spawn', kind: 'zombie-badger', pinned: false }); }
    await run(page, { action: 'target', gridX: 18.5, gridY: 9 });
    await run(page, { action: 'holdWeapon', slot: 'weapon2' });
    const tower = await world(page, { gridX: 18.5, gridY: 13 });
    await record(page, 'tower', frames, async f => {
      if (f === 600) await run(page, { action: 'watchtowerReview', step: 'collapse' }).catch(() => {});
      return { dt: OC, cam: shake(path([[0, { ...tower, zoom: 2.3 }], [560, { x: tower.x, y: tower.y - 30, zoom: 1.95 }], [840, { x: tower.x, y: tower.y + 10, zoom: 1.85 }]], f), f, f > 600 ? 6 : 2.5) };
    });
  }),
};
