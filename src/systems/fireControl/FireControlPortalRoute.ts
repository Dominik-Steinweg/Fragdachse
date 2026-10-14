import type { TurretFireRoute } from '../TurretFireSource';

/**
 * Real flight between the muzzle and its muzzle portal (D52): every turret shot, flames included,
 * visibly flies this stretch into the portal and only then jumps to the exit.
 */
export const FIRE_CONTROL_ENTRY_GAP_PX = 48;

/** Muzzle portal pose in front of the real muzzle, following the barrel (§4.4). */
export function resolvePortalEntry(sourceX: number, sourceY: number, angle: number, muzzleOffset: number) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const muzzleX = sourceX + dx * muzzleOffset, muzzleY = sourceY + dy * muzzleOffset;
  return { muzzleX, muzzleY,
    entryX: muzzleX + dx * FIRE_CONTROL_ENTRY_GAP_PX, entryY: muzzleY + dy * FIRE_CONTROL_ENTRY_GAP_PX };
}

/**
 * Builds the route of one portal shot before it is fired (E14/D40). Returns `null` instead of a
 * route the projectile runtime would reject: non-finite pose, negative bonus, or an entry outside
 * the weapon's actually resolved range (including `rangeFactor` and flame reach).
 */
export function buildTurretPortalRoute(input: {
  readonly deploymentId: number;
  readonly sourceX: number; readonly sourceY: number; readonly angle: number; readonly muzzleOffset: number;
  readonly exitX: number; readonly exitY: number;
  readonly targetX: number; readonly targetY: number;
  readonly damageBonus: number;
  readonly effectiveRangePx: number;
}): TurretFireRoute | null {
  const values = [input.sourceX, input.sourceY, input.angle, input.muzzleOffset, input.exitX, input.exitY,
    input.targetX, input.targetY, input.damageBonus, input.effectiveRangePx];
  if (!values.every(Number.isFinite) || input.damageBonus < 0 || !Number.isSafeInteger(input.deploymentId)) return null;
  const pose = resolvePortalEntry(input.sourceX, input.sourceY, input.angle, input.muzzleOffset);
  const dx = Math.cos(input.angle), dy = Math.sin(input.angle);
  const prefix = (pose.entryX - pose.muzzleX) * dx + (pose.entryY - pose.muzzleY) * dy;
  if (prefix < 0 || prefix >= input.effectiveRangePx) return null;
  // Cursor-limited weapons measure their reach from the muzzle to the passed target; the jump is free.
  const reach = prefix + Math.hypot(input.targetX - input.exitX, input.targetY - input.exitY);
  return { deploymentId: input.deploymentId,
    entry: { x: pose.entryX, y: pose.entryY }, exit: { x: input.exitX, y: input.exitY },
    damageBonus: input.damageBonus,
    rangeTargetX: pose.muzzleX + dx * reach, rangeTargetY: pose.muzzleY + dy * reach };
}
