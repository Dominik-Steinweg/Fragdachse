import { lerpKeys, ease } from './harness.mjs';
import { SHOTS } from './shots2.mjs';

const aimNearest = (ctx) => ctx.page.evaluate(() => {
  const d = window.__T.dev; const p = d.runtime.navigationLabPort.getPlayerPosition();
  const en = d.runtime.navigationLabPort.readEnemies(); if (!en.length || !p) return;
  let best = null, bd = Infinity;
  for (const e of en) { const dd = (e.x - p.x) ** 2 + (e.y - p.y) ** 2; if (dd < bd) { bd = dd; best = e; } }
  d.aim = d.grid({ x: best.x, y: best.y });
});
const aimCluster = (ctx, n = 12, sweep = 0) => ctx.page.evaluate(([n, sweep]) => {
  const d = window.__T.dev; const p = d.runtime.navigationLabPort.getPlayerPosition();
  const en = d.runtime.navigationLabPort.readEnemies(); if (!en.length || !p) return;
  en.sort((a, b) => ((a.x - p.x) ** 2 + (a.y - p.y) ** 2) - ((b.x - p.x) ** 2 + (b.y - p.y) ** 2));
  const sel = en.slice(0, n); let x = 0, y = 0; for (const e of sel) { x += e.x; y += e.y; } x /= sel.length; y /= sel.length;
  const dx = x - p.x, dy = y - p.y, l = Math.hypot(dx, dy) || 1;
  d.aim = d.grid({ x: x - dy / l * sweep * 32, y: y + dx / l * sweep * 32 });
}, [n, sweep]);

const WARM = 130;
const PLASMA_BURNER_MAX = { plasma_burner_range: 3, plasma_burner_charges: 3, plasma_burner_target_lock: 3, plasma_burner_overload: 1, plasma_burner_capacitor: 3, plasma_burner_retention: 3, plasma_burner_chain: 1, plasma_burner_cascade: 3, plasma_burner_coupling: 3 };
const DRONES_MAX = { attack_drone_self_loader: 3, attack_drone_service: 3, attack_drone_flight: 3, attack_drone_penetration: 3, attack_drone_bomb_bay: 1, attack_drone_bomb_count: 3, attack_drone_fire_chunks: 3 };

const holdWeaponShot = ({ scenario, kind = 'zombie-badger', count = 40, dx = 12, dy = 0, zoom = 2.0, ox, slot = 'weapon2', frames = 200, sweep = 1.5, extra = [], nearest = false }) => ({
  scenario, frames, warmup: WARM,
  setup: async (ctx) => {
    const P = ctx.P;
    await ctx.spawnPack(kind, P.x + dx, P.y + dy, count, 4, 5);
    for (const [k, n, ddx, ddy] of extra) await ctx.spawnPack(k, P.x + ddx, P.y + ddy, n, 3, 3);
    await ctx.cam({ follow: true, zoom, ox: ox ?? Math.sign(dx) * 170, oy: dy * 10 });
  },
  timeline: async (f, ctx) => {
    if (f >= -40) { if (nearest) await aimNearest(ctx); else await aimCluster(ctx, 14, Math.sin((f + 40) / 50) * sweep); }
    if (f === -20) await ctx.run({ action: 'holdWeapon', slot });
    if (f >= 0) await ctx.cam({ zoom: lerpKeys([[0, zoom], [frames, zoom * 0.92]], f, ease.linear) });
  },
});

SHOTS.a1_minirocket = holdWeaponShot({ scenario: { classId: 'dachs_nukem', mapId: '10', timeOfDay: 760, weapon2: 'MINI_ROCKET_LAUNCHER' }, dx: -14, count: 45, extra: [['demon-badger', 10, -17, 1]] });
SHOTS.a2_plasmaburner = holdWeaponShot({ scenario: { classId: 'inspector_gadachs', mapId: '6', timeOfDay: 720, weapon2: 'PLASMA_BURNER', upgrades: PLASMA_BURNER_MAX }, dx: 11, count: 40, zoom: 2.1, extra: [['demon-badger', 10, 14, 0]] });
SHOTS.a3_leafblower = holdWeaponShot({ scenario: { classId: 'dachs_of_steel', mapId: '11', timeOfDay: 740, weapon1: 'LEAF_BLOWER' }, kind: 'rabid-badger', dx: 11, count: 22, zoom: 2.5, slot: 'weapon1', sweep: 0.8, nearest: true, frames: 180, extra: [['zombie-badger', 12, 8, 2]] });
SHOTS.a4_timebubble = {
  scenario: { classId: 'dachs_nukem', mapId: '10', timeOfDay: 800, weapon2: 'P90', tools: [{ kind: 'utility', id: 'TIME_BUBBLE' }] },
  frames: 240, warmup: WARM,
  setup: async (ctx) => {
    const P = ctx.P;
    await ctx.spawnPack('zombie-badger', P.x - 13, P.y + 1, 45, 4, 5);
    await ctx.spawnPack('demon-badger', P.x - 16, P.y + 1, 10, 2, 3);
    await ctx.cam({ follow: true, zoom: 1.9, ox: -190 });
  },
  timeline: async (f, ctx) => {
    if (f >= -60 && f < 30) await aimCluster(ctx, 25);
    if (f === -50) await ctx.run({ action: 'utility' });
    if (f === 30) await ctx.run({ action: 'holdWeapon', slot: 'weapon2' });
    if (f >= 30) await aimCluster(ctx, 10, Math.sin(f / 25) * 1.5);
    if (f >= 0) await ctx.cam({ zoom: lerpKeys([[0, 1.9], [240, 2.1]], f) });
  },
};
async function buildNear(ctx, id, gx, gy) {
  const offsets = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [0, 2], [-2, 0], [0, -2]];
  for (const [dx, dy] of offsets) for (let attempt = 0; attempt < 8; attempt++) {
    const r = await ctx.run({ action: 'build', id, gridX: gx + dx, gridY: gy + dy }, true);
    if (r.ok) { console.log('  built', id, gx + dx, gy + dy); return true; }
    if (!/cooldown/.test(r.error)) break;
    await ctx.step(20);
  }
  console.log('  build failed', id); return false;
}
SHOTS.a5_drones = {
  scenario: { classId: 'inspector_gadachs', mapId: '7', seed: 12345, timeOfDay: 760, player: { gridX: 98, gridY: 26 }, weapon2: 'PLASMA_BURNER',
    upgrades: { inspector_construction_slots: 3, ...DRONES_MAX }, tools: [{ kind: 'construction', id: 'attack_drone_station' }] },
  frames: 300, warmup: 60,
  setup: async (ctx) => {
    const P = ctx.P;
    await buildNear(ctx, 'attack_drone_station', 101, 26);
    await ctx.step(200);
    await ctx.spawnPack('zombie-badger', P.x + 14, P.y, 45, 5, 6);
    await ctx.spawnPack('demon-badger', P.x + 17, P.y, 12, 3, 4);
    await ctx.step(60);
    await ctx.camAt(P.x + 7, P.y, 1.7);
  },
  timeline: async (f, ctx) => {
    if (f >= 0) await ctx.camAt(ctx.P.x + lerpKeys([[0, 7], [300, 10]], f), ctx.P.y, lerpKeys([[0, 1.7], [300, 1.55]], f));
  },
};
SHOTS.a6_p90 = holdWeaponShot({ scenario: { classId: 'dachs_nukem', mapId: '11', timeOfDay: 1020, weapon2: 'P90' }, kind: 'rabid-badger', dx: -12, count: 26, zoom: 2.3, nearest: true, frames: 180, extra: [['zombie-badger', 15, -14, 3]] });

const NIGHT = 1290;
SHOTS.n1_plasma = holdWeaponShot({ scenario: { classId: 'dachs_nukem', mapId: '6', timeOfDay: NIGHT, weapon1: 'PLASMA' }, slot: 'weapon1', dx: 11, count: 40, zoom: 2.1, frames: 180, extra: [['demon-badger', 10, 14, 0]] });
SHOTS.n2_flamer = holdWeaponShot({ scenario: { classId: 'dachs_of_steel', mapId: '11', timeOfDay: NIGHT, weapon2: 'FLAMETHROWER' }, kind: 'rabid-badger', dx: 10, count: 18, zoom: 2.6, frames: 200, sweep: 1.2, extra: [['zombie-badger', 16, 7, 0]] });
SHOTS.n3_holy = {
  scenario: { classId: 'dachs_nukem', mapId: '6', timeOfDay: NIGHT },
  frames: 220, warmup: WARM,
  setup: async (ctx) => {
    const P = ctx.P;
    await ctx.spawnPack('zombie-badger', P.x + 12, P.y, 45, 4.5, 4);
    await ctx.spawnPack('demon-badger', P.x + 14, P.y, 8, 2, 3);
    await ctx.cam({ follow: true, zoom: 1.8, ox: 210 });
  },
  timeline: async (f, ctx) => {
    if (f === -110) { await aimCluster(ctx, 30); await ctx.run({ action: 'temporaryUtility', utility: 'HOLY_HAND_GRENADE' }); }
    if (f >= 0) await ctx.cam({ zoom: lerpKeys([[0, 1.8], [220, 1.65]], f) });
  },
};
// Nuke: throw, fast-forward countdown, slow-motion detonation (≈5 s fuse after release).
SHOTS.n4_nuke = {
  scenario: { classId: 'dachs_nukem', mapId: '6', timeOfDay: NIGHT },
  frames: 330, warmup: WARM,
  speed: f => f < 30 ? 1 : f < 110 ? 3 : f < 140 ? 1 : 0.35,
  setup: async (ctx) => {
    const P = ctx.P;
    await ctx.spawnPack('zombie-badger', P.x + 10, P.y, 60, 7, 6);
    await ctx.spawnPack('demon-badger', P.x + 13, P.y, 14, 4, 4);
    await ctx.camAt(P.x + 5, P.y, 1.6);
    await ctx.run({ action: 'target', gridX: P.x + 10, gridY: P.y });
  },
  timeline: async (f, ctx) => {
    const P = ctx.P;
    if (f === 8) await ctx.run({ action: 'temporaryUtility', utility: 'NUKE' });
    if (f === 45) {
      await ctx.run({ action: 'target', gridX: Math.max(2, P.x - 30), gridY: P.y }); await ctx.run({ action: 'findFree' });
      await ctx.run({ action: 'teleport' }); await ctx.run({ action: 'target', gridX: P.x + 10, gridY: P.y });
    }
    if (f >= 0) await ctx.camAt(P.x + lerpKeys([[0, 5], [45, 9.5], [330, 10]], f), P.y, lerpKeys([[0, 1.6], [45, 1.35], [190, 1.2], [330, 1.32]], f));
  },
};
