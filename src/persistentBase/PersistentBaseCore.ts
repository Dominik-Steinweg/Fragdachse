import type {
  CoopBaseAnchor,
  CoopBaseCellOffset,
  CoopBaseConfig,
  CoopBaseShape,
} from '../config/coopDefenseMaps';
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
export const PERSISTENT_BASE_CORE_SIZE_CELLS = 5;

/** Groesster Betrag eines relativen Offsets, also `(5 - 1) / 2`. */
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
  | 'entrance';

/**
 * Regel, die den bebaubaren Bereich relativ zum persistenten Basisanker beschreibt.
 *
 * Der aktuelle Ausbau nutzt bewusst ein festes 3x3-Quadrat. Ein spaeterer Ausbau kann dieselbe
 * Schnittstelle mit einer radiusgesteuerten Zone verwenden, ohne Platzierung, Restore und
 * Darstellung erneut anpassen zu muessen.
 */
export type PersistentBaseBuildArea =
  | { readonly kind: 'square'; readonly sizeCells: number }
  | { readonly kind: 'radius'; readonly radiusCells: number };

/** Aktueller Baubereich: genau die neun Innenhofzellen im 5x5-Kern. */
export const DEFAULT_PERSISTENT_BASE_BUILD_AREA = Object.freeze({
  kind: 'square',
  sizeCells: 3,
} as const satisfies PersistentBaseBuildArea);

/** Authoring-Grenze fuer Baubereiche; unbekannte Formen werden nicht still ersetzt. */
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

/**
 * Loest die authored Regel fuer eine World-Instanz auf.
 *
 * Ein authored Radius beschreibt nur die spaetere Regelart; sein aktiver Wert kommt aus dem
 * replizierten Progressionsradius. Das feste Quadrat bleibt davon unberuehrt.
 */
export function resolvePersistentBaseBuildArea(
  authoredBuildArea: PersistentBaseBuildArea | undefined,
  activeRadiusCells: number,
): PersistentBaseBuildArea {
  const area = authoredBuildArea ?? DEFAULT_PERSISTENT_BASE_BUILD_AREA;
  return area.kind === 'radius'
    ? { kind: 'radius', radiusCells: activeRadiusCells }
    : area;
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
  return relativeGridX * relativeGridX + relativeGridY * relativeGridY <= area.radiusCells * area.radiusCells;
}

/**
 * Ausrichtung des Kerns. `open-left` ist die kanonische Form und der Default jeder World.
 *
 * Die uebrigen drei existieren, damit eine Map aus Leveldesign-Gruenden eine gedrehte Basis
 * tragen kann, ohne dass Persistenz oder Authoring dafuer umgebaut werden muessten. Die aktuelle
 * vierseitige Kernform bleibt dabei unter jeder Vierteldrehung geometrisch gleich.
 */
export type PersistentBaseOrientation = 'open-left' | 'open-up' | 'open-right' | 'open-down';

export const DEFAULT_PERSISTENT_BASE_ORIENTATION: PersistentBaseOrientation = 'open-left';

export const PERSISTENT_BASE_ORIENTATIONS = [
  'open-left',
  'open-up',
  'open-right',
  'open-down',
] as const satisfies readonly PersistentBaseOrientation[];

/** Authoring-Grenze: eine unbekannte Ausrichtung wird abgelehnt, nicht still ersetzt. */
export function isPersistentBaseOrientation(value: unknown): value is PersistentBaseOrientation {
  return typeof value === 'string'
    && (PERSISTENT_BASE_ORIENTATIONS as readonly string[]).includes(value);
}

export interface PersistentBaseCoreCell {
  /** -2 ... +2, relativ zum Anker. Der Anker selbst ist `(0, 0)` und liegt im Innenhof. */
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

function resolveCanonicalDomain(relativeGridX: number, relativeGridY: number): PersistentBaseCellDomain {
  const isBoundaryCell = Math.abs(relativeGridX) === CORE_EXTENT_CELLS
    || Math.abs(relativeGridY) === CORE_EXTENT_CELLS;
  const isCenteredSideCell = (
    relativeGridX === 0 && Math.abs(relativeGridY) === CORE_EXTENT_CELLS
  ) || (
    relativeGridY === 0 && Math.abs(relativeGridX) === CORE_EXTENT_CELLS
  );
  if (isCenteredSideCell) return 'entrance';
  if (isBoundaryCell) return 'base-surface';
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
 * Die kanonische 5x5-Grundflaeche (Default-Ausrichtung `open-left`):
 *
 * ```
 *   B B E B B      B = base-surface          (12 Zellen)
 *   B H H H B      H = courtyard-build-area  ( 9 Zellen)
 *   E H H H E      E = entrance              ( 4 Zellen)
 *   B H H H B
 *   B B E B B
 * ```
 *
 * Die vier mittleren Randzellen sind offene Eingaenge. Die Ecken und die uebrigen Randzellen
 * bilden die feste Basisflaeche; der Innenhof ist der aktuelle Baubereich.
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
 * Dreht einen relativen Offset aus der kanonischen Ausrichtung in die angegebene.
 *
 * Reine Vierteldrehung um den Anker: Weil der Anker die Mittelzelle ist, bleibt die Form dabei
 * deckungsgleich und der Anker unveraendert.
 */
export function rotatePersistentBaseCoreOffset(
  relativeGridX: number,
  relativeGridY: number,
  orientation: PersistentBaseOrientation,
): { readonly relativeGridX: number; readonly relativeGridY: number } {
  switch (orientation) {
    case 'open-left':
      return { relativeGridX, relativeGridY };
    case 'open-up':
      return { relativeGridX: -relativeGridY, relativeGridY: relativeGridX };
    case 'open-right':
      return { relativeGridX: -relativeGridX, relativeGridY: -relativeGridY };
    case 'open-down':
      return { relativeGridX: relativeGridY, relativeGridY: -relativeGridX };
  }
}

/** Die kanonischen Zellen in der angegebenen Ausrichtung, weiterhin relativ zum Anker. */
export function resolvePersistentBaseCoreCellsRelative(
  orientation: PersistentBaseOrientation = DEFAULT_PERSISTENT_BASE_ORIENTATION,
): readonly PersistentBaseCoreCell[] {
  if (orientation === DEFAULT_PERSISTENT_BASE_ORIENTATION) return CANONICAL_PERSISTENT_BASE_CORE_CELLS;
  return CANONICAL_PERSISTENT_BASE_CORE_CELLS.map((cell) => {
    const rotated = rotatePersistentBaseCoreOffset(cell.relativeGridX, cell.relativeGridY, orientation);
    return { ...rotated, domain: cell.domain };
  });
}

/** Die Kernzellen einer konkreten World in absoluten Rasterkoordinaten. */
export function resolvePersistentBaseCoreCells(
  anchor: PersistentBaseAnchor,
  orientation: PersistentBaseOrientation = DEFAULT_PERSISTENT_BASE_ORIENTATION,
): readonly PersistentBaseCoreWorldCell[] {
  return resolvePersistentBaseCoreCellsRelative(orientation).map((cell) => ({
    gridX: anchor.gridX + cell.relativeGridX,
    gridY: anchor.gridY + cell.relativeGridY,
    domain: cell.domain,
  }));
}

/**
 * Loest eine gespeicherte kanonische Offset-Koordinate in die aktuelle World-Zelle auf.
 *
 * Persistenz kennt nur den kanonischen Offset. Die Ausrichtung wird erst hier, genau einmal,
 * angewendet; dadurch bleiben Domain-Pruefung und World-Aufloesung fuer alle Reward-Kategorien
 * identisch.
 */
export function resolvePersistentBaseCell(
  anchor: PersistentBaseAnchor,
  relativeGridX: number,
  relativeGridY: number,
  orientation: PersistentBaseOrientation = DEFAULT_PERSISTENT_BASE_ORIENTATION,
  buildArea: PersistentBaseBuildArea = DEFAULT_PERSISTENT_BASE_BUILD_AREA,
): PersistentBaseCoreWorldCell | null {
  const canonical = CANONICAL_PERSISTENT_BASE_CORE_CELLS.find((cell) => (
    cell.relativeGridX === relativeGridX && cell.relativeGridY === relativeGridY
  ));
  if (!canonical && !isCellInsidePersistentBaseBuildArea(relativeGridX, relativeGridY, buildArea)) {
    return null;
  }
  const offset = rotatePersistentBaseCoreOffset(relativeGridX, relativeGridY, orientation);
  return {
    gridX: anchor.gridX + offset.relativeGridX,
    gridY: anchor.gridY + offset.relativeGridY,
    domain: canonical?.domain ?? 'courtyard-build-area',
  };
}

/**
 * Die feste Basisflaeche als Shape-Offsets, auf den Ursprung `(0, 0)` normalisiert.
 *
 * Das ist der Uebergang von der Kerngeometrie in den bestehenden Basisvertrag: `shape.kind`
 * `'cells'` traegt beliebige, auch konkave Formen, deshalb braucht die Kernform keinen neuen
 * Shape-Typ.
 */
export function getPersistentBaseCoreSurfaceOffsets(
  orientation: PersistentBaseOrientation = DEFAULT_PERSISTENT_BASE_ORIENTATION,
): readonly CoopBaseCellOffset[] {
  return resolvePersistentBaseCoreCellsRelative(orientation)
    .filter((cell) => cell.domain === 'base-surface')
    .map((cell) => ({
      gridX: cell.relativeGridX + CORE_EXTENT_CELLS,
      gridY: cell.relativeGridY + CORE_EXTENT_CELLS,
    }));
}

/** Authored Beschreibung einer persistenten Basisstelle: Lage, Ausrichtung, Grunddauerhaftigkeit. */
export interface PersistentBaseCoreSite {
  readonly baseId: string;
  readonly anchor: PersistentBaseAnchor;
  readonly orientation?: PersistentBaseOrientation;
  /** Ohne Angabe gilt der aktuelle 3x3-Innenhof; spaetere Stufen koennen einen Radius waehlen. */
  readonly buildArea?: PersistentBaseBuildArea;
  readonly hpMax: number;
}

/** Gitterursprung der 5x5-Grundflaeche, also die obere linke Zelle ihrer Bounding-Box. */
export function getPersistentBaseCoreOrigin(anchor: PersistentBaseAnchor): { gridX: number; gridY: number } {
  return { gridX: anchor.gridX - CORE_EXTENT_CELLS, gridY: anchor.gridY - CORE_EXTENT_CELLS };
}

/**
 * Expandiert eine authored Basisstelle in die vollstaendige Basiskonfiguration.
 *
 * Weil die Bounding-Box immer die volle 5x5-Flaeche ist, faellt ihre Mitte exakt auf den
 * authored Anker - genau den Wert, den `addPersistentBaseReservation` spaeter als
 * `anchorGridX/Y` ableitet. Anker und persistente Konstruktionen bleiben dadurch ohne Sonderfall
 * deckungsgleich.
 */
export function buildPersistentBaseCoreBaseConfig(site: PersistentBaseCoreSite): CoopBaseConfig {
  const origin = getPersistentBaseCoreOrigin(site.anchor);
  const anchor: CoopBaseAnchor = { kind: 'grid', gridX: origin.gridX, gridY: origin.gridY };
  const shape: CoopBaseShape = {
    kind: 'cells',
    cells: getPersistentBaseCoreSurfaceOffsets(site.orientation),
  };
  return {
    id: site.baseId,
    hpMax: site.hpMax,
    faction: 'friendly',
    role: 'main',
    anchor,
    shape,
  };
}
