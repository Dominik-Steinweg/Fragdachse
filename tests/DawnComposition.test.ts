import { describe, expect, it } from 'vitest';
import {
  DAWN_SALVAGE_CONFIG,
  getDawnArenaTemplate,
  getDawnSalvageSlot,
  getDawnSchedule,
  getDawnSiteArchetype,
  getDawnSiteArchetypeTier,
  getDawnSlotQuadrant,
  getDawnThreatCurve,
  getDawnWaveBlock,
  getDawnWaveComposition,
  resolveDawnWaveBlockWeight,
} from '../src/config/dawn/dawnContent';
import { composeDawnRoundPlans, type DawnRoundPlans } from '../src/dawn/composition/DawnRoundComposition';
import {
  DAWN_MAX_THREAT,
  haveSameDawnPlan,
  parseDawnActivityPlan,
  parseDawnWorldPlan,
  type DawnWavePlan,
} from '../src/dawn/contracts/DawnPlans';
import { getDawnPhaseStartMs, resolveDawnPhase } from '../src/dawn/rules/DawnPhase';

const THREATS = Array.from({ length: DAWN_MAX_THREAT }, (_, index) => index + 1);
const SEEDS = [1, 7, 4242, 987_654_321, 2 ** 40 + 3];

function compose(seed: number, threat: number): DawnRoundPlans {
  return composeDawnRoundPlans({ seed, threat, dayNumber: 3 });
}

type DawnFrontWavePlan = Extract<DawnWavePlan, { readonly front: unknown }>;
type DawnSiteWavePlan = Extract<DawnWavePlan, { readonly siteId: string }>;
const frontWaves = (plans: DawnRoundPlans) => plans.activity.waves.filter((wave): wave is DawnFrontWavePlan => 'front' in wave);
const siteWaves = (plans: DawnRoundPlans) => plans.activity.waves.filter((wave): wave is DawnSiteWavePlan => 'siteId' in wave);

function phaseWaves(plans: DawnRoundPlans, phase: 'day' | 'night'): DawnFrontWavePlan[] {
  const schedule = getDawnSchedule(plans.activity.scheduleId);
  return frontWaves(plans).filter((wave) => resolveDawnPhase(schedule, wave.atMs).phase === phase);
}

const costOf = (waves: readonly DawnWavePlan[]) => waves.reduce((sum, wave) => sum + getDawnWaveBlock(wave.blockId).cost, 0);

describe('Dawn round composition', () => {
  it('composes identical plans from the same seed and input', () => {
    const distinct = new Set<string>();
    for (const threat of THREATS) {
      for (const seed of SEEDS) {
        const first = compose(seed, threat);
        const second = compose(seed, threat);
        expect(second).toEqual(first);
        expect(haveSameDawnPlan(second.activity, first.activity)).toBe(true);
        distinct.add(JSON.stringify(first));
      }
    }
    expect(distinct.size).toBe(THREATS.length * SEEDS.length);
  });

  it('refuses to compose without an integral seed or for an unknown threat', () => {
    expect(() => composeDawnRoundPlans({ seed: 1.5, threat: 1, dayNumber: 1 })).toThrow('Seed');
    expect(() => composeDawnRoundPlans({ seed: 1, threat: DAWN_MAX_THREAT + 1, dayNumber: 1 })).toThrow('threat');
  });

  it('gives guarded sites their own assaults inside their authored budgets and delays', () => {
    for (const threat of THREATS) {
      for (const seed of SEEDS) {
        const plans = compose(seed, threat);
        const assaults = siteWaves(plans);
        for (const site of plans.world.sites) {
          const archetype = getDawnSiteArchetype(site.archetypeId);
          const waves = assaults.filter((wave) => wave.siteId === site.slotId);
          const budget = getDawnSiteArchetypeTier(archetype, site.tier).assaultBudget;
          if (budget === undefined) {
            expect(waves, `${threat}/${seed} ${site.slotId}`).toEqual([]);
            continue;
          }
          expect(waves.length, `${threat}/${seed} ${site.slotId}`).toBeGreaterThan(0);
          expect(costOf(waves)).toBeLessThanOrEqual(budget + 1e-6);
          expect(costOf(waves)).toBeGreaterThan(budget * 0.75);
          expect(Math.min(...waves.map(wave => wave.atMs))).toBe(archetype.assaultDelayMs);
        }
        expect(assaults.every((wave) => plans.world.sites.some((site) => site.slotId === wave.siteId))).toBe(true);
      }
    }
  });

  it('keeps every phase inside its threat budget and attacks from the curve fronts', () => {
    const { night, day } = getDawnWaveComposition();
    for (const threat of THREATS) {
      const curve = getDawnThreatCurve(threat);
      for (const seed of SEEDS) {
        const plans = compose(seed, threat);
        const template = getDawnArenaTemplate(plans.world.templateId);
        const nightWaves = phaseWaves(plans, 'night');
        const dayWaves = phaseWaves(plans, 'day');

        expect(nightWaves.length + dayWaves.length, 'front waves only during day and night').toBe(frontWaves(plans).length);
        expect(costOf(nightWaves)).toBeLessThanOrEqual(curve.nightBudget + 1e-6);
        expect(costOf(dayWaves)).toBeLessThanOrEqual(curve.dayPressureBudget + 1e-6);
        // A larger budget must become actual pressure even with a bounded number of wire slots.
        expect(costOf(nightWaves)).toBeGreaterThan(curve.nightBudget * 0.85);
        expect(costOf(dayWaves)).toBeGreaterThan(curve.dayPressureBudget * 0.85);
        const nightFronts = new Set(nightWaves.map(({ front }) => front));
        expect(nightFronts.size).toBe(Math.min(curve.fronts.length, template.fronts.length));
        // Jede aktive Front greift in jeder authored Nachtwelle an; Tagesdruck nur von diesen Fronten.
        for (const wave of night.waves) {
          for (const front of nightFronts) {
            expect(nightWaves.some(({ id }) => id.startsWith(`${wave.id}-${front}-`)), `${threat}/${seed} ${wave.id} ${front}`)
              .toBe(true);
          }
        }
        for (const wave of day.waves) expect(dayWaves.some(({ id }) => id.startsWith(`${wave.id}-`))).toBe(true);
        expect(dayWaves.every(({ front }) => nightFronts.has(front))).toBe(true);
        for (const wave of frontWaves(plans)) {
          expect(template.fronts).toContain(wave.front);
          expect(resolveDawnWaveBlockWeight(getDawnWaveBlock(wave.blockId), curve), wave.blockId).toBeGreaterThan(0);
        }
      }
    }
  });

  it('places unique sites in their bands, spread over quadrants and with higher tiers farther out', () => {
    for (const threat of THREATS) {
      const curve = getDawnThreatCurve(threat);
      for (const seed of SEEDS) {
        const plans = compose(seed, threat);
        const template = getDawnArenaTemplate(plans.world.templateId);
        const base = template.world.persistentBase.anchor;
        const sites = plans.world.sites.map((site) => ({ ...site, slot: getDawnSalvageSlot(template, site.slotId) }));
        const distance = ({ slot }: (typeof sites)[number]) => Math.hypot(
          slot.anchor.gridX - base.gridX, slot.anchor.gridY - base.gridY,
        );

        expect(sites).toHaveLength(Math.min(curve.siteCount, template.salvageSlots.length));
        expect(new Set(sites.map(({ slotId }) => slotId)).size).toBe(sites.length);
        for (const site of sites) {
          const band = (template.salvageBands ?? DAWN_SALVAGE_CONFIG.bands)[site.slot.band];
          expect(distance(site)).toBeGreaterThanOrEqual(band.minCells);
          expect(distance(site)).toBeLessThanOrEqual(band.maxCells);
          expect(curve.tierWeights[site.tier - 1]).toBeGreaterThan(0);
          expect(getDawnSiteArchetype(site.archetypeId).tiers.some(({ tier }) => tier === site.tier)).toBe(true);
        }
        expect(new Set(sites.map((site) => getDawnSlotQuadrant(template, site.slot))).size).toBe(Math.min(sites.length, 4));
        expect(new Set(sites.map((site) => site.slot.band)).size).toBe(Math.min(sites.length, 3));
        const byDistance = [...sites].sort((left, right) => distance(right) - distance(left));
        for (let index = 1; index < byDistance.length; index++) {
          expect(byDistance[index].tier).toBeLessThanOrEqual(byDistance[index - 1].tier);
        }
      }
    }
  });

  it('schedules waves in time order inside the round', () => {
    for (const threat of THREATS) {
      const plans = compose(SEEDS[1], threat);
      const schedule = getDawnSchedule(plans.activity.scheduleId);
      const times = plans.activity.waves.map(({ atMs }) => atMs);
      expect(times).toEqual([...times].sort((left, right) => left - right));
      expect(Math.min(...times)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...times)).toBeLessThan(getDawnPhaseStartMs(schedule, 'dawn'));
      for (const wave of plans.activity.waves) {
        const end = Math.max(...getDawnWaveBlock(wave.blockId).groups.map(group =>
          wave.atMs + (group.delayMs ?? 0) + (group.count - 1) * (group.spawnStaggerMs ?? 0)));
        if ('front' in wave) expect(end).toBeLessThan(resolveDawnPhase(schedule, wave.atMs).phaseEndMs);
        else {
          const site = plans.world.sites.find(site => site.slotId === wave.siteId)!;
          const hold = getDawnSiteArchetype(site.archetypeId).holdDurationMs;
          if (hold !== undefined) expect(end).toBeLessThan(hold);
        }
      }
    }
  });

  it('round-trips composed plans with sites through the wire boundary', () => {
    for (const threat of [1, DAWN_MAX_THREAT]) {
      const plans = compose(SEEDS[2], threat);
      const world = parseDawnWorldPlan(JSON.parse(JSON.stringify(plans.world)));
      const activity = parseDawnActivityPlan(JSON.parse(JSON.stringify(plans.activity)));

      expect(world).toEqual(plans.world);
      expect(activity).toEqual(plans.activity);
      expect(world?.sites.length).toBeGreaterThan(0);
      expect(haveSameDawnPlan(world, plans.world)).toBe(true);
    }
  });
});
