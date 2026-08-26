import { resolveCoopDefenseBases, type BaseSpec } from '../arena/BaseRegistry';
import type { ArenaMetricsProfile } from '../config';
import { toWorldDefinition } from '../config/authoring/coopDefenseAuthoringAdapter';
import type { WorldDefinition } from '../config/authoring/WorldDefinition';
import type { CoopDefenseMapConfig } from '../config/coopDefenseMaps';
import type { PersistentBaseAnchor } from '../persistentBase/PersistentBaseTypes';
import { getPersistentBaseAnchor } from '../persistentBase/PersistentBaseZone';
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
  /** Radius, solange die World-Instanz keinen replizierten Parameter mitbringt. */
  readonly fallbackPersistentBaseRadiusCells: number;
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
  const bases = mapConfig ? resolveCoopDefenseBases(mapConfig, input.humanPlayerCount) : [];
  return {
    descriptor,
    definition: mapConfig ? toWorldDefinition(mapConfig) : null,
    metrics: resolveWorldMetrics(input.metricsProfile),
    bases,
    persistentBaseSite: resolvePersistentBaseSite(
      mapConfig,
      bases,
      descriptor.parameters?.persistentBaseRadiusCells ?? input.fallbackPersistentBaseRadiusCells,
    ),
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

function resolvePersistentBaseSite(
  mapConfig: CoopDefenseMapConfig | null,
  bases: readonly BaseSpec[],
  radiusCells: number,
): WorldPersistentBaseSite | null {
  const baseId = mapConfig?.persistentBase?.baseId;
  if (!baseId) return null;
  const base = bases.find((candidate) => candidate.id === baseId);
  if (!base) return null;
  return { baseId, base, anchor: getPersistentBaseAnchor(base), radiusCells };
}
