import { EventEmitter } from 'node:events';
import { GAME_WIDTH, GAME_HEIGHT } from '../src/config';
import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({}));
vi.mock('../src/ui/LivingBarEffect', () => ({ rgbStr: () => 'rgba(0,0,0,1)' }));
import { drawModalFrame, ensureModalFrame, ensureModalPanelTexture, getForestModalSurfaces, MODAL_FRAME_ASSET, mountForestModal } from '../src/ui/ForestModal';
import { ensureForestFrame } from '../src/ui/forestTextures';
import { ensureCoopDefenseItemCellTexture } from '../src/ui/coopDefenseItemIcons';

function fixture() {
  const textures = new Map<string, any>([[MODAL_FRAME_ASSET.key, { getSourceImage: () => ({ width: 1280, height: 1280 }) }]]);
  const createCanvas = vi.fn((key: string, width: number, height: number) => {
    const context = { drawImage: vi.fn(), scale() {}, clearRect() {}, save() {}, restore() {}, clip() {}, beginPath() {}, moveTo() {}, arcTo() {},
      closePath() {}, fillRect() {}, fill() {}, stroke() {}, createLinearGradient: () => ({ addColorStop() {} }) };
    const texture = { width, height, context, refresh() {} }; textures.set(key, texture); return texture;
  });
  const scene: any = { textures: { exists: (key: string) => textures.has(key), get: (key: string) => textures.get(key), createCanvas },
    add: { image: (_x: number, _y: number, key: string) => ({ key, setDisplaySize() { return this; }, setScrollFactor() { return this; } }) } };
  return { scene, createCanvas };
}

describe('forest modal decoration', () => {
  it('preserves one scale in every cropped rail and corner across window shapes, without drawing the center', () => {
    const image = { width: 1280, height: 1280 } as HTMLImageElement;
    let referenceScale: number | undefined;
    for (const [w, h] of [[780, 700], [800, 920], [1860, 1064], [1780, 980]]) {
      const drawImage = vi.fn(); drawModalFrame({ drawImage } as unknown as CanvasRenderingContext2D, image, w, h);
      for (const [, sx, sy, sw, sh, dx, dy, dw, dh] of drawImage.mock.calls) {
        referenceScale ??= dw / sw;
        expect(dw / sw).toBeCloseTo(referenceScale);
        expect(dh / sh).toBeCloseTo(referenceScale);
        expect(dx).toBeGreaterThanOrEqual(0); expect(dy).toBeGreaterThanOrEqual(0);
        expect(dx + dw).toBeLessThanOrEqual(w + .001); expect(dy + dh).toBeLessThanOrEqual(h + .001);
        expect(sx + sw).toBeLessThanOrEqual(image.width + .001); expect(sy + sh).toBeLessThanOrEqual(image.height + .001);
        expect(dx < w / 2 && dx + dw > w / 2 && dy < h / 2 && dy + dh > h / 2).toBe(false);
      }
    }
  });
  it('reuses textures and keeps lobby, modal sizes and item material/state caches separate', () => {
    const { scene, createCanvas } = fixture();
    const frame = ensureModalFrame(scene, 780, 700);
    const glass = ensureModalPanelTexture(scene, 'help', 780, 700);
    const count = createCanvas.mock.calls.length;
    expect(ensureModalFrame(scene, 780, 700)).toBe(frame);
    expect(ensureModalPanelTexture(scene, 'another-caller', 780, 700)).toBe(glass);
    expect(createCanvas).toHaveBeenCalledTimes(count);
    expect(ensureForestFrame(scene, 780, 700)).not.toBe(frame);
    expect(ensureModalFrame(scene, 1780, 980)).not.toBe(frame);
    const cells = new Set<string>();
    for (const skin of ['default', 'forest'] as const) for (const state of ['rest', 'hot', 'empty'] as const) {
      const key = ensureCoopDefenseItemCellTexture(scene, 96, 96, 0xaaccdd, state, skin);
      expect(cells.has(key)).toBe(false); cells.add(key);
      expect(ensureCoopDefenseItemCellTexture(scene, 96, 96, 0xaaccdd, state, skin)).toBe(key);
    }
  });
  it.each(['panel', 'screen'] as const)('keeps %s blur visibility and lifetime tied to the modal', backdrop => {
    const { scene } = fixture();
    for (let i = 0; i < 4; i++) {
      const content = {}, tooltip = {}, ghost = {};
      const root: any = Object.assign(new EventEmitter(), { visible: true, alpha: 1, x: 0, y: 0, list: [content, tooltip, ghost],
        add(child: any) { this.list.push(child); }, bringToTop(child: any) { this.list.splice(this.list.indexOf(child), 1); this.list.push(child); } });
      const frame = mountForestModal(scene, root, 780, 700, [ghost as never, tooltip as never], backdrop);
      expect(root.list).toEqual([content, frame, ghost, tooltip]);
      expect(frame).not.toHaveProperty('input');
      expect(getForestModalSurfaces(scene)).toHaveLength(1);
      if (backdrop === 'screen') expect(getForestModalSurfaces(scene)[0]).toEqual({
        x: 0, y: 0, width: GAME_WIDTH, height: GAME_HEIGHT, radius: 0, alpha: 1,
      });
      else expect(getForestModalSurfaces(scene)[0].width).toBeLessThan(GAME_WIDTH);
      root.visible = false; expect(getForestModalSurfaces(scene)).toEqual([]);
      root.visible = true; root.alpha = 0; expect(getForestModalSurfaces(scene)).toEqual([]);
      root.alpha = .5; expect(getForestModalSurfaces(scene)[0].alpha).toBe(.5);
      root.emit('destroy'); expect(getForestModalSurfaces(scene)).toEqual([]);
      expect(root.listenerCount('destroy')).toBe(0);
    }
  });
});
