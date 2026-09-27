import { BURROW_EARTHBREAK } from '../config/burrowEarthbreak';

export interface EarthbreakPoint { readonly x: number; readonly y: number; }
export interface EarthbreakPose extends EarthbreakPoint { readonly positionRevision: number; }
export interface SyncedBurrowEarthbreak {
  readonly id: number;
  readonly ownerId: string;
  readonly points: readonly EarthbreakPoint[];
  readonly phase: 'digging' | 'detonating';
  readonly exit: EarthbreakPoint | null;
  readonly detonatedAt: number | null;
}

interface Trace {
  id: number;
  ownerId: string;
  points: EarthbreakPoint[];
  pose: EarthbreakPose;
  remainder: number;
  exit: EarthbreakPoint | null;
  detonatedAt: number | null;
  nextExplosion: number;
}

export interface EarthbreakExplosion extends EarthbreakPoint {
  readonly ownerId: string;
  readonly damage: number;
  readonly radius: number;
  readonly vulnerabilityDurationMs: number;
}

/** Host-only excavation and detonation owner. No Phaser, timers, rendering or network access. */
export class BurrowEarthbreakRuntime {
  private nextId = 1;
  private readonly traces = new Map<number, Trace>();
  private readonly digging = new Map<string, Trace>();

  constructor(private readonly explode: (event: EarthbreakExplosion) => void) {}

  start(ownerId: string, pose: EarthbreakPose): void {
    this.cancelDig(ownerId);
    const trace: Trace = { id: this.nextId++, ownerId, points: [], pose: { ...pose }, remainder: 0,
      exit: null, detonatedAt: null, nextExplosion: 0 };
    this.traces.set(trace.id, trace);
    this.digging.set(ownerId, trace);
  }

  move(ownerId: string, pose: EarthbreakPose): void {
    const trace = this.digging.get(ownerId);
    if (!trace) return;
    if (pose.positionRevision !== trace.pose.positionRevision || !Number.isFinite(pose.x + pose.y)) {
      this.cancelDig(ownerId);
      return;
    }
    const dx = pose.x - trace.pose.x, dy = pose.y - trace.pose.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;
    const spacing = BURROW_EARTHBREAK.spacingPx;
    for (let along = spacing - trace.remainder; along <= distance; along += spacing) {
      trace.points.push({ x: trace.pose.x + dx * along / distance, y: trace.pose.y + dy * along / distance });
    }
    trace.remainder = (trace.remainder + distance) % spacing;
    trace.pose = { ...pose };
  }

  /** Caller samples the pre-assistance pose first; the corrected exit never creates a segment. */
  exit(ownerId: string, point: EarthbreakPoint, now: number): void {
    const trace = this.digging.get(ownerId);
    if (!trace) return;
    this.digging.delete(ownerId);
    trace.exit = { x: point.x, y: point.y };
    trace.detonatedAt = now;
    this.explode({ ...trace.exit, ownerId, damage: BURROW_EARTHBREAK.exitDamage,
      radius: BURROW_EARTHBREAK.exitRadius, vulnerabilityDurationMs: BURROW_EARTHBREAK.vulnerabilityDurationMs });
  }

  advance(now: number, isOwnerActive: (id: string) => boolean): void {
    for (const trace of this.traces.values()) {
      if (!isOwnerActive(trace.ownerId)) { this.removePlayer(trace.ownerId); continue; }
      if (trace.detonatedAt === null) continue;
      while (trace.nextExplosion < trace.points.length
        && now >= trace.detonatedAt + (trace.nextExplosion + 1) * BURROW_EARTHBREAK.intervalMs) {
        const point = trace.points[trace.points.length - 1 - trace.nextExplosion++];
        this.explode({ ...point, ownerId: trace.ownerId, damage: BURROW_EARTHBREAK.damage,
          radius: BURROW_EARTHBREAK.radius, vulnerabilityDurationMs: BURROW_EARTHBREAK.vulnerabilityDurationMs });
        // Combat callbacks can remove the owner during a hit.
        if (!this.traces.has(trace.id)) break;
      }
      if (now >= trace.detonatedAt + trace.points.length * BURROW_EARTHBREAK.intervalMs
        + BURROW_EARTHBREAK.presentationRetentionMs) this.traces.delete(trace.id);
    }
  }

  cancelDig(ownerId: string): void {
    const trace = this.digging.get(ownerId);
    if (trace) this.traces.delete(trace.id);
    this.digging.delete(ownerId);
  }

  removePlayer(ownerId: string): void {
    this.cancelDig(ownerId);
    for (const [id, trace] of this.traces) if (trace.ownerId === ownerId) this.traces.delete(id);
  }

  snapshot(): SyncedBurrowEarthbreak[] {
    return [...this.traces.values()].map(t => ({ id: t.id, ownerId: t.ownerId,
      points: t.points.map(p => ({ ...p })), phase: t.detonatedAt === null ? 'digging' : 'detonating',
      exit: t.exit ? { ...t.exit } : null, detonatedAt: t.detonatedAt }));
  }

  clear(): void { this.traces.clear(); this.digging.clear(); }
}
