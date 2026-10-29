import type * as Phaser from 'phaser';
import { EarthbreakFissureStore } from '../earthbreak/EarthbreakFissureStore';
import { createEarthbreakFissureLayers, type EarthbreakFissureLayers, type FissurePalette } from '../earthbreak/EarthbreakFissureGpuLayer';
import type { GpuVfxSystem } from '../gpu/GpuVfxSystem';
import type { TerrainColorSnapshot } from '../../arena/TerrainColorSnapshot';
import { GRAVE_TITAN_IMPACT, graveTitanImpactGeometry, type GraveTitanImpactGeometry } from './graveTitanImpactGeometry';

/** Green grave light instead of embers: deep, glowing seam and a restrained (never white) core. */
export const GRAVE_LIGHT_FISSURES: FissurePalette = {
  name: 'GraveLight', ember: [0.08, 0.36, 0.13], glow: [0.30, 0.92, 0.40], hot: [0.62, 1.0, 0.62],
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

/**
 * Grave Titan slam and stomp ground: green-glowing cracks that tear open from the impact, ignite
 * and collapse into a glowing scar around a crater. Reuses the Earthbreak fissure store and shader
 * with the grave-light palette; pure presentation of a confirmed host swing.
 */
export class GraveTitanImpactRenderer {
  private readonly fissures = new EarthbreakFissureStore();
  private readonly layers: EarthbreakFissureLayers;
  private readonly unregister: () => void;
  private serial = 0;
  private destroyed = false;

  private terrain: TerrainColorSnapshot | null = null;

  constructor(scene: Phaser.Scene, private readonly gpu: GpuVfxSystem) {
    this.layers = createEarthbreakFissureLayers(scene, this.fissures, () => gpu.now(), GRAVE_LIGHT_FISSURES);
    this.unregister = gpu.registerEmission((_delta, now) => this.tick(now));
  }

  /** Trench and lip take the struck ground's colour. */
  setTerrainColorSnapshot(snapshot: TerrainColorSnapshot | null): void { this.terrain = snapshot; }

  /** Tears the ground for one swing and returns its impact centre and struck radius. */
  play(x: number, y: number, angle: number, arcDegrees: number, range: number): GraveTitanImpactGeometry | null {
    if (this.destroyed || !Number.isFinite(x + y + angle + range) || range <= 0) return null;
    const fx = GRAVE_TITAN_IMPACT, now = this.gpu.now(), id = ++this.serial;
    const geometry = graveTitanImpactGeometry(x, y, angle, arcDegrees, range, id * 2654435761);
    const color = this.terrain?.sample(geometry.x, geometry.y) ?? fx.earthFallback;
    const ignite = now + fx.igniteAfterMs;
    geometry.cracks.forEach((points, crack) => {
      const seed = ((id * 31 + crack) * 0.6180339887) % 1;
      let arc = 0;
      for (let k = 0; k + 1 < points.length; k++) {
        const a = points[k], b = points[k + 1], travel = direction(a, b);
        const before = k > 0 ? bisector(direction(points[k - 1], a), travel) : null;
        const after = k + 2 < points.length ? bisector(travel, direction(b, points[k + 2])) : null;
        const key = `${id}:${crack}:${k}`;
        if (this.fissures.addSegment(key, { ax: a.x, ay: a.y, bx: b.x, by: b.y, arcStart: arc, joinA: before, joinB: after,
          bornAt: now + k * fx.segmentStaggerMs, seed, color }, now)) {
          if (k + 2 < points.length) this.fissures.setNextBorn(key, now + (k + 1) * fx.segmentStaggerMs);
          this.fissures.setCollapse(key, ignite, ignite + k * fx.collapseStepMs, ignite + (k + 1) * fx.collapseStepMs);
        }
        arc += Math.hypot(b.x - a.x, b.y - a.y);
      }
    });
    this.fissures.addCrater(`${id}:crater`, { x: geometry.x, y: geometry.y, radius: geometry.crater, seed: (id * 0.381966) % 1, color }, now, now);
    this.fissures.commit();
    return geometry;
  }

  clear(): void { this.fissures.clear(); }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unregister();
    this.fissures.clear();
    this.layers.destroy();
  }

  private tick(now: number): void {
    if (this.destroyed || this.fissures.size === 0) return;
    this.fissures.retire(now);
    this.fissures.commit();
  }
}
