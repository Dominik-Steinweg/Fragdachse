import * as v from 'valibot';
import type { CombatSource } from './CombatScope';
import type { CombatImmediateAttackOutcome } from './CombatCapabilities';
import type { EnemyAreaClawImpact } from '../systems/EnemyClawAttack';

const positive = v.pipe(v.number(), v.finite(), v.minValue(Number.MIN_VALUE));
export const CombatAreaGeometrySchema = v.variant('kind', [
  v.strictObject({ kind: v.literal('sector'), range: positive,
    arcDegrees: v.pipe(positive, v.maxValue(360)) }),
  v.strictObject({ kind: v.literal('lane'), length: positive, width: positive }),
]);
export type CombatAreaGeometry = v.InferOutput<typeof CombatAreaGeometrySchema>;

/** Radians from +X, clockwise in the Y-down world. Lane origin = middle of its short start edge.
 * Sector: target CENTER angle plus range + radius (existing melee semantics).
 * Lane: exact circle/rotated-rectangle closest-point distance, including rounded corner contacts.
 * Neither query uses client rewind. Both retain the ordinary obstacle/relationship/shield rules.
 */
export const CombatAreaPoseSchema = v.strictObject({
  originX: v.pipe(v.number(), v.finite()), originY: v.pipe(v.number(), v.finite()),
  angle: v.pipe(v.number(), v.finite()), geometry: CombatAreaGeometrySchema,
});
export type CombatAreaPose = v.InferOutput<typeof CombatAreaPoseSchema>;

export interface CombatAreaAttackRequest {
  /** Frozen geometry/times AND owner/part address, retained unchanged in the confirmation. */
  readonly claw: EnemyAreaClawImpact;
  readonly source: CombatSource;
  readonly damage: number;
  readonly nowMs: number;
  /** Players, decoys and hostile-to-source allied units; no rocks, train or bases. */
  readonly targetPolicy: 'hostile-combatants';
}

/** Freeze candidates before mutation, resolve once per attack/target, then commit via Combat. */
export interface CombatAreaAttackPort {
  resolveAreaAttack(request: CombatAreaAttackRequest): CombatImmediateAttackOutcome;
}

export function readCombatAreaPose(raw: unknown): CombatAreaPose | null {
  const result = v.safeParse(CombatAreaPoseSchema, raw);
  return result.success ? result.output : null;
}
