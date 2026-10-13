import { describe, expect, it, vi } from 'vitest';
const { layers, Layer } = vi.hoisted(() => {
  const layers: Layer[] = [];
  class Layer {
    memberCount = 0; visible = false; destroyed = false; members: any[] = [];
    frame = { realWidth: 64, realHeight: 64 };
    constructor(_scene: unknown, readonly texture: unknown, public size: number) { layers.push(this); }
    setDepth() { return this; } setVisible(v: boolean) { this.visible = v; return this; }
    resize(size: number, clear: boolean) { this.size = size; if (clear) this.memberCount = 0; }
    addMember(m: any) { this.members[this.memberCount++] = { ...m }; }
    destroy() { this.destroyed = true; }
  }
  return { layers, Layer };
});
vi.mock('phaser', () => ({ GameObjects: { SpriteGPULayer: Layer } }));
vi.mock('../src/effects/EffectUtils', () => ({ ensureCanvasTexture() {}, registerGraphicsObject() {} }));
vi.mock('../src/graphics/GpuLayerCameraTransform', () => ({ configureGpuLayerCameraTransform() {} }));
vi.mock('../src/ui/HostileBaseIndicator', () => ({ getVisibleWorldView: () => ({ x: 0, y: 0, width: 1000, height: 1000 }) }));
import { EliteMarkerRenderer } from '../src/effects/dawn/EliteMarkerRenderer';
import { ELITE_MARKERS, eliteMarkerGeometry } from '../src/effects/dawn/EliteMarkerModel';
import { DAWN_ELITE_AFFIX_IDS } from '../src/dawn/contracts/DawnContentIds';
import type { EnemyVisualSource } from '../src/entities/EnemyVisualSource';

function fixture() {
  layers.length = 0;
  const scene: any = { add: { existing() {} }, cameras: { main: {} },
    textures: { exists: () => false, get: () => ({ has: () => true }),
      getFrame: (_key: string, name: string) => ({ name, realWidth: 64, realHeight: 64 }) } };
  const renderer = new EliteMarkerRenderer(scene);
  const enemies = Array.from({ length: 120 }, (_, i) => ({
    id: String(i), eliteAffixId: DAWN_ELITE_AFFIX_IDS[i % 5], getHp: () => 100,
    sprite: { x: 100 + i, y: 100, displayWidth: 40, displayHeight: 40, rotation: 2,
      alpha: 1, active: true, visible: true, texture: { key: 'test-enemy' } },
  })) as unknown as EnemyVisualSource[];
  return { renderer, enemies, scene };
}

describe('elite marker presentation', () => {
  it('gives all five affixes distinct shapes and screen-upright, body-relative glyph anchors', () => {
    expect(new Set(Object.values(ELITE_MARKERS).map(m => m.glyph)).size).toBe(DAWN_ELITE_AFFIX_IDS.length);
    for (const id of DAWN_ELITE_AFFIX_IDS) {
      const model = eliteMarkerGeometry(id, 100, 200, 44);
      expect(model.iconKey).toBe('elite-' + id); expect(model.glyphY).toBeLessThan(200 - 22);
      expect(model.glyphSize).toBeGreaterThanOrEqual(16); expect(model.glyphSize).toBeLessThanOrEqual(24);
      expect(model.ringDiameter).toBeGreaterThan(44);
    }
  });
  it('batches crowds without losing earlier members when growing and clears empty frames', () => {
    const { renderer, enemies } = fixture(); renderer.sync(enemies);
    expect(layers).toHaveLength(2);
    expect(layers.map(l => l.memberCount)).toEqual([enemies.length, enemies.length]);
    expect(layers[1].members[0].rotation ?? 0).toBe(0);
    renderer.sync([]);
    expect(layers.every(l => !l.visible && l.memberCount === 0)).toBe(true);
    renderer.destroy(); expect(layers.every(l => l.destroyed)).toBe(true);
  });
  it('hides ordinary, dead, invisible and offscreen enemies and restores visible markers', () => {
    const { renderer, enemies } = fixture();
    const source = enemies[0];
    renderer.sync([{ ...source, eliteAffixId: undefined }, { ...source, getHp: () => 0 }]);
    expect(layers[0].memberCount).toBe(0);
    source.sprite.visible = false; renderer.sync([source]); expect(layers[0].memberCount).toBe(0);
    source.sprite.visible = true; source.sprite.x = -1000; renderer.sync([source]); expect(layers[0].memberCount).toBe(0);
    source.sprite.x = 100; renderer.sync([source]); expect(layers[0].memberCount).toBe(1);
    renderer.destroy(); renderer.sync([source]); expect(layers.every(l => l.destroyed)).toBe(true);
  });
  it('uses a supplied contracted icon texture while retaining the shared ground ring', () => {
    const { renderer, enemies, scene } = fixture();
    scene.textures.exists = (key: string) => key === 'elite-swift';
    renderer.sync([enemies[0]]);
    expect(layers).toHaveLength(3); expect(layers[0].memberCount).toBe(1);
    expect(layers[1].memberCount).toBe(0); expect(layers[2].memberCount).toBe(1);
    renderer.sync([]); expect(layers.every(l => !l.visible)).toBe(true);
    renderer.destroy();
  });
});
