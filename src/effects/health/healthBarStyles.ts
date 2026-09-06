import { COLORS, DEPTH, HP_BAR_HEIGHT, HP_BAR_WIDTH, COOP_DEFENSE_BASE_HP_BAR_HEIGHT } from '../../config';
import type { HealthBarFeedbackTuning, HealthBarVisibility } from './HealthBarFeedbackModel';

/** Initial visual tuning, deliberately independent of gameplay and network cadence. */
export const HEALTH_BAR_TUNING: HealthBarFeedbackTuning = {
  damageHoldMs: 50, // Reading pause, once per damage episode.
  damageHalfLifeMs: 70, // Smaller values close the trail faster.
  newEpisodeQuietMs: 150, // Quiet gap required before another hold is allowed.
  visibleAfterDamageMs: 3000, // Temporary enemy display window.
  settleDistancePx: 0.25, // Visible screen pixels, not world units.
  healEmphasisMs: 160, // Single refreshed emphasis; never a pulse queue.
  healEmphasisStrength: 0.25,
};
export const HEALTH_BAR_POOL = { prewarmEnemyViews: 50, maxFreeViews: 100 };
export const HEALTH_BAR_TRAIL = { color: 0xfff1d6, alpha: 0.9 };
export type HealthBarFamily = 'enemyStatus' | 'playerStatus' | 'baseMarkers' | 'rockTools';
export interface HealthBarStyle {
  readonly family: HealthBarFamily;
  readonly visibility: HealthBarVisibility;
  readonly width: number;
  readonly height: number;
  readonly backgroundDepth: number;
  readonly fillDepth: number;
  readonly healthy: number;
  readonly hurt: number;
  readonly critical: number;
  readonly stroke?: number;
}
const friendly = { healthy: 0x00cc44, hurt: 0xffcc00, critical: 0xff3300 };
const hostile = { healthy: COLORS.RED_2, hurt: COLORS.RED_3, critical: COLORS.RED_4 };
export function enemyHealthBarStyle(boss: boolean, width: number): HealthBarStyle {
  return { family: 'enemyStatus', visibility: boss ? 'alive' : 'after-damage', width,
    height: HP_BAR_HEIGHT, backgroundDepth: DEPTH.SMOKE + 0.5, fillDepth: DEPTH.SMOKE + 0.6, ...hostile };
}
export function playerHealthBarStyle(enemy: boolean): HealthBarStyle {
  return { family: 'playerStatus', visibility: 'alive', width: HP_BAR_WIDTH,
    height: HP_BAR_HEIGHT, backgroundDepth: DEPTH.PLAYERS + 1, fillDepth: DEPTH.PLAYERS + 2,
    ...(enemy ? hostile : friendly) };
}
export function baseHealthBarStyle(width: number, color: number): HealthBarStyle {
  return { family: 'baseMarkers', visibility: 'alive', width, height: COOP_DEFENSE_BASE_HP_BAR_HEIGHT,
    backgroundDepth: DEPTH.BASES + 1, fillDepth: DEPTH.BASES + 2,
    healthy: color, hurt: color, critical: color, stroke: COLORS.GREY_6 };
}
export const TURRET_HEALTH_BAR_STYLE: HealthBarStyle = {
  family: 'rockTools', visibility: 'damaged', width: 24, height: 4,
  backgroundDepth: DEPTH.ROCKS + 0.35, fillDepth: DEPTH.ROCKS + 0.4, ...friendly,
};
