import type { GroundGlowLightFrame, LightingSystem } from '../LightingSystem';

/** Upper bound of the boss's own ground lights, well inside the 256 shared with the pond and other owners. */
export const KRAKEN_LIGHT_RIG_CAPACITY = 32;

interface RigLight { x: number; y: number; radiusPx: number; intensity: number; color: number }

/**
 * Light the kraken casts into the light map (borrowed ground-glow frame). Violet reads well in the dusk
 * map; ember red has almost no headroom there and is carried by the glow pools above the map instead.
 * Each frame is a full projection; lights beyond the capacity are dropped, never queued.
 */
export class KrakenLightRig {
  private readonly lights: RigLight[] = Array.from({ length: KRAKEN_LIGHT_RIG_CAPACITY }, () => ({ x: 0, y: 0, radiusPx: 0, intensity: 0, color: 0 }));
  private readonly frame: GroundGlowLightFrame & { lightCount: number } = { lights: this.lights, lightCount: 0 };
  private count = 0;
  private published = false;

  constructor(private readonly lighting: LightingSystem | null | undefined) {}

  get size(): number { return this.count; }
  begin(): void { this.count = 0; }
  add(x: number, y: number, radiusPx: number, intensity: number, color: number): void {
    if (intensity <= .01 || radiusPx <= 0 || this.count >= KRAKEN_LIGHT_RIG_CAPACITY) return;
    const light = this.lights[this.count++]!;
    light.x = x; light.y = y; light.radiusPx = radiusPx; light.intensity = intensity; light.color = color;
  }
  commit(): void {
    this.frame.lightCount = this.count;
    if (this.count > 0) { this.lighting?.setGroundGlowLights(this, this.frame); this.published = true; }
    else if (this.published) { this.lighting?.setGroundGlowLights(this, null); this.published = false; }
  }
  clear(): void {
    this.count = 0; this.frame.lightCount = 0;
    if (this.published) this.lighting?.setGroundGlowLights(this, null);
    this.published = false;
  }
}
