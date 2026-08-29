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
import { COOP_DEFENSE_CONSTRUCTION_IDS } from '../config/coopDefenseConstructions';
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
  sanitizeCoopDefensePendingItemRewards,
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
import {
  PERSISTENT_BASE_UNLOCK_AFTER_MAP_ID,
  PERSISTENT_BASE_AREA_STAGE_UNLOCK_AFTER_MAP_ID,
} from '../config/persistentBase';
import { sanitizePlayerName } from './playerName';
import { isGraphicsQuality, type GraphicsQuality } from '../graphics/GraphicsQuality';
import { isLocale, resolveBrowserLocale, type Locale } from '../i18n/types';
import type {
  BalanceBuildSnapshot,
  BalanceItemSnapshot,
  BalanceRoundFeedback,
  BalanceRoundRecord,
  CoopDefenseBalanceLabDocument,
} from '../debug/coopDefenseBalance/types';
import {
  COOP_DEFENSE_BALANCE_MAX_COMMENT_LENGTH,
  COOP_DEFENSE_BALANCE_MAX_ROUNDS,
  COOP_DEFENSE_BALANCE_STORAGE_KEY,
  COOP_DEFENSE_BALANCE_STORAGE_SCHEMA_VERSION,
} from '../debug/coopDefenseBalance/types';
import {
  clonePersistentBaseState,
  DEFAULT_PERSISTENT_BASE_STATE,
  sanitizePersistentBaseState,
  type PersistentBaseState,
  clonePersistentPlayerBaseContribution,
  isStableOwnerId,
  sanitizePersistentPlayerBaseContribution,
  DEFAULT_PERSISTENT_PLAYER_BASE_CONTRIBUTION,
  type PersistentPlayerBaseContribution,
} from '../persistentBase/PersistentBaseTypes';
import {
  clonePersistentBaseRewardState,
  DEFAULT_PERSISTENT_BASE_REWARD_STATE,
  isPersistentBaseRewardId,
  sanitizePersistentBaseRewardIds,
  sanitizePersistentBaseRewardState,
  type PersistentBaseRewardId,
  type PersistentBaseRewardState,
} from '../persistentBase/PersistentBaseRewardTypes';
import {
  DEFAULT_PERSISTENT_BASE_AREA_STAGE,
  isPersistentBaseAreaStage,
  type PersistentBaseAreaStage,
} from '../persistentBase/PersistentBaseCore';

/** Einmalige Alpha-Generation. Nur Einstellungen werden daraus uebernommen. */
export const LEGACY_LOCAL_PREFERENCES_KEY = 'fragdachse_local_preferences';
export const LOCAL_SETTINGS_STORAGE_KEY = 'fragdachse_settings_v1';
export const LOCAL_PROGRESS_STORAGE_KEY = 'fragdachse_progress_v5';
export const LOCAL_SETTINGS_SCHEMA_VERSION = 2;
export const LOCAL_PROGRESS_SCHEMA_VERSION = 5;
export const LOCAL_PROGRESS_EXPORT_FORMAT = 'fragdachse-progress';
export const LOCAL_PROGRESS_EXPORT_VERSION = 5;
export const LOCAL_BALANCE_LAB_STORAGE_KEY = COOP_DEFENSE_BALANCE_STORAGE_KEY;
export const LOCAL_BALANCE_LAB_SCHEMA_VERSION = COOP_DEFENSE_BALANCE_STORAGE_SCHEMA_VERSION;
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
   * Besitzt der Spieler die persistente Basis?
   *
   * Ein eigenstaendiges Entitlement, kein abgeleiteter Mapfortschritt: Es entscheidet, ob die
   * LobbyWorld ihren Basiskern aufbaut, und ist damit die eine Stelle, an der "wir haben eine
   * Basis" gespeichert ist. Die Form der Basis ist Code, ihre Lage World-Konfiguration.
   */
  persistentBaseUnlocked: boolean;
  /** Semantische Ausbau-Stufe; niemals aus der aktuellen oder hoechsten Map rekonstruiert. */
  persistentBaseAreaStage: PersistentBaseAreaStage;
  /** Personal reward ownership; never used as host placement authority. */
  persistentBaseRewardUnlocks: PersistentBaseRewardId[];
  /**
   * Gesamter Item-Besitz inklusive der ausgeruesteten Teile. Eine einzige Liste plus
   * {@link equippedItemIds} statt getrennter Stash-/Equipped-Listen: damit kann ein Item
   * niemals in beiden oder in keiner Liste stehen, und "ausgeruestet zaehlt nicht aufs Limit"
   * ist eine reine Abfrage statt eines Umhaengens.
   */
  items: CoopDefenseItem[];
  equippedItemIds: CoopDefenseEquippedItemIds;
  /**
   * FIFO-Queue offener Belohnungsangebote. Jedes Angebot ueberlebt Reload und Verbindungsabbruch
   * waehrend der Auswahl und wird nie durch ein spaeteres Angebot ueberschrieben.
   */
  pendingItemRewards: CoopDefensePendingItemReward[];
  /**
   * Ein neu erhaltenes Teil liegt im Inventar, ohne dass der Spieler das Item-Menue seitdem
   * geoeffnet hat. Treibt den Hinweis am Items-Button und wird beim Oeffnen zurueckgesetzt.
   */
  unseenItems: boolean;
  /** Committed, map-relative Inspector constructions. */
  persistentBase: PersistentBaseState;
  /** Host-owned placement state, persisted separately from personal reward ownership. */
  persistentBaseRewardState: PersistentBaseRewardState;
  /**
   * Der persoenliche Beitrag dieses Spielers zur persistenten Basis.
   *
   * Genau ein Besitzpfad, egal ob der Spieler gerade Host oder Gast ist. Was davon in einem
   * konkreten Raum tatsaechlich steht, entscheidet dort der Host; hier steht nur, was der
   * Spieler besitzt.
   */
  personalBaseContribution: PersistentPlayerBaseContribution;
}

interface LocalPreferences {
  locale: Locale;
  audio: {
    masterVolume: number;
    effectsVolume: number;
    musicVolume: number;
  };
  profile: {
    playerName: string | null;
    /**
     * Dauerhafte Besitzeridentitaet dieses Geraets/Profils.
     *
     * Sie ist die eine Antwort auf "wem gehoert diese Konstruktion" und ueberlebt Raumwechsel,
     * Reconnects und Host-Wechsel. Bewusst nicht aus Peer-ID, Room-ID oder Anzeigename
     * abgeleitet: Alle drei wechseln, waehrend der Besitz bestehen bleibt.
     */
    ownerId: string;
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

interface LocalSettingsDocumentV2 {
  schemaVersion: 2;
  locale: Locale;
  audio: LocalPreferences['audio'];
  graphics: LocalPreferences['graphics'];
}

export interface LocalProgressDocument {
  schemaVersion: 5;
  profile: LocalPreferences['profile'];
  loadout: LocalPreferences['loadout'];
  coopDefense: {
    totalXp: number;
    lastProcessedRoundEndedAt: number | null;
    completedBossMapIds: string[];
    highestUnlockedMapId: string;
    classesUnlocked: boolean;
    unlockedClassIds: CoopDefenseClassId[];
    defaultProfile?: CompactUpgradeProfile;
    selectedClassId?: CoopDefenseClassId;
    profilesByClass?: Partial<Record<CoopDefenseClassId, CompactUpgradeProfile>>;
    loadoutsByClass?: LocalPreferences['loadoutByClass'];
    itemsUnlocked: boolean;
    persistentBaseUnlocked: boolean;
    persistentBaseAreaStage: PersistentBaseAreaStage;
    persistentBaseRewardUnlocks: PersistentBaseRewardId[];
    items: CoopDefenseItem[];
    equippedItemIds: CoopDefenseEquippedItemIds;
    pendingItemRewards: CoopDefensePendingItemReward[];
    /** Legacy-Feld in alten Schema-2-Saves; wird beim Dekodieren in die Queue migriert. */
    pendingItemReward?: CoopDefensePendingItemReward | null;
    unseenItems: boolean;
    persistentBase: PersistentBaseState;
    personalBaseContribution: PersistentPlayerBaseContribution;
    persistentBaseRewardState: PersistentBaseRewardState;
  };
}

interface LocalProgressExportEnvelope {
  format: typeof LOCAL_PROGRESS_EXPORT_FORMAT;
  formatVersion: typeof LOCAL_PROGRESS_EXPORT_VERSION;
  exportedAt: string;
  progress: LocalProgressDocument;
}

export interface LocalProgressTransferResult {
  readonly ok: boolean;
  readonly messageKey: LocalProgressTransferMessageKey;
}

export type LocalProgressTransferMessageKey =
  | 'ui.lobby.saveInvalidJson'
  | 'ui.lobby.saveIncompatible'
  | 'ui.lobby.saveInvalid'
  | 'ui.lobby.saveImported'
  | 'ui.lobby.saveExported'
  | 'ui.lobby.saveExportFailed'
  | 'ui.lobby.saveNoFile'
  | 'ui.lobby.saveTooLarge'
  | 'ui.lobby.saveReadFailed'
  | 'ui.lobby.saveUnavailable';

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
  persistentBaseUnlocked: false,
  persistentBaseAreaStage: DEFAULT_PERSISTENT_BASE_AREA_STAGE,
  persistentBaseRewardUnlocks: [],
  items: [],
  equippedItemIds: {},
  pendingItemRewards: [],
  unseenItems: false,
  persistentBase: clonePersistentBaseState(DEFAULT_PERSISTENT_BASE_STATE),
  personalBaseContribution: clonePersistentPlayerBaseContribution(DEFAULT_PERSISTENT_PLAYER_BASE_CONTRIBUTION),
  persistentBaseRewardState: clonePersistentBaseRewardState(DEFAULT_PERSISTENT_BASE_REWARD_STATE),
};

/**
 * Items sind unveraenderliche Wertobjekte; nur die Huellen (Liste, Slot-Zuordnung) muessen
 * kopiert werden, damit Leser den gespeicherten Stand nicht versehentlich veraendern.
 */
function cloneCoopDefenseItemState(progress: CoopDefenseProgressPreferences): {
  items: CoopDefenseItem[];
  equippedItemIds: CoopDefenseEquippedItemIds;
  pendingItemRewards: CoopDefensePendingItemReward[];
} {
  return {
    items: [...progress.items],
    equippedItemIds: { ...progress.equippedItemIds },
    pendingItemRewards: progress.pendingItemRewards.map((reward) => ({
      ...reward,
      offers: [...reward.offers],
    })),
  };
}

const DEFAULT_PREFERENCES: LocalPreferences = {
  locale: resolveBrowserLocale(),
  audio: {
    masterVolume: SOUND_MASTER_VOLUME,
    effectsVolume: SOUND_SFX_VOLUME,
    musicVolume: SOUND_MUSIC_VOLUME,
  },
  profile: {
    playerName: null,
    ownerId: '',
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
 * Erzeugt eine neue dauerhafte Besitzeridentitaet.
 *
 * Sie muss nur lokal eindeutig genug sein, um zwei Spieler in einem Raum zu unterscheiden; sie
 * ist kein Sicherheitsmerkmal. Der Host prueft ohnehin jede Mutation selbst.
 */
function createStableOwnerId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (typeof random === 'string' && random.length > 0) return `owner-${random}`;
  return `owner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function buildDefaultPreferences(): LocalPreferences {
  return {
    ...DEFAULT_PREFERENCES,
    audio: { ...DEFAULT_PREFERENCES.audio },
    profile: { ...DEFAULT_PREFERENCES.profile, ownerId: createStableOwnerId() },
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

function sanitizeBalanceNullableNumber(value: unknown, allowNegative = false): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return allowNegative ? value : Math.max(0, value);
}

function sanitizeBalanceString(value: unknown, maxLength = 128): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) return null;
  return value;
}

function sanitizeBalanceItem(value: unknown): BalanceItemSnapshot | null {
  if (!isRecord(value)) return null;
  const slots = ['helmet', 'gloves', 'armor', 'boots'] as const;
  const rarities = ['white', 'blue', 'yellow'] as const;
  if (!slots.includes(value.slot as typeof slots[number])
    || !rarities.includes(value.rarity as typeof rarities[number])) return null;
  if (typeof value.itemLevel !== 'number' || !Number.isInteger(value.itemLevel) || value.itemLevel < 0
    || typeof value.baseValue !== 'number' || !Number.isFinite(value.baseValue)
    || !Array.isArray(value.affixes) || value.affixes.length > 32) return null;
  const affixes = value.affixes.map((raw) => {
    if (!isRecord(raw)) return null;
    const affixId = sanitizeBalanceString(raw.affixId);
    return affixId && typeof raw.value === 'number' && Number.isFinite(raw.value)
      ? { affixId, value: raw.value } : null;
  });
  if (affixes.some((affix) => affix === null)) return null;
  return {
    slot: value.slot as BalanceItemSnapshot['slot'],
    rarity: value.rarity as BalanceItemSnapshot['rarity'],
    itemLevel: value.itemLevel,
    baseValue: value.baseValue,
    affixes: affixes as BalanceItemSnapshot['affixes'],
  };
}

function sanitizeBalanceBuild(value: unknown): BalanceBuildSnapshot | null {
  if (!isRecord(value)) return null;
  const classId = value.classId === null ? null : (isCoopDefenseClassId(value.classId) ? value.classId : undefined);
  if (classId === undefined) return null;
  const upgradeProfile = value.upgradeProfile === null
    ? null
    : isRecord(value.upgradeProfile)
      ? (() => {
        const levels: Record<string, number> = {};
        for (const [id, level] of Object.entries(value.upgradeProfile)) {
          if (typeof level !== 'number' || !Number.isInteger(level) || level < 0 || level > 100) continue;
          levels[id] = level;
        }
        return levels;
      })()
      : undefined;
  if (upgradeProfile === undefined) return null;
  let items: BalanceItemSnapshot[] | null = null;
  if (value.items !== null) {
    if (!Array.isArray(value.items) || value.items.length > 16) return null;
    items = value.items.map(sanitizeBalanceItem).filter((item): item is BalanceItemSnapshot => item !== null);
    if (items.length !== value.items.length) return null;
  }
  const stringField = (key: string): string | null => value[key] === null ? null : sanitizeBalanceString(value[key]);
  for (const key of ['weapon1', 'weapon2', 'utility', 'ultimate']) {
    if (value[key] !== null && stringField(key) === null) return null;
  }
  const numericField = (key: string): number | null => sanitizeBalanceNullableNumber(value[key]);
  for (const key of ['coopXpBefore', 'levelBefore']) {
    if (value[key] !== null && numericField(key) === null) return null;
  }
  return {
    coopXpBefore: numericField('coopXpBefore'),
    levelBefore: numericField('levelBefore'),
    classId,
    weapon1: stringField('weapon1'),
    weapon2: stringField('weapon2'),
    utility: stringField('utility'),
    ultimate: stringField('ultimate'),
    upgradeProfile,
    items,
  };
}

function sanitizeBalanceFeedback(value: unknown): BalanceRoundFeedback | null {
  if (value === null) return null;
  if (!isRecord(value)
    || typeof value.difficulty !== 'number' || !Number.isInteger(value.difficulty) || value.difficulty < 1 || value.difficulty > 5
    || typeof value.pacing !== 'number' || !Number.isInteger(value.pacing) || value.pacing < 1 || value.pacing > 5
    || typeof value.comment !== 'string') return null;
  return {
    difficulty: value.difficulty as BalanceRoundFeedback['difficulty'],
    pacing: value.pacing as BalanceRoundFeedback['pacing'],
    comment: value.comment.slice(0, COOP_DEFENSE_BALANCE_MAX_COMMENT_LENGTH),
  };
}

function sanitizeBalanceRound(value: unknown): BalanceRoundRecord | null {
  if (!isRecord(value)
    || typeof value.roundEndedAt !== 'number' || !Number.isFinite(value.roundEndedAt) || value.roundEndedAt <= 0
    || typeof value.mapId !== 'string' || value.mapId.length === 0 || value.mapId.length > 64
    || (value.outcome !== 'victory' && value.outcome !== 'defeat')
    || typeof value.mapBalanceSignature !== 'string' || value.mapBalanceSignature.length === 0
    || typeof value.rulesetVersion !== 'number' || !Number.isInteger(value.rulesetVersion) || value.rulesetVersion < 0
    || !isRecord(value.build)) return null;
  const build = sanitizeBalanceBuild(value.build);
  if (!build) return null;
  const numericKeys = [
    'durationMs', 'sharedXp', 'frags', 'playerHp', 'playerMaxHp', 'playerHpPercent', 'armor',
    'ownMainBaseHp', 'ownMainBaseMaxHp', 'ownMainBaseHpPercent', 'hostileMainBaseHp',
    'hostileMainBaseMaxHp', 'hostileMainBaseHpPercent', 'survivalRemainingRespawns',
  ] as const;
  const numbers: Record<string, number | null> = {};
  for (const key of numericKeys) {
    if (value[key] !== null && sanitizeBalanceNullableNumber(value[key]) === null) return null;
    numbers[key] = sanitizeBalanceNullableNumber(value[key]);
  }
  const feedback = sanitizeBalanceFeedback(value.feedback);
  if (value.feedback !== null && feedback === null) return null;
  return {
    roundEndedAt: Math.floor(value.roundEndedAt),
    mapId: value.mapId,
    outcome: value.outcome,
    durationMs: numbers.durationMs,
    sharedXp: numbers.sharedXp,
    frags: numbers.frags,
    playerHp: numbers.playerHp,
    playerMaxHp: numbers.playerMaxHp,
    playerHpPercent: numbers.playerHpPercent,
    armor: numbers.armor,
    ownMainBaseHp: numbers.ownMainBaseHp,
    ownMainBaseMaxHp: numbers.ownMainBaseMaxHp,
    ownMainBaseHpPercent: numbers.ownMainBaseHpPercent,
    hostileMainBaseHp: numbers.hostileMainBaseHp,
    hostileMainBaseMaxHp: numbers.hostileMainBaseMaxHp,
    hostileMainBaseHpPercent: numbers.hostileMainBaseHpPercent,
    survivalRemainingRespawns: numbers.survivalRemainingRespawns,
    build,
    mapBalanceSignature: value.mapBalanceSignature,
    rulesetVersion: value.rulesetVersion,
    feedback,
  };
}

function sanitizeBalanceLabDocument(raw: unknown): CoopDefenseBalanceLabDocument | null {
  if (!isRecord(raw) || raw.schemaVersion !== COOP_DEFENSE_BALANCE_STORAGE_SCHEMA_VERSION
    || typeof raw.recordingEnabled !== 'boolean' || !Array.isArray(raw.rounds)) return null;
  const rounds: BalanceRoundRecord[] = [];
  const seen = new Set<number>();
  for (const value of raw.rounds.slice(0, COOP_DEFENSE_BALANCE_MAX_ROUNDS * 2)) {
    const round = sanitizeBalanceRound(value);
    if (!round || seen.has(round.roundEndedAt)) continue;
    seen.add(round.roundEndedAt);
    rounds.push(round);
  }
  rounds.sort((a, b) => a.roundEndedAt - b.roundEndedAt);
  return {
    schemaVersion: COOP_DEFENSE_BALANCE_STORAGE_SCHEMA_VERSION,
    recordingEnabled: raw.recordingEnabled,
    rounds: rounds.slice(-COOP_DEFENSE_BALANCE_MAX_ROUNDS),
  };
}

function cloneBalanceLabDocument(document: CoopDefenseBalanceLabDocument): CoopDefenseBalanceLabDocument {
  return sanitizeBalanceLabDocument(JSON.parse(JSON.stringify(document))) ?? {
    schemaVersion: COOP_DEFENSE_BALANCE_STORAGE_SCHEMA_VERSION,
    recordingEnabled: false,
    rounds: [],
  };
}

function readBalanceLabDocument(): CoopDefenseBalanceLabDocument {
  const storage = getLocalStorage();
  if (balanceLabCache && balanceLabCachedStorage === storage) return cloneBalanceLabDocument(balanceLabCache);
  let document: CoopDefenseBalanceLabDocument | null = null;
  const raw = safeRead(storage, COOP_DEFENSE_BALANCE_STORAGE_KEY);
  if (raw) {
    try { document = sanitizeBalanceLabDocument(JSON.parse(raw)); } catch { document = null; }
  }
  balanceLabCache = document ?? {
    schemaVersion: COOP_DEFENSE_BALANCE_STORAGE_SCHEMA_VERSION,
    recordingEnabled: false,
    rounds: [],
  };
  balanceLabCachedStorage = storage;
  return cloneBalanceLabDocument(balanceLabCache);
}

function writeBalanceLabDocument(document: CoopDefenseBalanceLabDocument): void {
  const sanitized = sanitizeBalanceLabDocument(document);
  if (!sanitized) return;
  const storage = getLocalStorage();
  safeWrite(storage, COOP_DEFENSE_BALANCE_STORAGE_KEY, sanitized);
  balanceLabCache = cloneBalanceLabDocument(sanitized);
  balanceLabCachedStorage = storage;
}

function sanitizeSettingsDocument(raw: unknown): LocalSettingsDocumentV2 | null {
  if (!isRecord(raw) || (raw.schemaVersion !== 1 && raw.schemaVersion !== LOCAL_SETTINGS_SCHEMA_VERSION)) return null;
  if (!isRecord(raw.audio) || !isRecord(raw.graphics)) return null;
  const { masterVolume, effectsVolume, musicVolume } = raw.audio;
  if (![masterVolume, effectsVolume, musicVolume].every((value) => (
    typeof value === 'number' && Number.isFinite(value)
  ))) return null;
  if (!isGraphicsQuality(raw.graphics.quality)) return null;
  return {
    schemaVersion: LOCAL_SETTINGS_SCHEMA_VERSION,
    locale: isLocale(raw.locale) ? raw.locale : resolveBrowserLocale(),
    audio: {
      masterVolume: clampAudioVolume(masterVolume as number),
      effectsVolume: clampAudioVolume(effectsVolume as number),
      musicVolume: clampAudioVolume(musicVolume as number),
    },
    graphics: { quality: raw.graphics.quality },
  };
}

/** Der Alpha-Schnitt behaelt ausschliesslich geraetenahe Audio-/Grafikeinstellungen. */
function readLegacySettings(raw: string | null): LocalSettingsDocumentV2 | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    const audio = isRecord(parsed.audio) ? parsed.audio : {};
    const graphics = isRecord(parsed.graphics) ? parsed.graphics : {};
    return {
      schemaVersion: LOCAL_SETTINGS_SCHEMA_VERSION,
      locale: isLocale(parsed.locale) ? parsed.locale : resolveBrowserLocale(),
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
      if (!COOP_DEFENSE_CONSTRUCTION_IDS.includes(value.id as ConstructionId)) return null;
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

function decodeProgressDocument(raw: unknown): Pick<LocalPreferences, 'profile' | 'loadout' | 'loadoutByClass' | 'progression'> | null {
  if (!isRecord(raw) || raw.schemaVersion !== LOCAL_PROGRESS_SCHEMA_VERSION) return null;
  const document = raw as unknown as LocalProgressDocument;
  if (!document || !isRecord(document.profile) || !isValidLoadoutRecord(document.loadout)
    || !isRecord(document.coopDefense)) return null;
  const coop = document.coopDefense as unknown as Record<string, unknown>;
  if ((document.profile.playerName !== null && typeof document.profile.playerName !== 'string')
    || !isStableOwnerId(document.profile.ownerId)
    || typeof coop.totalXp !== 'number' || !Number.isFinite(coop.totalXp)
    || (coop.lastProcessedRoundEndedAt !== null
      && (typeof coop.lastProcessedRoundEndedAt !== 'number' || !Number.isFinite(coop.lastProcessedRoundEndedAt)))
    || !Array.isArray(coop.completedBossMapIds)
    || !coop.completedBossMapIds.every((value) => typeof value === 'string' && value.trim().length > 0)
    || typeof coop.highestUnlockedMapId !== 'string'
    || typeof coop.classesUnlocked !== 'boolean'
    || typeof coop.itemsUnlocked !== 'boolean'
    || typeof coop.persistentBaseUnlocked !== 'boolean'
    || !isPersistentBaseAreaStage(coop.persistentBaseAreaStage)
    || !Array.isArray(coop.persistentBaseRewardUnlocks)
    || !Array.isArray(coop.items)
    || !isRecord(coop.equippedItemIds)
    || (coop.pendingItemRewards !== undefined && !Array.isArray(coop.pendingItemRewards))
    || (coop.pendingItemReward !== undefined
      && coop.pendingItemReward !== null && !isRecord(coop.pendingItemReward))
    || typeof coop.unseenItems !== 'boolean') return null;

  const loadout = sanitizeStoredLoadout(document.loadout);
  const unlockedClassIds = sanitizeStoredUnlockedClassIds(coop.unlockedClassIds);
  if (unlockedClassIds === null) return null;
  const persistentBase = sanitizePersistentBaseState(coop.persistentBase);
  if (!persistentBase) return null;
  const persistentBaseRewardUnlocks = sanitizePersistentBaseRewardIds(coop.persistentBaseRewardUnlocks);
  if (!persistentBaseRewardUnlocks) return null;
  const persistentBaseRewardState = sanitizePersistentBaseRewardState(coop.persistentBaseRewardState);
  if (!persistentBaseRewardState) return null;
  const ownerId = document.profile.ownerId;
  const personalBaseContribution = sanitizePersistentPlayerBaseContribution(coop.personalBaseContribution);
  // Der Beitrag gehoert genau diesem Profil. Eine fremde ownerId waere ein Save aus einem anderen
  // Profil; sein Besitz darf nicht still uebernommen werden.
  if (!personalBaseContribution || personalBaseContribution.ownerId !== ownerId) return null;
  if (persistentBaseRewardState.placements.some((placement) => (
    !persistentBaseRewardUnlocks.includes(placement.rewardId)
  )) || (persistentBaseRewardState.everPlacedRewardIds ?? []).some((rewardId) => (
    !persistentBaseRewardUnlocks.includes(rewardId)
  ))) return null;
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
  const pendingItemRewards = coop.pendingItemRewards === undefined
    ? []
    : sanitizeCoopDefensePendingItemRewards(coop.pendingItemRewards);
  if (!pendingItemRewards) return null;
  // Schema-2-Saves enthielten noch ein einzelnes Feld. Auch wenn ein Export versehentlich
  // beide Formen enthält, wird der Legacy-Eintrag verlustfrei ergänzt und nicht überschrieben.
  if (coop.pendingItemReward !== undefined && coop.pendingItemReward !== null) {
    const legacyReward = sanitizeCoopDefensePendingItemReward(coop.pendingItemReward);
    if (!legacyReward) return null;
    if (!pendingItemRewards.some((reward) => reward.roundEndedAt === legacyReward.roundEndedAt)) {
      pendingItemRewards.unshift(legacyReward);
    }
  }
  return {
    profile: {
      playerName: typeof document.profile.playerName === 'string'
        ? sanitizePlayerName(document.profile.playerName) || null : null,
      // V5 requires the stable owner identity so personal contributions cannot change owners.
      ownerId,
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
        persistentBaseUnlocked: coop.persistentBaseUnlocked,
        persistentBaseAreaStage: coop.persistentBaseAreaStage,
        persistentBaseRewardUnlocks,
        items,
        equippedItemIds,
        pendingItemRewards,
        unseenItems: coop.unseenItems && items.length > 0,
        persistentBase,
        personalBaseContribution: clonePersistentPlayerBaseContribution(personalBaseContribution),
        persistentBaseRewardState,
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

function encodeProgressDocument(preferences: LocalPreferences): LocalProgressDocument {
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
      persistentBaseUnlocked: progress.persistentBaseUnlocked,
      persistentBaseAreaStage: progress.persistentBaseAreaStage,
      persistentBaseRewardUnlocks: [...progress.persistentBaseRewardUnlocks],
      items: [...progress.items],
      equippedItemIds: { ...progress.equippedItemIds },
      pendingItemRewards: progress.pendingItemRewards.map((reward) => ({
        ...reward,
        offers: [...reward.offers],
      })),
      unseenItems: progress.unseenItems,
      persistentBase: clonePersistentBaseState(progress.persistentBase),
      personalBaseContribution: clonePersistentPlayerBaseContribution({
        ...progress.personalBaseContribution,
        ownerId: preferences.profile.ownerId,
      }),
      persistentBaseRewardState: clonePersistentBaseRewardState(progress.persistentBaseRewardState),
    },
  };
}

let preferencesCache: LocalPreferences | null = null;
let cachedStorage: Storage | null = null;
let balanceLabCache: CoopDefenseBalanceLabDocument | null = null;
let balanceLabCachedStorage: Storage | null = null;

function readPreferences(): LocalPreferences {
  const storage = getLocalStorage();
  if (preferencesCache && cachedStorage === storage) return preferencesCache;
  const defaults = buildDefaultPreferences();
  const rawSettings = safeRead(storage, LOCAL_SETTINGS_STORAGE_KEY);
  let settings: LocalSettingsDocumentV2 | null = null;
  if (rawSettings) {
    try { settings = sanitizeSettingsDocument(JSON.parse(rawSettings)); } catch { settings = null; }
  }
  settings ??= readLegacySettings(safeRead(storage, LEGACY_LOCAL_PREFERENCES_KEY));
  settings ??= {
    schemaVersion: LOCAL_SETTINGS_SCHEMA_VERSION,
    locale: resolveBrowserLocale(),
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
    locale: settings.locale,
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
  if (!previous || previous.locale !== next.locale || previous.audio !== next.audio || previous.graphics !== next.graphics) {
    safeWrite(storage, LOCAL_SETTINGS_STORAGE_KEY, {
      schemaVersion: LOCAL_SETTINGS_SCHEMA_VERSION,
      locale: next.locale,
      audio: next.audio,
      graphics: next.graphics,
    } satisfies LocalSettingsDocumentV2);
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
  balanceLabCache = null;
  balanceLabCachedStorage = null;
}

/** Separater, versionierter Debug-Speicher; nicht Teil des normalen Progress-Exports. */
export function getStoredCoopDefenseBalanceLab(): CoopDefenseBalanceLabDocument {
  return readBalanceLabDocument();
}

export function setStoredCoopDefenseBalanceRecordingEnabled(enabled: boolean): void {
  const current = readBalanceLabDocument();
  writeBalanceLabDocument({ ...current, recordingEnabled: enabled === true });
}

export function upsertStoredCoopDefenseBalanceRound(
  round: BalanceRoundRecord,
  staleRoundEndedAt: readonly number[] = [],
): void {
  const current = readBalanceLabDocument();
  const candidates = [...current.rounds.filter((entry) => entry.roundEndedAt !== round.roundEndedAt), round]
    .sort((a, b) => a.roundEndedAt - b.roundEndedAt)
  const staleIds = new Set(staleRoundEndedAt);
  while (candidates.length > COOP_DEFENSE_BALANCE_MAX_ROUNDS) {
    const staleIndex = candidates.findIndex((entry) => staleIds.has(entry.roundEndedAt));
    candidates.splice(staleIndex >= 0 ? staleIndex : 0, 1);
  }
  const rounds = candidates;
  writeBalanceLabDocument({ ...current, rounds });
}

export function updateStoredCoopDefenseBalanceFeedback(
  roundEndedAt: number,
  feedback: BalanceRoundFeedback | null,
): boolean {
  const current = readBalanceLabDocument();
  const index = current.rounds.findIndex((round) => round.roundEndedAt === roundEndedAt);
  if (index < 0) return false;
  const rounds = [...current.rounds];
  rounds[index] = { ...rounds[index], feedback };
  writeBalanceLabDocument({ ...current, rounds });
  return true;
}

export function deleteStoredCoopDefenseBalanceStaleRounds(roundEndedAt: readonly number[]): number {
  const ids = new Set(roundEndedAt);
  const current = readBalanceLabDocument();
  const next = current.rounds.filter((round) => !ids.has(round.roundEndedAt));
  if (next.length === current.rounds.length) return 0;
  writeBalanceLabDocument({ ...current, rounds: next });
  return current.rounds.length - next.length;
}

export function deleteAllStoredCoopDefenseBalanceRounds(): void {
  const current = readBalanceLabDocument();
  writeBalanceLabDocument({ ...current, rounds: [] });
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
    return { ok: false, messageKey: 'ui.lobby.saveInvalidJson' };
  }
  if (!isRecord(parsed) || parsed.format !== LOCAL_PROGRESS_EXPORT_FORMAT
    || parsed.formatVersion !== LOCAL_PROGRESS_EXPORT_VERSION
    || typeof parsed.exportedAt !== 'string' || !Number.isFinite(Date.parse(parsed.exportedAt))
    || !('progress' in parsed)) {
    return { ok: false, messageKey: 'ui.lobby.saveIncompatible' };
  }
  const decoded = decodeProgressDocument(parsed.progress);
  if (!decoded) {
    return { ok: false, messageKey: 'ui.lobby.saveInvalid' };
  }
  const current = readPreferences();
  writePreferences({ ...current, ...decoded });
  return { ok: true, messageKey: 'ui.lobby.saveImported' };
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
    return { ok: true, messageKey: 'ui.lobby.saveExported' };
  } catch {
    return { ok: false, messageKey: 'ui.lobby.saveExportFailed' };
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
          if (!file) return resolve({ ok: false, messageKey: 'ui.lobby.saveNoFile' });
          if (file.size > 5_000_000) return resolve({ ok: false, messageKey: 'ui.lobby.saveTooLarge' });
          resolve(importStoredGameProgressJson(await file.text()));
        } catch {
          resolve({ ok: false, messageKey: 'ui.lobby.saveReadFailed' });
        }
      };
      input.click();
    } catch {
      resolve({ ok: false, messageKey: 'ui.lobby.saveUnavailable' });
    }
  });
}

export function getStoredMasterVolume(): number {
  return readPreferences().audio.masterVolume;
}

/** The player language lives in the device settings document, never in campaign progress. */
export function getStoredLocale(): Locale | null {
  const preferences = readPreferences();
  return isLocale(preferences.locale) ? preferences.locale : null;
}

export function setStoredLocale(locale: Locale): void {
  if (!isLocale(locale)) return;
  updatePreferences((current) => ({ ...current, locale }));
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
    persistentBaseUnlocked: progress.persistentBaseUnlocked,
    persistentBaseAreaStage: progress.persistentBaseAreaStage,
    persistentBaseRewardUnlocks: [...progress.persistentBaseRewardUnlocks],
    unseenItems: progress.unseenItems,
    persistentBase: clonePersistentBaseState(progress.persistentBase),
    personalBaseContribution: clonePersistentPlayerBaseContribution(progress.personalBaseContribution),
    persistentBaseRewardState: clonePersistentBaseRewardState(progress.persistentBaseRewardState),
    ...cloneCoopDefenseItemState(progress),
  };
}

/** Stellt einen zuvor gelesenen, bereits validierten Fortschrittsstand atomar wieder her. */
export function restoreStoredCoopDefenseProgress(progress: CoopDefenseProgressPreferences): void {
  const rewardUnlocks = sanitizePersistentBaseRewardIds(progress.persistentBaseRewardUnlocks);
  const rewardState = sanitizePersistentBaseRewardState(progress.persistentBaseRewardState);
  if (!rewardUnlocks || !rewardState
    || rewardState.placements.some((placement) => !rewardUnlocks.includes(placement.rewardId))
    || (rewardState.everPlacedRewardIds ?? []).some((rewardId) => !rewardUnlocks.includes(rewardId))) return;
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
        persistentBase: clonePersistentBaseState(progress.persistentBase),
        personalBaseContribution: clonePersistentPlayerBaseContribution(progress.personalBaseContribution),
        persistentBaseRewardUnlocks: rewardUnlocks,
        persistentBaseRewardState: rewardState,
        ...cloneCoopDefenseItemState(progress),
      },
    },
  }));
}

/**
 * Die dauerhafte Besitzeridentitaet dieses Geraets.
 *
 * Sie entsteht beim ersten Lesen und aendert sich danach nie wieder. Jede persoenliche
 * Konstruktion haengt an ihr, unabhaengig von Raum, Peer-ID und Anzeigename.
 */
export function getStoredLocalOwnerId(): string {
  return readPreferences().profile.ownerId;
}

/** Der persoenliche Basisbeitrag dieses Spielers, immer unter der aktuellen Besitzeridentitaet. */
export function getStoredPersonalBaseContribution(): PersistentPlayerBaseContribution {
  const preferences = readPreferences();
  return clonePersistentPlayerBaseContribution({
    ...preferences.progression.coopDefense.personalBaseContribution,
    ownerId: preferences.profile.ownerId,
  });
}

/**
 * Schreibt den persoenlichen Beitrag.
 *
 * Bewusst nur fuer einen Beitrag mit der eigenen Besitzeridentitaet und mit monoton wachsender
 * Revision: Ein Client persistiert ausschliesslich, was der Host ihm bestaetigt hat, und eine
 * verspaetet eintreffende alte Bestaetigung darf einen neueren Stand nicht zurueckdrehen.
 */
export function setStoredPersonalBaseContribution(contribution: PersistentPlayerBaseContribution): boolean {
  const current = readPreferences();
  const ownerId = current.profile.ownerId;
  const sanitized = sanitizePersistentPlayerBaseContribution({ ...contribution, ownerId });
  if (!sanitized) return false;
  const stored = current.progression.coopDefense.personalBaseContribution;
  // Nur ein echt neuerer Stand wird geschrieben. Der regelmaessige Sync sieht dieselbe
  // Bestaetigung viele Frames lang; ohne diese Grenze schriebe er sie bei jedem Frame erneut.
  // Zugleich der Revisionsvertrag: Dieselbe Revision ersetzt nie einen bestehenden Inhalt.
  if (sanitized.revision <= stored.revision) return false;
  writePreferences({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: {
        ...current.progression.coopDefense,
        personalBaseContribution: sanitized,
      },
    },
  });
  return true;
}

/** Die semantische, persoenliche Ausbau-Stufe der persistenten Basis. */
export function getStoredPersistentBaseAreaStage(): PersistentBaseAreaStage {
  return readPreferences().progression.coopDefense.persistentBaseAreaStage;
}

/**
 * Setzt die Area-Stufe monoton. Ein Ruecksprung kann nur ueber den expliziten Charakter-Reset
 * erfolgen; Mapfortschritt oder fremde World-Daten koennen die persoenliche Freischaltung nicht
 * verkleinern.
 */
export function setStoredPersistentBaseAreaStage(areaStage: PersistentBaseAreaStage): boolean {
  if (!isPersistentBaseAreaStage(areaStage)) return false;
  const current = readPreferences();
  const progress = current.progression.coopDefense;
  if (areaStage <= progress.persistentBaseAreaStage) return false;
  writePreferences({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: { ...progress, persistentBaseAreaStage: areaStage },
    },
  });
  return true;
}

/** Typed persistence port used by the persistent-base domain; no caller needs LocalStorage. */
export function getStoredPersistentBaseState(): PersistentBaseState {
  return clonePersistentBaseState(readPreferences().progression.coopDefense.persistentBase);
}

/** Atomically replaces only the committed persistent-base value inside the V5 progress document. */
export function setStoredPersistentBaseState(state: PersistentBaseState): void {
  const sanitized = sanitizePersistentBaseState(state);
  if (!sanitized) return;
  updatePreferences((current) => ({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: {
        ...current.progression.coopDefense,
        persistentBase: sanitized,
      },
    },
  }));
}

/** Personal reward ownership; this is deliberately independent of the host placement document. */
export function getStoredPersistentBaseRewardUnlocks(): PersistentBaseRewardId[] {
  return [...readPreferences().progression.coopDefense.persistentBaseRewardUnlocks];
}

/** Adds only new, known reward IDs and leaves the cumulative unlock set idempotent. */
export function grantStoredPersistentBaseRewards(
  rewardIds: readonly PersistentBaseRewardId[],
): readonly PersistentBaseRewardId[] {
  if (!Array.isArray(rewardIds) || rewardIds.some((rewardId) => !isPersistentBaseRewardId(rewardId))) return [];
  const normalized = [...new Set(rewardIds)] as PersistentBaseRewardId[];
  const current = readPreferences();
  const stored = current.progression.coopDefense.persistentBaseRewardUnlocks;
  const newlyGranted = normalized.filter((rewardId) => !stored.includes(rewardId));
  if (newlyGranted.length === 0) return [];
  writePreferences({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: {
        ...current.progression.coopDefense,
        persistentBaseRewardUnlocks: [...stored, ...newlyGranted],
      },
    },
  });
  return newlyGranted;
}

/** Host-owned placement state; guests must never replace it with their personal unlock list. */
export function getStoredPersistentBaseRewardState(): PersistentBaseRewardState {
  return clonePersistentBaseRewardState(readPreferences().progression.coopDefense.persistentBaseRewardState);
}

/** Stores only a valid, unlock-compatible, monotone host placement revision. */
export function setStoredPersistentBaseRewardState(state: PersistentBaseRewardState): boolean {
  const sanitized = sanitizePersistentBaseRewardState(state);
  if (!sanitized) return false;
  const current = readPreferences();
  const progress = current.progression.coopDefense;
  if (sanitized.placements.some((placement) => (
    !progress.persistentBaseRewardUnlocks.includes(placement.rewardId)
  )) || (sanitized.everPlacedRewardIds ?? []).some((rewardId) => (
    !progress.persistentBaseRewardUnlocks.includes(rewardId)
  ))) return false;
  if (sanitized.revision <= progress.persistentBaseRewardState.revision) return false;
  writePreferences({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: {
        ...progress,
        persistentBaseRewardState: sanitized,
      },
    },
  });
  return true;
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
        persistentBase: clonePersistentBaseState(DEFAULT_PERSISTENT_BASE_STATE),
        persistentBaseRewardUnlocks: [],
        persistentBaseRewardState: clonePersistentBaseRewardState(DEFAULT_PERSISTENT_BASE_REWARD_STATE),
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

  const profilesByClass = storedProgress.unlockedClassIds.length === 0
    ? mirrorDefaultProfileToClasses(
      storedProgress.defaultProfile,
      storedProgress.completedBossMapIds.length,
    )
    : { ...storedProgress.profilesByClass };
  if (storedProgress.unlockedClassIds.length > 0) {
    for (const classId of targetClassIds) {
      if (storedProgress.unlockedClassIds.includes(classId)) continue;
      profilesByClass[classId] = constrainCoopDefenseUpgradeProfileToBossPoints(
        buildDefaultCoopDefenseUpgradeProfile(classId),
        storedProgress.completedBossMapIds.length,
        classId,
      );
    }
  }

  writePreferences({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: {
        ...storedProgress,
        classesUnlocked: true,
        unlockedClassIds: nextClassIds,
        profilesByClass,
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

/**
 * Analog zur Klassenfreischaltung: genau ein Map-Sieg oeffnet das System dauerhaft.
 *
 * Wenn beim Freischaltsieg bereits das erste Angebot feststeht, wird beides in derselben
 * Progress-Schreiboperation persistiert. So kann der Unlock nicht ohne das zugehoerige Angebot
 * sichtbar werden.
 */
export function unlockStoredCoopDefenseItemsAfterVictory(
  completedMapId: string,
  firstReward?: CoopDefensePendingItemReward,
): boolean {
  if (completedMapId.trim() !== COOP_DEFENSE_ITEMS_UNLOCK_AFTER_MAP_ID) return false;

  const current = readPreferences();
  const progress = current.progression.coopDefense;
  const hasReward = firstReward !== undefined
    && progress.pendingItemRewards.some((entry) => entry.roundEndedAt === firstReward.roundEndedAt);
  const nextPendingItemRewards = firstReward !== undefined && !hasReward
    ? [...progress.pendingItemRewards, clonePendingItemReward(firstReward)]
    : progress.pendingItemRewards;
  const itemsWereAlreadyUnlocked = progress.itemsUnlocked;
  const rewardWasAdded = nextPendingItemRewards.length !== progress.pendingItemRewards.length;
  if (itemsWereAlreadyUnlocked && !rewardWasAdded) return false;

  writePreferences({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: {
        ...progress,
        itemsUnlocked: true,
        pendingItemRewards: nextPendingItemRewards,
      },
    },
  });
  return !itemsWereAlreadyUnlocked;
}

// -- Persistente Basis: Entitlement -----------------------------------------

export function getStoredPersistentBaseUnlocked(): boolean {
  return readPreferences().progression.coopDefense.persistentBaseUnlocked;
}

/** Gibt zurueck, ob sich der Freischaltstand tatsaechlich geaendert hat. */
export function setStoredPersistentBaseUnlocked(unlocked: boolean): boolean {
  const current = readPreferences();
  if (current.progression.coopDefense.persistentBaseUnlocked === unlocked) return false;
  writePreferences({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: { ...current.progression.coopDefense, persistentBaseUnlocked: unlocked },
    },
  });
  return true;
}

/** Analog zur Item-Freischaltung: genau ein Map-Sieg vergibt das Entitlement dauerhaft. */
export function unlockStoredPersistentBaseAfterVictory(completedMapId: string): boolean {
  return completedMapId.trim() === PERSISTENT_BASE_UNLOCK_AFTER_MAP_ID
    && setStoredPersistentBaseUnlocked(true);
}

/** Analog zur Klassenfreischaltung: Map 10 vergibt Area Stage 1 dauerhaft. */
export function unlockStoredPersistentBaseAreaStageAfterVictory(completedMapId: string): boolean {
  return completedMapId.trim() === PERSISTENT_BASE_AREA_STAGE_UNLOCK_AFTER_MAP_ID
    && setStoredPersistentBaseAreaStage(1);
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

function clonePendingItemReward(reward: CoopDefensePendingItemReward): CoopDefensePendingItemReward {
  return { ...reward, offers: [...reward.offers] };
}

/** Gibt die offene FIFO-Queue als defensive Kopie zurueck. */
export function getStoredPendingCoopDefenseItemRewards(): CoopDefensePendingItemReward[] {
  return readPreferences().progression.coopDefense.pendingItemRewards.map(clonePendingItemReward);
}

/**
 * Kompatibilitaets-Getter fuer alte Aufrufer: liefert den aeltesten offenen Reward.
 * Neue Flows sollen die pluralische Queue-API verwenden.
 */
export function getStoredPendingCoopDefenseItemReward(): CoopDefensePendingItemReward | null {
  return getStoredPendingCoopDefenseItemRewards()[0] ?? null;
}

/**
 * Haengt ein Angebot an. Ein bereits offenes Angebot derselben Runde bleibt bestehen, damit eine
 * wiederholte Auswertung derselben Runde die bereits gezeigten Items nicht austauscht.
 */
export function setStoredPendingCoopDefenseItemReward(reward: CoopDefensePendingItemReward): boolean {
  const current = readPreferences();
  const progress = current.progression.coopDefense;
  if (progress.pendingItemRewards.some((entry) => entry.roundEndedAt === reward.roundEndedAt)) return false;

  writePreferences({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: {
        ...progress,
        pendingItemRewards: [
          ...progress.pendingItemRewards,
          clonePendingItemReward(reward),
        ],
      },
    },
  });
  return true;
}

/** Entfernt alle offenen Rewards; fuer einen einzelnen Claim wird die Claim-API verwendet. */
export function clearStoredPendingCoopDefenseItemRewards(): void {
  updatePreferences((current) => ({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: { ...current.progression.coopDefense, pendingItemRewards: [] },
    },
  }));
}

/** Legacy-Alias: bewusst weiterhin "alles leeren" fuer bestehende Reset-/Test-Aufrufer. */
export function clearStoredPendingCoopDefenseItemReward(): void {
  clearStoredPendingCoopDefenseItemRewards();
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
  roundEndedAt: number,
  offerUid: string,
  salvageUid?: string,
  action?: CoopDefenseItemRewardAction,
): CoopDefenseItemRewardClaim | null;
/** @deprecated Nur fuer alte Aufrufer; bei mehreren gleichen offerUid ist der Claim bewusst ungueltig. */
export function claimStoredPendingCoopDefenseItemReward(
  offerUid: string,
  salvageUid?: string,
  action?: CoopDefenseItemRewardAction,
): CoopDefenseItemRewardClaim | null;
export function claimStoredPendingCoopDefenseItemReward(
  roundEndedAtOrOfferUid: number | string,
  offerUidOrSalvageUid?: string,
  salvageUidOrAction?: string | CoopDefenseItemRewardAction,
  action: CoopDefenseItemRewardAction = 'take',
): CoopDefenseItemRewardClaim | null {
  const current = readPreferences();
  const progress = current.progression.coopDefense;
  const isExplicitRewardClaim = typeof roundEndedAtOrOfferUid === 'number';
  const requestedRoundEndedAt = isExplicitRewardClaim ? roundEndedAtOrOfferUid : null;
  const offerUid = isExplicitRewardClaim ? offerUidOrSalvageUid : roundEndedAtOrOfferUid;
  if (!offerUid) return null;

  const salvageUid = isExplicitRewardClaim
    ? (salvageUidOrAction as string | undefined)
    : offerUidOrSalvageUid;
  const resolvedAction = isExplicitRewardClaim
    ? action
    : (salvageUidOrAction as CoopDefenseItemRewardAction | undefined) ?? 'take';
  const matchingRewards = progress.pendingItemRewards.filter((reward) => (
    (requestedRoundEndedAt === null || reward.roundEndedAt === requestedRoundEndedAt)
      && reward.offers.some((entry) => entry.uid === offerUid)
  ));
  // Der alte offerUid-only Aufruf darf niemals bei doppelten IDs willkuerlich einen Reward
  // entfernen. Der aktuelle Flow gibt immer roundEndedAt + offerUid an.
  if (matchingRewards.length !== 1) return null;
  const pendingReward = matchingRewards[0];
  const offer = pendingReward.offers.find((entry) => entry.uid === offerUid);
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
          pendingItemRewards: progress.pendingItemRewards.filter(
            (reward) => reward !== pendingReward,
          ),
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
  const equippedItemIds = slotIsEmpty || resolvedAction === 'equip'
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
