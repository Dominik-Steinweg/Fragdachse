import type { EnemyFlowFieldGoalCell } from './EnemyFlowFieldService';

export type EnemyAiTargetKind = 'player' | 'decoy' | 'armed-construct' | 'armed-outpost';

export type EnemyAiTargetGroup =
  | 'player-like'
  | 'players'
  | 'players-and-armed-constructs'
  | 'armed-constructs'
  | 'armed-outposts';

export interface EnemyAiTargetRef {
  readonly kind: EnemyAiTargetKind;
  readonly id: string;
}

export interface EnemyAiTargetCandidate extends EnemyAiTargetRef {
  readonly x: number;
  readonly y: number;
  readonly radius?: number;
  readonly ownerId?: string;
  readonly goalCells?: readonly EnemyFlowFieldGoalCell[];
  /** Resolves the current position without turning the target into a PlayerEntity. */
  readonly resolvePosition?: (fromX: number, fromY: number) => { x: number; y: number } | null;
  /** Cheap live validity check used by locks and homing between catalog refreshes. */
  readonly isTargetable?: () => boolean;
}

/**
 * Shared, host-side source of semantic AI targets. The catalog deliberately owns no damage
 * logic; it only describes target identity, live position and the groups consumers may query.
 */
export class EnemyAiTargetCatalog {
  private readonly targets = new Map<string, EnemyAiTargetCandidate>();
  private readonly groups = new Map<EnemyAiTargetGroup, EnemyAiTargetCandidate[]>();

  updateTargets(candidates: readonly EnemyAiTargetCandidate[]): void {
    this.targets.clear();
    for (const group of ['player-like', 'players', 'players-and-armed-constructs', 'armed-constructs', 'armed-outposts'] as const) {
      const entries = this.groups.get(group);
      if (entries) entries.length = 0;
      else this.groups.set(group, []);
    }

    const ordered = [...candidates].sort((left, right) => this.key(left).localeCompare(this.key(right)));
    for (const candidate of ordered) {
      this.targets.set(this.key(candidate), candidate);
      if (candidate.kind === 'player' || candidate.kind === 'decoy') {
        this.groups.get('player-like')!.push(candidate);
        this.groups.get('players-and-armed-constructs')!.push(candidate);
      }
      if (candidate.kind === 'player') this.groups.get('players')!.push(candidate);
      if (candidate.kind === 'armed-construct') {
        this.groups.get('armed-constructs')!.push(candidate);
        this.groups.get('players-and-armed-constructs')!.push(candidate);
      }
      if (candidate.kind === 'armed-outpost') {
        this.groups.get('armed-outposts')!.push(candidate);
        this.groups.get('players-and-armed-constructs')!.push(candidate);
      }
    }
  }

  getCandidates(group: EnemyAiTargetGroup): readonly EnemyAiTargetCandidate[] {
    const candidates = this.groups.get(group);
    if (!candidates) return [];
    return candidates.filter((candidate) => this.isTargetable(candidate));
  }

  forEachTarget(group: EnemyAiTargetGroup, visitor: (target: EnemyAiTargetCandidate) => void): void {
    for (const target of this.groups.get(group) ?? []) {
      if (!this.isTargetable(target)) continue;
      visitor(target);
    }
  }

  resolve(ref: EnemyAiTargetRef): EnemyAiTargetCandidate | null {
    const target = this.targets.get(this.key(ref));
    return target && this.isTargetable(target) ? target : null;
  }

  isTargetValid(ref: EnemyAiTargetRef): boolean {
    return this.resolve(ref) !== null;
  }

  getPosition(ref: EnemyAiTargetRef, fromX: number, fromY: number): { x: number; y: number } | null {
    const target = this.resolve(ref);
    if (!target) return null;
    return target.resolvePosition ? target.resolvePosition(fromX, fromY) : { x: target.x, y: target.y };
  }

  getStrategicCandidates(): readonly EnemyAiTargetCandidate[] {
    const result: EnemyAiTargetCandidate[] = [];
    for (const target of this.targets.values()) {
      if (!target.goalCells || target.goalCells.length === 0 || !this.isTargetable(target)) continue;
      result.push(target);
    }
    return result;
  }

  clear(): void {
    this.targets.clear();
    for (const entries of this.groups.values()) entries.length = 0;
  }

  private isTargetable(target: EnemyAiTargetCandidate): boolean {
    return target.isTargetable?.() ?? true;
  }

  private key(ref: EnemyAiTargetRef): string {
    return `${ref.kind}:${ref.id}`;
  }
}
