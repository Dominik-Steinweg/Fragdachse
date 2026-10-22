import type { SyncedBeeSwarm } from '../../types';
import type { ReactivePropPhase } from '../../world/reactiveProps/ReactivePropRuntime';

/** Body length of a bee in world px (about 10 cm at the arena scale). */
export const BEE_BODY_PX = 3.6;
/** Visual cloud radius; a dense core with stragglers out to the edge reads as one big swarm. */
const SWARM_RADIUS_PX = 50;
const MAX_SPEED = 520;

/** Where a hive's bees come and go, and its replicated state. */
export interface BeeHivePresentation {
  readonly index: number;
  /** Drawn skep centre and rotation; the light streams out of the hive from here. */
  readonly centerX: number;
  readonly centerY: number;
  readonly rotation: number;
  readonly entranceX: number;
  readonly entranceY: number;
  readonly phase: ReactivePropPhase;
  readonly progress: number;
}

export interface BeeFlockFrame {
  readonly swarms: readonly SyncedBeeSwarm[];
  readonly hives: ReadonlyMap<number, BeeHivePresentation>;
  /** Synchronized clock (ms): phase timings of the replicated swarms. */
  readonly syncNow: number;
  /** Local presentation clock (s) and frame step (s). */
  readonly time: number;
  readonly dt: number;
  readonly beesPerSwarm: number;
  readonly targetPosition: (kind: 'player' | 'enemy', id: string) => { x: number; y: number } | null;
}

export interface BeeInstance {
  x: number; y: number; heading: number; wing: number; size: number; alpha: number;
  altitude: number; blur: number; seed: number; hostile: boolean; veil: boolean; tone: number;
}

interface Bee {
  x: number; y: number; vx: number; vy: number; heading: number; alpha: number;
  readonly orbit: number; readonly omega: number; readonly phase: number; readonly stiffness: number;
  readonly diver: boolean; readonly wobble: number; readonly altitude: number; readonly delay: number;
  readonly tone: number; readonly seed: number;
}

interface FlockSwarm {
  readonly id: number;
  cx: number; cy: number;
  phase: SyncedBeeSwarm['phase'];
  readonly bornAt: number;
  readonly emerging: boolean;
  readonly bees: Bee[];
}

function rnd(seed: number, k: number): number {
  const v = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

function createBee(swarmId: number, i: number, count: number, x: number, y: number): Bee {
  const seed = swarmId * 131 + i * 17.13;
  return {
    x, y, vx: 0, vy: 0, heading: rnd(seed, 9) * Math.PI * 2, alpha: 0,
    orbit: SWARM_RADIUS_PX * (.25 + .75 * Math.sqrt(rnd(seed, 1))),
    omega: (1.6 + 2.8 * rnd(seed, 2)) * (rnd(seed, 3) < .5 ? -1 : 1),
    phase: rnd(seed, 4) * Math.PI * 2,
    stiffness: 26 + 30 * rnd(seed, 5),
    diver: rnd(seed, 6) < .4,
    wobble: 1.5 + 2 * rnd(seed, 7),
    altitude: 6 + 8 * rnd(seed, 8),
    delay: i / Math.max(1, count) * .7,
    tone: rnd(seed, 10),
    seed: rnd(seed, 11) * 100,
  };
}

/**
 * Presentation of bee swarms and idle hive bees. Swarms move as one replicated agent; each bee
 * chases its own orbiting slot around the smoothed centre (sparrow-flock model), so the swarm
 * reads as many individuals. Deterministic per swarm id; owns no gameplay state.
 */
export class BeeFlockModel {
  private readonly swarms = new Map<number, FlockSwarm>();

  /** Fills `out` (reused) and returns the instance count; veils come first so bees draw over them. */
  update(frame: BeeFlockFrame, out: BeeInstance[]): number {
    let n = 0;
    const seen = new Set<number>();
    const emit = (bee: Omit<BeeInstance, 'veil'> & { veil?: boolean }): void => {
      const slot = out[n] ?? (out[n] = { x: 0, y: 0, heading: 0, wing: 0, size: 0, alpha: 0, altitude: 0, blur: 0,
        seed: 0, hostile: false, veil: false, tone: 0 });
      Object.assign(slot, bee); slot.veil = bee.veil ?? false; n++;
    };
    // Veils first.
    for (const synced of frame.swarms) {
      seen.add(synced.id);
      const swarm = this.ensure(synced, frame);
      this.advance(swarm, synced, frame);
      const active = swarm.bees.reduce((sum, bee) => sum + bee.alpha, 0);
      if (active >= 8) {
        const spread = synced.phase === 'dispersed' ? 2.2 : synced.phase === 'returning' ? .6 : 1.3;
        emit({ x: swarm.cx, y: swarm.cy, heading: 0, wing: 0, size: SWARM_RADIUS_PX * spread, alpha: Math.min(1, active / frame.beesPerSwarm),
          altitude: 0, blur: 0, seed: synced.id, hostile: synced.hostile, veil: true, tone: 0 });
      }
    }
    for (const id of this.swarms.keys()) if (!seen.has(id)) this.swarms.delete(id);
    for (const synced of frame.swarms) {
      const swarm = this.swarms.get(synced.id)!;
      for (const bee of swarm.bees) {
        if (bee.alpha <= .01) continue;
        const speed = Math.hypot(bee.vx, bee.vy);
        emit({ x: bee.x, y: bee.y, heading: bee.heading, wing: frame.time * 45 + bee.seed, size: BEE_BODY_PX, alpha: bee.alpha,
          altitude: bee.altitude, blur: Math.min(1, speed / 380), seed: bee.seed, hostile: synced.hostile, tone: bee.tone });
      }
    }
    this.hiveBees(frame, emit);
    return n;
  }

  clear(): void { this.swarms.clear(); }

  private ensure(synced: SyncedBeeSwarm, frame: BeeFlockFrame): FlockSwarm {
    let swarm = this.swarms.get(synced.id);
    if (swarm) return swarm;
    const hive = frame.hives.get(synced.hiveIndex);
    // A swarm seen right after its release pours out of the hive; a late join sees it in flight.
    const emerging = !!hive && frame.syncNow - synced.releasedAt < 900;
    const ox = emerging ? hive!.entranceX : synced.x, oy = emerging ? hive!.entranceY : synced.y;
    const bees: Bee[] = [];
    for (let i = 0; i < frame.beesPerSwarm; i++) {
      const bee = createBee(synced.id, i, frame.beesPerSwarm, ox, oy);
      if (!emerging) {
        bee.x += Math.cos(bee.phase) * bee.orbit; bee.y += Math.sin(bee.phase) * bee.orbit * .9; bee.alpha = 1;
      }
      bees.push(bee);
    }
    swarm = { id: synced.id, cx: ox, cy: oy, phase: synced.phase, bornAt: frame.time, emerging, bees };
    this.swarms.set(synced.id, swarm);
    return swarm;
  }

  private advance(swarm: FlockSwarm, synced: SyncedBeeSwarm, frame: BeeFlockFrame): void {
    const { dt, time } = frame;
    const smoothing = 1 - Math.exp(-dt / .06);
    swarm.cx += (synced.x - swarm.cx) * smoothing;
    swarm.cy += (synced.y - swarm.cy) * smoothing;
    if (swarm.phase !== synced.phase && synced.phase === 'dispersed') {
      // Scatter: every bee gets an outward kick from the centre.
      for (const bee of swarm.bees) {
        const angle = Math.atan2(bee.y - swarm.cy, bee.x - swarm.cx) + (bee.tone - .5);
        bee.vx += Math.cos(angle) * 260; bee.vy += Math.sin(angle) * 260;
      }
    }
    swarm.phase = synced.phase;
    const hive = frame.hives.get(synced.hiveIndex);
    const target = synced.phase === 'hunting' && synced.target ? frame.targetPosition(synced.target.kind, synced.target.id) : null;
    const radius = synced.phase === 'dispersed' ? 2.6 : synced.phase === 'returning' ? .45 : 1;
    const home = synced.phase === 'returning' && hive
      ? Math.min(1, Math.max(0, (frame.syncNow - synced.phaseStartedAt) / 700)) : 0;
    for (const bee of swarm.bees) {
      if (swarm.emerging && time - swarm.bornAt < bee.delay) continue;
      const angle = bee.omega * time + bee.phase;
      let sx = swarm.cx + Math.cos(angle) * bee.orbit * radius + Math.sin(time * bee.wobble + bee.seed) * 3;
      let sy = swarm.cy + Math.sin(angle) * bee.orbit * radius * .9 + Math.cos(time * bee.wobble * 1.3 + bee.seed) * 3;
      if (target && bee.diver) {
        const dive = Math.max(0, Math.sin(time * 2.4 + bee.phase)) ** 3;
        sx += (target.x + Math.cos(bee.seed) * 4 - sx) * dive;
        sy += (target.y + Math.sin(bee.seed) * 4 - sy) * dive;
      }
      if (home > 0) { sx += (hive!.entranceX - sx) * home; sy += (hive!.entranceY - sy) * home; }
      const k = bee.stiffness, damping = 2 * Math.sqrt(k);
      bee.vx += ((sx - bee.x) * k - bee.vx * damping) * dt;
      bee.vy += ((sy - bee.y) * k - bee.vy * damping) * dt;
      const speed = Math.hypot(bee.vx, bee.vy);
      if (speed > MAX_SPEED) { bee.vx *= MAX_SPEED / speed; bee.vy *= MAX_SPEED / speed; }
      bee.x += bee.vx * dt; bee.y += bee.vy * dt;
      if (speed > 8) bee.heading = turnToward(bee.heading, Math.atan2(bee.vy, bee.vx), dt * 14);
      const inside = home > .6 && hive && Math.hypot(hive.entranceX - bee.x, hive.entranceY - bee.y) < 4;
      bee.alpha = inside ? Math.max(0, bee.alpha - dt * 6) : Math.min(1, bee.alpha + dt * 7);
    }
  }

  /** Bees around the hive entrance: a few calm ones once it is ready again (none while recharging), agitated ones in the anticipation. */
  private hiveBees(frame: BeeFlockFrame, emit: (bee: BeeInstance) => void): void {
    const out = new Set(frame.swarms.map(swarm => swarm.hiveIndex));
    for (const hive of frame.hives.values()) {
      if (out.has(hive.index)) continue;
      const agitated = hive.phase === 'triggered';
      const count = hive.phase === 'idle' ? 7 : agitated ? 18 : 0;
      for (let i = 0; i < count; i++) {
        const seed = hive.index * 977 + i * 31.7;
        const orbit = (agitated ? 7 : 5) + (agitated ? 12 : 8) * rnd(seed, 1);
        const omega = (agitated ? 5 : 2.2) * (1 + rnd(seed, 2)) * (i % 2 ? -1 : 1);
        const angle = omega * frame.time + rnd(seed, 3) * Math.PI * 2;
        const x = hive.entranceX + Math.cos(angle) * orbit + Math.sin(frame.time * 3.1 + seed) * 1.5;
        const y = hive.entranceY + Math.sin(angle) * orbit * .8 + Math.cos(frame.time * 2.7 + seed) * 1.5;
        emit({ x, y, heading: angle + Math.sign(omega) * Math.PI / 2, wing: frame.time * 45 + seed, size: BEE_BODY_PX,
          alpha: 1, altitude: 3 + 3 * rnd(seed, 4), blur: agitated ? .35 : .12, seed: rnd(seed, 5) * 100, hostile: false,
          veil: false, tone: rnd(seed, 6) });
      }
    }
  }
}

function turnToward(current: number, target: number, maxStep: number): number {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return current + Math.max(-maxStep, Math.min(maxStep, delta));
}
