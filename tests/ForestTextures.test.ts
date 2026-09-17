import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({}));
vi.mock('../src/ui/LivingBarEffect', () => ({ rgbStr: () => 'rgba(0,0,0,1)' }));
import { drawForestFrame, drawForestButtonFrame, ensureForestButton, ensureForestActionButton, ensureForestFrame, ensureForestPanel, forestOrnament } from '../src/ui/forestTextures';
import { ensureRoundedTexture } from '../src/ui/uiTextures';
import { FOREST_ASSETS } from '../src/ui/LobbyForestAssets';

function fixture() {
  const textures = new Map<string, any>();
  for (const asset of Object.values(FOREST_ASSETS)) {
    textures.set(asset.key, { getSourceImage: () => ({ width: asset.width, height: asset.height }) });
  }
  const createCanvas = vi.fn((key: string, width: number, height: number) => {
    const context = {
      drawImage: vi.fn(), scale: vi.fn(), translate() {}, save() {}, restore() {}, clearRect() {},
      beginPath() {}, moveTo() {}, arcTo() {}, closePath() {}, rect() {}, clip() {},
      fillRect() {}, fill() {}, stroke() {},
      createPattern: vi.fn(() => ({})), createLinearGradient: () => ({ addColorStop() {} }),
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
  it('keeps selection fields free of wood grain', () => {
    const { scene, textures } = fixture();
    for (const state of ['rest', 'hover', 'press'] as const) {
      const glass = ensureForestButton(scene, 220, 44, 'neutral', state, 12, true);
      const wood = ensureForestButton(scene, 220, 44, 'neutral', state);
      expect(textures.get(glass).context.createPattern).not.toHaveBeenCalled();
      expect(textures.get(glass).context.drawImage).not.toHaveBeenCalled();
      expect(textures.get(wood).context.createPattern).toHaveBeenCalledOnce();
      expect(textures.get(wood).context.drawImage).toHaveBeenCalled();
    }
  });

  it('fits icon and wide wood buttons with undistorted corners and clipped edge repeats', () => {
    const asset = FOREST_ASSETS.buttonFrame;
    const image = { width: asset.width, height: asset.height } as HTMLImageElement;
    const drawImage = vi.fn();
    const ctx = { drawImage } as unknown as CanvasRenderingContext2D;
    let cornerWidth: number | undefined;
    for (const [width, height] of [[24, 24], [36, 36], [190, 36], [236, 40], [216, 48]]) {
      drawImage.mockClear();
      drawForestButtonFrame(ctx, image, width, height);
      for (const [, sx, sy, sw, sh, dx, dy, dw, dh] of drawImage.mock.calls) {
        expect(dw / (sw * asset.sourceWidth / image.width)).toBeCloseTo(dh / (sh * asset.sourceHeight / image.height));
        expect(sx).toBeGreaterThanOrEqual(0);
        expect(sy).toBeGreaterThanOrEqual(0);
        expect(sx + sw).toBeLessThanOrEqual(image.width + 1e-9);
        expect(sy + sh).toBeLessThanOrEqual(image.height + 1e-9);
        expect(dx).toBeGreaterThanOrEqual(0);
        expect(dy).toBeGreaterThanOrEqual(0);
        expect(dx + dw).toBeLessThanOrEqual(width);
        expect(dy + dh).toBeLessThanOrEqual(height);
        expect(dx === 0 || dy === 0 || dx + dw === width || dy + dh === height).toBe(true);
      }
      const [, , , , , , , dw] = drawImage.mock.calls[0];
      cornerWidth ??= dw;
      expect(dw).toBe(cornerWidth);
      // Export resolution changes sampling only, never corner sizes or grain repeat positions.
      const exportedCalls = drawImage.mock.calls.map(call => call.slice(5));
      drawImage.mockClear();
      drawForestButtonFrame(ctx, { width: asset.sourceWidth, height: asset.sourceHeight } as HTMLImageElement, width, height);
      expect(drawImage.mock.calls.map(call => call.slice(5))).toEqual(exportedCalls);
    }
  });

  it('caches dedicated action frames and preserves the trimmed artwork proportions in every state', () => {
    const { scene, textures, createCanvas } = fixture();
    const keys = new Set<string>();
    for (const frame of ['ready', 'world'] as const) for (const intent of ['primary', 'neutral', 'disabled'] as const) {
      for (const state of ['rest', 'hover', 'press'] as const) {
        const key = ensureForestActionButton(scene, 484, 80, frame, intent, state);
        expect(keys.has(key)).toBe(false);
        keys.add(key);
        const [, dx, dy, dw, dh] = textures.get(key).context.drawImage.mock.calls[0];
        expect(dw / dh).toBeCloseTo(FOREST_ASSETS[frame].sourceWidth / FOREST_ASSETS[frame].sourceHeight);
        expect(dx).toBeGreaterThanOrEqual(0);
        expect(dy).toBeGreaterThanOrEqual(0);
        expect(dx + dw).toBeLessThanOrEqual(484);
        expect(dy + dh).toBeLessThanOrEqual(80);
        const count = createCanvas.mock.calls.length;
        expect(ensureForestActionButton(scene, 484, 80, frame, intent, state)).toBe(key);
        expect(createCanvas).toHaveBeenCalledTimes(count);
      }
    }
  });
  it('keeps wood grain repeat lengths in buttons, panels and the world sign after resizing', () => {
    const { scene, textures } = fixture();
    const keys = [ensureForestButton(scene, 220, 44, 'neutral', 'rest'),
      ensureForestPanel(scene, 300, 180), ensureForestActionButton(scene, 280, 80, 'world', 'neutral', 'rest')];
    for (const key of keys) {
      const [sx, sy] = textures.get(key).context.scale.mock.calls[0];
      expect(sx * FOREST_ASSETS.wood.width).toBeCloseTo(.35 * FOREST_ASSETS.wood.sourceWidth);
      expect(sy * FOREST_ASSETS.wood.height).toBeCloseTo(.35 * FOREST_ASSETS.wood.sourceHeight);
    }
  });
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
