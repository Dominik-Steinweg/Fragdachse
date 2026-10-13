import type { ActivityDefinition } from '../../config/authoring/ActivityDefinition';
import { toAuthoredScenario } from '../../config/authoring/coopDefenseAuthoringAdapter';
import type { WorldDefinition } from '../../config/authoring/WorldDefinition';
import {
  normalizeCoopDefenseMapConfig,
  type CoopBaseConfig,
  type CoopDefenseMapAuthoringConfig,
  type CoopDefenseMapConfig,
  type CoopDefenseMapEncounterConfig,
  type CoopDefenseMapSecondaryObjectiveConfig,
  type CoopDefenseMapSiteClearingConfig,
} from '../../config/coopDefenseMapAuthoring';
import {
  assertDawnContentHash,
  getDawnArenaTemplate,
  getDawnSalvageSlot,
  getDawnSchedule,
  getDawnSiteArchetype,
  getDawnSiteArchetypeTier,
  getDawnThreatCurve,
  getDawnWaveBlock,
  resolveDawnSiteStructurePlacement,
  type DawnArenaTemplate,
  type DawnSalvageSlot,
  type DawnSiteArchetype,
  type DawnSiteArchetypeTier,
} from '../../config/dawn/dawnContent';
import { toDawnActivityDefinitionId, toDawnMapId, toDawnWorldDefinitionId } from '../contracts/DawnIds';
import type { DawnActivityPlan, DawnWorldPlan } from '../contracts/DawnPlans';
import { getDawnPhaseStartMs, toDawnDynamicTimeOfDay } from '../rules/DawnPhase';

/**
 * Der eine reine Resolver vom replizierten Dawn-Plan zur normalen Coop-Config.
 *
 * Host, Client und Late Join rufen ihn mit denselben Plaenen auf und erhalten dieselbe Config:
 * Plan → `CoopDefenseMapAuthoringConfig` → genau einmal `normalizeCoopDefenseMapConfig` →
 * `toAuthoredScenario` mit den Dawn-Definitions-IDs. Nichts davon landet in der Kampagnenregistry.
 *
 * Die World-Seite entsteht ausschliesslich aus Template und World-Plan (Sites); die Activity-Seite
 * aus Activity-Plan und den Sites, deren Ziele sie traegt.
 */
export interface ResolvedDawnScenario {
  readonly mapConfig: CoopDefenseMapConfig;
  readonly world: WorldDefinition;
  readonly activity: ActivityDefinition;
}

/** Eine aufgeloeste Salvage-Site mit den IDs, unter denen sie in der Coop-Config erscheint. */
export interface ResolvedDawnSite {
  readonly slotId: string;
  /** ID der Lichtung und Ziel von `site-activated`. */
  readonly siteId: string;
  readonly baseId: string;
  readonly objectiveId: string;
  readonly slot: DawnSalvageSlot;
  readonly archetype: DawnSiteArchetype;
  readonly tier: DawnSiteArchetypeTier;
}

/** Kantenlaenge des Spawnbereichs einer Site-Angriffswelle. */
const SITE_ASSAULT_AREA_CELLS = 3;

/**
 * Angreifer einer Site erscheinen am Rand ihrer garantiert freien Lichtung, auf der von der Basis
 * abgewandten Seite: Sie kommen aus dem Gelaende auf das Bauwerk zu, nicht aus der Basis.
 */
export function resolveDawnSiteAssaultArea(
  template: DawnArenaTemplate,
  site: Pick<ResolvedDawnSite, 'slot' | 'archetype'>,
): { gridX: number; gridY: number; widthCells: number; heightCells: number } {
  const base = template.world.persistentBase.anchor;
  const anchor = site.slot.anchor;
  const length = Math.hypot(anchor.gridX - base.gridX, anchor.gridY - base.gridY) || 1;
  const reach = site.archetype.clearingRadiusCells - 1.5;
  const centerX = Math.round(anchor.gridX + ((anchor.gridX - base.gridX) / length) * reach);
  const centerY = Math.round(anchor.gridY + ((anchor.gridY - base.gridY) / length) * reach);
  const half = Math.floor(SITE_ASSAULT_AREA_CELLS / 2);
  const width = template.world.arenaWidthCells!;
  const height = template.world.arenaHeightCells!;
  return {
    gridX: Math.min(Math.max(0, centerX - half), width - SITE_ASSAULT_AREA_CELLS),
    gridY: Math.min(Math.max(0, centerY - half), height - SITE_ASSAULT_AREA_CELLS),
    widthCells: SITE_ASSAULT_AREA_CELLS,
    heightCells: SITE_ASSAULT_AREA_CELLS,
  };
}

export function toDawnSiteBaseId(slotId: string): string {
  return `site-${slotId}`;
}

export function toDawnSiteObjectiveId(slotId: string): string {
  return `salvage-${slotId}`;
}

export function resolveDawnScenario(worldPlan: DawnWorldPlan, activityPlan: DawnActivityPlan): ResolvedDawnScenario {
  assertDawnContentHash(worldPlan.contentHash, `Dawn world plan for ${worldPlan.templateId}`);
  assertDawnContentHash(activityPlan.contentHash, `Dawn activity plan for ${worldPlan.templateId}`);
  const template = getDawnArenaTemplate(worldPlan.templateId);
  const sites = resolveDawnSites(worldPlan);
  const mapConfig = normalizeCoopDefenseMapConfig({
    ...composeWorldAuthoring(template, sites),
    ...composeActivityAuthoring(template, sites, activityPlan),
  });
  const scenario = toAuthoredScenario(mapConfig, {
    worldDefinitionId: toDawnWorldDefinitionId(template.id),
    activityDefinitionId: toDawnActivityDefinitionId(template.id),
  });
  if (!scenario.activity) throw new Error(`[DawnScenarioResolution] ${template.id} resolved without an activity`);
  return { mapConfig, world: scenario.world, activity: scenario.activity };
}

/** Sites eines World-Plans; unbekannte Slots, Archetypen oder Tiers brechen ab. */
export function resolveDawnSites(worldPlan: DawnWorldPlan): readonly ResolvedDawnSite[] {
  const template = getDawnArenaTemplate(worldPlan.templateId);
  return worldPlan.sites.map((site) => {
    const archetype = getDawnSiteArchetype(site.archetypeId);
    return {
      slotId: site.slotId,
      siteId: site.slotId,
      baseId: toDawnSiteBaseId(site.slotId),
      objectiveId: toDawnSiteObjectiveId(site.slotId),
      slot: getDawnSalvageSlot(template, site.slotId),
      archetype,
      tier: getDawnSiteArchetypeTier(archetype, site.tier),
    };
  });
}

type DawnWorldAuthoring = Pick<CoopDefenseMapAuthoringConfig, 'mapId' | 'bases' | 'siteClearings'>
  & DawnArenaTemplate['world'];

function composeWorldAuthoring(template: DawnArenaTemplate, sites: readonly ResolvedDawnSite[]): DawnWorldAuthoring {
  return {
    ...template.world,
    mapId: toDawnMapId(template.id),
    bases: sites.map(toSiteStructure),
    siteClearings: sites.map((site): CoopDefenseMapSiteClearingConfig => ({
      id: site.siteId,
      gridX: site.slot.anchor.gridX,
      gridY: site.slot.anchor.gridY,
      radiusCells: site.archetype.clearingRadiusCells,
    })),
  };
}

/** Bauwerk der Site; `dormant` ist das Activity-Overlay, das der Adapter abspaltet. */
function toSiteStructure(site: ResolvedDawnSite): CoopBaseConfig {
  const { structure } = site.archetype;
  const placement = resolveDawnSiteStructurePlacement(structure, site.slot.anchor);
  return {
    id: site.baseId,
    hpMax: site.tier.hpMax,
    faction: structure.faction,
    role: structure.role,
    dormant: true,
    anchor: { kind: 'grid', gridX: placement.anchor.gridX, gridY: placement.anchor.gridY },
    shape: { kind: 'cells', cells: placement.cells },
    ...(structure.spawnCenter ? { spawnCenter: structure.spawnCenter } : {}),
  };
}

type DawnActivityAuthoring = Omit<CoopDefenseMapAuthoringConfig, keyof DawnWorldAuthoring>;

function composeActivityAuthoring(
  template: DawnArenaTemplate,
  sites: readonly ResolvedDawnSite[],
  activityPlan: DawnActivityPlan,
): DawnActivityAuthoring {
  const schedule = getDawnSchedule(activityPlan.scheduleId);
  const curve = getDawnThreatCurve(activityPlan.threat);
  const durationSec = schedule.durationMs / 1000;
  // Sites schliessen in der Daemmerung: ein noch laufendes Ziel scheitert dann ohne Belohnung.
  const siteClosesAt = { type: 'time', atMs: getDawnPhaseStartMs(schedule, 'dusk') } as const;
  return {
    objective: 'defend-until-dawn',
    surviveDurationSec: durationSec,
    balanceReferenceDurationSec: durationSec,
    dynamicTimeOfDay: toDawnDynamicTimeOfDay(schedule),
    respawnDelaySchedule: schedule.phases.map((phase) => ({ fromMs: phase.startMs, delayMs: phase.respawnDelayMs })),
    powerUps: [],
    // Sieg-Item-Angebot (D-16) mit dem Itemlevel der Threat-Kurve.
    itemDrop: { itemLevel: curve.itemLevel },
    encounters: activityPlan.waves.map((wave): CoopDefenseMapEncounterConfig => {
      const groups = getDawnWaveBlock(wave.blockId).groups;
      if ('siteId' in wave) {
        const site = sites.find((candidate) => candidate.siteId === wave.siteId);
        if (!site) throw new Error(`[DawnScenarioResolution] Wave ${wave.id} targets unknown site ${wave.siteId}`);
        const spawnArea = resolveDawnSiteAssaultArea(template, site);
        return {
          id: wave.id,
          start: { type: 'site-activated', siteId: site.siteId },
          groups: groups.map((group) => ({ ...group, delayMs: (group.delayMs ?? 0) + wave.atMs, spawnArea })),
        };
      }
      if (!template.fronts.includes(wave.front)) {
        throw new Error(`[DawnScenarioResolution] Wave ${wave.id} uses front ${wave.front}, not offered by ${template.id}`);
      }
      return {
        id: wave.id,
        start: { type: 'time', atMs: wave.atMs },
        groups: groups.map((group) => ({ ...group, front: wave.front })),
      };
    }),
    secondaryObjectives: sites.map((site): CoopDefenseMapSecondaryObjectiveConfig => ({
      id: site.objectiveId,
      type: site.archetype.objectiveType,
      // Sites laufen gleichzeitig und unabhaengig vom Fokus-Slot; aktiviert werden sie beim Betreten.
      concurrent: true,
      start: { type: 'site-activated', siteId: site.siteId },
      expiresAt: siteClosesAt,
      targets: [site.baseId],
      ...(site.archetype.objectiveType === 'hold'
        ? {
          holdDurationMs: site.archetype.holdDurationMs,
          requiredSurvivors: site.archetype.requiredSurvivors,
          // Schrott zahlt die Dawn-Runtime aus der Archetyp-Registry; Kampagnen-Rewards entfallen.
          rewards: { repairTargetOnComplete: false },
        }
        : {}),
    })),
  };
}
