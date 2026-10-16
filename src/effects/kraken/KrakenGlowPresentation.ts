import { VOID_FIRE_COLOR, VOID_PALETTE } from '../../config';
import type { GraphicsQuality } from '../../graphics/GraphicsQuality';
import type { KrakenGlowLayer } from './KrakenGlowLayer';
import { KRAKEN_GLOW, krakenSuckerWave, type KrakenEggGlow, type KrakenSuckerDrive } from './KrakenGlowTimeline';
import type { KrakenLightRig } from './KrakenLightRig';
import type { KrakenSpriteView } from './KrakenRenderer';
import { KRAKEN_BROOD } from './submersionShader';

/** Colours and sizes of the boss light. Ember eyes live above the light map; the violet of cups and brood also lights it. */
export const KRAKEN_GLOW_LOOK = {
  eye: { color: 0xff3a1a, auraWidth: 1.9, auraHeight: .95, auraAlpha: .3, lightRadius: 110, lightIntensity: 1.6, lightMax: 4.5 },
  /** Cups: a saturated violet halo around a lighter violet core (a white core read as pale dots, not bioluminescence). */
  sucker: { halo: VOID_FIRE_COLOR, core: VOID_PALETTE.bright, alpha: 1, underwaterFalloff: .6, lowCap: 64 },
  /** One light where the arm leaves the water: it lights the pond around it, not the (pale) arm itself. */
  arm: { color: VOID_PALETTE.bright, radius: 78, rest: .35, peak: 1.5 },
  body: { color: VOID_PALETTE.primary, radius: 150, base: .5, perLevel: 2 },
  /** The brood glows in a sick, deep void violet (horror, not candy): dark pool, violet light, pale only at the peak. */
  egg: { color: VOID_PALETTE.deep, light: VOID_PALETTE.primary, pool: 52, poolAlpha: .22, poolGain: .6, lightRadius: 48, lightBase: .7, lightGain: 2.2 },
  hatch: { color: VOID_PALETTE.bright, pool: 96, poolAlpha: .6, lightRadius: 100, lightIntensity: 4.5 },
  deep: { color: 0xd0261c, pool: 130, poolAlpha: .42, lightRadius: 120, lightIntensity: 2.4 },
  roar: { color: VOID_PALETTE.bright, pool: 380, poolAlpha: .26, lightRadius: 280, lightIntensity: 4 },
} as const;

/** Aura and light of the open eyes of a body view; nothing while the frame has them closed. */
export function paintKrakenEyes(view: KrakenSpriteView, eye: number, glow: KrakenGlowLayer, lights: KrakenLightRig, alpha = 1): void {
  const anchor = view.eyeAnchor(), look = KRAKEN_GLOW_LOOK.eye;
  if (!anchor || eye <= 0 || alpha <= 0) return;
  const span = Math.max(24, anchor.spanPx), heat = Math.min(eye, 2.6) / 2.6;
  glow.pool(anchor.x, anchor.y, span * look.auraWidth, span * look.auraHeight, anchor.rotation, look.color, look.auraAlpha * (.45 + 1.4 * heat) * alpha);
  lights.add(anchor.x, anchor.y, look.lightRadius, Math.min(look.lightMax, look.lightIntensity * eye) * alpha, look.color);
}

/** The visible cups of a view under a drive: violet dots, dimmed and swallowed by the water above them. */
export function paintKrakenSuckers(view: KrakenSpriteView, drive: KrakenSuckerDrive, seconds: number, glow: KrakenGlowLayer,
  quality: GraphicsQuality, strike: boolean, alpha = 1): void {
  if (drive.level <= 0 || alpha <= 0) return;
  // Low keeps only the striking arms' telegraph; medium thins the cups out.
  if (quality === 'low' && (!strike || drive.level < KRAKEN_GLOW.sucker.telegraphFrom)) return;
  const points = view.glowPoints(), look = KRAKEN_GLOW_LOOK.sucker;
  if (!points.length) return;
  const stride = quality === 'low' ? Math.max(1, Math.ceil(points.length / look.lowCap)) : quality === 'medium' ? 2 : 1;
  const level = view.waterLevel, scale = view.canvasScale;
  for (let i = 0; i < points.length; i += stride) {
    const p = points[i]!, depth = level - p.z;
    const water = depth > 0 ? Math.exp(-depth / look.underwaterFalloff) : 1;
    if (water < .05) continue;
    const brightness = krakenSuckerWave(p.t, seconds, drive) * (.35 + .65 * p.vis) * water * alpha;
    const w = view.worldAt(p.x, p.y);
    glow.sucker(w.x, w.y, p.radiusPx * scale, look.halo, look.core, brightness * look.alpha);
  }
}

/** Violet glow in the water where a strike arm emerges, swelling with its cups. */
export function lightKrakenArm(entry: { x: number; y: number }, drive: KrakenSuckerDrive, lights: KrakenLightRig): void {
  const look = KRAKEN_GLOW_LOOK.arm;
  if (drive.level <= 0) return;
  const intensity = look.rest + (look.peak - look.rest) * Math.min(1, drive.level);
  lights.add(entry.x, entry.y, look.radius, intensity * Math.min(1, drive.level / KRAKEN_GLOW.sucker.riseLevel), look.color);
}

/** Ember pool and light under a landed egg, and the flash while it splits. */
export function paintKrakenEgg(x: number, y: number, egg: KrakenEggGlow, glow: KrakenGlowLayer, lights: KrakenLightRig, alpha = 1): void {
  const look = KRAKEN_GLOW_LOOK.egg, hatch = KRAKEN_GLOW_LOOK.hatch;
  const heat = Math.max(0, (egg.glow - KRAKEN_BROOD.glow) / Math.max(.01, KRAKEN_BROOD.hatchGlow - KRAKEN_BROOD.glow));
  glow.pool(x, y, look.pool * (1 + .14 * egg.beat), look.pool * (1 + .14 * egg.beat), 0, look.color,
    (look.poolAlpha + look.poolGain * heat) * (.72 + .28 * egg.beat) * alpha);
  lights.add(x, y, look.lightRadius, (look.lightBase + look.lightGain * heat) * (.8 + .2 * egg.beat) * alpha, look.light);
  if (egg.hatchFlash > 0) {
    glow.pool(x, y, hatch.pool, hatch.pool, 0, hatch.color, hatch.poolAlpha * egg.hatchFlash * alpha);
    lights.add(x, y, hatch.lightRadius, hatch.lightIntensity * egg.hatchFlash * alpha, hatch.color);
  }
}

/** A violet flood of light on a roar (0..1 envelope). */
export function paintKrakenRoar(x: number, y: number, envelope: number, glow: KrakenGlowLayer, lights: KrakenLightRig): void {
  const look = KRAKEN_GLOW_LOOK.roar;
  if (envelope <= .01) return;
  glow.pool(x, y, look.pool, look.pool, 0, look.color, look.poolAlpha * envelope);
  lights.add(x, y, look.lightRadius, look.lightIntensity * envelope, look.color);
}
