/**
 * Main-Thread-Adapter zwischen authored Arenadaten und dem serialisierbaren Rasterformat des
 * Kernels. Diese Datei gehoert bewusst NICHT in den Worker-Graphen: Sie darf `ArenaLayout` und
 * `BaseSpec` kennen, der Kernel und der Worker duerfen das nicht.
 */
import type { ArenaLayout } from '../../types';
import type { BaseSpec } from '../../arena/BaseRegistry';
import type { ArenaMapGridChangedEvent } from '../../scenes/arena/ArenaEvents';
import type { CoopDefenseMapEnemyTargeting } from '../../config/coopDefenseMapAuthoring';
import {
  CELL_SIZE,
  COOP_DEFENSE_FLOW_FIELD_BASE_COST,
  COOP_DEFENSE_FLOW_FIELD_DIRT_COST,
  COOP_DEFENSE_FLOW_FIELD_GROUND_COST,
  COOP_DEFENSE_FLOW_FIELD_ROCK_COST,
  COOP_DEFENSE_FLOW_FIELD_TRACK_COST,
  COOP_DEFENSE_FLOW_FIELD_TRACK_LONGITUDINAL_COST,
  COOP_DEFENSE_FLOW_FIELD_TRUNK_COST,
  COOP_DEFENSE_FLOW_FIELD_WALL_ADJACENT_COST,
} from '../../config';
import {
  CELL_CODE,
  isInBounds,
  toIndex,
  totalCellsOf,
  type FlowFieldBaseDescriptor,
  type FlowFieldMetrics,
  type FlowFieldTuning,
} from './FlowFieldKernel';

export function createFlowFieldTuning(): FlowFieldTuning {
  return {
    groundCost: COOP_DEFENSE_FLOW_FIELD_GROUND_COST,
    dirtCost: COOP_DEFENSE_FLOW_FIELD_DIRT_COST,
    trackCost: COOP_DEFENSE_FLOW_FIELD_TRACK_COST,
    trackLongitudinalCost: COOP_DEFENSE_FLOW_FIELD_TRACK_LONGITUDINAL_COST,
    rockCost: COOP_DEFENSE_FLOW_FIELD_ROCK_COST,
    trunkCost: COOP_DEFENSE_FLOW_FIELD_TRUNK_COST,
    baseCost: COOP_DEFENSE_FLOW_FIELD_BASE_COST,
    wallAdjacentCost: COOP_DEFENSE_FLOW_FIELD_WALL_ADJACENT_COST,
  };
}

/**
 * Faltet die unveraenderlichen Zellquellen in ein Raster. Wasser bleibt im Kernel auch gegen
 * dynamische Belegungs-Patches unpassierbar; Basis und Fels ueberlagern nur die anderen Bodenarten.
 */
export function buildStaticKindRaster(layout: ArenaLayout, metrics: FlowFieldMetrics): Uint8Array {
  const staticKind = new Uint8Array(totalCellsOf(metrics)).fill(CELL_CODE.ground);

  const stamp = (cells: ReadonlyArray<{ gridX: number; gridY: number }>, code: number): void => {
    for (const cell of cells) {
      if (!isInBounds(metrics, cell.gridX, cell.gridY)) continue;
      const index = toIndex(metrics, cell.gridX, cell.gridY);
      // Niedrigere Prioritaet darf eine bereits gesetzte hoehere nicht ueberschreiben.
      if (staticKind[index] !== CELL_CODE.ground) continue;
      staticKind[index] = code;
    }
  };

  stamp(layout.water ?? [], CELL_CODE.water);
  stamp(layout.trees, CELL_CODE.trunk);
  stampTracks(staticKind, layout.tracks, metrics);
  stamp(layout.powerUpPedestals, CELL_CODE.pedestal);
  stamp(layout.dirt, CELL_CODE.dirt);

  return staticKind;
}

/** Ein Gleiseintrag belegt zwei Zellen nebeneinander - die Schiene ist zwei Zellen breit. */
function stampTracks(
  staticKind: Uint8Array,
  tracks: ArenaLayout['tracks'],
  metrics: FlowFieldMetrics,
): void {
  for (const track of tracks) {
    for (const gridX of [track.gridX, track.gridX + 1]) {
      if (!isInBounds(metrics, gridX, track.gridY)) continue;
      const index = toIndex(metrics, gridX, track.gridY);
      if (staticKind[index] !== CELL_CODE.ground) continue;
      staticKind[index] = CELL_CODE.track;
    }
  }
}

/**
 * Uebersetzt ein Grid-Event in eine Topologieaenderung. Ein Ereignis mit Koordinate schaltet genau
 * eine Rasterzelle; ohne Koordinate bleibt nur der vollstaendige Resync ueber den Hindernis-Provider.
 */
export function resolveGridChange(
  event: ArenaMapGridChangedEvent,
): { readonly gridX: number; readonly gridY: number; readonly occupied: boolean } | null {
  if (event.gridX === undefined || event.gridY === undefined) return null;
  return {
    gridX: event.gridX,
    gridY: event.gridY,
    occupied: event.reason === 'placeable_added'
      && event.source !== 'placeable_pedestal'
      && event.collisionMode !== 'none',
  };
}

/**
 * Wandelt Zielzellen in Rasterindizes. Zellen ausserhalb des Rasters fallen hier heraus und nicht
 * erst im Kernel: Ein zu grosses `gridX` wuerde sonst in die naechste Zeile ueberlaufen und dort
 * eine falsche, aber gueltige Zielzelle erzeugen.
 */
export function goalCellsToIndexes(
  cells: ReadonlyArray<{ gridX: number; gridY: number }>,
  metrics: FlowFieldMetrics,
): Int32Array {
  const indexes: number[] = [];
  for (const cell of cells) {
    if (!isInBounds(metrics, cell.gridX, cell.gridY)) continue;
    indexes.push(toIndex(metrics, cell.gridX, cell.gridY));
  }
  return Int32Array.from(indexes);
}

export function buildOccupancyRaster(
  cells: ReadonlyArray<{ gridX: number; gridY: number }>,
  metrics: FlowFieldMetrics,
  target: Uint8Array = new Uint8Array(totalCellsOf(metrics)),
): Uint8Array {
  target.fill(0);
  for (const cell of cells) {
    if (!isInBounds(metrics, cell.gridX, cell.gridY)) continue;
    target[toIndex(metrics, cell.gridX, cell.gridY)] = 1;
  }
  return target;
}

/**
 * Uebersetzt `BaseSpec` in die serialisierbare Beschreibung. Die drei Zielfilter sind authored und
 * zur Laufzeit unveraenderlich, koennen also einmalig zu `isGoalSource` verdichtet werden;
 * Aktivierung und Zerstoerung laufen ausschliesslich ueber die aktive Basis-ID-Menge.
 */
export function buildBaseDescriptors(baseSpecs: readonly BaseSpec[]): FlowFieldBaseDescriptor[] {
  return baseSpecs.map((spec) => {
    const cellCoords = new Int32Array(spec.cells.length * 2);
    for (let cursor = 0; cursor < spec.cells.length; cursor += 1) {
      cellCoords[cursor * 2] = spec.cells[cursor].gridX;
      cellCoords[cursor * 2 + 1] = spec.cells[cursor].gridY;
    }
    return {
      id: spec.id,
      cellCoords,
      isGoalSource: isBaseGoalSource(spec),
    };
  });
}

/**
 * Wendet die map-weite Gegner-Zielpolitik an. `players` nimmt jeder Basis die Zielrolle: Ohne
 * Basisziel fallen Belagerer auf die Spielerjagd zurueck, Basis-Praeferenzen finden nichts und
 * Basen bleiben nur noch Hindernis. Ohne Politik bleiben die Deskriptoren unveraendert.
 */
export function applyEnemyTargetingToBaseDescriptors(
  bases: FlowFieldBaseDescriptor[],
  enemyTargeting: CoopDefenseMapEnemyTargeting | undefined,
): FlowFieldBaseDescriptor[] {
  return enemyTargeting === 'players' ? bases.map(base => ({ ...base, isGoalSource: false })) : bases;
}

/**
 * Raster, terrain costs and base goals of a coop mission's navigation, from its World data.
 *
 * The mission and the base editor's situation map build their flow fields from this one function,
 * so a previewed route uses the same raster and the same goals as the enemies of the round. With
 * exact geometry the raster is the 2c+1 node grid at 16 px; terrain costs and base cells are
 * mapped onto it.
 */
export function resolveCoopMissionFlowFieldInputs(input: {
  readonly worldMetrics: { readonly gridCols: number; readonly gridRows: number; readonly offsetX: number; readonly offsetY: number };
  readonly layout: ArenaLayout;
  readonly baseSpecs: readonly BaseSpec[];
  readonly enemyTargeting: CoopDefenseMapEnemyTargeting | undefined;
  readonly exact: boolean;
}): { readonly metrics: FlowFieldMetrics; readonly staticKind: Uint8Array; readonly bases: FlowFieldBaseDescriptor[] } {
  const worldGridMetrics: FlowFieldMetrics = {
    cols: input.worldMetrics.gridCols,
    rows: input.worldMetrics.gridRows,
    cellSize: CELL_SIZE,
    arenaOffsetX: input.worldMetrics.offsetX,
    arenaOffsetY: input.worldMetrics.offsetY,
  };
  const metrics: FlowFieldMetrics = input.exact ? { ...worldGridMetrics,
    cols: worldGridMetrics.cols * 2 + 1, rows: worldGridMetrics.rows * 2 + 1,
    cellSize: 16, pointOffset: 0 } : worldGridMetrics;
  const worldTerrain = buildStaticKindRaster(input.layout, worldGridMetrics);
  const staticKind = input.exact ? new Uint8Array(metrics.cols * metrics.rows) : worldTerrain;
  if (input.exact) for (let y = 0; y < metrics.rows; y++) for (let x = 0; x < metrics.cols; x++) {
    staticKind[y * metrics.cols + x] = worldTerrain[Math.min(worldGridMetrics.rows - 1, Math.floor(y / 2))
      * worldGridMetrics.cols + Math.min(worldGridMetrics.cols - 1, Math.floor(x / 2))];
  }
  const bases = applyEnemyTargetingToBaseDescriptors(buildBaseDescriptors(input.baseSpecs), input.enemyTargeting)
    .map(base => input.exact ? { ...base, cellCoords: base.cellCoords.map(coordinate => coordinate * 2 + 1) } : base);
  return { metrics, staticKind, bases };
}

function isBaseGoalSource(spec: BaseSpec): boolean {
  if (spec.faction === 'hostile' || spec.role === 'spawn-point') return false;
  // Ein objective-gebundener Vorposten (Hold-Missionsziel) ist ein vollwertiges Belagerungsziel.
  // Dekorative Vorposten ohne Objective bleiben ausgenommen, damit sie den Zug der Angriffswellen
  // auf die Hauptbasis nicht verwaessern.
  if (spec.role === 'outpost' && spec.dormantObjectiveId === undefined) return false;
  return true;
}

/** Fuellt das Basis-Belegungsraster aus den aktiven Basen; ausserhalb liegende Zellen entfallen. */
export function buildBaseOccupancy(
  bases: readonly FlowFieldBaseDescriptor[],
  activeBaseIds: ReadonlySet<string>,
  metrics: FlowFieldMetrics,
  target: Uint8Array = new Uint8Array(totalCellsOf(metrics)),
): Uint8Array {
  target.fill(0);
  for (const base of bases) {
    if (!activeBaseIds.has(base.id)) continue;
    for (let cursor = 0; cursor < base.cellCoords.length; cursor += 2) {
      const gridX = base.cellCoords[cursor];
      const gridY = base.cellCoords[cursor + 1];
      if (!isInBounds(metrics, gridX, gridY)) continue;
      target[toIndex(metrics, gridX, gridY)] = 1;
    }
  }
  return target;
}
