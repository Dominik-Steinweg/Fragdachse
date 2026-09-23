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
  /** The host's fixed Arcade step. Collision and corner assist depend on the step size. */
  readonly stepMs: number;
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

/** Exactly one fixed physics step; `index` counts steps within its movement sequence. */
interface MovementSample {
  sequence: number;
  index: number;
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
  private sequenceSteps = 0;
  /** Render time not yet covered by a whole fixed step; shown provisionally, never recorded. */
  private stepRemainderMs = 0;
  private speed = 0;
  private offsetX = 0;
  private offsetY = 0;
  private active = false;
  private holding = false;
  private destroyed = false;
  private moving = false;
  private lastCorrection = 0;

  constructor(readonly worldRevision: number, private readonly ports: LocalPlayerPredictionPorts) {}

  get ownsPosition(): boolean { return this.active || this.holding; }
  get isMoving(): boolean { return this.ownsPosition && this.moving; }
  /** Distance between the predicted and the reconciled body at the latest continuing snapshot. */
  get lastReconciliationError(): number { return this.lastCorrection; }

  setBody(body: LocalPredictionBody | null): void {
    if (this.body === body) return;
    this.reset();
    this.body = body;
    this.lastVersion = -1;
    this.positionRevision = -1;
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
    // positionRevision survives: it is the teleport baseline the entity currently shows.
    this.revision = -1;
    this.sequence = -1; this.sequenceSteps = 0; this.stepRemainderMs = 0;
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
      // Without prediction the entity interpolates this snapshot and applies its teleports itself.
      if (Number.isSafeInteger(snapshot?.positionRevision)) this.positionRevision = snapshot!.positionRevision!;
      return;
    }

    let discontinuity = false;
    if (fresh) {
      this.lastSnapshotAt = nowMs;
      const teleported = snapshot.positionRevision !== this.positionRevision;
      const restart = !this.active || state.revision !== this.revision || teleported;
      const predictedX = this.body.x, predictedY = this.body.y;
      const visualX = predictedX + this.offsetX, visualY = predictedY + this.offsetY;
      this.body.control(true);
      this.body.reset(snapshot.x, snapshot.y);
      if (restart) {
        this.history = [];
        this.sequence = -1; this.sequenceSteps = 0;
        this.ports.restartInput(state.sequence);
      } else {
        // The host consumes whole fixed steps, so its ACK lands on this history's step grid.
        const appliedSteps = Math.round(state.appliedMs / this.body.stepMs);
        this.history = this.history.filter(sample => sample.sequence > state.sequence
          || (sample.sequence === state.sequence && sample.index >= appliedSteps));
        if (this.sequence === state.sequence) this.sequenceSteps = Math.max(this.sequenceSteps, appliedSteps);
        for (const sample of this.history) this.body.step(sample.dx, sample.dy, sample.speed, this.body.stepMs);
      }
      this.speed = state.speed;
      this.revision = state.revision;
      this.positionRevision = snapshot.positionRevision!;
      this.active = true; this.holding = false;
      const correction = Math.hypot(visualX - this.body.x, visualY - this.body.y);
      this.lastCorrection = restart ? 0 : Math.hypot(predictedX - this.body.x, predictedY - this.body.y);
      // A restart only drops unconfirmed history. Unless the host teleported, the visual pose
      // glides onto the new baseline instead of jumping back by the round-trip distance.
      const snap = teleported || correction > LOCAL_MOVEMENT_PREDICTION.snapDistance
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
    const stepMs = this.body.stepMs;
    if (nowMs - this.lastSnapshotAt > LOCAL_MOVEMENT_PREDICTION.maxSnapshotAgeMs) this.hold();
    this.moving = false;
    let partialX = 0, partialY = 0;
    if (this.active) {
      const x = this.body.x, y = this.body.y;
      if (this.sequence !== input.movementSequence) {
        this.sequence = input.movementSequence!;
        this.sequenceSteps = 0;
      }
      // Same fixed grid as the host's Arcade world: sliding along rock seams and the corner
      // assist then resolve identically in live prediction, host simulation and replay.
      this.stepRemainderMs += dt;
      while (this.active && this.stepRemainderMs >= stepMs - 1e-6) {
        if (this.history.length >= LOCAL_MOVEMENT_PREDICTION.maxHistoryEntries
          || (this.history.length + 1) * stepMs > LOCAL_MOVEMENT_PREDICTION.maxHistoryMs) { this.hold(); break; }
        this.stepRemainderMs = Math.max(0, this.stepRemainderMs - stepMs);
        const sample: MovementSample = { sequence: this.sequence, index: this.sequenceSteps++,
          dx: input.dx, dy: input.dy, speed: this.speed };
        this.body.step(sample.dx, sample.dy, sample.speed, stepMs);
        this.history.push(sample);
      }
      if (this.active && this.stepRemainderMs > 1e-6 && (input.dx !== 0 || input.dy !== 0)) {
        // Present the unfinished step without delaying input; the body returns to the grid.
        const gridX = this.body.x, gridY = this.body.y;
        this.body.step(input.dx, input.dy, this.speed, this.stepRemainderMs);
        partialX = this.body.x - gridX; partialY = this.body.y - gridY;
        this.body.reset(gridX, gridY);
      }
      this.moving = Math.hypot(this.body.x + partialX - x, this.body.y + partialY - y) > 0.001;
    }
    const decay = Math.exp(-dt / NET_SMOOTH_TIME_MS);
    this.offsetX *= decay; this.offsetY *= decay;
    if (!this.body.canCorrectTo(this.body.x + this.offsetX, this.body.y + this.offsetY)) {
      this.offsetX = 0; this.offsetY = 0; discontinuity = true;
    }
    this.body.present(this.offsetX + partialX, this.offsetY + partialY, this.moving, discontinuity);
  }

  private hold(): void {
    this.active = false; this.holding = true;
    this.stepRemainderMs = 0;
  }

  destroy(): void { this.reset(); this.body = null; this.destroyed = true; }
}
