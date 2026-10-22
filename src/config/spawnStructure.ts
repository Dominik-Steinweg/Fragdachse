/**
 * Canonical spawn structure (GDD Spawnbauwerk V1): a feindlicher Spawnpunkt ist immer der Brutkadaver,
 * das Skelett eines eingerollten Drachen auf 6x6 Zellen. Nur die Knochenzellen sind Basiszellen mit
 * Hitbox; die 2x3-Innenflaeche ist das Brutnest, aus dem die Gegner steigen, und oeffnet sich ueber
 * zwei Zellen zwischen Schwanz und Schaedel zur Seite `outlet`.
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
  /** The body cells (hitbox), relative to the shape origin. */
  readonly cells: readonly SpawnStructureCell[];
  /** The brood nest (walkable, no hitbox), relative to the shape origin. */
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

/** Width of the opening between snout and jaw. */
export const SPAWN_STRUCTURE_AREA_CELLS = 2;
/** Largest body (diameter, world px) a structure source may release through the 64 px opening. */
export const SPAWN_STRUCTURE_MAX_ENEMY_DIAMETER_PX = 56;

/**
 * Body cells of the carcass opening south, traced from the rendered skeleton (bone coverage of at least
 * a tenth of the cell): spine and ribcage across the top, the stretched tail down the left side, neck and
 * skull down the right; the nest and the opening between tail and skull stay free. The outermost limb
 * bones (hind claw, fore leg) reach past this footprint without a hitbox.
 */
const SOUTH_BODY = [
  '.####.',
  '######',
  '##...#',
  '#...##',
  '#...##',
  '....#.',
] as const;
const SOUTH_AREA: SpawnStructureRect = { gridX: 2, gridY: 2, widthCells: 2, heightCells: 3 };
const SOUTH_MOUTH: readonly SpawnStructureCell[] = [{ gridX: 2, gridY: 5 }, { gridX: 3, gridY: 5 }];
/** Quarter turns clockwise from the south-facing template (screen axes, y down). */
const OUTLET_QUARTER_TURNS: Record<SpawnStructureOutlet, number> = { south: 0, west: 1, north: 2, east: 3 };

const OUTLET_VECTORS: Record<SpawnStructureOutlet, { x: number; y: number }> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

function buildTemplate(outlet: SpawnStructureOutlet): SpawnStructureTemplate {
  let widthCells: number = SOUTH_BODY[0].length;
  let heightCells: number = SOUTH_BODY.length;
  let cells: SpawnStructureCell[] = [];
  SOUTH_BODY.forEach((row, gridY) => [...row].forEach((mark, gridX) => { if (mark === '#') cells.push({ gridX, gridY }); }));
  let area = SOUTH_AREA;
  let mouth = [...SOUTH_MOUTH];
  for (let turn = 0; turn < OUTLET_QUARTER_TURNS[outlet]; turn++) {
    // One quarter turn clockwise: (x, y) -> (h - 1 - y, x); the opening moves south -> west -> north -> east.
    const h = heightCells;
    const turnCell = (cell: SpawnStructureCell): SpawnStructureCell => ({ gridX: h - 1 - cell.gridY, gridY: cell.gridX });
    cells = cells.map(turnCell);
    mouth = mouth.map(turnCell);
    area = { gridX: h - area.gridY - area.heightCells, gridY: area.gridX, widthCells: area.heightCells, heightCells: area.widthCells };
    [widthCells, heightCells] = [heightCells, widthCells];
  }
  cells.sort((a, b) => a.gridY - b.gridY || a.gridX - b.gridX);
  return { outlet, widthCells, heightCells, cells, area, mouth };
}

/** Sprite rotation (radians, clockwise on screen) that turns the south-facing art toward `outlet`. */
export function getSpawnStructureRotation(outlet: SpawnStructureOutlet): number {
  return OUTLET_QUARTER_TURNS[outlet] * Math.PI / 2;
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

/** Authoring form of the carcass opening toward `outlet`; `spawnCenter` is the area's first cell. */
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

/**
 * Radius (cells) around the nest centre that the carcass's creep stain covers: no ground cover or grass
 * specks are drawn there, so no plant grows through the bones or the pool.
 */
export const SPAWN_STRUCTURE_VEGETATION_CLEARING_CELLS = 4.6;

/** Bodies of one tick rise one after another from the same pool. */
export const SPAWN_STRUCTURE_RISE_STAGGER_MS = 300;
/** Spacing (world px) between enemies that rise in the same tick, across the opening. */
export const SPAWN_STRUCTURE_LANE_SPACING_PX = 14;
/** Lanes stay within the inner half of the 64 px wide nest. */
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
