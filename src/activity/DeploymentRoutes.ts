import type { BaseSpec } from '../arena/BaseRegistry';
import { listEnemySpawnSources, type EnemySpawnSource } from '../arena/EnemySpawnSources';
import { CELL_SIZE, COOP_DEFENSE_NAV_TICK_INTERVAL_MS } from '../config';
import type { WorldSpawnFocusCell } from '../config/authoring/WorldDefinition';
import { getCoopDefenseEnemyConfig } from '../config/coopDefenseEnemies';
import { resolveCoopDefenseMapMissionProgress } from '../config/coopDefenseMapAuthoring';
import type { CoopDefenseMapConfig } from '../config/coopDefenseMaps';
import { FlowFieldCoordinator, type FlowFieldFieldView } from '../systems/flowfield/FlowFieldCoordinator';
import type { FlowFieldMetrics } from '../systems/flowfield/FlowFieldKernel';
import { InlineFlowFieldRunner } from '../systems/flowfield/FlowFieldRunner';
import { traceFlowFieldRoute, type FlowFieldRoutePoint } from '../systems/flowfield/FlowFieldRouteTracer';
import { createFlowFieldTuning, resolveCoopMissionFlowFieldInputs } from '../systems/flowfield/FlowFieldSources';
import { buildMissionStartNavigationGeometry } from '../systems/navigation/MissionStartNavigationGeometry';
import type { NavigationGeometrySnapshot } from '../systems/navigation/NavigationGeometry';
import type { ArenaLayout, SpawnFront } from '../types';
import type { WorldMetrics } from '../world/WorldMetrics';

/** Where the enemies of one source walk to when the round starts. */
export type DeploymentRouteTarget =
  /** The mission's goal bases; the nearest wins, as for a base attacker in the round. */
  | { readonly kind: 'bases' }
  /** Where the players are expected when these enemies appear: spawn, checkpoint or site. */
  | { readonly kind: 'players'; readonly gridX: number; readonly gridY: number };

export interface DeploymentRouteRequest {
  readonly key: string;
  readonly source: EnemySpawnSource;
  readonly target: DeploymentRouteTarget;
}

/**
 * Which routes the situation map traces, from authored data and the same rules as the mission.
 *
 * Base attackers walk to the goal bases of the mission start (enemy targeting, outposts without
 * an objective and dormant objectives excluded). Everyone else hunts the players, who are expected
 * at the spawn focus or, for encounters started by a checkpoint, at that checkpoint. Fleeing
 * enemies get no route. Sources with the same target share one route.
 */
export function resolveDeploymentRouteRequests(input: {
  readonly mapConfig: CoopDefenseMapConfig;
  readonly bases: readonly BaseSpec[];
  readonly goalBaseIds: readonly string[];
  readonly spawnFocusCell?: WorldSpawnFocusCell;
}): DeploymentRouteRequest[] {
  const { mapConfig } = input;
  const focus = resolveDeploymentSpawnFocus(mapConfig, input.bases, input.spawnFocusCell);
  const checkpoints = new Map((mapConfig.missionProgress?.checkpoints ?? []).map((checkpoint) => [checkpoint.id, checkpoint]));
  const encounters = mapConfig.encounters ?? [];
  const expectedPlayers = (encounterId: string, seen = new Set<string>()): { gridX: number; gridY: number } => {
    const index = encounters.findIndex((encounter) => encounter.id === encounterId);
    const encounter = encounters[index];
    if (!encounter || seen.has(encounterId)) return focus;
    seen.add(encounterId);
    const start = encounter.start;
    if (start.type === 'after-checkpoint') {
      const checkpoint = checkpoints.get(start.checkpointId);
      return checkpoint ? { gridX: checkpoint.gridX, gridY: checkpoint.gridY } : focus;
    }
    if (start.type === 'after-encounter') return expectedPlayers(start.encounterId, seen);
    if (start.type === 'after-previous' && index > 0) return expectedPlayers(encounters[index - 1]!.id, seen);
    return focus;
  };
  const requests = new Map<string, DeploymentRouteRequest>();
  for (const source of listEnemySpawnSources(mapConfig)) {
    const targets = source.enemyKinds.map((kind) => getCoopDefenseEnemyConfig(kind).movementTarget);
    const players = source.encounterStarts.length > 0 ? expectedPlayers(source.encounterStarts[0]!.encounterId) : focus;
    const add = (target: DeploymentRouteTarget) => {
      const key = `${placeKey(source)}>${target.kind === 'bases' ? 'bases' : `${target.gridX}:${target.gridY}`}`;
      if (!requests.has(key)) requests.set(key, { key, source, target });
    };
    if (targets.includes('bases') && input.goalBaseIds.length > 0) add({ kind: 'bases' });
    if (targets.some((target) => target === 'players' || target === 'players-and-armed-constructs')
      || (targets.includes('bases') && input.goalBaseIds.length === 0)) add({ kind: 'players', ...players });
  }
  return [...requests.values()];
}

/** Where the players spawn when the round starts: mission start area, authored focus or calm base. */
export function resolveDeploymentSpawnFocus(mapConfig: CoopDefenseMapConfig, bases: readonly BaseSpec[],
  spawnFocusCell?: WorldSpawnFocusCell): { gridX: number; gridY: number } {
  const startArea = mapConfig.missionProgress?.startArea;
  if (startArea) return { gridX: startArea.gridX, gridY: startArea.gridY };
  if (spawnFocusCell) return { gridX: spawnFocusCell.gridX, gridY: spawnFocusCell.gridY };
  const calm = resolveCalmCoopSpawnBase(bases);
  if (!calm) return { gridX: 0, gridY: 0 };
  return { gridX: Math.round((calm.region.minGridX + calm.region.maxGridX) / 2), gridY: Math.round((calm.region.minGridY + calm.region.maxGridY) / 2) };
}

/** The players' spawn base without enemy pressure: the leftmost own main base. */
export function resolveCalmCoopSpawnBase(bases: readonly BaseSpec[]): BaseSpec | null {
  const own = bases.filter((base) => base.faction !== 'hostile' && base.role !== 'outpost' && base.role !== 'spawn-point');
  let leftmost: BaseSpec | null = null;
  for (const base of own) if (!leftmost || base.region.minGridX < leftmost.region.minGridX) leftmost = base;
  return leftmost;
}

function placeKey(source: EnemySpawnSource): string {
  const place = source.place;
  if (place.kind === 'area') return `area:${place.area.gridX}:${place.area.gridY}:${place.area.widthCells}:${place.area.heightCells}`;
  return place.kind === 'mouth' ? `mouth:${place.baseId}` : `front:${place.front}`;
}

export interface DeploymentRouteLine {
  readonly key: string;
  readonly target: DeploymentRouteTarget;
  /** From the source down to the goal; empty when the source has no reachable start. */
  readonly points: readonly FlowFieldRoutePoint[];
  readonly reachedGoal: boolean;
  /** Without a free path enemies break through here (World pixels), else `null`. */
  readonly breach: { readonly x: number; readonly y: number } | null;
  readonly source: { readonly x: number; readonly y: number };
  /** The route matters for the base: it ends (or breaks through) inside the detail view. */
  readonly relevant: boolean;
}

export interface DeploymentRoutePlan {
  /** `routes` shows the routes around the base; `terrain` explains why there are none. */
  readonly mode: 'routes' | 'terrain';
  readonly hint: 'front-base' | 'players-away' | null;
  readonly routes: readonly DeploymentRouteLine[];
}

interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/**
 * Main routes of the next round for the base editor, from the mission's own flow-field inputs.
 *
 * The geometry is the World at mission start plus the persistent base as the host would merge
 * it. Planning again after an edit only replaces the construction cells.
 */
export class DeploymentRoutePlanner {
  private readonly coordinator: FlowFieldCoordinator;
  private readonly metrics: FlowFieldMetrics;
  private readonly requests: readonly DeploymentRouteRequest[];
  private readonly fields = new Map<string, FlowFieldFieldView>();
  private geometry: NavigationGeometrySnapshot;
  private constructionCells: readonly { gridX: number; gridY: number }[] = [];

  constructor(private readonly input: {
    readonly mapConfig: CoopDefenseMapConfig;
    readonly worldMetrics: WorldMetrics;
    readonly layout: ArenaLayout;
    /** Bases standing at mission start. */
    readonly bases: readonly BaseSpec[];
    readonly spawnFocusCell?: WorldSpawnFocusCell;
    /** World-pixel rectangle of the situation map's detail view. */
    readonly detail: Rect;
  }) {
    const navigation = resolveCoopMissionFlowFieldInputs({ worldMetrics: input.worldMetrics, layout: input.layout,
      baseSpecs: input.bases, enemyTargeting: input.mapConfig.enemyTargeting, exact: true });
    this.metrics = navigation.metrics;
    const goalBaseIds = navigation.bases.filter((base) => base.isGoalSource).map((base) => base.id);
    this.requests = resolveDeploymentRouteRequests({ mapConfig: input.mapConfig, bases: input.bases, goalBaseIds,
      spawnFocusCell: input.spawnFocusCell });
    this.geometry = this.buildGeometry([]);
    this.coordinator = new FlowFieldCoordinator({
      metrics: navigation.metrics, tuning: createFlowFieldTuning(), staticKind: navigation.staticKind, bases: navigation.bases,
      activeBaseIds: new Set(input.bases.map((base) => base.id)), obstacleCellProvider: () => [],
      geometryProvider: () => this.geometry, runner: new InlineFlowFieldRunner(), navTickIntervalMs: COOP_DEFENSE_NAV_TICK_INTERVAL_MS,
    });
    for (const request of this.requests) this.fieldFor(request.target);
  }

  get routeCount(): number { return this.requests.length; }

  /** Routes with the persistent base standing on these cells. */
  plan(constructionCells: readonly { readonly gridX: number; readonly gridY: number }[]): DeploymentRoutePlan {
    this.constructionCells = constructionCells.map((cell) => ({ gridX: cell.gridX, gridY: cell.gridY }));
    this.compute(this.constructionCells);
    // First every route on the real geometry; field buffers are reused by the next computation.
    const traced = this.requests.map((request) => {
      const centre = sourceCentre(request.source, this.input.worldMetrics, this.input.bases);
      return { request, centre, route: this.trace(request.target, centre) };
    });
    const breaches = new Map<string, { points: readonly FlowFieldRoutePoint[]; breach: { x: number; y: number } }>();
    if (traced.some(({ route }) => !route.reachedGoal) && this.constructionCells.length > 0) {
      // Without a free path enemies break through the persistent base: where the open route meets it.
      this.compute([]);
      const blocked = new Set(this.constructionCells.map((cell) => `${cell.gridX}:${cell.gridY}`));
      const { offsetX, offsetY } = this.input.worldMetrics;
      for (const { request, centre, route } of traced) {
        if (route.reachedGoal) continue;
        const open = this.trace(request.target, centre);
        const hit = open.points.find((point) => blocked.has(`${Math.floor((point.x - offsetX) / CELL_SIZE)}:${Math.floor((point.y - offsetY) / CELL_SIZE)}`));
        if (open.reachedGoal && hit) breaches.set(request.key, { points: open.points.slice(0, open.points.indexOf(hit) + 1), breach: { x: hit.x, y: hit.y } });
      }
      this.compute(this.constructionCells);
    }
    const routes = traced.map(({ request, centre, route }) => {
      const breach = breaches.get(request.key);
      return breach ? this.line(request, breach.points, false, breach.breach, centre)
        : this.line(request, route.points, route.reachedGoal, null, centre);
    });
    const relevant = routes.some((route) => route.relevant);
    const hint = relevant || routes.length === 0 ? null
      : routes.some((route) => route.target.kind === 'bases' && route.reachedGoal) ? 'front-base' : 'players-away';
    return { mode: relevant ? 'routes' : 'terrain', hint, routes };
  }

  destroy(): void {
    this.coordinator.destroy();
  }

  private line(request: DeploymentRouteRequest, points: readonly FlowFieldRoutePoint[], reachedGoal: boolean,
    breach: { x: number; y: number } | null, source: { x: number; y: number }): DeploymentRouteLine {
    const end = breach ?? points[points.length - 1] ?? null;
    const detail = this.input.detail;
    const relevant = end !== null && end.x >= detail.x && end.x <= detail.x + detail.width
      && end.y >= detail.y && end.y <= detail.y + detail.height;
    return { key: request.key, target: request.target, points, reachedGoal, breach, source, relevant };
  }

  private compute(constructionCells: readonly { gridX: number; gridY: number }[]): void {
    this.geometry = this.buildGeometry(constructionCells);
    this.coordinator.invalidateGeometry();
    this.coordinator.runSynchronously(true);
  }

  private trace(target: DeploymentRouteTarget, centre: { x: number; y: number }): { points: readonly FlowFieldRoutePoint[]; reachedGoal: boolean } {
    const snapshot = this.fieldFor(target).snapshot();
    const start = snapshot ? this.startNode(snapshot.integrationField, centre) : -1;
    return snapshot && start >= 0 ? traceFlowFieldRoute(snapshot, this.metrics, start) : { points: [], reachedGoal: false };
  }

  private fieldFor(target: DeploymentRouteTarget): FlowFieldFieldView {
    const key = targetKey(target);
    let field = this.fields.get(key);
    if (field) return field;
    field = this.coordinator.registerField(`deployment:${key}`, { goalMode: target.kind === 'bases' ? 'bases' : 'dynamic' });
    if (target.kind === 'players') {
      // The node grid has a node on every cell centre and every cell corner.
      const goals: number[] = [];
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = target.gridX * 2 + 1 + dx, y = target.gridY * 2 + 1 + dy;
        if (x >= 0 && y >= 0 && x < this.metrics.cols && y < this.metrics.rows) goals.push(y * this.metrics.cols + x);
      }
      field.setGoals(goals);
    }
    this.fields.set(key, field);
    return field;
  }

  /** The reachable node nearest to a source's centre; water sources start at the nearest shore. */
  private startNode(integration: Float32Array, centre: { x: number; y: number }): number {
    const { cols, rows } = this.metrics;
    const cx = Math.round((centre.x - this.input.worldMetrics.offsetX) / 16), cy = Math.round((centre.y - this.input.worldMetrics.offsetY) / 16);
    for (let radius = 0; radius <= 40; radius++) {
      let best = -1, bestDistance = Infinity;
      for (let y = Math.max(0, cy - radius); y <= Math.min(rows - 1, cy + radius); y++) {
        for (let x = Math.max(0, cx - radius); x <= Math.min(cols - 1, cx + radius); x++) {
          if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== radius) continue;
          const index = y * cols + x;
          if (!Number.isFinite(integration[index])) continue;
          const distance = (x - cx) ** 2 + (y - cy) ** 2;
          if (distance < bestDistance) { bestDistance = distance; best = index; }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  private buildGeometry(constructionCells: readonly { gridX: number; gridY: number }[]): NavigationGeometrySnapshot {
    return buildMissionStartNavigationGeometry({ metrics: this.input.worldMetrics, layout: this.input.layout,
      bases: this.input.bases, constructionCells,
      barrierCells: resolveCoopDefenseMapMissionProgress(this.input.mapConfig)?.barriers.flatMap((barrier) => barrier.cells) ?? [] });
  }
}

function targetKey(target: DeploymentRouteTarget): string {
  return target.kind === 'bases' ? 'bases' : `players:${target.gridX}:${target.gridY}`;
}

/** World-pixel centre of a source; an edge band uses the middle of its edge. */
function sourceCentre(source: EnemySpawnSource, metrics: WorldMetrics, bases: readonly BaseSpec[]): { x: number; y: number } {
  const cell = (gridX: number, gridY: number) => ({ x: metrics.offsetX + gridX * CELL_SIZE, y: metrics.offsetY + gridY * CELL_SIZE });
  const place = source.place;
  if (place.kind === 'area') return cell(place.area.gridX + place.area.widthCells / 2, place.area.gridY + place.area.heightCells / 2);
  if (place.kind === 'mouth') {
    const mouth = bases.find((base) => base.id === place.baseId)?.spawnArea?.mouth ?? [];
    if (mouth.length) return cell(mouth.reduce((sum, c) => sum + c.gridX, 0) / mouth.length + .5, mouth.reduce((sum, c) => sum + c.gridY, 0) / mouth.length + .5);
  }
  const front: SpawnFront = place.kind === 'front' ? place.front : 'west';
  const { gridCols: cols, gridRows: rows } = metrics;
  if (front === 'west') return cell(1, rows / 2);
  if (front === 'east') return cell(cols - 1, rows / 2);
  if (front === 'north') return cell(cols / 2, 1);
  return cell(cols / 2, rows - 1);
}
