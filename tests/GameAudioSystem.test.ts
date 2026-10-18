import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ Math: {
  Clamp: (v: number, a: number, b: number) => Math.min(b, Math.max(a, v)),
  Linear: (a: number, b: number, t: number) => a + (b - a) * t,
  Distance: { Between: (x: number, y: number, a: number, b: number) => Math.hypot(a - x, b - y) },
} }));
vi.mock('../src/assets/DeferredAssets', () => ({ getDeferredAssets: () => ({ subscribe: () => () => {} }) }));
import { GameAudioSystem } from '../src/audio/GameAudioSystem';
import { getSoundVolume, preloadAllAudio, AUDIO_ASSETS } from '../src/audio/AudioCatalog';

function fixture() {
  const available = new Set<string>();
  const sound = Object.assign(new EventEmitter(), { play: vi.fn(), locked: false, context: { state: 'running' } });
  const voices: { key: string; isPlaying: boolean; isPaused: boolean; pendingRemove: boolean;
    play: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[] = [];
  const add = vi.fn((key: string) => {
    const voice = { key, isPlaying: false, isPaused: false, pendingRemove: false,
      play: vi.fn((config: unknown) => { voice.isPlaying = true; sound.play(key, config); return true; }),
      destroy: vi.fn(() => { voice.pendingRemove = true; voice.isPlaying = false; }) };
    voices.push(voice);
    return voice;
  });
  Object.assign(sound, { add });
  const scene = { sound, time: { now: 0 }, cache: { audio: { exists: (key: string) => available.has(key) } } };
  const audio = new GameAudioSystem(scene as never, () => 'local', () => ({ x: 0, y: 0 }), 0.8, 0.5, 0);
  return { available, scene, sound, audio, voices, add };
}

describe('GameAudioSystem one-shot feedback', () => {
  it('reuses finished voices with fresh spatial settings without interrupting active or paused sounds', () => {
    const { audio, available, sound, voices, add } = fixture();
    available.add('sfx_player_death');
    audio.playSound('sfx_player_death', 500, 0, 'remote');
    audio.playLocalSound('sfx_player_death');
    expect(add).toHaveBeenCalledTimes(2);
    voices[0].isPlaying = false;
    voices[0].isPaused = true;
    audio.playLocalSound('sfx_player_death');
    expect(add).toHaveBeenCalledTimes(3);
    voices[0].isPaused = false;
    audio.setEffectsVolume(0.25);
    audio.playLocalSound('sfx_player_death');
    expect(add).toHaveBeenCalledTimes(3);
    expect(voices[0].play).toHaveBeenLastCalledWith({ volume: 0.8 * 0.25 * getSoundVolume('sfx_player_death'), pan: 0 });
    expect(sound.play).toHaveBeenCalledTimes(4);
    voices[0].destroy();
    audio.playLocalSound('sfx_player_death');
    expect(voices[0].play).toHaveBeenCalledTimes(2);
    audio.cleanup();
    expect(voices.every(voice => voice.pendingRemove)).toBe(true);
  });

  it('bounds the audible overlap of one remote key by restarting its oldest copy or dropping attack-phase overflow', () => {
    const { audio, available, sound, scene, voices } = fixture();
    available.add('sfx_player_death');
    scene.time.now = 1000;
    for (let i = 0; i < 200; i++) audio.playSound('sfx_player_death', 50, 0, 'remote');
    const bounded = sound.play.mock.calls.length;
    expect(bounded).toBeGreaterThan(0);
    expect(bounded).toBeLessThanOrEqual(8);
    expect(voices.length).toBe(bounded);
    scene.time.now += 100;
    audio.playSound('sfx_player_death', 50, 0, 'remote');
    // The oldest copy restarts: no new voice and no overflow instance.
    expect(sound.play).toHaveBeenCalledTimes(bounded + 1);
    expect(voices.length).toBe(bounded);
    audio.playSound('sfx_player_death', 50, 0, 'local');
    expect(sound.play).toHaveBeenCalledTimes(bounded + 2);
    audio.cleanup();
  });

  it('frees finished voices of other keys when retention is full', () => {
    const { audio, available, sound, voices } = fixture();
    const keys = Object.keys(AUDIO_ASSETS).filter(key => !key.startsWith('music')).slice(0, 12);
    for (const key of keys) available.add(key);
    for (const key of keys.slice(0, 8)) for (let i = 0; i < 8; i++) audio.playSound(key as never, 50, 0, 'remote');
    for (const voice of voices) voice.isPlaying = false;
    const before = sound.play.mock.calls.length;
    audio.playSound(keys[10] as never, 50, 0, 'remote');
    expect(sound.play).toHaveBeenCalledTimes(before + 1);
    expect(voices.filter(voice => !voice.pendingRemove).length).toBeLessThanOrEqual(64);
    audio.cleanup();
  });

  it('bounds retained voices while preserving every personal overlapping sound and the HTML5 fallback', () => {
    const { audio, available, sound, voices, add } = fixture();
    available.add('sfx_player_death');
    for (let i = 0; i < 200; i++) audio.playLocalSound('sfx_player_death');
    expect(sound.play).toHaveBeenCalledTimes(200);
    expect(add.mock.calls.length).toBeGreaterThan(0);
    expect(add.mock.calls.length).toBeLessThan(200);
    const retained = voices.length;
    sound.context = undefined as never;
    audio.playLocalSound('sfx_player_death');
    expect(sound.play).toHaveBeenCalledTimes(201);
    expect(voices).toHaveLength(retained);
    audio.cleanup();
    expect(voices.every(voice => voice.pendingRemove)).toBe(true);
  });

  it('preserves the rocket overlap limiter after its sources get independent files', () => {
    const { audio, available, sound, scene } = fixture();
    available.add('sfx_explosion_rocket');
    available.add('sfx_explosion_turret_rocket');
    available.add('sfx_explosion_rocket_aftershock');
    scene.time.now = 1000;
    audio.playSound('sfx_explosion_rocket', 0, 0);
    audio.playSound('sfx_explosion_turret_rocket', 0, 0);
    audio.playSound('sfx_explosion_rocket_aftershock', 0, 0);
    expect(sound.play).toHaveBeenCalledOnce();
    scene.time.now += 1000;
    audio.playSound('sfx_explosion_turret_rocket', 0, 0);
    expect(sound.play.mock.lastCall![0]).toBe('sfx_explosion_turret_rocket');
    audio.cleanup();
  });

  it('plays exactly one explosion recording and replaces the substitute when the dedicated asset is available', () => {
    const { audio, available, sound } = fixture();
    available.add('sfx_explosion_armageddon');
    audio.playSound('sfx_explosion_void_armageddon', 0, 0);
    expect(sound.play).toHaveBeenCalledOnce();
    expect(sound.play.mock.lastCall![0]).toBe('sfx_explosion_armageddon');
    available.add('sfx_explosion_void_armageddon');
    audio.playSound('sfx_explosion_void_armageddon', 0, 0);
    expect(sound.play).toHaveBeenCalledTimes(2);
    expect(sound.play.mock.lastCall![0]).toBe('sfx_explosion_void_armageddon');
    audio.cleanup();
  });

  it('loads only published catalog assets and silently drops missing or locked feedback without backlog', () => {
    const load = vi.fn();
    preloadAllAudio({ audio: load } as never);
    for (const [key, path] of Object.entries(AUDIO_ASSETS)) {
      if (!existsSync(`public/${path}`)) expect(load).not.toHaveBeenCalledWith(key, path);
    }
    const { audio, available, sound } = fixture();
    audio.playLocalSound('sfx_round_victory');
    available.add('sfx_round_victory');
    sound.locked = true;
    audio.playLocalSound('sfx_round_victory');
    sound.locked = false;
    sound.emit('unlocked');
    expect(sound.play).not.toHaveBeenCalled();
    audio.playLocalSound('sfx_round_victory');
    expect(sound.play).toHaveBeenCalledOnce();
    audio.cleanup();
    audio.playLocalSound('sfx_round_victory');
    expect(sound.play).toHaveBeenCalledOnce();
  });

  it('uses existing master/effects/catalog gain, mutes and distinguishes spatial from personal feedback', () => {
    const { audio, available, sound } = fixture();
    available.add('sfx_player_death');
    audio.playLocalSound('sfx_player_death');
    expect(sound.play).toHaveBeenLastCalledWith('sfx_player_death', { volume: 0.8 * 0.5 * getSoundVolume('sfx_player_death'), pan: 0 });
    audio.playSound('sfx_player_death', 500, 0, 'remote');
    expect(sound.play.mock.calls.at(-1)![1].pan).toBeGreaterThan(0);
    expect(sound.play.mock.calls.at(-1)![1].volume).toBeLessThan(sound.play.mock.calls[0][1].volume);
    audio.setEffectsVolume(0);
    audio.playLocalSound('sfx_player_death');
    audio.setEffectsVolume(1);
    audio.setMasterVolume(0);
    audio.playLocalSound('sfx_player_death');
    expect(sound.play).toHaveBeenCalledTimes(2);
    audio.cleanup();
  });

  it('bounds dense kills, hover and each pickup family without suppressing separate player deaths', () => {
    const { audio, available, scene, sound } = fixture();
    for (const key of ['sfx_enemy_death', 'sfx_menu_hover', 'sfx_pickup_hp', 'sfx_pickup_armor', 'sfx_player_death']) available.add(key);
    for (let i = 0; i < 100; i++) {
      audio.playLocalSound('sfx_enemy_death'); audio.playLocalSound('sfx_menu_hover'); audio.playLocalSound('sfx_pickup_hp');
    }
    audio.playLocalSound('sfx_pickup_armor');
    audio.playSound('sfx_player_death', 0, 0, 'p1'); audio.playSound('sfx_player_death', 1, 1, 'p2');
    expect(sound.play).toHaveBeenCalledTimes(6);
    scene.time.now += 1000;
    audio.playLocalSound('sfx_enemy_death');
    expect(sound.play).toHaveBeenCalledTimes(7);
    audio.cleanup();
  });
});
