import {
  DAWN_CONTENT_HASH,
  getDawnArenaTemplates,
  getDawnSchedule,
  getDawnThreatCurve,
} from '../../config/dawn/dawnContent';
import {
  DAWN_PLAN_VERSION,
  parseDawnActivityPlan,
  parseDawnWorldPlan,
  type DawnActivityPlan,
  type DawnWorldPlan,
} from '../contracts/DawnPlans';
import { createDawnRandom } from './DawnRandom';
import { composeDawnSites } from './DawnSiteComposition';
import { assignDawnFronts, composeDawnDayPressure, composeDawnSiteAssaults } from './DawnWaveComposition';
import { composeDawnModifiedNight } from './DawnNightModifierComposition';
import type { DawnNightModifierId } from '../contracts/DawnContentIds';

export interface DawnRoundCompositionInput {
  /** Rundenseed des Hosts; gleicher Seed und gleiche Eingaben ergeben dieselben Plaene. */
  readonly seed: number;
  readonly threat: number;
  readonly dayNumber: number;
  /** Explicit dev recipe override; normal host composition leaves this absent. */
  readonly nightModifier?: DawnNightModifierId | 'none';
}

export interface DawnRoundPlans {
  readonly world: DawnWorldPlan;
  readonly activity: DawnActivityPlan;
}

/**
 * Host-seitige Komposition der Rundenplaene aus Seed, Threat und Tag.
 *
 * Arena, Sites, Fronten, Tagesdruck und Nachtwellen ziehen jeweils aus einem eigenen geseedeten
 * Strom. Clients rufen diese Funktion nie auf; sie erhalten die fertigen Plaene ueber die
 * Descriptoren und loesen sie mit demselben reinen Resolver auf.
 */
export function composeDawnRoundPlans(input: DawnRoundCompositionInput): DawnRoundPlans {
  const { seed, threat, dayNumber } = input;
  const curve = getDawnThreatCurve(threat);
  const templates = getDawnArenaTemplates();
  const template = templates[createDawnRandom(seed, 'template').int(templates.length)];
  const schedule = getDawnSchedule(curve.scheduleId);
  const sites = composeDawnSites({ random: createDawnRandom(seed, 'sites'), template, curve });
  const fronts = assignDawnFronts(createDawnRandom(seed, 'fronts'), template, curve);
  const night = composeDawnModifiedNight({ seed, random: createDawnRandom(seed, 'night'), curve, schedule, fronts, nightModifier: input.nightModifier });
  const waves = [
    ...composeDawnDayPressure({ random: createDawnRandom(seed, 'day'), curve, schedule, fronts }),
    ...night.waves,
    ...composeDawnSiteAssaults({ random: createDawnRandom(seed, 'site-assaults'), curve, sites }),
  ].sort((left, right) => left.atMs - right.atMs || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));

  const world: DawnWorldPlan = { version: DAWN_PLAN_VERSION, templateId: template.id, contentHash: DAWN_CONTENT_HASH, sites };
  const activity: DawnActivityPlan = {
    version: DAWN_PLAN_VERSION,
    contentHash: DAWN_CONTENT_HASH,
    threat,
    dayNumber,
    scheduleId: schedule.id,
    waves,
    ...(night.nightModifierId ? { nightModifierId: night.nightModifierId } : {}),
  };
  // Der Host verschickt nie einen Plan, den die Netzwerkgrenze eines Clients verwerfen wuerde.
  if (!parseDawnWorldPlan(world) || !parseDawnActivityPlan(activity)) {
    throw new Error(`[DawnRoundComposition] Composed plans for threat ${threat} exceed the Dawn plan contract`);
  }
  return { world, activity };
}
