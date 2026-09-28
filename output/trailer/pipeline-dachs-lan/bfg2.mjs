import { lerpKeys } from './harness.mjs';
import { SHOTS } from './shots2.mjs';

// BFG v2: 3.5 s of quiet build-up before the charge, so the release lands on the voice-over.
const D = 210;
const base = SHOTS.d7_bfg;
SHOTS.d7_bfg2 = {
  ...base, frames: 560 + D,
  speed: f => f < 255 + D ? 1 : f < 440 + D ? 0.4 : 1,
  timeline: async (f, ctx) => {
    if (f === 20 + D) await ctx.bot(0, { temporaryUtility: 'BFG' });
    if (f === 24 + D) await ctx.run({ action: 'train' });
    if (f < 0) return;
    const g = f - D;
    const gx = lerpKeys([[-D, 14.2], [0, 13.2], [74, 13.5], [150, 21], [250, 31], [320, 33], [560, 33]], g);
    const gy = lerpKeys([[-D, 17.4], [0, 17.6], [74, 17.5], [150, 14.5], [250, 11.5], [320, 12], [560, 13]], g);
    const z = lerpKeys([[-D, 2.3], [0, 2.8], [74, 2.6], [180, 1.9], [250, 1.6], [320, 1.25], [560, 1.2]], g);
    await ctx.camAt(Math.max(30 / z + 0.2, gx), gy, z);
  },
};
