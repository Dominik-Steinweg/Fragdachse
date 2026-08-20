import type { CoopDefenseEnemyMovementTarget } from '../config/coopDefenseEnemies';
import type { EnemyFlowFieldGoalCell } from './EnemyFlowFieldService';
import { EnemyFlowFieldService } from './EnemyFlowFieldService';
import type { EnemyAiTargetCandidate, EnemyAiTargetKind, EnemyAiTargetRef } from './EnemyAiTargetCatalog';

export type EnemyStrategicTargetKind = EnemyAiTargetKind;

export type EnemyStrategicTargetRef = EnemyAiTargetRef;

export interface EnemyStrategicTargetCandidate extends EnemyAiTargetCandidate {
  readonly goalCells: readonly EnemyFlowFieldGoalCell[];
}

/**
 * Gemeinsamer, dynamischer Zielkatalog fuer strategische Mehrziel-Gegner. Die Wegkosten stammen
 * ausschliesslich aus einem Multi-Source-Flow-Field; Ziel-IDs dienen nur dem stabilen Locking.
 */
export class EnemyStrategicTargetService {
  private readonly targets = new Map<string, EnemyStrategicTargetCandidate>();
  private readonly targetKeysByGoal = new Map<string, string[]>();

  constructor(private readonly flowField: EnemyFlowFieldService) {}

  updateTargets(candidates: readonly EnemyAiTargetCandidate[]): void {
    this.targets.clear();
    this.targetKeysByGoal.clear();
    const goals: EnemyFlowFieldGoalCell[] = [];

    for (const candidate of [...candidates]
      .filter((candidate): candidate is EnemyStrategicTargetCandidate => (
        candidate.goalCells !== undefined
        && candidate.goalCells.length > 0
        && (candidate.isTargetable?.() ?? true)
      ))
      .sort((left, right) => this.key(left).localeCompare(this.key(right)))) {
      const targetKey = this.key(candidate);
      this.targets.set(targetKey, candidate);
      for (const goal of candidate.goalCells) {
        const goalKey = this.goalKey(goal.gridX, goal.gridY);
        const mapped = this.targetKeysByGoal.get(goalKey) ?? [];
        mapped.push(targetKey);
        this.targetKeysByGoal.set(goalKey, mapped);
        goals.push(goal);
      }
    }

    this.flowField.setDynamicGoalCells(goals);
  }

  selectTarget(
    strategicTarget: CoopDefenseEnemyMovementTarget,
    worldX: number,
    worldY: number,
  ): EnemyStrategicTargetCandidate | null {
    if (strategicTarget !== 'players-and-armed-constructs') return null;
    const cell = this.flowField.worldToGrid(worldX, worldY);
    if (!cell) return null;
    const goal = this.flowField.getReachedGoalCellAt(cell.gridX, cell.gridY);
    if (!goal) return null;
    const keys = this.targetKeysByGoal.get(this.goalKey(goal.gridX, goal.gridY)) ?? [];
    let best: EnemyStrategicTargetCandidate | null = null;
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    for (const key of keys) {
      const candidate = this.targets.get(key);
      if (!candidate) continue;
      if (!(candidate.isTargetable?.() ?? true)) continue;
      const position = this.resolvePosition(candidate, worldX, worldY);
      if (!position) continue;
      const distanceSq = (position.x - worldX) ** 2 + (position.y - worldY) ** 2;
      if (distanceSq < bestDistanceSq) {
        best = candidate;
        bestDistanceSq = distanceSq;
      }
    }
    return best;
  }

  resolve(ref: EnemyStrategicTargetRef): EnemyStrategicTargetCandidate | null {
    const target = this.targets.get(this.key(ref));
    return target && (target.isTargetable?.() ?? true) ? target : null;
  }

  getPosition(
    ref: EnemyStrategicTargetRef,
    fromX: number,
    fromY: number,
  ): { x: number; y: number } | null {
    const target = this.resolve(ref);
    return target ? this.resolvePosition(target, fromX, fromY) : null;
  }

  clear(): void {
    this.targets.clear();
    this.targetKeysByGoal.clear();
    this.flowField.setDynamicGoalCells([]);
  }

  private resolvePosition(
    candidate: EnemyStrategicTargetCandidate,
    fromX: number,
    fromY: number,
  ): { x: number; y: number } | null {
    return candidate.resolvePosition?.(fromX, fromY) ?? { x: candidate.x, y: candidate.y };
  }

  private key(ref: EnemyStrategicTargetRef): string {
    return `${ref.kind}:${ref.id}`;
  }

  private goalKey(gridX: number, gridY: number): string {
    return `${gridX}:${gridY}`;
  }
}
