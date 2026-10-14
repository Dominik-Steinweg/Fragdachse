import {
  DAWN_BROOD_NEST_ANIMATION, DAWN_BROOD_NEST_KEY,
  DAWN_EXTRACTOR_ACTIVE_ANIMATION, DAWN_EXTRACTOR_IDLE_ANIMATION,
  DAWN_EXTRACTOR_KEY, DAWN_EXTRACTOR_SHEET_KEY, DAWN_HEAP_DISPLAY_SIZE,
} from '../assets/DawnAssets';
import { DAWN_M3_ASSET_KEYS, DAWN_WRECK_VARIANTS } from '../dawn/contracts/DawnContentIds';
import { DAWN_MAX_SITE_TIER } from '../dawn/contracts/DawnPlans';
import type { CoopDefenseSecondaryObjectiveState } from '../types';

export interface DawnSitePropVisual {
  readonly textureKey: string;
  readonly animationKey: string | null;
  /** World pixels; absent = the 3x3 site size. */
  readonly displaySize?: number;
}

export const DAWN_SITE_HIT_FLASH_MS = 100;
/** Sustained damage pulses instead of holding the flash: quiet time after each flash. */
export const DAWN_SITE_HIT_FLASH_COOLDOWN_MS = 260;

/** Local presentation tuning in world pixels; never changes the night's ambient light. */
export const DAWN_SITE_LIGHT = {
  warm: 0xffba70, ember: 0xff9850, cyan: 0x65e4f2,
  extractorIdleRadius: 112, extractorIdleIntensity: 0.42,
  extractorActiveRadius: 156, extractorActiveIntensity: 0.78,
  extractorCompletedRadius: 132, extractorCompletedIntensity: 0.64,
  pulsePeriodMs: 1400, pulseDepth: 0.28,
  // Active extractor: steady warm pool plus an orange beacon cone sweeping the ground.
  extractorBeaconBaseIntensity: 0.5, beacon: 0xff8a2a, beaconRadius: 230, beaconIntensity: 0.95,
  beaconPeriodMs: 1500, beaconGlintSize: 9, beaconGlintAlpha: 0.95, beaconDayFloor: 0.6,
  lampX: 0, lampY: 1, lampSize: 9, lampAlpha: 0.9,
  wreckRadius: 104, wreckIntensity: 0.48, emberX: -8, emberY: 9,
  emberSize: 7, emberAlpha: 0.48,
  techRadius: 52, techIntensity: 0.28, techX: 15, techY: -10,
  techSize: 5, techAlpha: 0.5,
  brood: 0x9be05a, broodIdleRadius: 84, broodIdleIntensity: 0.22, broodActiveRadius: 120, broodActiveIntensity: 0.42,
  supplyRadius: 96, supplyIntensity: 0.34,
} as const;

export const DAWN_SITE_SPARKS = {
  intervalMs: 450, lifespanMinMs: 220, lifespanMaxMs: 480,
  speedMin: 7, speedMax: 20, scaleStart: 0.5, scaleEnd: 0.08,
  spreadPx: 9, maxParticles: 3,
} as const;

export interface DawnSiteLight {
  readonly id: 'warm' | 'tech' | 'beacon';
  /** Cone direction in radians (beacon only); the light and its reflector glint point this way. */
  readonly angle?: number;
  readonly color: number;
  readonly radiusPx: number;
  readonly intensity: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly emissionSize: number;
  readonly emissionAlpha: number;
}

/** Same replicated inputs as the prop; time animates presentation only, without local state. */
export function resolveDawnSiteLights(
  archetypeId: string, tier: number,
  objectiveState: CoopDefenseSecondaryObjectiveState | undefined,
  destroyed: boolean, nowMs: number,
  variant?: string,
): readonly DawnSiteLight[] {
  if (!resolveDawnSitePropVisual(archetypeId, tier, objectiveState, destroyed, variant)) return [];
  const c = DAWN_SITE_LIGHT;
  // Brood nest: a sick green glow that wakes with the nest; the capsule keeps a small lamp; heaps stay unlit.
  if (archetypeId === 'brood-nest') {
    const active = objectiveState === 'active';
    return [{ id: 'warm', color: c.brood, radiusPx: active ? c.broodActiveRadius : c.broodIdleRadius,
      intensity: active ? c.broodActiveIntensity : c.broodIdleIntensity, offsetX: 0, offsetY: 0, emissionSize: 0, emissionAlpha: 0 }];
  }
  if (archetypeId === 'supply') {
    return [{ id: 'warm', color: c.warm, radiusPx: c.supplyRadius, intensity: c.supplyIntensity,
      offsetX: 0, offsetY: 0, emissionSize: c.lampSize, emissionAlpha: objectiveState === 'active' ? c.lampAlpha : 0 }];
  }
  if (archetypeId !== 'wreck' && archetypeId !== 'extractor') return [];
  if (archetypeId === 'extractor') {
    const active = objectiveState === 'active', completed = objectiveState === 'completed';
    const warm: DawnSiteLight = { id: 'warm', color: active ? c.beacon : c.warm,
      radiusPx: active ? c.extractorActiveRadius : completed ? c.extractorCompletedRadius : c.extractorIdleRadius,
      intensity: active ? c.extractorBeaconBaseIntensity : completed ? c.extractorCompletedIntensity : c.extractorIdleIntensity,
      offsetX: c.lampX, offsetY: c.lampY, emissionSize: c.lampSize,
      emissionAlpha: active || completed ? c.lampAlpha : 0 };
    if (!active) return [warm];
    // One revolution per beaconPeriodMs, derived from shared time only (no local animation state).
    const angle = ((nowMs % c.beaconPeriodMs) + c.beaconPeriodMs) % c.beaconPeriodMs / c.beaconPeriodMs * Math.PI * 2;
    return [warm, { id: 'beacon', color: c.beacon, radiusPx: c.beaconRadius, intensity: c.beaconIntensity, angle,
      offsetX: c.lampX, offsetY: c.lampY, emissionSize: c.beaconGlintSize, emissionAlpha: c.beaconGlintAlpha }];
  }
  // Tractor chassis and minecart wreckage meet at the center; drone keeps its authored offsets.
  const centered = variant !== undefined && variant !== 'drone';
  const warm: DawnSiteLight = { id: 'warm', color: c.ember, radiusPx: c.wreckRadius,
    intensity: c.wreckIntensity, offsetX: centered ? 0 : c.emberX, offsetY: centered ? 0 : c.emberY,
    emissionSize: c.emberSize, emissionAlpha: c.emberAlpha };
  return tier === 3 ? [warm, { id: 'tech', color: c.cyan, radiusPx: c.techRadius,
    intensity: c.techIntensity, offsetX: centered ? 0 : c.techX, offsetY: centered ? 0 : c.techY,
    emissionSize: c.techSize, emissionAlpha: c.techAlpha }] : [warm];
}

export interface DawnSitePropHitFlash {
  readonly hp: number | null;
  readonly untilMs: number;
  readonly active: boolean;
}

/** First observation is a baseline; only an observed HP decrease renews the flash. */
export function resolveDawnSitePropHitFlash(
  previous: DawnSitePropHitFlash | undefined,
  hp: number | null,
  nowMs: number,
): DawnSitePropHitFlash {
  if (hp === null) return { hp, untilMs: 0, active: false };
  const damaged = previous?.hp != null && hp < previous.hp;
  const ready = !previous?.untilMs || nowMs >= previous.untilMs + DAWN_SITE_HIT_FLASH_COOLDOWN_MS;
  const untilMs = damaged && ready ? nowMs + DAWN_SITE_HIT_FLASH_MS : previous?.untilMs ?? 0;
  return { hp, untilMs, active: nowMs < untilMs };
}

/** Pure projection of replicated state; absent objective entries are dormant. */
export function resolveDawnSitePropVisual(
  archetypeId: string,
  tier: number,
  objectiveState: CoopDefenseSecondaryObjectiveState | undefined,
  destroyed: boolean,
  variant?: string,
): DawnSitePropVisual | null {
  if (destroyed) return null;
  if (archetypeId === 'wreck') {
    const wreckVariant = DAWN_WRECK_VARIANTS.find(key => key === (variant ?? 'drone'));
    if (objectiveState === 'completed' || !wreckVariant
      || !Number.isInteger(tier) || tier < 1 || tier > DAWN_MAX_SITE_TIER) return null;
    return { textureKey: DAWN_M3_ASSET_KEYS.wreckVariant(wreckVariant, tier), animationKey: null };
  }
  if (archetypeId === 'brood-nest') {
    if (objectiveState === 'completed') return null;
    return objectiveState === 'active'
      ? { textureKey: `${DAWN_BROOD_NEST_KEY}_sheet`, animationKey: DAWN_BROOD_NEST_ANIMATION }
      : { textureKey: DAWN_BROOD_NEST_KEY, animationKey: null };
  }
  // The capsule stays as scenery after its crates are delivered.
  if (archetypeId === 'supply') return { textureKey: DAWN_M3_ASSET_KEYS.supplyCapsule, animationKey: null };
  if (archetypeId === 'scrap-heaps' || archetypeId === 'scavenger') {
    if (objectiveState === 'completed' || !Number.isInteger(tier) || tier < 1 || tier > DAWN_MAX_SITE_TIER) return null;
    return { textureKey: DAWN_M3_ASSET_KEYS.scrapHeap(tier), animationKey: null, displaySize: DAWN_HEAP_DISPLAY_SIZE };
  }
  if (archetypeId !== 'extractor') return null;
  if (objectiveState === 'active' || objectiveState === 'completed') {
    return { textureKey: DAWN_EXTRACTOR_SHEET_KEY, animationKey: objectiveState === 'active'
      ? DAWN_EXTRACTOR_ACTIVE_ANIMATION : DAWN_EXTRACTOR_IDLE_ANIMATION };
  }
  return { textureKey: DAWN_EXTRACTOR_KEY, animationKey: null };
}
