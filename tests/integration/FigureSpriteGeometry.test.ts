import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => (await import('../fakeArenaRenderScene')).createFakePhaserModule());

import { EnemyEntity } from '../../src/entities/EnemyEntity';
import { DecoyEntity } from '../../src/entities/DecoyEntity';
import { PlayerEntity } from '../../src/entities/PlayerEntity';
import { BadgerPreview } from '../../src/ui/BadgerPreview';
import { SpawnEffectRenderer } from '../../src/effects/SpawnEffectRenderer';
import { BADGER_WALKING_FRAME_WIDTH } from '../../src/animations/BadgerAnimations';
import { getHeldItemSpriteSpec } from '../../src/loadout/HeldItemVisuals';
import { resolveCoopDefenseEnemyConfigs } from '../../src/config/coopDefenseEnemies';
import { getPipelineAssetForTexture } from '../../src/config/pipelineAssets';
import { HELD_ITEM_TEXTURE_SIZE, PLAYER_SIZE, PLAYER_VISUAL_SCALE } from '../../src/config';
import { healthBarTestScene } from '../healthBarTestScene';

// The installed Arcade Body works without a renderer. Its real source-pixel scaling is
// essential here: a setCircle spy would miss resolution-dependent collision regressions.
const require = createRequire(import.meta.url);
const Body = require('../../node_modules/phaser/src/physics/arcade/Body.js');
afterEach(() => vi.restoreAllMocks());

function sceneWithArcadeBodies(sourceSize: number) {
  const { scene } = healthBarTestScene();
  const images: any[] = [];
  const tweens: any[] = [];
  const create = scene.add.sprite;
  const figure = (x: number, y: number, key: string, frame = 0, size = sourceSize) => {
    const sprite = create(x, y, key, frame);
    sprite.texture.key = key;
    Object.assign(sprite, { width: size, height: size, angle: 0,
      displayOriginX: size / 2, displayOriginY: size / 2,
      frame: { name: String(frame), realWidth: size, realHeight: size,
        cutWidth: size, cutHeight: size } });
    Object.defineProperties(sprite, {
      displayWidth: { get: () => sprite.width * sprite.scaleX },
      displayHeight: { get: () => sprite.height * sprite.scaleY },
    });
    sprite.setDisplaySize = (width: number, height: number) => {
      Object.assign(sprite, { scaleX: width / size, scaleY: height / size });
      return sprite;
    };
    sprite.getBounds = () => ({ x: sprite.x - sprite.displayWidth / 2,
      y: sprite.y - sprite.displayHeight / 2, width: sprite.displayWidth, height: sprite.displayHeight });
    return sprite;
  };
  scene.add.sprite = figure;
  scene.add.image = (x: number, y: number, key: string) => {
    const size = key === getHeldItemSpriteSpec('GLOCK')!.textureKey ? HELD_ITEM_TEXTURE_SIZE : sourceSize;
    const image = figure(x, y, key, 0, size);
    images.push(image);
    return image;
  };
  scene.add.zone = (x: number, y: number, width: number) => figure(x, y, 'zone', 0, width);
  scene.tweens.add = (config: any) => { tweens.push(config); return { stop() {} }; };
  scene.physics.add.existing = (sprite: any) => {
    sprite.body = new Body({ defaults: {}, bounds: { x: 0, y: 0, width: 4096, height: 4096 } }, sprite);
  };
  return { scene, images, tweens };
}

function expectPlayerBody(body: any, x: number, y: number, diameter = PLAYER_SIZE) {
  body.updateFromGameObject();
  expect(body.isCircle).toBe(true);
  expect(body.width).toBeCloseTo(diameter);
  expect(body.height).toBeCloseTo(diameter);
  expect(body.halfWidth).toBeCloseTo(diameter / 2);
  expect(body.halfHeight).toBeCloseTo(diameter / 2);
  expect(body.center.x).toBeCloseTo(x);
  expect(body.center.y).toBeCloseTo(y);
}

// Drive the existing tween callbacks without a renderer or a second animation scheduler.
function finishTween(tween: any) {
  for (const key of ['scaleX', 'scaleY', 'alpha', 'progress']) {
    const value = tween[key];
    if (value !== undefined) tween.targets[key] = typeof value === 'number' ? value : value.to;
  }
  tween.onUpdate?.();
  tween.onComplete?.();
}

describe('figure source resolution and Arcade geometry', () => {
  it('keeps authored enemy diameters and centered bodies across source sizes and dashes', () => {
    for (const config of Object.values(resolveCoopDefenseEnemyConfigs(1))) {
      const asset = getPipelineAssetForTexture(config.imageKey)!;
      const { scene } = sceneWithArcadeBodies(asset.sourceSize);
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

  it.each([32, 64, getPipelineAssetForTexture('badger')!.sourceSize])(
    'enlarges the decoy at source size %s without enlarging or shifting its circle', sourceSize => {
    const { scene } = sceneWithArcadeBodies(sourceSize);
    const decoy = new DecoyEntity(scene, 1, 'owner', 100, 200, 0xffffff, false, true);
    expect(decoy.sprite.displayWidth).toBeCloseTo(PLAYER_SIZE * PLAYER_VISUAL_SCALE);
    expect(decoy.sprite.displayHeight).toBeCloseTo(PLAYER_SIZE * PLAYER_VISUAL_SCALE);
    expect(decoy.body!.center.x).toBeCloseTo(100);
    expect(decoy.body!.center.y).toBeCloseTo(200);
    expectPlayerBody(decoy.body, 100, 200);
    decoy.setRotation(1.2);
    decoy.setPosition(300, 400);
    expectPlayerBody(decoy.body, 300, 400);
  });

  it.each([false, true])('keeps player collision independent of visual poses (presentation=%s)', presentation => {
    vi.spyOn(SpawnEffectRenderer.prototype, 'play').mockImplementation(() => {});
    const { scene, tweens } = sceneWithArcadeBodies(BADGER_WALKING_FRAME_WIDTH);
    const player = new PlayerEntity(scene, { id: 'p', name: 'P', colorHex: 0xffffff },
      100, 200, false, null, { presentation, spawnEffect: false });
    const sprite = player.displayObject!;
    for (const scale of [1, 0.5, 1]) {
      player.setDashScale(scale);
      expect(sprite.displayWidth).toBeCloseTo(PLAYER_SIZE * PLAYER_VISUAL_SCALE * scale);
      expect(sprite.displayHeight).toBeCloseTo(PLAYER_SIZE * PLAYER_VISUAL_SCALE * scale);
      expectPlayerBody(player.body, 100, 200);
      expect(player.getBounds().width).toBe(PLAYER_SIZE);
      expect(player.getCollisionRadius()).toBe(PLAYER_SIZE / 2);
    }
    // The authoritative dash still owns its smaller circle, independently of visual feedback.
    player.setCollisionRadius(PLAYER_SIZE / 4);
    player.setDashScale(0.5);
    expectPlayerBody(player.body, 100, 200, PLAYER_SIZE / 2);
    player.setCollisionRadius(PLAYER_SIZE / 2);

    player.playSpawnEffect();
    expect(sprite.displayWidth).toBe(0);
    expectPlayerBody(player.body, 100, 200);
    finishTween(tweens.findLast(t => t.targets === sprite));
    expectPlayerBody(player.body, 100, 200);
    finishTween(tweens.at(-1));
    expect(sprite.displayWidth).toBeCloseTo(PLAYER_SIZE * PLAYER_VISUAL_SCALE);

    player.setBurrowPhase('windup', true);
    const windup = tweens.at(-1);
    windup.targets.progress = 0.7;
    windup.onUpdate();
    expect(sprite.displayWidth).not.toBe(sprite.displayHeight);
    expectPlayerBody(player.body, 100, 200);
    player.setBurrowPhase('underground', false);
    player.setBurrowPhase('recovery', true);
    expectPlayerBody(player.body, 100, 200);
    finishTween(tweens.at(-1));
    expect(sprite.displayWidth).toBeCloseTo(PLAYER_SIZE * PLAYER_VISUAL_SCALE);
    expect(sprite.displayHeight).toBeCloseTo(PLAYER_SIZE * PLAYER_VISUAL_SCALE);
    expectPlayerBody(player.body, 100, 200);
  });

  it('scales held weapons consistently in the arena, decoy and custom lobby preview', () => {
    const { scene, images } = sceneWithArcadeBodies(BADGER_WALKING_FRAME_WIDTH);
    const player = new PlayerEntity(scene, { id: 'p', name: 'P', colorHex: 0xffffff },
      100, 200, false, null, { spawnEffect: false });
    const decoy = new DecoyEntity(scene, 1, 'p', 100, 200, 0xffffff, false, false);
    const preview = new BadgerPreview(scene, 100, 200, 0xffffff);
    const largePreview = new BadgerPreview(scene, 100, 200, 0xffffff, 64);
    for (const [entity, size] of [[player, PLAYER_SIZE], [decoy, PLAYER_SIZE],
      [preview, PLAYER_SIZE], [largePreview, 64]] as const) {
      entity.setHeldItemId('GLOCK');
      const weapon = images.at(-1);
      const sprite = entity instanceof PlayerEntity ? entity.displayObject! : entity.sprite;
      expect(sprite.displayWidth).toBeCloseTo(size * PLAYER_VISUAL_SCALE);
      expect(weapon.scaleX).toBeCloseTo(sprite.displayWidth / HELD_ITEM_TEXTURE_SIZE);
      expect(decoy.body).toBeNull();
    }
    player.setDashScale(0.5);
    const weapon = images.find(i => i.texture.key === getHeldItemSpriteSpec('GLOCK')!.textureKey);
    expect(weapon.scaleX).toBeCloseTo(player.displayObject!.displayWidth / HELD_ITEM_TEXTURE_SIZE);

    player.setDashScale(1);
    player.setDecoyStealth(true);
    const overlays = images.filter(i => i.visible && i.texture.key === player.displayObject!.texture.key);
    expect(overlays).toHaveLength(2);
    const sizes = overlays.map(i => [i.displayWidth, i.displayHeight]);
    player.setDashScale(0.5);
    overlays.forEach((overlay, i) => {
      expect(overlay.displayWidth).toBeCloseTo(sizes[i][0] * 0.5);
      expect(overlay.displayHeight).toBeCloseTo(sizes[i][1] * 0.5);
    });
  });
});
