import { resolveCoopDefenseBases, type BaseSpec } from '../arena/BaseRegistry';
import type { ArenaMetricsProfile } from '../config';
import { toWorldDefinition } from '../config/authoring/coopDefenseAuthoringAdapter';
import type { WorldDefinition } from '../config/authoring/WorldDefinition';
import type { CoopDefenseMapConfig } from '../config/coopDefenseMaps';
import type { PersistentBaseAnchor } from '../persistentBase/PersistentBaseTypes';
import { getPersistentBaseAnchor } from '../persistentBase/PersistentBaseZone';
import { toWorldDefinitionId } from './arenaDescriptorAdapter';
import type { WorldDescriptor } from './WorldDescriptor';
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
  /** Host-autoritativer aktiver Radius dieser Instanz. */
  readonly radiusCells: number;
}

export interface WorldRuntimeContextInput {
  readonly descriptor: WorldDescriptor;
  /** Bereits ausgewaehltes Arena-Profil dieser World; siehe `getArenaMetricsProfile()`. */
  readonly metricsProfile: ArenaMetricsProfile;
  /** Authored Map dieser World; `null` fuer die prozedurale Arena. */
  readonly mapConfig: CoopDefenseMapConfig | null;
  /**
   * Skalierung der Basen nach Spielerzahl. Fachlich ein Activity-Wert – er wird hier nur so
   * lange durchgereicht, bis Basisgeometrie und Rundenskalierung getrennt sind.
   */
  readonly humanPlayerCount: number;
}

/**
 * Baut den Kontext einer World-Instanz auf.
 *
 * Die Basen werden aus der uebergebenen Map aufgeloest, nicht aus der aktuell in der Lobby
 * gewaehlten. Genau das unterscheidet World-scoped Zustand von der heutigen impliziten
 * Aufloesung ueber `getCoopDefenseBases()`.
 */
export function createWorldRuntimeContext(input: WorldRuntimeContextInput): WorldRuntimeContext {
  const { descriptor, mapConfig } = input;
  // Die Map muss die Map dieser World sein. Ohne diese Pruefung koennte ein Aufrufer die
  // Lobby-Auswahl in eine fremde World-Identitaet hineinbauen.
  const expectedDefinitionId = toWorldDefinitionId(mapConfig?.mapId ?? null);
  if (expectedDefinitionId !== descriptor.definitionId) {
    throw new Error(
      `[WorldRuntimeContext] World ${descriptor.definitionId} cannot be built from ${expectedDefinitionId}`,
    );
  }
  const bases = mapConfig ? resolveCoopDefenseBases(mapConfig, input.humanPlayerCount) : [];
  return {
    descriptor,
    definition: mapConfig ? toWorldDefinition(mapConfig) : null,
    metrics: resolveWorldMetrics(input.metricsProfile),
    bases,
    persistentBaseSite: resolvePersistentBaseSite(descriptor, mapConfig, bases),
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
 */
function resolvePersistentBaseSite(
  descriptor: WorldDescriptor,
  mapConfig: CoopDefenseMapConfig | null,
  bases: readonly BaseSpec[],
): WorldPersistentBaseSite | null {
  const baseId = mapConfig?.persistentBase?.baseId;
  if (!baseId) return null;
  const radiusCells = descriptor.parameters?.persistentBaseRadiusCells;
  if (radiusCells === undefined) {
    throw new Error(
      `[WorldRuntimeContext] World ${descriptor.definitionId} has a persistent base site but no replicated radius`,
    );
  }
  const base = bases.find((candidate) => candidate.id === baseId);
  if (!base) return null;
  return { baseId, base, anchor: getPersistentBaseAnchor(base), radiusCells };
}
