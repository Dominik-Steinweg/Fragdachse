import type { CoopDefenseEncounterPresentationState, SpawnFront } from '../types';
import { DEFAULT_SPAWN_FRONT } from '../utils/spawnFront';
import {
  compass8,
  compassOfSpawnFront,
  type CompassDirection8,
  type SpawnZoneRect,
} from '../utils/spawnDirection';
import type { EncounterTelegraphIncoming } from '../effects/CoopDefenseEncounterTelegraphRenderer';

/**
 * Spawnzonen eines Encounters als Welt-Rechtecke, analog zu `encounterFronts` und `fronts`.
 * Die Zuordnung replizierter Zonen-IDs zu Rechtecken liefert die World; diese Projektion bewertet
 * nur Richtung und Darstellung.
 */
export interface EncounterSpawnZoneRects {
  /** Alle Zonen des Encounters, unabhängig von Gruppenverzögerungen (HUD-Richtung). */
  readonly encounter: readonly SpawnZoneRect[];
  /** Zonen, die gerade anrollen oder für die Randwarnung noch relevant sind. */
  readonly live: readonly SpawnZoneRect[];
}

const FALLBACK_FRONTS: readonly SpawnFront[] = [DEFAULT_SPAWN_FRONT];

/** The World's spawn zones in arena cells and the world point of cell (0, 0). */
export interface WorldSpawnZoneFrame {
  readonly zones: readonly { readonly id: string; readonly gridX: number; readonly gridY: number;
    readonly widthCells: number; readonly heightCells: number }[];
  readonly offsetX: number;
  readonly offsetY: number;
  readonly cellSize: number;
}

/**
 * Welt-Rechtecke der replizierten Zonen-IDs eines Encounters. Unbekannte IDs fallen weg; ohne
 * Zonen im Zustand gibt es kein Ergebnis, die Randwarnung bleibt dann bei Fronten.
 */
export function resolveEncounterSpawnZoneRects(
  state: CoopDefenseEncounterPresentationState,
  world: WorldSpawnZoneFrame | null,
): EncounterSpawnZoneRects | null {
  if (!world || !state.encounterZones?.length) return null;
  const byId = new Map(world.zones.map((zone) => [zone.id, zone]));
  const rects = (ids: readonly string[] | undefined): SpawnZoneRect[] => (ids ?? []).flatMap((id) => {
    const zone = byId.get(id);
    return zone ? [{ id, x: world.offsetX + zone.gridX * world.cellSize, y: world.offsetY + zone.gridY * world.cellSize,
      width: zone.widthCells * world.cellSize, height: zone.heightCells * world.cellSize }] : [];
  });
  return { encounter: rects(state.encounterZones), live: rects(state.zones) };
}

/**
 * Eingang der Randwarnung. Fronten bleiben ganze Seiten (Dawn, Rückfall), Zonen werden zu
 * Richtungsabschnitten. Ohne beides gilt der bisherige West-Rückfall.
 */
export function resolveEncounterTelegraphIncoming(
  state: CoopDefenseEncounterPresentationState | null,
  zones: EncounterSpawnZoneRects | null,
): EncounterTelegraphIncoming {
  const fronts = state?.fronts ?? [];
  const live = zones?.live ?? [];
  return fronts.length === 0 && live.length === 0
    ? { fronts: FALLBACK_FRONTS, zones: [] }
    : { fronts, zones: live };
}

/**
 * Achtel-Kompassrichtungen für den HUD-Text, in authored Reihenfolge und ohne Dopplungen.
 * Fronten benennen ihre Seite; Zonen die Richtung vom Bezugspunkt (Mitte des sichtbaren
 * Bereichs) zur Zonenmitte. Eine Zone um den Bezugspunkt herum hat keine Richtung: Bleibt so
 * keine Richtung übrig, ist der Angriff in der Nähe und die Liste leer.
 */
export function resolveEncounterDirections(
  state: CoopDefenseEncounterPresentationState,
  zones: EncounterSpawnZoneRects | null,
  viewCentre: { readonly x: number; readonly y: number } | null,
): readonly CompassDirection8[] {
  const fronts = state.encounterFronts ?? [];
  const encounterZones = zones?.encounter ?? [];
  if (fronts.length === 0 && encounterZones.length === 0) return FALLBACK_FRONTS.map(compassOfSpawnFront);
  const directions: CompassDirection8[] = [];
  const add = (direction: CompassDirection8 | null): void => {
    if (direction !== null && !directions.includes(direction)) directions.push(direction);
  };
  for (const front of fronts) add(compassOfSpawnFront(front));
  if (viewCentre === null) return directions;
  for (const zone of encounterZones) {
    if (viewCentre.x >= zone.x && viewCentre.x <= zone.x + zone.width
      && viewCentre.y >= zone.y && viewCentre.y <= zone.y + zone.height) continue;
    add(compass8(zone.x + zone.width / 2 - viewCentre.x, zone.y + zone.height / 2 - viewCentre.y));
  }
  return directions;
}
