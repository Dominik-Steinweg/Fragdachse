import { describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';
vi.mock('phaser', () => ({ BlendModes: { ADD: 2 } }));
vi.mock('../src/effects/FlameShared', () => ({ ensureFlameTextures: vi.fn(), TEX_FLAME_GLOW: 'glow', TEX_FLAME_EMBER: 'ember' }));
vi.mock('../src/effects/EmissiveScale', () => ({ emissiveAlpha: (alpha: number) => alpha }));
const fixtures = vi.hoisted(() => {
  const glow = { setVisible: vi.fn().mockReturnThis(), setPosition: vi.fn().mockReturnThis(),
    setDisplaySize: vi.fn().mockReturnThis(), setAlpha: vi.fn().mockReturnThis(), destroy: vi.fn() };
  const sparks = { setVisible: vi.fn(), setPosition: vi.fn(), explode: vi.fn(), killAll: vi.fn(), destroy: vi.fn() };
  return { glow, sparks };
});
vi.mock('../src/effects/EffectUtils', () => ({
  configureAdditiveImage: (image: unknown) => image,
  registerGraphicsObject: vi.fn(), createEmitter: () => fixtures.sparks,
  destroyEmitter: (emitter: { destroy(): void }) => emitter.destroy(),
}));
import { MolotovFirewalkerRenderer } from '../src/effects/MolotovFirewalkerRenderer';

describe('Firewalker presentation lifetime', () => {
  it('attaches sparks once in world space, stops hidden emission and releases every object', () => {
    const scene = { add: { image: () => fixtures.glow }, time: { now: 100 } };
    const renderer = new MolotovFirewalkerRenderer(scene as unknown as Phaser.Scene);
    renderer.sync(300, 400, 32, true);
    expect(fixtures.sparks.setPosition).toHaveBeenLastCalledWith(300, 400);
    expect(fixtures.sparks.explode).toHaveBeenLastCalledWith(1);
    const calls = fixtures.sparks.explode.mock.calls.length;
    scene.time.now += 1;
    renderer.sync(301, 400, 32, true);
    expect(fixtures.sparks.explode).toHaveBeenCalledTimes(calls);
    scene.time.now += 500;
    renderer.sync(301, 400, 32, false);
    expect(fixtures.sparks.killAll).toHaveBeenCalled();
    expect(fixtures.sparks.explode).toHaveBeenCalledTimes(calls);
    renderer.destroy();
    expect(fixtures.glow.destroy).toHaveBeenCalledOnce();
    expect(fixtures.sparks.destroy).toHaveBeenCalledOnce();
  });
});
