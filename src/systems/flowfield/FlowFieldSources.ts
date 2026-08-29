/**
 * Main-Thread-Adapter zwischen authored Arenadaten und dem serialisierbaren Rasterformat des
 * Kernels. Diese Datei gehoert bewusst NICHT in den Worker-Graphen: Sie darf `ArenaLayout` und
 * `BaseSpec` kennen, der Kernel und der Worker duerfen das nicht.
 */
import type { ArenaLayout } from '../../types';
import type { BaseSpec } from '../../arena/BaseRegistry';
import type { ArenaMapGridChangedEvent } from '../../scenes/arena/ArenaEvents';
import {
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
 * Faltet die vier unveraenderlichen Zellquellen in ein Raster. Die Reihenfolge entspricht der
 * Regelprioritaet des bisherigen Build-Kontexts; Basis und Fels stehen strikt darueber und werden
 * deshalb erst zur Laufzeit im Kernel aufgesetzt.
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
