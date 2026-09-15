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
  const scene = { sound, time: { now: 0 }, cache: { audio: { exists: (key: string) => available.has(key) } } };
  const audio = new GameAudioSystem(scene as never, () => 'local', () => ({ x: 0, y: 0 }), 0.8, 0.5, 0);
  return { available, scene, sound, audio };
}

describe('GameAudioSystem one-shot feedback', () => {
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
