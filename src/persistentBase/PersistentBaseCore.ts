import { PERSISTENT_BASE_INITIAL_HP } from './PersistentBaseHealth';
import type {
  CoopBaseAnchor,
  CoopBaseCellOffset,
  CoopBaseConfig,
  CoopBaseShape,
} from '../config/coopDefenseMaps';
import { MAX_PERSISTENT_BASE_RADIUS_CELLS, PERSISTENT_BASE_CLEARANCE_CELLS } from '../config/persistentBase';
import type { PersistentBaseAnchor } from './PersistentBaseTypes';

/**
 * Kanonische Geometrie des persistenten Basiskerns.
 *
 * Verbindlicher Zweck: **Der Basiskern wird genau einmal beschrieben.** Eine World sagt nur, wo
 * er steht und wohin er geoeffnet ist; seine Form kommt ausschliesslich von hier. Ohne diese
 * Trennung wuerde dieselbe Basis je Map erneut authored und die Definitionen liefen auseinander.
 *
 * Die Zellen sind relativ zum Anker angegeben, weil der Anker zugleich der Bezugspunkt der
 * persistenten Konstruktionen ist (`PersistentConstruction.relativeGridX/Y`). Beides teilt sich
 * damit ein Koordinatensystem und ueberlebt jeden Wechsel der Weltposition.
 */

/** Kantenlaenge der kanonischen Grundflaeche. Ungerade, damit der Anker eine echte Zelle ist. */
export const PERSISTENT_BASE_CORE_SIZE_CELLS = 7;

/** Groesster Betrag eines relativen Offsets, also `(7 - 1) / 2`. */
const CORE_EXTENT_CELLS = (PERSISTENT_BASE_CORE_SIZE_CELLS - 1) / 2;

/**
 * Fachliche Bedeutung einer Kernzelle.
 *
 * Ausdruecklich noch keine Platzierungsregel: Diese Phase legt nur fest, *was* eine Zelle ist.
 * Wer spaeter entscheidet, ob ein Basisturm oder ein Podest dort stehen darf, liest diese Domain
 * statt eine Geometrie-Sonderfallpruefung nachzubilden.
 */
export type PersistentBaseCellDomain =
  /** Feste, fundamentierte Basisflaeche. Traegt spaeter die freigeschalteten Basistuerme. */
  | 'base-surface'
  /** Innenhof: die Flaeche fuer persistente Konstruktionen und frei platzierbare Rewards. */
  | 'courtyard-build-area'
  /** Offener Zugang. Bleibt frei, damit der Hof von allen vier Seiten erreichbar bleibt. */
  | 'entrance'
  /**
   * Gemauerte Feuerstelle auf dem Anker: fester, nicht begehbarer Teil des Forts. Sie traegt weder
   * Basistuerme noch Bauten; der Hof bleibt um sie herum frei.
   */
  | 'hearth';

/**
 * Domains, die das Fort selbst belegt: Sie gehoeren zur Basisform (Kollision, Wegfindung) und
 * stehen keinem frei platzierten Bau zur Verfuegung.
 */
export function isPersistentBaseSolidDomain(domain: PersistentBaseCellDomain | undefined): boolean {
  return domain === 'base-surface' || domain === 'hearth';
}

/**
 * Regel, die den bebaubaren Bereich relativ zum persistenten Basisanker beschreibt.
 *
 * Die aktive Regel wird ausschliesslich aus der semantischen Area-Stufe aufgeloest: Stage 0 nutzt
 * das feste 7x7-Quadrat, danach Radius 4 + Stage. Platzierung, Restore und Darstellung
 * erhalten danach dieselbe aufgeloeste Geometrie.
 */
export type PersistentBaseBuildArea =
  | { readonly kind: 'square'; readonly sizeCells: number }
  | { readonly kind: 'radius'; readonly radiusCells: number };

/** Semantische Ausbau-Stufe der persistenten Basis. */
export type CampaignPersistentBaseAreaStage = 0 | 1 | 2;
/** Radius 4 + stage; the base radius stays at most 10 (stage 6, D-46). */
export type PersistentBaseAreaStage = CampaignPersistentBaseAreaStage | 3 | 4 | 5 | 6;

export const PERSISTENT_BASE_MAX_AREA_STAGE = 6;
export const PERSISTENT_BASE_CAMPAIGN_MAX_AREA_STAGE = 2;

export const DEFAULT_PERSISTENT_BASE_AREA_STAGE: CampaignPersistentBaseAreaStage = 0;

/** Authoritative Stage-Werte an der Persistenz- und Netzwerkgrenze. */
export const PERSISTENT_BASE_AREA_STAGES = [0, 1, 2, 3, 4, 5, 6] as const satisfies readonly PersistentBaseAreaStage[];

/** Baubereich der ersten Stufe; unabhaengig von den festen Domains des Basiskerns. */
export const DEFAULT_PERSISTENT_BASE_BUILD_AREA = Object.freeze({
  kind: 'square',
  sizeCells: 7,
} as const satisfies PersistentBaseBuildArea);

/** Authoring-/Wire-Grenze fuer die semantische Area-Stufe. */
export function isPersistentBaseAreaStage(value: unknown): value is PersistentBaseAreaStage {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= 0 && value <= PERSISTENT_BASE_MAX_AREA_STAGE;
}

/** Separate storage boundary for campaign progression. */
export function isCampaignPersistentBaseAreaStage(value: unknown): value is CampaignPersistentBaseAreaStage {
  return isPersistentBaseAreaStage(value) && value <= PERSISTENT_BASE_CAMPAIGN_MAX_AREA_STAGE;
}

/** Leitet die aktive Build-Area genau einmal aus der persistenten Area-Stufe ab. */
export function resolvePersistentBaseBuildAreaForStage(
  areaStage: PersistentBaseAreaStage,
): PersistentBaseBuildArea {
  return areaStage === 0
    ? DEFAULT_PERSISTENT_BASE_BUILD_AREA
    : { kind: 'radius', radiusCells: 4 + areaStage };
}

/** Site reservation is independent of the active stage; omitted ceilings retain campaign geometry. */
export function resolvePersistentBaseReservationRadiusCells(
  maxAreaStage: PersistentBaseAreaStage = PERSISTENT_BASE_CAMPAIGN_MAX_AREA_STAGE,
): number {
  return Math.max(MAX_PERSISTENT_BASE_RADIUS_CELLS,
    getPersistentBaseBuildAreaExtentCells(resolvePersistentBaseBuildAreaForStage(maxAreaStage)))
    + PERSISTENT_BASE_CLEARANCE_CELLS;
}

/** Validierungsgrenze fuer aufgeloeste Baubereiche; unbekannte Formen werden nicht still ersetzt. */
export function isPersistentBaseBuildArea(value: unknown): value is PersistentBaseBuildArea {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as { kind?: unknown; sizeCells?: unknown; radiusCells?: unknown };
  if (candidate.kind === 'square') {
    return typeof candidate.sizeCells === 'number'
      && Number.isSafeInteger(candidate.sizeCells)
      && candidate.sizeCells > 0
      && candidate.sizeCells % 2 === 1;
  }
  return candidate.kind === 'radius'
    && typeof candidate.radiusCells === 'number'
    && Number.isFinite(candidate.radiusCells)
    && candidate.radiusCells >= 0;
}

/** Radius der Bounding-Box, die zum Iterieren ueber einen Baubereich benoetigt wird. */
export function getPersistentBaseBuildAreaExtentCells(area: PersistentBaseBuildArea): number {
  return area.kind === 'square' ? (area.sizeCells - 1) / 2 : Math.ceil(area.radiusCells);
}

/** True, wenn die relative Rasterzelle zum angegebenen Baubereich gehoert. */
export function isCellInsidePersistentBaseBuildArea(
  relativeGridX: number,
  relativeGridY: number,
  area: PersistentBaseBuildArea = DEFAULT_PERSISTENT_BASE_BUILD_AREA,
): boolean {
  if (!isPersistentBaseBuildArea(area)
    || !Number.isFinite(relativeGridX)
    || !Number.isFinite(relativeGridY)) return false;
  if (area.kind === 'square') {
    const extent = (area.sizeCells - 1) / 2;
    return Math.abs(relativeGridX) <= extent && Math.abs(relativeGridY) <= extent;
  }
  const dx = Math.abs(relativeGridX);
  const dy = Math.abs(relativeGridY);
  // Kreis plus drei Zellen breite Achsenenden, ohne die maximale Ausdehnung zu vergroessern.
  // Die Regel gilt fuer jeden Radius; die Generator-Reservierung bleibt davon unabhaengig.
  const insideCircle = dx * dx + dy * dy <= area.radiusCells * area.radiusCells;
  const insideCardinalStrip = Math.max(dx, dy) <= area.radiusCells && Math.min(dx, dy) <= 1;
  return insideCircle || insideCardinalStrip;
}

export interface PersistentBaseCoreCell {
  /** -3 ... +3, relativ zum Anker. Der Anker selbst ist `(0, 0)` und traegt die Feuerstelle. */
  readonly relativeGridX: number;
  readonly relativeGridY: number;
  readonly domain: PersistentBaseCellDomain;
}

/** Absolute Kernzelle einer konkreten World-Instanz. */
export interface PersistentBaseCoreWorldCell {
  readonly gridX: number;
  readonly gridY: number;
  readonly domain: PersistentBaseCellDomain;
}

/** Halbe Breite eines Eingangs: Mittelzelle plus je eine Zelle zu beiden Seiten, also 3 Felder. */
const ENTRANCE_HALF_WIDTH_CELLS = 1;

function resolveCanonicalDomain(relativeGridX: number, relativeGridY: number): PersistentBaseCellDomain {
  const isBoundaryCell = Math.abs(relativeGridX) === CORE_EXTENT_CELLS
    || Math.abs(relativeGridY) === CORE_EXTENT_CELLS;
  const isCenteredSideCell = (
    Math.abs(relativeGridX) <= ENTRANCE_HALF_WIDTH_CELLS && Math.abs(relativeGridY) === CORE_EXTENT_CELLS
  ) || (
    Math.abs(relativeGridY) <= ENTRANCE_HALF_WIDTH_CELLS && Math.abs(relativeGridX) === CORE_EXTENT_CELLS
  );
  if (isCenteredSideCell) return 'entrance';
  if (isBoundaryCell) return 'base-surface';
  if (relativeGridX === 0 && relativeGridY === 0) return 'hearth';
  return 'courtyard-build-area';
}

function buildCanonicalCells(): PersistentBaseCoreCell[] {
  const cells: PersistentBaseCoreCell[] = [];
  for (let relativeGridY = -CORE_EXTENT_CELLS; relativeGridY <= CORE_EXTENT_CELLS; relativeGridY++) {
    for (let relativeGridX = -CORE_EXTENT_CELLS; relativeGridX <= CORE_EXTENT_CELLS; relativeGridX++) {
      cells.push({
        relativeGridX,
        relativeGridY,
        domain: resolveCanonicalDomain(relativeGridX, relativeGridY),
      });
    }
  }
  return cells;
}

/**
 * Die kanonische 7x7-Grundflaeche (Default-Ausrichtung `open-left`):
 *
 * ```
 *   B B E E E B B      B = base-surface          (12 Zellen)
 *   B H H H H H B      H = courtyard-build-area  (24 Zellen)
 *   E H H H H H E      E = entrance              (12 Zellen)
 *   E H H F H H E      F = hearth                (1 Zelle, der Anker)
 *   E H H H H H E
 *   B H H H H H B
 *   B B E E E B B
 * ```
 *
 * Je Seite ist ein drei Felder breiter Eingang offen. Uebrig bleiben vier Eck-Bastionen aus je
 * drei Zellen (L-Form); sie bilden die feste Basisflaeche und sind untereinander nicht verbunden.
 * Die Feuerstelle auf dem Anker gehoert ebenfalls zur festen Form. Die aktive Bauzone wird separat
 * aus der Area-Stufe aufgeloest.
 */
export const CANONICAL_PERSISTENT_BASE_CORE_CELLS: readonly PersistentBaseCoreCell[] =
  Object.freeze(buildCanonicalCells());

/** Zellen einer Domain in der kanonischen Ausrichtung. */
export function getCanonicalPersistentBaseCoreCells(
  domain: PersistentBaseCellDomain,
): readonly PersistentBaseCoreCell[] {
  return CANONICAL_PERSISTENT_BASE_CORE_CELLS.filter((cell) => cell.domain === domain);
}

/**
 * Die Kernzellen relativ zum Anker.
 *
 * Der Kern ist unter jeder Vierteldrehung deckungsgleich. Eine gedrehte Basis (siehe
 * `PersistentBaseFrame`) dreht deshalb nur Rewards und Konstruktionen, nie den Kern selbst.
 */
export function resolvePersistentBaseCoreCellsRelative(): readonly PersistentBaseCoreCell[] {
  return CANONICAL_PERSISTENT_BASE_CORE_CELLS;
}

/** Die Kernzellen einer konkreten World in absoluten Rasterkoordinaten. */
export function resolvePersistentBaseCoreCells(
  anchor: PersistentBaseAnchor,
): readonly PersistentBaseCoreWorldCell[] {
  return CANONICAL_PERSISTENT_BASE_CORE_CELLS.map((cell) => ({
    gridX: anchor.gridX + cell.relativeGridX,
    gridY: anchor.gridY + cell.relativeGridY,
    domain: cell.domain,
  }));
}

/**
 * Domain einer kanonischen Offset-Koordinate samt ungedrehter Zelle relativ zu `anchor`.
 *
 * Domains sind kanonisch definiert und unter Vierteldrehungen gleich; die Lage einer gedrehten
 * Basis in der Welt bestimmt allein `PersistentBaseFrame`.
 */
export function resolvePersistentBaseCell(
  anchor: PersistentBaseAnchor,
  relativeGridX: number,
  relativeGridY: number,
  buildArea: PersistentBaseBuildArea = DEFAULT_PERSISTENT_BASE_BUILD_AREA,
): PersistentBaseCoreWorldCell | null {
  const canonical = CANONICAL_PERSISTENT_BASE_CORE_CELLS.find((cell) => (
    cell.relativeGridX === relativeGridX && cell.relativeGridY === relativeGridY
  ));
  if (!canonical && !isCellInsidePersistentBaseBuildArea(relativeGridX, relativeGridY, buildArea)) {
    return null;
  }
  return {
    gridX: anchor.gridX + relativeGridX,
    gridY: anchor.gridY + relativeGridY,
    domain: canonical?.domain ?? 'courtyard-build-area',
  };
}

/**
 * Die feste Form des Kerns (Bastionen und Feuerstelle) als Shape-Offsets, auf den Ursprung `(0, 0)`
 * normalisiert.
 *
 * Das ist der Uebergang von der Kerngeometrie in den bestehenden Basisvertrag: `shape.kind`
 * `'cells'` traegt beliebige, auch konkave Formen, deshalb braucht die Kernform keinen neuen
 * Shape-Typ.
 */
export function getPersistentBaseCoreSolidOffsets(): readonly CoopBaseCellOffset[] {
  return CANONICAL_PERSISTENT_BASE_CORE_CELLS
    .filter((cell) => isPersistentBaseSolidDomain(cell.domain))
    .map((cell) => ({
      gridX: cell.relativeGridX + CORE_EXTENT_CELLS,
      gridY: cell.relativeGridY + CORE_EXTENT_CELLS,
    }));
}

/** Authored Beschreibung einer persistenten Basisstelle: Lage und Grunddauerhaftigkeit. */
export interface PersistentBaseCoreSite {
  readonly baseId: string;
  readonly anchor: PersistentBaseAnchor;
}

/** Gitterursprung der 7x7-Grundflaeche, also die obere linke Zelle ihrer Bounding-Box. */
export function getPersistentBaseCoreOrigin(anchor: PersistentBaseAnchor): { gridX: number; gridY: number } {
  return { gridX: anchor.gridX - CORE_EXTENT_CELLS, gridY: anchor.gridY - CORE_EXTENT_CELLS };
}

/**
 * Expandiert eine authored Basisstelle in die vollstaendige Basiskonfiguration.
 *
 * Weil die Bounding-Box immer die volle 7x7-Flaeche ist, faellt ihre Mitte exakt auf den
 * authored Anker - genau den Wert, den `addPersistentBaseReservation` spaeter als
 * `anchorGridX/Y` ableitet. Anker und persistente Konstruktionen bleiben dadurch ohne Sonderfall
 * deckungsgleich.
 */
export function buildPersistentBaseCoreBaseConfig(site: PersistentBaseCoreSite): CoopBaseConfig {
  const origin = getPersistentBaseCoreOrigin(site.anchor);
  const anchor: CoopBaseAnchor = { kind: 'grid', gridX: origin.gridX, gridY: origin.gridY };
  const shape: CoopBaseShape = {
    kind: 'cells',
    cells: getPersistentBaseCoreSolidOffsets(),
  };
  return {
    id: site.baseId,
    hpMax: PERSISTENT_BASE_INITIAL_HP,
    faction: 'friendly',
    role: 'main',
    anchor,
    shape,
  };
}
