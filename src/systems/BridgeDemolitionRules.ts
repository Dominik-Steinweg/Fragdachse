import { BRIDGE_DEMOLITION_RULES } from '../config/bridges';
import type { BridgePhase } from '../world/WorldBridgeRuntime';

export type BridgeChargeDenial = 'no-explosive' | 'charged' | 'collapsed' | 'out-of-range' | 'not-allowed';

export interface BridgeChargeCheck {
  readonly phase: BridgePhase;
  readonly carryingExplosive: boolean;
  /** Distance from the planter to the nearest deck point, in px. */
  readonly distancePx: number;
  /** Participation, capabilities, life and posture of the planter. */
  readonly allowed: boolean;
}

/**
 * The one rule for planting a charge. The client plaque shows its reason before Shift; the host
 * applies the same function before it consumes the explosive.
 */
export function resolveBridgeChargeDenial(check: BridgeChargeCheck): BridgeChargeDenial | null {
  if (check.phase === 'collapsed') return 'collapsed';
  if (check.phase === 'charged') return 'charged';
  if (!check.allowed) return 'not-allowed';
  if (check.distancePx > BRIDGE_DEMOLITION_RULES.interactRangePx) return 'out-of-range';
  if (!check.carryingExplosive) return 'no-explosive';
  return null;
}
