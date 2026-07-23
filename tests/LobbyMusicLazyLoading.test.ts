import { describe, expect, it, vi } from 'vitest';
import * as Phaser from 'phaser';
import {
  getMusicAssetPath,
  LAZY_MUSIC_ASSET_KEY,
  preloadAllAudio,
} from '../src/audio/AudioCatalog';
import { GameAudioSystem, type MusicLoadState } from '../src/audio/GameAudioSystem';
import { SOUND_MUSIC_VOLUME } from '../src/config';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
    Linear: (start: number, end: number, t: number) => start + (end - start) * t,
  },
  Loader: {
    Events: {
      FILE_PROGRESS: 'fileprogress',
      FILE_COMPLETE: 'filecomplete',
      FILE_LOAD_ERROR: 'loaderror',
    },
  },
}));

type LoaderListener = (...args: any[]) => void;

class FakeLoader {
  readonly queued: Array<{ key: string; path: string }> = [];
  readonly listeners = new Map<string, Set<LoaderListener>>();
  starts = 0;

  on(event: string, listener: LoaderListener): this {
    const listeners = this.listeners.get(event) ?? new Set<LoaderListener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  off(event: string, listener: LoaderListener): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  audio(key: string, path: string): this {
    this.queued.push({ key, path });
    return this;
  }

  isLoading(): boolean {
    return false;
  }

  start(): this {
    this.starts += 1;
    return this;
  }

  emit(event: string, ...args: any[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

describe('lazy lobby music', () => {
  it('defaults music to zero and leaves the lobby track out of the initial preload', () => {
    const loader = new FakeLoader();

    preloadAllAudio(loader as unknown as Phaser.Loader.LoaderPlugin);

    expect(SOUND_MUSIC_VOLUME).toBe(0);
    expect(loader.queued.some(({ key }) => key === LAZY_MUSIC_ASSET_KEY)).toBe(false);
    expect(loader.queued.some(({ key }) => key === 'shot_ak47')).toBe(true);
  });

  it('loads and starts the requested lobby track after music is raised above zero', () => {
    const loader = new FakeLoader();
    const cachedAudio = new Set<string>();
    const sound = {
      isPlaying: false,
      play: vi.fn(() => {
        sound.isPlaying = true;
        return true;
      }),
      stop: vi.fn(),
      destroy: vi.fn(),
      setVolume: vi.fn(),
    };
    const addSound = vi.fn(() => sound);
    const scene = {
      load: loader,
      cache: {
        audio: {
          exists: (key: string) => cachedAudio.has(key),
        },
      },
      sound: {
        pauseOnBlur: true,
        add: addSound,
      },
    } as unknown as Phaser.Scene;
    const audioSystem = new GameAudioSystem(scene, () => 'local', () => null);
    const states: Array<MusicLoadState | null> = [];
    audioSystem.subscribeMusicLoadState((state) => states.push(state));

    audioSystem.playMusic('music_lobby');
    expect(loader.queued).toEqual([]);

    audioSystem.setMusicVolume(0.5);
    expect(loader.queued).toEqual([
      { key: LAZY_MUSIC_ASSET_KEY, path: getMusicAssetPath(LAZY_MUSIC_ASSET_KEY) },
    ]);
    expect(loader.starts).toBe(1);

    loader.emit(Phaser.Loader.Events.FILE_PROGRESS, { key: LAZY_MUSIC_ASSET_KEY }, 0.4);
    cachedAudio.add(LAZY_MUSIC_ASSET_KEY);
    loader.emit(Phaser.Loader.Events.FILE_COMPLETE, LAZY_MUSIC_ASSET_KEY, 'audio');

    expect(states).toContainEqual({
      key: LAZY_MUSIC_ASSET_KEY,
      progress: 0.4,
      status: 'loading',
    });
    expect(states).toContainEqual({
      key: LAZY_MUSIC_ASSET_KEY,
      progress: 1,
      status: 'complete',
    });
    expect(addSound).toHaveBeenCalledWith(LAZY_MUSIC_ASSET_KEY, {
      volume: 0.1,
      loop: true,
    });
    expect(sound.play).toHaveBeenCalledOnce();
  });
});
