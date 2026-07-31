import { SOUND_MASTER_VOLUME, SOUND_MUSIC_VOLUME, SOUND_SFX_VOLUME } from '../config';
import {
  COOP_DEFENSE_CLASS_IDS,
  COOP_DEFENSE_CLASS_UNLOCK_AFTER_MAP_ID,
  DEFAULT_COOP_DEFENSE_CLASS_ID,
  sanitizeCoopDefenseClassId,
} from '../config/coopDefenseClasses';
import type {
  CoopDefenseClassId,
  CoopDefenseItem,
  CoopDefenseItemSlot,
  CoopDefensePendingItemReward,
  CoopDefenseUpgradeProfile,
  LoadoutSlot,
} from '../types';
import { COOP_DEFENSE_ITEMS_UNLOCK_AFTER_MAP_ID } from '../config/coopDefenseItems';
import {
  addCoopDefenseItem,
  getCoopDefenseItemSalvageXp,
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

const LOCAL_PREFERENCES_KEY = 'fragdachse_local_preferences';
const LOCAL_PREFERENCES_VERSION = 17;
const CHEAT_BOSS_MAP_ID_PREFIX = '__cheat_boss_point_';

interface LocalPreferencesV2 {
  version: 2;
  audio: {
    masterVolume: number;
    effectsVolume: number;
    musicVolume: number;
  };
  profile: {
    playerName: string | null;
  };
  loadout: Partial<Record<LoadoutSlot, string>>;
}

export interface CoopDefenseProgressPreferences {
  upgradeTreeVersion: number;
  totalXp: number;
  lastProcessedRoundEndedAt: number | null;
  completedBossMapIds: string[];
  /** Hoechste freigeschaltete Map der linearen Kampagne; alles davor ist ebenfalls offen. */
  highestUnlockedMapId: string;
  /** Bis Map 5 fuehrt die unsichtbare, bonuslose Default-Klasse den gemeinsamen Fortschritt. */
  classesUnlocked: boolean;
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

interface LocalPreferencesV3 {
  version: 3;
  audio: {
    masterVolume: number;
    effectsVolume: number;
    musicVolume: number;
  };
  profile: {
    playerName: string | null;
  };
  loadout: Partial<Record<LoadoutSlot, string>>;
  progression: {
    coopDefense: CoopDefenseProgressPreferences;
  };
}

interface LocalPreferencesV17 {
  version: 17;
  audio: {
    masterVolume: number;
    effectsVolume: number;
    musicVolume: number;
  };
  profile: {
    playerName: string | null;
  };
  loadout: Partial<Record<LoadoutSlot, string>>;
  graphics: {
    quality: GraphicsQuality;
  };
  progression: {
    coopDefense: CoopDefenseProgressPreferences;
  };
}

type LocalPreferences = LocalPreferencesV17;

interface ParsedLocalPreferences {
  audio?: Partial<LocalPreferences['audio']>;
  profile?: Partial<LocalPreferences['profile']>;
  loadout?: Partial<Record<LoadoutSlot, unknown>>;
  graphics?: {
    quality?: unknown;
  };
  progression?: {
    coopDefense?: Partial<CoopDefenseProgressPreferences> & {
      profile?: unknown;
      defaultProfile?: unknown;
      profilesByClass?: unknown;
      selectedClassId?: unknown;
      classesUnlocked?: unknown;
      itemsUnlocked?: unknown;
      items?: unknown;
      equippedItemIds?: unknown;
      pendingItemReward?: unknown;
      unseenItems?: unknown;
    };
  };
}

const DEFAULT_COOP_DEFENSE_PROGRESS: CoopDefenseProgressPreferences = {
  upgradeTreeVersion: 13,
  totalXp: 0,
  lastProcessedRoundEndedAt: null,
  completedBossMapIds: [],
  highestUnlockedMapId: INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID,
  classesUnlocked: false,
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
  version: LOCAL_PREFERENCES_VERSION,
  audio: {
    masterVolume: SOUND_MASTER_VOLUME,
    effectsVolume: SOUND_SFX_VOLUME,
    musicVolume: SOUND_MUSIC_VOLUME,
  },
  profile: {
    playerName: null,
  },
  loadout: {},
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
    return window.localStorage;
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
function resolveStoredHighestUnlockedMapId(
  storedMapId: unknown,
  completedBossMapIds: readonly string[],
): string {
  if (storedMapId !== undefined) return sanitizeHighestUnlockedCoopDefenseMapId(storedMapId);
  return completedBossMapIds.reduce(
    (highestMapId, completedMapId) => maxHighestUnlockedCoopDefenseMapId(
      highestMapId,
      getCoopDefenseMapUnlockedByVictoryOn(completedMapId) ?? completedMapId,
    ),
    INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID,
  );
}

function buildDefaultPreferences(): LocalPreferences {
  return {
    ...DEFAULT_PREFERENCES,
    audio: { ...DEFAULT_PREFERENCES.audio },
    profile: { ...DEFAULT_PREFERENCES.profile },
    loadout: {},
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

function parsePreferences(raw: string | null): LocalPreferences {
  if (!raw) return buildDefaultPreferences();

  try {
    const parsed = JSON.parse(raw) as ParsedLocalPreferences;
    const loadout = parsed.loadout && typeof parsed.loadout === 'object'
      ? parsed.loadout
      : {};
    const playerName = typeof parsed.profile?.playerName === 'string'
      ? sanitizePlayerName(parsed.profile.playerName) || null
      : null;
    const masterVolume = typeof parsed.audio?.masterVolume === 'number'
      ? clampAudioVolume(parsed.audio.masterVolume)
      : SOUND_MASTER_VOLUME;
    const effectsVolume = typeof parsed.audio?.effectsVolume === 'number'
      ? clampAudioVolume(parsed.audio.effectsVolume)
      : SOUND_SFX_VOLUME;
    const musicVolume = typeof parsed.audio?.musicVolume === 'number'
      ? clampAudioVolume(parsed.audio.musicVolume)
      : SOUND_MUSIC_VOLUME;
    const totalXp = sanitizeStoredXp(parsed.progression?.coopDefense?.totalXp);
    const lastProcessedRoundEndedAt = sanitizeStoredRoundEndedAt(parsed.progression?.coopDefense?.lastProcessedRoundEndedAt);
    const completedBossMapIds = sanitizeCompletedBossMapIds(parsed.progression?.coopDefense?.completedBossMapIds);
    const sourceTreeVersion = sanitizeStoredXp(parsed.progression?.coopDefense?.upgradeTreeVersion);
    const rawCoopProgress = parsed.progression?.coopDefense;
    const highestUnlockedMapId = resolveStoredHighestUnlockedMapId(
      rawCoopProgress?.highestUnlockedMapId,
      completedBossMapIds,
    );
    const selectedClassId = sanitizeCoopDefenseClassId(rawCoopProgress?.selectedClassId);
    const rawProfiles = parsed.progression?.coopDefense?.profilesByClass;
    const storedProfiles = (rawProfiles && typeof rawProfiles === 'object')
      ? rawProfiles as Partial<Record<CoopDefenseClassId, unknown>>
      : {};
    const legacyProfile = parsed.progression?.coopDefense?.profile;
    const hasStoredClassState = rawCoopProgress?.selectedClassId !== undefined
      || COOP_DEFENSE_CLASS_IDS.some((classId) => storedProfiles[classId] !== undefined);
    const classesUnlocked = typeof rawCoopProgress?.classesUnlocked === 'boolean'
      ? rawCoopProgress.classesUnlocked
      : hasStoredClassState
        || completedBossMapIds.includes(COOP_DEFENSE_CLASS_UNLOCK_AFTER_MAP_ID);
    const rawDefaultProfile = rawCoopProgress?.defaultProfile
      ?? legacyProfile
      ?? storedProfiles[selectedClassId];
    const defaultProfile = constrainCoopDefenseUpgradeProfileToBossPoints(
      sanitizeCoopDefenseUpgradeProfile(
        rawDefaultProfile ?? buildDefaultCoopDefenseUpgradeProfile(DEFAULT_COOP_DEFENSE_CLASS_ID),
        DEFAULT_COOP_DEFENSE_CLASS_ID,
      ),
      completedBossMapIds.length,
      DEFAULT_COOP_DEFENSE_CLASS_ID,
    );
    // Die Slot-Zuordnung wird zweistufig gelesen: strukturell, damit das ausgeruestete Teil vom
    // Kategorielimit ausgenommen bleibt, und danach gegen die fertige Liste geprueft.
    const equippedItemIdCandidates = readCoopDefenseEquippedItemIdCandidates(rawCoopProgress?.equippedItemIds);
    const storedItems = sanitizeCoopDefenseItems(rawCoopProgress?.items, equippedItemIdCandidates);
    const equippedItemIds = sanitizeCoopDefenseEquippedItemIds(equippedItemIdCandidates, storedItems);
    const itemsUnlocked = rawCoopProgress?.itemsUnlocked === true
      || isCoopDefenseMapUnlocked('11', highestUnlockedMapId);
    const pendingItemReward = sanitizeCoopDefensePendingItemReward(rawCoopProgress?.pendingItemReward);
    // Nur ein tatsaechlich vorhandenes Teil kann ungesehen sein; sonst leuchtet der Button leer.
    const unseenItems = rawCoopProgress?.unseenItems === true && storedItems.length > 0;
    const profilesByClass = {} as Record<CoopDefenseClassId, CoopDefenseUpgradeProfile>;

    for (const classId of COOP_DEFENSE_CLASS_IDS) {
      const rawProfile = classesUnlocked
        ? (storedProfiles[classId] ?? defaultProfile)
        : defaultProfile;
      const migratedProfile = cloneCoopDefenseUpgradeProfile(
        rawProfile === undefined
          ? buildDefaultCoopDefenseUpgradeProfile(classId)
          : sanitizeCoopDefenseUpgradeProfile(rawProfile, classId),
        classId,
      );
      if (sourceTreeVersion < 2) {
        for (const [upgradeId, definition] of Object.entries(COOP_DEFENSE_UPGRADE_DEFINITIONS)) {
          if (definition.bossPointCostPerLevel <= 0 || upgradeId === 'smoke_grenade_storm') continue;
          const state = migratedProfile.upgrades[upgradeId];
          if (state) state.level = 0;
        }
      }
      profilesByClass[classId] = constrainCoopDefenseUpgradeProfileToBossPoints(
        sanitizeCoopDefenseUpgradeProfile(migratedProfile, classId),
        completedBossMapIds.length,
        classId,
      );
    }

    return {
      version: LOCAL_PREFERENCES_VERSION,
      audio: { masterVolume, effectsVolume, musicVolume },
      profile: { playerName },
      loadout: {
        weapon1: typeof loadout.weapon1 === 'string' ? loadout.weapon1 : undefined,
        weapon2: typeof loadout.weapon2 === 'string' ? loadout.weapon2 : undefined,
        utility: typeof loadout.utility === 'string' ? loadout.utility : undefined,
        ultimate: typeof loadout.ultimate === 'string' ? loadout.ultimate : undefined,
      },
      graphics: {
        quality: isGraphicsQuality(parsed.graphics?.quality) ? parsed.graphics.quality : 'high',
      },
      progression: {
        coopDefense: {
          upgradeTreeVersion: 13,
          totalXp,
          lastProcessedRoundEndedAt,
          completedBossMapIds,
          highestUnlockedMapId,
          classesUnlocked,
          defaultProfile,
          selectedClassId: classesUnlocked ? selectedClassId : DEFAULT_COOP_DEFENSE_CLASS_ID,
          profilesByClass,
          itemsUnlocked,
          items: storedItems,
          equippedItemIds,
          pendingItemReward,
          unseenItems,
        },
      },
    };
  } catch {
    return buildDefaultPreferences();
  }
}

function readPreferences(): LocalPreferences {
  return parsePreferences(getLocalStorage()?.getItem(LOCAL_PREFERENCES_KEY) ?? null);
}

function writePreferences(next: LocalPreferences): void {
  getLocalStorage()?.setItem(LOCAL_PREFERENCES_KEY, JSON.stringify(next));
}

function updatePreferences(mutator: (current: LocalPreferences) => LocalPreferences): void {
  writePreferences(mutator(readPreferences()));
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

export function getStoredCoopDefenseProgress(): CoopDefenseProgressPreferences {
  const progress = readPreferences().progression.coopDefense;
  return {
    upgradeTreeVersion: progress.upgradeTreeVersion,
    totalXp: progress.totalXp,
    lastProcessedRoundEndedAt: progress.lastProcessedRoundEndedAt,
    completedBossMapIds: [...progress.completedBossMapIds],
    highestUnlockedMapId: progress.highestUnlockedMapId,
    classesUnlocked: progress.classesUnlocked,
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
        selectedClassId: current.progression.coopDefense.classesUnlocked
          ? sanitizeCoopDefenseClassId(classId)
          : DEFAULT_COOP_DEFENSE_CLASS_ID,
      },
    },
  }));
}

export function getStoredCoopDefenseClassesUnlocked(): boolean {
  return readPreferences().progression.coopDefense.classesUnlocked;
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
  writePreferences({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: {
        ...storedProgress,
        classesUnlocked: unlocked,
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
  return completedMapId.trim() === COOP_DEFENSE_CLASS_UNLOCK_AFTER_MAP_ID
    && setStoredCoopDefenseClassesUnlocked(true);
}

export function getStoredCoopDefenseUpgradeProfile(
  classId?: CoopDefenseClassId,
): CoopDefenseUpgradeProfile {
  const progress = readPreferences().progression.coopDefense;
  if (!progress.classesUnlocked && classId === undefined) {
    return cloneCoopDefenseUpgradeProfile(progress.defaultProfile, DEFAULT_COOP_DEFENSE_CLASS_ID);
  }
  const resolvedClassId = classId ?? progress.selectedClassId;
  return cloneCoopDefenseUpgradeProfile(progress.profilesByClass[resolvedClassId], resolvedClassId);
}

export function setStoredCoopDefenseUpgradeProfile(
  profile: CoopDefenseUpgradeProfile,
  classId?: CoopDefenseClassId,
): void {
  updatePreferences((current) => {
    const storedProgress = current.progression.coopDefense;
    if (!storedProgress.classesUnlocked) {
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
 * `salvageUid === offerUid` zerlegt das Angebot selbst.
 */
export function claimStoredPendingCoopDefenseItemReward(
  offerUid: string,
  salvageUid?: string,
): CoopDefenseItemRewardClaim | null {
  const current = readPreferences();
  const progress = current.progression.coopDefense;
  const offer = progress.pendingItemReward?.offers.find((entry) => entry.uid === offerUid);
  if (!offer) return null;

  const commit = (
    items: CoopDefenseItem[],
    salvagedXp: number,
    acquired: CoopDefenseItem | null,
  ): CoopDefenseItemRewardClaim => {
    writePreferences({
      ...current,
      progression: {
        ...current.progression,
        coopDefense: {
          ...progress,
          totalXp: sanitizeStoredXp(progress.totalXp + salvagedXp),
          items,
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
  if (isCoopDefenseStashFull(remaining, progress.equippedItemIds, offer.slot)) return null;

  const salvagedXp = salvaged ? getCoopDefenseItemSalvageXp(salvaged) : 0;
  const items = addCoopDefenseItem(remaining, offer);
  return commit(items, salvagedXp, items[items.length - 1]);
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
