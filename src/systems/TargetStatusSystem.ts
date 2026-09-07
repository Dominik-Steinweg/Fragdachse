/**
 * Gemeinsame hostautoritative Zielstatus. Die Klasse kennt bewusst keine Phaser-Objekte:
 * Treffer- und Netzwerkpfade koennen deshalb denselben Zustand verwenden, waehrend Renderer
 * nur den replizierten Snapshot lesen.
 */

export type TargetStatusTargetType =
  | 'player'
  | 'enemy'
  | 'base'
  | 'construction'
  | 'rock'
  | 'wall'
  | 'outpost'
  | 'structure';

export interface TargetStatusTarget {
  readonly targetType: TargetStatusTargetType;
  readonly targetId: string;
}

export interface SyncedTargetVulnerability extends TargetStatusTarget {
  readonly expiresAt: number;
}

export const VULNERABILITY_INCOMING_DAMAGE_BONUS = 0.2;

function statusKey(target: TargetStatusTarget): string {
  return `${target.targetType}:${target.targetId}`;
}

/** Einziger Speicher fuer allgemeine Verwundbarkeit. */
export class TargetStatusSystem {
  private vulnerableUntil = new Map<string, SyncedTargetVulnerability>();

  applyVulnerability(
    target: TargetStatusTarget,
    durationMs: number,
    now: number,
  ): SyncedTargetVulnerability | null {
    if (durationMs <= 0 || !Number.isFinite(durationMs) || !target.targetId) return null;
    const key = statusKey(target);
    const existing = this.vulnerableUntil.get(key);
    const next: SyncedTargetVulnerability = {
      targetType: target.targetType,
      targetId: target.targetId,
      // Nicht stapeln: eine kuerzere Folgeanwendung darf eine laengere nicht abschwaechen.
      expiresAt: Math.max(existing?.expiresAt ?? 0, now + durationMs),
    };
    this.vulnerableUntil.set(key, next);
    return { ...next };
  }

  /** Passive read: an expired entry is neutral but remains until the explicit prune step. */
  isVulnerable(target: TargetStatusTarget, now: number): boolean {
    const entry = this.vulnerableUntil.get(statusKey(target));
    return Boolean(entry && now < entry.expiresAt);
  }

  /** Eingehender Multiplikator aus allen allgemeinen Verwundbarkeitsquellen. */
  getIncomingDamageMultiplier(target: TargetStatusTarget, now: number): number {
    return this.isVulnerable(target, now)
      ? 1 + VULNERABILITY_INCOMING_DAMAGE_BONUS
      : 1;
  }

  /** Snapshot construction is a read and cannot advance the authoritative state. */
  getSnapshot(now: number): SyncedTargetVulnerability[] {
    return [...this.vulnerableUntil.values()]
      .filter((entry) => now < entry.expiresAt)
      .sort((left, right) => `${left.targetType}:${left.targetId}`.localeCompare(`${right.targetType}:${right.targetId}`))
      .map((entry) => ({ ...entry }));
  }

  /** Client: uebernimmt absolute Ablaufzeitpunkte aus dem autoritativen Snapshot. */
  syncFromSnapshot(snapshot: readonly SyncedTargetVulnerability[]): void {
    this.vulnerableUntil = new Map(
      snapshot
        .filter((entry) => Boolean(entry?.targetType) && typeof entry.targetId === 'string')
        .map((entry) => [statusKey(entry), { ...entry }]),
    );
  }

  removeTarget(target: TargetStatusTarget): void {
    this.vulnerableUntil.delete(statusKey(target));
  }

  removeTargetId(targetId: string): void {
    for (const [key, entry] of this.vulnerableUntil) {
      if (entry.targetId === targetId) this.vulnerableUntil.delete(key);
    }
  }

  removeTargetsOfType(targetType: TargetStatusTargetType): void {
    for (const [key, entry] of this.vulnerableUntil) {
      if (entry.targetType === targetType) this.vulnerableUntil.delete(key);
    }
  }

  prune(now: number): void {
    for (const [key, entry] of this.vulnerableUntil) {
      if (now >= entry.expiresAt) this.vulnerableUntil.delete(key);
    }
  }

  clear(): void {
    this.vulnerableUntil.clear();
  }
}
