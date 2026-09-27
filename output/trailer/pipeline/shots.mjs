import { lerpKeys, ease } from './harness.mjs';

const nukem = (extra = {}) => ({ classId: 'dachs_nukem', mapId: '6', timeOfDay: 720, ...extra });

/** Generic weapon test: pack to the right, hold weapon2 from frame 5, sweep slightly. */
function weaponTest(scenario, { kind = 'zombie-badger', count = 18, dist = 8, zoom = 1.6, slot = 'weapon2', frames = 180, sweep = 0.4 } = {}) {
  return {
    scenario,
    frames,
    setup: async (ctx) => {
      const P = ctx.P;
      await ctx.spawnPack(kind, P.x + dist, P.y, count, 3.5, 3);
      await ctx.cam({ zoom, ox: dist * 32 * 0.35 });
      await ctx.aim(P.x + dist, P.y);
    },
    timeline: async (f, ctx) => {
      if (f === 5) await ctx.cmd({ action: 'holdWeapon', slot });
      const a = Math.sin(f / frames * Math.PI * 2) * sweep;
      await ctx.aim(ctx.P.x + Math.cos(a) * dist, ctx.P.y + Math.sin(a) * dist);
    },
  };
}

/** Utility/ultimate test: throw at pack center at frame 10. */
function actionTest(scenario, action, { kind = 'zombie-badger', count = 24, dist = 8, zoom = 1.3, frames = 240, pressAt = 10, releaseAt = null } = {}) {
  return {
    scenario, frames,
    setup: async (ctx) => {
      const P = ctx.P;
      await ctx.spawnPack(kind, P.x + dist, P.y, count, 4, 3.5);
      await ctx.cam({ zoom, ox: dist * 32 * 0.45 });
      await ctx.aim(P.x + dist, P.y);
    },
    timeline: async (f, ctx) => {
      if (action.startsWith('temp:')) {
        if (f === pressAt) console.log('  startTemp', JSON.stringify(await ctx.page.evaluate(id => window.__T.startTemp(id), action.slice(5))));
        if (f === (releaseAt ?? pressAt + 12)) console.log('  releaseTemp', JSON.stringify(await ctx.page.evaluate(() => window.__T.releaseTemp())));
        return;
      }
      if (f === pressAt) await ctx.cmd(action === 'utility' ? { action: 'utility' } : { action: 'ultimate', phase: 'press' });
      if (releaseAt !== null && f === releaseAt) await ctx.cmd({ action: 'ultimate', phase: 'release' });
    },
  };
}

export const SHOTS = {
  t_rocket: weaponTest(nukem({ weapon2: 'ROCKET_LAUNCHER' })),
  t_flame: weaponTest(nukem({ weapon2: 'FLAMETHROWER', timeOfDay: 1170 }), { dist: 5, zoom: 2 }),
  t_tesla: weaponTest(nukem({ weapon2: 'TESLA_DOME' }), { dist: 4, zoom: 2 }),
  t_negev: weaponTest(nukem({ weapon2: 'NEGEV', timeOfDay: 1110 }), { count: 30 }),
  t_plasmaburner: weaponTest({ classId: 'inspector_gadachs', mapId: '6', timeOfDay: 720, weapon2: 'PLASMA_BURNER' }, { dist: 5, zoom: 2 }),
  t_leaf: weaponTest(nukem({ weapon1: 'LEAF_BLOWER' }), { slot: 'weapon1', dist: 5, zoom: 2 }),
  t_holy: actionTest(nukem(), 'temp:HOLY_HAND_GRENADE', { frames: 300 }),
  t_nuke: actionTest(nukem(), 'temp:NUKE', { frames: 420, zoom: 1.0, dist: 12 }),
  t_bfg: actionTest(nukem(), 'temp:BFG', { frames: 300 }),
  t_airstrike: actionTest(nukem({ ultimate: 'AIRSTRIKE' }), 'ultimate', { frames: 360, zoom: 1.1, dist: 10 }),
  t_armageddon: actionTest(nukem({ ultimate: 'ARMAGEDDON' }), 'ultimate', { frames: 360, zoom: 1.1 }),
  t_rage: actionTest(nukem({ ultimate: 'HONEY_BADGER_RAGE' }), 'ultimate', { frames: 300, zoom: 1.6, dist: 5 }),
  t_gauss: actionTest(nukem({ ultimate: 'GAUSS_RIFLE' }), 'ultimate', { frames: 240, zoom: 1.3, releaseAt: 90 }),
};

SHOTS.t_bfg = actionTest(nukem(), 'temp:BFG', { frames: 300, releaseAt: 70 });

SHOTS.t_boss = {
  scenario: nukem({ weapon2: 'ROCKET_LAUNCHER', timeOfDay: 1110 }),
  frames: 300,
  setup: async (ctx) => {
    const P = ctx.P;
    await ctx.spawnPack('inferno-colossus', P.x + 11, P.y - 2, 1, 1, 1);
    await ctx.spawnPack('grave-titan', P.x + 11, P.y + 4, 1, 1, 1);
    await ctx.cam({ zoom: 1.3, ox: 160 });
    await ctx.aim(P.x + 11, P.y);
  },
  timeline: async (f, ctx) => {
    if (f === 30) await ctx.cmd({ action: 'holdWeapon', slot: 'weapon2' });
    const en = f % 10 === 0 ? await ctx.enemies() : null;
    if (en && en.length) { const e = en[0]; await ctx.page.evaluate(([x, y]) => { const d = window.__T.dev; d.aim = d.grid({ x, y }); }, [e.x, e.y]); }
  },
};

SHOTS.t_turrets = {
  scenario: { classId: 'inspector_gadachs', mapId: '6', timeOfDay: 720, upgrades: { inspector_construction_slots: 3 },
    tools: [{ kind: 'construction', id: 'flame_turret' }, { kind: 'construction', id: 'tesla_turret' }, { kind: 'construction', id: 'rocket_turret' }, { kind: 'construction', id: 'machine_gun_turret' }] },
  frames: 300, warmup: 30,
  setup: async (ctx) => {
    const P = ctx.P;
    const plan = [['flame_turret', 3, -2], ['tesla_turret', 3, 2], ['rocket_turret', 1, -4], ['machine_gun_turret', 1, 4]];
    for (const [id, dx, dy] of plan) {
      for (let attempt = 0; attempt < 12; attempt++) {
        const r = await ctx.page.evaluate(c => window.devScenario.run(c), { action: 'build', id, gridX: P.x + dx, gridY: P.y + dy });
        if (r.ok) { console.log('  built', id); break; }
        if (attempt === 11) console.log('  build failed', id, r.error);
        await ctx.step(30);
      }
    }
    await ctx.step(120);
    await ctx.spawnPack('zombie-badger', P.x + 13, P.y, 40, 4, 5);
    await ctx.spawnPack('demon-badger', P.x + 16, P.y, 10, 3, 4);
    await ctx.cam({ zoom: 1.4, ox: 180 });
    await ctx.aim(P.x + 10, P.y);
  },
};
SHOTS.t_armageddon = actionTest(nukem({ ultimate: 'ARMAGEDDON' }), 'ultimate', { frames: 360, zoom: 1.1, count: 40 });
SHOTS.t_rage = actionTest(nukem({ ultimate: 'HONEY_BADGER_RAGE' }), 'ultimate', { frames: 300, zoom: 1.6, dist: 5 });

SHOTS.t_turrets7 = {
  scenario: { classId: 'inspector_gadachs', mapId: '7', seed: 12345, timeOfDay: 720, upgrades: { inspector_construction_slots: 3 }, player: { gridX: 98, gridY: 26 },
    tools: [{ kind: 'construction', id: 'flame_turret' }, { kind: 'construction', id: 'tesla_turret' }, { kind: 'construction', id: 'rocket_turret' }, { kind: 'construction', id: 'machine_gun_turret' }] },
  frames: 240, warmup: 30,
  setup: async (ctx) => {
    const P = ctx.P;
    const plan = [['flame_turret', 102, 25], ['tesla_turret', 102, 29], ['rocket_turret', 100, 22], ['machine_gun_turret', 100, 31]];
    for (const [id, gx, gy] of plan) {
      for (let attempt = 0; attempt < 12; attempt++) {
        const r = await ctx.page.evaluate(c => window.devScenario.run(c), { action: 'build', id, gridX: gx, gridY: gy });
        if (r.ok) { console.log('  built', id); break; }
        if (attempt === 11) console.log('  build failed', id, r.error, JSON.stringify(r.status.lastAction));
        await ctx.step(30);
      }
    }
    await ctx.step(150);
    await ctx.spawnPack('zombie-badger', P.x + 14, P.y, 40, 4, 6);
    await ctx.spawnPack('demon-badger', P.x + 17, P.y, 10, 3, 4);
    await ctx.cam({ zoom: 1.3, ox: 200 });
    await ctx.aim(P.x + 10, P.y);
  },
};
