import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => (await import('../fakeArenaRenderScene')).createFakePhaserModule());

import { EnemyEntity } from '../../src/entities/EnemyEntity';
import { DecoyEntity } from '../../src/entities/DecoyEntity';
import { resolveCoopDefenseEnemyConfigs } from '../../src/config/coopDefenseEnemies';
import { getPipelineAssetForTexture } from '../../src/config/pipelineAssets';
import { PLAYER_SIZE } from '../../src/config';
import { healthBarTestScene } from '../healthBarTestScene';

// The installed Arcade Body works without a renderer. Its real source-pixel scaling is
// essential here: a setCircle spy would miss resolution-dependent collision regressions.
const require = createRequire(import.meta.url);
const Body = require('../../node_modules/phaser/src/physics/arcade/Body.js');

function sceneWithArcadeBodies(sourceSize: number) {
  const { scene } = healthBarTestScene();
  const create = scene.add.sprite;
  const figure = (x: number, y: number, key: string, frame = 0) => {
    const sprite = create(x, y, key, frame);
    Object.assign(sprite, { width: sourceSize, height: sourceSize, angle: 0,
      displayOriginX: sourceSize / 2, displayOriginY: sourceSize / 2,
      frame: { name: String(frame), realWidth: sourceSize, realHeight: sourceSize,
        cutWidth: sourceSize, cutHeight: sourceSize } });
    sprite.setDisplaySize = (width: number, height: number) => {
      Object.assign(sprite, { displayWidth: width, displayHeight: height,
        scaleX: width / sourceSize, scaleY: height / sourceSize });
      return sprite;
    };
    return sprite;
  };
  scene.add.sprite = figure;
  scene.add.image = figure;
  scene.physics.add.existing = (sprite: any) => {
    sprite.body = new Body({ defaults: {}, bounds: { x: 0, y: 0, width: 4096, height: 4096 } }, sprite);
  };
  return scene;
}

describe('figure source resolution and Arcade geometry', () => {
  it('keeps authored enemy diameters and centered bodies across source sizes and dashes', () => {
    for (const config of Object.values(resolveCoopDefenseEnemyConfigs(1))) {
      const asset = getPipelineAssetForTexture(config.imageKey)!;
      const scene = sceneWithArcadeBodies(asset.sourceSize);
      const enemy = new EnemyEntity(scene, 'enemy', 100, 200, true, config.id,
        { ...config, weapons: [], glow: undefined, isBoss: false });
      for (const factor of [1, 0.5, 1]) {
        enemy.setDashScale(factor);
        const body = enemy.body;
        body.updateFromGameObject();
        expect(body.width).toBeCloseTo(config.size * factor);
        expect(body.height).toBeCloseTo(config.size * factor);
        expect(Math.abs(body.center.x - 100)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(body.center.y - 200)).toBeLessThanOrEqual(0.5);
        expect(enemy.getCollisionRadius()).toBe(Math.floor(config.size * factor / 2));
      }
    }
  });

  it('keeps the decoy body at player size when the idle image has higher resolution', () => {
    const scene = sceneWithArcadeBodies(getPipelineAssetForTexture('badger')!.sourceSize);
    const decoy = new DecoyEntity(scene, 1, 'owner', 100, 200, 0xffffff, false, true);
    decoy.body!.updateFromGameObject();
    expect(decoy.body!.width).toBe(PLAYER_SIZE);
    expect(decoy.body!.center.x).toBe(100);
    expect(decoy.body!.center.y).toBe(200);
  });
});
