import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/effects/EffectUtils', () => ({ registerGraphicsObject: vi.fn() }));
import { TurretRangePreviewVisual } from '../src/scenes/arena/TurretRangePreviewVisual';

function fixture() {
  const textures = new Map<string, { size: number; strokes: number; fills: number }>();
  const created = vi.fn();
  const scene = {
    textures: {
      exists: (key: string) => textures.has(key),
      remove: (key: string) => textures.delete(key),
      createCanvas: (key: string, width: number) => {
        created(key, width);
        const entry = { size: width, strokes: 0, fills: 0 };
        textures.set(key, entry);
        const context = new Proxy({}, { get: (_t, prop) => prop === 'stroke' ? () => { entry.strokes++; }
          : prop === 'fill' ? () => { entry.fills++; } : () => {}, set: () => true });
        return { context, refresh: vi.fn() };
      },
    },
    add: { image: () => {
      const image = { texture: '', x: 0, y: 0, alpha: 1, visible: true, depth: 0, name: '',
        setDepth(d: number) { this.depth = d; return this; }, setVisible(v: boolean) { this.visible = v; return this; },
        setName(n: string) { this.name = n; return this; }, setTexture(t: string) { this.texture = t; return this; },
        setPosition(x: number, y: number) { this.x = x; this.y = y; return this; },
        setAlpha(a: number) { this.alpha = a; return this; }, destroy: vi.fn() };
      images.push(image); return image;
    } },
  };
  const images: any[] = [];
  return { scene, images, textures, created };
}

describe('turret range placement preview', () => {
  it('bakes its footprint once per radius, colour and validity and only breathes the soft edge', () => {
    const { scene, images, textures, created } = fixture();
    const preview = new TurretRangePreviewVisual(scene as never, 8.8);
    expect(images.map(image => image.depth)).toEqual([8.8, 8.8, 8.8]);
    preview.show(100, 200, 300, 0x3399ff, true, 0.9);
    expect(created).toHaveBeenCalledTimes(3);
    expect([...textures.values()].every(texture => texture.size >= 600)).toBe(true);
    // Wash below, three soft rings, then the crisp edge and 48 ticks on top.
    expect([...textures.values()].map(texture => [texture.fills, texture.strokes])).toEqual([[1, 0], [0, 3], [0, 49]]);
    preview.show(140, 210, 300, 0x3399ff, true, 0.96);
    expect(created).toHaveBeenCalledTimes(3);
    expect(images.every(image => image.visible && image.x === 140 && image.y === 210)).toBe(true);
    expect(images.map(image => image.alpha)).toEqual([1, 0.96, 1]);
    preview.show(140, 210, 300, 0xff0000, false, 0.96);
    expect(created).toHaveBeenCalledTimes(6);
    expect(textures.size).toBe(3);
    preview.hide();
    expect(images.every(image => !image.visible)).toBe(true);
    preview.destroy();
    expect(textures.size).toBe(0);
    expect(images.every(image => image.destroy.mock.calls.length === 1)).toBe(true);
  });
});
