import { resolveWorldBases, type BaseSpec } from '../arena/BaseRegistry';
import type { ArenaMetricsProfile } from '../config';
import type { WorldDefinition } from '../config/authoring/WorldDefinition';
import type { PersistentBaseAnchor } from '../persistentBase/PersistentBaseTypes';
import {
  resolvePersistentBaseBuildArea,
  DEFAULT_PERSISTENT_BASE_ORIENTATION,
  type PersistentBaseOrientation,
  type PersistentBaseBuildArea,
} from '../persistentBase/PersistentBaseCore';
import { getPersistentBaseAnchor } from '../persistentBase/PersistentBaseZone';
import { isProceduralWorldDefinitionId, type WorldDescriptor } from './WorldDescriptor';
import { resolveWorldMetrics, type WorldMetrics } from './WorldMetrics';

/**
 * Kanonischer Laufzeitkontext genau einer World-Instanz.
 *
 * Verbindlicher Zweck: **Alle Daten, die zu genau einer World gehoeren, werden ueber genau
 * diese World gebunden.** Wer die Metrik, die Basen oder die persistente Basisstelle braucht,
 * liest sie hier – nicht aus mutablen Modulvariablen und nicht erneut aus der Lobby-Auswahl.
 *
 * Er ist ausdruecklich **kein** neuer God-Context. Er traegt World-Identitaet, die
 * unveraenderliche World-Grundlage und world-scoped abgeleiteten Zustand. Activity-Systeme –
 * Gegner, Boss, Missionsziele, Encounter, Respawn-Budget – gehoeren nicht hierher; sie leben in
 * der Activity Runtime.
 */
export interface WorldRuntimeContext {
  readonly descriptor: WorldDescriptor;
  /**
   * Authored Grundlage dieser World. `null` fuer die prozedurale Arena, die (noch) keine eigene
   * WorldDefinition besitzt.
   */
  readonly definition: WorldDefinition | null;
  readonly metrics: WorldMetrics;
  readonly bases: readonly BaseSpec[];
  readonly persistentBaseSite: WorldPersistentBaseSite | null;
}

/** Aufgeloeste persistente Basisstelle dieser World-Instanz. */
export interface WorldPersistentBaseSite {
  readonly baseId: string;
  /** Die Basis dieser World, die als Anker dient. */
  readonly base: BaseSpec;
  readonly anchor: PersistentBaseAnchor;
  readonly orientation: PersistentBaseOrientation;
  /** Host-autoritativer Progressionsradius; relevant fuer radiusbasierte Area-Regeln. */
  readonly radiusCells: number;
  /** Aktuelle Regel fuer die bebaubare Flaeche dieser Instanz. */
  readonly buildArea: PersistentBaseBuildArea;
}

export interface WorldRuntimeContextInput {
  readonly descriptor: WorldDescriptor;
  /** Bereits ausgewaehltes Arena-Profil dieser World; siehe `getArenaMetricsProfile()`. */
  readonly metricsProfile: ArenaMetricsProfile;
  /** Authored World dieser Instanz; `null` fuer die prozedurale Arena. */
  readonly definition: WorldDefinition | null;
}

/**
 * Baut den Kontext einer World-Instanz auf.
 *
 * Die World-Geometrie wird aus der uebergebenen WorldDefinition aufgeloest, nicht aus der
 * aktuell in der Lobby gewaehlten Map. Activity-Overlays werden ausserhalb dieses Kontextes
 * aufgebaut.
 */
export function createWorldRuntimeContext(input: WorldRuntimeContextInput): WorldRuntimeContext {
  const { descriptor, definition } = input;
  // Die authored Definition muss genau die World-Identitaet tragen. Fuer prozedurale Worlds
  // ist dagegen ausdruecklich keine Definition vorhanden.
  const definitionMatches = definition
    ? definition.id === descriptor.definitionId
    : isProceduralWorldDefinitionId(descriptor.definitionId);
  if (!definitionMatches) {
    throw new Error(
      `[WorldRuntimeContext] World ${descriptor.definitionId} cannot be built from `
      + `${definition?.id ?? 'no authored definition'}`,
    );
  }
  // Genau eine Metrikquelle fuer diese World. Wuerde die Basisaufloesung ihre eigene ableiten,
  // koennten Geometrie und `metrics` bei einem unpassenden Profil still auseinanderlaufen.
  const metrics = resolveWorldMetrics(input.metricsProfile);
  // Ob der Basiskern zu dieser Instanz gehoert, entscheidet ausschliesslich der replizierte
  // Parameter. Geometrie und Basisstelle folgen derselben Antwort, damit eine gesperrte World
  // nicht doch die Kollisionszellen einer Basis traegt, die es fuer sie nicht gibt.
  const includePersistentBaseCore = descriptor.parameters?.persistentBaseUnlocked === true;
  const bases = definition
    ? resolveWorldBases(definition, metrics, { includePersistentBaseCore })
    : [];
  return {
    descriptor,
    definition,
    metrics,
    bases,
    persistentBaseSite: includePersistentBaseCore
      ? resolvePersistentBaseSite(descriptor, definition, bases)
      : null,
  };
}

/** Basis dieser World mit der angegebenen ID; `null`, wenn sie nicht dazugehoert. */
export function findWorldBase(world: WorldRuntimeContext, baseId: string): BaseSpec | null {
  return world.bases.find((base) => base.id === baseId) ?? null;
}

/**
 * True, wenn die persistente Basisstelle eine eigene Hauptbasis ist. Nur dann darf eine Mission
 * dort eine persistente Basis fuehren.
 */
export function isValidPersistentBaseSite(site: WorldPersistentBaseSite | null): site is WorldPersistentBaseSite {
  return site !== null && site.base.faction === 'friendly' && site.base.role === 'main';
}

/**
 * Der aktive Radius ist host-autoritative World-Konfiguration und kommt ausschliesslich aus
 * dem Descriptor. Ein lokaler Ersatzwert waere pro Peer verschieden und wuerde aus einem
 * Uebertragungsfehler still zwei verschiedene Welten machen – deshalb schlaegt der Aufbau hier
 * fehl, statt zu raten.
 *
 * Aufgerufen wird die Funktion nur fuer eine Instanz, die ihren Kern besitzt; die Freischaltung
 * selbst wird eine Ebene hoeher entschieden.
 */
function resolvePersistentBaseSite(
  descriptor: WorldDescriptor,
  definition: WorldDefinition | null,
  bases: readonly BaseSpec[],
): WorldPersistentBaseSite | null {
  const baseId = definition?.persistentBaseSite?.baseId;
  if (!baseId) return null;
  const radiusCells = descriptor.parameters?.persistentBaseRadiusCells;
  if (radiusCells === undefined) {
    throw new Error(
      `[WorldRuntimeContext] World ${descriptor.definitionId} has a persistent base site but no replicated radius`,
    );
  }
  const base = bases.find((candidate) => candidate.id === baseId);
  if (!base) return null;
  const buildArea = resolvePersistentBaseBuildArea(
    definition.persistentBaseSite?.buildArea,
    radiusCells,
  );
  return {
    baseId,
    base,
    anchor: getPersistentBaseAnchor(base),
    orientation: definition.persistentBaseSite?.orientation ?? DEFAULT_PERSISTENT_BASE_ORIENTATION,
    radiusCells,
    buildArea,
  };
}
