import {
  getDawnSiteArchetype,
  getDawnSiteArchetypeTier,
  getDawnWaveBlocks,
  getDawnWaveComposition,
  resolveDawnWaveBlockWeight,
  type DawnArenaTemplate,
  type DawnFrontRole,
  type DawnPhaseId,
  type DawnPhaseWavesConfig,
  type DawnSchedule,
  type DawnThreatCurve,
  type DawnWaveBlock,
} from '../../config/dawn/dawnContent';
import type { SpawnFront } from '../../types';
import type { DawnSitePlan, DawnWavePlan } from '../contracts/DawnPlans';
import { getDawnPhaseStartMs, resolveDawnPhase } from '../rules/DawnPhase';
import type { DawnRandom } from './DawnRandom';

/** Eine angreifende Front mit ihrer Rolle in dieser Runde. */
export interface DawnAssignedFront {
  readonly front: SpawnFront;
  readonly role: DawnFrontRole;
}

export interface DawnWaveCompositionInput {
  readonly random: DawnRandom;
  readonly curve: DawnThreatCurve;
  readonly schedule: DawnSchedule;
  /** Fronten der Runde aus {@link assignDawnFronts}; die erste ist die Hauptfront. */
  readonly fronts: readonly DawnAssignedFront[];
}

/** Rundungsreserve fuer Budgetanteile; Blockkosten liegen weit darueber. */
const COST_EPSILON = 1e-6;

/** Fit the budget into the bounded wire slots instead of filling them with cheap leftovers. */
function pickBudgetBlock(random: DawnRandom, blocks: readonly DawnWaveBlock[], curve: DawnThreatCurve,
  role: DawnFrontRole, remaining: number, slots: number): DawnWaveBlock | undefined {
  const affordable = blocks.filter(block => block.roles.includes(role)
    && block.cost <= remaining + COST_EPSILON && resolveDawnWaveBlockWeight(block, curve) > 0);
  const target = Math.min(remaining / slots, Math.max(...affordable.map(block => block.cost)));
  return random.pickWeighted(affordable.filter(block => block.cost + COST_EPSILON >= target),
    block => resolveDawnWaveBlockWeight(block, curve)) ?? undefined;
}

/**
 * Verteilt die Frontrollen der Threat-Kurve auf zufaellige Fronten des Templates. Bietet eine
 * Arena weniger Fronten an, entfallen die hinteren Rollen; die Hauptfront bleibt immer.
 */
export function assignDawnFronts(
  random: DawnRandom,
  template: DawnArenaTemplate,
  curve: DawnThreatCurve,
): DawnAssignedFront[] {
  const fronts = random.shuffle(template.fronts);
  return curve.fronts.slice(0, fronts.length).map((role, index) => ({ front: fronts[index], role }));
}

/**
 * Die Nacht: authored Wellen (drei Wellen und ein Finale) innerhalb der Nachtphase, das Budget
 * der Threat-Kurve anteilig je Welle und je Frontrolle. Unverbrauchtes Budget geht an die naechste
 * Welle; die Summe der Blockkosten bleibt im Nachtbudget.
 */
export function composeDawnNight(input: DawnWaveCompositionInput): DawnWavePlan[] {
  return composePhaseWaves(input, 'night', input.curve.nightBudget, getDawnWaveComposition().night, () => input.fronts);
}

/**
 * Angriffswellen und Wrackwaechter: je Site ein Budget aus ihrem Tier, ausgeloest bei ihrer
 * Aktivierung. Der Archetyp bestimmt, ob eine Site einen Angriff mitbringt.
 */
export function composeDawnSiteAssaults(input: {
  readonly random: DawnRandom;
  readonly curve: DawnThreatCurve;
  readonly sites: readonly DawnSitePlan[];
}): DawnWavePlan[] {
  const { random, curve, sites } = input;
  const { day } = getDawnWaveComposition();
  const blocks = getDawnWaveBlocks();
  const plans: DawnWavePlan[] = [];
  for (const site of sites) {
    const archetype = getDawnSiteArchetype(site.archetypeId);
    const budget = getDawnSiteArchetypeTier(archetype, site.tier).assaultBudget;
    if (budget === undefined || archetype.assaultDelayMs === undefined) continue;
    let remaining = budget;
    for (let index = 0; index < day.maxBlocksPerFront; index += 1) {
      const block = pickBudgetBlock(random, blocks, curve, day.frontRole, remaining, day.maxBlocksPerFront - index);
      if (!block) break;
      remaining -= block.cost;
      plans.push({
        id: `assault-${site.slotId}-${index + 1}`,
        blockId: block.id,
        siteId: site.slotId,
        atMs: archetype.assaultDelayMs + index * day.blockStaggerMs,
      });
    }
  }
  return plans;
}

/** Stiller Tagesdruck mit demselben Komponisten: je Welle eine der Fronten dieser Runde. */
export function composeDawnDayPressure(input: DawnWaveCompositionInput): DawnWavePlan[] {
  const { day } = getDawnWaveComposition();
  return composePhaseWaves(input, 'day', input.curve.dayPressureBudget, day, () => [{
    front: input.fronts[input.random.int(input.fronts.length)].front,
    role: day.frontRole,
  }]);
}

function composePhaseWaves(
  { random, curve, schedule }: DawnWaveCompositionInput,
  phase: DawnPhaseId,
  budget: number,
  config: DawnPhaseWavesConfig,
  frontsForWave: () => readonly DawnAssignedFront[],
): DawnWavePlan[] {
  const window = resolveDawnPhase(schedule, getDawnPhaseStartMs(schedule, phase));
  const phaseDurationMs = window.phaseEndMs - window.phaseStartMs;
  const roleShares = getDawnWaveComposition().frontRoleShares;
  const blocks = getDawnWaveBlocks();
  const plans: DawnWavePlan[] = [];
  let carry = 0;
  for (const wave of config.waves) {
    const fronts = frontsForWave();
    const waveBudget = budget * wave.budgetShare + carry;
    const shareSum = fronts.reduce((sum, { role }) => sum + roleShares[role], 0);
    const startMs = window.phaseStartMs + Math.floor(wave.startRatio * phaseDurationMs);
    let spent = 0;
    for (const { front, role } of fronts) {
      let remaining = waveBudget * roleShares[role] / shareSum;
      for (let index = 0; index < config.maxBlocksPerFront; index += 1) {
        const block = pickBudgetBlock(random, blocks, curve, role, remaining, config.maxBlocksPerFront - index);
        if (!block) break;
        remaining -= block.cost;
        spent += block.cost;
        plans.push({
          id: `${wave.id}-${front}-${index + 1}`,
          blockId: block.id,
          front,
          atMs: startMs + index * config.blockStaggerMs,
        });
      }
    }
    carry = Math.max(0, waveBudget - spent);
  }
  return plans;
}
