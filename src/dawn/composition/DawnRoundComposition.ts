import { DAWN_CONTENT_HASH, getDawnArenaTemplates } from '../../config/dawn/dawnContent';
import { DAWN_PLAN_VERSION, type DawnActivityPlan, type DawnWorldPlan } from '../contracts/DawnPlans';

export interface DawnRoundCompositionInput {
  readonly threat: number;
  readonly dayNumber: number;
}

export interface DawnRoundPlans {
  readonly world: DawnWorldPlan;
  readonly activity: DawnActivityPlan;
}

const PROBE_SCHEDULE_ID = 'standard';
const PROBE_WAVE_BLOCK_ID = 'probe-zombie-pack';

/**
 * Host-seitige Komposition der Rundenplaene.
 *
 * M0 liefert bewusst eine feste Probe (erstes Template, eine Welle), die den Transport von Host
 * zu Client und Late Join beweist. Der geseedete Threat-Komponist ersetzt sie in M1; Clients rufen
 * diese Funktion nie auf, sie erhalten die fertigen Plaene ueber die Descriptoren.
 */
export function composeDawnRoundPlans(input: DawnRoundCompositionInput): DawnRoundPlans {
  const template = getDawnArenaTemplates()[0];
  return {
    world: { version: DAWN_PLAN_VERSION, templateId: template.id, contentHash: DAWN_CONTENT_HASH, sites: [] },
    activity: {
      version: DAWN_PLAN_VERSION,
      contentHash: DAWN_CONTENT_HASH,
      threat: input.threat,
      dayNumber: input.dayNumber,
      scheduleId: PROBE_SCHEDULE_ID,
      waves: [{ id: 'probe-wave', blockId: PROBE_WAVE_BLOCK_ID, front: template.fronts[0], atMs: 5000 }],
    },
  };
}
