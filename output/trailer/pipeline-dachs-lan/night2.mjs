import { lerpKeys, ease } from './harness.mjs';
import { SHOTS } from './shots2.mjs';

const NIGHT = 1290;
const aimAt = (ctx, gx, gy) => ctx.run({ action: 'target', gridX: gx, gridY: gy });

// Flamethrower v2: zombies walk into a steady flame cone (map 11, open field).
SHOTS.n2_flamer2 = {
  scenario: { classId: 'dachs_of_steel', mapId: '11', timeOfDay: NIGHT, weapon2: 'FLAMETHROWER' },
  frames: 220, warmup: 110,
  setup: async (ctx) => {
    const P = ctx.P;
    await ctx.spawnPack('zombie-badger', P.x + 12, P.y - 1, 34, 3, 5);
    await ctx.spawnPack('demon-badger', P.x + 16, P.y - 1, 8, 2, 3);
    await ctx.cam({ follow: true, zoom: 2.3, ox: 120, oy: -10 });
    await aimAt(ctx, P.x + 5, P.y - 0.6);
  },
  timeline: async (f, ctx) => {
    const P = ctx.P;
    if (f === -30) await ctx.run({ action: 'holdWeapon', slot: 'weapon2' });
    if (f >= -30) await aimAt(ctx, P.x + 5, P.y - 0.6 + Math.sin(f / 22) * 1.6);
    if (f >= 0) await ctx.cam({ zoom: lerpKeys([[0, 2.3], [220, 2.45]], f, ease.linear) });
  },
};

// Holy hand grenade v2: thrown where the horde piles up at the base.
SHOTS.n3_holy2 = {
  scenario: { classId: 'dachs_nukem', mapId: '6', timeOfDay: NIGHT },
  frames: 220, warmup: 130,
  setup: async (ctx) => {
    const P = ctx.P;
    await ctx.spawnPack('zombie-badger', P.x + 9, P.y + 1, 45, 4, 4);
    await ctx.spawnPack('demon-badger', P.x + 11, P.y + 1, 8, 2, 3);
    await ctx.cam({ follow: true, zoom: 1.75, ox: 150 });
  },
  timeline: async (f, ctx) => {
    const P = ctx.P;
    if (f === -110) { await aimAt(ctx, P.x + 5.5, P.y + 1); await ctx.run({ action: 'temporaryUtility', utility: 'HOLY_HAND_GRENADE', chargeMs: 300 }); }
    if (f >= 0) await ctx.cam({ zoom: lerpKeys([[0, 1.75], [220, 1.6]], f) });
  },
};

SHOTS.n5_plasma2 = {
  scenario: { classId: 'dachs_nukem', mapId: '10', timeOfDay: NIGHT, weapon1: 'PLASMA' },
  frames: 200, warmup: 130,
  setup: async (ctx) => {
    const P = ctx.P;
    await ctx.spawnPack('zombie-badger', P.x - 13, P.y + 1, 40, 4, 5);
    await ctx.spawnPack('rabid-badger', P.x - 16, P.y + 1, 10, 2, 3);
    await ctx.cam({ follow: true, zoom: 2.2, ox: -160 });
  },
  timeline: async (f, ctx) => {
    const P = ctx.P;
    if (f === -25) await ctx.run({ action: 'holdWeapon', slot: 'weapon1' });
    if (f >= -25) await aimAt(ctx, P.x - 8, P.y + 1 + Math.sin(f / 20) * 2.5);
    if (f >= 0) await ctx.cam({ zoom: lerpKeys([[0, 2.2], [200, 2.0]], f) });
  },
};
SHOTS.n6_flamer3 = {
  scenario: { classId: 'dachs_of_steel', mapId: '10', timeOfDay: NIGHT, weapon2: 'FLAMETHROWER' },
  frames: 200, warmup: 110,
  setup: async (ctx) => {
    const P = ctx.P;
    await ctx.spawnPack('zombie-badger', P.x - 12, P.y + 1, 34, 3, 5);
    await ctx.spawnPack('demon-badger', P.x - 15, P.y + 1, 10, 2, 3);
    await ctx.cam({ follow: true, zoom: 2.4, ox: -120 });
  },
  timeline: async (f, ctx) => {
    const P = ctx.P;
    if (f === -30) await ctx.run({ action: 'holdWeapon', slot: 'weapon2' });
    if (f >= -30) await aimAt(ctx, P.x - 5, P.y + 1 + Math.sin(f / 18) * 1.8);
    if (f >= 0) await ctx.cam({ zoom: lerpKeys([[0, 2.4], [200, 2.6]], f) });
  },
};
SHOTS.n4_nuke2 = { ...SHOTS.n4_nuke, frames: 430 };
