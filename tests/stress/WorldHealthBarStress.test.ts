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
import { drawnHealthBars, healthBarTestScene } from '../healthBarTestScene';

describe('World HP batched load, actual Host and Client state paths', () => {
  it('handles AoE and sustained moving bars with one layer object per peer', () => {
    const hostFake = healthBarTestScene(), clientFake = healthBarTestScene();
    let now = 0;
    const hostRenderer = new WorldHealthBarRenderer(hostFake.scene, () => now, HEALTH_BAR_TUNING);
    const clientRenderer = new WorldHealthBarRenderer(clientFake.scene, () => now, HEALTH_BAR_TUNING);
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
    expect(hostRenderer.getStats()).toMatchObject({ active: 0, bindings: 100, layers: 0 });
    expect(clientRenderer.getStats()).toMatchObject({ active: 0, bindings: 100, layers: 0 });
    // One AoE damages 50 targets simultaneously: one shared layer, no per-target objects.
    for (const enemy of enemies.slice(0, 50)) host.applyDamage(enemy.id, 100);
    client.applySnapshot(host.getNetSnapshot());
    hostRenderer.update(true); clientRenderer.update(true);
    expect(hostRenderer.getStats()).toMatchObject({ active: 50, drawn: 50, layers: 1 });
    expect(clientRenderer.getStats()).toMatchObject({ active: 50, drawn: 50, layers: 1 });
    for (const enemy of enemies.slice(50)) host.applyDamage(enemy.id, 100);
    client.applySnapshot(host.getNetSnapshot());
    hostRenderer.update(true); clientRenderer.update(true);
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
      host.syncHostVisuals(16);
      client.applySnapshot(host.getNetSnapshot());
      client.updateClientInterpolation(1);
      hostRenderer.update(true); clientRenderer.update(true);
      expect(hostRenderer.getStats()).toMatchObject({ active: 100, processed: 100, drawn: 100, layers: 1 });
      expect(clientRenderer.getStats()).toMatchObject({ active: 100, processed: 100, drawn: 100, layers: 1 });
    }
    for (const [fake, renderer] of [[hostFake, hostRenderer], [clientFake, clientRenderer]] as const) {
      expect(fake.rectangles).toHaveLength(0);
      const bars = drawnHealthBars(renderer);
      expect(bars).toHaveLength(100);
      expect(bars.every(bar => Number.isFinite(bar.hpWidth) && bar.hpWidth >= 0 && bar.hpWidth <= bar.width
        && bar.trailWidth >= bar.hpWidth && bar.trailWidth <= bar.width)).toBe(true);
    }
    now += HEALTH_BAR_TUNING.visibleAfterDamageMs + 100;
    hostRenderer.update(true); clientRenderer.update(true);
    // All elapsed targets leave the frame working set; a refresh cannot wake them up.
    client.applySnapshot(host.getNetSnapshot());
    hostRenderer.update(true); clientRenderer.update(true);
    for (const renderer of [hostRenderer, clientRenderer]) {
      expect(renderer.getStats()).toMatchObject({ active: 0, processed: 0, drawn: 0 });
      expect(drawnHealthBars(renderer)).toHaveLength(0);
    }
    host.destroy(); client.destroy();
    for (const renderer of [hostRenderer, clientRenderer]) {
      expect(renderer.getStats().bindings).toBe(0);
      renderer.destroy();
      expect(renderer.getStats().layers).toBe(0);
    }
  });
});
