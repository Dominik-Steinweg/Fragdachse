import { lerpKeys, ease } from './harness.mjs';
import { SHOTS } from './shots2.mjs';

// Deterministic pseudo-random (per bot) so re-renders stay identical.
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const g = p => ({ gridX: (p.x - 16) / 32, gridY: (p.y - 16) / 32 });
const botSpec = (name, weapon1) => ({ name, weapon1, weapon2: 'P90', player: null });
const DOC_BOTS = [botSpec('Opa Dachs', 'GLOCK'), botSpec('Kalle', 'GLOCK'), botSpec('Bodo', 'GLOCK'), botSpec('Uwe', 'PLASMA'), botSpec('Hansi', 'PLASMA'), botSpec('Rolf', 'PLASMA')];
const doc = (timeOfDay, extra = {}) => ({ classId: 'dachs_nukem', mapId: '5', seed: 4242, timeOfDay, bots: DOC_BOTS, weapon1: 'GLOCK', hideAim: true, ...extra });
const park = ctx => ctx.run({ action: 'teleport', gridX: 3, gridY: 2 });
const place = async (ctx, spots) => { for (const [i, gx, gy] of spots) await ctx.bot(i, { place: true, gridX: gx, gridY: gy }); };

/**
 * Duelling movement: circle-strafe around the opponent with varying direction, short dashes
 * towards/away from it, occasional pauses, and a soft leash back to the home spot.
 */
function duelMover(pairs, homes) {
  const state = new Map();
  return async (f, ctx) => {
    const bots = await ctx.page.evaluate(() => window.devScenario.status().bots);
    for (const [a, b] of pairs) for (const [me, other] of [[a, b], [b, a]]) {
      const p = bots[me], o = bots[other];
      if (!p || !o) continue;
      await ctx.bot(me, { aim: g(o) });
      let s = state.get(me);
      if (!s) { s = { next: 0, rand: rng(me * 7919 + 17), dir: me % 2 ? 1 : -1 }; state.set(me, s); }
      if (f < s.next) continue;
      const r = s.rand;
      const dx = o.x - p.x, dy = o.y - p.y, l = Math.hypot(dx, dy) || 1;
      const ux = dx / l, uy = dy / l, px = -uy, py = ux;
      const home = homes[me], hx = home[0] * 32 + 16 - p.x, hy = home[1] * 32 + 16 - p.y, hl = Math.hypot(hx, hy);
      let mx, my, dur;
      const roll = r();
      if (hl > 3.2 * 32) { mx = hx / hl; my = hy / hl; dur = 350 + r() * 300; }                         // drift back home
      else if (roll < 0.14) { mx = 0; my = 0; dur = 250 + r() * 350; }                                     // brief pause
      else {
        if (r() < 0.35) s.dir = -s.dir;                                                                    // change strafe side
        const along = roll < 0.35 ? 0.8 : roll < 0.5 ? -0.7 : (r() - 0.5) * 0.6;                            // approach / retreat / mostly lateral
        mx = px * s.dir + ux * along; my = py * s.dir + uy * along;
        const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml; dur = 280 + r() * 620;
      }
      if (mx === 0 && my === 0) await ctx.bot(me, { move: { dx: 0, dy: 0, durationMs: 0 } });
      else await ctx.bot(me, { move: { dx: mx, dy: my, durationMs: dur } });
      s.next = f + Math.round(dur / 16.67) + Math.round(r() * 6);
    }
  };
}

const SPAR_HOMES = { 1: [24, 15], 2: [30, 14], 3: [38, 15], 4: [44, 17], 0: [28, 21], 5: [36, 22] };
const sparMove = duelMover([[1, 2], [3, 4], [0, 5]], SPAR_HOMES);
SHOTS.d3_sparring2 = {
  scenario: doc(520, { playerFreeForAll: true }), frames: 480, warmup: 40,
  setup: async (ctx) => {
    await park(ctx);
    await place(ctx, Object.entries(SPAR_HOMES).map(([i, [x, y]]) => [Number(i), x, y]));
    await ctx.camAt(34, 16, 1.65);
  },
  timeline: async (f, ctx) => {
    await sparMove(f, ctx);
    if (f === -30) for (const i of [1, 2, 3, 4, 0, 5]) await ctx.bot(i, { fire: 'weapon1' });
    if (f >= 0) {
      await ctx.camAt(34, 16, lerpKeys([[0, 1.65], [276, 1.8], [480, 1.45]], f));
      if (f >= 300) await ctx.tod(lerpKeys([[300, 540], [480, 1100]], f, ease.inOut));
    }
  },
};

// Dusk: shooters track the passing train smoothly (aim point glides along the rails).
SHOTS.d5_burrow_train2 = {
  scenario: doc(1110), frames: 270, warmup: 60,
  setup: async (ctx) => {
    await park(ctx);
    await place(ctx, [[3, 29, 23], [4, 30, 25], [5, 28, 24], [1, 28, 15], [2, 30, 16], [0, 26, 18]]);
    ctx.data = { aim: { 1: 15, 2: 16 } };
    for (const i of [1, 2]) await ctx.bot(i, { aim: { gridX: 34.5, gridY: ctx.data.aim[i] } });
    await ctx.bot(0, { aim: { gridX: 34.5, gridY: 18 } });
    await ctx.camAt(33, 20, 1.9);
  },
  timeline: async (f, ctx) => {
    if (f === -40) await ctx.run({ action: 'train', invulnerable: true });
    if (f >= -40) {
      // The aim glides with gentle sway along the rails in front of each shooter – no snapping between wagons.
      for (const i of [1, 2]) {
        const base = i === 1 ? 14.5 : 16.5;
        const target = base + Math.sin((f + i * 40) / 38) * 2.2;
        ctx.data.aim[i] += (target - ctx.data.aim[i]) * 0.12;
        await ctx.bot(i, { aim: { gridX: 34.5, gridY: ctx.data.aim[i] } });
      }
    }
    if (f === 0) for (const i of [1, 2]) await ctx.bot(i, { fire: 'weapon1' });
    if (f === 95) for (const i of [1, 2]) await ctx.bot(i, { fire: null });
    if (f === 30) for (const i of [3, 4, 5]) await ctx.bot(i, { burrow: 'enter' });
    if (f === 70) for (const i of [3, 4, 5]) await ctx.bot(i, { move: { dx: 1, dy: -0.15, durationMs: 650 } });
    if (f === 200) for (const i of [3, 4, 5]) await ctx.bot(i, { burrow: 'exit' });
    if (f >= 0) {
      await ctx.tod(lerpKeys([[0, 1110], [270, 1170]], f, ease.linear));
      await ctx.camAt(lerpKeys([[0, 32], [270, 35]], f), lerpKeys([[0, 20], [270, 21]], f), lerpKeys([[0, 1.9], [270, 1.75]], f, ease.linear));
    }
  },
};

// ════════ ACTION v2 ════════
const aimNearest = (ctx, kinds = null) => ctx.page.evaluate((kinds) => {
  const d = window.__T.dev; const p = d.runtime.navigationLabPort.getPlayerPosition();
  let en = d.runtime.navigationLabPort.readEnemies(); if (kinds) { const f = en.filter(e => kinds.includes(e.kind)); if (f.length) en = f; }
  if (!en.length || !p) return;
  let best = null, bd = Infinity;
  for (const e of en) { const dd = (e.x - p.x) ** 2 + (e.y - p.y) ** 2; if (dd < bd) { bd = dd; best = e; } }
  d.aim = d.grid({ x: best.x, y: best.y });
}, kinds);
const aimCluster = (ctx, n = 12, sweep = 0) => ctx.page.evaluate(([n, sweep]) => {
  const d = window.__T.dev; const p = d.runtime.navigationLabPort.getPlayerPosition();
  const en = d.runtime.navigationLabPort.readEnemies(); if (!en.length || !p) return;
  en.sort((a, b) => ((a.x - p.x) ** 2 + (a.y - p.y) ** 2) - ((b.x - p.x) ** 2 + (b.y - p.y) ** 2));
  const sel = en.slice(0, n); let x = 0, y = 0; for (const e of sel) { x += e.x; y += e.y; } x /= sel.length; y /= sel.length;
  const dx = x - p.x, dy = y - p.y, l = Math.hypot(dx, dy) || 1;
  d.aim = d.grid({ x: x - dy / l * sweep * 32, y: y + dx / l * sweep * 32 });
}, [n, sweep]);
const WARM = 130;
const NIGHT = 1290;
const PLASMA_BURNER_MAX = { plasma_burner_range: 3, plasma_burner_charges: 3, plasma_burner_target_lock: 3, plasma_burner_overload: 1, plasma_burner_capacitor: 3, plasma_burner_retention: 3, plasma_burner_chain: 1, plasma_burner_cascade: 3, plasma_burner_coupling: 3 };
const DRONES_MAX = { attack_drone_self_loader: 3, attack_drone_service: 3, attack_drone_flight: 3, attack_drone_penetration: 3, attack_drone_bomb_bay: 1, attack_drone_bomb_count: 3, attack_drone_fire_chunks: 3 };
const spawnMix = async (ctx, groups) => { for (const [kind, n, gx, gy, rx = 3, ry = 3] of groups) await ctx.spawnPack(kind, gx, gy, n, rx, ry); };

SHOTS.a1_minirocket2 = {
  scenario: { classId: 'dachs_nukem', mapId: '10', timeOfDay: 760, weapon2: 'MINI_ROCKET_LAUNCHER', hideAim: true },
  frames: 180, warmup: WARM,
  setup: async (ctx) => { const P = ctx.P; await spawnMix(ctx, [['zombie-badger', 30, P.x - 14, P.y + 1, 4, 5], ['alien-badger', 10, P.x - 17, P.y + 1]]); await ctx.cam({ follow: true, zoom: 2.0, ox: -170 }); },
  timeline: async (f, ctx) => {
    if (f >= -40) await aimCluster(ctx, 14, Math.sin((f + 40) / 50) * 1.5);
    if (f === -20) await ctx.run({ action: 'holdWeapon', slot: 'weapon2' });
    if (f >= 0) await ctx.cam({ zoom: lerpKeys([[0, 2.0], [180, 1.85]], f, ease.linear) });
  },
};
// Plasma burner from range: long, clearly visible beams into void stalkers.
SHOTS.a2_plasmaburner2 = {
  scenario: { classId: 'inspector_gadachs', mapId: '6', timeOfDay: 720, weapon2: 'PLASMA_BURNER', upgrades: PLASMA_BURNER_MAX, hideAim: true },
  frames: 180, warmup: WARM,
  setup: async (ctx) => { const P = ctx.P; await spawnMix(ctx, [['void-stalker', 10, P.x + 19, P.y, 3, 5], ['zombie-badger', 24, P.x + 21, P.y + 1, 4, 5]]); await ctx.cam({ follow: true, zoom: 1.55, ox: 300 }); },
  timeline: async (f, ctx) => {
    if (f >= -30) await aimNearest(ctx);
    if (f === -10) await ctx.run({ action: 'holdWeapon', slot: 'weapon2' });
    if (f >= 0) await ctx.cam({ zoom: lerpKeys([[0, 1.55], [180, 1.6]], f, ease.linear) });
  },
};
async function buildNear(ctx, id, gx, gy) {
  const offsets = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [0, 2], [-2, 0], [0, -2]];
  for (const [dx, dy] of offsets) for (let attempt = 0; attempt < 10; attempt++) {
    const r = await ctx.run({ action: 'build', id, gridX: gx + dx, gridY: gy + dy }, true);
    if (r.ok) { console.log('  built', id, gx + dx, gy + dy); return true; }
    if (!/cooldown/.test(r.error)) break;
    await ctx.step(30);
  }
  console.log('  build failed', id); return false;
}
// Three attack drone stations → three drones in the air.
SHOTS.a5_drones3 = {
  scenario: { classId: 'inspector_gadachs', mapId: '7', seed: 12345, timeOfDay: 760, player: { gridX: 98, gridY: 26 }, weapon2: 'PLASMA_BURNER', hideAim: true,
    upgrades: { inspector_construction_slots: 3, ...DRONES_MAX }, tools: [{ kind: 'construction', id: 'attack_drone_station' }] },
  frames: 200, warmup: 60,
  setup: async (ctx) => {
    const P = ctx.P;
    for (const [gx, gy] of [[101, 26], [100, 23], [102, 24]]) await buildNear(ctx, 'attack_drone_station', gx, gy);
    await ctx.step(240);
    await spawnMix(ctx, [['zombie-badger', 34, P.x + 14, P.y, 5, 6], ['demon-badger', 10, P.x + 17, P.y, 3, 4], ['pyro-badger', 4, P.x + 19, P.y + 2, 2, 2]]);
    await ctx.step(70);
    await ctx.camAt(P.x + 8, P.y - 1, 1.6);
  },
  timeline: async (f, ctx) => { if (f >= 0) await ctx.camAt(ctx.P.x + lerpKeys([[0, 8], [200, 10]], f), ctx.P.y - 1, lerpKeys([[0, 1.6], [200, 1.5]], f)); },
};
SHOTS.n1_plasma3 = {
  scenario: { classId: 'dachs_nukem', mapId: '10', timeOfDay: NIGHT, weapon1: 'PLASMA', hideAim: true },
  frames: 180, warmup: WARM,
  setup: async (ctx) => { const P = ctx.P; await spawnMix(ctx, [['void-stalker', 12, P.x - 14, P.y + 1, 3, 5], ['zombie-badger', 24, P.x - 16, P.y + 1, 4, 5]]); await ctx.cam({ follow: true, zoom: 2.1, ox: -160 }); },
  timeline: async (f, ctx) => {
    if (f >= -25) await aimCluster(ctx, 8, Math.sin(f / 20) * 1.5);
    if (f === -25) await ctx.run({ action: 'holdWeapon', slot: 'weapon1' });
    if (f >= 0) await ctx.cam({ zoom: lerpKeys([[0, 2.1], [180, 1.95]], f) });
  },
};
SHOTS.n2_flamer4 = {
  scenario: { classId: 'dachs_of_steel', mapId: '11', timeOfDay: NIGHT, weapon2: 'FLAMETHROWER', hideAim: true },
  frames: 180, warmup: 110,
  setup: async (ctx) => { const P = ctx.P; await spawnMix(ctx, [['alien-badger', 10, P.x + 12, P.y - 1, 2, 4], ['zombie-badger', 22, P.x + 15, P.y - 1, 3, 5]]); await ctx.cam({ follow: true, zoom: 2.3, ox: 120, oy: -10 }); },
  timeline: async (f, ctx) => {
    const P = ctx.P;
    if (f === -30) await ctx.run({ action: 'holdWeapon', slot: 'weapon2' });
    if (f >= -30) await ctx.run({ action: 'target', gridX: P.x + 5, gridY: P.y - 0.6 + Math.sin(f / 22) * 1.6 });
  },
};
// Holy hand grenade: short throw (lands ≈7 cells away) into a pinned crowd; the camera centres the landing point.
SHOTS.n3_holy3 = {
  scenario: { classId: 'dachs_nukem', mapId: '9', timeOfDay: NIGHT, hideAim: true },
  frames: 300, warmup: 110,
  setup: async (ctx) => {
    const P = await ctx.teleport(16, 26), cx = P.x + 10.8, cy = P.y + 0.3; ctx.P = P;
    const pinned = async (kind, n, rx, ry) => ctx.page.evaluate(([kind, n, cx, cy, rx, ry]) => {
      let ok = 0; for (let i = 0; i < n * 6 && ok < n; i++) { const r = Math.sqrt((i + 0.5) / (n * 3)), a = i * 2.399963;
        if (window.devScenario.run({ action: 'spawn', kind, pinned: true, hp: 400, gridX: Math.round((cx + Math.cos(a) * r * rx) * 2) / 2, gridY: Math.round((cy + Math.sin(a) * r * ry) * 2) / 2 }).ok) ok++; } return ok;
    }, [kind, n, cx, cy, rx, ry]);
    await pinned('zombie-badger', 28, 4.0, 2.4); await pinned('demon-badger', 5, 3.5, 2.2); await pinned('zombie-badger', 6, 3.8, 2.3); await pinned('demon-badger', 6, 4.0, 2.4);
    ctx.data = { cx, cy };
    await ctx.camAt(cx - 2.5, cy, 1.6);
    await ctx.run({ action: 'target', gridX: P.x + 10, gridY: cy });
  },
  timeline: async (f, ctx) => {
    if (f === 20) await ctx.run({ action: 'temporaryUtility', utility: 'HOLY_HAND_GRENADE', chargeMs: 220 });
    if (f >= 0) await ctx.camAt(lerpKeys([[0, ctx.data.cx - 2.5], [300, ctx.data.cx - 0.5]], f), ctx.data.cy, lerpKeys([[0, 1.6], [300, 1.72]], f));
  },
};
SHOTS.n4_nuke3 = { ...SHOTS.n4_nuke2, scenario: { ...SHOTS.n4_nuke2.scenario, hideAim: true } };
{
  const base = SHOTS.n3_holy3;
  SHOTS.n3_holy3 = { ...base, timeline: async (f, ctx) => {
    if (f === 12) console.log('  status', JSON.stringify(await ctx.page.evaluate(() => { const s = window.devScenario.status(); return { player: s.player, msg: s.message }; })));
    if (f >= 20 && !ctx.data.thrown) {
      const r = await ctx.run({ action: 'temporaryUtility', utility: 'HOLY_HAND_GRENADE', chargeMs: 220 }, true);
      if (r.ok) { ctx.data.thrown = f; console.log('  thrown at', f); }
    }
    if (f >= 0) await ctx.camAt(lerpKeys([[0, ctx.data.cx - 2.5], [300, ctx.data.cx - 0.5]], f), ctx.data.cy, lerpKeys([[0, 1.6], [300, 1.72]], f));
  } };
}

// Re-takes without aim assist.
for (const name of ['a3_leafblower', 'a4_timebubble', 'a6_p90', 'n5_plasma2', 'd9_horde']) {
  SHOTS[name + '_h'] = { ...SHOTS[name], scenario: { ...SHOTS[name].scenario, hideAim: true } };
}
