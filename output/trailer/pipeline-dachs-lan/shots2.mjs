import { lerpKeys, ease } from './harness.mjs';

export const SHOTS = {};
const botSpec = (name, weapon1) => ({ name, weapon1, weapon2: 'P90', player: null });
const DOC_BOTS = [botSpec('Opa Dachs', 'GLOCK'), botSpec('Kalle', 'GLOCK'), botSpec('Bodo', 'GLOCK'), botSpec('Uwe', 'PLASMA'), botSpec('Hansi', 'PLASMA'), botSpec('Rolf', 'PLASMA')];
const doc = (timeOfDay, extra = {}) => ({ classId: 'dachs_nukem', mapId: '5', seed: 4242, timeOfDay, bots: DOC_BOTS, weapon1: 'GLOCK', ...extra });
const park = ctx => ctx.run({ action: 'teleport', gridX: 3, gridY: 2 });
const place = async (ctx, spots) => { for (const [i, gx, gy] of spots) await ctx.bot(i, { place: true, gridX: gx, gridY: gy }); };

// D1 — morning, establishing: the Dachsbau right at the rails of the RB 54.
SHOTS.d1_establish = {
  scenario: doc(475), frames: 360, warmup: 30,
  setup: async (ctx) => {
    await park(ctx);
    await place(ctx, [[0, 27, 19], [1, 24, 15], [2, 30, 14], [3, 38, 15], [4, 44, 17], [5, 37, 22]]);
    for (let i = 0; i < 6; i++) await ctx.bot(i, { aim: { gridX: 34, gridY: 18 } });
    await ctx.camAt(34, 11, 1.25);
  },
  timeline: async (f, ctx) => {
    if (f < 0) return;
    await ctx.camAt(lerpKeys([[0, 33], [360, 35]], f, ease.linear), lerpKeys([[0, 12], [360, 18]], f), lerpKeys([[0, 1.2], [360, 1.4]], f));
    if (f === 40) await ctx.bot(4, { move: { dx: -1, dy: 0.3, durationMs: 1500 } });
    if (f === 120) await ctx.bot(1, { move: { dx: 0.4, dy: 1, durationMs: 1000 } });
    if (f === 200) await ctx.bot(5, { move: { dx: -1, dy: -0.2, durationMs: 1200 } });
  },
};

// D2 — portrait of a veteran: slowly looks around, then one bored pistol shot.
SHOTS.d2_portrait = {
  scenario: doc(490), frames: 300, warmup: 30,
  setup: async (ctx) => {
    await park(ctx);
    await place(ctx, [[0, 27, 19], [1, 24, 15], [2, 30, 14], [3, 38, 15], [4, 44, 17], [5, 37, 22]]);
    await ctx.camAt(27, 19, 3.0);
  },
  timeline: async (f, ctx) => {
    const a = lerpKeys([[-30, 0.2], [100, -0.9], [200, 0.6], [300, 0.1]], f);
    await ctx.bot(0, { aim: { gridX: 27 + Math.cos(a) * 6, gridY: 19 + Math.sin(a) * 6 } });
    if (f >= 0) await ctx.camAt(27, 19, lerpKeys([[0, 3.0], [300, 3.3]], f, ease.linear));
    if (f === 215) await ctx.bot(0, { fire: 'weapon1' });
    if (f === 222) await ctx.bot(0, { fire: null });
  },
};

// D3/D4 — sparring with Glock and Plasma; later the day races by (time-lapse into the evening).
SHOTS.d3_sparring = {
  scenario: doc(520, { playerFreeForAll: true }), frames: 600, warmup: 30,
  setup: async (ctx) => {
    await park(ctx);
    await place(ctx, [[1, 24, 15], [2, 30, 14], [3, 38, 15], [4, 44, 17], [0, 28, 21], [5, 36, 22]]);
    await ctx.camAt(34, 16, 1.65);
  },
  timeline: async (f, ctx) => {
    const pairs = [[1, 2], [3, 4], [0, 5]];
    for (const [a, b] of pairs) {
      const sa = await ctx.page.evaluate(([a, b]) => { const s = window.devScenario.status().bots; return [s[a], s[b]]; }, [a, b]);
      if (!sa[0] || !sa[1]) continue;
      const g = p => ({ gridX: (p.x - 16) / 32, gridY: (p.y - 16) / 32 });
      await ctx.bot(a, { aim: g(sa[1]) }); await ctx.bot(b, { aim: g(sa[0]) });
    }
    if (f === -20) for (const i of [1, 2, 3, 4, 0, 5]) await ctx.bot(i, { fire: 'weapon1' });
    // Strafing: alternate up/down so the duels move.
    if (f % 45 === 0) for (const i of [1, 2, 3, 4, 0, 5]) {
      const dir = ((Math.floor(f / 45) + i) % 2) ? 1 : -1;
      await ctx.bot(i, { move: { dx: (i % 3 - 1) * 0.3, dy: dir, durationMs: 600 } });
    }
    if (f >= 0) {
      await ctx.camAt(34, 16, lerpKeys([[0, 1.65], [300, 1.8], [600, 1.35]], f));
      if (f >= 300) await ctx.tod(lerpKeys([[300, 540], [560, 1285], [600, 1290]], f, ease.inOut));
    }
  },
};

// D5 — dusk: a second group burrows under the rails while the RB 54 gets shot at.
SHOTS.d5_burrow_train = {
  scenario: doc(1195), frames: 360, warmup: 30,
  setup: async (ctx) => {
    await park(ctx);
    await place(ctx, [[3, 29, 23], [4, 30, 25], [5, 28, 24], [1, 28, 13], [2, 30, 15], [0, 39, 14]]);
    await ctx.camAt(34, 19, 1.45);
  },
  timeline: async (f, ctx) => {
    if (f === -25) await ctx.run({ action: 'train' });
    if (f >= -25) {
      const train = await ctx.page.evaluate(() => { const tr = window.__T.dev.runtime.flow.getWorldTrainRuntime()?.getCurrentTrain(); const seg = tr?.getSegmentPositions() ?? []; const inView = seg.filter(s => s.y > 150 && s.y < 1100); return inView[Math.floor(inView.length / 2)] ?? null; });
      for (const i of [1, 2, 0]) await ctx.bot(i, { aim: train ? { gridX: (train.x - 16) / 32, gridY: (train.y - 16) / 32 } : { gridX: 34.5, gridY: 16 } });
    }
    if (f === 0) for (const i of [1, 2, 0]) await ctx.bot(i, { fire: 'weapon1' });
    if (f === 15) for (const i of [3, 4, 5]) await ctx.bot(i, { burrow: 'enter' });
    if (f === 40) for (const i of [3, 4, 5]) await ctx.bot(i, { move: { dx: 1, dy: -0.1, durationMs: 3500 } });
    if (f === 270) for (const i of [3, 4, 5]) await ctx.bot(i, { burrow: 'exit' });
    if (f >= 0) {
      await ctx.tod(lerpKeys([[0, 1195], [360, 1265]], f, ease.linear));
      await ctx.camAt(lerpKeys([[0, 33], [360, 36]], f), 20, lerpKeys([[0, 1.45], [360, 1.55]], f, ease.linear));
    }
  },
};

// D6 — deep night; one of them walks off to overdo it.
SHOTS.d6_night = {
  scenario: doc(1385, { refillHp: false }), frames: 300, warmup: 30,
  setup: async (ctx) => {
    await park(ctx);
    await place(ctx, [[0, 22, 17], [1, 20, 15], [2, 25, 13], [3, 36, 20], [4, 37, 16], [5, 29, 22]]);
    for (let i = 1; i < 6; i++) await ctx.bot(i, { aim: { gridX: 31, gridY: 19 } });
    await ctx.bot(0, { aim: { gridX: 10, gridY: 18 } });
    await ctx.camAt(28, 18, 1.35);
  },
  timeline: async (f, ctx) => {
    if (f === 20) await ctx.bot(0, { move: { dx: -1, dy: 0.1, durationMs: 2300 } });
    if (f === 180) await ctx.bot(0, { aim: { gridX: 34.5, gridY: 10 } });
    if (f >= 0) {
      const p = await ctx.page.evaluate(() => window.devScenario.status().bots[0]);
      const bx = (p.x - 16) / 32, by = (p.y - 16) / 32;
      await ctx.camAt(lerpKeys([[0, 28], [300, bx + 1.5]], f), lerpKeys([[0, 18], [300, by]], f), lerpKeys([[0, 1.35], [300, 2.4]], f));
    }
  },
};

// D7/D8 — the BFG: charge, the orb tears through rocks and badgers, the RB 54 goes up in flames.
SHOTS.d7_bfg = {
  scenario: doc(1392, { refillHp: false, playerFreeForAll: true }), frames: 560, warmup: 30,
  speed: f => f < 255 ? 1 : f < 440 ? 0.4 : 1,
  setup: async (ctx) => {
    await park(ctx);
    await place(ctx, [[0, 12, 18], [1, 20, 15], [2, 25, 13], [3, 44, 21], [4, 45, 15], [5, 40, 24]]);
    await ctx.bot(0, { aim: { gridX: 34.5, gridY: 10 } });
    await ctx.bot(1, { aim: { gridX: 30, gridY: 13 } });
    await ctx.bot(2, { aim: { gridX: 22, gridY: 18 } });
    await ctx.camAt(13, 17.6, 2.7);
  },
  timeline: async (f, ctx) => {
    if (f === 20) await ctx.bot(0, { temporaryUtility: 'BFG' });
    if (f === 24) await ctx.run({ action: 'train' });
    if (f < 0) return;
    // Follow the orb along its path (shooter → rails), then open up on the train.
    const orb = await ctx.page.evaluate(() => {
      const d = window.__T.dev; const pm = d.runtime; // BFG projectile position from the effect snapshot if available
      return null;
    });
    const gx = lerpKeys([[0, 13], [74, 13.5], [150, 21], [250, 31], [320, 33], [560, 33]], f);
    const gy = lerpKeys([[0, 17.6], [74, 17.5], [150, 14.5], [250, 11.5], [320, 12], [560, 13]], f);
    const z = lerpKeys([[0, 2.7], [74, 2.5], [180, 1.9], [250, 1.6], [320, 1.25], [560, 1.2]], f);
    await ctx.camAt(gx, gy, z);
  },
};

// D9 — the dead rise: hordes run through the dark towards the Dachsbau.
SHOTS.d9_horde = {
  scenario: doc(1392, { bots: [] }), frames: 300, warmup: 150,
  setup: async (ctx) => {
    await ctx.run({ action: 'teleport', gridX: 29, gridY: 19 });
    await ctx.spawnPack('zombie-badger', 62, 12, 45, 8, 7);
    await ctx.spawnPack('zombie-badger', 62, 27, 40, 8, 6);
    await ctx.spawnPack('demon-badger', 68, 19, 18, 4, 8);
    await ctx.spawnPack('rabid-badger', 70, 18, 14, 3, 8);
    await ctx.camAt(52, 18, 1.5);
  },
  timeline: async (f, ctx) => {
    if (f >= 0) await ctx.camAt(lerpKeys([[0, 50], [300, 41]], f, ease.linear), 18.5, lerpKeys([[0, 1.5], [300, 1.35]], f));
  },
};

// ── Revisions ──
SHOTS.d5_burrow_train = {
  scenario: doc(1110), frames: 270, warmup: 30,
  setup: async (ctx) => {
    await park(ctx);
    await place(ctx, [[3, 29, 23], [4, 30, 25], [5, 28, 24], [1, 28, 15], [2, 30, 16], [0, 26, 18]]);
    await ctx.camAt(33, 20, 1.9);
  },
  timeline: async (f, ctx) => {
    if (f === -40) await ctx.run({ action: 'train' });
    if (f >= -40) {
      const train = await ctx.page.evaluate(() => { const tr = window.__T.dev.runtime.flow.getWorldTrainRuntime()?.getCurrentTrain(); const seg = tr?.getSegmentPositions() ?? []; const inView = seg.filter(s => s.y > 350 && s.y < 950); return inView[0] ?? null; });
      for (const i of [1, 2, 0]) await ctx.bot(i, { aim: train ? { gridX: (train.x - 16) / 32, gridY: (train.y - 16) / 32 } : { gridX: 34.5, gridY: 17 } });
    }
    if (f === 0) for (const i of [1, 2]) await ctx.bot(i, { fire: 'weapon1' });
    if (f === 90) for (const i of [1, 2]) await ctx.bot(i, { fire: null });
    if (f === 30) for (const i of [3, 4, 5]) await ctx.bot(i, { burrow: 'enter' });
    if (f === 70) for (const i of [3, 4, 5]) await ctx.bot(i, { move: { dx: 1, dy: -0.15, durationMs: 650 } });
    if (f === 200) for (const i of [3, 4, 5]) await ctx.bot(i, { burrow: 'exit' });
    if (f >= 0) {
      await ctx.tod(lerpKeys([[0, 1110], [270, 1170]], f, ease.linear));
      await ctx.camAt(lerpKeys([[0, 32], [270, 35]], f), lerpKeys([[0, 20], [270, 21]], f), lerpKeys([[0, 1.9], [270, 1.75]], f, ease.linear));
    }
  },
};
SHOTS.d6_night.timeline = async (f, ctx) => {
  if (f === 20) await ctx.bot(0, { move: { dx: -1, dy: 0.1, durationMs: 2300 } });
  if (f === 180) await ctx.bot(0, { aim: { gridX: 34.5, gridY: 10 } });
  if (f >= 0) {
    const p = await ctx.page.evaluate(() => window.devScenario.status().bots[0]);
    const bx = (p.x - 16) / 32, by = (p.y - 16) / 32;
    const z = lerpKeys([[0, 1.35], [300, 2.4]], f);
    await ctx.camAt(Math.max(30 / z + 0.2, lerpKeys([[0, 28], [300, bx + 1.5]], f)), lerpKeys([[0, 18], [300, by]], f), z);
  }
};
SHOTS.d9_horde = {
  scenario: doc(1392, { bots: [] }), frames: 300, warmup: 90,
  setup: async (ctx) => {
    await ctx.run({ action: 'teleport', gridX: 33, gridY: 22 });
    await ctx.spawnPack('zombie-badger', 7, 8, 45, 6, 6);
    await ctx.spawnPack('zombie-badger', 9, 17, 35, 6, 4);
    await ctx.spawnPack('demon-badger', 4, 12, 16, 3, 7);
    await ctx.spawnPack('rabid-badger', 3, 5, 12, 3, 3);
    await ctx.camAt(17, 13, 1.55);
  },
  timeline: async (f, ctx) => {
    if (f >= 0) await ctx.camAt(lerpKeys([[0, 17], [300, 24]], f, ease.linear), lerpKeys([[0, 13], [300, 16]], f), lerpKeys([[0, 1.55], [300, 1.4]], f));
  },
};
SHOTS.d5_burrow_train.warmup = 60;
{
  const base = SHOTS.d5_burrow_train.timeline;
  SHOTS.d5_burrow_train.timeline = async (f, ctx) => {
    if (f === -40) { await ctx.run({ action: 'train', invulnerable: true }); return base(-39, ctx); }
    return base(f, ctx);
  };
}
