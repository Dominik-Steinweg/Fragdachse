import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';
import { preloadAllAudio } from '../src/audio/AudioCatalog';
import { GameAudioSystem } from '../src/audio/GameAudioSystem';
import { DEFERRED_ASSETS, DeferredAssets, getDeferredAssets } from '../src/assets/DeferredAssets';
import { SOUND_MUSIC_VOLUME } from '../src/config';

vi.mock('phaser', () => ({ Math: { Clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)) } }));
class FakeLoader extends EventEmitter {
  readonly queued: Array<{ key: string; url: string }> = [];
  maxRetries = 2;
  loading = false;
  audio(key: string | { key: string; url: string }, url?: string): this {
    this.queued.push(typeof key === 'string' ? { key, url: url! } : key); return this;
  }
  image(config: { key: string; url: string }): this { return this.audio(config); }
  isLoading(): boolean { return this.loading; }
  start(): void { this.loading = true; }
  async finish(): Promise<void> { this.loading = false; this.emit('complete'); await Promise.resolve(); }
}
function setup(cached: string[] = []) {
  const cache = new Set(cached), loader = new FakeLoader(), sounds: any[] = [], tweens: any[] = [];
  const sound = Object.assign(new EventEmitter(), {
    locked: false, pauseOnBlur: true,
    context: { state: 'running', resume: vi.fn(async () => { sound.context.state = 'running'; }) },
    add: vi.fn((key: string, config: any) => {
      const result = { key, volume: config.volume, isPlaying: false,
        play: vi.fn(() => { result.isPlaying = true; return true; }),
        stop: vi.fn(() => { result.isPlaying = false; }), destroy: vi.fn(), setVolume: vi.fn(),
      }; sounds.push(result); return result;
    }),
  });
  const scene = { load: loader, events: new EventEmitter(), sound,
    cache: { audio: { exists: (key: string) => cache.has(key) } },
    textures: { exists: (key: string) => cache.has(key) },
    tweens: { add: vi.fn((config: any) => { tweens.push(config); return { remove: vi.fn() }; }) },
  } as unknown as Phaser.Scene;
  const assets = getDeferredAssets(scene);
  const complete = (key: string) => { cache.add(key); loader.emit('filecomplete', key, 'audio'); };
  const progress = (key: string, loaded: number, total: number) => loader.emit('fileprogress', {
    key, type: 'audio', bytesLoaded: loaded, bytesTotal: total,
  });
  return { scene, assets, loader, sound, sounds, tweens, complete, progress };
}
afterEach(() => vi.unstubAllGlobals());

describe('central second asset phase', () => {
  it('excludes both music tracks from initial preload and enables music by default', () => {
    const { loader } = setup(); preloadAllAudio(loader as unknown as Phaser.Loader.LoaderPlugin);
    for (const asset of DEFERRED_ASSETS) expect(loader.queued.some(file => file.key === asset.key)).toBe(false);
    expect(loader.queued.some(file => file.key === 'shot_ak47')).toBe(true);
    expect(SOUND_MUSIC_VOLUME).toBeGreaterThan(0); expect(SOUND_MUSIC_VOLUME).toBeLessThan(1);
  });
  it('starts independently of mute, reuses running/completed loads, and never loads from volume changes', async () => {
    const h = setup(), audio = new GameAudioSystem(h.scene, () => 'local', () => null, 1, 1, 0);
    audio.playMusic('music_lobby'); audio.setMusicVolume(0.5); audio.setMusicVolume(0);
    expect(h.loader.queued).toHaveLength(0);
    h.assets.start(); h.assets.start(); expect(getDeferredAssets(h.scene)).toBe(h.assets);
    expect(h.loader.queued).toHaveLength(2);
    h.complete('music_lobby'); h.complete('music_arena'); await h.loader.finish();
    expect(h.sound.add).not.toHaveBeenCalled(); expect(h.assets.getState().ready).toBe(true);
    h.assets.start(); expect(h.loader.queued).toHaveLength(2); audio.cleanup();
  });
  it('uses decoded cache immediately without a queue or extra wait', () => {
    const h = setup(DEFERRED_ASSETS.map(asset => asset.key)); h.assets.start();
    expect(h.assets.getState().ready).toBe(true); expect(h.loader.queued).toHaveLength(0);
  });
  it('weights large files by actual bytes, stays monotone, and waits for decoding', async () => {
    const h = setup(); h.assets.start(); h.progress('music_lobby', 50, 100);
    expect(h.assets.getState().progress).toBeNull(); h.progress('music_arena', 50, 900);
    expect(h.assets.getState().progress).toBe(0.1); h.progress('music_arena', 20, 900);
    expect(h.assets.getState().progress).toBe(0.1);
    h.progress('music_lobby', 100, 100); h.progress('music_arena', 900, 900);
    expect(h.assets.getState()).toMatchObject({ progress: null, ready: false });
    h.complete('music_lobby'); expect(h.assets.getState().ready).toBe(false);
    h.complete('music_arena'); await h.loader.finish();
    expect(h.assets.getState()).toMatchObject({ progress: 1, ready: true });
  });
  it('uses activity without percentages for unknown content lengths', () => {
    const h = setup(); h.assets.start(); h.progress('music_lobby', 1000, 0); h.progress('music_arena', 20, 100);
    expect(h.assets.getState().progress).toBeNull();
  });
  it('discards percentages when a retried response changes its byte total', () => {
    const h = setup(); h.assets.start(); h.progress('music_lobby', 50, 100); h.progress('music_arena', 50, 100);
    expect(h.assets.getState().progress).toBe(0.5);
    h.progress('music_arena', 20, 200);
    expect(h.assets.getState().progress).toBeNull();
  });
  it('fades the usable lobby track while arena music still downloads', () => {
    const h = setup(), audio = new GameAudioSystem(h.scene, () => 'local', () => null);
    audio.playMusic('music_lobby'); h.assets.start(); h.complete('music_lobby');
    expect(h.assets.getState().ready).toBe(false);
    expect(h.sound.add).toHaveBeenCalledWith('music_lobby', { volume: 0, loop: true });
    expect(h.sounds[0].isPlaying).toBe(true); expect(h.tweens[0]).toMatchObject({ value: 1 }); audio.cleanup();
  });
  it('completes while autoplay is blocked and resumes on ordinary keyboard input', async () => {
    const document = new EventTarget(); vi.stubGlobal('document', document);
    const h = setup(); h.sound.context.state = 'suspended';
    const audio = new GameAudioSystem(h.scene, () => 'local', () => null);
    audio.playMusic('music_lobby'); h.assets.start(); h.complete('music_lobby'); h.complete('music_arena');
    await h.loader.finish(); expect(h.assets.getState().ready).toBe(true); expect(h.sound.add).not.toHaveBeenCalled();
    document.dispatchEvent(new Event('keydown')); await Promise.resolve(); expect(h.sounds[0].isPlaying).toBe(true);
    audio.cleanup(); document.dispatchEvent(new Event('pointerdown')); expect(h.sound.add).toHaveBeenCalledTimes(1);
  });
  it('honors Phaser unlock and only starts the latest requested track after state changes', () => {
    const h = setup(); h.sound.locked = true;
    const audio = new GameAudioSystem(h.scene, () => 'local', () => null);
    audio.playMusic('music_lobby'); h.assets.start(); audio.stopMusic(); h.complete('music_lobby');
    h.sound.locked = false; h.sound.emit('unlocked'); expect(h.sound.add).not.toHaveBeenCalled();
    audio.playMusic('music_arena'); h.complete('music_arena'); expect(h.sounds.map(sound => sound.key)).toEqual(['music_arena']);
    audio.playMusic('music_lobby'); expect(h.sounds[0].stop).toHaveBeenCalled(); audio.cleanup();
  });
  it('contains playback errors so usable assets can still release the start barrier', async () => {
    const h = setup(), audio = new GameAudioSystem(h.scene, () => 'local', () => null);
    h.sound.add.mockImplementation(() => { throw new Error('Audio device unavailable'); });
    audio.playMusic('music_lobby'); h.assets.start();
    expect(() => h.complete('music_lobby')).not.toThrow();
    h.complete('music_arena'); await h.loader.finish();
    expect(h.assets.getState().ready).toBe(true); audio.cleanup();
  });
  it('bounds retries for download/decode failures and then skips only optional music', async () => {
    const h = setup(); h.assets.start(); h.complete('music_lobby'); h.loader.emit('loaderror', { key: 'music_arena' });
    await h.loader.finish(); expect(h.assets.getState().ready).toBe(false);
    await h.loader.finish(); await h.loader.finish();
    expect(h.loader.queued.filter(file => file.key === 'music_arena')).toHaveLength(3);
    expect(h.loader.queued.filter(file => file.key === 'music_lobby')).toHaveLength(1);
    expect(h.assets.getState()).toMatchObject({ ready: true, failedKeys: ['music_arena'] });
    h.assets.start(); expect(h.loader.queued).toHaveLength(4);
  });
  it('fails closed for required content after retry exhaustion', async () => {
    const h = setup(), assets = new DeferredAssets(h.scene, [{ key: 'required', type: 'image', url: 'required.png', optional: false }]);
    assets.start(); await h.loader.finish(); await h.loader.finish(); await h.loader.finish();
    expect(assets.getState()).toMatchObject({ status: 'error', ready: false, failedKeys: ['required'] }); assets.destroy();
  });
  it('does not restart queued retries after scene shutdown', async () => {
    const h = setup(); h.assets.start(); h.loader.emit('complete'); h.scene.events.emit('shutdown'); await Promise.resolve();
    expect(h.loader.queued).toHaveLength(2);
  });
});
