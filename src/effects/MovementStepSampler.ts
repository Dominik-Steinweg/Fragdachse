import { MOVEMENT_FX, type FootprintVariant, type PawCount } from '../config/movementEffects';

export type MovementVisualMode = 'idle' | 'walk' | 'dash' | 'recovery';

/** Caller-owned render projection. Never sent over the network or read by simulation. */
export interface MovementVisualSample {
  id: string;
  x: number;
  y: number;
  /** Displayed look direction in radians (0 = right), independent of travel direction. */
  facing: number;
  size: number;
  pawCount: PawCount;
  footprint: FootprintVariant;
  player: boolean;
  visible: boolean;
  mode: MovementVisualMode;
  revision: number;
}

export interface MovementVisualSource {
  readMovementVisualSample(out: MovementVisualSample): void;
}

export type MovementContact = 'step' | 'dashStart' | 'dashTrail' | 'dashEnd';
export type MovementContactSink = (
  contact: MovementContact, x: number, y: number, heading: number, paw: number, ageMs: number, facing: number,
) => void;

export function createMovementVisualSample(): MovementVisualSample {
  return { id: '', x: 0, y: 0, facing: 0, size: 32, pawCount: 2, footprint: 'compact', player: false,
    visible: false, mode: 'idle', revision: 0 };
}

/** Distance, not render frames or input, advances the gait. Dropped contacts still advance it. */
export class MovementStepSampler {
  private initialized = false;
  private x = 0;
  private y = 0;
  private revision = 0;
  private mode: MovementVisualMode = 'idle';
  private remainder = 0;
  private paw = 0;
  private heading = 0;
  private facing = 0;
  private pendingDashStart = false;
  private dashMoved = false;

  reset(): void {
    this.initialized = false;
    this.remainder = 0;
    this.paw = 0;
    this.pendingDashStart = false;
    this.dashMoved = false;
  }

  advance(s: MovementVisualSample, deltaMs: number, emit: MovementContactSink): void {
    if (!s.visible || !Number.isFinite(s.x + s.y + s.size + s.facing) || s.size <= 0) {
      this.reset();
      return;
    }
    const dx = s.x - this.x;
    const dy = s.y - this.y;
    const distance = Math.hypot(dx, dy);
    const interrupted = !this.initialized || this.revision !== s.revision
      || !Number.isFinite(deltaMs) || deltaMs <= 0 || deltaMs > MOVEMENT_FX.maxFrameMs
      || distance > Math.max(s.size * 4, (s.mode === 'dash' ? 2600 : 1000) * deltaMs / 1000);
    if (interrupted) {
      this.reset();
      this.initialized = true;
      this.x = s.x; this.y = s.y; this.mode = s.mode; this.revision = s.revision;
      this.facing = s.facing;
      return;
    }

    if (s.mode !== this.mode) {
      this.remainder = 0;
      if (s.mode === 'dash') this.pendingDashStart = true;
      if (this.mode === 'dash') {
        if (this.dashMoved) emit('dashEnd', s.x, s.y, this.heading, 0, 0, s.facing);
        this.pendingDashStart = false;
        this.dashMoved = false;
      }
    }
    // Tiny interpolation settling must not turn into steps or a new dash direction.
    if (distance > 0.05 && (s.mode === 'walk' || s.mode === 'dash')) {
      this.heading = Math.atan2(dy, dx);
      if (s.mode === 'dash' && this.pendingDashStart) {
        emit('dashStart', this.x, this.y, this.heading, 0, deltaMs, this.facing);
        this.pendingDashStart = false;
      }
      if (s.mode === 'dash') this.dashMoved = true;
      const spacing = s.mode === 'dash' ? Math.max(8, s.size * 0.35) : 2 * s.size / s.pawCount;
      const turn = Math.atan2(Math.sin(s.facing - this.facing), Math.cos(s.facing - this.facing));
      let along = spacing - this.remainder;
      for (; along <= distance + 1e-6; along += spacing) {
        const t = Math.min(1, along / distance);
        const facing = this.facing + turn * t;
        let x = this.x + dx * t;
        let y = this.y + dy * t;
        if (s.mode === 'walk') {
          // Front/hind and left/right belong to the body, even when it walks backwards or strafes.
          const nx = Math.cos(facing);
          const ny = Math.sin(facing);
          const left = this.paw === 0 || (s.pawCount === 4 && this.paw === 3);
          const front = s.pawCount === 4 && (this.paw === 0 || this.paw === 2);
          const lateral = (left ? -1 : 1) * s.size * 0.16;
          const forward = s.pawCount === 4 ? (front ? 1 : -1) * s.size * 0.16 : -s.size * 0.1;
          x += nx * forward - ny * lateral;
          y += ny * forward + nx * lateral;
          emit('step', x, y, this.heading, this.paw, deltaMs * (1 - t), facing);
          this.paw = (this.paw + 1) % s.pawCount;
        } else {
          emit('dashTrail', x, y, this.heading, 0, deltaMs * (1 - t), facing);
        }
      }
      this.remainder = Math.max(0, spacing - (along - distance));
    }
    if (s.mode === 'idle' || s.mode === 'recovery') this.remainder = 0;
    this.x = s.x; this.y = s.y; this.mode = s.mode; this.revision = s.revision;
    this.facing = s.facing;
  }
}
