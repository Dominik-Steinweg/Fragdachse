import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 } }));

import {
  GPU_VFX_ATLAS,
  GPU_VFX_ATLAS_KEY,
  GPU_VFX_ATLAS_PADDING,
  GpuVfxFrameId,
  buildGpuVfxAtlas,
  getGpuVfxFrame,
  packGpuVfxAtlas,
  resetGpuVfxAtlasForTests,
} from '../src/effects/gpu/GpuVfxAtlas';
import {
  TEX_EXPLOSION_EMBER,
  TEX_EXPLOSION_SPARK,
  TEX_STINK_PUFF,
} from '../src/effects/gpu/GpuVfxSourceTextures';
import {
  TEX_FLAME_CORE,
  TEX_FLAME_EMBER,
  TEX_FLAME_SPARK,
  TEX_VOID_FLAME_CORE,
  TEX_VOID_FLAME_EMBER,
  TEX_VOID_FLAME_SPARK,
} from '../src/effects/FlameShared';
import { makeFakeGpuVfxScene } from './fakeGpuVfxScene';

function build() {
  const scene = makeFakeGpuVfxScene();
  buildGpuVfxAtlas(scene as never);
  return { scene, atlas: scene.textures.get(GPU_VFX_ATLAS_KEY) };
}

beforeEach(() => {
  resetGpuVfxAtlasForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('gpu vfx atlas', () => {
  it('packs into the smallest fitting power of two', () => {
    const layout = packGpuVfxAtlas();
    // Die Groesse steht nicht im Code, sie ergibt sich aus dem Manifest.
    expect(layout.size & (layout.size - 1)).toBe(0);
    expect(layout.size).toBe(128);
    expect(layout.rects.length).toBe(GPU_VFX_ATLAS.length);
  });

  it('keeps every frame padded against its neighbours and the border', () => {
    // Das Spiel laeuft mit `smoothPixelArt`; ein bilinearer Tap reicht bis zu einem Texel ueber
    // die Frame-Kante hinaus.
    const { size, rects } = packGpuVfxAtlas();
    const pad = GPU_VFX_ATLAS_PADDING;

    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(pad);
      expect(rect.y).toBeGreaterThanOrEqual(pad);
      expect(rect.x + rect.width + pad).toBeLessThanOrEqual(size);
      expect(rect.y + rect.height + pad).toBeLessThanOrEqual(size);
    }

    for (let a = 0; a < rects.length; a += 1) {
      for (let b = a + 1; b < rects.length; b += 1) {
        const first = rects[a];
        const second = rects[b];
        const gapX = first.x + first.width + pad <= second.x || second.x + second.width + pad <= first.x;
        const gapY = first.y + first.height + pad <= second.y || second.y + second.height + pad <= first.y;
        expect(gapX || gapY).toBe(true);
      }
    }
  });

  it('registers __void first so a member without a frame stays invisible', () => {
    // `SpriteGPULayer` faellt ohne `member.frame` auf `layer.frame` zurueck. Waere das `__BASE`,
    // zeichnete ein vergessener Frame den *gesamten* Atlas als bildschirmfuellendes Quad.
    const { atlas } = build();
    expect(atlas.firstFrame).toBe('__void');
    expect(atlas.get('__void').cutWidth).toBe(1);
    expect(atlas.get('__void').cutHeight).toBe(1);
    // Einfuegereihenfolge; daran haengen Phasers Frame-Indizes.
    expect(atlas.getFrameNames(true)[1]).toBe('__void');
  });

  it('blits every source texture pixel-exactly', () => {
    const { atlas } = build();
    const blitted = GPU_VFX_ATLAS.filter((entry) => entry.sourceTextureKey !== null);
    expect(atlas.drawCalls.length).toBe(blitted.length);

    for (const call of atlas.drawCalls) {
      expect(call.smoothing).toBe(false);
      expect(call.composite).toBe('source-over');
      expect(Number.isInteger(call.x)).toBe(true);
      expect(Number.isInteger(call.y)).toBe(true);
    }
    expect(atlas.refreshed).toBe(1);
  });

  it('creates the source textures it needs, whoever ran first', () => {
    // Der Atlas entsteht vor den Renderern; die `ensure`-Callbacks machen die Reihenfolge egal.
    const { scene } = build();
    for (const entry of GPU_VFX_ATLAS) {
      if (entry.sourceTextureKey) expect(scene.textures.exists(entry.sourceTextureKey)).toBe(true);
    }
    // `stink_puff` bleibt eigenstaendig bestehen – der klassische Spawn-Burst benutzt sie weiter.
    expect(scene.textures.exists(TEX_STINK_PUFF)).toBe(true);
    expect(scene.textures.exists(TEX_EXPLOSION_SPARK)).toBe(true);
    expect(scene.textures.exists(TEX_EXPLOSION_EMBER)).toBe(true);
    expect(scene.textures.exists(TEX_FLAME_CORE)).toBe(true);
    expect(scene.textures.exists(TEX_FLAME_EMBER)).toBe(true);
    expect(scene.textures.exists(TEX_FLAME_SPARK)).toBe(true);
    expect(scene.textures.exists(TEX_VOID_FLAME_CORE)).toBe(true);
    expect(scene.textures.exists(TEX_VOID_FLAME_EMBER)).toBe(true);
    expect(scene.textures.exists(TEX_VOID_FLAME_SPARK)).toBe(true);
  });

  it('resolves every manifest id to its own frame', () => {
    build();
    for (const entry of GPU_VFX_ATLAS) {
      expect(getGpuVfxFrame(entry.id).name).toBe(entry.frame);
    }
    // Die Ids sind eigene, stabile Manifest-Ids – nicht Phasers Frame-Indizes.
    expect(getGpuVfxFrame(GpuVfxFrameId.StinkPuff).name).toBe('stink-puff');
    expect(getGpuVfxFrame(GpuVfxFrameId.FlameCoreVoid).name).toBe('flame-core-void');
    expect(getGpuVfxFrame(GpuVfxFrameId.FlameOuterVoid).name).toBe('flame-outer-void');
    expect(getGpuVfxFrame(GpuVfxFrameId.FlameSparkVoid).name).toBe('flame-spark-void');
    expect(getGpuVfxFrame(GpuVfxFrameId.ExplosionSpark).name).toBe('explosion-spark');
    expect(getGpuVfxFrame(GpuVfxFrameId.ExplosionEmber).name).toBe('explosion-ember');
    expect(new Set(GPU_VFX_ATLAS.map((entry) => entry.id)).size).toBe(GPU_VFX_ATLAS.length);
  });

  it('is idempotent and never blits twice', () => {
    const { scene, atlas } = build();
    const calls = atlas.drawCalls.length;

    buildGpuVfxAtlas(scene as never);
    expect(atlas.drawCalls.length).toBe(calls);
    expect(atlas.refreshed).toBe(1);
  });

  it('refuses to hand out a frame before the atlas is built', () => {
    expect(() => getGpuVfxFrame(GpuVfxFrameId.StinkPuff)).toThrow();
  });
});
