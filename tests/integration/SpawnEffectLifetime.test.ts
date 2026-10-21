import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => (await import('../fakeArenaRenderScene')).createFakePhaserModule());

import { PlayerEntity } from '../../src/entities/PlayerEntity';
import { EffectSystem } from '../../src/effects/EffectSystem';
import { countActiveSpawnEffects, SpawnEffectRenderer } from '../../src/effects/SpawnEffectRenderer';
import { healthBarTestScene } from '../healthBarTestScene';

function fixture() {
  const f = healthBarTestScene();
  const particles = f.scene.add.particles;
  f.scene.add.particles = (...args: unknown[]) => Object.assign(particles(...args), { explode() {} });
  f.scene.tweens.add = () => ({ stop() {} });
  f.scene.tweens.killTweensOf = vi.fn();
  // The spawn stage advances on the scene's render clock and leaves with the scene.
  const events = new EventEmitter();
  f.scene.events = events;
  const render = (now: number) => { f.scene.time.now = now; events.emit('prerender'); };
  return { ...f, events, render };
}

describe('spawn presentation ownership', () => {
  it('releases a player spawn with its figure, without touching other owners', () => {
    const f = fixture();
    const player = new PlayerEntity(f.scene, { id: 'p1', name: 'P1', colorHex: 0x88bbff },
      100, 100, false, null, { spawnEffect: false });
    const effects = new EffectSystem(f.scene, {} as never);
    player.playSpawnEffect();
    effects.playEnemySpawnEffect(300, 300, 0xb347ff);
    expect(countActiveSpawnEffects(f.scene)).toBe(2);
    player.destroy();
    expect(countActiveSpawnEffects(f.scene)).toBe(1);
    effects.destroy();
    expect(countActiveSpawnEffects(f.scene)).toBe(0);
  });

  it('clears a World without destroying the scene owner and keeps later spawns', () => {
    const f = fixture();
    const system = new EffectSystem(f.scene, {} as never);
    system.playEnemySpawnEffect(100, 100, 0x88bbff);
    system.clearSpawnEffects();
    expect(countActiveSpawnEffects(f.scene)).toBe(0);
    system.playEnemySpawnEffect(200, 200, 0xffffff);
    f.render(100);
    expect(countActiveSpawnEffects(f.scene)).toBe(1);
    system.clearSpawnEffects();
    expect(countActiveSpawnEffects(f.scene)).toBe(0);
  });

  it.each(['play', 'playEnemy'] as const)('forgets a naturally completed %s spawn and clears idempotently', (method) => {
    const f = fixture();
    const renderer = new SpawnEffectRenderer(f.scene);
    renderer[method](100, 100, 0x88bbff);
    f.render(500);
    expect(countActiveSpawnEffects(f.scene)).toBe(1);
    f.render(10_000);
    expect(countActiveSpawnEffects(f.scene)).toBe(0);
    renderer.clear();
    renderer.clear();
    expect(countActiveSpawnEffects(f.scene)).toBe(0);
  });

  it('drops every spawn and its clock with the scene', () => {
    const f = fixture();
    new SpawnEffectRenderer(f.scene).play(100, 100, 0x88bbff);
    f.events.emit('shutdown');
    expect(countActiveSpawnEffects(f.scene)).toBe(0);
    expect(f.events.listenerCount('prerender')).toBe(0);
  });

  it('replays only a materialisation whose start was hidden, not one that is still running', () => {
    const f = fixture();
    const play = vi.spyOn(SpawnEffectRenderer.prototype, 'play');
    const player = new PlayerEntity(f.scene, { id: 'p1', name: 'P1', colorHex: 0x88bbff },
      100, 100, false, null);
    expect(play).toHaveBeenCalledTimes(1);
    player.replaySpawnEffect();
    expect(play).toHaveBeenCalledTimes(1);
    f.scene.time.now += 5_000;
    player.replaySpawnEffect();
    expect(play).toHaveBeenCalledTimes(2);
    player.setVisible(false);
    f.scene.time.now += 5_000;
    player.replaySpawnEffect();
    expect(play).toHaveBeenCalledTimes(2);
    player.destroy();
  });
});
