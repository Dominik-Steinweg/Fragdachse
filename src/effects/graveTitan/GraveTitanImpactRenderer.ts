import type * as Phaser from 'phaser';
import { EarthbreakFissureStore } from '../earthbreak/EarthbreakFissureStore';
import { createEarthbreakFissureLayers, type EarthbreakFissureLayers, type FissurePalette } from '../earthbreak/EarthbreakFissureGpuLayer';
import type { GpuVfxSystem } from '../gpu/GpuVfxSystem';
import type { TerrainColorSnapshot } from '../../arena/TerrainColorSnapshot';
import { GRAVE_TITAN_IMPACT, graveTitanImpactGeometry, type GraveTitanImpactGeometry } from './graveTitanImpactGeometry';

/** Green grave light instead of embers: deep, glowing seam and a restrained (never white) core. */
export const GRAVE_LIGHT_FISSURES: FissurePalette = {
  name: 'GraveLight', ember: [0.08, 0.36, 0.13], glow: [0.30, 0.92, 0.40], hot: [0.62, 1.0, 0.62], preGlow: 0.45,
};

type Normal = readonly [number, number];

function direction(a: { x: number; y: number }, b: { x: number; y: number }): Normal {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
  return [dx / length, dy / length];
}

function bisector(a: Normal, b: Normal): Normal | null {
  const x = a[0] + b[0], y = a[1] + b[1], length = Math.hypot(x, y);
  return length > 0.1 ? [x / length, y / length] : null;
}

/** Host-fixed melee windup as the presentation sees it (synchronized host times). */
export interface GraveTitanWindup {
  readonly attackId: string;
  readonly startedAt: number;
  readonly strikeAt: number;
  readonly hitAt: number;
  readonly angle: number;
  readonly range: number;
  readonly arcDegrees: number;
}

interface WindupCracks {
  readonly attackId: string;
  readonly keys: readonly string[];
  readonly geometry: GraveTitanImpactGeometry;
  /** Hit time on the GPU clock. */
  readonly hitAt: number;
}

function hashAttack(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  return hash >>> 0;
}

/**
 * Grave Titan slam and stomp ground. During the windup hairline cracks creep through the struck
 * area (a second warning beside the red danger sector); at the hit they ignite, tear open and
 * collapse into a glowing scar around a crater. A strike whose windup this client never saw tears
 * the ground at once. Reuses the Earthbreak fissure store and shader with the grave-light palette;
 * pure presentation of host-fixed windups and confirmed swings.
 */
export class GraveTitanImpactRenderer {
  private readonly fissures = new EarthbreakFissureStore();
  private readonly layers: EarthbreakFissureLayers;
  private readonly unregister: () => void;
  private readonly windups = new Map<string, WindupCracks>();
  private serial = 0;
  private destroyed = false;

  private terrain: TerrainColorSnapshot | null = null;

  constructor(scene: Phaser.Scene, private readonly gpu: GpuVfxSystem) {
    this.layers = createEarthbreakFissureLayers(scene, this.fissures, () => gpu.now(), GRAVE_LIGHT_FISSURES);
    this.unregister = gpu.registerEmission((_delta, now) => this.tick(now));
  }

  /** Trench and lip take the struck ground's colour. */
  setTerrainColorSnapshot(snapshot: TerrainColorSnapshot | null): void { this.terrain = snapshot; }

  /**
   * Per frame for every slam-preset body: a new windup lays its cracks on the windup timeline; a
   * windup that vanishes before its hit (interrupted, body gone) closes them again.
   */
  syncWindup(id: string, attack: GraveTitanWindup | null, x: number, y: number, now: number, visible: boolean): void {
    if (this.destroyed) return;
    const current = this.windups.get(id), gpuNow = this.gpu.now();
    if (current && current.attackId === attack?.attackId) return;
    if (current) {
      if (gpuNow < current.hitAt) for (const key of current.keys) this.fissures.cancel(key, gpuNow);
      this.windups.delete(id);
    }
    if (!attack || !visible || now >= attack.hitAt) return;
    const offset = gpuNow - now, fx = GRAVE_TITAN_IMPACT;
    const geometry = graveTitanImpactGeometry(x, y, attack.angle, attack.arcDegrees, attack.range, hashAttack(attack.attackId));
    const start = attack.startedAt + offset, span = Math.max(1, attack.strikeAt - attack.startedAt), hitAt = attack.hitAt + offset;
    const keys = this.writeCracks(`${++this.serial}`, geometry, k => start + span * (0.12 + 0.8 * k / fx.segments), hitAt, gpuNow);
    this.windups.set(id, { attackId: attack.attackId, keys, geometry, hitAt });
    this.fissures.commit();
  }

  /** Breaks the ground for one confirmed swing and returns its impact centre and struck radius. */
  play(x: number, y: number, angle: number, arcDegrees: number, range: number, attackId?: string): GraveTitanImpactGeometry | null {
    if (this.destroyed || !Number.isFinite(x + y + angle + range) || range <= 0) return null;
    const fx = GRAVE_TITAN_IMPACT, now = this.gpu.now();
    let geometry: GraveTitanImpactGeometry | null = null;
    for (const [id, windup] of this.windups) {
      if (windup.attackId !== attackId) continue;
      geometry = windup.geometry;
      this.windups.delete(id);
      break;
    }
    const id = ++this.serial;
    if (!geometry) {
      geometry = graveTitanImpactGeometry(x, y, angle, arcDegrees, range, id * 2654435761);
      this.writeCracks(`${id}`, geometry, k => now + k * fx.segmentStaggerMs, now + fx.igniteAfterMs, now);
    }
    const color = this.terrain?.sample(geometry.x, geometry.y) ?? fx.earthFallback;
    this.fissures.addCrater(`${id}:crater`, { x: geometry.x, y: geometry.y, radius: geometry.crater, seed: (id * 0.381966) % 1, color }, now, now);
    this.fissures.commit();
    return geometry;
  }

  clear(): void { this.fissures.clear(); this.windups.clear(); }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unregister();
    this.clear();
    this.layers.destroy();
  }

  /** Writes every crack segment; segment k opens at `bornAt(k)` and the whole crack ignites at `ignite`. */
  private writeCracks(prefix: string, geometry: GraveTitanImpactGeometry, bornAt: (k: number) => number, ignite: number,
    now: number): string[] {
    const fx = GRAVE_TITAN_IMPACT, keys: string[] = [];
    const color = this.terrain?.sample(geometry.x, geometry.y) ?? fx.earthFallback;
    geometry.cracks.forEach((points, crack) => {
      const seed = ((hashAttack(prefix) % 997 + crack * 31) * 0.6180339887) % 1;
      let arc = 0;
      for (let k = 0; k + 1 < points.length; k++) {
        const a = points[k], b = points[k + 1], travel = direction(a, b);
        const before = k > 0 ? bisector(direction(points[k - 1], a), travel) : null;
        const after = k + 2 < points.length ? bisector(travel, direction(b, points[k + 2])) : null;
        const key = `${prefix}:${crack}:${k}`;
        if (this.fissures.addSegment(key, { ax: a.x, ay: a.y, bx: b.x, by: b.y, arcStart: arc, joinA: before, joinB: after,
          bornAt: bornAt(k), seed, color }, now)) {
          if (k + 2 < points.length) this.fissures.setNextBorn(key, bornAt(k + 1));
          this.fissures.setCollapse(key, ignite, ignite + k * fx.collapseStepMs, ignite + (k + 1) * fx.collapseStepMs);
          keys.push(key);
        }
        arc += Math.hypot(b.x - a.x, b.y - a.y);
      }
    });
    return keys;
  }

  private tick(now: number): void {
    if (this.destroyed || this.fissures.size === 0) return;
    this.fissures.retire(now);
    this.fissures.commit();
  }
}
