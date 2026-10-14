import type { TurretFireRoute } from '../TurretFireSource';

/**
 * Real flight between the muzzle and its muzzle portal (D52): shots visibly fly into the portal
 * and only then jump to the exit. Flames keep a short gap and jump at once (stream continuity).
 */
export const FIRE_CONTROL_ENTRY_GAP_PX = 32;
export const FIRE_CONTROL_FLAME_ENTRY_GAP_PX = 6;

/** Muzzle portal pose in front of the real muzzle, following the barrel (§4.4). */
export function resolvePortalEntry(sourceX: number, sourceY: number, angle: number, muzzleOffset: number,
  gapPx: number = FIRE_CONTROL_ENTRY_GAP_PX) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  const muzzleX = sourceX + dx * muzzleOffset, muzzleY = sourceY + dy * muzzleOffset;
  return { muzzleX, muzzleY, entryX: muzzleX + dx * gapPx, entryY: muzzleY + dy * gapPx };
}

/** Entry gap of a weapon: flamethrower streams jump at the muzzle, every other shot flies first. */
export function fireControlEntryGapPx(fireType: string | undefined): number {
  return fireType === 'flamethrower' ? FIRE_CONTROL_FLAME_ENTRY_GAP_PX : FIRE_CONTROL_ENTRY_GAP_PX;
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
  /** Defaults to the projectile gap; see {@link fireControlEntryGapPx}. */
  readonly entryGapPx?: number;
}): TurretFireRoute | null {
  const values = [input.sourceX, input.sourceY, input.angle, input.muzzleOffset, input.exitX, input.exitY,
    input.targetX, input.targetY, input.damageBonus, input.effectiveRangePx];
  if (!values.every(Number.isFinite) || input.damageBonus < 0 || !Number.isSafeInteger(input.deploymentId)) return null;
  const pose = resolvePortalEntry(input.sourceX, input.sourceY, input.angle, input.muzzleOffset, input.entryGapPx);
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
