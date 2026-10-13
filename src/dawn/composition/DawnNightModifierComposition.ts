import { getDawnNightModifier, getDawnNightModifiers, getDawnThreatCurve, type DawnThreatCurve } from '../../config/dawn/dawnContent';
import type { DawnNightModifierId } from '../contracts/DawnContentIds';
import { createDawnRandom } from './DawnRandom';
import { composeDawnNight, type DawnWaveCompositionInput } from './DawnWaveComposition';

/** One disjoint roll on a private stream; no selection can perturb sites, fronts or day pressure. */
export function selectDawnNightModifier(seed: number, threat: number): DawnNightModifierId | undefined {
  getDawnThreatCurve(threat);
  let roll = createDawnRandom(seed, 'night-modifier').next();
  for (const modifier of getDawnNightModifiers()) {
    roll -= modifier.chanceByThreat[threat - 1];
    if (roll < 0) return modifier.id;
  }
  return undefined;
}

/** Temporary composition input, never a mutation of the shared threat registry. */
export function resolveDawnNightCurve(curve: DawnThreatCurve, id?: DawnNightModifierId): DawnThreatCurve {
  if (!id) return curve;
  const modifier = getDawnNightModifier(id);
  return { ...curve, nightBudget: curve.nightBudget * modifier.nightBudgetMultiplier,
    enemyWeights: Object.fromEntries(Object.entries(curve.enemyWeights).map(([kind, weight]) =>
      [kind, weight * (modifier.enemyWeightMultipliers[kind] ?? 1)])) };
}

export function composeDawnModifiedNight(input: DawnWaveCompositionInput & {
  seed: number; nightModifier?: DawnNightModifierId | 'none';
}) {
  const nightModifierId = input.nightModifier === 'none' ? undefined
    : input.nightModifier ?? selectDawnNightModifier(input.seed, input.curve.threat);
  return { nightModifierId, waves: composeDawnNight({ ...input, curve: resolveDawnNightCurve(input.curve, nightModifierId) }) };
}
