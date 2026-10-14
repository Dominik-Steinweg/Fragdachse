import { getDawnNightModifier, type DawnSchedule } from '../config/dawn/dawnContent';
import type { WorldDefinition } from '../config/authoring/WorldDefinition';
import type { DawnWorldPlan } from '../dawn/contracts/DawnPlans';
import { resolveDawnSites } from '../dawn/resolution/DawnScenarioResolution';
import { resolveDawnPhase } from '../dawn/rules/DawnPhase';
import type { CoopDefenseSecondaryObjectivePresentationState } from '../types';

/** Measured text and optional icons must fit without abbreviating day or resources. */
export function resolveDawnHudWidth(input: {
  minimum: number; inset: number; title: number; value: number; kicker: number;
  valueIcon: number; kickerIcon: number;
}): number {
  return Math.ceil(Math.max(input.minimum,
    input.inset * 2 + input.title + 12 + input.value + input.valueIcon,
    input.inset * 2 + input.kicker + input.kickerIcon));
}

export interface DawnSiteMarker {
  readonly objectiveId: string;
  readonly visualKey: string;
  readonly archetypeId: string;
  readonly tier: number;
  readonly gridX: number;
  readonly gridY: number;
  /** Clearing = activation radius of the site. */
  readonly radiusCells: number;
  readonly holdDurationMs?: number;
  readonly hidden?: boolean;
}

export function buildDawnSiteMarkers(plan: DawnWorldPlan, world: WorldDefinition): readonly DawnSiteMarker[] {
  return resolveDawnSites(plan).flatMap(site => {
    const clearing = world.terrain.siteClearings?.find(entry => entry.id === site.siteId);
    return clearing ? [{ objectiveId: site.objectiveId, visualKey: site.tier.visualKey,
      archetypeId: site.archetype.id, tier: site.tier.tier,
      gridX: clearing.gridX, gridY: clearing.gridY, radiusCells: site.archetype.clearingRadiusCells,
      ...(site.archetype.holdDurationMs ? { holdDurationMs: site.archetype.holdDurationMs } : {}),
      ...(plan.sites.find(entry => entry.slotId === site.slotId)?.hidden ? { hidden: true } : {}) }] : [];
  });
}

export function buildDawnHudModel(input: {
  readonly schedule: DawnSchedule;
  readonly elapsedMs: number;
  readonly sharedScrap: number;
  readonly threat: number;
  readonly dayNumber: number;
  readonly nightModifierId?: string;
  readonly sites: readonly DawnSiteMarker[];
  readonly objectives: CoopDefenseSecondaryObjectivePresentationState | null;
}) {
  const elapsed = Math.max(0, Number.isFinite(input.elapsedMs) ? input.elapsedMs : 0);
  const state = resolveDawnPhase(input.schedule, elapsed);
  const modifierId = input.nightModifierId ? getDawnNightModifier(input.nightModifierId).id : undefined;
  const activated = new Set(input.objectives?.filter(entry => entry.state !== 'dormant').map(entry => entry.objectiveId));
  return {
    phase: state.phase,
    nightModifier: modifierId && (state.phase === 'dusk' || state.phase === 'night')
      ? { id: modifierId, nameKey: `ui.dawn.nightModifier.${modifierId}` as const } : null,
    scrap: Math.max(0, Math.floor(input.sharedScrap)), threat: input.threat, dayNumber: input.dayNumber,
    returnToBase: state.phase === 'dusk',
    sites: state.phase === 'day' ? input.sites.filter(site => !activated.has(site.objectiveId)) : [],
  };
}
