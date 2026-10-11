import type { ReviewClip } from './KrakenReviewAssets';

export const KRAKEN_EFFECT_DEFAULTS = {
  ink: { range: 360, halfAngle: 28, mouthOffset: 74, travel: .22, hold: 1, dissolve: .65,
    charge: .45, spit: .6, opacity: .98, waterSpread: 1.18, coreColor: 0x120a1c, edgeColor: 0x3a2252,
    cloudWarp: 1.3, sheen: .14 },
  approach: { speed: 72, turnRate: 45, shoreDistance: 48, bodyRadius: 96, targetX: 39, targetY: 36 },
  erupt: { radius: 66, rise: .15, bulgeDuration: .15, retract: 2.5, lifetime: 1.25, retractScale: .55, count: 3, spacing: 128,
    sprayCount: 72, spraySpeed: 150, foamOpacity: .75 },
  slam: { impact: .6, dustLifetime: .85, decalLifetime: 2, shakeScale: .45, whipDelay: .18, curveBend: 12, contactWidth: 42 },
  intro: { lead: .6, armsBreak: .875, keelBreak: 1.45, eyesOpen: 2.0625, roar: 2.5, radius: 112,
    lifetime: 1.65, foamOpacity: .72, sprayCount: 80, spraySpeed: 135, drain: .85, shakeScale: .35 },
  surface: { lead: .2, armsBreak: .25, keelBreak: .55, eyesOpen: .9, radius: 96,
    lifetime: 1.1, foamOpacity: .62, sprayCount: 56, spraySpeed: 105, drain: .65 },
  dive: { submerged: .95, radius: 110, lifetime: 1.5, foamOpacity: .65, shadowOpacity: .12 },
  eggFlight: { release: .65, count: 6, flight: .95, arcScale: .65, launchRadius: 108,
    landInset: 48, incubation: 3.5, pulse: .16, slimeRadius: 24, residue: 1.6 },
};
export type KrakenEffect = 'none' | 'approach' | 'ink' | 'erupt' | 'slam' | 'intro' | 'dive' | 'surface' | 'egg-throw';
export type KrakenEffectLook = typeof KRAKEN_EFFECT_DEFAULTS;
export interface KrakenEffectOptions extends KrakenEffectLook {
  effect: KrakenEffect;
  effectTime: number;
  playback: 'manual' | 'play';
  /** World grid coordinates, or [] for radial land searches. */
  eggTargets: { x: number; y: number }[];
  /** Normalized body-space arm tips; [] uses the named radial launch fallback. */
  eggLaunches: { x: number; y: number }[];
}
export const effectDefaults: KrakenEffectOptions = { ...KRAKEN_EFFECT_DEFAULTS, effect: 'none', effectTime: 0, playback: 'manual', eggTargets: [], eggLaunches: [] };

/** Merge only known, finite tuning fields at the command boundary. */
export function effectOptions(raw: Record<string, unknown>, previous: KrakenEffectOptions): KrakenEffectOptions {
  const next: KrakenEffectOptions = { effect: previous.effect, effectTime: previous.effectTime, playback: previous.playback,
    ink: previous.ink, approach: previous.approach, erupt: previous.erupt, slam: previous.slam,
    intro: previous.intro, surface: previous.surface, dive: previous.dive, eggFlight: previous.eggFlight,
    eggTargets: previous.eggTargets, eggLaunches: previous.eggLaunches };
  for (const key of ['effect', 'effectTime', 'playback'] as const) if (raw[key] !== undefined) Object.assign(next, { [key]: raw[key] });
  for (const kind of ['ink', 'approach', 'erupt', 'slam', 'intro', 'surface', 'dive', 'eggFlight'] as const) {
    const patch = raw[kind];
    if (patch === undefined) continue;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Error(`${kind}: parameter object required`);
    const values = { ...previous[kind] };
    for (const [key, value] of Object.entries(patch)) {
      const color = key.endsWith('Color');
      if (!Object.prototype.hasOwnProperty.call(KRAKEN_EFFECT_DEFAULTS[kind], key) || typeof value !== 'number' || !Number.isFinite(value) || value < 0
        || value > (color ? 0xffffff : 2000) || (color && !Number.isInteger(value))) throw Error(`Invalid ${kind}.${key}`);
      Object.assign(values, { [key]: value });
    }
    Object.assign(next, { [kind]: values });
  }
  for (const key of ['eggTargets', 'eggLaunches'] as const) if (raw[key] !== undefined) {
    const points = raw[key];
    if (!Array.isArray(points) || points.length > 8 || points.some(p => !p || typeof p !== 'object'
      || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0
      || p.x > (key === 'eggLaunches' ? 1 : 2000) || p.y > (key === 'eggLaunches' ? 1 : 2000))) throw Error(`Invalid ${key}`);
    next[key] = points.map(p => ({ x: p.x, y: p.y }));
  }
  if (!['none', 'approach', 'ink', 'erupt', 'slam', 'intro', 'dive', 'surface', 'egg-throw'].includes(next.effect)) throw Error('Invalid effect');
  if (!['manual', 'play'].includes(next.playback)) throw Error('playback: manual/play');
  if (!Number.isFinite(next.effectTime) || next.effectTime < 0 || next.effectTime > 120) throw Error('effectTime: seconds 0..120');
  if (next.approach.speed <= 0 || next.approach.turnRate <= 0 || next.approach.turnRate > 360 || next.approach.bodyRadius <= 0) throw Error('Invalid approach movement');
  if (next.ink.range < 1 || next.ink.halfAngle < 1 || next.ink.halfAngle > 70 || next.ink.travel <= 0 || next.ink.travel > .25
    || next.ink.dissolve <= 0 || next.ink.opacity > 1 || next.ink.waterSpread < 1 || next.ink.waterSpread > 1.5
    || next.ink.charge >= next.ink.spit || next.ink.cloudWarp > 3 || next.ink.sheen > 1) throw Error('Invalid ink dimensions/timing');
  if (!Number.isInteger(next.erupt.count) || next.erupt.count < 1 || next.erupt.count > 3 || next.erupt.radius < 1
    || next.erupt.lifetime <= 0 || next.erupt.retractScale > 1 || next.erupt.retract <= next.erupt.rise
    || next.erupt.bulgeDuration <= 0 || next.erupt.bulgeDuration > next.erupt.rise || next.erupt.foamOpacity > 1
    || !Number.isInteger(next.erupt.sprayCount) || next.erupt.sprayCount > 96 || next.erupt.spraySpeed > 240) throw Error('Invalid erupt dimensions/timing');
  if (next.slam.dustLifetime <= 0 || next.slam.decalLifetime <= 0 || next.slam.shakeScale > 1
    || next.slam.whipDelay >= next.slam.dustLifetime || next.slam.curveBend > 80 || next.slam.contactWidth < 1) throw Error('Invalid slam timing/feedback');
  for (const rise of [next.intro, next.surface]) if (rise.radius < 1 || rise.lifetime <= 0 || rise.drain <= 0
    || rise.foamOpacity > 1 || !Number.isInteger(rise.sprayCount) || rise.sprayCount > 96 || rise.spraySpeed > 240
    || rise.keelBreak < rise.armsBreak || rise.eyesOpen < rise.armsBreak) throw Error('Invalid rise timing/look');
  if (next.intro.shakeScale > 1 || next.intro.roar < next.intro.eyesOpen || next.dive.radius < 1
    || next.dive.lifetime <= 0 || next.dive.foamOpacity > 1 || next.dive.shadowOpacity > 1) throw Error('Invalid dive/intro look');
  const egg = next.eggFlight;
  if (!Number.isInteger(egg.count) || egg.count < 1 || egg.count > 8 || egg.flight <= 0 || egg.incubation <= 0
    || egg.arcScale > 2 || egg.pulse > .5 || egg.slimeRadius < 1 || egg.residue <= 0
    || [next.eggTargets, next.eggLaunches].some(points => points.length !== 0 && points.length !== egg.count)) throw Error('Invalid egg flight/points');
  return next;
}

export function effectMarker(clip: ReviewClip | undefined, names: string[], fallback: number) {
  for (const name of names) {
    const frame = clip?.markers?.[name];
    if (frame !== undefined) return { seconds: frame / clip!.frameRate, source: `${clip!.name}:${name}` };
  }
  return { seconds: fallback, source: 'fallback' };
}

export function effectTiming(o: KrakenEffectOptions, body?: ReviewClip, tentacle?: ReviewClip, sequence?: ReviewClip[], fullSequence = false) {
  const charge = effectMarker(body, ['charge'], o.ink.charge);
  const spit = effectMarker(body, ['spit'], o.ink.spit);
  const impact = effectMarker(tentacle, ['impact', 'strike'], o.slam.impact);
  const duration = (name: string) => { const c = sequence?.find(c => c.name === name); return c ? c.frames.length / c.frameRate : null; };
  const rise = duration('rise'), hover = duration('hover'), slam = duration('slam');
  const retract = rise !== null && hover !== null && slam !== null
    ? { seconds: rise + hover + slam, source: 'rise → hover → slam' } : { seconds: o.erupt.retract, source: 'fallback' };
  return { charge, spit, impact: fullSequence && rise !== null && hover !== null
    ? { seconds: rise + hover + impact.seconds, source: `rise ? hover ? ${impact.source}` } : impact, retract };
}

/** Seeking and playing use exactly the same clip-local frame, without wraparound. */
export function effectPose(clips: ReviewClip[], selected: string, seconds: number, sequence = false) {
  let remaining = seconds;
  const names = sequence ? ['rise', 'hover', 'slam', 'retract'] : [selected];
  for (let i = 0; i < names.length; i++) {
    const clip = clips.find(c => c.name === names[i]);
    if (!clip) return null;
    const duration = clip.frames.length / clip.frameRate;
    if (remaining < duration || i === names.length - 1) return { clip: clip.name, frame: Math.min(clip.frames.length - 1, Math.floor(remaining * clip.frameRate)) };
    remaining -= duration;
  }
  return null;
}
