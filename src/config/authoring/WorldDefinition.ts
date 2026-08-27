import type {
  CoopBaseAnchor,
  CoopBaseCellOffset,
  CoopBaseFaction,
  CoopBaseRole,
  CoopBaseShape,
  CoopBaseTurretConfig,
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
  /** Statische Strukturen der Welt. Ihre missionsabhaengigen Anteile liegen in der Activity. */
  readonly bases: readonly WorldBaseDefinition[];
  /** Gleisverlauf dieser Welt. Worlds ohne Gleise lassen das Feld weg. */
  readonly tracks?: WorldTrackDefinition;
  /** World-scoped action policy; it remains valid even when no Activity is running. */
  readonly actionPolicy?: WorldActionPolicy;
  /** World-scoped presentation policy; sie gilt ebenfalls ohne laufende Activity. */
  readonly presentationPolicy?: WorldPresentationPolicy;
  /** Gesetzt: Diese World traegt eine persistente Basis an einer authored Stelle. */
  readonly persistentBaseSite?: WorldPersistentBaseSiteDefinition;
  /** Statische Arena-Uhrzeit als `"HH:MM"`. Laufzeitverlaeufe gehoeren zur Activity. */
  readonly initialTimeOfDay: string;
}

export interface WorldActionPolicy {
  /** Allows combat in this World without requiring an Activity. */
  readonly combat: boolean;
}

/**
 * Ob diese World auch ohne Teilnahme lokal dargestellt werden darf.
 *
 * Der Regelfall bleibt: keine Teilnahme, keine Darstellung – ein Host, der eine Shared World
 * nur simuliert, baut keine Darstellungsflaeche auf. Eine World kann das aber ausdruecklich
 * erlauben; die LobbyWorld ist genau dieser Fall. Sie entsteht als Preview: sichtbar, aber ohne
 * Spielfigur, ohne Weltkamera und ohne World-Input.
 */
export interface WorldPresentationPolicy {
  readonly previewWithoutParticipation: boolean;
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

/**
 * Eine Struktur der Welt: Lage, Form, Fraktion, Rolle, Grunddauerhaftigkeit und fest verbaute
 * Tuerme. All das steht auch dann in der Welt, wenn keine Mission laeuft.
 *
 * Ausdruecklich nicht hier: der angeschlagene Startzustand einer Runde, die Skalierung nach
 * Spielerzahl, der Dormant-Zustand eines Missionsziels und die Power-up-Podeste mit ihren
 * Respawn-Regeln. Das sind Eigenschaften eines Durchlaufs, nicht des Bauwerks – sie liegen in
 * {@link import('./ActivityDefinition').CoopMissionBaseOverlay}.
 *
 * Dass ein Turm *schiesst*, ist Activity-Verhalten; dass er montiert ist, ist Weltgeometrie.
 * Deshalb bleibt {@link WorldBaseDefinition.turrets} hier.
 */
export interface WorldBaseDefinition {
  readonly id: string;
  /** Grunddauerhaftigkeit der Struktur; die Skalierung nach Spielerzahl gehoert zur Activity. */
  readonly hpMax: number;
  readonly faction?: CoopBaseFaction;
  readonly role?: CoopBaseRole;
  readonly anchor: CoopBaseAnchor;
  readonly shape: CoopBaseShape;
  readonly turrets?: readonly CoopBaseTurretConfig[];
  /** Freie Zelle innerhalb der Shape, an der die strukturgebundene Quelle erscheint. */
  readonly spawnCenter?: CoopBaseCellOffset;
}

/** Verweist auf eine Basis derselben WorldDefinition, die als persistenter Anker dient. */
export interface WorldPersistentBaseSiteDefinition {
  readonly baseId: string;
}

/** Loest den Ankerbau einer persistenten Basis innerhalb ihrer eigenen World auf. */
export function resolveWorldPersistentBaseAnchorBase(world: WorldDefinition): WorldBaseDefinition | null {
  const baseId = world.persistentBaseSite?.baseId;
  if (!baseId) return null;
  return world.bases.find((base) => base.id === baseId) ?? null;
}
