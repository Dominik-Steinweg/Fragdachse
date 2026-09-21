/** Loaded campaign registry. Registry-free authoring rules live in coopDefenseMapAuthoring. */
export * from './coopDefenseMapAuthoring';
import { normalizeCoopDefenseMapConfig, getCoopDefenseMapScheduledXp, type CoopDefenseMapConfig, type CoopDefenseMapAuthoringConfig, type CoopDefenseMapRegistryFile, type CoopDefenseCampaignAuditEntry, type CoopDefenseMapGroundHazardEventConfig } from './coopDefenseMapAuthoring';
import { COOP_DEFENSE_MAP_REGISTRY } from './coopDefenseMaps/index';
import rawWeaponBalanceLabMap from './coopDefenseMaps/weapon-balance-lab.internal.json';
import { DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS, DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS } from '../config';

const NORMALIZED_COOP_DEFENSE_MAP_REGISTRY = normalizeMapRegistry(
  COOP_DEFENSE_MAP_REGISTRY as CoopDefenseMapRegistryFile<CoopDefenseMapAuthoringConfig>,
);

/** Interne Debug-Map; bewusst nicht Teil der auswählbaren Kampagnenregistry. */
export const WEAPON_BALANCE_LAB_MAP_ID = 'weapon-balance-lab';
const WEAPON_BALANCE_LAB_MAP_CONFIG = normalizeCoopDefenseMapConfig(
  rawWeaponBalanceLabMap as CoopDefenseMapConfig,
);

export function isWeaponBalanceLabMapId(mapId: string | null | undefined): boolean {
  return mapId === WEAPON_BALANCE_LAB_MAP_ID;
}

export const COOP_DEFENSE_MAP_CONFIGS = NORMALIZED_COOP_DEFENSE_MAP_REGISTRY.maps;
export const DEFAULT_COOP_DEFENSE_MAP_ID = NORMALIZED_COOP_DEFENSE_MAP_REGISTRY.defaultMapId;

const MAPS_BY_ID = new Map<string, CoopDefenseMapConfig>(
  [
    ...COOP_DEFENSE_MAP_CONFIGS.map((mapConfig) => [mapConfig.mapId, mapConfig] as const),
    [WEAPON_BALANCE_LAB_MAP_CONFIG.mapId, WEAPON_BALANCE_LAB_MAP_CONFIG] as const,
  ],
);

export function getCoopDefenseMapConfig(mapId: string): CoopDefenseMapConfig {
  return MAPS_BY_ID.get(mapId) ?? getDefaultCoopDefenseMapConfig();
}

const diagnosticMapIds = new Set<string>([WEAPON_BALANCE_LAB_MAP_ID]);
let diagnosticMapRevision = 0;
export function getDiagnosticMapRevision(): number { return diagnosticMapRevision; }
export function getDiagnosticMapConfigs(): readonly CoopDefenseMapConfig[] {
  return [...diagnosticMapIds].map(id => MAPS_BY_ID.get(id)!);
}

/** Internal diagnostic composition; authored content never joins the campaign. */
export function registerDiagnosticMap(config: CoopDefenseMapAuthoringConfig): () => void {
  if (MAPS_BY_ID.has(config.mapId)) throw new Error(`Duplicate map: ${config.mapId}`);
  MAPS_BY_ID.set(config.mapId, normalizeCoopDefenseMapConfig(config));
  diagnosticMapIds.add(config.mapId);
  diagnosticMapRevision++;
  return () => {
    if (!diagnosticMapIds.delete(config.mapId)) return;
    MAPS_BY_ID.delete(config.mapId); diagnosticMapRevision++;
  };
}

export function isDiagnosticMapId(mapId: string): boolean {
  return diagnosticMapIds.has(mapId);
}

export function getCoopDefenseCampaignAudit(): readonly CoopDefenseCampaignAuditEntry[] {
  return COOP_DEFENSE_MAP_CONFIGS.map((mapConfig) => ({
    mapId: mapConfig.mapId,
    displayName: `Map ${mapConfig.mapId}`,
    objective: mapConfig.objective,
    arena: {
      widthCells: mapConfig.arenaWidthCells ?? DEFAULT_COOP_DEFENSE_ARENA_WIDTH_CELLS,
      heightCells: mapConfig.arenaHeightCells ?? DEFAULT_COOP_DEFENSE_ARENA_HEIGHT_CELLS,
    },
    tutorial: mapConfig.tutorialPersistent === true || mapConfig.tutorialShowControls === true,
    targetDurationSec: mapConfig.surviveDurationSec ?? mapConfig.balanceReferenceDurationSec,
    encounterIds: (mapConfig.encounters ?? []).map((encounter) => encounter.id),
    triggers: [
      ...(mapConfig.encounters ?? []).map((encounter) => ({
        id: encounter.id,
        kind: 'encounter' as const,
        type: encounter.start.type,
      })),
      ...(mapConfig.mapEvents ?? []).map((event) => ({
        id: event.id,
        kind: 'event' as const,
        type: event.start.type,
      })),
    ],
    finiteXp: getCoopDefenseMapScheduledXp(mapConfig),
    persistentSpawns: (mapConfig.persistentSpawns ?? []).map((spawn) => spawn.id),
    secondaryObjectives: (mapConfig.secondaryObjectives ?? []).map((objective) => `${objective.id}:${objective.type}`),
    events: (mapConfig.mapEvents ?? []).map((event) => ({ id: event.id, type: event.type })),
    boss: mapConfig.boss?.enemyKind ?? null,
    bases: mapConfig.bases.map((base) => ({
      id: base.id,
      role: base.role ?? 'main',
      faction: base.faction ?? 'friendly',
    })),
    outposts: mapConfig.bases.filter((base) => (base.role ?? 'main') === 'outpost').map((base) => base.id),
    spawnStructures: mapConfig.bases
      .filter((base) => (base.role ?? 'main') === 'spawn-point')
      .map((base) => base.id),
    itemLevel: mapConfig.itemDrop?.itemLevel ?? null,
    rockField: mapConfig.rockField !== undefined,
    train: (mapConfig.mapEvents ?? []).some((event) => event.type === 'train'),
    hazards: (mapConfig.mapEvents ?? [])
      .filter((event): event is CoopDefenseMapGroundHazardEventConfig => event.type === 'ground-hazard')
      .map((event) => event.id),
  }));
}

export function getDefaultCoopDefenseMapConfig(): CoopDefenseMapConfig {
  const mapConfig = MAPS_BY_ID.get(DEFAULT_COOP_DEFENSE_MAP_ID);
  if (!mapConfig) {
    throw new Error(`[coopDefenseMaps] Unknown default map id: ${DEFAULT_COOP_DEFENSE_MAP_ID}`);
  }
  return mapConfig;
}

function normalizeMapRegistry(registry: CoopDefenseMapRegistryFile<CoopDefenseMapAuthoringConfig>): CoopDefenseMapRegistryFile {
  const maps = registry.maps.map(normalizeCoopDefenseMapConfig);
  const uniqueMapIds = new Set<string>();
  for (const mapConfig of maps) {
    if (uniqueMapIds.has(mapConfig.mapId)) {
      throw new Error(`[coopDefenseMaps] Duplicate map id: ${mapConfig.mapId}`);
    }
    uniqueMapIds.add(mapConfig.mapId);
  }
  if (!uniqueMapIds.has(registry.defaultMapId)) {
    throw new Error(`[coopDefenseMaps] Default map id is missing from maps: ${registry.defaultMapId}`);
  }
  const campaignIds = maps.filter((mapConfig) => mapConfig.mapId !== '0').map((mapConfig) => mapConfig.mapId);
  const expectedCampaignIds = campaignIds.map((_, index) => String(index + 1));
  if (campaignIds.length !== 17 || campaignIds.some((mapId, index) => mapId !== expectedCampaignIds[index])) {
    throw new Error('[coopDefenseMaps] Campaign registry must contain exactly maps 1 through 17 in order');
  }
  return {
    defaultMapId: registry.defaultMapId,
    maps,
  };
}
