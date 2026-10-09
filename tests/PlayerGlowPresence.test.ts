import { describe, expect, it, vi } from 'vitest';
import type * as Phaser from 'phaser';
import { bindPlayerGlowEnvironment, PlayerGlowPresence } from '../src/effects/PlayerGlowPresence';
import type { SunCloudState } from '../src/effects/sunlight/cloudShadow';

vi.mock('phaser', () => ({}));
const fx = vi.hoisted(() => ({
  add: vi.fn(() => ({ color: 0, outerStrength: 0, innerStrength: 0, scale: 1 })),
  remove: vi.fn(),
  cover: vi.fn(() => 0.5),
}));
vi.mock('../src/utils/phaserFx', () => ({ addInternalGlowLegacy: fx.add, removeInternalFx: fx.remove }));
vi.mock('../src/arena/AmbientWildlifeAppearance', () => ({ wildlifeFogCover: fx.cover }));

function image() {
  return {
    active: true, visible: true, alpha: 1, x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
    originX: .5, originY: .5, flipX: false, flipY: false,
    texture: { key: 'badger' }, frame: { name: '0' as string | number },
    destroy: vi.fn(),
    setTexture(key: string, frame: string | number) { this.texture.key = key; this.frame.name = frame; return this; },
    setDepth() { return this; },
    setVisible(value: boolean) { this.visible = value; return this; },
    setPosition(x: number, y: number) { this.x = x; this.y = y; return this; },
    setRotation(value: number) { this.rotation = value; return this; },
    setScale(x: number, y: number) { this.scaleX = x; this.scaleY = y; return this; },
    setOrigin() { return this; },
    setFlip() { return this; },
  };
}

function setup() {
  const copies: ReturnType<typeof image>[] = [];
  const scene: Record<string, unknown> = { sys: {} };
  scene.add = { image: vi.fn(() => { const copy = Object.assign(image(), { scene }); copies.push(copy); return copy; }) };
  const source = image();
  const lighting = { setGroundGlowLights: vi.fn() };
  const glow = { color: 0x33ccff, outerStrength: 7, innerStrength: 0 };
  const presence = new PlayerGlowPresence(scene as unknown as Phaser.Scene,
    source as unknown as Phaser.GameObjects.Sprite, 0x33ccff, lighting);
  return { scene, source, lighting, glow, presence, lift: copies[0] };
}

describe('PlayerGlowPresence', () => {
  it('lends a player-coloured ground light only while the figure is shown', () => {
    const { source, lighting, glow, presence } = setup();
    source.x = 120; source.y = 80;
    presence.sync(glow, true);
    const [owner, frame] = lighting.setGroundGlowLights.mock.calls.at(-1)!;
    expect(owner).toBe(presence);
    expect(frame.lightCount).toBe(1);
    expect(frame.lights[0]).toMatchObject({ x: 120, y: 80, color: 0x33ccff });

    presence.sync(glow, false);
    expect(lighting.setGroundGlowLights).toHaveBeenLastCalledWith(presence, null);
    presence.sync(glow, true);
    source.visible = false;
    presence.sync(glow, true);
    expect(lighting.setGroundGlowLights).toHaveBeenLastCalledWith(presence, null);
  });

  it('lifts the halo above fog only inside a bound fog environment', () => {
    const { scene, source, glow, presence, lift } = setup();
    presence.sync(glow, true);
    expect(lift.visible).toBe(false);

    const release = bindPlayerGlowEnvironment(scene as unknown as Phaser.Scene,
      { clouds: {} as SunCloudState, fogStrength: () => 1 });
    source.frame.name = '5'; source.rotation = 1.2;
    presence.sync(glow, true);
    expect(lift.visible).toBe(true);
    expect(lift.frame.name).toBe('5');
    expect(lift.rotation).toBe(1.2);

    release();
    presence.sync(glow, true);
    expect(lift.visible).toBe(false);
  });

  it('releases its light, filter and copy on destroy and ignores later frames', () => {
    const { lighting, glow, presence, lift } = setup();
    presence.sync(glow, true);
    presence.destroy();
    expect(lighting.setGroundGlowLights).toHaveBeenLastCalledWith(presence, null);
    expect(fx.remove).toHaveBeenCalledWith(lift, expect.anything());
    expect(lift.destroy).toHaveBeenCalledOnce();
    lighting.setGroundGlowLights.mockClear();
    presence.sync(glow, true);
    expect(lighting.setGroundGlowLights).not.toHaveBeenCalled();
  });
});
