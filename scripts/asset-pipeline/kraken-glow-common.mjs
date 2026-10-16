// Shared by the kraken glow-point runner, boards and publication (scripts/asset-pipeline/kraken_glow_points.py).
export const KRAKEN_GLOW_SOURCE_REVISION = 'kraken-v14';
export const KRAKEN_GLOW_REVISION = /^kraken-v14-glow-\d+$/;
export const KRAKEN_GLOW_ASSETS = [['water', 'abyssal-kraken'], ['land', 'abyssal-kraken-land'], ['tentacle', 'abyssal-kraken-tentacle']];
// Gate GM1: the poses the lead judges before the full run.
export const GM1_SAMPLES = 'water:idle:0,water:egg-throw:middle,water:surface:eyes-open,land:idle:0,land:slam:impact,'
  + 'tentacle:hover:0,tentacle:slam:strike,tentacle:retract:middle';

export function parseSamples(list) {
  return list.split(',').map(s => { const [role, clip, selector] = s.split(':'); return { role, clip, selector }; });
}

/** Clip-local selector: a number, `middle`, or a marker name; returns the master pose index. */
export function masterPose(asset, clip, selector) {
  const c = asset.clips.find(c => c.name === clip);
  if (!c) throw Error(`${asset.id}: no clip ${clip}`);
  const local = selector === 'middle' ? Math.floor(c.frames.length / 2) : /^\d+$/.test(selector) ? Number(selector) : c.markers?.[selector];
  if (!Number.isInteger(local) || c.frames[local] === undefined) throw Error(`${asset.id}: no pose ${clip}:${selector}`);
  return c.frames[local];
}

/** Same decoding as src/effects/kraken/KrakenGlowPoints.ts (10-byte little-endian records). */
export function decodeGlowPoints(bin, first, count, elevation) {
  const out = [];
  for (let i = first; i < first + count; i++) {
    const o = i * 10;
    out.push({ x: bin.readUInt16LE(o) / 65535, y: bin.readUInt16LE(o + 2) / 65535,
      z: elevation.min + bin.readUInt16LE(o + 4) / 65535 * (elevation.max - elevation.min),
      t: bin[o + 6] / 255, vis: bin[o + 7] / 255, radiusPx: bin[o + 8] / 4, arm: bin[o + 9] });
  }
  return out;
}
