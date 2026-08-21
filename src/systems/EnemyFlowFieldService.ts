/**
 * Synchrone Lesefassade eines Flowfields.
 *
 * Die Berechnung liegt seit dem Worker-Umbau im {@link FlowFieldCoordinator} und im Web Worker.
 * Diese Klasse haelt keinen eigenen Feldzustand mehr; sie liest den aktiven Snapshot und den
 * Topologiespiegel ueber ein {@link FlowFieldFieldView}. Name und Signatur bleiben erhalten, damit
 * Gegner-, Physik- und Combat-Logik unveraendert weiterlesen.
 *
 * Zwei Betriebsarten:
 * - **Verdrahtet**: `fromView(...)`. Der Coordinator besitzt Takt und Aktivierung.
 * - **Selbstfahrend**: der bisherige Konstruktor `(layout, baseSpecs, metrics, options)`. Die
 *   Fassade baut sich einen eigenen Coordinator mit Inline-Runner und rechnet synchron. Das ist der
 *   Pfad fuer Tests und fuer Umgebungen ohne Worker.
 */
import type { ArenaLayout } from '../types';
import type { BaseSpec } from '../arena/BaseRegistry';
import { COOP_DEFENSE_FLOW_FIELD_REBUILD_INTERVAL_MS } from '../config';
import {
  ARENA_MAP_GRID_CHANGED_EVENT,
  type ArenaEventBus,
  type ArenaMapGridChangedEvent,
} from '../scenes/arena/ArenaEvents';
import {
  CELL_KINDS_BY_CODE,
  INTEGRATION_INFINITY,
  NEIGHBOR_DIRECTIONS,
  NEIGHBOR_MOVE_FACTORS,
  FlowFieldMinHeap,
  getTransitionCost,
  isReachableNeighborIndex,
  type FlowFieldCellKind,
} from './flowfield/FlowFieldKernel';
import {
  FlowFieldCoordinator,
  type FlowFieldFieldView,
} from './flowfield/FlowFieldCoordinator';
import { InlineFlowFieldRunner } from './flowfield/FlowFieldRunner';
import {
  buildBaseDescriptors,
  buildStaticKindRaster,
  createFlowFieldTuning,
  goalCellsToIndexes,
  resolveGridChange,
} from './flowfield/FlowFieldSources';

export interface EnemyFlowFieldMetrics {
  readonly cols: number;
  readonly rows: number;
  readonly cellSize: number;
  readonly arenaOffsetX: number;
  readonly arenaOffsetY: number;
}

export interface EnemyFlowFieldGridCell {
  readonly gridX: number;
  readonly gridY: number;
}

export type EnemyFlowFieldGoalCell = EnemyFlowFieldGridCell;
export type EnemyFlowFieldGoalMode = 'bases' | 'dynamic' | 'dynamic-fallback-bases';
export type EnemyFlowFieldCellKind = FlowFieldCellKind;

export interface EnemyFlowFieldSummary {
  readonly cols: number;
  readonly rows: number;
  readonly totalCells: number;
  readonly traversableCells: number;
  readonly blockedCells: number;
  readonly goalCells: number;
  readonly countsByKind: Readonly<Record<EnemyFlowFieldCellKind, number>>;
}

export interface EnemyFlowFieldVector {
  readonly x: number;
  readonly y: number;
}

export interface EnemyFlowFieldServiceOptions {
  readonly eventBus?: ArenaEventBus;
  /** Wird nur beim Initial-/Full-Rebuild gelesen; koordinierte Zell-Events aktualisieren das Raster direkt. */
  readonly obstacleCellProvider?: () => ReadonlyArray<EnemyFlowFieldGridCell>;
  readonly goalMode?: EnemyFlowFieldGoalMode;
  readonly dynamicGoalCells?: ReadonlyArray<EnemyFlowFieldGoalCell>;
  /** Number of whole cells kept clear around an enemy's center. */
  readonly clearanceCells?: number;
}

/** Begrenzter Sonderbewegungs-Check fuer einen Kreis entlang eines kurzen Weltsegments. */
export type EnemyCirclePathResolver = (
  fromWorldX: number,
  fromWorldY: number,
  toWorldX: number,
  toWorldY: number,
  radius: number,
) => boolean;

const MAX_SAFE_POSITION_SEARCH_RADIUS_CELLS = 4;
const SELF_DRIVEN_FIELD_ID = 'self';
const ZERO_VECTOR: EnemyFlowFieldVector = { x: 0, y: 0 };

/** Zustand des selbstfahrenden Modus; im verdrahteten Betrieb `null`. */
interface SelfDrivenState {
  readonly coordinator: FlowFieldCoordinator;
  readonly layout: ArenaLayout;
  readonly baseSpecs: readonly BaseSpec[];
  readonly eventBus: ArenaEventBus | null;
  rawGoalCells: ReadonlyArray<EnemyFlowFieldGoalCell>;
  lastDirtyCheckAt: number;
}

export class EnemyFlowFieldService {
  static readonly INTEGRATION_INFINITY = INTEGRATION_INFINITY;
  static readonly NEIGHBOR_DIRECTIONS = NEIGHBOR_DIRECTIONS;

  private readonly view: FlowFieldFieldView;
  private readonly self: SelfDrivenState | null;
  private readonly pathHeap = new FlowFieldMinHeap();
  private debugOverlayCallback: ((renderer: EnemyFlowFieldDebugRenderer) => void) | null = null;
  private unsubscribeActivation: (() => void) | null = null;
  private goalCellsSource: Int32Array | null = null;
  private goalCellsCache: readonly EnemyFlowFieldGoalCell[] = [];

  /** Verdrahteter Betrieb: der Coordinator besitzt Takt, Aktivierung und Lebenszyklus. */
  static fromView(view: FlowFieldFieldView): EnemyFlowFieldService {
    return new EnemyFlowFieldService(view);
  }

  constructor(view: FlowFieldFieldView);
  constructor(
    layout: ArenaLayout,
    baseSpecs: readonly BaseSpec[],
    metrics: EnemyFlowFieldMetrics,
    options?: EnemyFlowFieldServiceOptions,
  );
  constructor(
    layoutOrView: ArenaLayout | FlowFieldFieldView,
    baseSpecs?: readonly BaseSpec[],
    metrics?: EnemyFlowFieldMetrics,
    options: EnemyFlowFieldServiceOptions = {},
  ) {
    if (baseSpecs === undefined || metrics === undefined) {
      this.view = layoutOrView as FlowFieldFieldView;
      this.self = null;
      this.unsubscribeActivation = this.view.onActivated(() => this.notifyDebugOverlay());
      return;
    }

    const layout = layoutOrView as ArenaLayout;
    const obstacleCellProvider = options.obstacleCellProvider ?? (() => layout.rocks);
    const bases = buildBaseDescriptors(baseSpecs);
    const coordinator = new FlowFieldCoordinator({
      metrics,
      tuning: createFlowFieldTuning(),
      staticKind: buildStaticKindRaster(layout, metrics),
      bases,
      activeBaseIds: new Set(baseSpecs.map((spec) => spec.id)),
      obstacleCellProvider,
      runner: new InlineFlowFieldRunner(true),
      navTickIntervalMs: COOP_DEFENSE_FLOW_FIELD_REBUILD_INTERVAL_MS,
    });
    this.view = coordinator.registerField(SELF_DRIVEN_FIELD_ID, {
      goalMode: options.goalMode ?? 'bases',
      clearanceCells: options.clearanceCells,
    });
    this.self = {
      coordinator,
      layout,
      baseSpecs: [...baseSpecs],
      eventBus: options.eventBus ?? null,
      rawGoalCells: options.dynamicGoalCells ? [...options.dynamicGoalCells] : [],
      lastDirtyCheckAt: Date.now(),
    };
    this.view.setGoals(goalCellsToIndexes(this.self.rawGoalCells, metrics));
    coordinator.runSynchronously(true);
    this.view.onActivated(() => this.notifyDebugOverlay());
    this.self.eventBus?.on(ARENA_MAP_GRID_CHANGED_EVENT, this.handleArenaMapGridChanged, this);
  }

  // ---- Rastermasse ----

  getCols(): number { return this.view.metrics.cols; }

  getRows(): number { return this.view.metrics.rows; }

  getCellSize(): number { return this.view.metrics.cellSize; }

  getLayout(): ArenaLayout {
    if (!this.self) throw new Error('getLayout is only available on a self-driven flow field');
    return this.self.layout;
  }

  getBaseRegions(): readonly BaseSpec[] {
    return this.self?.baseSpecs ?? [];
  }

  getSummary(): EnemyFlowFieldSummary {
    const counts = this.view.counts();
    const metrics = this.view.metrics;
    return {
      cols: metrics.cols,
      rows: metrics.rows,
      totalCells: metrics.cols * metrics.rows,
      traversableCells: counts.traversableCells,
      blockedCells: counts.blockedCells,
      goalCells: this.view.snapshot()?.goalIndexes.length ?? 0,
      countsByKind: counts.countsByKind,
    };
  }

  worldToGrid(worldX: number, worldY: number): EnemyFlowFieldGridCell | null {
    const metrics = this.view.metrics;
    const gridX = Math.floor((worldX - metrics.arenaOffsetX) / metrics.cellSize);
    const gridY = Math.floor((worldY - metrics.arenaOffsetY) / metrics.cellSize);
    if (!this.isInBounds(gridX, gridY)) return null;
    return { gridX, gridY };
  }

  gridToWorld(gridX: number, gridY: number): { x: number; y: number } | null {
    if (!this.isInBounds(gridX, gridY)) return null;
    const metrics = this.view.metrics;
    return {
      x: metrics.arenaOffsetX + gridX * metrics.cellSize + metrics.cellSize * 0.5,
      y: metrics.arenaOffsetY + gridY * metrics.cellSize + metrics.cellSize * 0.5,
    };
  }

  // ---- Topologie ----

  getCostAt(gridX: number, gridY: number): number {
    if (!this.isInBounds(gridX, gridY)) return this.view.tuning.trunkCost;
    return this.view.topology().costs[this.toIndex(gridX, gridY)];
  }

  getKindAt(gridX: number, gridY: number): EnemyFlowFieldCellKind {
    if (!this.isInBounds(gridX, gridY)) return 'outOfBounds';
    return CELL_KINDS_BY_CODE[this.view.topology().kindCodes[this.toIndex(gridX, gridY)]];
  }

  isTraversableAt(gridX: number, gridY: number): boolean {
    if (!this.isInBounds(gridX, gridY)) return false;
    return this.view.topology().traversable[this.toIndex(gridX, gridY)] === 1;
  }

  isDestructibleAt(gridX: number, gridY: number): boolean {
    if (!this.isInBounds(gridX, gridY)) return false;
    return this.view.topology().destructible[this.toIndex(gridX, gridY)] === 1;
  }

  /**
   * True, wenn die Zelle an ein unzerstoerbares Hindernis grenzt (Basis oder Baumstumpf).
   * Verbraucher schalten dort auf Wegpunkt-Steuerung um, statt dem groben Zellvektor zu folgen.
   */
  isWallAdjacentAt(gridX: number, gridY: number): boolean {
    if (!this.isInBounds(gridX, gridY)) return false;
    return this.view.topology().wallAdjacent[this.toIndex(gridX, gridY)] === 1;
  }

  // ---- Feldwerte ----

  /**
   * Der Snapshot fuehrt Zielzellen als Indizes. Die Zellform wird je Aktivierung genau einmal
   * abgeleitet - der Spawn-Executor fragt sie je Spawnversuch ab und soll dabei nichts allokieren.
   */
  getGoalCells(): readonly EnemyFlowFieldGoalCell[] {
    const snapshot = this.view.snapshot();
    if (!snapshot) return [];
    if (this.goalCellsSource === snapshot.goalIndexes) return this.goalCellsCache;
    const cols = this.view.metrics.cols;
    const cells: EnemyFlowFieldGoalCell[] = [];
    for (let cursor = 0; cursor < snapshot.goalIndexes.length; cursor += 1) {
      const index = snapshot.goalIndexes[cursor];
      cells.push({ gridX: index % cols, gridY: Math.floor(index / cols) });
    }
    this.goalCellsSource = snapshot.goalIndexes;
    this.goalCellsCache = cells;
    return cells;
  }

  isGoalCell(gridX: number, gridY: number): boolean {
    const snapshot = this.view.snapshot();
    if (!snapshot || !this.isInBounds(gridX, gridY)) return false;
    return containsIndex(snapshot.goalIndexes, this.toIndex(gridX, gridY));
  }

  getIntegrationValueAt(gridX: number, gridY: number): number {
    if (!this.isInBounds(gridX, gridY)) return INTEGRATION_INFINITY;
    const snapshot = this.view.snapshot();
    if (!snapshot) return INTEGRATION_INFINITY;
    const index = this.toIndex(gridX, gridY);
    // Entfallene Basisziele gelten sofort als unerreichbar. Ohne diese Sperre bliebe ein Gegner
    // auf der Zielzelle einer zerstoerten Basis stehen, weil sein Integrationswert dort 0 ist.
    if (this.view.isGoalSuppressed(index)) return INTEGRATION_INFINITY;
    return snapshot.integrationField[index];
  }

  /** Liefert die konkrete Mehrziel-Quelle hinter dem Flow-Vektor an dieser Zelle. */
  getReachedGoalCellAt(gridX: number, gridY: number): EnemyFlowFieldGoalCell | null {
    if (!this.isInBounds(gridX, gridY)) return null;
    const snapshot = this.view.snapshot();
    if (!snapshot) return null;
    const sourceIndex = snapshot.goalSourceField[this.toIndex(gridX, gridY)];
    if (sourceIndex < 0) return null;
    const cols = this.view.metrics.cols;
    return { gridX: sourceIndex % cols, gridY: Math.floor(sourceIndex / cols) };
  }

  getVectorAt(gridX: number, gridY: number): EnemyFlowFieldVector {
    if (!this.isInBounds(gridX, gridY)) return ZERO_VECTOR;
    const snapshot = this.view.snapshot();
    if (!snapshot) return ZERO_VECTOR;
    const vIndex = this.toIndex(gridX, gridY) * 2;
    return { x: snapshot.vectorField[vIndex], y: snapshot.vectorField[vIndex + 1] };
  }

  /**
   * Liefert den Mittelpunkt der naechsten Flow-Field-Zelle. Groessere Gegner steuern damit gezielt
   * durch den sicheren Korridor, statt eine grobe Zellrichtung beizubehalten, wenn sie innerhalb
   * der Zelle versetzt sind.
   */
  getNextCellWorldPosition(gridX: number, gridY: number): { x: number; y: number } | null {
    const vector = this.getVectorAt(gridX, gridY);
    const stepX = Math.sign(vector.x);
    const stepY = Math.sign(vector.y);
    if (stepX === 0 && stepY === 0) return null;
    return this.gridToWorld(gridX + stepX, gridY + stepY);
  }

  /**
   * Visits only currently traversable neighbors of a cell. The diagonal corner-cutting rules are
   * identical to the rules used while building the flowfield; consumers may use this read-only
   * API for local steering without adding another topology or field pass.
   */
  forEachReachableNeighbor(
    gridX: number,
    gridY: number,
    visitor: (neighborGridX: number, neighborGridY: number, directionIndex: number) => void,
  ): void {
    if (!this.isInBounds(gridX, gridY)) return;
    const topology = this.view.topology();
    const lookups = this.view.lookups;
    const cols = this.view.metrics.cols;
    const currentIndex = this.toIndex(gridX, gridY);
    const base = currentIndex * 8;
    for (let direction = 0; direction < NEIGHBOR_DIRECTIONS.length; direction += 1) {
      if (!isReachableNeighborIndex(topology, lookups, currentIndex, direction)) continue;
      const neighborIndex = lookups.neighborIndices[base + direction];
      visitor(neighborIndex % cols, Math.floor(neighborIndex / cols), direction);
    }
  }

  // ---- Geometrische Praedikate ----

  /**
   * Prueft, ob die Luftlinie zwischen zwei Weltpunkten ausschliesslich ueber begehbare Zellen
   * laeuft. Direkte Steuerung auf ein nahes Ziel darf nur so freigegeben werden - sonst laeuft eine
   * Einheit die letzten Meter stur in eine Basiswand und bleibt dort stehen.
   */
  hasWalkableLine(fromWorldX: number, fromWorldY: number, toWorldX: number, toWorldY: number): boolean {
    const deltaX = toWorldX - fromWorldX;
    const deltaY = toWorldY - fromWorldY;
    const distance = Math.hypot(deltaX, deltaY);
    // Halbe Zellgroesse als Schrittweite: feiner als jede Zelle, damit kein Hindernis uebersprungen wird.
    const steps = Math.max(1, Math.ceil(distance / (this.view.metrics.cellSize * 0.5)));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const cell = this.worldToGrid(fromWorldX + deltaX * t, fromWorldY + deltaY * t);
      if (!cell || !this.isFlowPassableAt(cell.gridX, cell.gridY)) return false;
    }
    return true;
  }

  /** Prueft Mittelpunkt plus vier kardinale und vier diagonale Randpunkte eines Kreiskoerpers. */
  isCircleGroundFreeAt(worldX: number, worldY: number, radius: number): boolean {
    return this.isCircleClearAt(worldX, worldY, radius, false);
  }

  /** Prueft Kreisfreiheit und ob alle Randproben im aktuellen Flowfield erreichbar sind. */
  isCircleFlowReachableAt(worldX: number, worldY: number, radius: number): boolean {
    return this.isCircleClearAt(worldX, worldY, radius, true);
  }

  /** Semantischer Alias fuer Sonderfaelle wie Auftauchen: frei und vom Flowfield erreichbar. */
  isCirclePositionFreeAt(worldX: number, worldY: number, radius: number): boolean {
    return this.isCircleFlowReachableAt(worldX, worldY, radius);
  }

  /**
   * Prueft einen kurzen Kreis-Korridor. Die Abtastung bleibt auf maximal einer halben Rasterzelle
   * und wird nur von Sonderbewegungen verwendet, nicht von der normalen Flowfield-Steuerung.
   */
  hasWalkableCircleLine(
    fromWorldX: number,
    fromWorldY: number,
    toWorldX: number,
    toWorldY: number,
    radius: number,
    requireReachable = false,
  ): boolean {
    if (
      !Number.isFinite(fromWorldX)
      || !Number.isFinite(fromWorldY)
      || !Number.isFinite(toWorldX)
      || !Number.isFinite(toWorldY)
      || !Number.isFinite(radius)
      || radius < 0
    ) return false;
    const deltaX = toWorldX - fromWorldX;
    const deltaY = toWorldY - fromWorldY;
    const distance = Math.hypot(deltaX, deltaY);
    const steps = Math.max(1, Math.ceil(distance / (this.view.metrics.cellSize * 0.5)));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const sampleX = fromWorldX + deltaX * t;
      const sampleY = fromWorldY + deltaY * t;
      const clear = requireReachable
        ? this.isCircleFlowReachableAt(sampleX, sampleY, radius)
        : this.isCircleGroundFreeAt(sampleX, sampleY, radius);
      if (!clear) return false;
    }
    return true;
  }

  /**
   * Sucht von einer ungueltigen/abgedraengten Zelle aus den naechsten erreichbaren Korridorpunkt.
   * Das ist insbesondere nach Rueckstoss oder Kollisionsaufloesung wichtig: Ohne Recovery bleibt ein
   * grosser Gegner in einer durch den Clearance-Mask gesperrten Randzelle dauerhaft stehen.
   */
  findNearestReachableWorldPosition(
    gridX: number,
    gridY: number,
    maxRadiusCells = 3,
  ): { x: number; y: number } | null {
    const radius = Math.max(1, Math.floor(maxRadiusCells));
    let best: { x: number; y: number; distanceSq: number; integration: number } | null = null;

    for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        const candidateX = gridX + offsetX;
        const candidateY = gridY + offsetY;
        if (!this.isFlowPassableAt(candidateX, candidateY)) continue;

        const integration = this.getIntegrationValueAt(candidateX, candidateY);
        if (integration >= INTEGRATION_INFINITY) continue;

        const distanceSq = offsetX * offsetX + offsetY * offsetY;
        if (
          best
          && (distanceSq > best.distanceSq
            || (distanceSq === best.distanceSq && integration >= best.integration))
        ) {
          continue;
        }

        const world = this.gridToWorld(candidateX, candidateY);
        if (!world) continue;
        best = { ...world, distanceSq, integration };
      }
    }

    return best ? { x: best.x, y: best.y } : null;
  }

  /** Sucht innerhalb eines festen Zellradius einen koerperlich freien, erreichbaren Mittelpunkt. */
  findNearestSafeWorldPosition(
    worldX: number,
    worldY: number,
    radius: number,
    maxRadiusCells = 4,
  ): { x: number; y: number } | null {
    const origin = this.worldToGrid(worldX, worldY);
    if (!origin || !Number.isFinite(radius) || radius < 0) return null;
    if (this.isCirclePositionFreeAt(worldX, worldY, radius)) return { x: worldX, y: worldY };

    const searchRadius = Math.min(
      MAX_SAFE_POSITION_SEARCH_RADIUS_CELLS,
      Math.max(1, Math.floor(maxRadiusCells)),
    );
    let best: { x: number; y: number; distanceSq: number; integration: number } | null = null;
    for (let offsetY = -searchRadius; offsetY <= searchRadius; offsetY += 1) {
      for (let offsetX = -searchRadius; offsetX <= searchRadius; offsetX += 1) {
        const candidateX = origin.gridX + offsetX;
        const candidateY = origin.gridY + offsetY;
        const world = this.gridToWorld(candidateX, candidateY);
        if (!world || !this.isCirclePositionFreeAt(world.x, world.y, radius)) continue;

        const distanceSq = offsetX * offsetX + offsetY * offsetY;
        const integration = this.getIntegrationValueAt(candidateX, candidateY);
        if (
          best
          && (distanceSq > best.distanceSq
            || (distanceSq === best.distanceSq && integration >= best.integration))
        ) {
          continue;
        }
        best = { x: world.x, y: world.y, distanceSq, integration };
      }
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  /**
   * Zielgebundener Einzelpfad auf demselben Kostenraster. Er erzeugt kein weiteres Flow Field und
   * wird nur fuer seltene feste Jagdzustaende verwendet; normale Gegner bleiben im Mehrzielfeld.
   */
  findNextWorldPositionTowards(
    fromGridX: number,
    fromGridY: number,
    targetGridX: number,
    targetGridY: number,
  ): { x: number; y: number } | null {
    if (!this.isFlowPassableAt(fromGridX, fromGridY)) return null;
    const target = this.findNearestPassableCell(targetGridX, targetGridY, 3);
    if (!target) return null;
    const cols = this.view.metrics.cols;
    const startIndex = this.toIndex(fromGridX, fromGridY);
    const targetIndex = this.toIndex(target.gridX, target.gridY);
    if (startIndex === targetIndex) return this.gridToWorld(target.gridX, target.gridY);

    const topology = this.view.topology();
    const lookups = this.view.lookups;
    const tuning = this.view.tuning;
    const workspace = this.view.workspace();
    const open = this.pathHeap;
    const generation = this.beginTargetPathSearch(workspace, startIndex);

    while (open.size > 0) {
      open.pop();
      const currentIndex = open.poppedIndex;
      const currentCost = workspace.costs[currentIndex];
      const currentX = currentIndex % cols;
      const currentY = Math.floor(currentIndex / cols);
      const currentScore = currentCost + Math.hypot(target.gridX - currentX, target.gridY - currentY);
      // Der Heap erlaubt bewusst doppelte Eintraege: veraltete Prioritaeten werden hier billig
      // verworfen, statt das Open Set linear nach dem Zellindex zu durchsuchen.
      if (open.poppedPriority > currentScore) continue;
      if (currentIndex === targetIndex) break;

      const neighborBase = currentIndex * 8;
      for (let direction = 0; direction < 8; direction += 1) {
        if (!isReachableNeighborIndex(topology, lookups, currentIndex, direction)) continue;
        const nextIndex = lookups.neighborIndices[neighborBase + direction];
        const previousCost = workspace.generation[nextIndex] === generation
          ? workspace.costs[nextIndex]
          : INTEGRATION_INFINITY;
        const candidate = currentCost
          + getTransitionCost(topology, tuning, currentIndex, nextIndex, direction)
          * NEIGHBOR_MOVE_FACTORS[direction];
        if (candidate >= previousCost) continue;
        workspace.generation[nextIndex] = generation;
        workspace.costs[nextIndex] = candidate;
        workspace.parents[nextIndex] = currentIndex;
        const nextX = nextIndex % cols;
        const nextY = Math.floor(nextIndex / cols);
        open.push(
          nextIndex,
          candidate + Math.hypot(target.gridX - nextX, target.gridY - nextY),
          workspace.sequence++,
        );
      }
    }

    if (workspace.generation[targetIndex] !== generation || workspace.parents[targetIndex] < 0) {
      open.clear();
      return null;
    }
    let stepIndex = targetIndex;
    while (workspace.parents[stepIndex] >= 0 && workspace.parents[stepIndex] !== startIndex) {
      stepIndex = workspace.parents[stepIndex];
    }
    open.clear();
    return this.gridToWorld(stepIndex % cols, Math.floor(stepIndex / cols));
  }

  // ---- Selbstfahrender Modus ----

  /**
   * Aktualisiert die Liste der aktiven (= noch nicht zerstoerten) Basen. Im verdrahteten Betrieb
   * uebernimmt das der Coordinator; hier bleibt der Aufruf fuer den selbstfahrenden Modus.
   */
  setActiveBaseIds(ids: ReadonlySet<string>): void {
    if (!this.self) return;
    this.self.coordinator.setActiveBaseIds(ids);
    this.self.coordinator.runSynchronously(false);
  }

  /**
   * Setzt die dynamische Zielmenge. In beiden Betriebsarten identisch: Der Coordinator uebernimmt
   * sie, gerechnet wird erst am naechsten Nav-Tick bzw. beim naechsten synchronen Lauf.
   */
  setDynamicGoalCells(cells: ReadonlyArray<EnemyFlowFieldGoalCell>): void {
    this.view.setGoals(goalCellsToIndexes(cells, this.view.metrics));
  }

  update(now: number): boolean {
    if (!this.self) return false;
    if (now - this.self.lastDirtyCheckAt < COOP_DEFENSE_FLOW_FIELD_REBUILD_INTERVAL_MS) return false;
    this.self.lastDirtyCheckAt = now;
    return this.self.coordinator.runSynchronously(false);
  }

  /**
   * Erzwingt die einmalige Vorbereitung des aktuellen Zielzustands waehrend des verborgenen
   * Arena-Aufbaus. Anders als update() ignoriert dieser Pfad bewusst den Runtime-Throttle.
   */
  prepareNow(now: number): boolean {
    if (!this.self) return false;
    this.self.lastDirtyCheckAt = now;
    return this.self.coordinator.runSynchronously(false);
  }

  destroy(): void {
    this.debugOverlayCallback = null;
    this.unsubscribeActivation?.();
    this.unsubscribeActivation = null;
    if (!this.self) return;
    this.self.eventBus?.off(ARENA_MAP_GRID_CHANGED_EVENT, this.handleArenaMapGridChanged, this);
    this.self.coordinator.destroy();
  }

  registerDebugOverlayCallback(
    callback: ((renderer: EnemyFlowFieldDebugRenderer) => void) | null,
  ): void {
    this.debugOverlayCallback = callback;
    if (callback) callback(new EnemyFlowFieldDebugRendererImpl(this));
  }

  // ---- Intern ----

  private notifyDebugOverlay(): void {
    if (this.debugOverlayCallback) this.debugOverlayCallback(new EnemyFlowFieldDebugRendererImpl(this));
  }

  private handleArenaMapGridChanged(event: ArenaMapGridChangedEvent): void {
    if (!this.self) return;
    const change = resolveGridChange(event);
    if (change) this.self.coordinator.patchCell(change.gridX, change.gridY, change.occupied);
    else this.self.coordinator.requestFullResync();
  }

  private isInBounds(gridX: number, gridY: number): boolean {
    const metrics = this.view.metrics;
    return gridX >= 0 && gridX < metrics.cols && gridY >= 0 && gridY < metrics.rows;
  }

  private toIndex(gridX: number, gridY: number): number {
    return gridY * this.view.metrics.cols + gridX;
  }

  private isFlowPassableAt(gridX: number, gridY: number): boolean {
    if (!this.isInBounds(gridX, gridY)) return false;
    return this.view.topology().traversable[this.toIndex(gridX, gridY)] === 1;
  }

  private isCircleClearAt(
    worldX: number,
    worldY: number,
    radius: number,
    requireReachable: boolean,
  ): boolean {
    if (!Number.isFinite(radius) || radius < 0) return false;
    const diagonal = radius * Math.SQRT1_2;
    return this.isCircleSampleClearAt(worldX, worldY, requireReachable)
      && this.isCircleSampleClearAt(worldX + radius, worldY, requireReachable)
      && this.isCircleSampleClearAt(worldX - radius, worldY, requireReachable)
      && this.isCircleSampleClearAt(worldX, worldY + radius, requireReachable)
      && this.isCircleSampleClearAt(worldX, worldY - radius, requireReachable)
      && this.isCircleSampleClearAt(worldX + diagonal, worldY + diagonal, requireReachable)
      && this.isCircleSampleClearAt(worldX - diagonal, worldY - diagonal, requireReachable)
      && this.isCircleSampleClearAt(worldX + diagonal, worldY - diagonal, requireReachable)
      && this.isCircleSampleClearAt(worldX - diagonal, worldY + diagonal, requireReachable);
  }

  private isCircleSampleClearAt(worldX: number, worldY: number, requireReachable: boolean): boolean {
    const metrics = this.view.metrics;
    const gridX = Math.floor((worldX - metrics.arenaOffsetX) / metrics.cellSize);
    const gridY = Math.floor((worldY - metrics.arenaOffsetY) / metrics.cellSize);
    if (!this.isInBounds(gridX, gridY)) return false;
    const index = this.toIndex(gridX, gridY);
    if (this.view.topology().traversable[index] !== 1) return false;
    if (!requireReachable) return true;
    return this.getIntegrationValueAt(gridX, gridY) < INTEGRATION_INFINITY;
  }

  private findNearestPassableCell(
    gridX: number,
    gridY: number,
    maxRadiusCells: number,
  ): EnemyFlowFieldGridCell | null {
    let best: { gridX: number; gridY: number; distanceSq: number } | null = null;
    for (let offsetY = -maxRadiusCells; offsetY <= maxRadiusCells; offsetY += 1) {
      for (let offsetX = -maxRadiusCells; offsetX <= maxRadiusCells; offsetX += 1) {
        const candidateX = gridX + offsetX;
        const candidateY = gridY + offsetY;
        if (!this.isFlowPassableAt(candidateX, candidateY)) continue;
        const distanceSq = offsetX * offsetX + offsetY * offsetY;
        if (best && distanceSq >= best.distanceSq) continue;
        best = { gridX: candidateX, gridY: candidateY, distanceSq };
      }
    }
    return best ? { gridX: best.gridX, gridY: best.gridY } : null;
  }

  private beginTargetPathSearch(
    workspace: ReturnType<FlowFieldFieldView['workspace']>,
    startIndex: number,
  ): number {
    this.pathHeap.clear();
    let generation = (workspace.generationId + 1) >>> 0;
    if (generation === 0) {
      workspace.generation.fill(0);
      generation = 1;
    }
    workspace.generationId = generation;
    workspace.sequence = 0;
    workspace.generation[startIndex] = generation;
    workspace.costs[startIndex] = 0;
    workspace.parents[startIndex] = -1;
    this.pathHeap.push(startIndex, 0, workspace.sequence++);
    return generation;
  }
}

/** Zielindizes sind aufsteigend sortiert; die Suche bleibt damit logarithmisch. */
function containsIndex(sorted: Int32Array, index: number): boolean {
  let low = 0;
  let high = sorted.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const value = sorted[middle];
    if (value === index) return true;
    if (value < index) low = middle + 1;
    else high = middle - 1;
  }
  return false;
}

export interface EnemyFlowFieldDebugRenderer {
  getService(): EnemyFlowFieldService;
}

export class EnemyFlowFieldDebugRendererImpl implements EnemyFlowFieldDebugRenderer {
  constructor(private readonly service: EnemyFlowFieldService) {}

  getService(): EnemyFlowFieldService {
    return this.service;
  }
}
