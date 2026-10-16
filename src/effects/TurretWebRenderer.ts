import * as Phaser from 'phaser';
import type { SyncedTurretWebSnapshot } from '../types';
import { getVisibleWorldView } from '../graphics/CameraWorldView';
import { TurretWebGpuLayer } from './gpu/TurretWebGpuLayer';
import { TURRET_WEB_KIND } from './gpu/TurretWebShader';

/** Web radius over a turret in world px. */
const WEB_RADIUS_PX = 30;
/** Quad margin around the web for anchor threads and the impact splat. */
const WEB_QUAD_FACTOR = 1.45;
const GLOB_RADIUS_PX = 4.2;
/** Height of the glob's arc over its flight, in px at the apex. */
const GLOB_ARC_PX = 16;
const VIEW_MARGIN_PX = 60;

/**
 * Presentation of Kabummtula webs as one GPU layer: a sticky glob flies in an arc on a silk strand
 * to the turret, then an orb web unfolds over it and tears before it expires. Pure projection of
 * the replicated `tw` slice on the synchronised clock; it never decides a web.
 */
export class TurretWebRenderer {
  private layer: TurretWebGpuLayer | null = null;
  private drawn = false;

  constructor(private readonly scene: Phaser.Scene) {}

  sync(snapshot: SyncedTurretWebSnapshot | null | undefined, now: number): void {
    const shots = snapshot?.shots ?? [], webs = snapshot?.webs ?? [];
    if (!shots.length && !webs.length) {
      if (this.drawn) { this.layer?.clear(); this.drawn = false; }
      return;
    }
    // The layer and its program load with the first web; maps without spiders never touch them.
    const layer = this.layer ??= new TurretWebGpuLayer(this.scene);
    const view = getVisibleWorldView(this.scene.cameras.main);
    const visible = (x: number, y: number, reach: number) => x + reach >= view.x && x - reach <= view.x + view.width
      && y + reach >= view.y && y - reach <= view.y + view.height;
    layer.begin(this.scene.time.now);
    for (const web of webs) {
      if (now < web.appliedAt || now >= web.expiresAt || !visible(web.x, web.y, WEB_RADIUS_PX * WEB_QUAD_FACTOR + VIEW_MARGIN_PX)) continue;
      const seed = seedOf(web.turretId);
      layer.add({ ax: web.x, ay: web.y, bx: web.x, by: web.y, halfWidth: WEB_RADIUS_PX * WEB_QUAD_FACTOR,
        kind: TURRET_WEB_KIND.web, t: (now - web.appliedAt) / 1000, seed,
        a1: WEB_RADIUS_PX, a2: (web.expiresAt - now) / 1000, a3: seed * 6.2831853 });
    }
    for (const shot of shots) {
      if (now >= shot.impactAt) continue;
      const progress = Phaser.Math.Clamp((now - shot.launchAt) / Math.max(1, shot.impactAt - shot.launchAt), 0, 1);
      const gx = Phaser.Math.Linear(shot.sourceX, shot.targetX, progress);
      const gy = Phaser.Math.Linear(shot.sourceY, shot.targetY, progress) - Math.sin(Math.PI * progress) * GLOB_ARC_PX;
      if (!visible((shot.sourceX + gx) / 2, (shot.sourceY + gy) / 2, Math.hypot(gx - shot.sourceX, gy - shot.sourceY) / 2 + VIEW_MARGIN_PX)) continue;
      const sag = Math.min(9, Math.hypot(gx - shot.sourceX, gy - shot.sourceY) * 0.05);
      layer.add({ ax: shot.sourceX, ay: shot.sourceY, bx: gx, by: gy, halfWidth: GLOB_RADIUS_PX * 1.6 + sag + 4,
        kind: TURRET_WEB_KIND.glob, t: Math.max(0, now - shot.launchAt) / 1000, seed: seedOf(shot.id),
        a1: GLOB_RADIUS_PX * (0.8 + 0.3 * progress), a2: sag });
    }
    layer.flush();
    this.drawn = layer.size > 0;
  }

  clear(): void {
    this.layer?.clear();
    this.drawn = false;
  }

  destroy(): void {
    this.layer?.destroy();
    this.layer = null;
  }
}

/** Deterministic per-turret seed in [0, 1) so neighbouring webs do not look stamped. */
function seedOf(id: number | string): number {
  let hash = 2166136261;
  for (const character of String(id)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return ((hash >>> 0) % 10007) / 10007;
}
