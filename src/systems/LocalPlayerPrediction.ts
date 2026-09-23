import { NET_SMOOTH_TIME_MS, PLAYER_SIZE } from '../config';
import type { PlayerInput, PlayerMovementPredictionState, PlayerNetState } from '../types';

export const LOCAL_MOVEMENT_PREDICTION = {
  maxSnapshotAgeMs: 250,
  maxHistoryMs: 500,
  maxHistoryEntries: 256,
  maxFrameMs: 50,
  snapDistance: PLAYER_SIZE * 4,
} as const;

/** Entity adapter owns the isolated Arcade body and its cosmetic correction offset. */
export interface LocalPredictionBody {
  readonly x: number;
  readonly y: number;
  control(enabled: boolean): void;
  reset(x: number, y: number): void;
  step(dx: number, dy: number, speed: number, deltaMs: number): void;
  canCorrectTo(x: number, y: number): boolean;
  present(offsetX: number, offsetY: number, walking: boolean, discontinuity: boolean): void;
}

export interface LocalPlayerPredictionPorts {
  getInput(): PlayerInput | null;
  restartInput(confirmedSequence: number): void;
}

interface MovementSample {
  sequence: number;
  fromMs: number;
  durationMs: number;
  dx: number;
  dy: number;
  speed: number;
}

type Snapshot = Pick<PlayerNetState, 'x' | 'y' | 'alive' | 'positionRevision' | 'movementPrediction'>;

function validState(state: PlayerMovementPredictionState | undefined): state is PlayerMovementPredictionState {
  return !!state && Number.isSafeInteger(state.sequence) && state.sequence >= 0
    && Number.isSafeInteger(state.revision) && state.revision >= 0
    && Number.isFinite(state.appliedMs) && state.appliedMs >= 0
    && Number.isFinite(state.speed) && state.speed >= 0 && typeof state.canPredict === 'boolean';
}

/** World-scoped, derived local motion. Neither replay nor rendering can mutate host snapshots. */
export class LocalPlayerPrediction {
  private body: LocalPredictionBody | null = null;
  private history: MovementSample[] = [];
  private lastVersion = -1;
  private lastSnapshotAt = -Infinity;
  private revision = -1;
  private positionRevision = -1;
  private sequence = -1;
  private sequenceElapsedMs = 0;
  private speed = 0;
  private offsetX = 0;
  private offsetY = 0;
  private active = false;
  private holding = false;
  private destroyed = false;
  private moving = false;

  constructor(readonly worldRevision: number, private readonly ports: LocalPlayerPredictionPorts) {}

  get ownsPosition(): boolean { return this.active || this.holding; }
  get isMoving(): boolean { return this.ownsPosition && this.moving; }

  setBody(body: LocalPredictionBody | null): void {
    if (this.body === body) return;
    this.reset();
    this.body = body;
    this.lastVersion = -1;
  }

  /** Requires a new snapshot; cached pre-reconnect/round data may not restart prediction. */
  reset(): void {
    if (this.ownsPosition) {
      this.body?.present(0, 0, false, true);
      this.body?.control(false);
    }
    this.active = false; this.holding = false; this.moving = false;
    this.history = [];
    this.offsetX = 0; this.offsetY = 0;
    this.revision = -1; this.positionRevision = -1;
    this.sequence = -1; this.sequenceElapsedMs = 0;
  }

  update(snapshot: Snapshot | undefined, version: number, deltaMs: number, nowMs: number, enabled: boolean): void {
    if (this.destroyed || !this.body) return;
    const fresh = version !== this.lastVersion;
    if (fresh) this.lastVersion = version;
    const state = snapshot?.movementPrediction;
    if (!enabled || !snapshot?.alive || !validState(state) || !state.canPredict
      || !Number.isFinite(snapshot.x) || !Number.isFinite(snapshot.y)
      || !Number.isSafeInteger(snapshot.positionRevision) || snapshot.positionRevision! < 0) {
      this.reset();
      return;
    }

    let discontinuity = false;
    if (fresh) {
      this.lastSnapshotAt = nowMs;
      const restart = !this.active || state.revision !== this.revision
        || snapshot.positionRevision !== this.positionRevision;
      const visualX = this.body.x + this.offsetX, visualY = this.body.y + this.offsetY;
      this.body.control(true);
      this.body.reset(snapshot.x, snapshot.y);
      if (restart) {
        this.history = [];
        this.sequence = -1; this.sequenceElapsedMs = 0;
        this.ports.restartInput(state.sequence);
      } else {
        this.history = this.history.flatMap(sample => {
          if (sample.sequence < state.sequence) return [];
          if (sample.sequence > state.sequence) return [sample];
          const end = sample.fromMs + sample.durationMs;
          if (end <= state.appliedMs) return [];
          const fromMs = Math.max(sample.fromMs, state.appliedMs);
          return [{ ...sample, fromMs, durationMs: end - fromMs }];
        });
        if (this.sequence === state.sequence) this.sequenceElapsedMs = Math.max(this.sequenceElapsedMs, state.appliedMs);
        for (const sample of this.history) this.body.step(sample.dx, sample.dy, sample.speed, sample.durationMs);
      }
      this.speed = state.speed;
      this.revision = state.revision;
      this.positionRevision = snapshot.positionRevision!;
      this.active = true; this.holding = false;
      const correction = Math.hypot(visualX - this.body.x, visualY - this.body.y);
      const snap = restart || correction > LOCAL_MOVEMENT_PREDICTION.snapDistance
        || !this.body.canCorrectTo(visualX, visualY);
      this.offsetX = snap ? 0 : visualX - this.body.x;
      this.offsetY = snap ? 0 : visualY - this.body.y;
      discontinuity = snap || correction > PLAYER_SIZE * 0.3;
    }

    if (!this.ownsPosition) return;
    const input = this.ports.getInput();
    if (!input || input.worldRevision !== this.worldRevision || !Number.isSafeInteger(input.movementSequence)
      || input.movementSequence! <= 0) { this.reset(); return; }
    const dt = Number.isFinite(deltaMs) ? Math.max(0, Math.min(deltaMs, LOCAL_MOVEMENT_PREDICTION.maxFrameMs)) : 0;
    const historyMs = this.history.reduce((sum, sample) => sum + sample.durationMs, 0);
    if (nowMs - this.lastSnapshotAt > LOCAL_MOVEMENT_PREDICTION.maxSnapshotAgeMs
      || this.history.length >= LOCAL_MOVEMENT_PREDICTION.maxHistoryEntries
      || historyMs + dt > LOCAL_MOVEMENT_PREDICTION.maxHistoryMs) {
      this.active = false; this.holding = true;
    }
    this.moving = false;
    if (this.active && dt > 0) {
      if (this.sequence !== input.movementSequence) {
        this.sequence = input.movementSequence!;
        this.sequenceElapsedMs = 0;
      }
      const sample: MovementSample = { sequence: this.sequence, fromMs: this.sequenceElapsedMs,
        durationMs: dt, dx: input.dx, dy: input.dy, speed: this.speed };
      const x = this.body.x, y = this.body.y;
      this.body.step(sample.dx, sample.dy, sample.speed, dt);
      this.moving = Math.hypot(this.body.x - x, this.body.y - y) > 0.001;
      this.history.push(sample);
      this.sequenceElapsedMs += dt;
    }
    const decay = Math.exp(-dt / NET_SMOOTH_TIME_MS);
    this.offsetX *= decay; this.offsetY *= decay;
    if (!this.body.canCorrectTo(this.body.x + this.offsetX, this.body.y + this.offsetY)) {
      this.offsetX = 0; this.offsetY = 0; discontinuity = true;
    }
    this.body.present(this.offsetX, this.offsetY, this.moving, discontinuity);
  }

  destroy(): void { this.reset(); this.body = null; this.destroyed = true; }
}
