/** Authored look of the slam and stomp impact. */
export const GRAVE_TITAN_IMPACT = {
  /** A frontal slam fans its cracks over the sector; an all-round stomp throws a star. */
  fanCracks: 6,
  starCracks: 9,
  segments: 4,
  /** Lateral kink of a crack segment, as a share of its length. */
  kink: 0.32,
  /** Each segment's crack front starts this much after its predecessor. */
  segmentStaggerMs: 38,
  /** The cracks ignite and collapse into a scar once they have all opened. */
  igniteAfterMs: 210,
  collapseStepMs: 32,
  /** The slam's paws land this share of the reach ahead of the body centre. */
  slamCentreShare: 0.52,
  /** A stomp's cracks start at this share of its reach (the body edge) and run to its rim. */
  stompInnerShare: 0.36,
  craterRadius: { slam: 34, stomp: 48 },
  earthFallback: 0x5a4a38,
} as const;

export interface GraveTitanImpactGeometry {
  readonly x: number;
  readonly y: number;
  /** Radius of the struck ground around the impact centre. */
  readonly radius: number;
  readonly cracks: readonly (readonly { readonly x: number; readonly y: number }[])[];
  readonly crater: number;
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic crack layout of one confirmed swing: a frontal slam (arc < 300°) cracks the ground
 * ahead where its paws land, fanned over its sector; a stomp throws a star around its body.
 */
export function graveTitanImpactGeometry(x: number, y: number, angle: number, arcDegrees: number, range: number,
  seed: number): GraveTitanImpactGeometry {
  const fx = GRAVE_TITAN_IMPACT, rng = random(seed), star = arcDegrees >= 300;
  const centreDistance = star ? 0 : range * fx.slamCentreShare;
  const cx = x + Math.cos(angle) * centreDistance, cy = y + Math.sin(angle) * centreDistance;
  const count: number = star ? fx.starCracks : fx.fanCracks;
  const halfArc = star ? Math.PI : Math.min(Math.PI, arcDegrees * Math.PI / 360) * 0.95;
  const cracks: { x: number; y: number }[][] = [];
  for (let i = 0; i < count; i++) {
    const t = star ? (i + rng() * 0.6) / count : (count === 1 ? 0.5 : i / (count - 1));
    const direction = star ? angle + t * Math.PI * 2 : angle - halfArc + 2 * halfArc * t + (rng() - 0.5) * 0.18;
    // Slam cracks run from the paws to the sector rim; a stomp's from the body edge outwards.
    const start = star ? range * fx.stompInnerShare * (0.85 + rng() * 0.25) : range * 0.06;
    const reach = star ? range * (0.82 + rng() * 0.22) : Math.max(range * 0.3, range - centreDistance) * (0.72 + rng() * 0.36);
    const points = [{ x: cx + Math.cos(direction) * start, y: cy + Math.sin(direction) * start }];
    let heading = direction;
    const step = (reach - start) / fx.segments;
    for (let k = 1; k <= fx.segments; k++) {
      heading += (rng() - 0.5) * fx.kink * 2;
      // Keep each crack radiating: its heading drifts back towards its spoke.
      heading += (direction - heading) * 0.45;
      const last = points[points.length - 1];
      points.push({ x: last.x + Math.cos(heading) * step, y: last.y + Math.sin(heading) * step });
    }
    cracks.push(points);
  }
  return { x: cx, y: cy, radius: star ? range : Math.max(range * 0.45, range - centreDistance),
    cracks, crater: star ? fx.craterRadius.stomp : fx.craterRadius.slam };
}
