import { expect, it } from 'vitest';
import { EnemyEyeGlowModel, type EnemyEyeSource } from '../../src/effects/EnemyEyeGlowModel';
import { PIPELINE_ASSETS } from '../../src/config/pipelineAssets';

it('keeps every eye/light in mixed crowds and reuses storage across despawns', () => {
  const assets = PIPELINE_ASSETS.filter(a => a.category === 'enemy');
  const enemies: EnemyEyeSource[] = Array.from({ length: 240 }, (_, i) => {
    const a = assets[i % assets.length], size = a.sourceSize;
    return { kind: a.id, faction: 'hostile', getHp: () => 10,
      sprite: { x: 100 + i % 20 * 30, y: 100 + Math.floor(i / 20) * 30, rotation: i,
        scaleX: 30 / size, scaleY: 30 / size, displayOriginX: size / 2, displayOriginY: size / 2,
        flipX: false, flipY: false, alpha: 1, visible: true, active: true,
        texture: { key: a.sheetTextureKey }, frame: { name: String(i % a.layout.frameCount), realWidth: size, realHeight: size } } };
  });
  const view = { x: 0, y: 0, width: 1920, height: 1080 }, model = new EnemyEyeGlowModel();
  model.update(enemies, view);
  const eyes = [...model.eyes], lights = [...model.lights];
  for (let cycle = 0; cycle < 100; cycle++) {
    model.update([], view);
    expect(model.eyeCount).toBe(0); expect(model.lightCount).toBe(0);
    model.update(enemies, view);
    expect(model.eyeCount).toBe(enemies.length * 2); expect(model.lightCount).toBe(enemies.length);
  }
  expect(model.eyes.length).toBe(eyes.length); expect(model.lights.length).toBe(lights.length);
  model.eyes.forEach((eye, i) => expect(eye).toBe(eyes[i]));
  model.lights.forEach((light, i) => expect(light).toBe(lights[i]));
});
