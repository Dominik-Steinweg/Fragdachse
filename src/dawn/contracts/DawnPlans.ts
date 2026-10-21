import type { SpawnFront } from '../../types';
import { isSpawnFront } from '../../utils/spawnFront';
import { toCanonicalJson } from './dawnCanonicalJson';
import { isDawnTemplateId } from './DawnIds';

/**
 * Replizierte Plandokumente einer Dawn-Runde.
 *
 * Der Host komponiert pro Runde genau einen World- und einen Activity-Plan. Beide reisen mit
 * den vorhandenen World-/Activity-Descriptoren (`WorldParameters.dawn`,
 * `ActivityDescriptor.parameters.dawn`), auch per Welcome zu Late Joinern. Jeder Peer baut daraus
 * mit demselben reinen Resolver dieselbe Coop-Config; Clients komponieren nie selbst aus dem Seed.
 *
 * Die Plaene enthalten nur IDs und vertraglich definierte Werte. Ihr `contentHash` bindet sie an
 * den Stand der Dawn-Registries; ein abweichender Stand bricht den Aufbau ab.
 */

/** 2: portal generator sites carry the flank slot of their exit. */
export const DAWN_PLAN_VERSION = 2;
/** Wire-Obergrenze; die fachliche Kurve liegt im Content. */
export const DAWN_MAX_THREAT = 10;
const MAX_WAVES = 64;
const MAX_SITES = 32;
/** Site-Tiers: rostiger Schrott, Militaergeraet, seltene Technik. */
export const DAWN_MAX_SITE_TIER = 3;
const MAX_WAVE_START_MS = 60 * 60 * 1000;
const PLAN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CONTENT_HASH_PATTERN = /^[0-9a-f]{16}$/;

/** World-Teil: alles, was Geometrie und World-Inhalt bestimmt. */
export interface DawnWorldPlan {
  readonly version: typeof DAWN_PLAN_VERSION;
  readonly templateId: string;
  readonly contentHash: string;
  /** Belegte Salvage-Slots dieser Runde; ihre Strukturen sind World-Inhalt. */
  readonly sites: readonly DawnSitePlan[];
}

/** Eine Salvage-Site: authored Slot des Templates, Archetyp aus der Registry und Tier. */
export interface DawnSitePlan {
  readonly slotId: string;
  readonly archetypeId: string;
  readonly tier: number;
  /** Visuelle Variante des Archetyps (z. B. Wrack `tractor`); fehlt = Standardvariante. */
  readonly variant?: string;
  /** Versteckte Site: ohne Schrottscanner des Hosts keine Navigationsmarker. */
  readonly hidden?: true;
  /** Portal generator only: the otherwise unused slot near the base where its portal exits. */
  readonly portalExitSlotId?: string;
}

/**
 * Eine explizit komponierte Welle: authored Block entweder an einer Front zu einer Activity-Zeit
 * oder an einer Salvage-Site; dann startet sie bei deren Aktivierung und `atMs` ist die
 * Verzoegerung danach. Genau eines von `front` und `siteId` ist gesetzt.
 */
export type DawnWavePlan =
  | { readonly id: string; readonly blockId: string; readonly front: SpawnFront; readonly atMs: number }
  | { readonly id: string; readonly blockId: string; readonly siteId: string; readonly atMs: number };

/** Activity-Teil: Bedrohung, Zeitplan und Wellen der Runde. */
export interface DawnActivityPlan {
  readonly version: typeof DAWN_PLAN_VERSION;
  readonly contentHash: string;
  readonly threat: number;
  readonly dayNumber: number;
  readonly scheduleId: string;
  readonly waves: readonly DawnWavePlan[];
  /** Nacht-Modifikator der Runde (z. B. `blood-moon`); fehlt = normale Nacht. */
  readonly nightModifierId?: string;
}

export function isDawnContentHash(value: unknown): value is string {
  return typeof value === 'string' && CONTENT_HASH_PATTERN.test(value);
}

export function isDawnPlanId(value: unknown): value is string {
  return typeof value === 'string' && PLAN_ID_PATTERN.test(value);
}

/** Netzwerkgrenze: ungueltige Plaene werden vollstaendig verworfen. */
export function parseDawnWorldPlan(raw: unknown): DawnWorldPlan | null {
  if (!isRecord(raw)) return null;
  if (raw.version !== DAWN_PLAN_VERSION) return null;
  if (!isDawnTemplateId(raw.templateId)) return null;
  if (!isDawnContentHash(raw.contentHash)) return null;
  if (!Array.isArray(raw.sites) || raw.sites.length > MAX_SITES) return null;
  const sites: DawnSitePlan[] = [];
  const slotIds = new Set<string>();
  for (const candidate of raw.sites) {
    const site = parseDawnSitePlan(candidate);
    if (!site || slotIds.has(site.slotId)) return null;
    slotIds.add(site.slotId);
    sites.push(site);
  }
  // At most one portal per round, and its exit occupies a slot of its own.
  const exits = sites.flatMap((site) => site.portalExitSlotId === undefined ? [] : [site.portalExitSlotId]);
  if (exits.length > 1 || exits.some((slotId) => slotIds.has(slotId))) return null;
  return { version: DAWN_PLAN_VERSION, templateId: raw.templateId, contentHash: raw.contentHash, sites };
}

function parseDawnSitePlan(raw: unknown): DawnSitePlan | null {
  if (!isRecord(raw)) return null;
  if (!isDawnPlanId(raw.slotId) || !isDawnPlanId(raw.archetypeId)) return null;
  if (!isIntegerInRange(raw.tier, 1, DAWN_MAX_SITE_TIER)) return null;
  if (raw.variant !== undefined && !isDawnPlanId(raw.variant)) return null;
  if (raw.hidden !== undefined && raw.hidden !== true) return null;
  if (raw.portalExitSlotId !== undefined && !isDawnPlanId(raw.portalExitSlotId)) return null;
  return {
    slotId: raw.slotId, archetypeId: raw.archetypeId, tier: raw.tier,
    ...(raw.variant === undefined ? {} : { variant: raw.variant }),
    ...(raw.hidden === true ? { hidden: true as const } : {}),
    ...(raw.portalExitSlotId === undefined ? {} : { portalExitSlotId: raw.portalExitSlotId }),
  };
}

/** Netzwerkgrenze: ungueltige Plaene werden vollstaendig verworfen. */
export function parseDawnActivityPlan(raw: unknown): DawnActivityPlan | null {
  if (!isRecord(raw)) return null;
  if (raw.version !== DAWN_PLAN_VERSION) return null;
  if (!isDawnContentHash(raw.contentHash)) return null;
  if (!isIntegerInRange(raw.threat, 1, DAWN_MAX_THREAT)) return null;
  if (!isIntegerInRange(raw.dayNumber, 1, Number.MAX_SAFE_INTEGER)) return null;
  if (!isDawnPlanId(raw.scheduleId)) return null;
  if (!Array.isArray(raw.waves) || raw.waves.length > MAX_WAVES) return null;
  if (raw.nightModifierId !== undefined && !isDawnPlanId(raw.nightModifierId)) return null;
  const waves: DawnWavePlan[] = [];
  const waveIds = new Set<string>();
  for (const candidate of raw.waves) {
    const wave = parseDawnWavePlan(candidate);
    if (!wave || waveIds.has(wave.id)) return null;
    waveIds.add(wave.id);
    waves.push(wave);
  }
  return {
    version: DAWN_PLAN_VERSION,
    contentHash: raw.contentHash,
    threat: raw.threat,
    dayNumber: raw.dayNumber,
    scheduleId: raw.scheduleId,
    waves,
    ...(raw.nightModifierId === undefined ? {} : { nightModifierId: raw.nightModifierId }),
  };
}

/** Feldweiser Vergleich ueber die kanonische Form; Reihenfolge der Wellen ist Teil des Plans. */
export function haveSameDawnPlan(
  left: DawnWorldPlan | DawnActivityPlan | null | undefined,
  right: DawnWorldPlan | DawnActivityPlan | null | undefined,
): boolean {
  if (!left || !right) return (left ?? null) === (right ?? null);
  return toCanonicalJson(left) === toCanonicalJson(right);
}

function parseDawnWavePlan(raw: unknown): DawnWavePlan | null {
  if (!isRecord(raw)) return null;
  if (!isDawnPlanId(raw.id) || !isDawnPlanId(raw.blockId)) return null;
  if (!isIntegerInRange(raw.atMs, 0, MAX_WAVE_START_MS)) return null;
  if (raw.siteId !== undefined) {
    if (raw.front !== undefined || !isDawnPlanId(raw.siteId)) return null;
    return { id: raw.id, blockId: raw.blockId, siteId: raw.siteId, atMs: raw.atMs };
  }
  if (!isSpawnFront(raw.front)) return null;
  return { id: raw.id, blockId: raw.blockId, front: raw.front, atMs: raw.atMs };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}
