import type { CoopDefenseMapConfig } from '../config/coopDefenseMaps';
import {
  DEFAULT_PERSISTENT_BASE_ORIENTATION,
  type PersistentBaseBuildArea,
  type PersistentBaseOrientation,
} from './PersistentBaseCore';
import type { PersistentBaseAnchor } from './PersistentBaseTypes';
import type { GroundSurfacePersistentBaseGravelZone } from '../arena/chunks/GroundSurfaceStreamer';
import type { WorldPersistentBaseSite } from '../world/WorldRuntimeContext';
import { resolveCoopDefenseMapPersistentBasePreview } from '../config/coopDefenseMaps';

/** Gemeinsame, rein visuelle Projektion einer kanonischen Persistent Base. */
export interface PersistentBaseVisualSite {
  readonly anchor: PersistentBaseAnchor;
  readonly orientation: PersistentBaseOrientation;
  readonly buildArea: PersistentBaseBuildArea;
  /** Optional authored World seed; callers may provide a frame seed as fallback. */
  readonly layoutSeed?: number;
}

/** Erzeugt aus der visuellen Projektion den vorhandenen Ground-Streamer-Vertrag. */
export function toPersistentBaseGravelZone(
  site: PersistentBaseVisualSite,
  seed: number,
): GroundSurfacePersistentBaseGravelZone {
  return {
    seed: site.layoutSeed ?? seed,
    anchor: site.anchor,
    buildArea: site.buildArea,
  };
}

/**
 * Löst die Darstellung der aktiven World-Basis oder – falls diese fehlt – der Activity-Vorschau
 * auf. Die Priorität der echten World-Stelle verhindert, dass eine Vorschau eine aktive Basis
 * doppelt zeichnet.
 */
export function resolvePersistentBaseVisualSite(
  mapConfig: CoopDefenseMapConfig | null,
  worldSite: WorldPersistentBaseSite | null,
  layoutSeed?: number,
): PersistentBaseVisualSite | null {
  if (worldSite) {
    const site = {
      anchor: worldSite.anchor,
      orientation: mapConfig?.persistentBase?.orientation ?? DEFAULT_PERSISTENT_BASE_ORIENTATION,
      buildArea: worldSite.buildArea,
    } satisfies PersistentBaseVisualSite;
    return layoutSeed === undefined ? site : { ...site, layoutSeed };
  }

  const preview = mapConfig ? resolveCoopDefenseMapPersistentBasePreview(mapConfig) : undefined;
  if (!preview) return null;
  const site = {
    anchor: preview.anchor,
    orientation: preview.orientation,
    buildArea: preview.buildArea,
  } satisfies PersistentBaseVisualSite;
  return layoutSeed === undefined ? site : { ...site, layoutSeed };
}
