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
  /**
   * Verweist auf die authored WorldDefinition, z. B. `world:coop-defense:7`. Sie loest im
   * Authoring-Registry auf – ausser bei einer prozeduralen World, die keine authored Grundlage
   * besitzt; dafuer gilt {@link isProceduralWorldDefinitionId}.
   */
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
 * Sie unterscheiden zwei Instanzen derselben WorldDefinition. Der persistente Basisradius ist
 * eine World-Konfiguration und reist deshalb hier statt in einem Activity- oder Round-Vertrag.
 */
export interface WorldParameters {
  /**
   * Traegt diese World-Instanz ihren persistenten Basiskern?
   *
   * Die authored {@link import('../config/authoring/WorldDefinition').WorldDefinition} sagt nur,
   * *wo* der Kern stuende. Ob er tatsaechlich existiert, entscheidet der Host aus dem
   * Entitlement des Spielers - und genau deshalb reist die Antwort hier mit: Zwei Peers mit
   * unterschiedlichem Wert haben nicht dieselbe World gebaut.
   */
  readonly persistentBaseUnlocked?: boolean;
  /** Aktiver Radius der persistenten Basis dieser World-Instanz in Zellen. */
  readonly persistentBaseRadiusCells?: number;
}

/**
 * WorldDefinition-ID einer prozedural erzeugten Arena. Sie besitzt bewusst keine authored
 * WorldDefinition: ihre Grundlage ist der Generator, nicht eine Datei.
 */
export const PROCEDURAL_ARENA_WORLD_DEFINITION_ID = 'world:procedural-arena';

/** True, wenn zu dieser World-ID grundsaetzlich keine authored WorldDefinition existiert. */
export function isProceduralWorldDefinitionId(definitionId: string): boolean {
  return definitionId === PROCEDURAL_ARENA_WORLD_DEFINITION_ID;
}

/**
 * Felder, die eine World-Instanz konfigurieren. Sie sind Teil ihrer Identitaet: zwei Peers mit
 * unterschiedlichen Parametern haben nicht dieselbe World gebaut.
 */
export const WORLD_PARAMETER_FIELDS = [
  'persistentBaseUnlocked',
  'persistentBaseRadiusCells',
] as const satisfies readonly (keyof WorldParameters)[];

/**
 * Netzwerkgrenze fuer eingehende World-Identitaeten. Ungueltige Nutzlast wird verworfen statt
 * teilweise uebernommen; die fruehere gemischte Arena-Identitaet ist dafuer keine Quelle mehr.
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
 * nicht: zwei Peers muessen auch dasselbe Layout und dieselbe World-Konfiguration haben.
 */
export function isSameWorldInstance(left: WorldDescriptor, right: WorldDescriptor): boolean {
  return left.worldRevision === right.worldRevision
    && left.definitionId === right.definitionId
    && left.seed === right.seed
    && left.generatorVersion === right.generatorVersion
    && left.layoutFingerprint === right.layoutFingerprint
    && haveSameWorldParameters(left.parameters, right.parameters);
}

/** Feldweiser Vergleich, damit ein neuer World-Parameter nicht still aus der Identitaet faellt. */
export function haveSameWorldParameters(
  left: WorldParameters | undefined,
  right: WorldParameters | undefined,
): boolean {
  return WORLD_PARAMETER_FIELDS.every((field) => (left?.[field] ?? null) === (right?.[field] ?? null));
}

/**
 * Jedes Feld wird einzeln geprueft; ein ungueltiger Wert verwirft die ganze Nutzlast, statt
 * still auf einen lokalen Ersatzwert zu fallen. Bleibt kein Feld uebrig, traegt diese World
 * schlicht keine Parameter.
 */
function parseWorldParameters(raw: unknown): WorldParameters | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<WorldParameters>;
  const parameters: {
    persistentBaseUnlocked?: boolean;
    persistentBaseRadiusCells?: number;
  } = {};

  const unlocked = candidate.persistentBaseUnlocked;
  if (unlocked !== undefined) {
    if (typeof unlocked !== 'boolean') return null;
    parameters.persistentBaseUnlocked = unlocked;
  }

  const radiusCells = candidate.persistentBaseRadiusCells;
  if (radiusCells !== undefined) {
    if (!isSafeInteger(radiusCells) || radiusCells < 0) return null;
    parameters.persistentBaseRadiusCells = radiusCells;
  }

  return Object.keys(parameters).length > 0 ? parameters : null;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isSafePositiveInteger(value: unknown): value is number {
  return isSafeInteger(value) && value > 0;
}
