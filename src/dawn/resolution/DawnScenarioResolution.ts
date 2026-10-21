import type { ActivityDefinition } from '../../config/authoring/ActivityDefinition';
import { toAuthoredScenario } from '../../config/authoring/coopDefenseAuthoringAdapter';
import type { WorldDefinition } from '../../config/authoring/WorldDefinition';
import {
  normalizeCoopDefenseMapConfig,
  type CoopBaseConfig,
  type CoopDefenseMapAuthoringConfig,
  type CoopDefenseMapCarryConfig,
  type CoopDefenseMapConfig,
  type CoopDefenseMapEncounterConfig,
  type CoopDefenseMapObjectiveZoneConfig,
  type CoopDefenseMapPersistentSpawnConfig,
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
  getDawnWaveComposition,
  resolveDawnSiteStructurePlacement,
  type DawnArenaTemplate,
  type DawnSalvageSlot,
  type DawnSiteArchetype,
  type DawnSiteArchetypeTier,
} from '../../config/dawn/dawnContent';
import { toDawnActivityDefinitionId, toDawnMapId, toDawnWorldDefinitionId } from '../contracts/DawnIds';
import type { DawnActivityPlan, DawnWorldPlan } from '../contracts/DawnPlans';
import { DAWN_WRECK_VARIANTS } from '../contracts/DawnContentIds';
import { getDawnPhaseStartMs, toDawnDynamicTimeOfDay } from '../rules/DawnPhase';
import { resolveDawnNightModifierContent } from './DawnNightModifierResolution';
import { DAWN_PORTAL_ANCHOR_RADIUS_CELLS, resolveDawnPortalEntryAnchor } from '../rules/DawnPortalPlacement';

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
  /** Portal generator only: the slot near the base where its portal exits. */
  readonly portalExitSlot?: DawnSalvageSlot;
}

/** Entry and exit anchors of a portal generator site: entry inside its clearing toward the base. */
export function resolveDawnPortalAnchors(template: DawnArenaTemplate, site: ResolvedDawnSite):
  { readonly entry: { readonly gridX: number; readonly gridY: number }; readonly exit: { readonly gridX: number; readonly gridY: number } } | null {
  const portal = site.archetype.portal, exitSlot = site.portalExitSlot;
  if (!portal || !exitSlot) return null;
  const entry = resolveDawnPortalEntryAnchor(template, site.slot, portal);
  // The composer only places generators whose entry stays on land; anything else is a foreign plan.
  if (!entry) throw new Error(`[DawnScenarioResolution] Portal generator ${site.slotId} has no dry entry`);
  return { entry, exit: { gridX: exitSlot.anchor.gridX, gridY: exitSlot.anchor.gridY } };
}

export const toDawnPortalLinkId = (slotId: string): string => `portal-${slotId}`;

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

/**
 * Die World-Definition allein aus dem World-Plan. Die World-Seite haengt nur von Template und Sites
 * ab; die Activity-Seite wird dafuer mit einem wellenlosen Plan derselben Sites normalisiert und
 * verworfen. Coop-Config und Activity-Definition brauchen weiterhin beide Plaene.
 */
export function resolveDawnWorldDefinition(worldPlan: DawnWorldPlan): WorldDefinition {
  return resolveDawnScenario(worldPlan, {
    version: worldPlan.version,
    contentHash: worldPlan.contentHash,
    threat: 1,
    dayNumber: 1,
    scheduleId: getDawnThreatCurve(1).scheduleId,
    waves: [],
  }).world;
}

/** Sites eines World-Plans; unbekannte Slots, Archetypen, Varianten oder Tiers brechen ab. */
export function resolveDawnSites(worldPlan: DawnWorldPlan): readonly ResolvedDawnSite[] {
  const template = getDawnArenaTemplate(worldPlan.templateId);
  return worldPlan.sites.map((site) => {
    const archetype = getDawnSiteArchetype(site.archetypeId);
    if (site.variant !== undefined) {
      if (site.archetypeId !== 'wreck') {
        throw new Error(`[DawnScenarioResolution] Site ${site.slotId}: variant is only allowed on wreck sites`);
      }
      if (!DAWN_WRECK_VARIANTS.some(variant => variant === site.variant)) {
        throw new Error(`[DawnScenarioResolution] Site ${site.slotId}: unknown wreck variant ${site.variant}`);
      }
    }
    if ((site.portalExitSlotId === undefined) !== (archetype.portal === undefined)) {
      throw new Error(`[DawnScenarioResolution] Site ${site.slotId}: a portal exit belongs to exactly the portal generator`);
    }
    return {
      slotId: site.slotId,
      siteId: site.slotId,
      baseId: toDawnSiteBaseId(site.slotId),
      objectiveId: toDawnSiteObjectiveId(site.slotId),
      slot: getDawnSalvageSlot(template, site.slotId),
      archetype,
      tier: getDawnSiteArchetypeTier(archetype, site.tier),
      ...(site.portalExitSlotId === undefined ? {} : { portalExitSlot: getDawnSalvageSlot(template, site.portalExitSlotId) }),
    };
  });
}

type DawnWorldAuthoring = Pick<CoopDefenseMapAuthoringConfig, 'mapId' | 'bases' | 'siteClearings' | 'portalAnchors'>
  & DawnArenaTemplate['world'];

/**
 * Carry-Zonen einer Site. Versorgung: Kisten erscheinen unter der Kapsel und werden am Basiskern
 * abgegeben. Sprengstofflager: je Brücke des Templates eine Dynamitkiste, angebracht an Brücken.
 */
export function resolveDawnSiteCarry(template: DawnArenaTemplate, site: ResolvedDawnSite): CoopDefenseMapCarryConfig {
  const supply = resolveDawnSupplyCarry(template, site);
  return site.archetype.carryItem === 'explosive'
    ? { item: 'explosive', spawnZone: supply.spawnZone, itemCount: Math.max(1, template.world.bridges?.length ?? 0) }
    : supply;
}

/** Kisten erscheinen unter der Kapsel in der Lichtung; abgegeben wird am Basiskern. */
export function resolveDawnSupplyCarry(template: DawnArenaTemplate, site: ResolvedDawnSite) {
  const width = template.world.arenaWidthCells ?? Number.MAX_SAFE_INTEGER;
  const height = template.world.arenaHeightCells ?? Number.MAX_SAFE_INTEGER;
  const clampZone = (gridX: number, gridY: number, size: number): CoopDefenseMapObjectiveZoneConfig => ({
    gridX: Math.max(0, Math.min(width - size, gridX)), gridY: Math.max(0, Math.min(height - size, gridY)),
    widthCells: size, heightCells: size,
  });
  const anchor = site.slot.anchor, base = template.world.persistentBase.anchor;
  return {
    spawnZone: clampZone(anchor.gridX - 1, anchor.gridY + 2, 3),
    deliveryZone: clampZone(base.gridX - DAWN_SUPPLY_DELIVERY_HALF_CELLS, base.gridY - DAWN_SUPPLY_DELIVERY_HALF_CELLS,
      DAWN_SUPPLY_DELIVERY_HALF_CELLS * 2),
    itemCount: site.tier.carryItemCount ?? 1,
  };
}
const DAWN_SUPPLY_DELIVERY_HALF_CELLS = 4;

/** Ein aktives Brutnest stoesst bis zu seiner Zerstoerung Gegner aus (persistenter Basis-Spawn). */
function toNestSpawn(site: ResolvedDawnSite): CoopDefenseMapPersistentSpawnConfig[] {
  const spawn = site.tier.nestSpawn;
  return spawn ? [{ id: `nest-${site.slotId}`, enemyKind: spawn.enemyKind as CoopDefenseMapPersistentSpawnConfig['enemyKind'],
    intervalMs: spawn.intervalMs, countPerTick: spawn.countPerTick, startAtMs: 0,
    source: { type: 'base', baseId: site.baseId } }] : [];
}

function composeWorldAuthoring(template: DawnArenaTemplate, sites: readonly ResolvedDawnSite[]): DawnWorldAuthoring {
  const portalAnchors = sites.flatMap((site) => {
    const anchors = resolveDawnPortalAnchors(template, site);
    return anchors ? [
      { id: `${toDawnPortalLinkId(site.slotId)}-entry`, ...anchors.entry, radiusCells: DAWN_PORTAL_ANCHOR_RADIUS_CELLS },
      { id: `${toDawnPortalLinkId(site.slotId)}-exit`, ...anchors.exit, radiusCells: DAWN_PORTAL_ANCHOR_RADIUS_CELLS },
    ] : [];
  });
  return {
    ...template.world,
    mapId: toDawnMapId(template.id),
    bases: sites.map(toSiteStructure),
    siteClearings: sites.map((site): CoopDefenseMapSiteClearingConfig => ({
      id: site.siteId,
      gridX: site.slot.anchor.gridX,
      gridY: site.slot.anchor.gridY,
      radiusCells: site.archetype.clearingRadiusCells,
      // A hit on the generator wakes its guard like entering the clearing.
      ...(site.archetype.portal ? { structureBaseId: site.baseId } : {}),
    })),
    ...(portalAnchors.length ? { portalAnchors } : {}),
  };
}

/** Bauwerk der Site; `dormant` ist das Activity-Overlay, das der Adapter abspaltet. */
function toSiteStructure(site: ResolvedDawnSite): CoopBaseConfig {
  const { structure } = site.archetype;
  const placement = resolveDawnSiteStructurePlacement(structure, site.slot.anchor);
  return {
    id: site.baseId,
    // Site props draw the structures; the portal renderer draws the generator.
    surface: 'none',
    hpMax: site.tier.hpMax,
    faction: structure.faction,
    role: structure.role,
    // Mission targets wait dormant for their site; the supply capsule is scenery, not a target.
    ...(site.archetype.objectiveType === 'carry' ? {} : { dormant: true }),
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
  const nightStartMs = getDawnPhaseStartMs(schedule, 'night');
  const nightSlots = getDawnWaveComposition().night.waves;
  const modifierContent = resolveDawnNightModifierContent(template, activityPlan);
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
    mapEvents: modifierContent.mapEvents,
    persistentSpawns: sites.flatMap(toNestSpawn),
    encounters: [...activityPlan.waves.map((wave): CoopDefenseMapEncounterConfig => {
      const groups = getDawnWaveBlock(wave.blockId).groups;
      if ('siteId' in wave) {
        const site = sites.find((candidate) => candidate.siteId === wave.siteId);
        if (!site) throw new Error(`[DawnScenarioResolution] Wave ${wave.id} targets unknown site ${wave.siteId}`);
        const spawnArea = resolveDawnSiteAssaultArea(template, site);
        return {
          id: wave.id,
          announce: false,
          start: { type: 'site-activated', siteId: site.siteId },
          groups: groups.map((group) => ({ ...group, delayMs: (group.delayMs ?? 0) + wave.atMs, spawnArea })),
        };
      }
      if (!template.fronts.includes(wave.front)) {
        throw new Error(`[DawnScenarioResolution] Wave ${wave.id} uses front ${wave.front}, not offered by ${template.id}`);
      }
      const slot = wave.atMs < nightStartMs ? undefined : nightSlots.find((candidate) => wave.id.startsWith(`${candidate.id}-`));
      if (wave.atMs >= nightStartMs && !slot) {
        throw new Error(`[DawnScenarioResolution] Night wave ${wave.id} has no matching night slot`);
      }
      return {
        id: wave.id,
        announce: slot ? { group: slot.id, ...(slot.id === 'finale' ? { finale: true } : {}) } : false,
        start: { type: 'time', atMs: wave.atMs },
        groups: groups.map((group) => ({ ...group, front: wave.front })),
      };
    }), ...modifierContent.encounters],
    // The generator charges from round start for its share of the day, then holds the flank open.
    ...(sites.some((site) => site.archetype.portal) ? { portalLinks: sites.flatMap((site) => site.archetype.portal ? [{
      id: toDawnPortalLinkId(site.slotId),
      generatorBaseId: site.baseId,
      entryAnchorId: `${toDawnPortalLinkId(site.slotId)}-entry`,
      exitAnchorId: `${toDawnPortalLinkId(site.slotId)}-exit`,
      chargeStartMs: 0,
      chargeDurationMs: Math.round(site.archetype.portal.openAtDayFraction
        * (getDawnPhaseStartMs(schedule, 'dusk') - getDawnPhaseStartMs(schedule, 'day'))),
    }] : []) } : {}),
    secondaryObjectives: sites.map((site): CoopDefenseMapSecondaryObjectiveConfig => ({
      id: site.objectiveId,
      type: site.archetype.objectiveType,
      // Sites laufen gleichzeitig und unabhaengig vom Fokus-Slot; aktiviert werden sie beim Betreten.
      concurrent: true,
      // The portal generator stands from round start and stays destroyable until dawn.
      ...(site.archetype.portal
        ? { start: { type: 'time', atMs: 0 } as const }
        : { start: { type: 'site-activated', siteId: site.siteId } as const, expiresAt: siteClosesAt }),
      // Versorgung: die Kapsel ist Kulisse, Ziel sind die Kisten (Carry-Zonen statt Basis-Targets).
      ...(site.archetype.objectiveType === 'carry'
        ? { targets: [], carry: resolveDawnSiteCarry(template, site) }
        : { targets: [site.baseId] }),
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
