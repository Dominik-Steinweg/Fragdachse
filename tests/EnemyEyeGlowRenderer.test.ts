import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ BlendModes: { ADD: 1 } }));
vi.mock('../src/effects/EffectUtils', () => ({ fillRadialGradientTexture() {}, registerGraphicsObject() {}, mixColors: (color: number) => color }));
vi.mock('../src/effects/EmissiveScale', () => ({ emissiveAlpha: (alpha: number) => alpha }));
vi.mock('../src/effects/EnemyEyeBatch', () => ({ EnemyEyeBatch: class {
  layer = { setBlendMode() {}, setName() {} }; begin = vi.fn(); write = vi.fn(); destroy = vi.fn();
} }));
import { EnemyEyeGlowRenderer } from '../src/effects/EnemyEyeGlowRenderer';
import { PIPELINE_ASSETS } from '../src/config/pipelineAssets';

describe('enemy eye world lifetime', () => {
  it('clears on presentation loss, suppression and world replacement, ignores stale closes and cannot revive after destroy', () => {
    const lighting = { setEnemyEyeLights: vi.fn() };
    const scene = { textures: {}, cameras: { main: { worldView: { x: 0, y: 0, width: 500, height: 500 } } } };
    const renderer = new EnemyEyeGlowRenderer(scene as never, lighting as never);
    const asset = PIPELINE_ASSETS.find(a => a.id === 'zombie-badger')!;
    const enemy = { kind: asset.id, faction: 'hostile', getHp: () => 10,
      sprite: { x: 100, y: 100, rotation: 0, scaleX: .25, scaleY: .25, displayOriginX: 64, displayOriginY: 64,
        flipX: false, flipY: false, active: true, visible: true, alpha: 1,
        texture: { key: asset.textureKey }, frame: { name: '__BASE', realWidth: 128, realHeight: 128 } } };
    const sync = () => renderer.sync([enemy] as never);
    const scope = {}, replacement = {}; let required = true;
    sync(); expect(renderer.model.lightCount).toBe(0);
    renderer.openWorld(scope, () => required); sync();
    expect(renderer.model.eyeCount).toBe(2); expect(renderer.model.lightCount).toBe(1);
    required = false; sync(); expect(lighting.setEnemyEyeLights).toHaveBeenLastCalledWith(null);
    required = true; sync(); expect(renderer.model.lightCount).toBe(1);
    renderer.setSuppressed(true); expect(renderer.model.eyeCount).toBe(0);
    sync(); expect(renderer.model.lightCount).toBe(0);
    renderer.setSuppressed(false); sync(); expect(renderer.model.lightCount).toBe(1);
    renderer.openWorld(replacement, () => true); expect(renderer.model.lightCount).toBe(0);
    renderer.closeWorld(scope); sync(); expect(renderer.model.lightCount).toBe(1);
    renderer.closeWorld(replacement); expect(renderer.model.eyeCount).toBe(0);
    renderer.destroy(); renderer.destroy(); renderer.openWorld(scope, () => true); sync();
    expect(renderer.model.lightCount).toBe(0); expect(lighting.setEnemyEyeLights).toHaveBeenLastCalledWith(null);
  });
});
