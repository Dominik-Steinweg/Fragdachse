import type * as Phaser from 'phaser';
import { PLAYER_SIZE } from '../config';
import type { LocalPredictionBody } from '../systems/LocalPlayerPrediction';
import { resolveWalkingVelocity, type PlayerMovementGeometry } from '../systems/PlayerMovement';
import type { PlayerEntity } from './PlayerEntity';

/** Uses only this client's player body. Replay never steps the shared World or its callbacks. */
export class ClientPlayerMovementBody implements LocalPredictionBody {
  private controlled = false;
  private previousWorldBounds = false;
  private readonly body: Phaser.Physics.Arcade.Body;
  private readonly velocity = { dx: 0, dy: 0 };

  constructor(private readonly player: PlayerEntity, private readonly geometry: PlayerMovementGeometry) {
    this.body = player.body;
  }

  get x(): number { return this.player.x; }
  get y(): number { return this.player.y; }

  control(enabled: boolean): void {
    if (this.controlled === enabled) return;
    this.controlled = enabled;
    if (!this.player.active || !this.body.world) return;
    this.body.setVelocity(0, 0);
    if (enabled) {
      this.previousWorldBounds = this.body.collideWorldBounds;
      this.body.world.remove(this.body);
      this.body.setCollideWorldBounds(true);
      this.player.setCollisionRadius(PLAYER_SIZE / 2);
    } else {
      this.body.setCollideWorldBounds(this.previousWorldBounds);
      this.body.world.add(this.body);
    }
  }

  reset(x: number, y: number): void {
    // Body.reset is a physics operation, not an authoritative positionRevision increment.
    this.body.reset(x, y);
  }

  step(dx: number, dy: number, speed: number, deltaMs: number): void {
    const world = this.body.world;
    const maxStepMs = 1000 / world.fps;
    for (let remaining = deltaMs; remaining > 1e-7;) {
      const stepMs = Math.min(remaining, maxStepMs);
      resolveWalkingVelocity(this.x, this.y, dx, dy, speed,
        this.geometry.metrics, this.geometry.isBlockedCell, this.velocity);
      this.body.setVelocity(this.velocity.dx, this.velocity.dy);
      this.body.preUpdate(true, stepMs / 1000);
      this.geometry.collide(this.player.physicsProxy);
      this.body.postUpdate();
      remaining -= stepMs;
    }
  }

  canCorrectTo(x: number, y: number): boolean {
    const distance = Math.hypot(x - this.x, y - this.y);
    const radius = PLAYER_SIZE / 2;
    const steps = Math.max(1, Math.ceil(distance / (radius * 0.5)));
    for (let i = 0; i <= steps; i++) {
      if (!this.geometry.canOccupyCircle(this.x + (x - this.x) * i / steps,
        this.y + (y - this.y) * i / steps, radius)) return false;
    }
    return true;
  }

  present(offsetX: number, offsetY: number, walking: boolean, discontinuity: boolean): void {
    if (!this.player.active) return;
    this.player.setWalking(walking);
    this.player.setMovementPresentationOffset(offsetX, offsetY, discontinuity);
  }
}
