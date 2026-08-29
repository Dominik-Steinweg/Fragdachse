import type { ArenaGridRegion } from '../../config';
import type {
  CoopBaseAnchor,
  CoopBaseCellOffset,
  CoopBaseFaction,
  CoopBaseRole,
  CoopBaseShape,
  CoopBaseTurretConfig,
  CoopDefenseMapPersistentBaseConfig,
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
  /** World-scoped participation policy; sie gilt ebenfalls ohne laufende Activity. */
  readonly participationPolicy?: WorldParticipationPolicy;
  /**
   * Zellbereiche, die diese World nicht als Startpunkt zulaesst.
   *
   * Sie sind begehbar – nur kein Spawn. Die LobbyWorld sperrt so die Flaechen ihrer
   * Seitenmenues; eine Figur dort waere dauerhaft verdeckt.
   */
  readonly spawnExclusionZones?: readonly ArenaGridRegion[];
  /**
   * Zelle, in deren Naehe diese World ihre Spieler bevorzugt starten laesst.
   *
   * Eine Praeferenz, keine Zusicherung: ist dort nichts frei oder sicher, faellt die
   * Spawn-Bewertung auf die volle World zurueck. Ein Missionsfokus der laufenden Activity
   * (Startbereich, Respawn-Checkpoint) hat Vorrang vor diesem World-Wert.
   */
  readonly spawnFocusCell?: WorldSpawnFocusCell;
  /** Gesetzt: Diese World traegt eine persistente Basis an einer authored Stelle. */
  readonly persistentBaseSite?: WorldPersistentBaseSiteDefinition;
  /** Statische Arena-Uhrzeit als `"HH:MM"`. Laufzeitverlaeufe gehoeren zur Activity. */
  readonly initialTimeOfDay: string;
}

/** Bevorzugte Startzelle einer World. */
export interface WorldSpawnFocusCell {
  readonly gridX: number;
  readonly gridY: number;
}

export interface WorldActionPolicy {
  /** Allows combat in this World without requiring an Activity. */
  readonly combat: boolean;
  /**
   * Grundbeziehung zwischen unterschiedlichen Spielern, solange keine Activity laeuft.
   *
   * Ohne Angabe und bei `game-mode` bleibt die vom ausgewaehlten Spielmodus abgeleitete
   * Beziehung erhalten. `free-for-all` ist nur fuer ausdruecklich authored Sonderwelten gedacht
   * und macht dort alle unterschiedlichen Spieler zu Gegnern.
   */
  readonly playerRelationships?: 'game-mode' | 'free-for-all';
}

/**
 * Ob diese World auch ohne Teilnahme lokal dargestellt werden darf.
 *
 * Der Regelfall bleibt: keine Teilnahme, keine Darstellung – ein Host, der eine Shared World
 * nur simuliert, baut keine Darstellungsflaeche auf. Eine World kann das aber ausdruecklich
 * erlauben; die LobbyWorld ist genau dieser Fall. Ohne Participation ist sie sichtbar, aber ohne
 * Spielfigur, ohne Weltkamera und ohne World-Input.
 */
export interface WorldPresentationPolicy {
  readonly previewWithoutParticipation: boolean;
}

/**
 * Ob Raum-Mitglieder diese World von sich aus betreten und verlassen duerfen.
 *
 * Der Regelfall ist `false`: eine Match-World nimmt ausschliesslich auf, wen ihre Activity
 * aufnimmt. Eine World ohne Activity hat dagegen niemanden, der ihre Besetzung taktet – erlaubt
 * sie es ausdruecklich, entscheidet jeder Spieler selbst ueber Eintritt und Austritt.
 */
export interface WorldParticipationPolicy {
  readonly selfAdmit: boolean;
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

/**
 * Die persistente Basisstelle dieser World: wo der kanonische Basiskern steht.
 *
 * Sie traegt bewusst weder Kerngeometrie noch eine Build-Area-Regel. Die Form des Kerns ist
 * Code-Definition
 * ({@link import('../../persistentBase/PersistentBaseCore').CANONICAL_PERSISTENT_BASE_CORE_CELLS}),
 * die World steuert nur Lage, Ausrichtung und Grunddauerhaftigkeit bei. Die aktive Build Area
 * wird aus dem host-autoritativen World-Parameter `persistentBaseAreaStage` aufgeloest. Die
 * zugehoerige Basis mit `baseId` wird daraus erzeugt und steht anschliessend als gewoehnlicher
 * Eintrag in {@link WorldDefinition.bases}.
 */
export type WorldPersistentBaseSiteDefinition = CoopDefenseMapPersistentBaseConfig;

/** Loest den Ankerbau einer persistenten Basis innerhalb ihrer eigenen World auf. */
export function resolveWorldPersistentBaseAnchorBase(world: WorldDefinition): WorldBaseDefinition | null {
  const baseId = world.persistentBaseSite?.baseId;
  if (!baseId) return null;
  return world.bases.find((base) => base.id === baseId) ?? null;
}
