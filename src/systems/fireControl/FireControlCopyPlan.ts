import { classifyFireControlSource } from './FireControlEligibility';
import { selectFireControlCopySources } from './FireControlSourceSelection';
import { layoutFireControlCopies } from './FireControlCopyLayout';
import type { AutomatedTurret } from '../TurretSystem';

export interface FireControlConstructionFacts {
  readonly id: number;
  readonly ownerId: string;
  readonly baseOwned: boolean;
  readonly constructionId: string | undefined;
  readonly weaponFireType: string | undefined;
  readonly combatReady: boolean;
  readonly manned: boolean;
  readonly x: number; readonly y: number;
  /** Runtime reads for initial aim and the live snapshot; not placement criteria. */
  readonly angle?: number;
  readonly weaponId?: AutomatedTurret['weaponId'];
}

export interface FireControlCopyPlanInput {
  readonly ownerId: string;
  readonly playerX: number; readonly playerY: number;
  readonly pointX: number; readonly pointY: number;
  readonly constructions: readonly FireControlConstructionFacts[];
  readonly slotOrder: readonly string[];
  readonly pausedOriginalIds: ReadonlySet<number>;
  readonly config: {
    readonly placementRangePx: number; readonly maxCopies: number; readonly parallel: boolean;
    readonly ringRadiusPx: number; readonly clearanceRadiusPx: number; readonly singleCopyOffsetPx: number;
  };
  readonly isPointFree: (x: number, y: number, radius: number) => boolean;
}

export type FireControlCopyPlanResult =
  | { readonly ok: true; readonly copies: readonly { readonly originalId: number; readonly x: number; readonly y: number }[] }
  | { readonly ok: false; readonly reason: 'invalid' | 'range' | 'no_fire_sources' | 'placement'; readonly candidates: readonly number[] };

/** Shared host/preview decision, without mutation or source authority from the caller. */
export function planFireControlCopies(input: FireControlCopyPlanInput): FireControlCopyPlanResult {
  const { config, pointX, pointY, playerX, playerY } = input;
  if (![pointX, pointY, playerX, playerY, config.placementRangePx, config.maxCopies,
    config.ringRadiusPx, config.clearanceRadiusPx, config.singleCopyOffsetPx].every(Number.isFinite)
    || config.placementRangePx < 0 || !Number.isSafeInteger(config.maxCopies) || config.maxCopies < 1
    || config.ringRadiusPx < 0 || config.clearanceRadiusPx < 0 || config.singleCopyOffsetPx < 0) {
    return { ok: false, reason: 'invalid', candidates: [] };
  }
  if (Math.hypot(pointX - playerX, pointY - playerY) > config.placementRangePx) {
    return { ok: false, reason: 'range', candidates: [] };
  }
  const eligible = input.constructions.filter(source => !source.manned && classifyFireControlSource({
    ...source, requesterId: input.ownerId, isCopy: false, pausedByCopies: input.pausedOriginalIds.has(source.id),
  }).copyable).map(source => ({ ...source, constructionId: source.constructionId! }));
  if (!eligible.length) return { ok: false, reason: 'no_fire_sources', candidates: [] };
  const selected = selectFireControlCopySources({ candidates: eligible, slotOrder: input.slotOrder,
    pointX, pointY, maxCopies: config.maxCopies });
  const directionAngle = pointX === playerX && pointY === playerY ? -Math.PI / 2 : Math.atan2(pointY - playerY, pointX - playerX);
  const layout = layoutFireControlCopies({ pointX, pointY, count: selected.length,
    ringRadius: config.ringRadiusPx, singleCopyOffsetPx: config.singleCopyOffsetPx, directionAngle,
    isFree: (x, y) => input.isPointFree(x, y, config.clearanceRadiusPx) });
  if (!layout) return { ok: false, reason: 'placement', candidates: selected.map(source => source.id) };
  return { ok: true, copies: selected.map((source, slot) => ({ originalId: source.id, ...layout[slot] })) };
}
