import type {
  CoopBaseConfig,
  CoopDefenseMapRockFieldConfig,
  CoopDefenseMapRockWallConfig,
  CoopDefenseMapTrackMode,
  CoopDefenseMapTrackPosition,
} from '../coopDefenseMaps';

/**
 * Authoring-Vertrag einer Welt.
 *
 * Eine `WorldDefinition` beschreibt ausschliesslich, was existiert, wenn niemand spielt:
 * Geometrie, Terrain, statische Strukturen und die Grundstimmung. Sie enthaelt bewusst keine
 * Siegbedingung, keinen Timer, kein Respawn-Budget und keine Gegner – diese gehoeren zur
 * {@link import('./ActivityDefinition').ActivityDefinition} und existieren nur, solange eine
 * Activity laeuft.
 *
 * Die Teilstrukturen bleiben absichtlich die bereits authored Typen aus `coopDefenseMaps.ts`.
 * Dieser Schritt trennt die *Zustaendigkeit*, nicht das Datenformat: Loader, Validatoren und
 * Registries bleiben die einzige Wahrheit fuer den Inhalt der einzelnen Felder.
 */
export interface WorldDefinition {
  /** Stabile World-Identitaet, z. B. `world:coop-defense:7`. */
  readonly id: string;
  /**
   * Map-ID, aus der diese World waehrend der Uebergangsphase adaptiert wurde. Native
   * WorldDefinitions ohne Map-Vorlage lassen das Feld weg.
   */
  readonly sourceMapId?: string;
  readonly metrics: WorldMetricsDefinition;
  readonly terrain: WorldTerrainDefinition;
  /** Statische Strukturen der Welt inklusive ihrer Tuerme und Podeste. */
  readonly bases: readonly CoopBaseConfig[];
  readonly tracks: WorldTrackDefinition;
  /** Gesetzt: Diese World traegt eine persistente Basis an einer authored Stelle. */
  readonly persistentBaseSite?: WorldPersistentBaseSiteDefinition;
  /** Statische Arena-Uhrzeit als `"HH:MM"`. Laufzeitverlaeufe gehoeren zur Activity. */
  readonly initialTimeOfDay: string;
}

export interface WorldMetricsDefinition {
  readonly widthCells: number;
  readonly heightCells: number;
}

export interface WorldTerrainDefinition {
  readonly rockFillRatio?: number;
  readonly treeCount?: number;
  readonly rockField?: CoopDefenseMapRockFieldConfig;
  readonly rockWalls?: readonly CoopDefenseMapRockWallConfig[];
}

export interface WorldTrackDefinition {
  readonly mode: CoopDefenseMapTrackMode;
  readonly position: CoopDefenseMapTrackPosition;
}

/** Verweist auf eine Basis derselben WorldDefinition, die als persistenter Anker dient. */
export interface WorldPersistentBaseSiteDefinition {
  readonly baseId: string;
}

/** Loest den Ankerbau einer persistenten Basis innerhalb ihrer eigenen World auf. */
export function resolveWorldPersistentBaseAnchorBase(world: WorldDefinition): CoopBaseConfig | null {
  const baseId = world.persistentBaseSite?.baseId;
  if (!baseId) return null;
  return world.bases.find((base) => base.id === baseId) ?? null;
}
