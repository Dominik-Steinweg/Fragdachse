import * as Phaser from 'phaser';
import { GRID_COLS, GRID_ROWS } from '../config';
import type { EnemyManager, EnemySpawnOptions } from '../entities/EnemyManager';
import type { BaseSpec } from '../arena/BaseRegistry';
import {
  getCoopDefenseEnemyConfig,
  type CoopDefenseEnemyKind,
} from '../config/coopDefenseEnemies';
import type { CoopDefenseMapSpawnAreaConfig } from '../config/coopDefenseMaps';
import type { SpawnFront } from '../types';
import { DEFAULT_SPAWN_FRONT } from '../utils/spawnFront';
import { EnemyFlowFieldService } from './EnemyFlowFieldService';

const RECENT_CELL_MEMORY = 12;
const MIN_INTRA_GROUP_DISTANCE_CELLS = 2;
const SPAWN_TUNNEL_DIG_TOLERANCE_CELLS = 2;
const EDGE_BAND_RATIO = 0.15;

interface SpawnCell {
  readonly gridX: number;
  readonly gridY: number;
}

/**
 * Gemeinsame autoritative Spawn-Ausfuehrung fuer Encounter, Druckquellen und Bosses.
 * Zeitplanung und Quell-Lebenszyklus liegen bewusst in separaten Round-Systemen.
 */
export class CoopDefenseSpawnExecutor {
  private readonly recentCells: string[] = [];
  private exhaustionWarned = false;

  constructor(
    private readonly enemyManager: EnemyManager,
    private readonly flowFieldService: EnemyFlowFieldService,
    private readonly bossFlowFieldService?: EnemyFlowFieldService | null,
    private readonly playerFlowFieldService?: EnemyFlowFieldService | null,
    private readonly strategicFlowFieldService?: EnemyFlowFieldService | null,
  ) {}

  /** Spawn-Pfad fuer endliche Encounter; die Herkunft bleibt fuer Clear-Tracking erhalten. */
  hostSpawnEncounterGroup(
    kind: CoopDefenseEnemyKind,
    count: number,
    originId?: string,
    front: SpawnFront = DEFAULT_SPAWN_FRONT,
    spawnArea?: CoopDefenseMapSpawnAreaConfig,
  ): readonly string[] {
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
  ): readonly string[] {
    return this.spawnArenaGroup(kind, count, { spawnFront: front }, front, this.resolveSpawnFlowField(kind));
  }

  /** Strukturgebundene Quelle mit unveraendertem Spawnzentrum und Burrow-Sonderbehandlung. */
  hostSpawnPersistentStructureGroup(source: BaseSpec, kind: CoopDefenseEnemyKind, count: number): void {
    if (!source.spawnCenter || source.role !== 'spawn-point' || count <= 0) return;
    const spawnOptions: EnemySpawnOptions = { spawnBurrowed: true };
    for (let index = 0; index < count; index += 1) {
      this.enemyManager.hostSpawnAtWorld(
        source.spawnCenter.x,
        source.spawnCenter.y,
        kind,
        spawnOptions,
      );
    }
  }

  /** Einmaliger Boss-Spawn; der bestehende Boss-Pfad bleibt auf der Westfront. */
  hostSpawnBoss(kind: CoopDefenseEnemyKind): boolean {
    const candidates = this.collectCandidates(
      kind,
      DEFAULT_SPAWN_FRONT,
      this.bossFlowFieldService ?? this.flowFieldService,
    );
    if (candidates.length === 0) {
      this.warnExhausted();
      return false;
    }

    const pick = Phaser.Math.RND.pick(candidates);
    this.enemyManager.hostSpawnDummyAt(pick.gridX, pick.gridY, kind);
    this.pushRecent(this.key(pick.gridX, pick.gridY));
    return true;
  }

  private spawnArenaGroup(
    kind: CoopDefenseEnemyKind,
    count: number,
    spawnOptions: EnemySpawnOptions,
    front: SpawnFront,
    flowFieldService: EnemyFlowFieldService,
    spawnArea?: CoopDefenseMapSpawnAreaConfig,
  ): string[] {
    const spawnedEnemyIds: string[] = [];
    if (count <= 0) return spawnedEnemyIds;
    const candidatesAll = this.collectCandidates(kind, front, flowFieldService, spawnArea);
    if (candidatesAll.length === 0) {
      this.warnExhausted();
      return spawnedEnemyIds;
    }

    const recentSet = new Set(this.recentCells);
    let candidates = candidatesAll.filter((cell) => !recentSet.has(this.key(cell.gridX, cell.gridY)));
    if (candidates.length === 0) candidates = candidatesAll;

    for (let index = 0; index < count; index += 1) {
      if (candidates.length === 0) {
        this.warnExhausted();
        return spawnedEnemyIds;
      }

      const pick = Phaser.Math.RND.pick(candidates);
      const enemy = this.enemyManager.hostSpawnDummyAt(pick.gridX, pick.gridY, kind, spawnOptions);
      spawnedEnemyIds.push(enemy.id);
      this.pushRecent(this.key(pick.gridX, pick.gridY));
      candidates = candidates.filter(
        (cell) => Math.abs(cell.gridX - pick.gridX) > MIN_INTRA_GROUP_DISTANCE_CELLS
          || Math.abs(cell.gridY - pick.gridY) > MIN_INTRA_GROUP_DISTANCE_CELLS,
      );
    }
    return spawnedEnemyIds;
  }

  private collectCandidates(
    kind: CoopDefenseEnemyKind,
    front: SpawnFront,
    flowFieldService: EnemyFlowFieldService,
    spawnArea?: CoopDefenseMapSpawnAreaConfig,
  ): SpawnCell[] {
    if (getCoopDefenseEnemyConfig(kind).burrow?.spawnBurrowedAtEdge) {
      return this.collectEdgeBurrowCandidates(kind, front, flowFieldService);
    }

    const enemies = this.enemyManager.getAllEnemies();
    const spawnRadius = getCoopDefenseEnemyConfig(kind).size * 0.5;
    const cells: SpawnCell[] = [];
    const edgeBand = spawnArea ? this.getAuthoredBand(spawnArea) : this.getEdgeBand(front);
    const allowPlayerTargetWithoutGoals = this.isPlayerTarget(kind)
      && (flowFieldService.getGoalCells?.().length ?? 0) === 0;
    for (let gridX = edgeBand.minGridX; gridX <= edgeBand.maxGridX; gridX += 1) {
      for (let gridY = edgeBand.minGridY; gridY <= edgeBand.maxGridY; gridY += 1) {
        if (!flowFieldService.isTraversableAt(gridX, gridY)) continue;
        if (
          !allowPlayerTargetWithoutGoals
          && flowFieldService.getIntegrationValueAt(gridX, gridY) >= EnemyFlowFieldService.INTEGRATION_INFINITY
        ) continue;
        const world = flowFieldService.gridToWorld(gridX, gridY);
        if (!world) continue;
        if (this.overlapsEnemy(world.x, world.y, spawnRadius, enemies)) continue;
        cells.push({ gridX, gridY });
      }
    }
    return cells;
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
      const world = flowFieldService.gridToWorld(cell.gridX, cell.gridY);
      if (!world || this.overlapsEnemy(world.x, world.y, spawnRadius, enemies)) continue;
      const digCells = this.measureEdgeDigDistance(front, cell, flowFieldService);
      if (digCells === null) continue;
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
  ): number | null {
    const inward = getFrontInwardStep(front);
    const maxDistance = front === 'west' || front === 'east' ? GRID_COLS : GRID_ROWS;
    for (let distance = 0; distance < maxDistance; distance += 1) {
      const gridX = edgeCell.gridX + inward.x * distance;
      const gridY = edgeCell.gridY + inward.y * distance;
      if (gridX < 0 || gridX >= GRID_COLS || gridY < 0 || gridY >= GRID_ROWS) break;
      if (!flowFieldService.isTraversableAt(gridX, gridY)) continue;
      if (flowFieldService.getIntegrationValueAt(gridX, gridY) >= EnemyFlowFieldService.INTEGRATION_INFINITY) continue;
      return distance;
    }
    return null;
  }

  private getEdgeLine(front: SpawnFront): SpawnCell[] {
    if (front === 'west' || front === 'east') {
      const gridX = front === 'west' ? 0 : GRID_COLS - 1;
      return Array.from({ length: GRID_ROWS }, (_, gridY) => ({ gridX, gridY }));
    }
    const gridY = front === 'north' ? 0 : GRID_ROWS - 1;
    return Array.from({ length: GRID_COLS }, (_, gridX) => ({ gridX, gridY }));
  }

  /**
   * Authored Spawnbereich statt Randband. Die Auswahl innerhalb bleibt identisch – der Bereich
   * verschiebt nur, wo ueberhaupt gesucht wird.
   */
  private getAuthoredBand(
    area: CoopDefenseMapSpawnAreaConfig,
  ): { minGridX: number; maxGridX: number; minGridY: number; maxGridY: number } {
    return {
      minGridX: Math.max(0, area.gridX),
      maxGridX: Math.min(GRID_COLS - 1, area.gridX + area.widthCells - 1),
      minGridY: Math.max(0, area.gridY),
      maxGridY: Math.min(GRID_ROWS - 1, area.gridY + area.heightCells - 1),
    };
  }

  private getEdgeBand(front: SpawnFront): { minGridX: number; maxGridX: number; minGridY: number; maxGridY: number } {
    const depthX = Math.min(Math.max(2, Math.floor(GRID_COLS * EDGE_BAND_RATIO)), GRID_COLS - 1);
    const depthY = Math.min(Math.max(2, Math.floor(GRID_ROWS * EDGE_BAND_RATIO)), GRID_ROWS - 1);
    switch (front) {
      case 'west': return { minGridX: 0, maxGridX: depthX, minGridY: 0, maxGridY: GRID_ROWS - 1 };
      case 'east': return { minGridX: GRID_COLS - 1 - depthX, maxGridX: GRID_COLS - 1, minGridY: 0, maxGridY: GRID_ROWS - 1 };
      case 'north': return { minGridX: 0, maxGridX: GRID_COLS - 1, minGridY: 0, maxGridY: depthY };
      case 'south': return { minGridX: 0, maxGridX: GRID_COLS - 1, minGridY: GRID_ROWS - 1 - depthY, maxGridY: GRID_ROWS - 1 };
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
