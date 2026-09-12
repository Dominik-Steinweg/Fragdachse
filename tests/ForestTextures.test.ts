import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({}));
vi.mock('../src/ui/LivingBarEffect', () => ({ rgbStr: () => 'rgba(0,0,0,1)' }));
import { drawForestFrame, ensureForestButton, ensureForestFrame, ensureForestPanel, forestOrnament } from '../src/ui/forestTextures';
import { ensureRoundedTexture } from '../src/ui/uiTextures';
import { FOREST_ASSETS } from '../src/ui/LobbyForestAssets';

function fixture() {
  const textures = new Map<string, any>();
  for (const asset of Object.values(FOREST_ASSETS)) {
    textures.set(asset.key, { getSourceImage: () => ({ width: 1000, height: 1500 }) });
  }
  const createCanvas = vi.fn((key: string, width: number, height: number) => {
    const context = {
      drawImage: vi.fn(), scale: vi.fn(), translate() {}, save() {}, restore() {}, clearRect() {},
      beginPath() {}, moveTo() {}, arcTo() {}, closePath() {}, rect() {}, clip() {},
      fillRect() {}, fill() {}, stroke() {},
      createPattern: () => ({}), createLinearGradient: () => ({ addColorStop() {} }),
    };
    const texture = { width, height, context, refresh: vi.fn() };
    textures.set(key, texture);
    return texture;
  });
  const scene: any = {
    textures: { exists: (key: string) => textures.has(key), get: (key: string) => textures.get(key), createCanvas },
    add: { image: vi.fn(() => ({ setDisplaySize() { return this; }, setScrollFactor() { return this; } })) },
  };
  return { scene, textures, createCanvas };
}

describe('forest texture ownership and reuse', () => {
  it('keeps size, material, intent and pointer state in separate cache entries', () => {
    const { scene, createCanvas } = fixture();
    const keys = new Set<string>();
    for (const [w, h] of [[220, 44], [480, 60]]) {
      for (const glass of [true, false]) for (const intent of ['secondary', 'primary', 'disabled'] as const) {
        for (const state of ['rest', 'hover', 'press'] as const) {
          const key = ensureForestButton(scene, w, h, intent, state, 12, glass);
          expect(keys.has(key)).toBe(false);
          keys.add(key);
          const count = createCanvas.mock.calls.length;
          expect(ensureForestButton(scene, w, h, intent, state, 12, glass)).toBe(key);
          expect(createCanvas).toHaveBeenCalledTimes(count);
        }
      }
    }
    const defaultKey = ensureRoundedTexture(scene, { key: '_btn_secondary_rest_220x44_r12', w: 220, h: 44,
      radius: 12, topColor: 0, bottomColor: 0, fillAlpha: 1, strokeColor: 0, strokeAlpha: 1,
      strokeWidth: 1, highlightAlpha: 0 });
    expect(keys.has(defaultKey)).toBe(false);
  });

  it('preserves artwork proportions for both wide and tall target bounds', () => {
    const image = { width: 1000, height: 1500 } as HTMLImageElement;
    const drawImage = vi.fn();
    for (const [width, height] of [[640, 800], [400, 1000]]) {
      drawImage.mockClear();
      drawForestFrame({ drawImage } as unknown as CanvasRenderingContext2D, image, width, height);
      expect(drawImage).toHaveBeenCalledOnce();
      const [, x, y, w, h] = drawImage.mock.calls[0];
      expect(w / h).toBeCloseTo(image.width / image.height);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(width);
      expect(y + h).toBeLessThanOrEqual(height);
    }
  });

  it('shares card and ornament textures without adding input or per-instance listeners', () => {
    const { scene, createCanvas } = fixture();
    for (let n = 0; n < 3; n++) {
      ensureForestFrame(scene, 580, 840);
      ensureForestPanel(scene, 540, 800, true);
      ensureForestPanel(scene, 300, 180);
      const ornament = forestOrnament(scene, 'medallion', 100, 100, 124, 124);
      expect('input' in ornament).toBe(false);
    }
    expect(createCanvas).toHaveBeenCalledTimes(4);
    expect(scene.add.image).toHaveBeenCalledTimes(3);
  });
});
