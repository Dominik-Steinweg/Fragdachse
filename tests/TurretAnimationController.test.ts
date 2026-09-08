import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';
import { TurretAnimationController } from '../src/effects/TurretAnimationController';
import { getTurretVisualSpec } from '../src/config/turretVisuals';
import { pipelineAnimationKey } from '../src/config/pipelineAssets';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { NET_TICK_INTERVAL_MS } from '../src/config';
import type { SyncedTeslaDome } from '../src/types';

function sprite() {
  const events = new EventEmitter();
  const view = Object.assign(events, {
    active: true, texture: { key: '' }, frame: { name: 0 as string | number },
    anims: { isPlaying: false, currentAnim: null as null | { key: string },
      stop: vi.fn(() => { view.anims.isPlaying = false; }) },
    setTexture(key: string, frame: number) { this.texture.key = key; this.frame.name = frame; return this; },
    setOrigin() { return this; },
    setFrame(frame: number) { this.frame.name = frame; return this; },
    play: vi.fn((key: string, ignoreIfPlaying = false) => {
      if (ignoreIfPlaying && view.anims.isPlaying && view.anims.currentAnim?.key === key) return view;
      view.anims.isPlaying = true;
      view.anims.currentAnim = { key };
      view.frame.name = 1;
      return view;
    }),
  });
  return { view, phaser: view as unknown as Phaser.GameObjects.Sprite };
}

describe('turret animation lifecycle', () => {
  it('restarts discrete recoil, preserves it through a repeated binding and returns to idle', () => {
    const controller = new TurretAnimationController();
    const { view, phaser } = sprite();
    const asset = getTurretVisualSpec('TURRET_ROCKET_BURST').asset;
    controller.bind('base:rocket', phaser, 'TURRET_ROCKET_BURST');
    controller.onShot('base:rocket');
    controller.bind('base:rocket', phaser, 'TURRET_ROCKET_BURST');
    expect(view.frame.name).toBe(1);
    controller.onShot('base:rocket');
    expect(view.play).toHaveBeenCalledTimes(2);
    expect(view.play).toHaveBeenLastCalledWith(pipelineAnimationKey(asset, asset.clips[0]));
    view.anims.isPlaying = false;
    controller.update(16);
    expect(view.frame.name).toBe(asset.idleFrame);
  });

  it('keeps sustained fire active between discharges and stops after its network grace period', () => {
    const controller = new TurretAnimationController();
    const { view, phaser } = sprite();
    controller.bind('7', phaser, 'TURRET_FLAME');
    controller.onShot('7');
    controller.update(WEAPON_CONFIGS.TURRET_FLAME.cooldown);
    expect(view.anims.isPlaying).toBe(true);
    controller.onShot('7');
    controller.update(WEAPON_CONFIGS.TURRET_FLAME.cooldown + 2 * NET_TICK_INTERVAL_MS);
    expect(view.anims.isPlaying).toBe(false);
    expect(view.frame.name).toBe(0);
  });

  it('uses only the matching construction dome for Tesla activity', () => {
    const controller = new TurretAnimationController();
    const { view, phaser } = sprite();
    controller.bind('7', phaser, 'TURRET_TESLA');
    controller.onShot('7');
    expect(view.anims.isPlaying).toBe(false);
    controller.syncTesla([{ ownerId: 'tesla-turret:7' }] as SyncedTeslaDome[]);
    controller.update(16);
    expect(view.anims.isPlaying).toBe(true);
    controller.syncTesla([{ ownerId: 'player-7' }] as SyncedTeslaDome[]);
    controller.update(16);
    expect(view.anims.isPlaying).toBe(false);
  });

  it('releases old bindings on replacement, destruction and world teardown', () => {
    const controller = new TurretAnimationController();
    const first = sprite(), replacement = sprite();
    controller.bind('7', first.phaser, 'TURRET_FLAME');
    controller.onShot('7');
    controller.bind('7', replacement.phaser, 'TURRET_MG');
    expect(first.view.anims.isPlaying).toBe(false);
    expect(first.view.listenerCount('destroy')).toBe(0);
    // Phaser clears anims in preDestroy while active can still be true.
    Object.assign(replacement.view, { isDestroyed: true, anims: undefined });
    replacement.view.emit('destroy');
    controller.onShot('7');
    expect(replacement.view.play).not.toHaveBeenCalled();
    controller.bind('7', first.phaser, 'TURRET_TESLA');
    controller.clear();
    expect(first.view.listenerCount('destroy')).toBe(0);
    controller.onShot('7');
    expect(first.view.play).toHaveBeenCalledTimes(1);
  });
});
