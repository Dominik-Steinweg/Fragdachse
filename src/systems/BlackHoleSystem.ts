import type { EnemyManager } from '../entities/EnemyManager';
import type { HostPhysicsSystem } from './HostPhysicsSystem';

const PULL_INTERVAL_MS = 100;

export interface BlackHoleConfig {
  radius: number;
  durationMs: number;
  pullStrength: number;
  ownerId: string;
}

interface ActiveBlackHole extends BlackHoleConfig {
  x: number;
  y: number;
  expiresAt: number;
  nextPullAt: number;
}

/** Host-authoritative, throttled enemy pull fields spawned by rocket explosions. */
export class BlackHoleSystem {
  private readonly activeFields: ActiveBlackHole[] = [];

  constructor(
    private readonly getEnemyManager: () => EnemyManager | null,
    private readonly hostPhysics: HostPhysicsSystem,
  ) {}

  create(x: number, y: number, config: BlackHoleConfig, now: number): void {
    if (config.radius <= 0 || config.durationMs <= 0 || config.pullStrength <= 0) return;
    this.activeFields.push({
      ...config,
      x,
      y,
      expiresAt: now + config.durationMs,
      nextPullAt: now,
    });
  }

  update(now: number): void {
    const enemyManager = this.getEnemyManager();
    for (let index = this.activeFields.length - 1; index >= 0; index -= 1) {
      const field = this.activeFields[index];
      if (now >= field.expiresAt) {
        this.activeFields.splice(index, 1);
        continue;
      }
      if (!enemyManager || now < field.nextPullAt) continue;

      field.nextPullAt = now + PULL_INTERVAL_MS;
      const intervalSeconds = PULL_INTERVAL_MS / 1000;
      for (const enemy of enemyManager.getAllEnemies()) {
        const dx = field.x - enemy.sprite.x;
        const dy = field.y - enemy.sprite.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= 0.001 || distance > field.radius) continue;

        const falloff = 1 - distance / field.radius;
        const impulse = field.pullStrength * falloff * intervalSeconds;
        this.hostPhysics.addRecoil(
          enemy.id,
          (dx / distance) * impulse,
          (dy / distance) * impulse,
          PULL_INTERVAL_MS + 40,
          field.ownerId,
        );
      }
    }
  }

  clear(): void {
    this.activeFields.length = 0;
  }
}
