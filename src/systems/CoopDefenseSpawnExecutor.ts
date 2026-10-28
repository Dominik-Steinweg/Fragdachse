import * as Phaser from 'phaser';
import type { EnemyManager, EnemySpawnOptions } from '../entities/EnemyManager';
import type { BaseSpec } from '../arena/BaseRegistry';
import { getSpawnStructureOutletVector, resolveSpawnStructureLaneOffset, SPAWN_STRUCTURE_RISE_STAGGER_MS } from '../config/spawnStructure';
import {
  getCoopDefenseEnemyConfig,
  type CoopDefenseEnemyKind,
} from '../config/coopDefenseEnemies';
import type { CoopDefenseMapSpawnAreaConfig } from '../config/coopDefenseMaps';
import type { SpawnFront } from '../types';
import { DEFAULT_SPAWN_FRONT } from '../utils/spawnFront';
import { EnemyFlowFieldService } from './EnemyFlowFieldService';
import { worldCellCenter, type WorldMetrics } from '../world/WorldMetrics';
import type { KrakenBossSpawnPort, KrakenHabitatPort, KrakenHabitatReservation, KrakenHabitatResult } from './KrakenState';
import type { BossTargetRef } from '../combat/CombatPartContact';
import { isCellInSpawnArea } from '../config/spawnZones';

const RECENT_CELL_MEMORY = 12;
const MIN_INTRA_GROUP_DISTANCE_CELLS = 2;
const SPAWN_TUNNEL_DIG_TOLERANCE_CELLS = 2;
const EDGE_BAND_RATIO = 0.15;

interface SpawnCell {
  readonly gridX: number;
  readonly gridY: number;
}

export interface CoopDefenseSpawnResult {
  readonly enemyIds: readonly string[];
  /** Occupancy and pending navigation are temporary; neither may consume a wave's remainder. */
  readonly deferred: boolean;
}

/**
 * Gemeinsame autoritative Spawn-Ausfuehrung fuer Encounter, Druckquellen und Bosses.
 * Zeitplanung und Quell-Lebenszyklus liegen bewusst in separaten Round-Systemen.
 */
export class CoopDefenseSpawnExecutor implements KrakenBossSpawnPort {
  private readonly recentCells: string[] = [];
  private exhaustionWarned = false;
  private waitingForNavigation = false;
  private waitingForSpace = false;

  constructor(
    private readonly enemyManager: EnemyManager,
    private readonly flowFieldService: EnemyFlowFieldService,
    private readonly metrics: WorldMetrics,
    private readonly bossFlowFieldService?: EnemyFlowFieldService | null,
    private readonly playerFlowFieldService?: EnemyFlowFieldService | null,
    private readonly strategicFlowFieldService?: EnemyFlowFieldService | null,
    private readonly krakenHabitat?: KrakenHabitatPort,
    /** Authored boss spawn zone; without it the boss keeps the western edge band. */
    private readonly bossSpawnArea: CoopDefenseMapSpawnAreaConfig | null = null,
  ) {}

  hostReserveBossHabitat(kind: CoopDefenseEnemyKind, habitatId: string): KrakenHabitatResult<KrakenHabitatReservation> {
    const config = getCoopDefenseEnemyConfig(kind).krakenBoss;
    return config && this.krakenHabitat ? this.krakenHabitat.reserveWaterSpawn(habitatId, config.bodyRadiusPx)
      : { status: 'invalid', reason: 'Kraken habitat/config not bound' };
  }
  spawnAtHabitat(kind: CoopDefenseEnemyKind, reservation: KrakenHabitatReservation): BossTargetRef | null {
    return this.krakenHabitat ? this.enemyManager.hostSpawnAtHabitat(kind, reservation, this.krakenHabitat) : null;
  }
  releaseBossHabitat(reservationId: string): void { this.krakenHabitat?.release(reservationId); }

  /** Spawn-Pfad fuer endliche Encounter; die Herkunft bleibt fuer Clear-Tracking erhalten. */
  hostSpawnEncounterGroup(
    kind: CoopDefenseEnemyKind,
    count: number,
    originId?: string,
    front: SpawnFront = DEFAULT_SPAWN_FRONT,
    spawnArea?: CoopDefenseMapSpawnAreaConfig,
  ): CoopDefenseSpawnResult {
    return this.spawnArenaGroup(
      kind,
      count,
      { ...(originId ? { originId } : {}), spawnFront: front },
      front,
      this.resolveSpawnFlowField(kind),
      spawnArea,
    );
  }

  /** Map-gebundene persistente Quelle; diese Gegner gehoeren keinem Encounter an. */
  hostSpawnPersistentMapGroup(
    kind: CoopDefenseEnemyKind,
    count: number,
    front: SpawnFront = DEFAULT_SPAWN_FRONT,
    spawnArea?: CoopDefenseMapSpawnAreaConfig,
  ): readonly string[] {
    return this.spawnArenaGroup(kind, count, spawnArea ? {} : { spawnFront: front }, front,
      this.resolveSpawnFlowField(kind), spawnArea).enemyIds;
  }

  /**
   * Strukturgebundene Quelle: Die Gegner steigen eingegraben in der Mitte der Brutgrube auf, mehrere
   * leicht quer zur Oeffnung versetzt und nacheinander, damit sie nicht exakt aufeinander erscheinen.
   */
  hostSpawnPersistentStructureGroup(source: BaseSpec, kind: CoopDefenseEnemyKind, count: number): void {
    const area = source.spawnArea;
    if (!area || source.role !== 'spawn-point' || count <= 0) return;
    const opening = getSpawnStructureOutletVector(area.outlet);
    for (let index = 0; index < count; index += 1) {
      const offset = resolveSpawnStructureLaneOffset(index, count);
      const spawnOptions: EnemySpawnOptions = { spawnBurrowed: true, burrowExtraMs: index * SPAWN_STRUCTURE_RISE_STAGGER_MS };
      this.enemyManager.hostSpawnAtWorld(
        area.x - opening.y * offset,
        area.y + opening.x * offset,
        kind,
        spawnOptions,
      );
    }
  }

  /** Einmaliger Boss-Spawn in der Boss-Zone, ohne sie auf der Westfront. */
  hostSpawnBoss(kind: CoopDefenseEnemyKind): boolean {
    const point = this.hostResolveBossSpawnPoint(kind);
    return point ? this.hostSpawnBossAt(kind, point.x, point.y) : false;
  }

  /**
   * Waehlt den Boss-Spawnpunkt vorab, damit ein Intro ihn ankuendigen kann. Mit
   * `edgeMarginCells` werden Zellen mit Abstand zum Kartenrand bevorzugt, damit eine
   * Inszenierung rund um den Punkt nicht am Rand abgeschnitten wird.
   */
  hostResolveBossSpawnPoint(
    kind: CoopDefenseEnemyKind,
    edgeMarginCells = 0,
  ): { readonly x: number; readonly y: number } | null {
    if (getCoopDefenseEnemyConfig(kind).krakenBoss) return null;
    const candidates = this.collectBossCandidates(kind);
    if (candidates.length === 0) return null;
    const { gridCols, gridRows } = this.metrics;
    const interior = edgeMarginCells > 0
      ? candidates.filter((cell) => Math.min(
        cell.gridX,
        cell.gridY,
        gridCols - 1 - cell.gridX,
        gridRows - 1 - cell.gridY,
      ) >= edgeMarginCells)
      : candidates;
    const pick = Phaser.Math.RND.pick(interior.length > 0 ? interior : candidates);
    return worldCellCenter(this.metrics, pick.gridX, pick.gridY);
  }

  /**
   * Spawnt den Boss am angekuendigten Punkt. Ist dieser inzwischen blockiert oder belegt,
   * wird der naechstgelegene gueltige Kandidat genommen, damit das Intro nicht ins Leere laeuft.
   */
  hostSpawnBossAt(kind: CoopDefenseEnemyKind, x: number, y: number, options: EnemySpawnOptions = {}): boolean {
    if (getCoopDefenseEnemyConfig(kind).krakenBoss) return false;
    const candidates = this.collectBossCandidates(kind);
    if (candidates.length === 0) return false;
    let best = candidates[0];
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    for (const cell of candidates) {
      const world = worldCellCenter(this.metrics, cell.gridX, cell.gridY);
      const distanceSq = (world.x - x) ** 2 + (world.y - y) ** 2;
      if (distanceSq < bestDistanceSq) {
        best = cell;
        bestDistanceSq = distanceSq;
      }
    }
    const world = worldCellCenter(this.metrics, best.gridX, best.gridY);
    this.enemyManager.hostSpawnAtWorld(world.x, world.y, kind, options);
    this.pushRecent(this.key(best.gridX, best.gridY));
    return true;
  }

  private collectBossCandidates(kind: CoopDefenseEnemyKind): SpawnCell[] {
    const candidates = this.collectCandidates(
      kind,
      DEFAULT_SPAWN_FRONT,
      this.bossFlowFieldService ?? this.flowFieldService,
      this.bossSpawnArea ?? undefined,
    );
    if (candidates.length === 0) this.warnExhausted();
    return candidates;
  }

  private spawnArenaGroup(
    kind: CoopDefenseEnemyKind,
    count: number,
    spawnOptions: EnemySpawnOptions,
    front: SpawnFront,
    flowFieldService: EnemyFlowFieldService,
    spawnArea?: CoopDefenseMapSpawnAreaConfig,
  ): CoopDefenseSpawnResult {
    const spawnedEnemyIds: string[] = [];
    if (count <= 0) return { enemyIds: spawnedEnemyIds, deferred: false };
    // Eine authored Spawn-Area hat Vorrang vor dem Randtunnel: Buddler tauchen dort an Ort und Stelle auf.
    if (spawnArea && getCoopDefenseEnemyConfig(kind).burrow?.spawnBurrowedAtEdge) {
      spawnOptions = { ...spawnOptions, spawnBurrowed: true };
    }
    const candidatesAll = this.collectCandidates(kind, front, flowFieldService, spawnArea);
    if (candidatesAll.length === 0) {
      this.warnExhausted();
      return { enemyIds: spawnedEnemyIds, deferred: this.waitingForSpace || this.waitingForNavigation };
    }

    const recentSet = new Set(this.recentCells);
    let candidates = candidatesAll.filter((cell) => !recentSet.has(this.key(cell.gridX, cell.gridY)));
    if (candidates.length === 0) candidates = candidatesAll;

    let seed: SpawnCell | null = null;
    for (let index = 0; index < count; index += 1) {
      if (candidates.length === 0) {
        return { enemyIds: spawnedEnemyIds, deferred: true };
      }

      // A pack gathers around its first member; otherwise members spread over the band.
      const pick: SpawnCell = seed ? candidates.reduce((best: SpawnCell, cell: SpawnCell) =>
        (cell.gridX - seed!.gridX) ** 2 + (cell.gridY - seed!.gridY) ** 2 < (best.gridX - seed!.gridX) ** 2 + (best.gridY - seed!.gridY) ** 2 ? cell : best)
        : Phaser.Math.RND.pick(candidates);
      if (spawnArea?.cluster && !seed) seed = pick;
      // Selection and materialization use the same World point. Adding unchecked jitter here
      // would move a valid body back into neighboring geometry.
      const world = worldCellCenter(this.metrics, pick.gridX, pick.gridY);
      const enemy = this.enemyManager.hostSpawnAtWorld(world.x, world.y, kind, spawnOptions);
      spawnedEnemyIds.push(enemy.id);
      this.pushRecent(this.key(pick.gridX, pick.gridY));
      const minimumDistance = getCoopDefenseEnemyConfig(kind).size * 0.5 + enemy.getCollisionRadius();
      candidates = candidates.filter((cell) => {
        if (!spawnArea?.cluster && Math.abs(cell.gridX - pick.gridX) <= MIN_INTRA_GROUP_DISTANCE_CELLS
          && Math.abs(cell.gridY - pick.gridY) <= MIN_INTRA_GROUP_DISTANCE_CELLS) return false;
        const next = worldCellCenter(this.metrics, cell.gridX, cell.gridY);
        return Phaser.Math.Distance.Squared(world.x, world.y, next.x, next.y) >= minimumDistance ** 2;
      });
    }
    return { enemyIds: spawnedEnemyIds, deferred: false };
  }

  private collectCandidates(
    kind: CoopDefenseEnemyKind,
    front: SpawnFront,
    flowFieldService: EnemyFlowFieldService,
    spawnArea?: CoopDefenseMapSpawnAreaConfig,
  ): SpawnCell[] {
    this.waitingForNavigation = false;
    this.waitingForSpace = false;
    if (!spawnArea && getCoopDefenseEnemyConfig(kind).burrow?.spawnBurrowedAtEdge) {
      return this.collectEdgeBurrowCandidates(kind, front, flowFieldService);
    }

    const enemies = this.enemyManager.getAllEnemies();
    const spawnRadius = getCoopDefenseEnemyConfig(kind).size * 0.5;
    const cells: SpawnCell[] = [];
    const edgeBand = spawnArea ? this.getAuthoredBand(spawnArea) : this.getEdgeBand(front);
    if (spawnArea?.medium === 'water') return this.collectWaterCandidates(spawnArea, edgeBand, spawnRadius, enemies);
    const allowPlayerTargetWithoutGoals = (this.isPlayerTarget(kind) || flowFieldService === this.playerFlowFieldService)
      && (flowFieldService.getGoalCells?.().length ?? 0) === 0;
    for (let gridX = edgeBand.minGridX; gridX <= edgeBand.maxGridX; gridX += 1) {
      for (let gridY = edgeBand.minGridY; gridY <= edgeBand.maxGridY; gridY += 1) {
        // A round zone spawns only inside its organic outline; the band is its box.
        if (spawnArea && !isCellInSpawnArea(spawnArea, gridX, gridY)) continue;
        const world = worldCellCenter(this.metrics, gridX, gridY);
        if (!flowFieldService.isCircleGroundFreeAt(world.x, world.y, spawnRadius)) continue;
        if (!this.isReachable(world.x, world.y, flowFieldService, allowPlayerTargetWithoutGoals)) continue;
        if (this.overlapsEnemy(world.x, world.y, spawnRadius, enemies)) {
          this.waitingForSpace = true;
          continue;
        }
        cells.push({ gridX, gridY });
      }
    }
    return cells;
  }

  /** Amphibious units rise submerged from cells whose whole body lies over water; they swim to land on their own. */
  private collectWaterCandidates(area: CoopDefenseMapSpawnAreaConfig,
    band: { minGridX: number; maxGridX: number; minGridY: number; maxGridY: number },
    spawnRadius: number, enemies: ReturnType<EnemyManager['getAllEnemies']>): SpawnCell[] {
    const water = this.enemyManager.getWaterGeometry(), cells: SpawnCell[] = [];
    if (!water) return cells;
    for (let gridX = band.minGridX; gridX <= band.maxGridX; gridX += 1) {
      for (let gridY = band.minGridY; gridY <= band.maxGridY; gridY += 1) {
        if (!isCellInSpawnArea(area, gridX, gridY)) continue;
        const world = worldCellCenter(this.metrics, gridX, gridY);
        if (water.wetShare(world.x, world.y, spawnRadius) < 1 || water.wetShare(world.x, world.y, spawnRadius / .7) < 1) continue;
        if (this.overlapsEnemy(world.x, world.y, spawnRadius, enemies)) { this.waitingForSpace = true; continue; }
        cells.push({ gridX, gridY });
      }
    }
    return cells;
  }

  private isReachable(x: number, y: number, field: EnemyFlowFieldService, allowWithoutGoals = false): boolean {
    if (allowWithoutGoals) return true;
    if (field.getNavigationGeometry()) {
      const result = field.queryNavigation(x, y);
      if (result.status === 'pending') {
        const connected = field.canReachCurrentGoals(x, y);
        if (connected !== null) return connected;
        this.waitingForNavigation = true;
      }
      return result.status === 'ready';
    }
    const cell = field.worldToGrid(x, y);
    return !!cell && field.isTraversableAt(cell.gridX, cell.gridY)
      && field.getIntegrationValueAt(cell.gridX, cell.gridY) < EnemyFlowFieldService.INTEGRATION_INFINITY;
  }

  private resolveSpawnFlowField(kind: CoopDefenseEnemyKind): EnemyFlowFieldService {
    const movementTarget = getCoopDefenseEnemyConfig(kind).movementTarget;
    if (movementTarget === 'players-and-armed-constructs') {
      return this.strategicFlowFieldService
        ?? this.playerFlowFieldService
        ?? this.flowFieldService;
    }
    if (movementTarget === 'players') {
      return this.playerFlowFieldService ?? this.flowFieldService;
    }
    // Basislose Vorstoss-Karten: ohne Basisziel gaebe es im Basisfeld keine erreichbare
    // Spawnzelle. Die Spawnfront bleibt dieselbe, nur das gelesene Feld wechselt.
    if (!this.flowFieldService.hasGoalCells() && this.playerFlowFieldService) {
      return this.playerFlowFieldService;
    }
    return this.flowFieldService;
  }

  private isPlayerTarget(kind: CoopDefenseEnemyKind): boolean {
    const movementTarget = getCoopDefenseEnemyConfig(kind).movementTarget;
    return movementTarget === 'players' || movementTarget === 'players-and-armed-constructs';
  }

  /** Edge-burrow candidates may start inside blocked border cells, but their tunnel must reach
   * the same reachable flow-field network as ordinary spawns. */
  private collectEdgeBurrowCandidates(
    kind: CoopDefenseEnemyKind,
    front: SpawnFront,
    flowFieldService: EnemyFlowFieldService,
  ): SpawnCell[] {
    const enemies = this.enemyManager.getAllEnemies();
    const spawnRadius = getCoopDefenseEnemyConfig(kind).size * 0.5;
    const edgeCells: Array<{ cell: SpawnCell; digCells: number }> = [];
    let shortestDigCells = Number.POSITIVE_INFINITY;

    for (const cell of this.getEdgeLine(front)) {
      const world = worldCellCenter(this.metrics, cell.gridX, cell.gridY);
      const digCells = this.measureEdgeDigDistance(front, cell, flowFieldService, spawnRadius);
      if (digCells === null) continue;
      if (this.overlapsEnemy(world.x, world.y, spawnRadius, enemies)) {
        this.waitingForSpace = true;
        continue;
      }
      shortestDigCells = Math.min(shortestDigCells, digCells);
      edgeCells.push({ cell, digCells });
    }

    if (!Number.isFinite(shortestDigCells)) return [];
    const maxDigCells = shortestDigCells + SPAWN_TUNNEL_DIG_TOLERANCE_CELLS;
    return edgeCells
      .filter(({ digCells }) => digCells <= maxDigCells)
      .map(({ cell }) => cell);
  }

  private measureEdgeDigDistance(
    front: SpawnFront,
    edgeCell: SpawnCell,
    flowFieldService: EnemyFlowFieldService,
    radius: number,
  ): number | null {
    const inward = getFrontInwardStep(front);
    const cols = this.metrics.gridCols;
    const rows = this.metrics.gridRows;
    const maxDistance = front === 'west' || front === 'east' ? cols : rows;
    for (let distance = 0; distance < maxDistance; distance += 1) {
      const gridX = edgeCell.gridX + inward.x * distance;
      const gridY = edgeCell.gridY + inward.y * distance;
      if (gridX < 0 || gridX >= cols || gridY < 0 || gridY >= rows) break;
      const world = worldCellCenter(this.metrics, gridX, gridY);
      const cell = flowFieldService.worldToGrid(world.x, world.y);
      if (!cell || flowFieldService.getKindAt(cell.gridX, cell.gridY) === 'water') return null;
      if (!flowFieldService.isCircleGroundFreeAt(world.x, world.y, radius)) continue;
      if (!this.isReachable(world.x, world.y, flowFieldService)) continue;
      return distance;
    }
    return null;
  }

  private getEdgeLine(front: SpawnFront): SpawnCell[] {
    const cols = this.metrics.gridCols;
    const rows = this.metrics.gridRows;
    if (front === 'west' || front === 'east') {
      const gridX = front === 'west' ? 0 : cols - 1;
      return Array.from({ length: rows }, (_, gridY) => ({ gridX, gridY }));
    }
    const gridY = front === 'north' ? 0 : rows - 1;
    return Array.from({ length: cols }, (_, gridX) => ({ gridX, gridY }));
  }

  /**
   * Authored Spawnbereich statt Randband. Die Auswahl innerhalb bleibt identisch – der Bereich
   * verschiebt nur, wo ueberhaupt gesucht wird.
   */
  private getAuthoredBand(
    area: CoopDefenseMapSpawnAreaConfig,
  ): { minGridX: number; maxGridX: number; minGridY: number; maxGridY: number } {
    const cols = this.metrics.gridCols;
    const rows = this.metrics.gridRows;
    return {
      minGridX: Math.max(0, area.gridX),
      maxGridX: Math.min(cols - 1, area.gridX + area.widthCells - 1),
      minGridY: Math.max(0, area.gridY),
      maxGridY: Math.min(rows - 1, area.gridY + area.heightCells - 1),
    };
  }

  private getEdgeBand(front: SpawnFront): { minGridX: number; maxGridX: number; minGridY: number; maxGridY: number } {
    const cols = this.metrics.gridCols;
    const rows = this.metrics.gridRows;
    const depthX = Math.min(Math.max(2, Math.floor(cols * EDGE_BAND_RATIO)), cols - 1);
    const depthY = Math.min(Math.max(2, Math.floor(rows * EDGE_BAND_RATIO)), rows - 1);
    switch (front) {
      case 'west': return { minGridX: 0, maxGridX: depthX, minGridY: 0, maxGridY: rows - 1 };
      case 'east': return { minGridX: cols - 1 - depthX, maxGridX: cols - 1, minGridY: 0, maxGridY: rows - 1 };
      case 'north': return { minGridX: 0, maxGridX: cols - 1, minGridY: 0, maxGridY: depthY };
      case 'south': return { minGridX: 0, maxGridX: cols - 1, minGridY: rows - 1 - depthY, maxGridY: rows - 1 };
    }
  }

  private overlapsEnemy(
    x: number,
    y: number,
    spawnRadius: number,
    enemies: readonly ReturnType<EnemyManager['getAllEnemies']>[number][],
  ): boolean {
    return enemies.some((enemy) => {
      const minimumDistance = spawnRadius + enemy.getCollisionRadius();
      return Phaser.Math.Distance.Squared(x, y, enemy.sprite.x, enemy.sprite.y)
        < minimumDistance * minimumDistance;
    });
  }

  private pushRecent(key: string): void {
    this.recentCells.push(key);
    if (this.recentCells.length > RECENT_CELL_MEMORY) this.recentCells.shift();
  }

  private warnExhausted(): void {
    // A pending Worker or a living crowd is not evidence of an unusable spawn area.
    if (this.waitingForNavigation || this.waitingForSpace) return;
    if (this.exhaustionWarned) return;
    this.exhaustionWarned = true;
    console.warn('[CoopDefenseSpawnExecutor] Keine freien Spawn-Zellen an der authored Arena-Front mehr.');
  }

  private key(gridX: number, gridY: number): string {
    return `${gridX}:${gridY}`;
  }
}

function getFrontInwardStep(front: SpawnFront): { x: number; y: number } {
  switch (front) {
    case 'north': return { x: 0, y: 1 };
    case 'east': return { x: -1, y: 0 };
    case 'south': return { x: 0, y: -1 };
    case 'west': return { x: 1, y: 0 };
  }
}
