import type { SpawnStructureOutlet } from '../../config/spawnStructure';

/**
 * Replicated read model of one spawn structure (GDD Spawnbauwerk V1). The renderer never decides
 * state; it projects World geometry, base HP/dormancy and the Activity's spawn announcements.
 */
export interface SpawnStructureView {
  readonly id: string;
  /** Brood pit centre: the shared pivot of the building and the pit asset. */
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
  /** World centres of the eight wall cells (the hitbox); stable per structure. */
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
  readonly veins: number;
  readonly core: number;
  readonly pit: number;
  readonly lightRadiusPx: number;
  readonly lightIntensity: number;
}

const NO_GLOW: SpawnStructureGlow = { veins: 0, core: 0, pit: 0, lightRadiusPx: 0, lightIntensity: 0 };

/**
 * Emissive strengths 0..1 before the day/night factor. `charge` is the announced release (0..1):
 * the veins and heart build up and the pit swells toward the moment enemies rise.
 */
export function resolveSpawnStructureGlow(view: SpawnStructureView, nowMs: number, charge: number): SpawnStructureGlow {
  if (view.destroyed) return { ...NO_GLOW, core: 0.18 };
  if (resolveSpawnPitState(view) === 'sealed') {
    return { veins: 0.1, core: 0.22, pit: 0.12, lightRadiusPx: 64, lightIntensity: 0.12 };
  }
  const c = Math.max(0, Math.min(1, charge));
  const breathe = 0.5 + 0.5 * Math.sin(nowMs * (0.0021 + 0.006 * c) + phaseOf(view.id));
  return {
    veins: Math.min(1, 0.38 + 0.18 * breathe + 0.44 * c),
    core: Math.min(1, 0.55 + 0.2 * breathe + 0.25 * c),
    pit: Math.min(1, 0.3 + 0.15 * breathe + 0.55 * c),
    lightRadiusPx: 88 + 46 * c,
    lightIntensity: 0.3 + 0.08 * breathe + 0.42 * c,
  };
}

/** Stable per-structure phase, so neighbouring structures never breathe in lockstep. */
function phaseOf(id: string): number {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return ((hash >>> 0) % 6283) / 1000;
}
