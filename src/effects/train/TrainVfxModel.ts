/** Cosmetic randomness is derived from wire coordinates, never from a peer's clock or RNG. */
export function trainVfxSeed(x: number, y: number, radius: number): number {
  return (Math.imul(Math.round(Math.fround(x) * 16), 73856093)
    ^ Math.imul(Math.round(Math.fround(y) * 16), 19349663)
    ^ Math.imul(Math.round(radius * 16), 83492791)) >>> 0;
}

export function trainRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TrainBlast { x: number; y: number; radius: number; delayMs: number }

/** Smaller than the hero blast: TrainVfx and the host treat >= 140 as the single main detonation. */
export const TRAIN_MAIN_BLAST_RADIUS = 160;
const SEGMENT_SPAN = 96;

/**
 * A once-per-map, cinematically orchestrated destruction (host-planned, replicated blast by blast):
 * one hero blast at the visible centre, a rupture wave rolling outward along every carriage with
 * several staggered detonations per carriage, then a few late cook-offs. Never simultaneous:
 * delays are strictly increasing, and off-world blasts are culled by presentation.
 */
export function planTrainDestruction(
  segments: readonly { x: number; y: number }[], minY: number, maxY: number,
): TrainBlast[] {
  const visible = segments.filter(p => p.y >= minY && p.y <= maxY);
  if (!visible.length) return [];
  const center = visible[Math.floor(visible.length / 2)];
  const random = trainRandom(trainVfxSeed(center.x, center.y, TRAIN_MAIN_BLAST_RADIUS));
  const blasts: TrainBlast[] = [{ x: center.x, y: center.y, radius: TRAIN_MAIN_BLAST_RADIUS, delayMs: 0 }];
  const ordered = [...segments].sort((a, b) => Math.abs(a.y - center.y) - Math.abs(b.y - center.y));
  ordered.forEach((segment, rank) => {
    // The wave reaches each carriage in turn; within it, 2-4 charges go off in quick succession.
    const wave = 120 + rank * 210;
    const charges = segment === center ? 2 : 2 + Math.floor(random() * 3);
    for (let i = 0; i < charges; i++) {
      blasts.push({
        x: segment.x + (random() - 0.5) * 44,
        y: segment.y + ((i + 0.5) / charges - 0.5) * SEGMENT_SPAN + (random() - 0.5) * 22,
        radius: 64 + random() * 46,
        delayMs: wave + i * (90 + random() * 130) + random() * 90,
      });
    }
  });
  // Late cook-offs: a few heavier secondaries once the wave has passed, scattered along the train.
  const lastWave = 120 + ordered.length * 210;
  const cookOffs = Math.min(5, 2 + Math.floor(segments.length / 4));
  for (let i = 0; i < cookOffs; i++) {
    const segment = ordered[Math.floor(random() * ordered.length)];
    blasts.push({ x: segment.x + (random() - 0.5) * 30, y: segment.y + (random() - 0.5) * SEGMENT_SPAN,
      radius: 105 + random() * 25, delayMs: lastWave * 0.5 + 500 + i * (380 + random() * 420) });
  }
  blasts.sort((a, b) => a.delayMs - b.delayMs);
  for (let i = 1; i < blasts.length; i++) {
    blasts[i].delayMs = Math.max(Math.round(blasts[i].delayMs), blasts[i - 1].delayMs + 1);
  }
  return blasts;
}
