import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => {
  const module: any = (await import('../fakeArenaRenderScene')).createFakePhaserModule();
  module.Math.Angle.Wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
  return module;
});
import { EnemyManager } from '../../src/entities/EnemyManager';
import { COOP_DEFENSE_ENEMY_KINDS, resolveCoopDefenseEnemyConfigs } from '../../src/config/coopDefenseEnemies';
import { WorldHealthBarRenderer } from '../../src/effects/health/WorldHealthBarRenderer';
import { HEALTH_BAR_TUNING } from '../../src/effects/health/healthBarStyles';
import { healthBarTestScene } from '../healthBarTestScene';

describe('World HP pooled load, actual Host and Client state paths', () => {
  it.each([0, 50])('handles AoE and sustained moving bars with %s prewarmed views per peer', prewarm => {
    const hostFake = healthBarTestScene(), clientFake = healthBarTestScene();
    let now = 0;
    const hostRenderer = new WorldHealthBarRenderer(hostFake.scene, () => now, HEALTH_BAR_TUNING,
      { prewarmEnemyViews: prewarm, maxFreeViews: 100 });
    const clientRenderer = new WorldHealthBarRenderer(clientFake.scene, () => now, HEALTH_BAR_TUNING,
      { prewarmEnemyViews: prewarm, maxFreeViews: 100 });
    hostRenderer.openWorld({}); clientRenderer.openWorld({});
    const configs = resolveCoopDefenseEnemyConfigs(1);
    const kind = COOP_DEFENSE_ENEMY_KINDS[0];
    configs[kind] = { ...configs[kind], maxHp: 1000, weapons: [], glow: undefined,
      isBoss: false, imageKey: 'health-test' };
    const host = new EnemyManager(hostFake.scene, configs);
    const client = new EnemyManager(clientFake.scene, configs);
    host.setHealthBarRenderer(hostRenderer); client.setHealthBarRenderer(clientRenderer);
    const enemies = Array.from({ length: 100 }, (_, i) => host.hostSpawnAtWorld(i * 10, 0, kind));
    client.applySnapshot(host.getNetSnapshot());
    hostRenderer.update(true); clientRenderer.update(true);
    expect(hostRenderer.getStats()).toMatchObject({ active: 0, bindings: 100, created: prewarm });
    expect(clientRenderer.getStats()).toMatchObject({ active: 0, bindings: 100, created: prewarm });
    // One AoE damages 50 targets simultaneously. A prewarmed pool creates nothing here.
    for (const enemy of enemies.slice(0, 50)) host.applyDamage(enemy.id, 100);
    client.applySnapshot(host.getNetSnapshot());
    hostRenderer.update(true); clientRenderer.update(true);
    expect(hostRenderer.getStats()).toMatchObject({ active: 50, created: 50 });
    expect(clientRenderer.getStats()).toMatchObject({ active: 50, created: 50 });
    for (const enemy of enemies.slice(50)) host.applyDamage(enemy.id, 100);
    client.applySnapshot(host.getNetSnapshot());
    hostRenderer.update(true); clientRenderer.update(true);
    const hostCreated = hostRenderer.getStats().created;
    const clientCreated = clientRenderer.getStats().created;
    for (let frame = 1; frame <= 60; frame++) {
      now = frame * 16;
      for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        enemy.setPosition(i * 10 + frame, frame * 2);
        // Several sources between frames; no separate presentation allocations per hit.
        host.applyDamage(enemy.id, 0.1);
        host.applyDamage(enemy.id, 0.2);
        host.applyDamage(enemy.id, 1);
      }
      host.syncHostVisuals();
      client.applySnapshot(host.getNetSnapshot());
      client.updateClientInterpolation(1);
      hostRenderer.update(true); clientRenderer.update(true);
      expect(hostRenderer.getStats()).toMatchObject({ active: 100, processed: 100, created: hostCreated });
      expect(clientRenderer.getStats()).toMatchObject({ active: 100, processed: 100, created: clientCreated });
    }
    for (const fake of [hostFake, clientFake]) {
      expect(fake.rectangles.filter(rect => rect.active)).toHaveLength(300);
      expect(fake.rectangles.every(rect => Number.isFinite(rect.width * rect.scaleX)
        && rect.width * rect.scaleX >= 0 && rect.width * rect.scaleX <= rect.width)).toBe(true);
    }
    now += HEALTH_BAR_TUNING.visibleAfterDamageMs + 100;
    hostRenderer.update(true); clientRenderer.update(true);
    // All elapsed targets leave the frame working set; a refresh cannot wake them up.
    client.applySnapshot(host.getNetSnapshot());
    hostRenderer.update(true); clientRenderer.update(true);
    for (const renderer of [hostRenderer, clientRenderer]) {
      expect(renderer.getStats()).toMatchObject({ active: 0, processed: 0, free: 100 });
    }
    host.destroy(); client.destroy();
    for (const renderer of [hostRenderer, clientRenderer]) {
      expect(renderer.getStats().bindings).toBe(0);
      renderer.destroy();
      expect(renderer.getStats().free).toBe(0);
    }
  });
});
