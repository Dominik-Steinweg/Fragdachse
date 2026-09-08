import type { DecoyEnd, DecoyState } from './DecoyRuntime';
import type { EnemyAiTargetCandidate, EnemyAiTargetRef } from './EnemyAiTargetCatalog';
import { EnemyFlowFieldService } from './EnemyFlowFieldService';
import { EnemyStrategicTargetService, type PreparedStrategicTargets } from './EnemyStrategicTargetService';
import { ENEMY_FLOW_FIELD_IDS, type FlowFieldCoordinator, type FlowFieldFieldView } from './flowfield/FlowFieldCoordinator';
import { goalCellsToIndexes } from './flowfield/FlowFieldSources';

export interface DecoyEnemyTargetSubject {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly alive: boolean;
  readonly hostile: boolean;
  readonly clearanceCells: number;
  readonly movementFieldId: string;
}

export interface DecoyAiTarget extends EnemyAiTargetRef {
  readonly kind: 'decoy';
  readonly x: number;
  readonly y: number;
}

/** One override shared by movement, positioning and aimed attacks. Reads never count as use. */
export interface DecoyTargetPort {
  getTarget(enemyId: string): DecoyAiTarget | null;
  getMovementField(enemyId: string): EnemyFlowFieldService | null;
  usedTarget(enemyId: string, target?: EnemyAiTargetRef): void;
}

interface SharedDecoyField {
  readonly decoyId: number;
  readonly view: FlowFieldFieldView;
  readonly service: EnemyFlowFieldService;
  goalIndex: number;
  activatedGoalIndex: number;
}

export interface CoopDefenseDecoyTargetOptions {
  readonly coordinator: FlowFieldCoordinator;
  readonly getEnemies: () => readonly DecoyEnemyTargetSubject[];
  readonly getAttackTarget: (enemyId: string) => EnemyAiTargetRef | null;
  readonly isEnemyOfOwner: (enemyId: string, ownerId: string) => boolean;
  readonly canSee: (enemy: DecoyEnemyTargetSubject, x: number, y: number, range: number) => boolean;
  readonly strategicTargets: EnemyStrategicTargetService;
}

/** Activity-owned sticky locks and engagement ledger; navigation is shared per decoy/profile. */
export class CoopDefenseDecoyTargetSystem implements DecoyTargetPort {
  private readonly decoys = new Map<number, Readonly<DecoyState>>();
  private readonly locks = new Map<string, number>();
  private readonly used = new Map<number, Set<string>>();
  private readonly fields = new Map<string, SharedDecoyField>();
  private readonly subjects = new Map<string, DecoyEnemyTargetSubject>();
  private readonly baseline = new Map<string, Set<string>>();
  private readonly ordinaryTargets = new Map<string, EnemyStrategicTargetService>();
  private readonly releaseMappings: Array<() => void> = [];

  constructor(private readonly options: CoopDefenseDecoyTargetOptions) {
    for (const id of [ENEMY_FLOW_FIELD_IDS.player, ENEMY_FLOW_FIELD_IDS.boss]) {
      const view = options.coordinator.getFieldView(id);
      if (!view) continue;
      const service = EnemyFlowFieldService.fromView(view);
      const targets = new EnemyStrategicTargetService(service);
      this.ordinaryTargets.set(id, targets);
      this.releaseMappings.push(view.onActivated(payload => {
        if (payload) targets.activate(payload as PreparedStrategicTargets);
      }), () => service.destroy());
    }
  }

  /** Called before owner stealth removes their goal from ordinary target selection. */
  beforeActivate(ownerId: string): void {
    const followers = new Set<string>();
    for (const enemy of this.options.getEnemies()) {
      if (!this.eligible(enemy, ownerId) || this.locks.has(enemy.id)) continue;
      const attack = this.options.getAttackTarget(enemy.id);
      const targets = enemy.movementFieldId === ENEMY_FLOW_FIELD_IDS.strategic
        ? this.options.strategicTargets : this.ordinaryTargets.get(enemy.movementFieldId);
      const movement = targets?.selectFlowTarget(enemy.x, enemy.y);
      if ((attack?.kind === 'player' && attack.id === ownerId)
        || (movement?.kind === 'player' && movement.id === ownerId)) followers.add(enemy.id);
    }
    this.baseline.set(ownerId, followers);
  }

  activated(decoy: Readonly<DecoyState>): void {
    this.decoys.set(decoy.id, decoy);
    this.used.set(decoy.id, new Set());
    for (const id of this.baseline.get(decoy.ownerId) ?? []) {
      if (!this.locks.has(id)) this.locks.set(id, decoy.id);
    }
    this.baseline.delete(decoy.ownerId);
  }

  /** Mapping payloads travel with the same ordinary field computation as its goals. */
  prepareOrdinaryGoals(candidates: readonly EnemyAiTargetCandidate[]): void {
    const players = candidates.filter(target => target.kind === 'player');
    for (const [id, targets] of this.ordinaryTargets) {
      const prepared = targets.prepareTargets(players);
      this.options.coordinator.setGoalCells(id,
        goalCellsToIndexes(prepared.goalCells, this.options.coordinator.metrics), prepared);
    }
  }

  /** Register only profiles needed by current locks or eligible L2 candidates, before nav tick. */
  prepareNavigation(): void {
    this.subjects.clear();
    const preparedFields = new Set<string>();
    for (const enemy of this.options.getEnemies()) {
      this.subjects.set(enemy.id, enemy);
      if (!enemy.alive || !enemy.hostile) { this.locks.delete(enemy.id); continue; }
      for (const decoy of this.decoys.values()) {
        if (!this.eligible(enemy, decoy.ownerId)) continue;
        if (this.locks.get(enemy.id) !== decoy.id
          && !(decoy.config.lureRadius > 0 && this.inRadius(enemy, decoy, decoy.config.lureRadius))) continue;
        const key = this.fieldId(decoy.id, enemy.clearanceCells);
        if (preparedFields.has(key)) continue;
        preparedFields.add(key);
        let field = this.fields.get(key);
        if (!field) {
          const view = this.options.coordinator.registerField(key, {
            goalMode: 'dynamic', clearanceCells: enemy.clearanceCells,
          });
          field = { decoyId: decoy.id, view, service: EnemyFlowFieldService.fromView(view), goalIndex: -1, activatedGoalIndex: -2 };
          const ownedField = field;
          view.onActivated(payload => { ownedField.activatedGoalIndex = payload as number; });
          this.fields.set(key, field);
        }
        const cell = field.service.worldToGrid(decoy.position.x, decoy.position.y);
        field.goalIndex = cell ? cell.gridY * field.view.metrics.cols + cell.gridX : -1;
        field.view.setGoals(field.goalIndex >= 0 ? [field.goalIndex] : [], field.goalIndex);
      }
    }
    for (const id of this.locks.keys()) if (!this.subjects.has(id)) this.locks.delete(id);
  }

  /** Pending worker results never prove a target unreachable. First valid lock is not stolen. */
  updateLocks(): void {
    for (const enemy of this.subjects.values()) {
      const lockedId = this.locks.get(enemy.id);
      if (lockedId !== undefined) {
        const decoy = this.decoys.get(lockedId);
        if (decoy && this.eligible(enemy, decoy.ownerId) && this.reachability(enemy, decoy) !== 'unreachable') continue;
        this.locks.delete(enemy.id);
      }
      let best: Readonly<DecoyState> | null = null;
      let bestDistance = Infinity;
      for (const decoy of this.decoys.values()) {
        if (!this.eligible(enemy, decoy.ownerId) || decoy.config.lureRadius <= 0
          || !this.inRadius(enemy, decoy, decoy.config.lureRadius)
          || !this.options.canSee(enemy, decoy.position.x, decoy.position.y, decoy.config.lureRadius)
          || this.reachability(enemy, decoy) !== 'reachable') continue;
        const distance = (enemy.x - decoy.position.x) ** 2 + (enemy.y - decoy.position.y) ** 2;
        if (distance < bestDistance || (distance === bestDistance && decoy.id < best!.id)) {
          best = decoy; bestDistance = distance;
        }
      }
      if (best) this.locks.set(enemy.id, best.id);
    }
  }

  getTarget(enemyId: string): DecoyAiTarget | null {
    const id = this.locks.get(enemyId);
    const decoy = id === undefined ? null : this.decoys.get(id);
    return decoy ? { kind: 'decoy', id: String(decoy.id), x: decoy.position.x, y: decoy.position.y } : null;
  }

  getMovementField(enemyId: string): EnemyFlowFieldService | null {
    const id = this.locks.get(enemyId), enemy = this.subjects.get(enemyId);
    return id === undefined || !enemy ? null : this.fields.get(this.fieldId(id, enemy.clearanceCells))?.service ?? null;
  }

  usedTarget(enemyId: string, target?: EnemyAiTargetRef): void {
    const id = target?.kind === 'decoy' ? Number(target.id) : target ? undefined : this.locks.get(enemyId);
    if (id === undefined || !this.decoys.has(id)) return;
    const lock = this.locks.get(enemyId);
    if (lock !== undefined && lock !== id) return;
    this.locks.set(enemyId, id);
    this.used.get(id)?.add(enemyId);
  }

  /** Captures refund eligibility before any end explosion can kill or move an enemy. */
  ended(event: DecoyEnd): number {
    let count = 0;
    if (event.reason !== 'cleanup' && event.decoy.config.refundRadius > 0) {
      const engaged = this.used.get(event.decoy.id);
      for (const enemy of this.options.getEnemies()) {
        if (engaged?.has(enemy.id) && this.eligible(enemy, event.decoy.ownerId)
          && Math.hypot(enemy.x - event.x, enemy.y - event.y) <= event.decoy.config.refundRadius) count++;
      }
    }
    this.decoys.delete(event.decoy.id);
    this.used.delete(event.decoy.id);
    for (const [enemyId, id] of this.locks) if (id === event.decoy.id) this.locks.delete(enemyId);
    for (const [id, field] of this.fields) if (field.decoyId === event.decoy.id) this.releaseField(id, field);
    return count;
  }

  destroy(): void {
    for (const [id, field] of this.fields) this.releaseField(id, field);
    for (const release of this.releaseMappings) release();
    this.releaseMappings.length = 0;
    this.decoys.clear(); this.locks.clear(); this.used.clear(); this.subjects.clear(); this.baseline.clear();
    this.ordinaryTargets.clear();
  }

  private reachability(enemy: DecoyEnemyTargetSubject, decoy: Readonly<DecoyState>): 'pending' | 'reachable' | 'unreachable' {
    const field = this.fields.get(this.fieldId(decoy.id, enemy.clearanceCells));
    const snapshot = field?.view.snapshot();
    if (!field || !snapshot || snapshot.topologyVersion !== this.options.coordinator.getTopologyVersion()
      || field.goalIndex !== field.activatedGoalIndex) return 'pending';
    const cell = field.service.worldToGrid(enemy.x, enemy.y);
    if (!cell) return 'unreachable';
    // Collision displacement into an obstacle is recoverable by the ordinary movement code.
    if (!field.service.isTraversableAt(cell.gridX, cell.gridY)) return 'pending';
    return field.service.getIntegrationValueAt(cell.gridX, cell.gridY) < EnemyFlowFieldService.INTEGRATION_INFINITY
      ? 'reachable' : 'unreachable';
  }

  private eligible(enemy: DecoyEnemyTargetSubject, ownerId: string): boolean {
    return enemy.alive && enemy.hostile && this.options.isEnemyOfOwner(enemy.id, ownerId);
  }

  private inRadius(enemy: DecoyEnemyTargetSubject, decoy: Readonly<DecoyState>, radius: number): boolean {
    return (enemy.x - decoy.position.x) ** 2 + (enemy.y - decoy.position.y) ** 2 <= radius ** 2;
  }

  private fieldId(id: number, clearance: number): string { return `decoy:${id}:${clearance}`; }

  private releaseField(id: string, field: SharedDecoyField): void {
    field.service.destroy();
    this.options.coordinator.unregisterField(id);
    this.fields.delete(id);
  }
}
