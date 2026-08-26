/**
 * Kanonische replizierte World-Identitaet.
 *
 * Ein `WorldDescriptor` beschreibt genau eine World-Instanz: welche
 * {@link import('../config/authoring/WorldDefinition').WorldDefinition} sie realisiert und mit
 * welchen Instanzparametern. Er enthaelt ausschliesslich World-Identitaet und
 * World-Konfiguration.
 *
 * Ausdruecklich nicht hier hinein gehoeren Mission Objective, Round Role, Siegbedingungen,
 * Respawn-Budget oder ein `GameMode` als Ersatz fuer die Activity – dafuer existiert der
 * {@link import('./ActivityDescriptor').ActivityDescriptor}.
 */
export interface WorldDescriptor {
  /** Identitaet genau einer World-Instanz. Eine neue World erhaelt immer eine neue Revision. */
  readonly worldRevision: number;
  /** Verweist auf die authored WorldDefinition, z. B. `world:coop-defense:7`. */
  readonly definitionId: string;
  readonly seed: number;
  readonly generatorVersion: number;
  readonly layoutFingerprint: string;
  /** Instanzparameter dieser World; nur echte World-Werte, keine Aktivitaetsdaten. */
  readonly parameters?: WorldParameters;
}

/**
 * Host-autoritative Parameter einer konkreten World-Instanz.
 *
 * Sie unterscheiden zwei Instanzen derselben WorldDefinition. Heute reist der persistente
 * Basisradius noch im `RoundState` mit – also in einem Activity-Vertrag. Der kanonische Platz
 * ist diese Struktur.
 */
export interface WorldParameters {
  /** Aktiver Radius der persistenten Basis dieser World-Instanz in Zellen. */
  readonly persistentBaseRadiusCells?: number;
}

/** WorldDefinition-ID einer prozedural erzeugten Arena ohne authored Map. */
export const PROCEDURAL_ARENA_WORLD_DEFINITION_ID = 'world:procedural-arena';

/**
 * Netzwerkgrenze fuer eingehende World-Identitaeten. Ungueltige Nutzlast wird verworfen statt
 * teilweise uebernommen – dieselbe Regel, nach der die Bridge heute den `ArenaDescriptor` prueft.
 */
export function parseWorldDescriptor(raw: unknown): WorldDescriptor | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<WorldDescriptor>;
  if (!isSafePositiveInteger(candidate.worldRevision)) return null;
  if (typeof candidate.definitionId !== 'string' || candidate.definitionId.length === 0) return null;
  if (!isSafeInteger(candidate.seed)) return null;
  if (!isSafeInteger(candidate.generatorVersion)) return null;
  if (typeof candidate.layoutFingerprint !== 'string' || candidate.layoutFingerprint.length === 0) return null;
  const parameters = parseWorldParameters(candidate.parameters);
  const descriptor: WorldDescriptor = {
    worldRevision: candidate.worldRevision,
    definitionId: candidate.definitionId,
    seed: candidate.seed,
    generatorVersion: candidate.generatorVersion,
    layoutFingerprint: candidate.layoutFingerprint,
  };
  return parameters ? { ...descriptor, parameters } : descriptor;
}

/**
 * True, wenn beide Descriptoren dieselbe World-Instanz meinen. Die Revision allein genuegt
 * nicht: zwei Peers muessen auch dasselbe Layout reproduziert haben.
 */
export function isSameWorldInstance(left: WorldDescriptor, right: WorldDescriptor): boolean {
  return left.worldRevision === right.worldRevision
    && left.definitionId === right.definitionId
    && left.seed === right.seed
    && left.generatorVersion === right.generatorVersion
    && left.layoutFingerprint === right.layoutFingerprint;
}

function parseWorldParameters(raw: unknown): WorldParameters | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<WorldParameters>;
  const radiusCells = candidate.persistentBaseRadiusCells;
  if (radiusCells === undefined) return null;
  if (!isSafeInteger(radiusCells) || radiusCells < 0) return null;
  return { persistentBaseRadiusCells: radiusCells };
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isSafePositiveInteger(value: unknown): value is number {
  return isSafeInteger(value) && value > 0;
}
