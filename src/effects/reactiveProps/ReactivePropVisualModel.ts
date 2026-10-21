import { CELL_SIZE } from '../../config';
import type { ExplosiveReactivePropKind, ReactivePropPresentation } from '../../config/reactiveProps/reactivePropKinds';
import type { ReactivePropCell } from '../../types';
import type { ReactivePropPhase } from '../../world/reactiveProps/ReactivePropRuntime';

/** Reine Darstellungsableitung eines reaktiven Map-Objekts; kein Gameplay-Zustand. */
export interface ReactivePropVisualState {
  readonly visible: boolean;
  /** Brandstacks für den geteilten Entity-Brand (0 = kein Feuer). */
  readonly burnStacks: number;
}

export const REACTIVE_PROP_VISUAL = Object.freeze({
  /** Ab diesem HP-Anteil kündigt die rote Gefahrenzone die Explosion an. */
  warningBelow: 0.3,
  // Wenige Stacks: sichtbare Flammen auf dem Deckel statt eines überstrahlten Glühens.
  minBurnStacks: 1,
  maxBurnStacks: 2,
  /** Ohne bekannte Restzeit (Kettenzündung) läuft die Zone noch so lange bis zum Knall. */
  triggeredLeadMs: 220,
  /** Wie weit sich die geschätzte Knallzeit verschieben darf, bevor die Zone neu angesetzt wird. */
  retimeToleranceMs: 180,
  strikeLeadMs: 120,
  lingerMs: 120,
  hitFlashMs: 90,
  hitFlashTint: 0x3c3c3c,
  /** Kleinere HP-Sprünge sind Brand-Ticks und blitzen nicht (15 HP/s ≙ 6 % je 250-ms-Tick). */
  hitFlashMinDrop: 0.08,
  /** Gruppen rücken zusammen und liegen leicht verdreht: kein sichtbares Raster. */
  clusterPullPx: 4,
  jitterPx: 2.5,
  /** Feste Körper: Mitten mindestens so weit auseinander wie der Fassdurchmesser (≈ 27 px). */
  minCenterDistancePx: 28,
  /** Das Fass bleibt sichtbar in seiner Zelle. */
  maxOffsetPx: 7,
});

export function resolveReactivePropVisual(phase: ReactivePropPhase, progress: number,
  presentation: ReactivePropPresentation = 'barrel'): ReactivePropVisualState {
  const c = REACTIVE_PROP_VISUAL;
  if (phase === 'destroyed') return { visible: false, burnStacks: 0 };
  // Nur das Fass brennt; Bovist und Korb zeigen ihren Zustand über die Blender-Clips.
  if (presentation !== 'barrel') return { visible: true, burnStacks: 0 };
  if (phase === 'idle' || phase === 'recharging') return { visible: true, burnStacks: 0 };
  if (phase === 'triggered') return { visible: true, burnStacks: c.maxBurnStacks };
  const damage = 1 - Math.max(0, Math.min(1, progress));
  return { visible: true, burnStacks: Math.round(c.minBurnStacks + (c.maxBurnStacks - c.minBurnStacks) * damage) };
}

/**
 * Geschätzter Knallzeitpunkt (synchronisierte Uhr) für die rote Gefahrenzone, `null` ohne Warnung.
 * Die Restzeit folgt aus dem replizierten HP-Anteil und der Brandrate des Kinds. Sie zählt ab
 * `progressSince`, dem Zeitpunkt, seit dem dieser Anteil gilt: So bleibt die Schätzung zwischen
 * den Brand-Ticks stehen, und nur echte Treffer verkürzen sie (dann setzt der Renderer neu an).
 */
export function resolveReactivePropWarning(kind: ExplosiveReactivePropKind, phase: ReactivePropPhase, progress: number,
  progressSince: number): { readonly hitAt: number; readonly durationMs: number } | null {
  const c = REACTIVE_PROP_VISUAL;
  const durationMs = c.warningBelow * kind.integrity.maxHp / kind.priming.selfDamagePerSecond * 1000 + kind.effect.fuseMs;
  if (phase === 'primed' && progress < c.warningBelow) {
    return { hitAt: progressSince + progress * kind.integrity.maxHp / kind.priming.selfDamagePerSecond * 1000 + kind.effect.fuseMs,
      durationMs };
  }
  if (phase === 'triggered') return { hitAt: progressSince + Math.max(40, (1 - progress) * c.triggeredLeadMs), durationMs };
  return null;
}

/** One clip of a prop sheet, as the pipeline exports it. */
export interface ReactivePropSheetClip {
  readonly name: string;
  readonly frames: readonly number[];
  readonly frameRate: number;
  readonly loop: boolean;
}

function clipDurationMs(clip: ReactivePropSheetClip): number {
  return clip.frames.length / clip.frameRate * 1000;
}

function scrubClip(clip: ReactivePropSheetClip, t: number): number {
  return clip.frames[Math.min(clip.frames.length - 1, Math.max(0, Math.floor(t * clip.frames.length)))];
}

function playClip(clip: ReactivePropSheetClip, elapsedMs: number): number {
  const n = clip.frames.length, i = Math.floor(Math.max(0, elapsedMs) / 1000 * clip.frameRate);
  return clip.loop ? clip.frames[i % n] : clip.frames[Math.min(n - 1, i)];
}

/**
 * Sheet frame of a rechargeable prop from its replicated phase and progress. Puffball: `swell` follows
 * the anticipation, `burst` plays once after an observed release, then `refill` follows the recharge.
 * Hive: `shake` loops in the anticipation, `release` plays once. `releasedAt` is the local time of an
 * observed release, `null` otherwise (late join never replays a one-shot).
 */
export function resolveReactivePropFrame(presentation: ReactivePropPresentation, phase: ReactivePropPhase, progress: number,
  clips: readonly ReactivePropSheetClip[], idleFrame: number, nowMs: number, releasedAt: number | null): number {
  const clip = (name: string) => clips.find(c => c.name === name);
  if (presentation === 'puffball') {
    if (phase === 'triggered') { const swell = clip('swell'); return swell ? scrubClip(swell, progress) : idleFrame; }
    if (phase === 'recharging') {
      const burst = clip('burst');
      if (burst && releasedAt !== null && nowMs - releasedAt < clipDurationMs(burst)) return playClip(burst, nowMs - releasedAt);
      const refill = clip('refill');
      return refill ? scrubClip(refill, progress) : idleFrame;
    }
    return idleFrame;
  }
  if (presentation === 'hive') {
    if (phase === 'triggered') { const shake = clip('shake'); return shake ? playClip(shake, nowMs) : idleFrame; }
    const release = clip('release');
    if (phase === 'recharging' && release && releasedAt !== null && nowMs - releasedAt < clipDurationMs(release)) {
      return playClip(release, nowMs - releasedAt);
    }
  }
  return idleFrame;
}

/** A release the client saw happen (not a late-join state): idle or anticipation turned into a fresh recharge. */
export function isObservedReactivePropRelease(previous: ReactivePropPhase | null, phase: ReactivePropPhase, progress: number): boolean {
  return (previous === 'idle' || previous === 'triggered') && phase === 'recharging' && progress < .25;
}

export interface ReactivePropPose { readonly offsetX: number; readonly offsetY: number; readonly rotation: number }

const NEUTRAL_POSE: ReactivePropPose = Object.freeze({ offsetX: 0, offsetY: 0, rotation: 0 });
const poseCache = new WeakMap<readonly ReactivePropCell[], readonly ReactivePropPose[]>();

export function resolveReactivePropPose(index: number, cells: readonly ReactivePropCell[]): ReactivePropPose {
  return resolveReactivePropPoses(cells)[index] ?? NEUTRAL_POSE;
}

/**
 * Deterministische Lage aller Objekte eines Layouts: Gruppennachbarn rücken zusammen, dazu Streuung
 * und Drehung – kein sichtbares Raster. Fässer sind feste Körper: Sie stehen eng, berühren sich
 * höchstens und überlappen nie. Reicht das Auseinanderschieben innerhalb der Zelle nicht, rücken
 * beide zur Zellmitte zurück; Zellmitten liegen mindestens eine Zelle auseinander.
 */
export function resolveReactivePropPoses(cells: readonly ReactivePropCell[]): readonly ReactivePropPose[] {
  const cached = poseCache.get(cells);
  if (cached) return cached;
  const c = REACTIVE_PROP_VISUAL;
  const offsets = cells.map((_, index) => clampOffset(naturalOffset(index, cells)));
  const pairs: [number, number][] = [];
  for (let a = 0; a < cells.length; a++) for (let b = a + 1; b < cells.length; b++) {
    if (Math.max(Math.abs(cells[a].gridX - cells[b].gridX), Math.abs(cells[a].gridY - cells[b].gridY)) <= 1) pairs.push([a, b]);
  }
  const delta = (a: number, b: number) => ({
    x: (cells[b].gridX - cells[a].gridX) * CELL_SIZE + offsets[b].x - offsets[a].x,
    y: (cells[b].gridY - cells[a].gridY) * CELL_SIZE + offsets[b].y - offsets[a].y,
  });
  for (let pass = 0; pass < 6; pass++) {
    for (const [a, b] of pairs) {
      const d = delta(a, b), distance = Math.hypot(d.x, d.y);
      const deficit = c.minCenterDistancePx - distance;
      if (deficit <= 0) continue;
      const push = deficit / 2 + 0.01, nx = d.x / distance, ny = d.y / distance;
      offsets[a] = clampOffset({ x: offsets[a].x - nx * push, y: offsets[a].y - ny * push });
      offsets[b] = clampOffset({ x: offsets[b].x + nx * push, y: offsets[b].y + ny * push });
    }
  }
  for (let pass = 0; pass < 24; pass++) {
    let tight = false;
    for (const [a, b] of pairs) {
      const d = delta(a, b);
      if (Math.hypot(d.x, d.y) >= c.minCenterDistancePx) continue;
      tight = true;
      offsets[a] = { x: offsets[a].x * 0.7, y: offsets[a].y * 0.7 };
      offsets[b] = { x: offsets[b].x * 0.7, y: offsets[b].y * 0.7 };
    }
    if (!tight) break;
  }
  for (const [a, b] of pairs) {
    const d = delta(a, b);
    if (Math.hypot(d.x, d.y) < c.minCenterDistancePx) { offsets[a] = { x: 0, y: 0 }; offsets[b] = { x: 0, y: 0 }; }
  }
  const poses = cells.map((cell, index) => Object.freeze({
    offsetX: offsets[index].x, offsetY: offsets[index].y,
    rotation: ((hashCell(cell.gridX, cell.gridY) >>> 16) & 0xffff) / 0xffff * Math.PI * 2,
  }));
  poseCache.set(cells, poses);
  return poses;
}

function clampOffset(offset: { x: number; y: number }): { x: number; y: number } {
  const length = Math.hypot(offset.x, offset.y), max = REACTIVE_PROP_VISUAL.maxOffsetPx;
  return length <= max ? offset : { x: offset.x / length * max, y: offset.y / length * max };
}

/** Gruppennachbarn ziehen sich leicht an, dazu eine Streuung je Zelle. */
function naturalOffset(index: number, cells: readonly ReactivePropCell[]): { x: number; y: number } {
  const c = REACTIVE_PROP_VISUAL, cell = cells[index];
  let sumX = 0, sumY = 0, neighbours = 0;
  for (let i = 0; i < cells.length; i++) {
    if (i === index) continue;
    const dx = cells[i].gridX - cell.gridX, dy = cells[i].gridY - cell.gridY;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 1) continue;
    sumX += dx; sumY += dy; neighbours++;
  }
  let offsetX = 0, offsetY = 0;
  if (neighbours > 0) {
    const length = Math.hypot(sumX, sumY);
    if (length > 0) { offsetX = sumX / length * c.clusterPullPx; offsetY = sumY / length * c.clusterPullPx; }
  }
  const h = hashCell(cell.gridX, cell.gridY);
  offsetX += ((h & 0xff) / 255 * 2 - 1) * c.jitterPx;
  offsetY += (((h >>> 8) & 0xff) / 255 * 2 - 1) * c.jitterPx;
  return { x: offsetX, y: offsetY };
}

function hashCell(x: number, y: number): number {
  let h = Math.imul(x + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return h >>> 0;
}
