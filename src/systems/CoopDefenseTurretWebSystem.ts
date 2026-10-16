import type { EnemyEntity } from '../entities/EnemyEntity';
import type { SyncedTurretWeb, SyncedTurretWebSnapshot, SyncedWebShot } from '../types';
import type { KaboomtulaWebCandidate, KaboomtulaWebPort, KaboomtulaWebShot } from './CoopDefenseKaboomtulaSystem';
import type { AutomatedTurretId } from './TurretFireSource';

/** A friendly turret a spider may web (player-built, persistent reward or authored base turret). */
export interface TurretWebTarget {
  readonly id: AutomatedTurretId;
  readonly x: number;
  readonly y: number;
  /** Line-of-fire exemptions of the turret itself (its rock, its carrier base). */
  readonly skipRockIndex?: number;
  readonly sourceCarrierBaseId?: string;
}

export interface TurretWebPorts {
  /** Friendly turrets that exist right now. */
  readonly turrets: () => readonly TurretWebTarget[];
  /** Would this turret's line of fire reach the point (its own rock and carrier base exempt)? */
  readonly canSee: (turret: TurretWebTarget, x: number, y: number) => boolean;
}

interface Web { readonly appliedAt: number; readonly expiresAt: number; x: number; y: number }

/**
 * Activity-owned turret webs of the Kabummtula: reservations against double targeting, web globs
 * in flight and the disabled turrets they produce. A web applies at the shot's impact time by turret
 * id and is refreshed, never stacked, by a later web. World turret fire only reads `isWebbed`.
 */
export class CoopDefenseTurretWebSystem implements KaboomtulaWebPort {
  private readonly reservations = new Map<AutomatedTurretId, string>();
  private readonly shots = new Map<number, KaboomtulaWebShot & { readonly id: number }>();
  private readonly webs = new Map<AutomatedTurretId, Web>();
  private nextShotId = 1;

  constructor(private readonly ports: TurretWebPorts) {}

  candidates(enemy: EnemyEntity, rangePx: number, now: number): readonly KaboomtulaWebCandidate[] {
    const x = enemy.sprite.x, y = enemy.sprite.y, result: KaboomtulaWebCandidate[] = [];
    for (const turret of this.ports.turrets()) {
      if (Math.hypot(turret.x - x, turret.y - y) > rangePx || !this.ports.canSee(turret, x, y)) continue;
      const web = this.webs.get(turret.id);
      result.push({ turretId: turret.id, x: turret.x, y: turret.y,
        webbedUntil: web && web.expiresAt > now ? web.expiresAt : 0,
        reserved: this.isReserved(turret.id, enemy.id) });
    }
    return result;
  }

  reserve(turretId: AutomatedTurretId, enemyId: string): void {
    this.reservations.set(turretId, enemyId);
  }

  release(turretId: AutomatedTurretId, enemyId: string): void {
    if (this.reservations.get(turretId) === enemyId) this.reservations.delete(turretId);
  }

  launch(shot: KaboomtulaWebShot): void {
    this.reservations.delete(shot.turretId);
    const id = this.nextShotId++;
    this.shots.set(id, { ...shot, id });
  }

  hostUpdate(now: number): void {
    if (!this.shots.size && !this.webs.size && !this.reservations.size) return;
    const turrets = new Map(this.ports.turrets().map(turret => [turret.id, turret]));
    for (const [id, shot] of this.shots) {
      if (now < shot.impactAt) continue;
      this.shots.delete(id);
      const turret = turrets.get(shot.turretId);
      // A turret removed during the flight lets the web fizzle.
      if (turret) this.webs.set(shot.turretId, { appliedAt: shot.impactAt, expiresAt: shot.impactAt + shot.durationMs,
        x: turret.x, y: turret.y });
    }
    for (const [id, web] of this.webs) {
      const turret = turrets.get(id);
      if (!turret || now >= web.expiresAt) { this.webs.delete(id); continue; }
      web.x = turret.x; web.y = turret.y;
    }
    for (const id of this.reservations.keys()) if (!turrets.has(id)) this.reservations.delete(id);
  }

  isWebbed(turretId: AutomatedTurretId, now: number): boolean {
    const web = this.webs.get(turretId);
    return !!web && now >= web.appliedAt && now < web.expiresAt;
  }

  /** Reserved by another spider or already hit by a web in flight. */
  private isReserved(turretId: AutomatedTurretId, enemyId: string): boolean {
    const owner = this.reservations.get(turretId);
    if (owner !== undefined && owner !== enemyId) return true;
    for (const shot of this.shots.values()) if (shot.turretId === turretId) return true;
    return false;
  }

  getSnapshot(): SyncedTurretWebSnapshot {
    const shots: SyncedWebShot[] = [...this.shots.values()].map(shot => ({ id: shot.id, turretId: shot.turretId,
      sourceX: Math.round(shot.sourceX), sourceY: Math.round(shot.sourceY), targetX: Math.round(shot.targetX),
      targetY: Math.round(shot.targetY), launchAt: shot.launchAt, impactAt: shot.impactAt }));
    const webs: SyncedTurretWeb[] = [...this.webs].map(([turretId, web]) => ({ turretId,
      x: Math.round(web.x), y: Math.round(web.y), appliedAt: web.appliedAt, expiresAt: web.expiresAt }));
    return { shots, webs };
  }

  clear(): void {
    this.reservations.clear();
    this.shots.clear();
    this.webs.clear();
  }
}

export const EMPTY_TURRET_WEB_SNAPSHOT: SyncedTurretWebSnapshot = Object.freeze({
  shots: [] as SyncedWebShot[], webs: [] as SyncedTurretWeb[],
}) as SyncedTurretWebSnapshot;
