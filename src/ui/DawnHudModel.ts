import type { DawnSchedule } from '../config/dawn/dawnContent';
import type { WorldDefinition } from '../config/authoring/WorldDefinition';
import type { DawnWorldPlan } from '../dawn/contracts/DawnPlans';
import { resolveDawnSites } from '../dawn/resolution/DawnScenarioResolution';
import { resolveDawnPhase } from '../dawn/rules/DawnPhase';
import type { CoopDefenseSecondaryObjectivePresentationState } from '../types';

export interface DawnSiteMarker {
  readonly objectiveId: string;
  readonly visualKey: string;
  readonly gridX: number;
  readonly gridY: number;
}

export function buildDawnSiteMarkers(plan: DawnWorldPlan, world: WorldDefinition): readonly DawnSiteMarker[] {
  return resolveDawnSites(plan).flatMap(site => {
    const clearing = world.terrain.siteClearings?.find(entry => entry.id === site.siteId);
    return clearing ? [{ objectiveId: site.objectiveId, visualKey: site.tier.visualKey,
      gridX: clearing.gridX, gridY: clearing.gridY }] : [];
  });
}

export function buildDawnHudModel(input: {
  readonly schedule: DawnSchedule;
  readonly elapsedMs: number;
  readonly sharedScrap: number;
  readonly threat: number;
  readonly dayNumber: number;
  readonly sites: readonly DawnSiteMarker[];
  readonly objectives: CoopDefenseSecondaryObjectivePresentationState | null;
}) {
  const elapsed = Math.max(0, Number.isFinite(input.elapsedMs) ? input.elapsedMs : 0);
  const state = resolveDawnPhase(input.schedule, elapsed);
  const index = input.schedule.phases.findIndex(entry => entry.id === state.phase);
  const minutes = (clock: string) => { const [h, m] = clock.split(':').map(Number); return h * 60 + m; };
  const from = minutes(input.schedule.phases[index].clock);
  const to = minutes(input.schedule.phases[index + 1]?.clock ?? input.schedule.endClock);
  const fraction = Math.min(1, (elapsed - state.phaseStartMs) / (state.phaseEndMs - state.phaseStartMs));
  const clockMinute = Math.floor(from + ((to - from + 1440) % 1440) * fraction) % 1440;
  const activated = new Set(input.objectives?.filter(entry => entry.state !== 'dormant').map(entry => entry.objectiveId));
  return {
    phase: state.phase,
    clock: `${Math.floor(clockMinute / 60).toString().padStart(2, '0')}:${(clockMinute % 60).toString().padStart(2, '0')}`,
    remainingSeconds: Math.ceil(Math.max(0, state.phaseEndMs - elapsed) / 1000),
    remainingFraction: 1 - fraction,
    scrap: Math.max(0, Math.floor(input.sharedScrap)), threat: input.threat, dayNumber: input.dayNumber,
    returnToBase: state.phase === 'dusk',
    sites: state.phase === 'day' ? input.sites.filter(site => !activated.has(site.objectiveId)) : [],
  };
}
