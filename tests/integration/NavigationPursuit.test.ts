import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => (await import('../fakeArenaRenderScene')).createFakePhaserModule());
import { EnemyManager } from '../../src/entities/EnemyManager';
import { resolveCoopDefenseEnemyConfigs } from '../../src/config/coopDefenseEnemies';
import { healthBarTestScene } from '../healthBarTestScene';
import { FlowFieldCoordinator } from '../../src/systems/flowfield/FlowFieldCoordinator';
import { createFlowFieldTuning } from '../../src/systems/flowfield/FlowFieldSources';
import { EnemyFlowFieldService } from '../../src/systems/EnemyFlowFieldService';
import { EnemyAiTargetCatalog } from '../../src/systems/EnemyAiTargetCatalog';
import { EnemyIntentSystem } from '../../src/systems/navigation/EnemyIntentSystem';

describe('Continuous pursuit across field updates', () => {
  it('keeps actual enemy velocity while the player moves every frame and changes identity', () => {
    const metrics = { cols: 161, rows: 33, cellSize: 16, pointOffset: 0, arenaOffsetX: 0, arenaOffsetY: 0 };
    const coordinator = new FlowFieldCoordinator({ metrics, tuning: createFlowFieldTuning(),
      staticKind: new Uint8Array(metrics.cols * metrics.rows), bases: [], activeBaseIds: new Set(),
      obstacleCellProvider: () => [], geometryProvider: () => ({ left: 0, top: 0, right: 2560, bottom: 512, obstacles: [] }),
      navTickIntervalMs: 100 });
    const field = EnemyFlowFieldService.fromView(coordinator.registerField('player', { goalMode: 'dynamic', bodyRadius: 15 }));
    const catalog = new EnemyAiTargetCatalog(), intents = new EnemyIntentSystem(coordinator, catalog);
    const manager = new EnemyManager(healthBarTestScene().scene, resolveCoopDefenseEnemyConfigs(1));
    manager.setNavigationIntents(intents);
    const unit = manager.hostSpawnAtWorld(64, 128, 'void-stalker');
    let pendingFrames = 0, pauses = 0;
    const dt = 1000 / 60;
    for (let step = 0; step < 360; step++) {
      const x = 1000 + step * 3, y = 256 + Math.sin(step / 40) * 80;
      catalog.updateTargets([{ kind: 'player', id: step < 180 ? 'first' : 'replacement', x, y }]);
      coordinator.advance(dt); intents.update([unit], step * dt);
      manager.hostUpdateMovement(field, field, field, null, false, step * dt, dt);
      const route = intents.get(unit.id)!.navigation;
      if (route.status === 'pending') pendingFrames++;
      const { vx, vy } = unit.getDesiredVelocity();
      if (step > 6 && Math.hypot(vx, vy) < 1) pauses++;
      const nx = unit.sprite.x + vx * dt / 1000, ny = unit.sprite.y + vy * dt / 1000;
      expect(coordinator.getGeometry()!.canMove(unit.sprite.x, unit.sprite.y, nx, ny, unit.getSize() / 2)).toBe(true);
      unit.setPosition(nx, ny);
    }
    expect(pendingFrames).toBeGreaterThan(100);
    expect(pauses).toBe(0);
    expect(unit.sprite.x).toBeGreaterThan(400);
    expect(intents.get(unit.id)!.target!.id).toBe('replacement');
    manager.destroy(); intents.clear(); coordinator.destroy();
  });
});
