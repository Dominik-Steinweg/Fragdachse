import type { ReviewClip } from './KrakenReviewAssets';
import { effectMarker, type KrakenEffectOptions } from './KrakenReviewEffectTimeline';

export type ReviewPoint = { x: number; y: number };
export const isBodyEffect = (effect: string) => ['intro', 'surface', 'dive', 'egg-throw'].includes(effect);
export const bodyEffectClip = (effect: string) => effect === 'intro' ? 'intro-rise' : effect;

/** Clip markers remain clip-local; anticipation is an explicit offset, never a changed frame rate. */
export function bodyEffectTiming(o: KrakenEffectOptions, clips: ReviewClip[]) {
  const clip = clips.find(c => c.name === bodyEffectClip(o.effect));
  const rise = o.effect === 'surface' ? o.surface : o.intro;
  const lead = o.effect === 'intro' || o.effect === 'surface' ? rise.lead : 0;
  const marker = (names: string[], fallback: number) => {
    const value = effectMarker(clip, names, fallback);
    return { ...value, seconds: value.seconds + lead };
  };
  return { lead, armsBreak: marker(['arms-break'], rise.armsBreak), keelBreak: marker(['keel-break'], rise.keelBreak),
    eyesOpen: marker(['eyes-open'], rise.eyesOpen), roar: marker(['roar'], o.intro.roar),
    submerged: marker(['submerged'], o.dive.submerged), release: marker(['release'], o.eggFlight.release),
    duration: lead + (clip ? clip.frames.length / clip.frameRate : 0) };
}

export function sampleReviewEgg(time: number, release: number, from: ReviewPoint, target: ReviewPoint,
  look: KrakenEffectOptions['eggFlight'], hatch: ReviewClip, idle: ReviewClip) {
  const age = time - release, landingAt = release + look.flight, hatchAt = landingAt + look.incubation;
  const flight = time >= landingAt ? 1 : Math.max(0, age / look.flight);
  const landingAge = time - landingAt, hatchAge = time - hatchAt;
  const height = Math.sin(flight * Math.PI);
  const incubation = Math.max(0, Math.min(1, landingAge / look.incubation));
  const pulse = landingAge >= 0 && hatchAge < 0
    ? Math.sin(landingAge * (5 + incubation * 7)) * look.pulse * incubation : 0;
  const hatching = hatchAge >= 0;
  const clip = hatching ? hatch : idle;
  const frame = hatching ? Math.min(clip.frames.length - 1, Math.floor(hatchAge * clip.frameRate))
    : Math.floor(Math.max(0, age) * clip.frameRate) % clip.frames.length;
  const hatchDuration = hatch.frames.length / hatch.frameRate;
  return { x: from.x + (target.x - from.x) * flight, y: from.y + (target.y - from.y) * flight,
    visible: age >= 0 && hatchAge < hatchDuration + look.residue, clip: clip.name, frame,
    scale: 1 + height * look.arcScale + pulse, height, landingAge, hatchAge,
    alpha: 1 - Math.max(0, Math.min(1, (hatchAge - hatchDuration) / look.residue)) };
}

/** A straight radial flight must finish on land. Explicit points are validated by the same water model. */
export function reviewEggTargets(center: ReviewPoint, angle: number, count: number, inset: number,
  waterAt: (x: number, y: number) => number): ReviewPoint[] {
  return Array.from({ length: count }, (_, i) => {
    const a = angle + i / count * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    for (let radius = 32; radius <= 1600; radius += 4) {
      const p = { x: center.x + c * (radius + inset), y: center.y + s * (radius + inset) };
      if (waterAt(center.x + c * radius, center.y + s * radius) <= 0 && waterAt(p.x, p.y) <= 0) return p;
    }
    throw Error('No radial egg land target within review bounds');
  });
}
