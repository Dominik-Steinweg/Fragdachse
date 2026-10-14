import { expect, it } from 'vitest';
import { ScenarioClock } from '../../src/dev/scenario/clock';
import { composeDawnRoundPlans } from '../../src/dawn/composition/DawnRoundComposition';
import { resolveDawnScenario, resolveDawnSites } from '../../src/dawn/resolution/DawnScenarioResolution';
import { getDawnSchedule } from '../../src/config/dawn/dawnContent';
import { getDawnPhaseStartMs } from '../../src/dawn/rules/DawnPhase';
import { resolveCoopDefenseMapSecondaryObjectives } from '../../src/config/coopDefenseMaps';
import { CoopDefenseMapDirector } from '../../src/systems/CoopDefenseMapDirector';
import { CoopDefenseSecondaryObjectiveSystem } from '../../src/systems/CoopDefenseSecondaryObjectiveSystem';
import { CoopDefenseSiteActivationSystem } from '../../src/systems/CoopDefenseSiteActivationSystem';
import { getArenaMetricsProfile } from '../../src/config';
import { resolveWorldMetrics, worldCellCenter } from '../../src/world/WorldMetrics';

it('fast-forwards all Dawn clocks, expires objectives, closes unvisited sites and keeps future waves live', async () => {
  // A round with a wreck, an extractor and a third site that nobody visits.
  const plans = Array.from({ length: 128 }, (_, seed) => composeDawnRoundPlans({ seed, threat: 3, dayNumber: 1 }))
    .find(candidate => {
      const ids = resolveDawnSites(candidate.world).map(site => site.archetype.id);
      return ids.includes('wreck') && ids.includes('extractor') && ids.length >= 3;
    })!;
  const { mapConfig } = resolveDawnScenario(plans.world, plans.activity);
  const sites = resolveDawnSites(plans.world);
  const wreck = sites.find(site => site.archetype.id === 'wreck')!;
  const extractor = sites.find(site => site.archetype.id === 'extractor')!;
  const unvisited = sites.find(site => site !== wreck && site !== extractor)!;
  const schedule = getDawnSchedule(plans.activity.scheduleId);
  const metrics = resolveWorldMetrics(getArenaMetricsProfile('coop_defense', 'ARENA'));
  const activation = new CoopDefenseSiteActivationSystem(mapConfig.siteClearings!, metrics,
    new Map(sites.map(site => [site.siteId, getDawnPhaseStartMs(schedule, 'dusk')])));
  const trigger = (start: { type: string; siteId?: string }) => start.type === 'site-activated'
    && activation.isSiteActivated(start.siteId!);
  const objectives = new CoopDefenseSecondaryObjectiveSystem(resolveCoopDefenseMapSecondaryObjectives(mapConfig),
    { isExternalTriggerSatisfied: trigger });
  let spawned = 0;
  const director = new CoopDefenseMapDirector(mapConfig.encounters!,
    (_kind, count) => { spawned += count; return []; }, { isEncounterStartSatisfied: trigger });
  const samples = [wreck, extractor].map(site => ({ playerId: site.siteId, eligible: true,
    ...worldCellCenter(metrics, site.slot.anchor.gridX, site.slot.anchor.gridY) }));
  const loop = { callback(_time: number, delta: number) {
    activation.hostUpdate(delta, false, samples);
    director.hostUpdate(delta, false);
    objectives.hostUpdate(delta, false);
  } };
  const clock = new ScenarioClock(loop);
  try {
    const target = getDawnPhaseStartMs(schedule, 'night');
    const done = clock.fastForward(() => target - director.getElapsedMs());
    for (let i = 0; clock.fastForwarding && i < 1000; i++) loop.callback(i * 16, 16);
    await done;
    expect(director.getElapsedMs()).toBeCloseTo(target, 6);
    expect(objectives.getElapsedMs()).toBeCloseTo(target, 6);
    expect(objectives.getObjectiveState(wreck.objectiveId)).toBe('failed');
    expect(objectives.getObjectiveState(extractor.objectiveId)).toBe('completed');
    activation.hostUpdate(0, false, [{ playerId: 'late', eligible: true,
      ...worldCellCenter(metrics, unvisited.slot.anchor.gridX, unvisited.slot.anchor.gridY) }]);
    expect(activation.isSiteActivated(unvisited.siteId)).toBe(false);
    const beforeNight = spawned;
    for (let i = 0; i < 600; i++) loop.callback(i * 16, 16);
    expect(spawned).toBeGreaterThan(beforeNight);
    expect(director.getElapsedMs()).toBeGreaterThan(target);
    expect(clock.paused).toBe(false);
  } finally { clock.destroy(); }
});
