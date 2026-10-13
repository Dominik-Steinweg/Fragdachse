import type {
  CoopDefenseMapAuthoringConfig,
  CoopDefenseMapEncounterGroupConfig,
  CoopDefenseMapPersistentBaseConfig,
} from '../coopDefenseMapAuthoring';
import { hasCoopDefenseEnemyKind } from '../coopDefenseEnemies';
import { PERSISTENT_BASE_MAX_AREA_STAGE, resolvePersistentBaseReservationRadiusCells } from '../../persistentBase/PersistentBaseCore';
import { parseTimeOfDay } from '../../effects/TimeOfDay';
import type { SpawnFront } from '../../types';
import { isSpawnFront } from '../../utils/spawnFront';
import { hashCanonicalJson } from '../../dawn/contracts/dawnCanonicalJson';
import { isDawnTemplateId } from '../../dawn/contracts/DawnIds';
import { isDawnPlanId } from '../../dawn/contracts/DawnPlans';
import { DAWN_ARENA_TEMPLATE_SOURCES } from './arenaTemplates/index';
import rawWaveBlocks from './waveBlocks.json';
import rawSchedules from './schedules.json';
import rawSalvage from './salvage.json';

/**
 * Loader, Validatoren und Content-Hash der Dawn-Registries.
 *
 * Alles hier ist authored, tunebar und wird beim Import fail-fast geprueft. Der Hash ueber alle
 * Registries steht in jedem Dawn-Plan; ein Peer mit anderem Content-Stand baut die Runde nicht.
 */

/** Erhoehen, wenn sich die Bedeutung eines Registry-Felds aendert, ohne dass der Inhalt es tut. */
const DAWN_CONTENT_SCHEMA_VERSION = 1;

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

/** Authored Gegnergruppe ohne Front; die Front setzt erst der Wellenplan. */
export type DawnWaveBlockGroup = Omit<CoopDefenseMapEncounterGroupConfig, 'front' | 'spawnArea'>;

export interface DawnWaveBlock {
  readonly id: string;
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

export const DAWN_SALVAGE_CONFIG = validateSalvage(rawSalvage);
const TEMPLATES = validateTemplates(DAWN_ARENA_TEMPLATE_SOURCES);
const WAVE_BLOCKS = validateWaveBlocks(rawWaveBlocks);
const SCHEDULES = validateSchedules(rawSchedules);

/** Hash ueber alle Dawn-Registries; Teil jedes Dawn-Plans. */
export const DAWN_CONTENT_HASH = hashCanonicalJson({
  schemaVersion: DAWN_CONTENT_SCHEMA_VERSION,
  templates: [...TEMPLATES.values()],
  waveBlocks: [...WAVE_BLOCKS.values()],
  schedules: [...SCHEDULES.values()],
  salvage: DAWN_SALVAGE_CONFIG,
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

export function getDawnWaveBlock(blockId: string): DawnWaveBlock {
  return requireEntry(WAVE_BLOCKS, blockId, 'wave block');
}

export function getDawnSchedule(scheduleId: string): DawnSchedule {
  return requireEntry(SCHEDULES, scheduleId, 'schedule');
}

function requireEntry<T>(registry: ReadonlyMap<string, T>, id: string, label: string): T {
  const entry = registry.get(id);
  if (!entry) throw new Error(`[dawnContent] Unknown Dawn ${label}: ${id}`);
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
      if (distance < reservation + salvage.minBaseReservationGapCells) {
        throw new Error(`[dawnContent] ${label} slot ${slot.id} overlaps the base reservation or its gap`);
      }
      const band = salvage.bands[slot.band];
      if (distance < band.minCells || distance > band.maxCells) {
        throw new Error(`[dawnContent] ${label} slot ${slot.id} lies outside its ${slot.band} distance band`);
      }
      if (Math.min(gridX, gridY, width - 1 - gridX, height - 1 - gridY) < salvage.minArenaEdgeGapCells) {
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
    templates.set(template.id, { ...template, salvageSlots: template.salvageSlots ?? [] });
  }
  if (templates.size === 0) throw new Error('[dawnContent] At least one Dawn arena template is required');
  return templates;
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
    for (const group of block.groups) {
      if ('front' in group || 'spawnArea' in group) {
        throw new Error(`[dawnContent] Wave block ${block.id} must not author a front; the wave plan sets it`);
      }
      if (!hasCoopDefenseEnemyKind(group.enemyKind)) {
        throw new Error(`[dawnContent] Wave block ${block.id} uses unknown enemy ${group.enemyKind}`);
      }
      if (!isPositiveInteger(group.count)) throw new Error(`[dawnContent] Wave block ${block.id} needs positive counts`);
    }
    blocks.set(block.id, block);
  }
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
    if (!isPositiveInteger(schedule.durationMs)) throw new Error(`[dawnContent] ${label} needs a duration`);
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

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
