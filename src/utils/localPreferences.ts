import { SOUND_MASTER_VOLUME, SOUND_MUSIC_VOLUME, SOUND_SFX_VOLUME } from '../config';
import type { CoopDefenseUpgradeProfile, LoadoutSlot } from '../types';
import {
  buildDefaultCoopDefenseUpgradeProfile,
  cloneCoopDefenseUpgradeProfile,
  constrainCoopDefenseUpgradeProfileToBossPoints,
  COOP_DEFENSE_UPGRADE_DEFINITIONS,
  sanitizeCoopDefenseUpgradeProfile,
} from './coopDefenseUpgrades';
import { sanitizePlayerName } from './playerName';
import { isGraphicsQuality, type GraphicsQuality } from '../graphics/GraphicsQuality';

const LOCAL_PREFERENCES_KEY = 'fragdachse_local_preferences';
const LOCAL_PREFERENCES_VERSION = 13;
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
  profile: CoopDefenseUpgradeProfile;
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

interface LocalPreferencesV13 {
  version: 13;
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

type LocalPreferences = LocalPreferencesV13;

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
    };
  };
}

const DEFAULT_COOP_DEFENSE_PROGRESS: CoopDefenseProgressPreferences = {
  upgradeTreeVersion: 12,
  totalXp: 0,
  lastProcessedRoundEndedAt: null,
  completedBossMapIds: [],
  profile: buildDefaultCoopDefenseUpgradeProfile(),
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
    coopDefense: { ...DEFAULT_COOP_DEFENSE_PROGRESS, completedBossMapIds: [] },
  },
};

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

function buildDefaultPreferences(): LocalPreferences {
  return {
    ...DEFAULT_PREFERENCES,
    audio: { ...DEFAULT_PREFERENCES.audio },
    profile: { ...DEFAULT_PREFERENCES.profile },
    loadout: {},
    graphics: { ...DEFAULT_PREFERENCES.graphics },
    progression: {
      coopDefense: { ...DEFAULT_COOP_DEFENSE_PROGRESS, completedBossMapIds: [] },
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
    const migratedProfile = sanitizeCoopDefenseUpgradeProfile(parsed.progression?.coopDefense?.profile);
    if (sourceTreeVersion < 2) {
      for (const [upgradeId, definition] of Object.entries(COOP_DEFENSE_UPGRADE_DEFINITIONS)) {
        if (definition.bossPointCostPerLevel <= 0 || upgradeId === 'smoke_grenade_storm') continue;
        const state = migratedProfile.upgrades[upgradeId];
        if (state) state.level = 0;
      }
    }
    const storedProfile = constrainCoopDefenseUpgradeProfileToBossPoints(
      sanitizeCoopDefenseUpgradeProfile(migratedProfile),
      completedBossMapIds.length,
    );

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
          upgradeTreeVersion: 12,
          totalXp,
          lastProcessedRoundEndedAt,
          completedBossMapIds,
          profile: storedProfile,
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
    profile: cloneCoopDefenseUpgradeProfile(progress.profile),
  };
}

export function getStoredCoopDefenseUpgradeProfile(): CoopDefenseUpgradeProfile {
  return cloneCoopDefenseUpgradeProfile(readPreferences().progression.coopDefense.profile);
}

export function setStoredCoopDefenseUpgradeProfile(profile: CoopDefenseUpgradeProfile): void {
  updatePreferences((current) => ({
    ...current,
    progression: {
      ...current.progression,
      coopDefense: {
        ...current.progression.coopDefense,
        profile: constrainCoopDefenseUpgradeProfileToBossPoints(
          sanitizeCoopDefenseUpgradeProfile(profile),
          current.progression.coopDefense.completedBossMapIds.length,
        ),
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

/** Overrides the locally stored XP and earned boss points for the cheat/debug menu. */
export function setStoredCoopDefenseCheatProgress(totalXp: number, earnedBossPoints: number): void {
  const nextTotalXp = sanitizeStoredXp(totalXp);
  const nextBossPointCount = sanitizeStoredXp(earnedBossPoints);

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
          profile: constrainCoopDefenseUpgradeProfileToBossPoints(
            storedProgress.profile,
            nextBossPointCount,
          ),
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
