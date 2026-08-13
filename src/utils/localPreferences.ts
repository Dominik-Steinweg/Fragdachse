import { SOUND_MASTER_VOLUME, SOUND_MUSIC_VOLUME, SOUND_SFX_VOLUME } from '../config';
import {
  COOP_DEFENSE_CLASS_IDS,
  DEFAULT_COOP_DEFENSE_CLASS_ID,
  getUnlockedCoopDefenseClassIds,
  sanitizeCoopDefenseClassId,
  isCoopDefenseClassId,
} from '../config/coopDefenseClasses';
import type {
  CoopDefenseClassId,
  ConstructionId,
  CoopDefenseItem,
  CoopDefenseItemRewardAction,
  CoopDefenseItemSlot,
  CoopDefensePendingItemReward,
  CoopDefenseUpgradeProfile,
  LoadoutToolRef,
  LoadoutSlot,
} from '../types';
import { COOP_DEFENSE_ITEMS_UNLOCK_AFTER_MAP_ID } from '../config/coopDefenseItems';
import {
  addCoopDefenseItem,
  getCoopDefenseItemSalvageXp,
  getEquippedCoopDefenseItem,
  getEquippedCoopDefenseItems,
  isCoopDefenseStashFull,
  readCoopDefenseEquippedItemIdCandidates,
  removeCoopDefenseItem,
  sanitizeCoopDefenseEquippedItemIds,
  sanitizeCoopDefenseItems,
  sanitizeCoopDefensePendingItemReward,
  type CoopDefenseEquippedItemIds,
} from './coopDefenseItems';
import {
  buildDefaultCoopDefenseUpgradeProfile,
  cloneCoopDefenseUpgradeProfile,
  constrainCoopDefenseUpgradeProfileToBossPoints,
  COOP_DEFENSE_UPGRADE_DEFINITIONS,
  sanitizeCoopDefenseUpgradeProfile,
} from './coopDefenseUpgrades';
import {
  getCoopDefenseMapUnlockedByVictoryOn,
  INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID,
  isCoopDefenseMapUnlocked,
  maxHighestUnlockedCoopDefenseMapId,
  sanitizeHighestUnlockedCoopDefenseMapId,
} from '../config/coopDefenseMapUnlocks';
import { sanitizePlayerName } from './playerName';
import { isGraphicsQuality, type GraphicsQuality } from '../graphics/GraphicsQuality';

/** Einmalige Alpha-Generation. Nur Einstellungen werden daraus uebernommen. */
export const LEGACY_LOCAL_PREFERENCES_KEY = 'fragdachse_local_preferences';
export const LOCAL_SETTINGS_STORAGE_KEY = 'fragdachse_settings_v1';
export const LOCAL_PROGRESS_STORAGE_KEY = 'fragdachse_progress_v1';
export const LOCAL_SETTINGS_SCHEMA_VERSION = 1;
export const LOCAL_PROGRESS_SCHEMA_VERSION = 2;
export const LOCAL_PROGRESS_EXPORT_FORMAT = 'fragdachse-progress';
export const LOCAL_PROGRESS_EXPORT_VERSION = 1;
const CHEAT_BOSS_MAP_ID_PREFIX = '__cheat_boss_point_';

export interface CoopDefenseProgressPreferences {
  totalXp: number;
  lastProcessedRoundEndedAt: number | null;
  completedBossMapIds: string[];
  /** Hoechste freigeschaltete Map der linearen Kampagne; alles davor ist ebenfalls offen. */
  highestUnlockedMapId: string;
  /** Bis Map 5 fuehrt die unsichtbare, bonuslose Default-Klasse den gemeinsamen Fortschritt. */
  classesUnlocked: boolean;
  /** Klassen, die durch den Kampagnenfortschritt tatsaechlich ausgewaehlt werden duerfen. */
  unlockedClassIds: CoopDefenseClassId[];
  defaultProfile: CoopDefenseUpgradeProfile;
  selectedClassId: CoopDefenseClassId;
  profilesByClass: Record<CoopDefenseClassId, CoopDefenseUpgradeProfile>;
  /** Das Item-System bleibt bis zum Sieg auf Map 10 verborgen. */
  itemsUnlocked: boolean;
  /**
   * Gesamter Item-Besitz inklusive der ausgeruesteten Teile. Eine einzige Liste plus
   * {@link equippedItemIds} statt getrennter Stash-/Equipped-Listen: damit kann ein Item
   * niemals in beiden oder in keiner Liste stehen, und "ausgeruestet zaehlt nicht aufs Limit"
   * ist eine reine Abfrage statt eines Umhaengens.
   */
  items: CoopDefenseItem[];
  equippedItemIds: CoopDefenseEquippedItemIds;
  /**
   * Offenes Belohnungsangebot. Bewusst persistent: so ueberlebt es Reload und Verbindungsabbruch
   * waehrend der Auswahl und geht nie verloren.
   */
  pendingItemReward: CoopDefensePendingItemReward | null;
  /**
   * Ein neu erhaltenes Teil liegt im Inventar, ohne dass der Spieler das Item-Menue seitdem
   * geoeffnet hat. Treibt den Hinweis am Items-Button und wird beim Oeffnen zurueckgesetzt.
   */
  unseenItems: boolean;
}

interface LocalPreferences {
  audio: {
    masterVolume: number;
    effectsVolume: number;
    musicVolume: number;
  };
  profile: {
    playerName: string | null;
  };
  loadout: Partial<Record<LoadoutSlot, string>>;
  loadoutByClass: Partial<Record<CoopDefenseClassId, Partial<Record<LoadoutSlot, string>>>>;
  graphics: {
    quality: GraphicsQuality;
  };
  progression: {
    coopDefense: CoopDefenseProgressPreferences;
  };
}

interface CompactUpgradeProfile {
  /** Ausschliesslich Level, die vom aktuellen Klassenstandard abweichen. */
  levels?: Record<string, number>;
  toolLoadout?: LoadoutToolRef[];
  selectedTool?: LoadoutToolRef;
}

interface LocalSettingsDocumentV1 {
  schemaVersion: 1;
  audio: LocalPreferences['audio'];
  graphics: LocalPreferences['graphics'];
}

interface LocalProgressDocumentV1 {
  schemaVersion: 1;
  profile: LocalPreferences['profile'];
  loadout: LocalPreferences['loadout'];
  coopDefense: Omit<LocalProgressDocumentV2['coopDefense'], 'loadoutsByClass'> & {
    classLoadouts?: LocalPreferences['loadoutByClass'];
  };
}

export interface LocalProgressDocumentV2 {
  schemaVersion: 2;
  profile: LocalPreferences['profile'];
  loadout: LocalPreferences['loadout'];
  coopDefense: {
    totalXp: number;
    lastProcessedRoundEndedAt: number | null;
    completedBossMapIds: string[];
    highestUnlockedMapId: string;
    classesUnlocked: boolean;
    unlockedClassIds?: CoopDefenseClassId[];
    defaultProfile?: CompactUpgradeProfile;
    selectedClassId?: CoopDefenseClassId;
    profilesByClass?: Partial<Record<CoopDefenseClassId, CompactUpgradeProfile>>;
    loadoutsByClass?: LocalPreferences['loadoutByClass'];
    itemsUnlocked: boolean;
    items: CoopDefenseItem[];
    equippedItemIds: CoopDefenseEquippedItemIds;
    pendingItemReward: CoopDefensePendingItemReward | null;
    unseenItems: boolean;
  };
}

interface LocalProgressExportEnvelope {
  format: typeof LOCAL_PROGRESS_EXPORT_FORMAT;
  formatVersion: typeof LOCAL_PROGRESS_EXPORT_VERSION;
  exportedAt: string;
  progress: LocalProgressDocumentV1 | LocalProgressDocumentV2;
}

export interface LocalProgressTransferResult {
  readonly ok: boolean;
  readonly message: string;
}

const DEFAULT_COOP_DEFENSE_PROGRESS: CoopDefenseProgressPreferences = {
  totalXp: 0,
  lastProcessedRoundEndedAt: null,
  completedBossMapIds: [],
  highestUnlockedMapId: INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID,
  classesUnlocked: false,
  unlockedClassIds: [],
  defaultProfile: buildDefaultCoopDefenseUpgradeProfile(DEFAULT_COOP_DEFENSE_CLASS_ID),
  selectedClassId: DEFAULT_COOP_DEFENSE_CLASS_ID,
  profilesByClass: {
    dachs_nukem: buildDefaultCoopDefenseUpgradeProfile('dachs_nukem'),
    dachs_of_steel: buildDefaultCoopDefenseUpgradeProfile('dachs_of_steel'),
    inspector_gadachs: buildDefaultCoopDefenseUpgradeProfile('inspector_gadachs'),
  },
  itemsUnlocked: false,
  items: [],
  equippedItemIds: {},
  pendingItemReward: null,
  unseenItems: false,
};

/**
 * Items sind unveraenderliche Wertobjekte; nur die Huellen (Liste, Slot-Zuordnung) muessen
 * kopiert werden, damit Leser den gespeicherten Stand nicht versehentlich veraendern.
 */
function cloneCoopDefenseItemState(progress: CoopDefenseProgressPreferences): {
  items: CoopDefenseItem[];
  equippedItemIds: CoopDefenseEquippedItemIds;
  pendingItemReward: CoopDefensePendingItemReward | null;
} {
  return {
    items: [...progress.items],
    equippedItemIds: { ...progress.equippedItemIds },
    pendingItemReward: progress.pendingItemReward
      ? { ...progress.pendingItemReward, offers: [...progress.pendingItemReward.offers] }
      : null,
  };
}

const DEFAULT_PREFERENCES: LocalPreferences = {
  audio: {
    masterVolume: SOUND_MASTER_VOLUME,
    effectsVolume: SOUND_SFX_VOLUME,
    musicVolume: SOUND_MUSIC_VOLUME,
  },
  profile: {
    playerName: null,
  },
  loadout: {},
  loadoutByClass: {},
  graphics: {
    quality: 'high',
  },
  progression: {
    coopDefense: {
      ...DEFAULT_COOP_DEFENSE_PROGRESS,
      completedBossMapIds: [],
      defaultProfile: cloneCoopDefenseUpgradeProfile(
        DEFAULT_COOP_DEFENSE_PROGRESS.defaultProfile,
        DEFAULT_COOP_DEFENSE_CLASS_ID,
      ),
      profilesByClass: cloneProfilesByClass(DEFAULT_COOP_DEFENSE_PROGRESS.profilesByClass),
    },
  },
};

function cloneProfilesByClass(
  profiles: Record<CoopDefenseClassId, CoopDefenseUpgradeProfile>,
): Record<CoopDefenseClassId, CoopDefenseUpgradeProfile> {
  return {
    dachs_nukem: cloneCoopDefenseUpgradeProfile(profiles.dachs_nukem, 'dachs_nukem'),
    dachs_of_steel: cloneCoopDefenseUpgradeProfile(profiles.dachs_of_steel, 'dachs_of_steel'),
    inspector_gadachs: cloneCoopDefenseUpgradeProfile(profiles.inspector_gadachs, 'inspector_gadachs'),
  };
}

function mirrorDefaultProfileToClasses(
  defaultProfile: CoopDefenseUpgradeProfile,
  earnedBossPoints: number,
): Record<CoopDefenseClassId, CoopDefenseUpgradeProfile> {
  return Object.fromEntries(
    COOP_DEFENSE_CLASS_IDS.map((classId) => [
      classId,
      constrainCoopDefenseUpgradeProfileToBossPoints(
        sanitizeCoopDefenseUpgradeProfile(defaultProfile, classId),
        earnedBossPoints,
        classId,
      ),
    ]),
  ) as Record<CoopDefenseClassId, CoopDefenseUpgradeProfile>;
}

function getLocalStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function clampAudioVolume(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function sanitizeStoredXp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function sanitizeStoredRoundEndedAt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
}

function sanitizeStoredLoadout(value: unknown): Partial<Record<LoadoutSlot, string>> {
  if (!value || typeof value !== 'object') return {};
  const loadout = value as Record<string, unknown>;
  return {
    weapon1: typeof loadout.weapon1 === 'string' ? loadout.weapon1 : undefined,
    weapon2: typeof loadout.weapon2 === 'string' ? loadout.weapon2 : undefined,
    utility: typeof loadout.utility === 'string' ? loadout.utility : undefined,
    ultimate: typeof loadout.ultimate === 'string' ? loadout.ultimate : undefined,
  };
}

function sanitizeStoredLoadoutsByClass(
  value: unknown,
): Partial<Record<CoopDefenseClassId, Partial<Record<LoadoutSlot, string>>>> {
  if (!value || typeof value !== 'object') return {};
  const rawLoadouts = value as Partial<Record<CoopDefenseClassId, unknown>>;
  const loadoutsByClass: Partial<Record<CoopDefenseClassId, Partial<Record<LoadoutSlot, string>>>> = {};
  for (const classId of COOP_DEFENSE_CLASS_IDS) {
    const loadout = sanitizeStoredLoadout(rawLoadouts[classId]);
    if (Object.values(loadout).some((itemId) => itemId !== undefined)) {
      loadoutsByClass[classId] = loadout;
    }
  }
  return loadoutsByClass;
}

function sanitizeCompletedBossMapIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0))];
}

/**
 * Staende ohne gespeicherten Freischaltstand stammen aus der Zeit vor der Map-Freischaltung: dort
 * ist die Sieg-Historie der Bossmaps der einzige Beleg fuer bereits geschaffte Maps.
 */
function buildDefaultPreferences(): LocalPreferences {
  return {
    ...DEFAULT_PREFERENCES,
    audio: { ...DEFAULT_PREFERENCES.audio },
    profile: { ...DEFAULT_PREFERENCES.profile },
    loadout: {},
    loadoutByClass: {},
    graphics: { ...DEFAULT_PREFERENCES.graphics },
    progression: {
      coopDefense: {
        ...DEFAULT_COOP_DEFENSE_PROGRESS,
        completedBossMapIds: [],
        defaultProfile: cloneCoopDefenseUpgradeProfile(
          DEFAULT_COOP_DEFENSE_PROGRESS.defaultProfile,
          DEFAULT_COOP_DEFENSE_CLASS_ID,
        ),
        profilesByClass: cloneProfilesByClass(DEFAULT_COOP_DEFENSE_PROGRESS.profilesByClass),
        ...cloneCoopDefenseItemState(DEFAULT_COOP_DEFENSE_PROGRESS),
      },
    },
  };
}

function sanitizeStoredUnlockedClassIds(value: unknown): CoopDefenseClassId[] | null {
  if (!Array.isArray(value)) return null;
  const classIds = value.filter(isCoopDefenseClassId);
  return classIds.length === value.length ? [...new Set(classIds)] : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const LOADOUT_SLOTS: readonly LoadoutSlot[] = ['weapon1', 'weapon2', 'utility', 'ultimate'];
const ITEM_SLOTS: readonly CoopDefenseItemSlot[] = ['helmet', 'gloves', 'armor', 'boots'];

function isValidLoadoutRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.entries(value).every(([slot, itemId]) => (
    LOADOUT_SLOTS.includes(slot as LoadoutSlot)
      && typeof itemId === 'string' && itemId.length > 0 && itemId.length <= 128
  ));
}

function safeRead(storage: Storage | null, key: string): string | null {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}

function safeWrite(storage: Storage | null, key: string, value: unknown): boolean {
  try {
    storage?.setItem(key, JSON.stringify(value));
    return storage !== null;
  } catch {
    return false;
  }
}

function safeRemove(storage: Storage | null, key: string): void {
  try { storage?.removeItem(key); } catch { /* Storage bleibt optional. */ }
}

function sanitizeSettingsDocument(raw: unknown): LocalSettingsDocumentV1 | null {
  if (!isRecord(raw) || raw.schemaVersion !== LOCAL_SETTINGS_SCHEMA_VERSION) return null;
  if (!isRecord(raw.audio) || !isRecord(raw.graphics)) return null;
  const { masterVolume, effectsVolume, musicVolume } = raw.audio;
  if (![masterVolume, effectsVolume, musicVolume].every((value) => (
    typeof value === 'number' && Number.isFinite(value)
  ))) return null;
  if (!isGraphicsQuality(raw.graphics.quality)) return null;
  return {
    schemaVersion: LOCAL_SETTINGS_SCHEMA_VERSION,
    audio: {
      masterVolume: clampAudioVolume(masterVolume as number),
      effectsVolume: clampAudioVolume(effectsVolume as number),
      musicVolume: clampAudioVolume(musicVolume as number),
    },
    graphics: { quality: raw.graphics.quality },
  };
}

/** Der Alpha-Schnitt behaelt ausschliesslich geraetenahe Audio-/Grafikeinstellungen. */
function readLegacySettings(raw: string | null): LocalSettingsDocumentV1 | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    const audio = isRecord(parsed.audio) ? parsed.audio : {};
    const graphics = isRecord(parsed.graphics) ? parsed.graphics : {};
    return {
      schemaVersion: LOCAL_SETTINGS_SCHEMA_VERSION,
      audio: {
        masterVolume: typeof audio.masterVolume === 'number' && Number.isFinite(audio.masterVolume)
          ? clampAudioVolume(audio.masterVolume) : SOUND_MASTER_VOLUME,
        effectsVolume: typeof audio.effectsVolume === 'number' && Number.isFinite(audio.effectsVolume)
          ? clampAudioVolume(audio.effectsVolume) : SOUND_SFX_VOLUME,
        musicVolume: typeof audio.musicVolume === 'number' && Number.isFinite(audio.musicVolume)
          ? clampAudioVolume(audio.musicVolume) : SOUND_MUSIC_VOLUME,
      },
      graphics: { quality: isGraphicsQuality(graphics.quality) ? graphics.quality : 'high' },
    };
  } catch { return null; }
}

function sanitizeCompactProfile(raw: unknown): CompactUpgradeProfile | null {
  if (raw === undefined) return {};
  if (!isRecord(raw)) return null;
  const result: CompactUpgradeProfile = {};
  if (raw.levels !== undefined) {
    if (!isRecord(raw.levels)) return null;
    const levels: Record<string, number> = {};
    for (const [upgradeId, level] of Object.entries(raw.levels)) {
      const definition = COOP_DEFENSE_UPGRADE_DEFINITIONS[upgradeId];
      if (!definition || typeof level !== 'number' || !Number.isInteger(level)
        || level < 0 || level > definition.maxLevel) return null;
      levels[upgradeId] = level;
    }
    if (Object.keys(levels).length > 0) result.levels = levels;
  }
  const sanitizeTool = (value: unknown): LoadoutToolRef | null => {
    if (!isRecord(value)) return null;
    if (value.kind !== 'construction' && value.kind !== 'utility') return null;
    if (typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 128) return null;
    if (value.kind === 'construction') {
      if (!['rocket_turret', 'machine_gun_turret', 'flame_turret'].includes(value.id)) return null;
      return { kind: 'construction', id: value.id as ConstructionId };
    }
    return { kind: 'utility', id: value.id };
  };
  if (raw.toolLoadout !== undefined) {
    if (!Array.isArray(raw.toolLoadout) || raw.toolLoadout.length > 16) return null;
    const tools = raw.toolLoadout.map(sanitizeTool);
    if (tools.some((tool) => tool === null)) return null;
    result.toolLoadout = tools as LoadoutToolRef[];
  }
  if (raw.selectedTool !== undefined) {
    const selected = sanitizeTool(raw.selectedTool);
    if (!selected) return null;
    result.selectedTool = selected;
  }
  return result;
}

function migrateProgressDocument(raw: unknown): LocalProgressDocumentV2 | null {
  if (!isRecord(raw) || !Number.isInteger(raw.schemaVersion)) return null;
  let migrated: Record<string, unknown> = raw;
  while ((migrated.schemaVersion as number) < LOCAL_PROGRESS_SCHEMA_VERSION) {
    switch (migrated.schemaVersion) {
      case 1: {
        if (!isRecord(migrated.coopDefense)) return null;
        const { classLoadouts, ...coopDefense } = migrated.coopDefense;
        migrated = {
          ...migrated,
          schemaVersion: 2,
          coopDefense: { ...coopDefense, loadoutsByClass: classLoadouts },
        };
        break;
      }
      default: return null;
    }
  }
  return migrated.schemaVersion === LOCAL_PROGRESS_SCHEMA_VERSION
    ? migrated as unknown as LocalProgressDocumentV2
    : null;
}

function decodeProgressDocument(raw: unknown): Pick<LocalPreferences, 'profile' | 'loadout' | 'loadoutByClass' | 'progression'> | null {
  const document = migrateProgressDocument(raw);
  if (!document || !isRecord(document.profile) || !isValidLoadoutRecord(document.loadout)
    || !isRecord(document.coopDefense)) return null;
  const coop = document.coopDefense as unknown as Record<string, unknown>;
  if ((document.profile.playerName !== null && typeof document.profile.playerName !== 'string')
    || typeof coop.totalXp !== 'number' || !Number.isFinite(coop.totalXp)
    || (coop.lastProcessedRoundEndedAt !== null
      && (typeof coop.lastProcessedRoundEndedAt !== 'number' || !Number.isFinite(coop.lastProcessedRoundEndedAt)))
    || !Array.isArray(coop.completedBossMapIds)
    || !coop.completedBossMapIds.every((value) => typeof value === 'string' && value.trim().length > 0)
    || typeof coop.highestUnlockedMapId !== 'string'
    || typeof coop.classesUnlocked !== 'boolean'
    || typeof coop.itemsUnlocked !== 'boolean'
    || !Array.isArray(coop.items)
    || !isRecord(coop.equippedItemIds)
    || (coop.pendingItemReward !== null && !isRecord(coop.pendingItemReward))
    || typeof coop.unseenItems !== 'boolean') return null;

  const loadout = sanitizeStoredLoadout(document.loadout);
  if (coop.unlockedClassIds !== undefined && sanitizeStoredUnlockedClassIds(coop.unlockedClassIds) === null) return null;
  if (coop.selectedClassId !== undefined && !COOP_DEFENSE_CLASS_IDS.includes(coop.selectedClassId as CoopDefenseClassId)) return null;
  const defaultCompact = sanitizeCompactProfile(coop.defaultProfile);
  if (!defaultCompact) return null;
  const completedBossMapIds = sanitizeCompletedBossMapIds(coop.completedBossMapIds);
  const bossPoints = completedBossMapIds.length;
  const hydrateProfile = (compact: CompactUpgradeProfile, classId: CoopDefenseClassId): CoopDefenseUpgradeProfile => {
    const rawProfile = {
      upgrades: Object.fromEntries(Object.entries(compact.levels ?? {}).map(([id, level]) => [
        id, { level, unlocked: false },
      ])),
      toolLoadout: compact.toolLoadout,
      selectedTool: compact.selectedTool,
    };
    return constrainCoopDefenseUpgradeProfileToBossPoints(
      sanitizeCoopDefenseUpgradeProfile(rawProfile, classId), bossPoints, classId,
    );
  };
  const defaultProfile = hydrateProfile(defaultCompact, DEFAULT_COOP_DEFENSE_CLASS_ID);
  const rawProfiles = coop.profilesByClass;
  if (rawProfiles !== undefined && !isRecord(rawProfiles)) return null;
  if (isRecord(rawProfiles) && Object.keys(rawProfiles).some((key) => (
    !COOP_DEFENSE_CLASS_IDS.includes(key as CoopDefenseClassId)
  ))) return null;
  const highestUnlockedMapId = sanitizeHighestUnlockedCoopDefenseMapId(coop.highestUnlockedMapId);
  // D deliberately does not grandfather the old global class flag. A save without the new
  // per-class list starts with no selectable specialization and can earn the unlocks again.
  const unlockedClassIds = coop.unlockedClassIds === undefined
    ? []
    : sanitizeStoredUnlockedClassIds(coop.unlockedClassIds) ?? [];
  const classesUnlocked = unlockedClassIds.length > 0;
  const selectedClassId = classesUnlocked && unlockedClassIds.includes(sanitizeCoopDefenseClassId(coop.selectedClassId))
    ? sanitizeCoopDefenseClassId(coop.selectedClassId)
    : DEFAULT_COOP_DEFENSE_CLASS_ID;
  const profilesByClass = {} as Record<CoopDefenseClassId, CoopDefenseUpgradeProfile>;
  for (const classId of COOP_DEFENSE_CLASS_IDS) {
    const compact = sanitizeCompactProfile(isRecord(rawProfiles) ? rawProfiles[classId] : undefined);
    if (!compact) return null;
    profilesByClass[classId] = classesUnlocked
      ? hydrateProfile(compact, classId)
      : constrainCoopDefenseUpgradeProfileToBossPoints(
        sanitizeCoopDefenseUpgradeProfile(defaultProfile, classId), bossPoints, classId,
      );
  }
  if (isRecord(coop.loadoutsByClass) && Object.entries(coop.loadoutsByClass).some(([classId, classLoadout]) => (
    !COOP_DEFENSE_CLASS_IDS.includes(classId as CoopDefenseClassId) || !isValidLoadoutRecord(classLoadout)
  ))) return null;
  const loadoutByClass = classesUnlocked ? sanitizeStoredLoadoutsByClass(coop.loadoutsByClass) : {};
  if (coop.loadoutsByClass !== undefined && !isRecord(coop.loadoutsByClass)) return null;

  if (Object.entries(coop.equippedItemIds).some(([slot, uid]) => (
    !ITEM_SLOTS.includes(slot as CoopDefenseItemSlot)
      || typeof uid !== 'string' || uid.length === 0
  ))) return null;
  const equippedCandidates = readCoopDefenseEquippedItemIdCandidates(coop.equippedItemIds);
  const items = sanitizeCoopDefenseItems(coop.items, equippedCandidates);
  if (items.length !== coop.items.length) return null;
  const equippedItemIds = sanitizeCoopDefenseEquippedItemIds(equippedCandidates, items);
  const pendingItemReward = coop.pendingItemReward === null
    ? null : sanitizeCoopDefensePendingItemReward(coop.pendingItemReward);
  if (coop.pendingItemReward !== null && !pendingItemReward) return null;
  return {
    profile: {
      playerName: typeof document.profile.playerName === 'string'
        ? sanitizePlayerName(document.profile.playerName) || null : null,
    },
    loadout,
    loadoutByClass,
    progression: {
      coopDefense: {
        totalXp: sanitizeStoredXp(coop.totalXp),
        lastProcessedRoundEndedAt: sanitizeStoredRoundEndedAt(coop.lastProcessedRoundEndedAt),
        completedBossMapIds,
        highestUnlockedMapId,
        classesUnlocked,
        unlockedClassIds: [...unlockedClassIds],
        defaultProfile,
        selectedClassId,
        profilesByClass,
        itemsUnlocked: coop.itemsUnlocked || isCoopDefenseMapUnlocked(
          COOP_DEFENSE_ITEMS_UNLOCK_AFTER_MAP_ID,
          highestUnlockedMapId,
        ),
        items,
        equippedItemIds,
        pendingItemReward,
        unseenItems: coop.unseenItems && items.length > 0,
      },
    },
  };
}

function toolKey(tool: LoadoutToolRef | null | undefined): string {
  return tool ? `${tool.kind}:${tool.id}` : '';
}

function compactProfile(profile: CoopDefenseUpgradeProfile, classId: CoopDefenseClassId): CompactUpgradeProfile | undefined {
  const safe = sanitizeCoopDefenseUpgradeProfile(profile, classId);
  const defaults = buildDefaultCoopDefenseUpgradeProfile(classId);
  const levels: Record<string, number> = {};
  for (const [upgradeId, state] of Object.entries(safe.upgrades)) {
    if (state.level !== defaults.upgrades[upgradeId]?.level) levels[upgradeId] = state.level;
  }
  const result: CompactUpgradeProfile = {};
  if (Object.keys(levels).length > 0) result.levels = levels;
  const tools = safe.toolLoadout ?? [];
  const defaultTools = defaults.toolLoadout ?? [];
  if (tools.map(toolKey).join('|') !== defaultTools.map(toolKey).join('|')) {
    result.toolLoadout = tools.map((tool) => ({ ...tool }));
  }
  if (toolKey(safe.selectedTool) !== toolKey(defaults.selectedTool)) {
    if (safe.selectedTool) result.selectedTool = { ...safe.selectedTool };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function encodeProgressDocument(preferences: LocalPreferences): LocalProgressDocumentV2 {
  const progress = preferences.progression.coopDefense;
  const profilesByClass: Partial<Record<CoopDefenseClassId, CompactUpgradeProfile>> = {};
  if (progress.unlockedClassIds.length > 0) {
    for (const classId of COOP_DEFENSE_CLASS_IDS) {
      const compact = compactProfile(progress.profilesByClass[classId], classId);
      if (compact) profilesByClass[classId] = compact;
    }
  }
  return {
    schemaVersion: LOCAL_PROGRESS_SCHEMA_VERSION,
    profile: { ...preferences.profile },
    loadout: { ...preferences.loadout },
    coopDefense: {
      totalXp: progress.totalXp,
      lastProcessedRoundEndedAt: progress.lastProcessedRoundEndedAt,
      completedBossMapIds: [...progress.completedBossMapIds],
      highestUnlockedMapId: progress.highestUnlockedMapId,
      classesUnlocked: progress.classesUnlocked,
      unlockedClassIds: [...progress.unlockedClassIds],
      defaultProfile: compactProfile(progress.defaultProfile, DEFAULT_COOP_DEFENSE_CLASS_ID),
      selectedClassId: progress.unlockedClassIds.length > 0 ? progress.selectedClassId : undefined,
      profilesByClass: progress.unlockedClassIds.length > 0 && Object.keys(profilesByClass).length > 0
        ? profilesByClass : undefined,
      loadoutsByClass: progress.unlockedClassIds.length > 0 && Object.keys(preferences.loadoutByClass).length > 0
        ? sanitizeStoredLoadoutsByClass(preferences.loadoutByClass) : undefined,
      itemsUnlocked: progress.itemsUnlocked,
      items: [...progress.items],
      equippedItemIds: { ...progress.equippedItemIds },
      pendingItemReward: progress.pendingItemReward
        ? { ...progress.pendingItemReward, offers: [...progress.pendingItemReward.offers] } : null,
      unseenItems: progress.unseenItems,
    },
  };
}

let preferencesCache: LocalPreferences | null = null;
let cachedStorage: Storage | null = null;

function readPreferences(): LocalPreferences {
  const storage = getLocalStorage();
  if (preferencesCache && cachedStorage === storage) return preferencesCache;
  const defaults = buildDefaultPreferences();
  const rawSettings = safeRead(storage, LOCAL_SETTINGS_STORAGE_KEY);
  let settings: LocalSettingsDocumentV1 | null = null;
  if (rawSettings) {
    try { settings = sanitizeSettingsDocument(JSON.parse(rawSettings)); } catch { settings = null; }
  }
  settings ??= readLegacySettings(safeRead(storage, LEGACY_LOCAL_PREFERENCES_KEY));
  settings ??= {
    schemaVersion: LOCAL_SETTINGS_SCHEMA_VERSION,
    audio: { ...defaults.audio },
    graphics: { ...defaults.graphics },
  };

  const rawProgress = safeRead(storage, LOCAL_PROGRESS_STORAGE_KEY);
  let progress: ReturnType<typeof decodeProgressDocument> = null;
  if (rawProgress) {
    try { progress = decodeProgressDocument(JSON.parse(rawProgress)); } catch { progress = null; }
  }
  preferencesCache = {
    ...defaults,
    audio: { ...settings.audio },
    graphics: { ...settings.graphics },
    ...(progress ?? {}),
  };
  cachedStorage = storage;
  // Fehlende/alte/beschaedigte Dokumente werden kontrolliert auf die neue Generation gesetzt.
  const settingsWritten = safeWrite(storage, LOCAL_SETTINGS_STORAGE_KEY, settings);
  const progressWritten = safeWrite(storage, LOCAL_PROGRESS_STORAGE_KEY, encodeProgressDocument(preferencesCache));
  if (settingsWritten && progressWritten) safeRemove(storage, LEGACY_LOCAL_PREFERENCES_KEY);
  return preferencesCache;
}

function writePreferences(next: LocalPreferences): void {
  const previous = preferencesCache;
  const storage = getLocalStorage();
  cachedStorage = storage;
  if (!previous || previous.audio !== next.audio || previous.graphics !== next.graphics) {
    safeWrite(storage, LOCAL_SETTINGS_STORAGE_KEY, {
      schemaVersion: LOCAL_SETTINGS_SCHEMA_VERSION,
      audio: next.audio,
      graphics: next.graphics,
    } satisfies LocalSettingsDocumentV1);
  }
  if (!previous || previous.profile !== next.profile || previous.loadout !== next.loadout
    || previous.loadoutByClass !== next.loadoutByClass || previous.progression !== next.progression) {
    safeWrite(storage, LOCAL_PROGRESS_STORAGE_KEY, encodeProgressDocument(next));
  }
  preferencesCache = next;
}

function updatePreferences(mutator: (current: LocalPreferences) => LocalPreferences): void {
  writePreferences(mutator(readPreferences()));
}

/** Explizite Invalidierung fuer Tests, Cross-Tab-Aenderungen und neue Scene-Lifetimes. */
export function invalidateLocalStorageCache(): void {
  preferencesCache = null;
  cachedStorage = null;
}

export function exportStoredGameProgressJson(): string {
  const envelope: LocalProgressExportEnvelope = {
    format: LOCAL_PROGRESS_EXPORT_FORMAT,
    formatVersion: LOCAL_PROGRESS_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    progress: encodeProgressDocument(readPreferences()),
  };
  return JSON.stringify(envelope, null, 2);
}

export function importStoredGameProgressJson(json: string): LocalProgressTransferResult {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch {
    return { ok: false, message: 'Die Datei enthält kein gültiges JSON.' };
  }
  if (!isRecord(parsed) || parsed.format !== LOCAL_PROGRESS_EXPORT_FORMAT
    || parsed.formatVersion !== LOCAL_PROGRESS_EXPORT_VERSION
    || typeof parsed.exportedAt !== 'string' || !Number.isFinite(Date.parse(parsed.exportedAt))
    || !('progress' in parsed)) {
    return { ok: false, message: 'Die Datei ist kein kompatibler Fragdachse-Spielstand.' };
  }
  const decoded = decodeProgressDocument(parsed.progress);
  if (!decoded) {
    return { ok: false, message: 'Der Spielstand ist ungültig oder verwendet ein inkompatibles Schema.' };
  }
  const current = readPreferences();
  writePreferences({ ...current, ...decoded });
  return { ok: true, message: 'Spielstand erfolgreich importiert.' };
}

export function downloadStoredGameProgress(): LocalProgressTransferResult {
  try {
    if (typeof document === 'undefined' || typeof URL === 'undefined') throw new Error('unavailable');
    const blob = new Blob([exportStoredGameProgressJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `fragdachse-spielstand-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    return { ok: true, message: 'Spielstand wurde exportiert.' };
  } catch {
    return { ok: false, message: 'Spielstand konnte nicht exportiert werden.' };
  }
}

export function importStoredGameProgressFile(): Promise<LocalProgressTransferResult> {
  return new Promise((resolve) => {
    try {
      if (typeof document === 'undefined') throw new Error('unavailable');
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.onchange = async () => {
        try {
          const file = input.files?.[0];
          if (!file) return resolve({ ok: false, message: 'Keine Datei ausgewählt.' });
          if (file.size > 5_000_000) return resolve({ ok: false, message: 'Die Spielstanddatei ist zu groß.' });
          resolve(importStoredGameProgressJson(await file.text()));
        } catch {
          resolve({ ok: false, message: 'Die Spielstanddatei konnte nicht gelesen werden.' });
        }
      };
      input.click();
    } catch {
      resolve({ ok: false, message: 'Der Dateiimport ist in diesem Browser nicht verfügbar.' });
    }
  });
}

export function getStoredMasterVolume(): number {
  return readPreferences().audio.masterVolume;
}

export function setStoredMasterVolume(volume: number): void {
  const nextVolume = clampAudioVolume(volume);
  updatePreferences((current) => ({
    ...current,
    audio: {
      ...current.audio,
      masterVolume: nextVolume,
    },
  }));
}

export function getStoredEffectsVolume(): number {
  return readPreferences().audio.effectsVolume;
}

export function setStoredEffectsVolume(volume: number): void {
  const nextVolume = clampAudioVolume(volume);
  updatePreferences((current) => ({
    ...current,
    audio: {
      ...current.audio,
      effectsVolume: nextVolume,
    },
  }));
}

export function getStoredMusicVolume(): number {
  return readPreferences().audio.musicVolume;
}

export function setStoredMusicVolume(volume: number): void {
  const nextVolume = clampAudioVolume(volume);
  updatePreferences((current) => ({
    ...current,
    audio: {
      ...current.audio,
      musicVolume: nextVolume,
    },
  }));
}

export function getStoredPlayerName(): string | null {
  return readPreferences().profile.playerName;
}

export function setStoredPlayerName(name: string): void {
  const sanitized = sanitizePlayerName(name) || null;
  updatePreferences((current) => ({
    ...current,
    profile: {
      ...current.profile,
      playerName: sanitized,
    },
  }));
}

export function getStoredLoadoutSlot(slot: LoadoutSlot): string | null {
  return readPreferences().loadout[slot] ?? null;
}

export function setStoredLoadoutSlot(slot: LoadoutSlot, itemId: string): void {
  updatePreferences((current) => ({
    ...current,
    loadout: {
      ...current.loadout,
      [slot]: itemId,
    },
  }));
}

export function clearStoredLoadoutSlot(slot: LoadoutSlot): void {
  updatePreferences((current) => {
    const nextLoadout = { ...current.loadout };
    delete nextLoadout[slot];
    return {
      ...current,
      loadout: nextLoadout,
    };
  });
}

/** Liest einen Coop-Defense-Loadout-Slot aus dem Profil der konkreten Klasse. */
export function getStoredCoopDefenseLoadoutSlot(
  classId: CoopDefenseClassId,
  slot: LoadoutSlot,
): string | null {
  return readPreferences().loadoutByClass[classId]?.[slot] ?? null;
}

/** Liest das komplette, klassenbezogene Loadout mit nur einem Preferences-Parse. */
export function getStoredCoopDefenseLoadout(
  classId: CoopDefenseClassId,
): Partial<Record<LoadoutSlot, string>> {
  return { ...(readPreferences().loadoutByClass[classId] ?? {}) };
}

/** Speichert einen Coop-Defense-Loadout-Slot getrennt vom Profil jeder anderen Klasse. */
export function setStoredCoopDefenseLoadoutSlot(
  classId: CoopDefenseClassId,
  slot: LoadoutSlot,
  itemId: string,
): void {
  updatePreferences((current) => ({
    ...current,
    loadoutByClass: {
      ...current.loadoutByClass,
      [classId]: {
        ...(current.loadoutByClass[classId] ?? {}),
        [slot]: itemId,
      },
    },
  }));
}

/**
 * Speichert einen Klassenwechsel atomar: bisheriges Loadout sichern, Ziel-Loadout
 * wiederherstellen und aktive Klasse setzen. Das vermeidet je Slot einen kompletten
 * Parse-/Serialize-Zyklus des lokalen Preferences-Objekts.
 */
export function switchStoredCoopDefenseClassLoadout(
  previousClassId: CoopDefenseClassId,
  nextClassId: CoopDefenseClassId,
  previousLoadout: Partial<Record<LoadoutSlot, string>>,
  nextLoadout: Partial<Record<LoadoutSlot, string>>,
): void {
  updatePreferences((current) => {
    const storedProgress = current.progression.coopDefense;
    if (storedProgress.unlockedClassIds.length === 0) return current;

    return {
      ...current,
      loadoutByClass: {
        ...current.loadoutByClass,
        [previousClassId]: {
          ...(current.loadoutByClass[previousClassId] ?? {}),
          ...previousLoadout,
        },
        [nextClassId]: {
          ...(current.loadoutByClass[nextClassId] ?? {}),
          ...nextLoadout,
        },
      },
      progression: {
        ...current.progression,
        coopDefense: {
          ...storedProgress,
          selectedClassId: sanitizeCoopDefenseClassId(nextClassId),
        },
      },
    };
  });
}

/** Entfernt einen gespeicherten Coop-Defense-Slot, ohne andere Klassenprofile anzutasten. */
export function clearStoredCoopDefenseLoadoutSlot(
  classId: CoopDefenseClassId,
  slot: LoadoutSlot,
): void {
  updatePreferences((current) => {
    const nextClassLoadout = { ...(current.loadoutByClass[classId] ?? {}) };
    delete nextClassLoadout[slot];
    return {
      ...current,
      loadoutByClass: {
        ...current.loadoutByClass,
        [classId]: nextClassLoadout,
      },
    };
  });
}

export function getStoredCoopDefenseProgress(): CoopDefenseProgressPreferences {
  const progress = readPreferences().progression.coopDefense;
  return {
    totalXp: progress.totalXp,
    lastProcessedRoundEndedAt: progress.lastProcessedRoundEndedAt,
    completedBossMapIds: [...progress.completedBossMapIds],
    highestUnlockedMapId: progress.highestUnlockedMapId,
    classesUnlocked: progress.classesUnlocked,
    unlockedClassIds: [...progress.unlockedClassIds],
    defaultProfile: cloneCoopDefenseUpgradeProfile(
      progress.defaultProfile,
      DEFAULT_COOP_DEFENSE_CLASS_ID,
    ),
    selectedClassId: progress.selectedClassId,
    profilesByClass: cloneProfilesByClass(progress.profilesByClass),
    itemsUnlocked: progress.itemsUnlocked,
    unseenItems: progress.unseenItems,
    ...cloneCoopDefenseItemState(progress),
  };
}

/** Stellt einen zuvor gelesenen, bereits validierten Fortschrittsstand atomar wieder her. */
export function restoreStoredCoopDefenseProgress(progress: CoopDefenseProgressPreferences): void {
  updatePreferences((current) => ({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: {
        ...progress,
        completedBossMapIds: [...progress.completedBossMapIds],
        defaultProfile: cloneCoopDefenseUpgradeProfile(
          progress.defaultProfile,
          DEFAULT_COOP_DEFENSE_CLASS_ID,
        ),
        profilesByClass: cloneProfilesByClass(progress.profilesByClass),
        ...cloneCoopDefenseItemState(progress),
      },
    },
  }));
}

/** Setzt den lokalen Coop-Charakter inklusive Skills, Klassen und Kampagnenstand auf frisch. */
export function resetStoredCoopDefenseCharacter(): void {
  updatePreferences((current) => ({
    ...current,
    loadout: {},
    loadoutByClass: {},
    progression: {
      ...current.progression,
      coopDefense: {
        ...DEFAULT_COOP_DEFENSE_PROGRESS,
        completedBossMapIds: [],
        defaultProfile: cloneCoopDefenseUpgradeProfile(
          DEFAULT_COOP_DEFENSE_PROGRESS.defaultProfile,
          DEFAULT_COOP_DEFENSE_CLASS_ID,
        ),
        profilesByClass: cloneProfilesByClass(DEFAULT_COOP_DEFENSE_PROGRESS.profilesByClass),
        ...cloneCoopDefenseItemState(DEFAULT_COOP_DEFENSE_PROGRESS),
      },
    },
  }));
}

export function getStoredHighestUnlockedCoopDefenseMapId(): string {
  return readPreferences().progression.coopDefense.highestUnlockedMapId;
}

export function setStoredHighestUnlockedCoopDefenseMapId(mapId: string): void {
  const nextMapId = sanitizeHighestUnlockedCoopDefenseMapId(mapId);
  updatePreferences((current) => ({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: {
        ...current.progression.coopDefense,
        highestUnlockedMapId: nextMapId,
      },
    },
  }));
}

/**
 * Schaltet nach einem Sieg die Folgemap frei und meldet, ob dadurch neuer Fortschritt entstand.
 * Ein Sieg auf einer bereits geschafften Map senkt den Stand nie.
 */
export function unlockStoredCoopDefenseMapAfterVictory(completedMapId: string): boolean {
  const unlockedMapId = getCoopDefenseMapUnlockedByVictoryOn(completedMapId.trim());
  if (!unlockedMapId) return false;

  const current = readPreferences();
  const currentMapId = current.progression.coopDefense.highestUnlockedMapId;
  const nextMapId = maxHighestUnlockedCoopDefenseMapId(currentMapId, unlockedMapId);
  if (nextMapId === currentMapId) return false;

  writePreferences({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: {
        ...current.progression.coopDefense,
        highestUnlockedMapId: nextMapId,
      },
    },
  });
  return true;
}

export function getStoredCoopDefenseClassId(): CoopDefenseClassId {
  return readPreferences().progression.coopDefense.selectedClassId;
}

export function setStoredCoopDefenseClassId(classId: CoopDefenseClassId): void {
  updatePreferences((current) => ({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: {
        ...current.progression.coopDefense,
        selectedClassId: current.progression.coopDefense.unlockedClassIds.includes(classId)
          ? classId
          : DEFAULT_COOP_DEFENSE_CLASS_ID,
      },
    },
  }));
}

export function getStoredCoopDefenseClassesUnlocked(): boolean {
  return readPreferences().progression.coopDefense.unlockedClassIds.length > 0;
}

export function getStoredUnlockedCoopDefenseClassIds(): readonly CoopDefenseClassId[] {
  return [...readPreferences().progression.coopDefense.unlockedClassIds];
}

/**
 * Debug- und Freischaltpfad fuer die Klassenmechanik. Beim Sperren wird die aktive Klasse zum
 * neuen Default-Stand; nicht uebertragbare Investitionen werden dadurch zu freien Punkten.
 */
export function setStoredCoopDefenseClassesUnlocked(unlocked: boolean): boolean {
  const current = readPreferences();
  const storedProgress = current.progression.coopDefense;
  if (storedProgress.classesUnlocked === unlocked) return false;

  const defaultProfile = constrainCoopDefenseUpgradeProfileToBossPoints(
    sanitizeCoopDefenseUpgradeProfile(
      unlocked
        ? storedProgress.defaultProfile
        : storedProgress.profilesByClass[storedProgress.selectedClassId],
      DEFAULT_COOP_DEFENSE_CLASS_ID,
    ),
    storedProgress.completedBossMapIds.length,
    DEFAULT_COOP_DEFENSE_CLASS_ID,
  );
  const loadoutByClass = unlocked && !current.loadoutByClass[DEFAULT_COOP_DEFENSE_CLASS_ID]
    ? {
      ...current.loadoutByClass,
      [DEFAULT_COOP_DEFENSE_CLASS_ID]: { ...current.loadout },
    }
    : current.loadoutByClass;
  writePreferences({
    ...current,
    loadoutByClass,
    progression: {
      ...current.progression,
      coopDefense: {
        ...storedProgress,
        classesUnlocked: unlocked,
        unlockedClassIds: unlocked
          ? ['dachs_nukem', 'dachs_of_steel']
          : [],
        defaultProfile,
        selectedClassId: DEFAULT_COOP_DEFENSE_CLASS_ID,
        profilesByClass: mirrorDefaultProfileToClasses(
          defaultProfile,
          storedProgress.completedBossMapIds.length,
        ),
      },
    },
  });
  return true;
}

export function unlockStoredCoopDefenseClassesAfterVictory(completedMapId: string): boolean {
  const targetClassIds = getUnlockedCoopDefenseClassIds(completedMapId.trim());
  if (targetClassIds.length === 0) return false;
  const current = readPreferences();
  const storedProgress = current.progression.coopDefense;
  const nextClassIds = [...new Set([...storedProgress.unlockedClassIds, ...targetClassIds])];
  if (nextClassIds.length === storedProgress.unlockedClassIds.length) return false;
  writePreferences({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: {
        ...storedProgress,
        classesUnlocked: true,
        unlockedClassIds: nextClassIds,
        profilesByClass: mirrorDefaultProfileToClasses(
          storedProgress.defaultProfile,
          storedProgress.completedBossMapIds.length,
        ),
      },
    },
  });
  return true;
}

export function getStoredCoopDefenseUpgradeProfile(
  classId?: CoopDefenseClassId,
): CoopDefenseUpgradeProfile {
  const progress = readPreferences().progression.coopDefense;
  if (progress.unlockedClassIds.length === 0 && classId === undefined) {
    return cloneCoopDefenseUpgradeProfile(progress.defaultProfile, DEFAULT_COOP_DEFENSE_CLASS_ID);
  }
  const resolvedClassId = classId ?? progress.selectedClassId;
  if (!progress.unlockedClassIds.includes(resolvedClassId)) {
    return cloneCoopDefenseUpgradeProfile(progress.defaultProfile, DEFAULT_COOP_DEFENSE_CLASS_ID);
  }
  return cloneCoopDefenseUpgradeProfile(progress.profilesByClass[resolvedClassId], resolvedClassId);
}

export function setStoredCoopDefenseUpgradeProfile(
  profile: CoopDefenseUpgradeProfile,
  classId?: CoopDefenseClassId,
): void {
  updatePreferences((current) => {
    const storedProgress = current.progression.coopDefense;
    if (storedProgress.unlockedClassIds.length === 0) {
      const defaultProfile = constrainCoopDefenseUpgradeProfileToBossPoints(
        sanitizeCoopDefenseUpgradeProfile(profile, DEFAULT_COOP_DEFENSE_CLASS_ID),
        storedProgress.completedBossMapIds.length,
        DEFAULT_COOP_DEFENSE_CLASS_ID,
      );
      return {
        ...current,
        progression: {
          ...current.progression,
          coopDefense: {
            ...storedProgress,
            defaultProfile,
            profilesByClass: mirrorDefaultProfileToClasses(
              defaultProfile,
              storedProgress.completedBossMapIds.length,
            ),
          },
        },
      };
    }

    const resolvedClassId = classId ?? storedProgress.selectedClassId;
    if (!storedProgress.unlockedClassIds.includes(resolvedClassId)) return current;
    return {
      ...current,
      progression: {
        ...current.progression,
        coopDefense: {
          ...storedProgress,
          profilesByClass: {
            ...storedProgress.profilesByClass,
            [resolvedClassId]: constrainCoopDefenseUpgradeProfileToBossPoints(
              sanitizeCoopDefenseUpgradeProfile(profile, resolvedClassId),
              storedProgress.completedBossMapIds.length,
              resolvedClassId,
            ),
          },
        },
      },
    };
  });
}

/** Setzt den gesamten Coop-Defense-Upgradefortschritt atomar auf die Startprofile zurueck. */
export function resetStoredCoopDefenseUpgradeProfiles(): void {
  updatePreferences((current) => {
    const storedProgress = current.progression.coopDefense;
    const defaultProfile = constrainCoopDefenseUpgradeProfileToBossPoints(
      buildDefaultCoopDefenseUpgradeProfile(DEFAULT_COOP_DEFENSE_CLASS_ID),
      storedProgress.completedBossMapIds.length,
      DEFAULT_COOP_DEFENSE_CLASS_ID,
    );

    return {
      ...current,
      progression: {
        ...current.progression,
        coopDefense: {
          ...storedProgress,
          defaultProfile,
          profilesByClass: mirrorDefaultProfileToClasses(
            defaultProfile,
            storedProgress.completedBossMapIds.length,
          ),
        },
      },
    };
  });
}

export function setStoredCoopDefenseTotalXp(totalXp: number): void {
  const nextTotalXp = sanitizeStoredXp(totalXp);
  updatePreferences((current) => ({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: {
        ...current.progression.coopDefense,
        totalXp: nextTotalXp,
      },
    },
  }));
}

export function addStoredCoopDefenseXp(amount: number): number {
  const nextAmount = sanitizeStoredXp(amount);
  const current = readPreferences();
  const nextTotalXp = sanitizeStoredXp(current.progression.coopDefense.totalXp + nextAmount);
  writePreferences({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: {
        ...current.progression.coopDefense,
        totalXp: nextTotalXp,
      },
    },
  });
  return nextTotalXp;
}

export function markStoredCoopDefenseRoundProcessed(endedAt: number | null): void {
  const nextEndedAt = sanitizeStoredRoundEndedAt(endedAt);
  updatePreferences((current) => ({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: {
        ...current.progression.coopDefense,
        lastProcessedRoundEndedAt: nextEndedAt,
      },
    },
  }));
}

// ── Dauerhafte Items ────────────────────────────────────────────────────────

export function getStoredCoopDefenseItemsUnlocked(): boolean {
  return readPreferences().progression.coopDefense.itemsUnlocked;
}

/** Gibt zurueck, ob sich der Freischaltstand tatsaechlich geaendert hat. */
export function setStoredCoopDefenseItemsUnlocked(unlocked: boolean): boolean {
  const current = readPreferences();
  if (current.progression.coopDefense.itemsUnlocked === unlocked) return false;
  writePreferences({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: { ...current.progression.coopDefense, itemsUnlocked: unlocked },
    },
  });
  return true;
}

/** Analog zur Klassenfreischaltung: genau ein Map-Sieg oeffnet das System dauerhaft. */
export function unlockStoredCoopDefenseItemsAfterVictory(completedMapId: string): boolean {
  return completedMapId.trim() === COOP_DEFENSE_ITEMS_UNLOCK_AFTER_MAP_ID
    && setStoredCoopDefenseItemsUnlocked(true);
}

export function getStoredCoopDefenseItems(): CoopDefenseItem[] {
  return [...readPreferences().progression.coopDefense.items];
}

export function getStoredCoopDefenseEquippedItemIds(): CoopDefenseEquippedItemIds {
  return { ...readPreferences().progression.coopDefense.equippedItemIds };
}

/** Die vier ausgeruesteten Teile – genau das, was in den Loadout-Commit wandert. */
export function getStoredEquippedCoopDefenseItems(): CoopDefenseItem[] {
  const progress = readPreferences().progression.coopDefense;
  return getEquippedCoopDefenseItems(progress.items, progress.equippedItemIds);
}

/** Legt ein Item ins Inventar. Gibt `false` zurueck, wenn die Kategorie voll ist. */
export function addStoredCoopDefenseItem(item: CoopDefenseItem): boolean {
  const current = readPreferences();
  const progress = current.progression.coopDefense;
  if (isCoopDefenseStashFull(progress.items, progress.equippedItemIds, item.slot)) return false;

  writePreferences({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: {
        ...progress,
        items: addCoopDefenseItem(progress.items, item),
        unseenItems: true,
      },
    },
  });
  return true;
}

/** Das Item-Menue wurde angesehen: der Hinweis am Button erlischt. */
export function markStoredCoopDefenseItemsSeen(): boolean {
  const current = readPreferences();
  if (!current.progression.coopDefense.unseenItems) return false;
  writePreferences({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: { ...current.progression.coopDefense, unseenItems: false },
    },
  });
  return true;
}

/** Ruestet ein besessenes Item in seinem Slot aus. */
export function equipStoredCoopDefenseItem(uid: string): boolean {
  const current = readPreferences();
  const progress = current.progression.coopDefense;
  const item = progress.items.find((entry) => entry.uid === uid);
  if (!item || progress.equippedItemIds[item.slot] === uid) return false;

  writePreferences({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: {
        ...progress,
        equippedItemIds: { ...progress.equippedItemIds, [item.slot]: uid },
      },
    },
  });
  return true;
}

export function unequipStoredCoopDefenseItem(slot: CoopDefenseItemSlot): boolean {
  const current = readPreferences();
  const progress = current.progression.coopDefense;
  if (progress.equippedItemIds[slot] === undefined) return false;

  const equippedItemIds = { ...progress.equippedItemIds };
  delete equippedItemIds[slot];
  writePreferences({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: { ...progress, equippedItemIds },
    },
  });
  return true;
}

/**
 * Zerlegt ein besessenes Item und schreibt die XP ins Levelsystem. Gibt die gutgeschriebenen XP
 * zurueck, `0` wenn das Item nicht existiert oder gerade ausgeruestet ist.
 */
export function salvageStoredCoopDefenseItem(uid: string): number {
  const current = readPreferences();
  const progress = current.progression.coopDefense;
  const item = progress.items.find((entry) => entry.uid === uid);
  if (!item || progress.equippedItemIds[item.slot] === uid) return 0;

  const xp = getCoopDefenseItemSalvageXp(item);
  writePreferences({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: {
        ...progress,
        totalXp: sanitizeStoredXp(progress.totalXp + xp),
        items: removeCoopDefenseItem(progress.items, uid),
      },
    },
  });
  return xp;
}

export function getStoredPendingCoopDefenseItemReward(): CoopDefensePendingItemReward | null {
  const pending = readPreferences().progression.coopDefense.pendingItemReward;
  return pending ? { ...pending, offers: [...pending.offers] } : null;
}

/**
 * Legt ein Angebot ab. Ein bereits offenes Angebot derselben Runde bleibt bestehen, damit eine
 * wiederholte Auswertung derselben Runde die bereits gezeigten Items nicht austauscht.
 */
export function setStoredPendingCoopDefenseItemReward(reward: CoopDefensePendingItemReward): boolean {
  const current = readPreferences();
  const progress = current.progression.coopDefense;
  if (progress.pendingItemReward?.roundEndedAt === reward.roundEndedAt) return false;

  writePreferences({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: {
        ...progress,
        pendingItemReward: { ...reward, offers: [...reward.offers] },
      },
    },
  });
  return true;
}

export function clearStoredPendingCoopDefenseItemReward(): void {
  updatePreferences((current) => ({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: { ...current.progression.coopDefense, pendingItemReward: null },
    },
  }));
}

export interface CoopDefenseItemRewardClaim {
  /** `null`, wenn das gewaehlte Angebot direkt zerlegt wurde. */
  readonly acquired: CoopDefenseItem | null;
  readonly salvagedXp: number;
}

/**
 * Loest ein offenes Angebot in einem Schritt auf: Item uebernehmen, optional ein vorhandenes
 * Teil derselben Kategorie zerlegen, Angebot schliessen.
 *
 * Ist die Kategorie voll und wird kein zerlegbares Item benannt, passiert **nichts** und die
 * Funktion gibt `null` zurueck – die Belohnung bleibt offen, statt still verloren zu gehen.
 * `salvageUid === offerUid` zerlegt das Angebot selbst. Bei `action === 'equip'` wird das
 * bisher ausgeruestete Teil in den Stash verschoben; reicht der Platz dafuer nicht, bleibt die
 * gesamte Transaktion unveraendert.
 */
export function claimStoredPendingCoopDefenseItemReward(
  offerUid: string,
  salvageUid?: string,
  action: CoopDefenseItemRewardAction = 'take',
): CoopDefenseItemRewardClaim | null {
  const current = readPreferences();
  const progress = current.progression.coopDefense;
  const offer = progress.pendingItemReward?.offers.find((entry) => entry.uid === offerUid);
  if (!offer) return null;

  const commit = (
    items: CoopDefenseItem[],
    salvagedXp: number,
    acquired: CoopDefenseItem | null,
    equippedItemIds: CoopDefenseEquippedItemIds = progress.equippedItemIds,
  ): CoopDefenseItemRewardClaim => {
    writePreferences({
      ...current,
      progression: {
        ...current.progression,
        coopDefense: {
          ...progress,
          totalXp: sanitizeStoredXp(progress.totalXp + salvagedXp),
          items,
          equippedItemIds,
          pendingItemReward: null,
          // Nur ein uebernommenes Teil ist neu; ein direkt zerlegtes Angebot landet nie im
          // Inventar und darf den Hinweis am Button deshalb nicht ausloesen.
          unseenItems: progress.unseenItems || acquired !== null,
        },
      },
    });
    return { acquired, salvagedXp };
  };

  if (salvageUid === offerUid) {
    return commit([...progress.items], getCoopDefenseItemSalvageXp(offer), null);
  }

  const salvaged = salvageUid
    ? progress.items.find((entry) => (
      entry.uid === salvageUid
        && entry.slot === offer.slot
        && progress.equippedItemIds[entry.slot] !== entry.uid
    ))
    : undefined;
  if (salvageUid && !salvaged) return null;

  const remaining = salvaged ? removeCoopDefenseItem(progress.items, salvaged.uid) : [...progress.items];
  const slotIsEmpty = getEquippedCoopDefenseItem(
    progress.items,
    progress.equippedItemIds,
    offer.slot,
  ) === null;
  // Ein leerer Slot nimmt das neue Teil direkt auf und braucht deshalb keinen Stash-Platz.
  // Beim Ausruesten eines belegten Slots muss das bisher getragene Teil dagegen in den Stash
  // wandern. Der Platz wird nach einem optionalen Zerlegen geprueft, bevor irgendetwas
  // persistiert wird; so kann ein voller Stash weder das alte noch das neue Item verlieren.
  if (!slotIsEmpty && isCoopDefenseStashFull(remaining, progress.equippedItemIds, offer.slot)) return null;

  const salvagedXp = salvaged ? getCoopDefenseItemSalvageXp(salvaged) : 0;
  const items = addCoopDefenseItem(remaining, offer);
  const acquired = items[items.length - 1];
  const equippedItemIds = slotIsEmpty || action === 'equip'
    ? { ...progress.equippedItemIds, [offer.slot]: acquired.uid }
    : progress.equippedItemIds;
  return commit(items, salvagedXp, acquired, equippedItemIds);
}

export function getStoredGraphicsQuality(): GraphicsQuality {
  return readPreferences().graphics.quality;
}

export function setStoredGraphicsQuality(quality: GraphicsQuality): void {
  updatePreferences((current) => ({
    ...current,
    graphics: { quality },
  }));
}

/** Overrides the locally stored XP, boss points and map unlock level for the cheat/debug menu. */
export function setStoredCoopDefenseCheatProgress(
  totalXp: number,
  earnedBossPoints: number,
  highestUnlockedMapId: string,
): void {
  const nextTotalXp = sanitizeStoredXp(totalXp);
  const nextBossPointCount = sanitizeStoredXp(earnedBossPoints);
  const nextHighestUnlockedMapId = sanitizeHighestUnlockedCoopDefenseMapId(highestUnlockedMapId);

  updatePreferences((current) => {
    const storedProgress = current.progression.coopDefense;
    const completedBossMapIds = storedProgress.completedBossMapIds
      .filter((mapId) => !mapId.startsWith(CHEAT_BOSS_MAP_ID_PREFIX))
      .slice(0, nextBossPointCount);

    while (completedBossMapIds.length < nextBossPointCount) {
      completedBossMapIds.push(`${CHEAT_BOSS_MAP_ID_PREFIX}${completedBossMapIds.length + 1}`);
    }
    const defaultProfile = constrainCoopDefenseUpgradeProfileToBossPoints(
      storedProgress.defaultProfile,
      nextBossPointCount,
      DEFAULT_COOP_DEFENSE_CLASS_ID,
    );
    const profilesByClass = storedProgress.classesUnlocked
      ? Object.fromEntries(
        COOP_DEFENSE_CLASS_IDS.map((classId) => [
          classId,
          constrainCoopDefenseUpgradeProfileToBossPoints(
            storedProgress.profilesByClass[classId],
            nextBossPointCount,
            classId,
          ),
        ]),
      ) as Record<CoopDefenseClassId, CoopDefenseUpgradeProfile>
      : mirrorDefaultProfileToClasses(defaultProfile, nextBossPointCount);

    return {
      ...current,
      progression: {
        ...current.progression,
        coopDefense: {
          ...storedProgress,
          totalXp: nextTotalXp,
          completedBossMapIds,
          highestUnlockedMapId: nextHighestUnlockedMapId,
          unlockedClassIds: [...getUnlockedCoopDefenseClassIds(nextHighestUnlockedMapId)],
          classesUnlocked: getUnlockedCoopDefenseClassIds(nextHighestUnlockedMapId).length > 0,
          defaultProfile,
          profilesByClass,
        },
      },
    };
  });
}

/** Records a successful boss map once and returns whether a new boss point was earned. */
export function markStoredCoopDefenseBossMapCompleted(mapId: string): boolean {
  const normalizedMapId = mapId.trim();
  if (!normalizedMapId) return false;

  const current = readPreferences();
  const completedBossMapIds = current.progression.coopDefense.completedBossMapIds;
  if (completedBossMapIds.includes(normalizedMapId)) return false;

  writePreferences({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: {
        ...current.progression.coopDefense,
        completedBossMapIds: [...completedBossMapIds, normalizedMapId],
      },
    },
  });
  return true;
}
