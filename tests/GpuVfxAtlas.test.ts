import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 } }));

import {
  GPU_VFX_ATLAS,
  GPU_VFX_ATLAS_KEY,
  GPU_VFX_ATLAS_PADDING,
  GPU_VFX_DEATH_MORPH_FRAME_IDS,
  GpuVfxFrameId,
  buildGpuVfxAtlas,
  getGpuVfxFrame,
  packGpuVfxAtlas,
  resetGpuVfxAtlasForTests,
} from '../src/effects/gpu/GpuVfxAtlas';
import {
  TEX_EXPLOSION_EMBER,
  TEX_EXPLOSION_FIREBALL_A,
  TEX_EXPLOSION_FIREBALL_B,
  TEX_EXPLOSION_CORE,
  TEX_EXPLOSION_SMOKE,
  TEX_EXPLOSION_STREAK,
  TEX_EXPLOSION_CHUNK,
  TEX_EXPLOSION_RING,
  TEX_EXPLOSION_SPARK,
  TEX_STINK_PUFF,
  TEX_MUZZLE_FLASH,
  TEX_MUZZLE_ENERGY,
  TEX_MUZZLE_SPARK,
  TEX_DEATH_MORPH_COMPACT,
  TEX_DEATH_MORPH_FRAYED,
  TEX_DEATH_MORPH_POROUS,
  TEX_DEATH_MORPH_FRAGMENTED,
  TEX_DEATH_MORPH_DUST,
  TEX_DEATH_MORPH_FINE_DUST,
  TEX_DEATH_MORPH_HAZE,
  TEX_DEATH_MORPH_VAPOR,
  TEX_DEATH_DUST_MOTE_A,
  TEX_DEATH_DUST_MOTE_B,
  TEX_DEATH_DUST_MOTE_C,
  TEX_DEATH_DUST_MOTE_D,
  TEX_DEATH_DUST_MOTE_E,
  ensureDeathMorphTextures,
} from '../src/effects/gpu/GpuVfxSourceTextures';
import {
  DEATH_MORPH_FRAME_COUNT,
  DEATH_MORPH_FRAME_SIZE,
  sampleDeathMorphBlend,
  writeDeathMorphPixels,
} from '../src/effects/gpu/DeathMorphFrames';
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
  it('interpolates alpha without darkening shared or transparent pixels', () => {
    const from = new Uint8ClampedArray([0, 0, 0, 0, 255, 255, 255, 200, 255, 255, 255, 144]);
    const to = new Uint8ClampedArray([255, 255, 255, 240, 255, 255, 255, 40, 255, 255, 255, 144]);
    const output = new Uint8ClampedArray(from.length);
    writeDeathMorphPixels(output, from, to, 0.25);
    expect([...output]).toEqual([255, 255, 255, 60, 255, 255, 255, 160, 255, 255, 255, 144]);
    writeDeathMorphPixels(output, from, to, 0);
    expect([...output]).toEqual([255, 255, 255, 0, 255, 255, 255, 200, 255, 255, 255, 144]);
    writeDeathMorphPixels(output, from, to, 1);
    expect(output).toEqual(to);
  });

  it('bakes the whole morph once with fixed geometry and exact endpoint alpha', () => {
    const scene = makeFakeGpuVfxScene();
    ensureDeathMorphTextures(scene as never);
    const sources = [
      TEX_DEATH_MORPH_COMPACT, TEX_DEATH_MORPH_FRAYED, TEX_DEATH_MORPH_POROUS,
      TEX_DEATH_MORPH_FRAGMENTED, TEX_DEATH_MORPH_DUST, TEX_DEATH_MORPH_FINE_DUST,
      TEX_DEATH_MORPH_HAZE, TEX_DEATH_MORPH_VAPOR,
    ];
    const reads = sources.map((key, index) => {
      const data = new Uint8ClampedArray(DEATH_MORPH_FRAME_SIZE ** 2 * 4);
      for (let offset = 3; offset < data.length; offset += 4) data[offset] = index * 32;
      return vi.spyOn(scene.textures.get(key).context, 'getImageData').mockReturnValue({ data });
    });
    const layout = packGpuVfxAtlas();
    const atlas = scene.textures.createCanvas(GPU_VFX_ATLAS_KEY, layout.size, layout.size);
    const pixels = new Map<string, number[]>();
    vi.spyOn(atlas.context, 'putImageData').mockImplementation((image, x, y) => {
      pixels.set(`${x},${y}`, [...image.data.slice(0, 4)]);
    });
    buildGpuVfxAtlas(scene as never);
    expect(new Set(GPU_VFX_ATLAS.map((entry) => entry.id)).size).toBe(GPU_VFX_ATLAS.length);
    expect(GPU_VFX_DEATH_MORPH_FRAME_IDS).toHaveLength(DEATH_MORPH_FRAME_COUNT);
    const baked = GPU_VFX_DEATH_MORPH_FRAME_IDS.map((id) => {
      const frame = getGpuVfxFrame(id);
      expect(frame.cutWidth).toBe(DEATH_MORPH_FRAME_SIZE);
      expect(frame.cutHeight).toBe(DEATH_MORPH_FRAME_SIZE);
      return pixels.get(`${frame.cutX},${frame.cutY}`)!;
    });
    expect(baked[0]).toEqual([255, 255, 255, 0]);
    expect(baked.at(-1)).toEqual([255, 255, 255, 224]);
    expect(baked.slice(1, 10).every((pixel) => pixel[3] > 0 && pixel[3] < 32)).toBe(true);
    expect(sampleDeathMorphBlend(0).from).toBe(TEX_DEATH_MORPH_COMPACT);
    expect(sampleDeathMorphBlend(1)).toMatchObject({ to: TEX_DEATH_MORPH_VAPOR, mix: 1 });
    // Keine Rueckspruenge oder groben Spruenge zwischen aufeinanderfolgenden Motiven.
    for (let index = 1; index < baked.length; index += 1) {
      const delta = baked[index][3] - baked[index - 1][3];
      expect(delta).toBeGreaterThanOrEqual(0);
      expect(delta).toBeLessThan(8);
    }
    buildGpuVfxAtlas(scene as never);
    expect(reads.every((read) => read.mock.calls.length === 1)).toBe(true);
    expect(atlas.context.putImageData).toHaveBeenCalledTimes(DEATH_MORPH_FRAME_COUNT);
    expect(atlas.refreshed).toBe(1);
  });

  it('uses constant longitudinal cross-sections for continuous flight strips', () => {
    const { atlas } = build();
    for (const name of ['flight-core-strip', 'flight-wake-strip']) {
      const frame = atlas.get(name);
      expect(frame.cutWidth).toBe(1);
      expect(frame.cutHeight).toBeGreaterThan(1);
    }
  });

  it('packs into the smallest fitting power of two', () => {
    const layout = packGpuVfxAtlas();
    // Die Groesse steht nicht im Code, sie ergibt sich aus dem Manifest.
    expect(layout.size & (layout.size - 1)).toBe(0);
    // Vorbereitete Morphs duerfen den garantierten Atlasrahmen nicht sprengen.
    expect(layout.size).toBeLessThanOrEqual(2048);
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
    expect(scene.textures.exists(TEX_EXPLOSION_FIREBALL_A)).toBe(true);
    expect(scene.textures.exists(TEX_EXPLOSION_FIREBALL_B)).toBe(true);
    expect(scene.textures.exists(TEX_EXPLOSION_CORE)).toBe(true);
    expect(scene.textures.exists(TEX_EXPLOSION_SMOKE)).toBe(true);
    expect(scene.textures.exists(TEX_EXPLOSION_STREAK)).toBe(true);
    expect(scene.textures.exists(TEX_EXPLOSION_CHUNK)).toBe(true);
    expect(scene.textures.exists(TEX_EXPLOSION_RING)).toBe(true);
    expect(scene.textures.exists(TEX_FLAME_CORE)).toBe(true);
    expect(scene.textures.exists(TEX_FLAME_EMBER)).toBe(true);
    expect(scene.textures.exists(TEX_FLAME_SPARK)).toBe(true);
    expect(scene.textures.exists(TEX_VOID_FLAME_CORE)).toBe(true);
    expect(scene.textures.exists(TEX_VOID_FLAME_EMBER)).toBe(true);
    expect(scene.textures.exists(TEX_VOID_FLAME_SPARK)).toBe(true);
    expect(scene.textures.exists(TEX_MUZZLE_FLASH)).toBe(true);
    expect(scene.textures.exists(TEX_MUZZLE_ENERGY)).toBe(true);
    expect(scene.textures.exists(TEX_MUZZLE_SPARK)).toBe(true);
    expect(scene.textures.exists(TEX_DEATH_MORPH_COMPACT)).toBe(true);
    expect(scene.textures.exists(TEX_DEATH_MORPH_FRAYED)).toBe(true);
    expect(scene.textures.exists(TEX_DEATH_MORPH_POROUS)).toBe(true);
    expect(scene.textures.exists(TEX_DEATH_MORPH_FRAGMENTED)).toBe(true);
    expect(scene.textures.exists(TEX_DEATH_MORPH_DUST)).toBe(true);
    expect(scene.textures.exists(TEX_DEATH_MORPH_FINE_DUST)).toBe(true);
    expect(scene.textures.exists(TEX_DEATH_DUST_MOTE_A)).toBe(true);
    expect(scene.textures.exists(TEX_DEATH_DUST_MOTE_B)).toBe(true);
    expect(scene.textures.exists(TEX_DEATH_DUST_MOTE_C)).toBe(true);

    for (const key of [
      TEX_DEATH_MORPH_COMPACT,
      TEX_DEATH_MORPH_FRAYED,
      TEX_DEATH_MORPH_POROUS,
      TEX_DEATH_MORPH_FRAGMENTED,
      TEX_DEATH_MORPH_DUST,
      TEX_DEATH_MORPH_FINE_DUST,
      TEX_DEATH_MORPH_HAZE,
      TEX_DEATH_MORPH_VAPOR,
      TEX_DEATH_DUST_MOTE_A,
      TEX_DEATH_DUST_MOTE_B,
      TEX_DEATH_DUST_MOTE_C,
      TEX_DEATH_DUST_MOTE_D,
      TEX_DEATH_DUST_MOTE_E,
    ]) {
      expect(scene.textures.get(key)).toMatchObject({ width: 48, height: 48 });
    }
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
    expect(getGpuVfxFrame(GpuVfxFrameId.ExplosionFireballA).name).toBe('explosion-fireball-a');
    expect(getGpuVfxFrame(GpuVfxFrameId.ExplosionFireballB).name).toBe('explosion-fireball-b');
    expect(getGpuVfxFrame(GpuVfxFrameId.ExplosionCore).name).toBe('explosion-core');
    expect(getGpuVfxFrame(GpuVfxFrameId.ExplosionSmoke).name).toBe('explosion-smoke');
    expect(getGpuVfxFrame(GpuVfxFrameId.ExplosionStreak).name).toBe('explosion-streak');
    expect(getGpuVfxFrame(GpuVfxFrameId.ExplosionChunk).name).toBe('explosion-chunk');
    expect(getGpuVfxFrame(GpuVfxFrameId.ExplosionRing).name).toBe('explosion-ring');
    expect(getGpuVfxFrame(GpuVfxFrameId.GroundFireSurfaceB).name).toBe('ground-fire-surface-b');
    expect(getGpuVfxFrame(GpuVfxFrameId.GroundFireSurfaceC).name).toBe('ground-fire-surface-c');
    expect(getGpuVfxFrame(GpuVfxFrameId.GroundFireBedB).name).toBe('ground-fire-bed-b');
    expect(getGpuVfxFrame(GpuVfxFrameId.MuzzleFlash).name).toBe('muzzle-flash');
    expect(getGpuVfxFrame(GpuVfxFrameId.MuzzleEnergy).name).toBe('muzzle-energy');
    expect(getGpuVfxFrame(GpuVfxFrameId.MuzzleSpark).name).toBe('muzzle-spark');
    expect(getGpuVfxFrame(GpuVfxFrameId.DeathMorphCompact).name).toBe('death-morph-compact');
    expect(getGpuVfxFrame(GpuVfxFrameId.DeathMorphFrayed).name).toBe('death-morph-frayed');
    expect(getGpuVfxFrame(GpuVfxFrameId.DeathMorphPorous).name).toBe('death-morph-porous');
    expect(getGpuVfxFrame(GpuVfxFrameId.DeathMorphFragmented).name)
      .toBe('death-morph-fragmented');
    expect(getGpuVfxFrame(GpuVfxFrameId.DeathMorphDust).name).toBe('death-morph-dust');
    expect(getGpuVfxFrame(GpuVfxFrameId.DeathMorphFineDust).name)
      .toBe('death-morph-fine-dust');
    expect(getGpuVfxFrame(GpuVfxFrameId.DeathDustMoteA).name).toBe('death-dust-mote-a');
    expect(getGpuVfxFrame(GpuVfxFrameId.DeathDustMoteB).name).toBe('death-dust-mote-b');
    expect(getGpuVfxFrame(GpuVfxFrameId.DeathDustMoteC).name).toBe('death-dust-mote-c');
    expect(getGpuVfxFrame(GpuVfxFrameId.DeathDustMoteD).name).toBe('death-dust-mote-d');
    expect(getGpuVfxFrame(GpuVfxFrameId.DeathDustMoteE).name).toBe('death-dust-mote-e');
    expect(getGpuVfxFrame(GpuVfxFrameId.DeathMorphHaze).name).toBe('death-morph-haze');
    expect(getGpuVfxFrame(GpuVfxFrameId.DeathMorphVapor).name).toBe('death-morph-vapor');
    expect(GpuVfxFrameId.DeathMorphCompact).toBeGreaterThan(GpuVfxFrameId.MuzzleSpark);
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
