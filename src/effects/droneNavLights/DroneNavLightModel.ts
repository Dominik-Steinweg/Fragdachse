/**
 * Shared night lights of every flying drone (attack drone, bomber squadron, repair drones).
 * Drone renderers only submit their displayed pose and a profile of anchors; colours, beacon
 * timing, day/night response and the bounded ground pools belong to this model and its renderer.
 *
 * Colours stay clear of enemy eyes (greens, oranges, cyan, purples), allied jade, telegraph red
 * and the fire-control mint: a warm white nose light and a cool blue tail beacon (hue ~221°, in
 * the gap between cyan and violet eyes). The nose is steady and the tail flashes slowly, so the
 * flight direction reads even on a dark silhouette.
 */
export type DroneNavLightKind = 'nose' | 'tail' | 'wing';
/** Low-flying drones are hidden by tree canopies; high-flying bombers draw above them. */
export type DroneNavLightBand = 'under-canopy' | 'over-canopy';

/** Light position in the drone's own frame at display size: +forward along the flight direction, +lateral to its right. */
export interface DroneNavLightAnchor {
  readonly kind: DroneNavLightKind;
  readonly forward: number;
  readonly lateral: number;
}

export interface DroneNavLightProfile {
  readonly band: DroneNavLightBand;
  readonly anchors: readonly DroneNavLightAnchor[];
  /** Scales core, halo and bloom for small or large airframes. */
  readonly size: number;
  /** Ground light pool at full darkness that lifts the silhouette out of the night; radius 0 = none. */
  readonly poolRadiusPx: number;
  readonly poolIntensity: number;
}

export const DRONE_NAV_LIGHT_COLORS: Readonly<Record<DroneNavLightKind, number>> = Object.freeze({
  nose: 0xffe6c2,
  tail: 0x7aa4ff,
  wing: 0xffe6c2,
});

/** Anchors follow each sprite's silhouette at its display size (see the drone asset catalogue). */
export const DRONE_NAV_LIGHT_PROFILES = Object.freeze({
  /** Heavy quadcopter, 40 px: light on the nose of the fuselage, beacon on its tail. */
  attackDrone: {
    band: 'under-canopy', size: 0.9, poolRadiusPx: 48, poolIntensity: 0.5,
    anchors: [{ kind: 'nose', forward: 12, lateral: 0 }, { kind: 'tail', forward: -11, lateral: 0 }],
  },
  /** VTOL bomber B3, 48 px: nose and tail on the fuselage, two dim markers outside the rotor ducts. */
  bomberDrone: {
    band: 'over-canopy', size: 1, poolRadiusPx: 56, poolIntensity: 0.5,
    anchors: [
      { kind: 'nose', forward: 18, lateral: 0 }, { kind: 'tail', forward: -16, lateral: 0 },
      { kind: 'wing', forward: 0, lateral: -19 }, { kind: 'wing', forward: 0, lateral: 19 },
    ],
  },
  /** Repair drone, 32 px: nose between the two tools, beacon on the rear fuselage. */
  repairDrone: {
    band: 'under-canopy', size: 0.7, poolRadiusPx: 34, poolIntensity: 0.45,
    anchors: [{ kind: 'nose', forward: 7, lateral: 0 }, { kind: 'tail', forward: -6, lateral: 0 }],
  },
} satisfies Record<string, DroneNavLightProfile>);

export interface DroneNavLightPoint {
  x: number; y: number;
  kind: DroneNavLightKind;
  band: DroneNavLightBand;
  /** Drone alpha (fade-in, departure); day/night response is applied by the renderer. */
  alpha: number;
  size: number;
  /** Stable per-drone beacon phase so a squadron never flashes in lockstep. */
  phase: number;
  /** Flight direction, for slightly elongated nose lights. */
  heading: number;
}

export interface DroneNavLightPool { x: number; y: number; radiusPx: number; intensity: number; color: number }

const GOLDEN_RATIO_FRACTION = 0.6180339887;
/** Pools pull slightly ahead of the drone, like a landing light on the ground. */
const POOL_LEAD_PX = 6;

/** Frame buffer of the current frame's lights; owns no drones, clocks or gameplay state. */
export class DroneNavLightModel {
  readonly points: DroneNavLightPoint[] = [];
  readonly pools: DroneNavLightPool[] = [];
  pointCount = 0;
  poolCount = 0;
  private readonly phases = new WeakMap<object, number>();
  private nextPhase = 0;

  clear(): void { this.pointCount = 0; this.poolCount = 0; }

  /**
   * One drone as displayed this frame. `heading` is the flight direction in Phaser radians
   * (0 = east); `key` is the displayed object and keeps the beacon phase stable for its lifetime.
   * `lateralScale` follows a banking body that is drawn foreshortened across its wings.
   */
  submit(x: number, y: number, heading: number, alpha: number, profile: DroneNavLightProfile, key: object,
    lateralScale = 1): void {
    if (!(alpha > 0.01) || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(heading)) return;
    const phase = this.phaseOf(key);
    const fx = Math.cos(heading), fy = Math.sin(heading);
    for (const anchor of profile.anchors) {
      const point = this.points[this.pointCount] ?? (this.points[this.pointCount] = {
        x: 0, y: 0, kind: 'nose', band: 'under-canopy', alpha: 0, size: 1, phase: 0, heading: 0 });
      this.pointCount++;
      // Lateral +1 is the drone's right: the forward vector rotated by +90° in screen space.
      const lateral = anchor.lateral * lateralScale;
      point.x = x + fx * anchor.forward - fy * lateral;
      point.y = y + fy * anchor.forward + fx * lateral;
      point.kind = anchor.kind; point.band = profile.band; point.alpha = alpha;
      point.size = profile.size; point.phase = phase; point.heading = heading;
    }
    if (profile.poolRadiusPx <= 0) return;
    const pool = this.pools[this.poolCount] ?? (this.pools[this.poolCount] = { x: 0, y: 0, radiusPx: 0, intensity: 0, color: 0 });
    this.poolCount++;
    pool.x = x + fx * POOL_LEAD_PX; pool.y = y + fy * POOL_LEAD_PX;
    pool.radiusPx = profile.poolRadiusPx; pool.intensity = profile.poolIntensity * alpha;
    pool.color = DRONE_NAV_LIGHT_COLORS.nose;
  }

  /**
   * Keeps at most `max` ground pools, nearest to the view centre first. Lights themselves are
   * never culled here; pools are the only part with a lighting cost.
   */
  limitPools(centerX: number, centerY: number, max: number): void {
    if (this.poolCount <= max) return;
    const live = this.pools.slice(0, this.poolCount);
    live.sort((a, b) => (a.x - centerX) ** 2 + (a.y - centerY) ** 2 - ((b.x - centerX) ** 2 + (b.y - centerY) ** 2));
    for (let i = 0; i < max; i++) this.pools[i] = live[i];
    for (let i = max; i < live.length; i++) this.pools[i] = live[i];
    this.poolCount = max;
  }

  private phaseOf(key: object): number {
    let phase = this.phases.get(key);
    if (phase === undefined) {
      phase = this.nextPhase;
      this.nextPhase = (this.nextPhase + GOLDEN_RATIO_FRACTION) % 1;
      this.phases.set(key, phase);
    }
    return phase;
  }
}
