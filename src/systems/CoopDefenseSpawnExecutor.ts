import * as Phaser from 'phaser';
import { GRID_COLS, GRID_ROWS } from '../config';
import type { EnemyManager, EnemySpawnOptions } from '../entities/EnemyManager';
import type { BaseSpec } from '../arena/BaseRegistry';
import {
  getCoopDefenseEnemyConfig,
  type CoopDefenseEnemyKind,
} from '../config/coopDefenseEnemies';
import { EnemyFlowFieldService } from './EnemyFlowFieldService';

const RECENT_CELL_MEMORY = 12;
const MIN_INTRA_GROUP_DISTANCE_CELLS = 2;
const SPAWN_TUNNEL_DIG_TOLERANCE_CELLS = 2;

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
  ) {}

  /** Spawn-Pfad fuer endliche Encounter; die Herkunft bleibt fuer Clear-Tracking erhalten. */
  hostSpawnEncounterGroup(kind: CoopDefenseEnemyKind, count: number, originId?: string): readonly string[] {
    return this.spawnArenaGroup(kind, count, originId ? { originId } : undefined);
  }

  /** Map-gebundene persistente Quelle; diese Gegner gehoeren keinem Encounter an. */
  hostSpawnPersistentMapGroup(kind: CoopDefenseEnemyKind, count: number): readonly string[] {
    return this.spawnArenaGroup(kind, count);
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

  /** Einmaliger Boss-Spawn; die Boss-Quelle nutzt dieselbe raeumliche Auswahl wie Map-Spawns. */
  hostSpawnBoss(kind: CoopDefenseEnemyKind): boolean {
    const candidates = this.collectCandidates(kind, this.bossFlowFieldService ?? undefined);
    if (candidates.length === 0) {
      this.warnExhausted();
      return false;
    }

    const pick = Phaser.Math.RND.pick(candidates) as { gridX: number; gridY: number };
    this.enemyManager.hostSpawnDummyAt(pick.gridX, pick.gridY, kind);
    this.pushRecent(this.key(pick.gridX, pick.gridY));
    return true;
  }

  private spawnArenaGroup(
    kind: CoopDefenseEnemyKind,
    count: number,
    spawnOptions?: EnemySpawnOptions,
  ): string[] {
    const spawnedEnemyIds: string[] = [];
    if (count <= 0) return spawnedEnemyIds;
    const candidatesAll = this.collectCandidates(kind);
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

      const pick = Phaser.Math.RND.pick(candidates) as { gridX: number; gridY: number };
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
    flowFieldService = this.flowFieldService,
  ): { gridX: number; gridY: number }[] {
    if (getCoopDefenseEnemyConfig(kind).burrow?.spawnBurrowedAtLeftEdge) {
      return this.collectLeftEdgeCandidates(kind);
    }

    const enemies = this.enemyManager.getAllEnemies();
    const spawnRadius = getCoopDefenseEnemyConfig(kind).size * 0.5;
    const cells: { gridX: number; gridY: number }[] = [];
    // Derived from the live grid so a wide Coop map does not inherit the width that was
    // active when this module was imported.
    const maxGridX = Math.min(Math.max(2, Math.floor(GRID_COLS * 0.15)), GRID_COLS - 1);
    for (let gridX = 0; gridX <= maxGridX; gridX += 1) {
      for (let gridY = 0; gridY < GRID_ROWS; gridY += 1) {
        if (!flowFieldService.isTraversableAt(gridX, gridY)) continue;
        if (flowFieldService.getIntegrationValueAt(gridX, gridY) >= EnemyFlowFieldService.INTEGRATION_INFINITY) continue;
        const world = flowFieldService.gridToWorld(gridX, gridY);
        if (!world) continue;
        const overlapsEnemy = enemies.some((enemy) => {
          const minimumDistance = spawnRadius + enemy.getCollisionRadius();
          return Phaser.Math.Distance.Squared(world.x, world.y, enemy.sprite.x, enemy.sprite.y)
            < minimumDistance * minimumDistance;
        });
        if (!overlapsEnemy) cells.push({ gridX, gridY });
      }
    }
    return cells;
  }

  private collectLeftEdgeCandidates(kind: CoopDefenseEnemyKind): { gridX: number; gridY: number }[] {
    const enemies = this.enemyManager.getAllEnemies();
    const spawnRadius = getCoopDefenseEnemyConfig(kind).size * 0.5;
    const rows: { gridY: number; digCells: number | null }[] = [];
    let shortestDigCells = Number.POSITIVE_INFINITY;
    for (let gridY = 0; gridY < GRID_ROWS; gridY += 1) {
      const world = this.flowFieldService.gridToWorld(0, gridY);
      if (!world) continue;
      const overlapsEnemy = enemies.some((enemy) => {
        const minimumDistance = spawnRadius + enemy.getCollisionRadius();
        return Phaser.Math.Distance.Squared(world.x, world.y, enemy.sprite.x, enemy.sprite.y)
          < minimumDistance * minimumDistance;
      });
      if (overlapsEnemy) continue;
      const digCells = this.measureLeftEdgeDigDistance(gridY);
      if (digCells !== null) shortestDigCells = Math.min(shortestDigCells, digCells);
      rows.push({ gridY, digCells });
    }

    if (!Number.isFinite(shortestDigCells)) return rows.map((row) => ({ gridX: 0, gridY: row.gridY }));
    const maxDigCells = shortestDigCells + SPAWN_TUNNEL_DIG_TOLERANCE_CELLS;
    return rows
      .filter((row) => row.digCells !== null && row.digCells <= maxDigCells)
      .map((row) => ({ gridX: 0, gridY: row.gridY }));
  }

  private measureLeftEdgeDigDistance(gridY: number): number | null {
    for (let gridX = 0; gridX < GRID_COLS; gridX += 1) {
      if (!this.flowFieldService.isTraversableAt(gridX, gridY)) continue;
      if (this.flowFieldService.getIntegrationValueAt(gridX, gridY) >= EnemyFlowFieldService.INTEGRATION_INFINITY) continue;
      return gridX;
    }
    return null;
  }

  private pushRecent(key: string): void {
    this.recentCells.push(key);
    if (this.recentCells.length > RECENT_CELL_MEMORY) this.recentCells.shift();
  }

  private warnExhausted(): void {
    if (this.exhaustionWarned) return;
    this.exhaustionWarned = true;
    console.warn('[CoopDefenseSpawnExecutor] Keine freien Spawn-Zellen mehr im linken Arena-Bereich.');
  }

  private key(gridX: number, gridY: number): string {
    return `${gridX}:${gridY}`;
  }
}
