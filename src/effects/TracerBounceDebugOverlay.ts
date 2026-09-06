import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import type { ProjectileFlightPath } from '../projectile/ProjectileFlightPath';
import { registerGraphicsObject } from './EffectUtils';
import { tracerBounceDebug } from './TracerBounceDebugSettings';

/** Raw confirmed points, independent of ribbon tessellation, joins and material cursors. */
export class TracerBounceDebugOverlay {
  private graphics: Phaser.GameObjects.Graphics | null = null;
  private readonly paths = new Map<number, { path: ProjectileFlightPath; time: number; expires: number }>();
  private readonly impacts: { x: number; y: number; expires: number }[] = [];

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.on('postupdate', this.draw, this);
  }

  observe(id: number, path: ProjectileFlightPath, time: number): void {
    if (!path.points.some(p => p.bounceSequence !== undefined && p.timeMs <= time)) return;
    this.paths.delete(id);
    this.paths.set(id, { path, time, expires: this.scene.time.now + 1500 });
    if (this.paths.size > 32) this.paths.delete(this.paths.keys().next().value!);
  }

  impact(x: number, y: number): void {
    this.impacts.push({ x, y, expires: this.scene.time.now + 1500 });
    if (this.impacts.length > 64) this.impacts.shift();
  }

  private draw(): void {
    if (!tracerBounceDebug.centerline) {
      this.graphics?.destroy(); this.graphics = null;
      this.paths.clear(); this.impacts.length = 0;
      return;
    }
    if (!this.graphics) {
      this.graphics = this.scene.add.graphics().setDepth(DEPTH.OVERLAY - 1);
      registerGraphicsObject(this.scene, 'projectileShapes', this.graphics);
    }
    const g = this.graphics.clear(), now = this.scene.time.now;
    for (const [id, entry] of this.paths) {
      if (entry.expires <= now) { this.paths.delete(id); continue; }
      const points = entry.path.points;
      g.lineStyle(1, 0x00ffff, 1);
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        if (a.timeMs > entry.time) break;
        if (b.breakBefore) continue;
        // Clip only the not-yet-presented client suffix; never smooth or deduplicate.
        const u = b.timeMs > entry.time && b.timeMs > a.timeMs
          ? (entry.time - a.timeMs) / (b.timeMs - a.timeMs) : 1;
        g.lineBetween(a.x, a.y, a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u);
      }
      g.lineStyle(1, 0xffff00, 1);
      for (const p of points) if (p.bounceSequence !== undefined && p.timeMs <= entry.time) {
        g.lineBetween(p.x - 3, p.y, p.x + 3, p.y);
        g.lineBetween(p.x, p.y - 3, p.x, p.y + 3);
      }
    }
    g.lineStyle(1, 0xff00ff, 1);
    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const p = this.impacts[i];
      if (p.expires <= now) this.impacts.splice(i, 1);
      else g.strokeRect(p.x - 4, p.y - 4, 8, 8);
    }
    // Technical positions exist only on this browser's host; never infer them on clients.
    for (const record of tracerBounceDebug.records) {
      if (performance.now() - record.capturedAt > 1500 || !this.paths.has(record.projectileId)) continue;
      const c = record.correctedCenter;
      g.lineStyle(1, 0x40ff40, 1);
      g.lineBetween(c.x, c.y - 4, c.x + 4, c.y);
      g.lineBetween(c.x + 4, c.y, c.x, c.y + 4);
      g.lineBetween(c.x, c.y + 4, c.x - 4, c.y);
      g.lineBetween(c.x - 4, c.y, c.x, c.y - 4);
      if (record.firstFollow) {
        const f = record.firstFollow;
        g.lineStyle(1, 0xff8800, 1);
        g.strokeRect(f.x - 2, f.y - 2, 4, 4);
      }
    }
  }

  destroy(): void {
    this.scene.events.off('postupdate', this.draw, this);
    this.graphics?.destroy(); this.graphics = null;
    this.paths.clear(); this.impacts.length = 0;
  }
}
