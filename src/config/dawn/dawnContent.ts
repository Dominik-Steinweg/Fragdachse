import {
  MAX_COOP_DEFENSE_SITE_CLEARING_RADIUS_CELLS,
  type CoopBaseCellOffset,
  type CoopBaseFaction,
  type CoopDefenseMapAuthoringConfig,
  type CoopDefenseMapEncounterGroupConfig,
  type CoopDefenseMapPersistentBaseConfig,
} from '../coopDefenseMapAuthoring';
import { hasCoopDefenseEnemyKind } from '../coopDefenseEnemies';
import { PERSISTENT_BASE_MAX_AREA_STAGE, resolvePersistentBaseReservationRadiusCells } from '../../persistentBase/PersistentBaseCore';
import { parseTimeOfDay } from '../../effects/TimeOfDay';
import type { SpawnFront } from '../../types';
import { isSpawnFront, SPAWN_FRONTS } from '../../utils/spawnFront';
import { hashCanonicalJson } from '../../dawn/contracts/dawnCanonicalJson';
import { isDawnTemplateId } from '../../dawn/contracts/DawnIds';
import { DAWN_MAX_SITE_TIER, DAWN_MAX_THREAT, isDawnPlanId } from '../../dawn/contracts/DawnPlans';
import { getDawnPhaseStartMs, resolveDawnPhase } from '../../dawn/rules/DawnPhase';
import { DAWN_ARENA_TEMPLATE_SOURCES } from './arenaTemplates/index';
import rawWaveBlocks from './waveBlocks.json';
import rawSchedules from './schedules.json';
import rawSalvage from './salvage.json';
import rawSiteArchetypes from './siteArchetypes.json';
import rawThreatCurves from './threatCurves.json';

/**
 * Loader, Validatoren und Content-Hash der Dawn-Registries.
 *
 * Alles hier ist authored, tunebar und wird beim Import fail-fast geprueft. Der Hash ueber alle
 * Registries steht in jedem Dawn-Plan; ein Peer mit anderem Content-Stand baut die Runde nicht.
 */

/** Erhoehen, wenn sich die Bedeutung eines Registry-Felds aendert, ohne dass der Inhalt es tut. */
const DAWN_CONTENT_SCHEMA_VERSION = 2;

export type DawnSalvageDistanceBand = 'near' | 'mid' | 'far';
const DISTANCE_BANDS: readonly DawnSalvageDistanceBand[] = ['near', 'mid', 'far'];

/** World-Felder einer Dawn-Arena im bestehenden Coop-Map-Authoringformat. */
export type DawnArenaTemplateWorld = Pick<CoopDefenseMapAuthoringConfig,
  | 'arenaWidthCells'
  | 'arenaHeightCells'
  | 'rockFillRatio'
  | 'treeCount'
  | 'rockField'
  | 'rockWalls'
  | 'water'
  | 'waterAreas'
  | 'trackMode'
  | 'trackPosition'
  | 'timeOfDay'
  | 'fogStrength'
> & { readonly persistentBase: CoopDefenseMapPersistentBaseConfig };

/** Authored Ankerzelle einer moeglichen Bergungsstelle. */
export interface DawnSalvageSlot {
  readonly id: string;
  readonly anchor: { readonly gridX: number; readonly gridY: number };
  readonly band: DawnSalvageDistanceBand;
}

export interface DawnArenaTemplate {
  readonly id: string;
  readonly world: DawnArenaTemplateWorld;
  /** Fronten, aus denen diese Arena angegriffen werden kann. */
  readonly fronts: readonly SpawnFront[];
  readonly salvageSlots: readonly DawnSalvageSlot[];
}

/** Rolle einer Front in einer Nacht; bestimmt Budgetanteil und erlaubte Wellenbloecke. */
export type DawnFrontRole = 'primary' | 'secondary' | 'flank';
const FRONT_ROLES: readonly DawnFrontRole[] = ['primary', 'secondary', 'flank'];

/** Authored Gegnergruppe ohne Front; die Front setzt erst der Wellenplan. */
export type DawnWaveBlockGroup = Omit<CoopDefenseMapEncounterGroupConfig, 'front' | 'spawnArea'>;

export interface DawnWaveBlock {
  readonly id: string;
  /** Preis im Threat-Budget; nie unter der Summe der Gegnerkosten (Aufschlag erlaubt, Rabatt nicht). */
  readonly cost: number;
  /** Frontrollen, die dieser Block fuellen darf. */
  readonly roles: readonly DawnFrontRole[];
  readonly groups: readonly DawnWaveBlockGroup[];
}

export type DawnPhaseId = 'day' | 'dusk' | 'night' | 'dawn';
const PHASE_ORDER: readonly DawnPhaseId[] = ['day', 'dusk', 'night', 'dawn'];

export interface DawnSchedulePhase {
  readonly id: DawnPhaseId;
  readonly startMs: number;
  /** Uhrzeit im Spiel bei Phasenbeginn, `HH:MM`. */
  readonly clock: string;
  /** Respawn-Verzoegerung der Spieler in dieser Phase (nachts laenger). */
  readonly respawnDelayMs: number;
}

export interface DawnSchedule {
  readonly id: string;
  readonly durationMs: number;
  readonly phases: readonly DawnSchedulePhase[];
  readonly endClock: string;
}

export type DawnSiteObjectiveType = 'destroy' | 'hold';

/**
 * Bauwerk einer Site. `cells` sind nicht-negative Offsets; der Resolver zentriert die Form auf
 * dem Slot-Anker (siehe {@link resolveDawnSiteStructurePlacement}).
 */
export interface DawnSiteStructureTemplate {
  readonly role: 'outpost' | 'spawn-point';
  readonly faction: CoopBaseFaction;
  readonly cells: readonly CoopBaseCellOffset[];
  /** Nur fuer `spawn-point`: freie Zelle innerhalb der Form. */
  readonly spawnCenter?: CoopBaseCellOffset;
}

export interface DawnSiteArchetypeTier {
  readonly tier: number;
  readonly hpMax: number;
  /** Schrott fuer den Abschluss; die Dawn-Runtime liest ihn hier, er ist kein Coop-Reward. */
  readonly scrapReward: number;
  /** Austauschpunkt fuer die Darstellung (Platzhalter bis zu den finalen Assets). */
  readonly visualKey: string;
  /** Nur `hold`: Budget der Angriffswelle, die bei Aktivierung der Site am Lichtungsrand erscheint. */
  readonly assaultBudget?: number;
}

export interface DawnSiteArchetype {
  readonly id: string;
  readonly objectiveType: DawnSiteObjectiveType;
  /** Relative Auswahlhaeufigkeit beim Komponieren. */
  readonly selectionWeight: number;
  /** Garantiert freie Lichtung und zugleich Aktivierungsradius der Site. */
  readonly clearingRadiusCells: number;
  /** Nur `hold`: Haltedauer ab Aktivierung. */
  readonly holdDurationMs?: number;
  /** Nur `hold`. */
  readonly requiredSurvivors?: number;
  /** Nur `hold`: Verzoegerung der Angriffswelle nach der Aktivierung. */
  readonly assaultDelayMs?: number;
  readonly structure: DawnSiteStructureTemplate;
  /** Genau ein Eintrag je Tier 1..DAWN_MAX_SITE_TIER, aufsteigend. */
  readonly tiers: readonly DawnSiteArchetypeTier[];
}

/** Eine Welle innerhalb einer Phase: Startanteil an der Phasendauer und Anteil am Budget. */
export interface DawnPhaseWaveConfig {
  readonly id: string;
  readonly startRatio: number;
  readonly budgetShare: number;
}

export interface DawnPhaseWavesConfig {
  readonly waves: readonly DawnPhaseWaveConfig[];
  /** Obergrenze der Bloecke je Front und Welle; haelt die Wellenzahl unter dem Wire-Limit. */
  readonly maxBlocksPerFront: number;
  /** Versatz zwischen mehreren Bloecken derselben Front in einer Welle. */
  readonly blockStaggerMs: number;
}

export interface DawnDayPressureConfig extends DawnPhaseWavesConfig {
  /** Tagesdruck kommt je Welle von genau einer Front und nutzt Bloecke dieser Rolle. */
  readonly frontRole: DawnFrontRole;
}

/** Eine Stufe der Threat-Kurve; alle Werte sind tunebare Defaults. */
export interface DawnThreatCurve {
  readonly threat: number;
  readonly scheduleId: string;
  readonly nightBudget: number;
  readonly dayPressureBudget: number;
  /** Frontrollen der Nacht; ihre Anzahl ist die Frontanzahl, die erste ist `primary`. */
  readonly fronts: readonly DawnFrontRole[];
  readonly siteCount: number;
  /** Relative Gewichte fuer Tier 1..DAWN_MAX_SITE_TIER. */
  readonly tierWeights: readonly number[];
  /** Gegnerverfuegbarkeit: Gewicht > 0 heisst verfuegbar. */
  readonly enemyWeights: Readonly<Record<string, number>>;
  /** Itemlevel des Sieg-Item-Angebots (D-16). */
  readonly itemLevel: number;
  readonly scrapMultiplier: number;
}

export interface DawnWaveCompositionConfig {
  readonly frontRoleShares: Readonly<Record<DawnFrontRole, number>>;
  readonly night: DawnPhaseWavesConfig;
  readonly day: DawnDayPressureConfig;
}

export const DAWN_SALVAGE_CONFIG = validateSalvage(rawSalvage);
const SITE_ARCHETYPES = validateSiteArchetypes(rawSiteArchetypes);
/** Groesste Lichtung aller Archetypen; jeder Slot muss jede Site tragen koennen. */
const MAX_SITE_CLEARING_RADIUS_CELLS = Math.max(...[...SITE_ARCHETYPES.values()].map(
  (archetype) => archetype.clearingRadiusCells,
));
validateSalvageAgainstArchetypes();
const SCHEDULES = validateSchedules(rawSchedules);
validateHoldDurations();
const TEMPLATES = validateTemplates(DAWN_ARENA_TEMPLATE_SOURCES);
const ENEMY_THREAT_COSTS = validateEnemyThreatCosts(rawThreatCurves.enemyThreatCosts);
const WAVE_BLOCKS = validateWaveBlocks(rawWaveBlocks);
const WAVE_COMPOSITION = validateWaveComposition(rawThreatCurves);
const THREAT_CURVES = validateThreatCurves(rawThreatCurves.curves);

/** Hash ueber alle Dawn-Registries; Teil jedes Dawn-Plans. */
export const DAWN_CONTENT_HASH = hashCanonicalJson({
  schemaVersion: DAWN_CONTENT_SCHEMA_VERSION,
  templates: [...TEMPLATES.values()],
  waveBlocks: [...WAVE_BLOCKS.values()],
  schedules: [...SCHEDULES.values()],
  salvage: DAWN_SALVAGE_CONFIG,
  siteArchetypes: [...SITE_ARCHETYPES.values()],
  enemyThreatCosts: Object.fromEntries(ENEMY_THREAT_COSTS),
  waveComposition: WAVE_COMPOSITION,
  threatCurves: THREAT_CURVES,
});

export class DawnContentMismatchError extends Error {
  constructor(context: string, expected: string) {
    super(`[dawnContent] ${context} was composed for Dawn content ${expected}, local content is ${DAWN_CONTENT_HASH}`);
    this.name = 'DawnContentMismatchError';
  }
}

/** Fail-fast: Ein Plan eines anderen Content-Stands wird nie aufgeloest. */
export function assertDawnContentHash(contentHash: string, context: string): void {
  if (contentHash !== DAWN_CONTENT_HASH) throw new DawnContentMismatchError(context, contentHash);
}

export function getDawnArenaTemplates(): readonly DawnArenaTemplate[] {
  return [...TEMPLATES.values()];
}

export function getDawnArenaTemplate(templateId: string): DawnArenaTemplate {
  return requireEntry(TEMPLATES, templateId, 'arena template');
}

export function getDawnSalvageSlot(template: DawnArenaTemplate, slotId: string): DawnSalvageSlot {
  const slot = template.salvageSlots.find(({ id }) => id === slotId);
  if (!slot) throw new Error(`[dawnContent] Arena template ${template.id} has no salvage slot ${slotId}`);
  return slot;
}

export function getDawnWaveBlocks(): readonly DawnWaveBlock[] {
  return [...WAVE_BLOCKS.values()];
}

export function getDawnWaveBlock(blockId: string): DawnWaveBlock {
  return requireEntry(WAVE_BLOCKS, blockId, 'wave block');
}

export function getDawnSchedule(scheduleId: string): DawnSchedule {
  return requireEntry(SCHEDULES, scheduleId, 'schedule');
}

export function getDawnSiteArchetypes(): readonly DawnSiteArchetype[] {
  return [...SITE_ARCHETYPES.values()];
}

export function getDawnSiteArchetype(archetypeId: string): DawnSiteArchetype {
  return requireEntry(SITE_ARCHETYPES, archetypeId, 'site archetype');
}

export function getDawnSiteArchetypeTier(archetype: DawnSiteArchetype, tier: number): DawnSiteArchetypeTier {
  const entry = archetype.tiers.find((candidate) => candidate.tier === tier);
  if (!entry) throw new Error(`[dawnContent] Site archetype ${archetype.id} has no tier ${tier}`);
  return entry;
}

export function getDawnThreatCurve(threat: number): DawnThreatCurve {
  const curve = THREAT_CURVES.find((entry) => entry.threat === threat);
  if (!curve) throw new Error(`[dawnContent] No Dawn threat curve for threat ${threat}`);
  return curve;
}

export function getDawnWaveComposition(): DawnWaveCompositionConfig {
  return WAVE_COMPOSITION;
}

export function getDawnEnemyThreatCost(enemyKind: string): number {
  return requireEntry(ENEMY_THREAT_COSTS, enemyKind, 'enemy threat cost');
}

/**
 * Auswahlgewicht eines Blocks bei einem Threat: so selten wie sein seltenster Gegner. Ein Block
 * mit einem dort nicht verfuegbaren Gegner hat Gewicht 0 und wird nie gewaehlt.
 */
export function resolveDawnWaveBlockWeight(block: DawnWaveBlock, curve: DawnThreatCurve): number {
  return Math.min(...block.groups.map((group) => curve.enemyWeights[group.enemyKind] ?? 0));
}

/**
 * Platzierung eines Site-Bauwerks: Die Form wird auf dem Slot-Anker zentriert. Die eine Quelle
 * fuer Resolver und Lichtungs-Validator.
 */
export function resolveDawnSiteStructurePlacement(
  structure: DawnSiteStructureTemplate,
  slotAnchor: { readonly gridX: number; readonly gridY: number },
): { readonly anchor: { readonly gridX: number; readonly gridY: number }; readonly cells: readonly CoopBaseCellOffset[] } {
  const width = Math.max(...structure.cells.map(({ gridX }) => gridX)) + 1;
  const height = Math.max(...structure.cells.map(({ gridY }) => gridY)) + 1;
  return {
    anchor: {
      gridX: slotAnchor.gridX - Math.floor((width - 1) / 2),
      gridY: slotAnchor.gridY - Math.floor((height - 1) / 2),
    },
    cells: structure.cells,
  };
}

/** Quadrant eines Slots relativ zum Basisanker; Achsenpunkte zaehlen nach Osten bzw. Sueden. */
export function getDawnSlotQuadrant(
  template: DawnArenaTemplate,
  slot: DawnSalvageSlot,
): 'north-west' | 'north-east' | 'south-east' | 'south-west' {
  const base = template.world.persistentBase.anchor;
  const east = slot.anchor.gridX >= base.gridX;
  const south = slot.anchor.gridY >= base.gridY;
  if (south) return east ? 'south-east' : 'south-west';
  return east ? 'north-east' : 'north-west';
}

function requireEntry<T>(registry: ReadonlyMap<string, T>, id: string, label: string): T {
  const entry = registry.get(id);
  if (entry === undefined) throw new Error(`[dawnContent] Unknown Dawn ${label}: ${id}`);
  return entry;
}

/** Authored distances are cell-center distances; interval endpoints are inclusive. */
function validateSalvage(raw: typeof rawSalvage): typeof rawSalvage {
  let previousMax = -1;
  for (const band of DISTANCE_BANDS) {
    const range = raw.bands?.[band];
    if (!range || !Number.isFinite(range.minCells) || !Number.isFinite(range.maxCells)
      || range.minCells < 0 || range.minCells <= previousMax || range.maxCells < range.minCells) {
      throw new Error(`[dawnContent] Salvage band ${band} needs ordered, non-overlapping finite distances`);
    }
    previousMax = range.maxCells;
  }
  for (const key of ['minBaseReservationGapCells', 'minArenaEdgeGapCells',
    'minFrontSpawnBandGapCells', 'minSlotSpacingCells'] as const) {
    if (!Number.isFinite(raw[key]) || raw[key] <= 0) {
      throw new Error(`[dawnContent] Salvage ${key} must be positive and finite`);
    }
  }
  if (!Number.isFinite(raw.frontSpawnBandRatio) || raw.frontSpawnBandRatio <= 0 || raw.frontSpawnBandRatio >= 0.5) {
    throw new Error('[dawnContent] Salvage frontSpawnBandRatio must be between 0 and 0.5');
  }
  return raw;
}

/** Lichtungen benachbarter Slots duerfen sich nicht ueberlappen und nicht ins Spawnband reichen. */
function validateSalvageAgainstArchetypes(): void {
  if (DAWN_SALVAGE_CONFIG.minSlotSpacingCells < 2 * MAX_SITE_CLEARING_RADIUS_CELLS) {
    throw new Error('[dawnContent] Salvage minSlotSpacingCells must keep the largest site clearings apart');
  }
  if (DAWN_SALVAGE_CONFIG.minFrontSpawnBandGapCells <= MAX_SITE_CLEARING_RADIUS_CELLS) {
    throw new Error('[dawnContent] Salvage minFrontSpawnBandGapCells must keep site clearings out of spawn bands');
  }
}

function validateSiteArchetypes(raw: { readonly archetypes: readonly unknown[] }): ReadonlyMap<string, DawnSiteArchetype> {
  const archetypes = new Map<string, DawnSiteArchetype>();
  const visualKeys = new Set<string>();
  for (const source of raw.archetypes) {
    const archetype = source as DawnSiteArchetype;
    if (!isDawnPlanId(archetype?.id) || archetypes.has(archetype.id)) {
      throw new Error(`[dawnContent] Invalid or duplicate site archetype ${String(archetype?.id)}`);
    }
    const label = `Site archetype ${archetype.id}`;
    if (archetype.objectiveType !== 'destroy' && archetype.objectiveType !== 'hold') {
      throw new Error(`[dawnContent] ${label} needs objectiveType destroy or hold`);
    }
    if (!isPositiveFinite(archetype.selectionWeight)) throw new Error(`[dawnContent] ${label} needs a positive selectionWeight`);
    const radius = archetype.clearingRadiusCells;
    if (!Number.isFinite(radius) || radius < 2 || radius > MAX_COOP_DEFENSE_SITE_CLEARING_RADIUS_CELLS) {
      throw new Error(`[dawnContent] ${label} needs a clearing radius between 2 and ${MAX_COOP_DEFENSE_SITE_CLEARING_RADIUS_CELLS}`);
    }
    validateSiteStructure(label, archetype);
    if (archetype.objectiveType === 'hold') {
      if (!isPositiveInteger(archetype.holdDurationMs)) throw new Error(`[dawnContent] ${label} needs a holdDurationMs`);
      // Eine Site hat genau ein Bauwerk; mehr Ueberlebende kann sie nicht stellen.
      if (archetype.requiredSurvivors !== 1) throw new Error(`[dawnContent] ${label} needs requiredSurvivors 1`);
      // Ohne Angreifer waere Halten trivial: jede Hold-Site bringt ihre eigene Welle mit.
      if (!Number.isSafeInteger(archetype.assaultDelayMs) || archetype.assaultDelayMs! < 0
        || archetype.assaultDelayMs! >= archetype.holdDurationMs!) {
        throw new Error(`[dawnContent] ${label} needs an assaultDelayMs inside its hold window`);
      }
      if (archetype.tiers?.some((tier) => !isPositiveFinite(tier?.assaultBudget))) {
        throw new Error(`[dawnContent] ${label} needs a positive assaultBudget per tier`);
      }
    } else if (archetype.holdDurationMs !== undefined || archetype.requiredSurvivors !== undefined
      || archetype.assaultDelayMs !== undefined || archetype.tiers?.some((tier) => tier?.assaultBudget !== undefined)) {
      throw new Error(`[dawnContent] ${label} must not declare hold fields`);
    }
    if (!Array.isArray(archetype.tiers) || archetype.tiers.length !== DAWN_MAX_SITE_TIER) {
      throw new Error(`[dawnContent] ${label} needs exactly ${DAWN_MAX_SITE_TIER} tiers`);
    }
    archetype.tiers.forEach((tier, index) => {
      if (tier?.tier !== index + 1) throw new Error(`[dawnContent] ${label} must list tiers 1..${DAWN_MAX_SITE_TIER} in order`);
      if (!isPositiveInteger(tier.hpMax)) throw new Error(`[dawnContent] ${label} tier ${tier.tier} needs a positive hpMax`);
      if (!Number.isFinite(tier.scrapReward) || tier.scrapReward < 0) {
        throw new Error(`[dawnContent] ${label} tier ${tier.tier} needs a non-negative scrapReward`);
      }
      if (!isDawnPlanId(tier.visualKey) || visualKeys.has(tier.visualKey)) {
        throw new Error(`[dawnContent] ${label} tier ${tier.tier} needs a unique visualKey`);
      }
      visualKeys.add(tier.visualKey);
    });
    archetypes.set(archetype.id, archetype);
  }
  if (archetypes.size === 0) throw new Error('[dawnContent] At least one Dawn site archetype is required');
  return archetypes;
}

function validateSiteStructure(label: string, archetype: DawnSiteArchetype): void {
  const structure = archetype.structure;
  if (!structure || (structure.role !== 'outpost' && structure.role !== 'spawn-point')) {
    throw new Error(`[dawnContent] ${label} structure needs role outpost or spawn-point`);
  }
  // Nur Gegnerstrukturen sind beschaedigbar, und nur eigene Strukturen lassen sich halten.
  const expectedFaction: CoopBaseFaction = archetype.objectiveType === 'destroy' ? 'hostile' : 'friendly';
  if (structure.faction !== expectedFaction) {
    throw new Error(`[dawnContent] ${label} structure must be ${expectedFaction} for ${archetype.objectiveType}`);
  }
  const cells = structure.cells;
  const keys = new Set<string>();
  if (!Array.isArray(cells) || cells.length === 0 || cells.some((cell) => {
    if (!isNonNegativeInteger(cell?.gridX) || !isNonNegativeInteger(cell?.gridY)) return true;
    const key = `${cell.gridX}_${cell.gridY}`;
    if (keys.has(key)) return true;
    keys.add(key);
    return false;
  })) {
    throw new Error(`[dawnContent] ${label} structure needs unique non-negative integer cells`);
  }
  if (Math.min(...cells.map(({ gridX }) => gridX)) !== 0 || Math.min(...cells.map(({ gridY }) => gridY)) !== 0) {
    throw new Error(`[dawnContent] ${label} structure cells must start at offset 0`);
  }
  const spawnCenter = structure.spawnCenter;
  if ((structure.role === 'spawn-point') !== (spawnCenter !== undefined)) {
    throw new Error(`[dawnContent] ${label} structure declares spawnCenter exactly when it is a spawn point`);
  }
  if (spawnCenter && (!isNonNegativeInteger(spawnCenter.gridX) || !isNonNegativeInteger(spawnCenter.gridY)
    || keys.has(`${spawnCenter.gridX}_${spawnCenter.gridY}`))) {
    throw new Error(`[dawnContent] ${label} structure spawnCenter must be a free cell`);
  }
  // Das Bauwerk steht in seiner Lichtung und laesst innerhalb des garantierten Kerns einen Laufring.
  const placement = resolveDawnSiteStructurePlacement(structure, { gridX: 0, gridY: 0 });
  const farthest = Math.max(...placement.cells.map((cell) => Math.hypot(
    placement.anchor.gridX + cell.gridX,
    placement.anchor.gridY + cell.gridY,
  )));
  if (farthest + 1 > archetype.clearingRadiusCells) {
    throw new Error(`[dawnContent] ${label} structure does not fit inside its clearing`);
  }
}

/** Also used by authoring checks before registering a template. */
export function validateTemplates(sources: readonly unknown[]): ReadonlyMap<string, DawnArenaTemplate> {
  const templates = new Map<string, DawnArenaTemplate>();
  for (const source of sources) {
    const template = source as DawnArenaTemplate;
    if (!isDawnTemplateId(template?.id)) throw new Error('[dawnContent] Arena template needs a valid id');
    const label = `Arena template ${template.id}`;
    if (templates.has(template.id)) throw new Error(`[dawnContent] Duplicate ${label}`);
    const world = template.world;
    if (!world || typeof world !== 'object') throw new Error(`[dawnContent] ${label} needs world authoring`);
    if (!world.persistentBase) throw new Error(`[dawnContent] ${label} needs a persistent base site`);
    // Dawn-Arenen tragen den vollen Ausbau; die Expansion darf an keiner Arena haengen bleiben.
    if (world.persistentBase.maxAreaStage !== PERSISTENT_BASE_MAX_AREA_STAGE) {
      throw new Error(`[dawnContent] ${label} must support persistent base stage ${PERSISTENT_BASE_MAX_AREA_STAGE}`);
    }
    if (!isPositiveInteger(world.arenaWidthCells) || !isPositiveInteger(world.arenaHeightCells)) {
      throw new Error(`[dawnContent] ${label} needs explicit arena dimensions`);
    }
    // Die World-Uhr beginnt mit dem Template; jeder Zeitplan muss dort anschliessen.
    for (const schedule of SCHEDULES.values()) {
      if (parseTimeOfDay(world.timeOfDay ?? '') !== parseTimeOfDay(schedule.phases[0].clock)) {
        throw new Error(`[dawnContent] ${label} timeOfDay must match the start clock of schedule ${schedule.id}`);
      }
    }
    const width = world.arenaWidthCells;
    const height = world.arenaHeightCells;
    const baseAnchor = world.persistentBase.anchor;
    const reservation = resolvePersistentBaseReservationRadiusCells(world.persistentBase.maxAreaStage);
    if (!baseAnchor || !Number.isSafeInteger(baseAnchor.gridX) || !Number.isSafeInteger(baseAnchor.gridY)
      || baseAnchor.gridX - reservation < 0 || baseAnchor.gridX + reservation >= width
      || baseAnchor.gridY - reservation < 0 || baseAnchor.gridY + reservation >= height) {
      throw new Error(`[dawnContent] ${label} needs an in-bounds base reservation`);
    }
    if (!Array.isArray(template.fronts) || template.fronts.length === 0
      || template.fronts.some((front) => !isSpawnFront(front))
      || new Set(template.fronts).size !== template.fronts.length) {
      throw new Error(`[dawnContent] ${label} needs unique valid fronts`);
    }
    const slotIds = new Set<string>();
    const previousSlots: DawnSalvageSlot[] = [];
    const salvage = DAWN_SALVAGE_CONFIG;
    // Same inclusive band depth as CoopDefenseSpawnExecutor.getEdgeBand / ArenaGenerator.
    // The ratio is authored here so Dawn spacing participates in the content hash.
    const depthX = Math.min(Math.max(2, Math.floor(width * salvage.frontSpawnBandRatio)), width - 1);
    const depthY = Math.min(Math.max(2, Math.floor(height * salvage.frontSpawnBandRatio)), height - 1);
    for (const slot of template.salvageSlots ?? []) {
      if (!isDawnPlanId(slot.id) || slotIds.has(slot.id)) {
        throw new Error(`[dawnContent] ${label} has an invalid or duplicate salvage slot ${slot.id}`);
      }
      slotIds.add(slot.id);
      if (!DISTANCE_BANDS.includes(slot.band)) {
        throw new Error(`[dawnContent] ${label} slot ${slot.id} has an unknown distance band`);
      }
      const { gridX, gridY } = slot.anchor ?? {};
      if (!Number.isSafeInteger(gridX) || !Number.isSafeInteger(gridY)
        || gridX < 0 || gridY < 0 || gridX >= world.arenaWidthCells! || gridY >= world.arenaHeightCells!) {
        throw new Error(`[dawnContent] ${label} slot ${slot.id} lies outside the arena`);
      }
      const distance = Math.hypot(gridX - baseAnchor.gridX, gridY - baseAnchor.gridY);
      if (distance < reservation + salvage.minBaseReservationGapCells
        || distance <= reservation + MAX_SITE_CLEARING_RADIUS_CELLS) {
        throw new Error(`[dawnContent] ${label} slot ${slot.id} overlaps the base reservation or its gap`);
      }
      const band = salvage.bands[slot.band];
      if (distance < band.minCells || distance > band.maxCells) {
        throw new Error(`[dawnContent] ${label} slot ${slot.id} lies outside its ${slot.band} distance band`);
      }
      const edgeGap = Math.min(gridX, gridY, width - 1 - gridX, height - 1 - gridY);
      if (edgeGap < salvage.minArenaEdgeGapCells || edgeGap < MAX_SITE_CLEARING_RADIUS_CELLS) {
        throw new Error(`[dawnContent] ${label} slot ${slot.id} is too close to the arena edge`);
      }
      const frontGaps: Record<SpawnFront, number> = {
        west: gridX - depthX, east: width - 1 - depthX - gridX,
        north: gridY - depthY, south: height - 1 - depthY - gridY,
      };
      if (template.fronts.some((front: SpawnFront) => frontGaps[front] < salvage.minFrontSpawnBandGapCells)) {
        throw new Error(`[dawnContent] ${label} slot ${slot.id} is too close to a front spawn band`);
      }
      if (previousSlots.some(other => Math.hypot(gridX - other.anchor.gridX, gridY - other.anchor.gridY)
        < salvage.minSlotSpacingCells)) {
        throw new Error(`[dawnContent] ${label} slot ${slot.id} is too close to another salvage slot`);
      }
      previousSlots.push(slot);
    }
    const validated: DawnArenaTemplate = { ...template, salvageSlots: template.salvageSlots ?? [] };
    // Die Komposition verteilt Sites ueber Quadranten und Baender; dafuer muss jedes Paar existieren.
    if (validated.salvageSlots.length > 0) {
      const pairs = new Set(validated.salvageSlots.map((slot) => `${getDawnSlotQuadrant(validated, slot)}:${slot.band}`));
      if (pairs.size !== 4 * DISTANCE_BANDS.length) {
        throw new Error(`[dawnContent] ${label} must offer every distance band in every quadrant`);
      }
    }
    templates.set(template.id, validated);
  }
  if (templates.size === 0) throw new Error('[dawnContent] At least one Dawn arena template is required');
  return templates;
}

function validateEnemyThreatCosts(raw: Readonly<Record<string, number>>): ReadonlyMap<string, number> {
  const costs = new Map<string, number>();
  for (const [enemyKind, cost] of Object.entries(raw ?? {})) {
    if (!hasCoopDefenseEnemyKind(enemyKind)) throw new Error(`[dawnContent] Threat cost for unknown enemy ${enemyKind}`);
    if (!isPositiveFinite(cost)) throw new Error(`[dawnContent] Enemy ${enemyKind} needs a positive threat cost`);
    costs.set(enemyKind, cost);
  }
  if (costs.size === 0) throw new Error('[dawnContent] Dawn needs enemy threat costs');
  return costs;
}

function validateWaveBlocks(raw: { readonly blocks: readonly unknown[] }): ReadonlyMap<string, DawnWaveBlock> {
  const blocks = new Map<string, DawnWaveBlock>();
  for (const source of raw.blocks) {
    const block = source as DawnWaveBlock;
    if (!isDawnPlanId(block?.id) || blocks.has(block.id)) {
      throw new Error(`[dawnContent] Invalid or duplicate wave block ${String(block?.id)}`);
    }
    if (!Array.isArray(block.groups) || block.groups.length === 0) {
      throw new Error(`[dawnContent] Wave block ${block.id} needs at least one group`);
    }
    if (!Array.isArray(block.roles) || block.roles.length === 0
      || block.roles.some((role) => !FRONT_ROLES.includes(role)) || new Set(block.roles).size !== block.roles.length) {
      throw new Error(`[dawnContent] Wave block ${block.id} needs unique valid front roles`);
    }
    let baselineCost = 0;
    for (const group of block.groups) {
      if ('front' in group || 'spawnArea' in group) {
        throw new Error(`[dawnContent] Wave block ${block.id} must not author a front; the wave plan sets it`);
      }
      if (!hasCoopDefenseEnemyKind(group.enemyKind)) {
        throw new Error(`[dawnContent] Wave block ${block.id} uses unknown enemy ${group.enemyKind}`);
      }
      if (!ENEMY_THREAT_COSTS.has(group.enemyKind)) {
        throw new Error(`[dawnContent] Wave block ${block.id} uses enemy ${group.enemyKind} without a threat cost`);
      }
      if (!isPositiveInteger(group.count)) throw new Error(`[dawnContent] Wave block ${block.id} needs positive counts`);
      baselineCost += group.count * ENEMY_THREAT_COSTS.get(group.enemyKind)!;
    }
    if (!isPositiveFinite(block.cost) || block.cost < baselineCost) {
      throw new Error(`[dawnContent] Wave block ${block.id} must cost at least its enemies (${baselineCost})`);
    }
    blocks.set(block.id, block);
  }
  if (blocks.size === 0) throw new Error('[dawnContent] At least one Dawn wave block is required');
  return blocks;
}

function validateSchedules(raw: { readonly schedules: readonly unknown[] }): ReadonlyMap<string, DawnSchedule> {
  const schedules = new Map<string, DawnSchedule>();
  for (const source of raw.schedules) {
    const schedule = source as DawnSchedule;
    if (!isDawnPlanId(schedule?.id) || schedules.has(schedule.id)) {
      throw new Error(`[dawnContent] Invalid or duplicate schedule ${String(schedule?.id)}`);
    }
    const label = `Schedule ${schedule.id}`;
    // Die Missionszeit ist ganzzahlig in Sekunden; der Sieg darf nicht vor dem Morgengrauen liegen.
    if (!isPositiveInteger(schedule.durationMs) || schedule.durationMs % 1000 !== 0) {
      throw new Error(`[dawnContent] ${label} needs a duration in whole seconds`);
    }
    if (parseTimeOfDay(schedule.endClock) === null) throw new Error(`[dawnContent] ${label} has an invalid endClock`);
    const phases = schedule.phases ?? [];
    if (phases.length !== PHASE_ORDER.length || phases.some((phase, index) => phase.id !== PHASE_ORDER[index])) {
      throw new Error(`[dawnContent] ${label} must list phases ${PHASE_ORDER.join(', ')} in order`);
    }
    phases.forEach((phase, index) => {
      const previous = index === 0 ? -1 : phases[index - 1].startMs;
      if (!Number.isSafeInteger(phase.startMs) || phase.startMs <= previous || phase.startMs >= schedule.durationMs
        || (index === 0 && phase.startMs !== 0)) {
        throw new Error(`[dawnContent] ${label} phase ${phase.id} has an invalid start`);
      }
      if (parseTimeOfDay(phase.clock) === null) throw new Error(`[dawnContent] ${label} phase ${phase.id} has an invalid clock`);
      if (!isPositiveInteger(phase.respawnDelayMs)) {
        throw new Error(`[dawnContent] ${label} phase ${phase.id} needs a positive respawnDelayMs`);
      }
    });
    schedules.set(schedule.id, schedule);
  }
  return schedules;
}

/** Sites schliessen in der Daemmerung; ein Halten muss vorher abschliessen koennen. */
function validateHoldDurations(): void {
  for (const archetype of SITE_ARCHETYPES.values()) {
    if (archetype.holdDurationMs === undefined) continue;
    for (const schedule of SCHEDULES.values()) {
      if (archetype.holdDurationMs >= getPhaseWindow(schedule, 'day').endMs) {
        throw new Error(`[dawnContent] Site archetype ${archetype.id} cannot finish its hold before dusk in ${schedule.id}`);
      }
    }
  }
}

function validateWaveComposition(raw: typeof rawThreatCurves): DawnWaveCompositionConfig {
  const shares = raw.frontRoleShares as Record<DawnFrontRole, number>;
  for (const role of FRONT_ROLES) {
    if (!isPositiveFinite(shares?.[role])) throw new Error(`[dawnContent] Front role ${role} needs a positive budget share`);
  }
  const night = validatePhaseWaves('night', raw.night as DawnPhaseWavesConfig);
  const day = validatePhaseWaves('day', raw.day as DawnPhaseWavesConfig) as DawnDayPressureConfig;
  if (!FRONT_ROLES.includes(day.frontRole)) throw new Error('[dawnContent] Day pressure needs a valid frontRole');
  return {
    frontRoleShares: { primary: shares.primary, secondary: shares.secondary, flank: shares.flank },
    night,
    day,
  };
}

function validatePhaseWaves(label: string, config: DawnPhaseWavesConfig): DawnPhaseWavesConfig {
  if (!config || !Array.isArray(config.waves) || config.waves.length === 0) {
    throw new Error(`[dawnContent] ${label} composition needs waves`);
  }
  const ids = new Set<string>();
  let previousRatio = -1;
  let shareSum = 0;
  for (const wave of config.waves) {
    if (!isDawnPlanId(wave?.id) || ids.has(wave.id)) throw new Error(`[dawnContent] ${label} wave ${String(wave?.id)} needs a unique id`);
    ids.add(wave.id);
    if (!Number.isFinite(wave.startRatio) || wave.startRatio < 0 || wave.startRatio >= 1 || wave.startRatio <= previousRatio) {
      throw new Error(`[dawnContent] ${label} wave ${wave.id} needs an ascending startRatio in [0, 1)`);
    }
    previousRatio = wave.startRatio;
    if (!isPositiveFinite(wave.budgetShare)) throw new Error(`[dawnContent] ${label} wave ${wave.id} needs a positive budgetShare`);
    shareSum += wave.budgetShare;
  }
  // Die Wellen teilen genau das Budget der Phase; mehr wuerde es ueberziehen.
  if (Math.abs(shareSum - 1) > 1e-9) throw new Error(`[dawnContent] ${label} wave budget shares must sum to 1`);
  if (!isPositiveInteger(config.maxBlocksPerFront)) throw new Error(`[dawnContent] ${label} needs a positive maxBlocksPerFront`);
  if (!isNonNegativeInteger(config.blockStaggerMs)) throw new Error(`[dawnContent] ${label} needs a non-negative blockStaggerMs`);
  return config;
}

function validateThreatCurves(raw: readonly unknown[]): readonly DawnThreatCurve[] {
  if (!Array.isArray(raw) || raw.length !== DAWN_MAX_THREAT) {
    throw new Error(`[dawnContent] Threat curves need exactly one entry per threat 1..${DAWN_MAX_THREAT}`);
  }
  const minSlots = Math.min(...[...TEMPLATES.values()].map((template) => template.salvageSlots.length));
  const curves: DawnThreatCurve[] = [];
  raw.forEach((source, index) => {
    const curve = source as DawnThreatCurve;
    const label = `Threat curve ${index + 1}`;
    if (curve?.threat !== index + 1) throw new Error(`[dawnContent] ${label} must declare threat ${index + 1} in order`);
    const previous = curves[index - 1];
    if (!SCHEDULES.has(curve.scheduleId)) throw new Error(`[dawnContent] ${label} uses unknown schedule ${curve.scheduleId}`);
    for (const key of ['nightBudget', 'dayPressureBudget'] as const) {
      if (!isPositiveFinite(curve[key]) || (previous && curve[key] < previous[key])) {
        throw new Error(`[dawnContent] ${label} needs a positive, non-decreasing ${key}`);
      }
    }
    const fronts = curve.fronts;
    if (!Array.isArray(fronts) || fronts.length === 0 || fronts.length > SPAWN_FRONTS.length
      || fronts[0] !== 'primary' || fronts.some((role, roleIndex) => !FRONT_ROLES.includes(role)
        || (roleIndex > 0 && role === 'primary'))
      || (previous && fronts.length < previous.fronts.length)) {
      throw new Error(`[dawnContent] ${label} needs 1..${SPAWN_FRONTS.length} non-decreasing front roles led by one primary`);
    }
    if (!isPositiveInteger(curve.siteCount) || curve.siteCount > minSlots
      || (previous && curve.siteCount < previous.siteCount)) {
      throw new Error(`[dawnContent] ${label} needs a non-decreasing siteCount every template can host`);
    }
    if (!Array.isArray(curve.tierWeights) || curve.tierWeights.length !== DAWN_MAX_SITE_TIER
      || curve.tierWeights.some((weight) => !Number.isFinite(weight) || weight < 0)
      || !curve.tierWeights.some((weight) => weight > 0)) {
      throw new Error(`[dawnContent] ${label} needs ${DAWN_MAX_SITE_TIER} non-negative tier weights`);
    }
    const weights = Object.entries(curve.enemyWeights ?? {});
    if (weights.some(([kind, weight]) => !ENEMY_THREAT_COSTS.has(kind) || !Number.isFinite(weight) || weight < 0)
      || !weights.some(([, weight]) => weight > 0)) {
      throw new Error(`[dawnContent] ${label} needs non-negative weights for costed enemies`);
    }
    // Spezialgegner kommen mit dem Threat hinzu und verschwinden nicht wieder.
    for (const [kind, weight] of Object.entries(previous?.enemyWeights ?? {})) {
      if (weight > 0 && !((curve.enemyWeights[kind] ?? 0) > 0)) {
        throw new Error(`[dawnContent] ${label} drops enemy ${kind} that a lower threat offers`);
      }
    }
    if (!isPositiveInteger(curve.itemLevel) || (previous && curve.itemLevel < previous.itemLevel)) {
      throw new Error(`[dawnContent] ${label} needs a positive, non-decreasing itemLevel`);
    }
    if (!isPositiveFinite(curve.scrapMultiplier)) throw new Error(`[dawnContent] ${label} needs a positive scrapMultiplier`);
    validateCurveAffordability(label, curve);
    curves.push(curve);
  });
  return curves;
}

/**
 * Jede aktive Front muss in jeder Welle mindestens einen Block bezahlen koennen, und der letzte
 * versetzte Block startet noch innerhalb seiner Phase. Sonst haette eine Front still keine Gegner.
 */
function validateCurveAffordability(label: string, curve: DawnThreatCurve): void {
  const shares = WAVE_COMPOSITION.frontRoleShares;
  const shareSum = curve.fronts.reduce((sum, role) => sum + shares[role], 0);
  const schedule = SCHEDULES.get(curve.scheduleId)!;
  const day = WAVE_COMPOSITION.day;
  const phases = [
    { phaseId: 'night', config: WAVE_COMPOSITION.night, budget: curve.nightBudget, roles: curve.fronts, roleShareSum: shareSum },
    { phaseId: 'day', config: day, budget: curve.dayPressureBudget, roles: [day.frontRole], roleShareSum: shares[day.frontRole] },
  ] as const;
  for (const { phaseId, config, budget, roles, roleShareSum } of phases) {
    const window = getPhaseWindow(schedule, phaseId);
    const lastWave = config.waves[config.waves.length - 1];
    const lastStart = window.startMs + Math.floor(lastWave.startRatio * (window.endMs - window.startMs))
      + (config.maxBlocksPerFront - 1) * config.blockStaggerMs;
    if (lastStart >= window.endMs) throw new Error(`[dawnContent] ${label} ${phaseId} waves overrun their phase`);
    for (const role of roles) {
      const cheapest = Math.min(...[...WAVE_BLOCKS.values()]
        .filter((block) => block.roles.includes(role) && resolveDawnWaveBlockWeight(block, curve) > 0)
        .map((block) => block.cost));
      for (const wave of config.waves) {
        if (cheapest > budget * wave.budgetShare * shares[role] / roleShareSum) {
          throw new Error(`[dawnContent] ${label} cannot afford a ${role} block in ${phaseId} wave ${wave.id}`);
        }
      }
    }
  }
}

/** Zeitfenster einer Phase aus den reinen Phasenregeln (Start bis Beginn der naechsten Phase). */
function getPhaseWindow(schedule: DawnSchedule, phaseId: DawnPhaseId): { startMs: number; endMs: number } {
  const state = resolveDawnPhase(schedule, getDawnPhaseStartMs(schedule, phaseId));
  return { startMs: state.phaseStartMs, endMs: state.phaseEndMs };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
