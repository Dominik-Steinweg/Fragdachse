import {
  DAWN_EXTRACTOR_ACTIVE_ANIMATION, DAWN_EXTRACTOR_IDLE_ANIMATION,
  DAWN_EXTRACTOR_KEY, DAWN_EXTRACTOR_SHEET_KEY, DAWN_WRECK_KEYS,
} from '../assets/DawnAssets';
import type { CoopDefenseSecondaryObjectiveState } from '../types';

export interface DawnSitePropVisual {
  readonly textureKey: string;
  readonly animationKey: string | null;
}

export const DAWN_SITE_HIT_FLASH_MS = 100;

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
  const untilMs = damaged ? nowMs + DAWN_SITE_HIT_FLASH_MS : previous?.untilMs ?? 0;
  return { hp, untilMs, active: nowMs < untilMs };
}

/** Pure projection of replicated state; absent objective entries are dormant. */
export function resolveDawnSitePropVisual(
  archetypeId: string,
  tier: number,
  objectiveState: CoopDefenseSecondaryObjectiveState | undefined,
  destroyed: boolean,
): DawnSitePropVisual | null {
  if (destroyed) return null;
  if (archetypeId === 'wreck') {
    const textureKey = DAWN_WRECK_KEYS[tier];
    return objectiveState === 'completed' || !textureKey ? null : { textureKey, animationKey: null };
  }
  if (archetypeId !== 'extractor') return null;
  if (objectiveState === 'active' || objectiveState === 'completed') {
    return { textureKey: DAWN_EXTRACTOR_SHEET_KEY, animationKey: objectiveState === 'active'
      ? DAWN_EXTRACTOR_ACTIVE_ANIMATION : DAWN_EXTRACTOR_IDLE_ANIMATION };
  }
  return { textureKey: DAWN_EXTRACTOR_KEY, animationKey: null };
}
