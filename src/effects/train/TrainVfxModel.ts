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

/** The main blast starts the event; the rupture travels outward along all carriages (off-world particles are culled by presentation). */
export function planTrainDestruction(
  segments: readonly { x: number; y: number }[], minY: number, maxY: number,
): TrainBlast[] {
  const visible = segments.filter(p => p.y >= minY && p.y <= maxY);
  if (!visible.length) return [];
  const center = visible[Math.floor(visible.length / 2)];
  const random = trainRandom(trainVfxSeed(center.x, center.y, 160));
  const ordered = segments.filter(p => p !== center).sort((a, b) => Math.abs(a.y - center.y) - Math.abs(b.y - center.y));
  return [{ ...center, radius: 160, delayMs: 0 }, ...ordered.map((p, i) => ({
    ...p, radius: 80, delayMs: 110 + i * 120 + Math.floor(random() * 20),
  }))];
}

export interface TrainChunkPath {
  x: number; y: number; dx: number; dy: number; height: number; flightMs: number; spin: number;
}

/** A 3D arc above a fixed XY landing point. Gravity never accelerates across the map. */
export function sampleTrainChunk(path: TrainChunkPath, ageMs: number) {
  const t = Math.max(0, Math.min(1, ageMs / path.flightMs));
  const z = 4 * path.height * t * (1 - t);
  const x = path.x + path.dx * t, groundY = path.y + path.dy * t;
  return { x, y: groundY - z * .35, groundY, z, rotation: path.spin * t, landed: t === 1 };
}

/** Rising fragments break at the apex; there is deliberately no large-fragment landing state. */
export function sampleTrainEjection(path: TrainChunkPath, ageMs: number) {
  const t = Math.max(0, Math.min(1, ageMs / path.flightMs));
  const z = path.height * Math.sin(t * Math.PI / 2);
  const x = path.x + path.dx * t, groundY = path.y + path.dy * t;
  return { x, y: groundY - z * .35, groundY, z, rotation: path.spin * t, broken: t === 1 };
}
