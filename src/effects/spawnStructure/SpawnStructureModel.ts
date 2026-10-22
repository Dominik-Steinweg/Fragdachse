import type { SpawnStructureOutlet } from '../../config/spawnStructure';

/**
 * Replicated read model of one spawn structure (GDD Spawnbauwerk V1). The renderer never decides
 * state; it projects World geometry, base HP/dormancy and the Activity's spawn announcements.
 */
export interface SpawnStructureView {
  readonly id: string;
  /** Brood nest centre: the shared pivot of the carcass and the nest asset. */
  readonly x: number;
  readonly y: number;
  readonly outlet: SpawnStructureOutlet;
  readonly hp: number;
  readonly maxHp: number;
  readonly dormant: boolean;
  readonly destroyed: boolean;
  /** Bound to a running Activity; without one the structure is World scenery. */
  readonly live: boolean;
  /** Changes when HP is re-baselined (Activity bound or reset), so feedback never replays. */
  readonly hpRevision: number;
  /** World centres of the body cells (the hitbox); stable per structure. */
  readonly wallCells: readonly { readonly x: number; readonly y: number }[];
}

export type SpawnStructureBuildingState = 'intact' | 'damaged' | 'rubble';
export type SpawnPitState = 'sealed' | 'active' | 'dry';

/** Below this share of its HP the building shows its damaged frame. */
export const SPAWN_STRUCTURE_DAMAGED_HP_SHARE = 0.5;

export function resolveSpawnStructureBuildingState(view: SpawnStructureView): SpawnStructureBuildingState {
  if (view.destroyed) return 'rubble';
  return view.maxHp > 0 && view.hp / view.maxHp < SPAWN_STRUCTURE_DAMAGED_HP_SHARE ? 'damaged' : 'intact';
}

/** The pit only lives while the structure can release enemies. */
export function resolveSpawnPitState(view: SpawnStructureView): SpawnPitState {
  if (view.destroyed) return 'dry';
  return view.live && !view.dormant ? 'active' : 'sealed';
}

export interface SpawnStructureGlow {
  /** The embers in the eye sockets. */
  readonly core: number;
  readonly pit: number;
  readonly lightRadiusPx: number;
  readonly lightIntensity: number;
}

const NO_GLOW: SpawnStructureGlow = { core: 0, pit: 0, lightRadiusPx: 0, lightIntensity: 0 };

/**
 * Emissive strengths 0..1 before the day/night factor. `charge` is the announced release (0..1):
 * the eyes flare and the pool glows up toward the moment enemies rise.
 */
export function resolveSpawnStructureGlow(view: SpawnStructureView, nowMs: number, charge: number): SpawnStructureGlow {
  if (view.destroyed) return { ...NO_GLOW, core: 0.18 };
  if (resolveSpawnPitState(view) === 'sealed') {
    return { core: 0.22, pit: 0.12, lightRadiusPx: 64, lightIntensity: 0.12 };
  }
  const c = Math.max(0, Math.min(1, charge));
  const breathe = 0.5 + 0.5 * Math.sin(nowMs * (0.0021 + 0.006 * c) + phaseOf(view.id));
  return {
    core: Math.min(1, 0.55 + 0.2 * breathe + 0.25 * c),
    pit: Math.min(1, 0.3 + 0.15 * breathe + 0.55 * c),
    lightRadiusPx: 88 + 46 * c,
    lightIntensity: 0.3 + 0.08 * breathe + 0.42 * c,
  };
}

/** Stable per-structure phase, so neighbouring structures never breathe in lockstep. */
export function phaseOf(id: string): number {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return ((hash >>> 0) % 6283) / 1000;
}

/** A body rising from the pit: claimed when it is created underground, released when it surfaces. */
export interface SpawnEmergence {
  readonly enemyId: string;
  /** Pit-local offset, world px. */
  readonly x: number;
  readonly y: number;
  readonly claimedAt: number;
  surfacedAt: number | null;
}

/** The ooze heaves over the hidden body for this long, then holds until it surfaces. */
export const SPAWN_EMERGENCE_SWELL_MS = 1100;
/** After surfacing the ooze parts, throws its droplets and closes again. */
export const SPAWN_EMERGENCE_PART_MS = 900;

/**
 * Shader phase of one emergence (BroodPitShader): 0..0.74 while the body is still underground,
 * 0.75..1 once it has surfaced; null when the opening has closed again.
 */
export function resolveSpawnEmergencePhase(emergence: SpawnEmergence, nowMs: number): number | null {
  if (emergence.surfacedAt === null) {
    return Math.min(0.74, Math.max(0, nowMs - emergence.claimedAt) / SPAWN_EMERGENCE_SWELL_MS * 0.74);
  }
  const parting = (nowMs - emergence.surfacedAt) / SPAWN_EMERGENCE_PART_MS;
  return parting >= 1 ? null : 0.75 + Math.max(0, parting) * 0.25;
}
