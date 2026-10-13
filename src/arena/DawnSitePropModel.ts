import {
  DAWN_EXTRACTOR_ACTIVE_ANIMATION, DAWN_EXTRACTOR_IDLE_ANIMATION,
  DAWN_EXTRACTOR_KEY, DAWN_EXTRACTOR_SHEET_KEY, DAWN_WRECK_KEYS,
} from '../assets/DawnAssets';
import type { CoopDefenseSecondaryObjectiveState } from '../types';

export interface DawnSitePropVisual {
  readonly textureKey: string;
  readonly animationKey: string | null;
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
