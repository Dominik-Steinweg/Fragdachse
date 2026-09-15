import type { ProjectileRuntimeRecord } from '../src/projectile/ProjectileRuntimeRecord';
import { createSingleOwnerProvenance } from '../src/projectile/ProjectileSpawnRequest';

/** Processor-level fixture: real collision rules, no renderer or physics simulation. */
export function collisionRecord(id: number, sx = 0, sy = 0, ex = 120, ey = 0, size = 12,
  mode: 'sweep' | 'overlap' = 'sweep'): ProjectileRuntimeRecord {
  const sprite = {
    x: ex, y: ey, displayWidth: size, displayHeight: size,
    getBounds(out: any = {}) {
      // Like Phaser, accept scratch output; expose numeric sides for headless callers.
      out.left = this.x - size / 2; out.right = this.x + size / 2;
      out.top = this.y - size / 2; out.bottom = this.y + size / 2;
      return out;
    },
  };
  const body = {
    enable: true, width: size, height: size, velocity: { x: 100, y: 0 },
    reset(x: number, y: number) { sprite.x = x; sprite.y = y; },
    setVelocity(x: number, y: number) { this.velocity.x = x; this.velocity.y = y; },
  };
  return {
    id, lastX: sx, lastY: sy, hitboxSize: size, damage: 10, adrenalinGain: 0,
    physics: { sprite, body }, provenance: createSingleOwnerProvenance('shooter'),
    spec: {
      flight: { collisionMode: mode, isFlame: true, penetration: {}, collisionFilter: {} },
      interaction: { directHit: {}, burn: {} },
    },
    contacts: {}, miniRocket: {}, interaction: {},
  } as unknown as ProjectileRuntimeRecord;
}

export function collisionRock(x: number, y: number, width = 64, height = width) {
  return {
    active: true, x, y, width, height, reads: 0,
    getBounds(out: any = {}) {
      this.reads++;
      out.left = this.x - this.width / 2; out.right = this.x + this.width / 2;
      out.top = this.y - this.height / 2; out.bottom = this.y + this.height / 2;
      return out;
    },
  };
}
