import { clampStructurePosition, type StructurePlatform } from './StructureOccupancySystem';
import type * as Phaser from 'phaser';
import type { WaterGeometry } from '../arena/WaterGeometry';
import type { WorldMetrics } from '../world/WorldMetrics';
import { applyGridCornerAssist, type GridCornerAssistOutput, type MovementBlockedCell } from './GridCornerAssist';

/** Live World geometry; callers may move only their own body, never the World clock. */
export interface PlayerMovementGeometry {
  readonly metrics: WorldMetrics;
  readonly isBlockedCell: MovementBlockedCell;
  getStructurePlatform?(id: string): StructurePlatform | null;
  collide(proxy: Phaser.GameObjects.Zone, playerId?: string): void;
  canOccupyCircle(x: number, y: number, radius: number, playerId?: string): boolean;
}

/** Shared normal-locomotion rule. Gameplay modifiers are resolved by the host. */
export function resolveWalkingVelocity(
  x: number, y: number, dx: number, dy: number, speed: number,
  metrics: WorldMetrics | null, blocked: MovementBlockedCell | null,
  out: GridCornerAssistOutput,
): void {
  dx = Number.isFinite(dx) ? Math.max(-1, Math.min(1, dx)) : 0;
  dy = Number.isFinite(dy) ? Math.max(-1, Math.min(1, dy)) : 0;
  out.dx = dx; out.dy = dy;
  if (metrics && blocked) applyGridCornerAssist(x, y, dx, dy, metrics, blocked, out);
  const length = Math.hypot(out.dx, out.dy);
  const factor = length > 0 && Number.isFinite(speed) ? Math.max(0, speed) / length : 0;
  out.dx *= factor; out.dy *= factor;
}

/** Same post-collision water sweep for host bodies and the isolated client body. */
export function collidePlayerWater(
  body: Phaser.Physics.Arcade.Body | null, water: WaterGeometry | null,
  out: { x: number; y: number; vx: number; vy: number },
): void {
  if (!body?.enable || !water) return;
  if (!water.slideCircle(body.prev.x + body.halfWidth, body.prev.y + body.halfHeight,
    body.center.x, body.center.y, body.halfWidth, body.velocity.x, body.velocity.y, out)) return;
  body.position.set(out.x - body.halfWidth, out.y - body.halfHeight);
  body.updateCenter();
  body.setVelocity(out.vx, out.vy);
}

/** Shared Arcade post-step correction, used by authoritative movement and isolated prediction/replay. */
export function clampStructureBody(body: Phaser.Physics.Arcade.Body | null, platform: StructurePlatform | null): void {
  if (!body?.enable || !platform) return;
  const point = clampStructurePosition(platform, body.center.x, body.center.y);
  if (point.x === body.center.x && point.y === body.center.y) return;
  const vx = point.x === body.center.x ? body.velocity.x : 0;
  const vy = point.y === body.center.y ? body.velocity.y : 0;
  body.position.set(point.x - body.halfWidth, point.y - body.halfHeight);
  body.updateCenter();
  body.setVelocity(vx, vy);
}
