import { lerpKeys, ease } from './harness.mjs';
import { SHOTS } from './shots.mjs';
import { FINAL } from './final_shots.mjs';

const W = (ctx, gx, gy) => ctx.toWorld(gx, gy);
const camAt = (ctx, gx, gy, zoom, extra = {}) => { const w = W(ctx, gx, gy); return ctx.cam({ follow: false, x: w.x, y: w.y, zoom, ...extra }); };
export const aimNearest = (ctx) => ctx.page.evaluate(() => {
  const d = window.__T.dev; const p = d.runtime.navigationLabPort.getPlayerPosition();
  const en = d.runtime.navigationLabPort.readEnemies(); if (!en.length || !p) return;
  let best = null, bd = Infinity;
  for (const e of en) { const dd = (e.x - p.x) ** 2 + (e.y - p.y) ** 2; if (dd < bd) { bd = dd; best = e; } }
  d.aim = d.grid({ x: best.x, y: best.y });
});
/** Aim at centroid of the nearest N enemies, plus a perpendicular sweep offset (cells). */
export const aimCluster = (ctx, n = 12, sweep = 0) => ctx.page.evaluate(([n, sweep]) => {
  const d = window.__T.dev; const p = d.runtime.navigationLabPort.getPlayerPosition();
  const en = d.runtime.navigationLabPort.readEnemies(); if (!en.length || !p) return;
  en.sort((a, b) => ((a.x - p.x) ** 2 + (a.y - p.y) ** 2) - ((b.x - p.x) ** 2 + (b.y - p.y) ** 2));
  const sel = en.slice(0, n); let x = 0, y = 0; for (const e of sel) { x += e.x; y += e.y; } x /= sel.length; y /= sel.length;
  const dx = x - p.x, dy = y - p.y, l = Math.hypot(dx, dy) || 1;
  d.aim = d.grid({ x: x - dy / l * sweep * 32, y: y + dx / l * sweep * 32 });
}, [n, sweep]);
const enemyCount = (ctx) => ctx.page.evaluate(() => window.__T.dev.runtime.navigationLabPort.readEnemies().length);

const WARM = 130;
Object.assign(FINAL, {
  cold_open: {
    scenario: { classId: 'dachs_of_steel', mapId: '6', timeOfDay: 1250, weapon2: 'SHOTGUN' },
    frames: 600, warmup: WARM,
    setup: async (ctx) => {
      const P = ctx.P;
      await ctx.spawnPack('zombie-badger', P.x + 27, P.y + 1, 40, 5, 6);
      await ctx.spawnPack('demon-badger', P.x + 31, P.y, 10, 3, 4);
      await ctx.spawnPack('rabid-badger', P.x + 32, P.y + 2, 6, 2, 2);
      ctx.data = { P };
      await camAt(ctx, P.x + 21, P.y + 1, 2.2);
      await ctx.aim(P.x + 8, P.y);
    },
    timeline: async (f, ctx) => {
      const P = ctx.data.P;
      if (f < 0) return;
      const gx = lerpKeys([[0, P.x + 21], [270, P.x + 13], [330, P.x + 1.5], [600, P.x + 3]], f);
      const gy = lerpKeys([[0, P.y + 1], [270, P.y + 1], [330, P.y], [600, P.y]], f);
      const z = lerpKeys([[0, 2.2], [270, 2.45], [330, 2.7], [600, 3.0]], f);
      await camAt(ctx, gx, gy, z);
      if (f > 300) await aimCluster(ctx, 8);
      if (f === 500) await ctx.cmd({ action: 'holdWeapon', slot: 'weapon2' });
    },
  },
  rocket_drop: {
    scenario: { classId: 'dachs_nukem', mapId: '10', timeOfDay: 760, weapon2: 'ROCKET_LAUNCHER' },
    frames: 200, warmup: WARM,
    setup: async (ctx) => {
      const P = ctx.P;
      await ctx.spawnPack('zombie-badger', P.x + 13, P.y + 1, 45, 4, 5);
      await ctx.spawnPack('demon-badger', P.x + 16, P.y + 1, 10, 2, 3);
      ctx.data = { P };
      await ctx.cam({ follow: true, zoom: 2.0, ox: 170, oy: 16 });
    },
    timeline: async (f, ctx) => {
      if (f >= -40) await aimCluster(ctx, 20);
      if (f === -22) await ctx.cmd({ action: 'holdWeapon', slot: 'weapon2' });
      if (f >= 0) await ctx.cam({ zoom: lerpKeys([[0, 2.0], [200, 2.25]], f, ease.linear) });
    },
  },
  negev: {
    scenario: { classId: 'dachs_nukem', mapId: '10', timeOfDay: 1030, weapon2: 'NEGEV' },
    frames: 200, warmup: WARM,
    setup: async (ctx) => {
      const P = ctx.P;
      await ctx.spawnPack('zombie-badger', P.x - 14, P.y + 2, 45, 4, 6);
      await ctx.spawnPack('demon-badger', P.x - 17, P.y + 2, 12, 3, 4);
      ctx.data = { P };
      await ctx.cam({ follow: true, zoom: 2.1, ox: -170, oy: 20 });
    },
    timeline: async (f, ctx) => {
      if (f >= -30) await aimCluster(ctx, 15, Math.sin((f + 30) / 230 * Math.PI * 3) * 2.2);
      if (f === -20) await ctx.cmd({ action: 'holdWeapon', slot: 'weapon2' });
      if (f >= 0) await ctx.cam({ zoom: lerpKeys([[0, 2.1], [200, 1.9]], f, ease.linear) });
    },
  },
  tesla: {
    scenario: { classId: 'dachs_of_steel', mapId: '11', timeOfDay: 780, weapon2: 'TESLA_DOME' },
    frames: 200, warmup: 60,
    setup: async (ctx) => {
      const P = ctx.P;
      await ctx.spawnPack('rabid-badger', P.x + 14, P.y, 14, 3, 5);
      await ctx.spawnPack('rabid-badger', P.x - 14, P.y, 14, 3, 5);
      await ctx.spawnPack('demon-badger', P.x, P.y + 12, 10, 4, 2);
      ctx.data = { P };
      await ctx.cam({ follow: true, zoom: 2.3 });
    },
    timeline: async (f, ctx) => {
      if (f >= -30) await aimNearest(ctx);
      if (f === -15) await ctx.cmd({ action: 'holdWeapon', slot: 'weapon2' });
      if (f >= 0) await ctx.cam({ zoom: lerpKeys([[0, 2.35], [200, 2.05]], f) });
    },
  },
  boss: {
    scenario: { classId: 'dachs_nukem', mapId: '11', timeOfDay: 720, weapon2: 'ROCKET_LAUNCHER' },
    frames: 260, warmup: WARM,
    setup: async (ctx) => {
      const P = ctx.P;
      await ctx.spawnPack('inferno-colossus', P.x + 17, P.y, 1, 1, 1);
      await ctx.spawnPack('pyro-badger', P.x + 19, P.y + 3, 3, 2, 2);
      ctx.data = { P };
      await ctx.cam({ follow: true, zoom: 1.75, ox: 220 });
    },
    timeline: async (f, ctx) => {
      await ctx.page.evaluate(() => { const d = window.__T.dev; const en = d.runtime.navigationLabPort.readEnemies(); const e = en.find(e => /colossus/.test(String(e.kind))) ?? en[0]; if (e) d.aim = d.grid({ x: e.x, y: e.y }); });
      if (f === 30) await ctx.cmd({ action: 'holdWeapon', slot: 'weapon2' });
      if (f >= 0) await ctx.cam({ zoom: lerpKeys([[0, 1.75], [260, 1.55]], f), ox: lerpKeys([[0, 220], [260, 140]], f) });
    },
  },
  holy: {
    scenario: { classId: 'dachs_nukem', mapId: '6', timeOfDay: 700 },
    frames: 200, warmup: WARM,
    setup: async (ctx) => {
      const P = ctx.P;
      await ctx.spawnPack('zombie-badger', P.x + 12, P.y, 45, 4.5, 4);
      await ctx.spawnPack('demon-badger', P.x + 14, P.y, 8, 2, 3);
      ctx.data = { P };
      await ctx.cam({ follow: true, zoom: 1.8, ox: 210 });
    },
    timeline: async (f, ctx) => {
      if (f === -110) { await aimCluster(ctx, 30); await ctx.page.evaluate(() => window.__T.startTemp('HOLY_HAND_GRENADE')); }
      if (f === -98) await ctx.page.evaluate(() => window.__T.releaseTemp());
      if (f >= 0) await ctx.cam({ zoom: lerpKeys([[0, 1.8], [200, 1.65]], f) });
    },
  },
  armageddon: { ...FINAL.armageddon, warmup: WARM },
  airstrike: { ...FINAL.airstrike, warmup: WARM },
  nuke: { ...FINAL.nuke, warmup: WARM },
  flamer: {
    scenario: { classId: 'dachs_of_steel', mapId: '11', timeOfDay: 740, weapon2: 'FLAMETHROWER' },
    frames: 150, warmup: 60,
    setup: async (ctx) => {
      const P = ctx.P;
      await ctx.spawnPack('rabid-badger', P.x + 12, P.y, 16, 3, 4);
      await ctx.spawnPack('zombie-badger', P.x + 7, P.y, 10, 2, 3);
      ctx.data = { P };
      await ctx.cam({ follow: true, zoom: 2.7, ox: 90 });
    },
    timeline: async (f, ctx) => {
      if (f >= -20) await aimCluster(ctx, 6, Math.sin(f / 20) * 1.2);
      if (f === -10) await ctx.cmd({ action: 'holdWeapon', slot: 'weapon2' });
    },
  },
  shotgun: {
    scenario: { classId: 'dachs_nukem', mapId: '11', timeOfDay: 1000, weapon2: 'SHOTGUN' },
    frames: 150, warmup: 60,
    setup: async (ctx) => {
      const P = ctx.P;
      await ctx.spawnPack('rabid-badger', P.x - 11, P.y + 1, 18, 3, 4);
      ctx.data = { P };
      await ctx.cam({ follow: true, zoom: 2.8, ox: -80 });
    },
    timeline: async (f, ctx) => {
      if (f >= -20) await aimNearest(ctx);
      if (f === -5) await ctx.cmd({ action: 'holdWeapon', slot: 'weapon2' });
    },
  },
  hydra: {
    scenario: { classId: 'dachs_nukem', mapId: '10', timeOfDay: 800, weapon1: 'HYDRA', weapon2: 'MINI_ROCKET_LAUNCHER' },
    frames: 180, warmup: WARM,
    setup: async (ctx) => {
      const P = ctx.P;
      await ctx.spawnPack('zombie-badger', P.x + 12, P.y - 2, 40, 5, 5);
      ctx.data = { P };
      await ctx.cam({ follow: true, zoom: 1.9, ox: 180 });
    },
    timeline: async (f, ctx) => {
      if (f >= -30) await aimCluster(ctx, 20, Math.sin(f / 30) * 2);
      if (f === -20) await ctx.cmd({ action: 'holdWeapon', slot: 'weapon2' });
    },
  },
  mass_horde: {
    scenario: { classId: 'inspector_gadachs', mapId: '6', timeOfDay: 1020, weapon2: 'PLASMA_BURNER' },
    frames: 300, warmup: 150,
    setup: async (ctx) => {
      const P = ctx.P;
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2;
        await ctx.spawnPack(i % 3 === 0 ? 'demon-badger' : 'zombie-badger', P.x + 3 + Math.cos(a) * 19, P.y + Math.sin(a) * 13, 16, 3, 3);
      }
      console.log('  enemies', await enemyCount(ctx));
      ctx.data = { P };
      await camAt(ctx, P.x + 3, P.y, 1.9);
    },
    timeline: async (f, ctx) => {
      if (f >= -20) await aimNearest(ctx);
      if (f === -10) await ctx.cmd({ action: 'holdWeapon', slot: 'weapon2' });
      if (f >= 0) await camAt(ctx, ctx.data.P.x + 3, ctx.data.P.y, lerpKeys([[0, 1.9], [300, 0.95]], f, ease.inOut));
    },
  },
});
Object.assign(SHOTS, FINAL);

FINAL.rocket_drop.setup = async (ctx) => {
  const P = ctx.P;
  await ctx.spawnPack('zombie-badger', P.x - 15, P.y + 1, 45, 4, 5);
  await ctx.spawnPack('demon-badger', P.x - 18, P.y + 1, 10, 2, 3);
  ctx.data = { P };
  await ctx.cam({ follow: true, zoom: 2.0, ox: -170, oy: 16 });
};
FINAL.negev.scenario = { classId: 'dachs_nukem', mapId: '11', timeOfDay: 1030, weapon2: 'NEGEV' };
Object.assign(SHOTS, FINAL);

// Nuke v2: detonation lands ~5010 ms after release (release at f=20 → sim 350 ms).
FINAL.nuke.frames = 330;
FINAL.nuke.speed = f => f < 30 ? 1 : f < 110 ? 3 : f < 140 ? 1 : 0.35;
{
  const base = FINAL.nuke.timeline;
  FINAL.nuke.timeline = async (f, ctx) => {
    const P = ctx.data.P;
    if (f === 8) console.log('  nuke', JSON.stringify(await ctx.page.evaluate(() => window.__T.startTemp('NUKE'))));
    if (f === 20) console.log('  release', JSON.stringify(await ctx.page.evaluate(() => window.__T.releaseTemp())));
    if (f === 45) await ctx.teleport(P.x - 30, P.y);
    if (f >= 0) await ctx.cam({ follow: false, ...ctx.toWorld(P.x + lerpKeys([[0, 5], [45, 9.5], [330, 10]], f), P.y), zoom: lerpKeys([[0, 1.6], [45, 1.35], [190, 1.2], [330, 1.32]], f) });
  };
}
Object.assign(SHOTS, FINAL);
