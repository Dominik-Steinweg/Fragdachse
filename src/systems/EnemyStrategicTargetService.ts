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
/**
 * Zielzuordnung und Zielmenge eines Rechendurchlaufs. Beides gehoert zusammen und wird erst
 * gemeinsam mit dem daraus berechneten Flowfield aktiviert.
 */
export interface PreparedStrategicTargets {
  readonly targets: ReadonlyMap<string, EnemyStrategicTargetCandidate>;
  readonly targetKeysByGoal: ReadonlyMap<string, string[]>;
  readonly goalCells: readonly EnemyFlowFieldGoalCell[];
}

export class EnemyStrategicTargetService {
  private targets: ReadonlyMap<string, EnemyStrategicTargetCandidate> = new Map();
  private targetKeysByGoal: ReadonlyMap<string, string[]> = new Map();

  constructor(private readonly flowField: EnemyFlowFieldService) {}

  /**
   * Baut die Zuordnung, ohne sie zu uebernehmen.
   *
   * `selectTarget` schlaegt eine Goal-Cell des aktiven Feldes in dieser Zuordnung nach. Wuerde die
   * Zuordnung sofort ersetzt, waehrend das Feld noch aus dem vorigen Durchlauf stammt, zeigte
   * `goalSourceField` auf Zellen, die die neue Zuordnung nicht mehr kennt.
   */
  prepareTargets(candidates: readonly EnemyAiTargetCandidate[]): PreparedStrategicTargets {
    const targets = new Map<string, EnemyStrategicTargetCandidate>();
    const targetKeysByGoal = new Map<string, string[]>();
    const goalCells: EnemyFlowFieldGoalCell[] = [];

    for (const candidate of [...candidates]
      .filter((candidate): candidate is EnemyStrategicTargetCandidate => (
        candidate.goalCells !== undefined
        && candidate.goalCells.length > 0
        && (candidate.isTargetable?.() ?? true)
      ))
      .sort((left, right) => this.key(left).localeCompare(this.key(right)))) {
      const targetKey = this.key(candidate);
      targets.set(targetKey, candidate);
      for (const goal of candidate.goalCells) {
        const goalKey = this.goalKey(goal.gridX, goal.gridY);
        const mapped = targetKeysByGoal.get(goalKey) ?? [];
        mapped.push(targetKey);
        targetKeysByGoal.set(goalKey, mapped);
        goalCells.push(goal);
      }
    }

    return { targets, targetKeysByGoal, goalCells };
  }

  /** Uebernimmt die vorbereitete Zuordnung; wird vom Coordinator zusammen mit dem Feld gerufen. */
  activate(prepared: PreparedStrategicTargets): void {
    this.targets = prepared.targets;
    this.targetKeysByGoal = prepared.targetKeysByGoal;
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
    this.targets = new Map();
    this.targetKeysByGoal = new Map();
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
