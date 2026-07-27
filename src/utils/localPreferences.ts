import { SOUND_MASTER_VOLUME, SOUND_MUSIC_VOLUME, SOUND_SFX_VOLUME } from '../config';
import {
  COOP_DEFENSE_CLASS_IDS,
  DEFAULT_COOP_DEFENSE_CLASS_ID,
  sanitizeCoopDefenseClassId,
} from '../config/coopDefenseClasses';
import type { CoopDefenseClassId, CoopDefenseUpgradeProfile, LoadoutSlot } from '../types';
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
  maxHighestUnlockedCoopDefenseMapId,
  sanitizeHighestUnlockedCoopDefenseMapId,
} from '../config/coopDefenseMapUnlocks';
import { sanitizePlayerName } from './playerName';
import { isGraphicsQuality, type GraphicsQuality } from '../graphics/GraphicsQuality';

const LOCAL_PREFERENCES_KEY = 'fragdachse_local_preferences';
const LOCAL_PREFERENCES_VERSION = 14;
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
  selectedClassId: CoopDefenseClassId;
  profilesByClass: Record<CoopDefenseClassId, CoopDefenseUpgradeProfile>;
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

interface LocalPreferencesV14 {
  version: 14;
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

type LocalPreferences = LocalPreferencesV14;

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
      profilesByClass?: unknown;
      selectedClassId?: unknown;
    };
  };
}

const DEFAULT_COOP_DEFENSE_PROGRESS: CoopDefenseProgressPreferences = {
  upgradeTreeVersion: 13,
  totalXp: 0,
  lastProcessedRoundEndedAt: null,
  completedBossMapIds: [],
  highestUnlockedMapId: INITIAL_HIGHEST_UNLOCKED_COOP_DEFENSE_MAP_ID,
  selectedClassId: DEFAULT_COOP_DEFENSE_CLASS_ID,
  profilesByClass: {
    dachs_nukem: buildDefaultCoopDefenseUpgradeProfile('dachs_nukem'),
    dachs_of_steel: buildDefaultCoopDefenseUpgradeProfile('dachs_of_steel'),
    inspector_gadachs: buildDefaultCoopDefenseUpgradeProfile('inspector_gadachs'),
  },
};

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
        profilesByClass: cloneProfilesByClass(DEFAULT_COOP_DEFENSE_PROGRESS.profilesByClass),
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
    const selectedClassId = sanitizeCoopDefenseClassId(
      parsed.progression?.coopDefense?.selectedClassId,
    );
    const rawProfiles = parsed.progression?.coopDefense?.profilesByClass;
    const storedProfiles = (rawProfiles && typeof rawProfiles === 'object')
      ? rawProfiles as Partial<Record<CoopDefenseClassId, unknown>>
      : {};
    const legacyProfile = parsed.progression?.coopDefense?.profile;
    const profilesByClass = {} as Record<CoopDefenseClassId, CoopDefenseUpgradeProfile>;

    for (const classId of COOP_DEFENSE_CLASS_IDS) {
      const rawProfile = storedProfiles[classId]
        ?? (classId === 'inspector_gadachs' ? undefined : legacyProfile);
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
          highestUnlockedMapId: resolveStoredHighestUnlockedMapId(
            parsed.progression?.coopDefense?.highestUnlockedMapId,
            completedBossMapIds,
          ),
          selectedClassId,
          profilesByClass,
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
    selectedClassId: progress.selectedClassId,
    profilesByClass: cloneProfilesByClass(progress.profilesByClass),
  };
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
        selectedClassId: sanitizeCoopDefenseClassId(classId),
      },
    },
  }));
}

export function getStoredCoopDefenseUpgradeProfile(
  classId?: CoopDefenseClassId,
): CoopDefenseUpgradeProfile {
  const progress = readPreferences().progression.coopDefense;
  const resolvedClassId = classId ?? progress.selectedClassId;
  return cloneCoopDefenseUpgradeProfile(progress.profilesByClass[resolvedClassId], resolvedClassId);
}

export function setStoredCoopDefenseUpgradeProfile(
  profile: CoopDefenseUpgradeProfile,
  classId?: CoopDefenseClassId,
): void {
  updatePreferences((current) => ({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: {
        ...current.progression.coopDefense,
        profilesByClass: {
          ...current.progression.coopDefense.profilesByClass,
          [classId ?? current.progression.coopDefense.selectedClassId]:
            constrainCoopDefenseUpgradeProfileToBossPoints(
              sanitizeCoopDefenseUpgradeProfile(
                profile,
                classId ?? current.progression.coopDefense.selectedClassId,
              ),
              current.progression.coopDefense.completedBossMapIds.length,
              classId ?? current.progression.coopDefense.selectedClassId,
            ),
        },
      },
    },
  }));
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

    return {
      ...current,
      progression: {
        ...current.progression,
        coopDefense: {
          ...storedProgress,
          totalXp: nextTotalXp,
          completedBossMapIds,
          highestUnlockedMapId: nextHighestUnlockedMapId,
          profilesByClass: Object.fromEntries(
            COOP_DEFENSE_CLASS_IDS.map((classId) => [
              classId,
              constrainCoopDefenseUpgradeProfileToBossPoints(
                storedProgress.profilesByClass[classId],
                nextBossPointCount,
                classId,
              ),
            ]),
          ) as Record<CoopDefenseClassId, CoopDefenseUpgradeProfile>,
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
