/**
 * Canonical spawn structure (GDD Spawnbauwerk V1): a feindlicher Spawnpunkt ist immer ein U aus
 * 4x3 Zellen. Nur die 8 Wandzellen sind Basiszellen mit Hitbox; die 2x2-Innenflaeche ist die
 * Brutgrube, aus der die Gegner steigen, und oeffnet sich ueber zwei Zellen zur Seite `outlet`.
 *
 * Authored bleiben `shape.cells` und `spawnCenter` (eine Zelle der Innenflaeche). Alles Weitere
 * wird hier aus genau einer Vorlage je Ausrichtung abgeleitet, damit Authoring, World,
 * Spawn-Ausfuehrung, Editor und Darstellung dieselbe Geometrie sehen.
 */

export type SpawnStructureOutlet = 'north' | 'east' | 'south' | 'west';

export const SPAWN_STRUCTURE_OUTLETS = ['north', 'east', 'south', 'west'] as const satisfies readonly SpawnStructureOutlet[];

export interface SpawnStructureCell {
  readonly gridX: number;
  readonly gridY: number;
}

export interface SpawnStructureRect {
  readonly gridX: number;
  readonly gridY: number;
  readonly widthCells: number;
  readonly heightCells: number;
}

export interface SpawnStructureTemplate {
  readonly outlet: SpawnStructureOutlet;
  readonly widthCells: number;
  readonly heightCells: number;
  /** The 8 wall cells, relative to the shape origin. */
  readonly cells: readonly SpawnStructureCell[];
  /** The 2x2 brood pit, relative to the shape origin. */
  readonly area: SpawnStructureRect;
  /** The two free cells directly in front of the opening, relative to the shape origin. */
  readonly mouth: readonly SpawnStructureCell[];
}

/** World placement of one spawn structure's brood pit (absolute grid cells, world pixels). */
export interface ResolvedSpawnStructureArea {
  readonly outlet: SpawnStructureOutlet;
  readonly minGridX: number;
  readonly minGridY: number;
  readonly widthCells: number;
  readonly heightCells: number;
  /** Pit centre: the point enemies rise from. */
  readonly x: number;
  readonly y: number;
  /** The two free cells in front of the opening. */
  readonly mouth: readonly SpawnStructureCell[];
}

/** Long side of the U; the short side is one cell shorter. */
export const SPAWN_STRUCTURE_LONG_SIDE_CELLS = 4;
export const SPAWN_STRUCTURE_AREA_CELLS = 2;
/** Largest body (diameter, world px) a structure source may release into the 64 px pit. */
export const SPAWN_STRUCTURE_MAX_ENEMY_DIAMETER_PX = 56;

const OUTLET_VECTORS: Record<SpawnStructureOutlet, { x: number; y: number }> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

function buildTemplate(outlet: SpawnStructureOutlet): SpawnStructureTemplate {
  const horizontal = outlet === 'east' || outlet === 'west';
  const widthCells = horizontal ? 3 : 4;
  const heightCells = horizontal ? 4 : 3;
  const area: SpawnStructureRect = {
    gridX: outlet === 'west' ? 0 : 1,
    gridY: outlet === 'north' ? 0 : 1,
    widthCells: SPAWN_STRUCTURE_AREA_CELLS,
    heightCells: SPAWN_STRUCTURE_AREA_CELLS,
  };
  const inArea = (x: number, y: number): boolean => x >= area.gridX && x < area.gridX + area.widthCells
    && y >= area.gridY && y < area.gridY + area.heightCells;
  const cells: SpawnStructureCell[] = [];
  for (let y = 0; y < heightCells; y++) {
    for (let x = 0; x < widthCells; x++) {
      if (!inArea(x, y)) cells.push({ gridX: x, gridY: y });
    }
  }
  const mouth: SpawnStructureCell[] = [];
  for (let index = 0; index < SPAWN_STRUCTURE_AREA_CELLS; index++) {
    if (outlet === 'north') mouth.push({ gridX: area.gridX + index, gridY: -1 });
    else if (outlet === 'south') mouth.push({ gridX: area.gridX + index, gridY: heightCells });
    else if (outlet === 'west') mouth.push({ gridX: -1, gridY: area.gridY + index });
    else mouth.push({ gridX: widthCells, gridY: area.gridY + index });
  }
  return { outlet, widthCells, heightCells, cells, area, mouth };
}

const TEMPLATES: Record<SpawnStructureOutlet, SpawnStructureTemplate> = {
  north: buildTemplate('north'),
  east: buildTemplate('east'),
  south: buildTemplate('south'),
  west: buildTemplate('west'),
};

export function getSpawnStructureTemplate(outlet: SpawnStructureOutlet): SpawnStructureTemplate {
  return TEMPLATES[outlet];
}

export function isSpawnStructureOutlet(value: unknown): value is SpawnStructureOutlet {
  return typeof value === 'string' && (SPAWN_STRUCTURE_OUTLETS as readonly string[]).includes(value);
}

export function getSpawnStructureOutletVector(outlet: SpawnStructureOutlet): { readonly x: number; readonly y: number } {
  return OUTLET_VECTORS[outlet];
}

/** Ausrichtung einer authored Zellform, oder `null`, wenn sie keiner Vorlage exakt entspricht. */
export function matchSpawnStructureShape(cells: readonly SpawnStructureCell[]): SpawnStructureOutlet | null {
  const keys = new Set(cells.map((cell) => `${cell.gridX}_${cell.gridY}`));
  if (keys.size !== cells.length) return null;
  for (const outlet of SPAWN_STRUCTURE_OUTLETS) {
    const template = TEMPLATES[outlet];
    if (template.cells.length === keys.size
      && template.cells.every((cell) => keys.has(`${cell.gridX}_${cell.gridY}`))) return outlet;
  }
  return null;
}

export function isSpawnStructureAreaCell(template: SpawnStructureTemplate, cell: SpawnStructureCell): boolean {
  const { area } = template;
  return cell.gridX >= area.gridX && cell.gridX < area.gridX + area.widthCells
    && cell.gridY >= area.gridY && cell.gridY < area.gridY + area.heightCells;
}

/** Authoring form of an U opening toward `outlet`; `spawnCenter` is the area's first cell. */
export function buildSpawnStructureShape(outlet: SpawnStructureOutlet): {
  readonly cells: readonly SpawnStructureCell[];
  readonly spawnCenter: SpawnStructureCell;
} {
  const template = TEMPLATES[outlet];
  return {
    cells: template.cells.map((cell) => ({ ...cell })),
    spawnCenter: { gridX: template.area.gridX, gridY: template.area.gridY },
  };
}

/** Spacing (world px) between enemies that rise in the same tick, across the opening. */
export const SPAWN_STRUCTURE_LANE_SPACING_PX = 14;
/** Lanes stay within the inner half of the 64 px pit. */
const SPAWN_STRUCTURE_MAX_LANE_OFFSET_PX = 16;

/** Deterministic offset across the opening for the `index`-th of `count` enemies of one tick. */
export function resolveSpawnStructureLaneOffset(index: number, count: number): number {
  if (count <= 1) return 0;
  const offset = (index - (count - 1) / 2) * SPAWN_STRUCTURE_LANE_SPACING_PX;
  return Math.max(-SPAWN_STRUCTURE_MAX_LANE_OFFSET_PX, Math.min(SPAWN_STRUCTURE_MAX_LANE_OFFSET_PX, offset));
}

/** Whether an absolute grid cell lies in a resolved brood pit. */
export function isCellInSpawnStructureArea(area: ResolvedSpawnStructureArea, gridX: number, gridY: number): boolean {
  return gridX >= area.minGridX && gridX < area.minGridX + area.widthCells
    && gridY >= area.minGridY && gridY < area.minGridY + area.heightCells;
}

/** The opening faces `toward` along the dominant axis (ties prefer the horizontal axis). */
export function resolveSpawnStructureOutletToward(
  from: { readonly x: number; readonly y: number },
  toward: { readonly x: number; readonly y: number },
): SpawnStructureOutlet {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'east' : 'west';
  return dy >= 0 ? 'south' : 'north';
}
