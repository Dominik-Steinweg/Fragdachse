import { SOUND_MASTER_VOLUME, SOUND_MUSIC_VOLUME, SOUND_SFX_VOLUME } from '../config';
import type { LoadoutSlot } from '../types';
import { sanitizePlayerName } from './playerName';

const LOCAL_PREFERENCES_KEY = 'fragdachse_local_preferences';
const LOCAL_PREFERENCES_VERSION = 2;

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

const DEFAULT_PREFERENCES: LocalPreferencesV2 = {
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

function parsePreferences(raw: string | null): LocalPreferencesV2 {
  if (!raw) return { ...DEFAULT_PREFERENCES, audio: { ...DEFAULT_PREFERENCES.audio }, profile: { ...DEFAULT_PREFERENCES.profile }, loadout: {} };

  try {
    const parsed = JSON.parse(raw) as Partial<LocalPreferencesV2>;
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
    };
  } catch {
    return { ...DEFAULT_PREFERENCES, audio: { ...DEFAULT_PREFERENCES.audio }, profile: { ...DEFAULT_PREFERENCES.profile }, loadout: {} };
  }
}

function readPreferences(): LocalPreferencesV2 {
  return parsePreferences(getLocalStorage()?.getItem(LOCAL_PREFERENCES_KEY) ?? null);
}

function writePreferences(next: LocalPreferencesV2): void {
  getLocalStorage()?.setItem(LOCAL_PREFERENCES_KEY, JSON.stringify(next));
}

function updatePreferences(mutator: (current: LocalPreferencesV2) => LocalPreferencesV2): void {
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