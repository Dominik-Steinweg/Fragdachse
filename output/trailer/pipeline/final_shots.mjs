import { lerpKeys, ease } from './harness.mjs';
import { SHOTS } from './shots.mjs';

const W = (ctx, gx, gy) => ctx.toWorld(gx, gy);
/** Fixed (non-follow) camera at grid position. */
const camAt = (ctx, gx, gy, zoom, extra = {}) => { const w = W(ctx, gx, gy); return ctx.cam({ follow: false, x: w.x, y: w.y, zoom, ...extra }); };
const aimNearest = async (ctx, lead = 0) => {
  await ctx.page.evaluate((lead) => {
    const d = window.__T.dev; const p = d.runtime.navigationLabPort.getPlayerPosition();
    const en = d.runtime.navigationLabPort.readEnemies(); if (!en.length || !p) return;
    let best = null, bd = Infinity;
    for (const e of en) { const dd = (e.x - p.x) ** 2 + (e.y - p.y) ** 2; if (dd < bd) { bd = dd; best = e; } }
    d.aim = d.grid({ x: best.x + (best.vx ?? 0) * lead, y: best.y + (best.vy ?? 0) * lead });
  }, lead);
};
/** Aim at the centroid of enemies (optionally the densest cluster near a point). */
const aimCentroid = async (ctx) => {
  await ctx.page.evaluate(() => {
    const d = window.__T.dev; const en = d.runtime.navigationLabPort.readEnemies(); if (!en.length) return;
    let x = 0, y = 0; for (const e of en) { x += e.x; y += e.y; }
    d.aim = d.grid({ x: x / en.length, y: y / en.length });
  });
};
async function buildNear(ctx, id, gx, gy) {
  const offsets = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [0, 2], [-2, 0], [0, -2], [2, 1], [1, 2], [-2, 1], [2, -1]];
  for (const [dx, dy] of offsets) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const r = await ctx.page.evaluate(c => window.devScenario.run(c), { action: 'build', id, gridX: gx + dx, gridY: gy + dy });
      if (r.ok) { console.log('  built', id, gx + dx, gy + dy); return true; }
      if (!/cooldown/.test(r.error)) break;
      await ctx.step(20);
    }
  }
  console.log('  build failed', id); return false;
}

export const FINAL = {
  // ── Cold open: night, horde with glowing eyes creeps towards the lone badger ──
  cold_open: {
    scenario: { classId: 'dachs_of_steel', mapId: '6', timeOfDay: 1250, weapon2: 'SHOTGUN' },
    frames: 600, warmup: 60,
    setup: async (ctx) => {
      const P = ctx.P;
      await ctx.spawnPack('zombie-badger', P.x + 17, P.y + 1, 34, 5, 5);
      await ctx.spawnPack('demon-badger', P.x + 21, P.y, 8, 3, 4);
      await ctx.spawnPack('rabid-badger', P.x + 22, P.y + 2, 5, 2, 2);
      ctx.data = { P };
      await camAt(ctx, P.x + 17, P.y + 1, 1.9);
      await ctx.aim(P.x + 8, P.y);
    },
    timeline: async (f, ctx) => {
      const P = ctx.data.P;
      if (f < 0) return;
      // 0-270: drift over the horde; 270-600: settle on the badger
      const gx = lerpKeys([[0, P.x + 15], [270, P.x + 9], [330, P.x + 1.5], [600, P.x + 2.5]], f);
      const gy = lerpKeys([[0, P.y + 1], [270, P.y + 1], [330, P.y], [600, P.y]], f);
      const z = lerpKeys([[0, 1.9], [270, 2.15], [330, 2.5], [600, 2.9]], f);
      await camAt(ctx, gx, gy, z);
      if (f > 300) await aimNearest(ctx);
      if (f === 520) await ctx.cmd({ action: 'holdWeapon', slot: 'weapon2' });
    },
  },

  // ── The drop: rocket volley into a dense pack (noon) ──
  rocket_drop: {
    scenario: { classId: 'dachs_nukem', mapId: '10', timeOfDay: 760, weapon2: 'ROCKET_LAUNCHER' },
    frames: 200, warmup: 40,
    setup: async (ctx) => {
      const P = ctx.P;
      await ctx.spawnPack('zombie-badger', P.x + 9, P.y + 1, 40, 4, 4);
      await ctx.spawnPack('demon-badger', P.x + 12, P.y + 1, 8, 2, 3);
      ctx.data = { P };
      await ctx.cam({ follow: true, zoom: 2.0, ox: 150, oy: 16 });
      await ctx.aim(P.x + 8, P.y + 1);
    },
    timeline: async (f, ctx) => {
      if (f === -18) await ctx.cmd({ action: 'holdWeapon', slot: 'weapon2' });
      if (f >= 0) { await aimCentroid(ctx); await ctx.cam({ zoom: lerpKeys([[0, 2.0], [200, 2.2]], f, ease.linear) }); }
    },
  },

  // ── Negev spray at golden hour ──
  negev: {
    scenario: { classId: 'dachs_nukem', mapId: '10', timeOfDay: 1110, weapon2: 'NEGEV' },
    frames: 200, warmup: 50,
    setup: async (ctx) => {
      const P = ctx.P;
      await ctx.spawnPack('zombie-badger', P.x - 9, P.y + 3, 40, 4, 5);
      await ctx.spawnPack('demon-badger', P.x - 12, P.y + 2, 10, 3, 4);
      ctx.data = { P };
      await ctx.cam({ follow: true, zoom: 2.1, ox: -120, oy: 40 });
      await ctx.aim(P.x - 8, P.y + 3);
    },
    timeline: async (f, ctx) => {
      if (f === -10) await ctx.cmd({ action: 'holdWeapon', slot: 'weapon2' });
      if (f >= -10) {
        const P = ctx.data.P; const a = Math.PI + Math.sin((f + 10) / 200 * Math.PI * 1.5) * 0.45 + 0.25;
        await ctx.aim(P.x + Math.cos(a) * 8, P.y + Math.sin(a) * 8);
      }
      if (f >= 0) await ctx.cam({ zoom: lerpKeys([[0, 2.1], [200, 1.9]], f, ease.linear) });
    },
  },

  // ── Tesla dome: rabid badgers charge into the dome ──
  tesla: {
    scenario: { classId: 'dachs_of_steel', mapId: '9', timeOfDay: 840, weapon2: 'TESLA_DOME' },
    frames: 200, warmup: 20,
    setup: async (ctx) => {
      const P = await ctx.teleport(42, 19);
      await ctx.spawnPack('rabid-badger', P.x + 9, P.y, 14, 3, 5);
      await ctx.spawnPack('rabid-badger', P.x - 9, P.y, 14, 3, 5);
      await ctx.spawnPack('zombie-badger', P.x, P.y + 7, 12, 4, 2);
      ctx.data = { P };
      await ctx.cam({ follow: true, zoom: 2.3 });
      await ctx.aim(P.x + 5, P.y);
    },
    timeline: async (f, ctx) => {
      if (f === -5) await ctx.cmd({ action: 'holdWeapon', slot: 'weapon2' });
      if (f >= 0) { await aimNearest(ctx); await ctx.cam({ zoom: lerpKeys([[0, 2.35], [200, 2.05]], f) }); }
    },
  },

  // ── Boss: Inferno Colossus stomps in (dusk) ──
  boss: {
    scenario: { classId: 'dachs_nukem', mapId: '9', timeOfDay: 1150, weapon2: 'ROCKET_LAUNCHER', weapon1: 'ASMD_PRIM' },
    frames: 260, warmup: 30,
    setup: async (ctx) => {
      const P = await ctx.teleport(30, 19);
      await ctx.spawnPack('inferno-colossus', P.x + 13, P.y, 1, 1, 1);
      await ctx.spawnPack('pyro-badger', P.x + 15, P.y + 3, 4, 2, 2);
      ctx.data = { P };
      await ctx.cam({ follow: true, zoom: 1.8, ox: 190 });
      await ctx.aim(P.x + 12, P.y);
    },
    timeline: async (f, ctx) => {
      if (f === 60) await ctx.cmd({ action: 'holdWeapon', slot: 'weapon2' });
      if (f >= 0) {
        await ctx.page.evaluate(() => { const d = window.__T.dev; const en = d.runtime.navigationLabPort.readEnemies().filter(e => /colossus/.test(e.kind ?? e.id)); const e = en[0] ?? d.runtime.navigationLabPort.readEnemies()[0]; if (e) d.aim = d.grid({ x: e.x, y: e.y }); });
        await ctx.cam({ zoom: lerpKeys([[0, 1.8], [260, 1.55]], f), ox: lerpKeys([[0, 190], [260, 120]], f) });
        if (f === 150) await ctx.cmd({ action: 'move', dx: -1, dy: 0.4, durationMs: 900 });
      }
    },
  },

  // ── Holy hand grenade into a pack at the base ──
  holy: {
    scenario: { classId: 'dachs_nukem', mapId: '6', timeOfDay: 700 },
    frames: 240, warmup: 50,
    setup: async (ctx) => {
      const P = ctx.P;
      await ctx.spawnPack('zombie-badger', P.x + 10, P.y, 40, 4.5, 4);
      await ctx.spawnPack('demon-badger', P.x + 12, P.y, 8, 2, 3);
      ctx.data = { P };
      await ctx.cam({ follow: true, zoom: 1.75, ox: 200 });
      await ctx.aim(P.x + 8.5, P.y);
    },
    timeline: async (f, ctx) => {
      if (f === -20) await ctx.page.evaluate(() => window.__T.startTemp('HOLY_HAND_GRENADE'));
      if (f === -8) await ctx.page.evaluate(() => window.__T.releaseTemp());
      if (f >= 0) await ctx.cam({ zoom: lerpKeys([[0, 1.75], [240, 1.6]], f) });
    },
  },

  // ── Armageddon: meteors around the badger in a ring of zombies ──
  armageddon: {
    scenario: { classId: 'dachs_nukem', mapId: '11', timeOfDay: 660, ultimate: 'ARMAGEDDON', weapon2: 'P90' },
    frames: 240, warmup: 50,
    setup: async (ctx) => {
      const P = ctx.P;
      await ctx.spawnPack('zombie-badger', P.x + 8, P.y, 22, 3, 5);
      await ctx.spawnPack('zombie-badger', P.x - 8, P.y, 22, 3, 5);
      await ctx.spawnPack('rabid-badger', P.x, P.y - 8, 10, 4, 2);
      ctx.data = { P };
      await ctx.cam({ follow: true, zoom: 1.5 });
      await ctx.aim(P.x + 6, P.y);
    },
    timeline: async (f, ctx) => {
      if (f === -12) await ctx.cmd({ action: 'ultimate', phase: 'press' });
      if (f === 20) await ctx.cmd({ action: 'holdWeapon', slot: 'weapon2' });
      if (f >= 20) await aimNearest(ctx);
      if (f >= 0) await ctx.cam({ zoom: lerpKeys([[0, 1.55], [240, 1.35]], f) });
    },
  },

  // ── Airstrike onto a horde ──
  airstrike: {
    scenario: { classId: 'dachs_nukem', mapId: '10', timeOfDay: 900, ultimate: 'AIRSTRIKE' },
    frames: 240, warmup: 40,
    setup: async (ctx) => {
      const P = ctx.P;
      await ctx.spawnPack('zombie-badger', P.x + 11, P.y + 1, 50, 5, 5);
      ctx.data = { P };
      await camAt(ctx, P.x + 8, P.y + 1, 1.45);
      await ctx.aim(P.x + 11, P.y + 1);
    },
    timeline: async (f, ctx) => {
      if (f === -30) await ctx.cmd({ action: 'ultimate', phase: 'press' });
      if (f >= 0) await camAt(ctx, ctx.data.P.x + lerpKeys([[0, 8], [240, 9.5]], f), ctx.data.P.y + 1, lerpKeys([[0, 1.45], [240, 1.6]], f));
    },
  },

  // ── Turret nest (Inspector Gadachs) ──
  turrets: {
    scenario: { classId: 'inspector_gadachs', mapId: '7', seed: 12345, timeOfDay: 760, upgrades: { inspector_construction_slots: 3 }, player: { gridX: 98, gridY: 26 },
      tools: [{ kind: 'construction', id: 'flame_turret' }, { kind: 'construction', id: 'tesla_turret' }, { kind: 'construction', id: 'rocket_turret' }, { kind: 'construction', id: 'machine_gun_turret' }] },
    frames: 240, warmup: 20,
    setup: async (ctx) => {
      const P = ctx.P;
      await buildNear(ctx, 'flame_turret', 102, 25);
      await buildNear(ctx, 'tesla_turret', 101, 27);
      await buildNear(ctx, 'rocket_turret', 100, 23);
      await buildNear(ctx, 'machine_gun_turret', 99, 28);
      await ctx.step(150);
      await ctx.spawnPack('zombie-badger', P.x + 13, P.y, 45, 5, 6);
      await ctx.spawnPack('demon-badger', P.x + 16, P.y, 12, 3, 4);
      ctx.data = { P };
      await camAt(ctx, P.x + 6, P.y, 1.7);
      await ctx.aim(P.x + 10, P.y);
    },
    timeline: async (f, ctx) => {
      if (f >= 0) await camAt(ctx, ctx.data.P.x + lerpKeys([[0, 6.5], [240, 5.5]], f), ctx.data.P.y, lerpKeys([[0, 1.7], [240, 1.85]], f));
    },
  },

  // ── Nuke with speed ramp: throw, fast countdown, slow-motion detonation ──
  nuke: {
    scenario: { classId: 'dachs_nukem', mapId: '6', timeOfDay: 720 },
    frames: 330, warmup: 40,
    speed: f => f < 40 ? 1 : f < 170 ? 3.2 : f < 190 ? 1 : 0.4,
    setup: async (ctx) => {
      const P = ctx.P;
      await ctx.spawnPack('zombie-badger', P.x + 10, P.y, 60, 7, 6);
      await ctx.spawnPack('demon-badger', P.x + 13, P.y, 14, 4, 4);
      ctx.data = { P };
      await camAt(ctx, P.x + 5, P.y, 1.6);
      await ctx.aim(P.x + 10, P.y);
    },
    timeline: async (f, ctx) => {
      const P = ctx.data.P;
      if (f === 8) console.log('  nuke', JSON.stringify(await ctx.page.evaluate(() => window.__T.startTemp('NUKE'))));
      if (f === 20) console.log('  release', JSON.stringify(await ctx.page.evaluate(() => window.__T.releaseTemp())));
      if (f === 60) await ctx.teleport(P.x - 30, P.y); // badger escapes the blast radius (off-screen)
      if (f >= 0) await camAt(ctx, P.x + lerpKeys([[0, 5], [60, 9], [330, 10]], f), P.y, lerpKeys([[0, 1.6], [60, 1.25], [180, 1.1], [330, 1.25]], f));
    },
  },
};
Object.assign(SHOTS, FINAL);
