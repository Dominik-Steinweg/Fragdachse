import { describe, expect, it, vi } from 'vitest';
import { preloadRuntimeAtlas, runtimeImage, setRuntimeTexture, runtimeTextureExists, runtimeTextureFrame, runtimeTextureKey, runtimeFrameName, assertRuntimeAtlasesReady } from '../src/assets/RuntimeAtlases';
import atlas from '../src/assets/manifests/runtime-atlas-frames.json';
import { stampGroundCover } from '../src/arena/GroundCoverLayer';

it('resolves logical IDs to atlas frames without allocating alias textures and rejects missing frames', () => {
  const pages = new Map(Object.values(atlas.groups).flat().map(page => [page.key, new Set(page.frames)]));
  const textures = { exists: (key:string) => pages.has(key) || key==='standalone',
    get: (key:string) => ({has:(frame:string) => pages.get(key)?.has(frame) ?? false}),
    getFrame: vi.fn((key:string, frame?:string) => ({key,frame,width:64,height:32})) };
  expect(() => assertRuntimeAtlasesReady(textures as never)).not.toThrow();
  for(const group of Object.values(atlas.groups))for(const page of group)for(const id of page.frames){
    expect(runtimeTextureKey(id)).toBe(page.key);expect(runtimeFrameName(id)).toBe(id);
    expect(runtimeTextureExists(textures as never,id)).toBe(true);
  }
  expect(runtimeTextureKey('standalone')).toBe('standalone');expect(runtimeFrameName('standalone')).toBeUndefined();
  expect(runtimeTextureExists(textures as never,'standalone')).toBe(true);
  const page=atlas.groups.icons[0], id=page.frames[0];
  const image={setTexture:vi.fn()}, scene={textures,add:{image:vi.fn(()=>image)}};
  runtimeImage(scene as never,12,13,id);setRuntimeTexture(image as never,id);
  expect(scene.add.image).toHaveBeenCalledWith(12,13,page.key,id);
  expect(image.setTexture).toHaveBeenCalledWith(page.key,id);
  runtimeTextureFrame(textures as never,id);expect(textures.getFrame).toHaveBeenLastCalledWith(page.key,id);
  const cover=atlas.groups.groundcover[0], layer={stamp:vi.fn()};
  stampGroundCover(scene as never,layer as never,[{textureKey:cover.frames[0],worldX:100,worldY:200,sizePx:32,rotation:.2,alpha:.7,mirrorX:true,mirrorY:false}],10,20);
  expect(layer.stamp).toHaveBeenCalledWith(cover.key,cover.frames[0],110,220,{alpha:.7,rotation:.2,scaleX:-.5,scaleY:.5});
  pages.get(page.key)!.delete(id);
  expect(runtimeTextureExists(textures as never,id)).toBe(false);
  expect(()=>assertRuntimeAtlasesReady(textures as never)).toThrow(id);
});

it('queues only atlas image/JSON pairs with hash URLs', () => {
  const loader={atlas:vi.fn()};
  for(const group of ['icons','decals','groundcover'] as const)preloadRuntimeAtlas(loader as never,group);
  expect(loader.atlas).toHaveBeenCalledTimes(Object.values(atlas.groups).flat().length);
  for(const [key,image,data] of loader.atlas.mock.calls){
    expect(key).toMatch(/^atlas_/);expect(image).toMatch(/\.webp\?v=[a-f0-9]{64}$/);expect(data).toMatch(/\.json\?v=[a-f0-9]{64}$/);
  }
});

vi.mock('phaser', () => ({
  Textures: { FilterMode: { LINEAR: 'LINEAR' } },
}));

import {
  fitLoadoutIcon,
  getLoadoutIconDisplaySize,
  getLoadoutIconTextureKey,
} from '../src/ui/LoadoutIconLayout';

describe('loadout icon layout', () => {
  it('fits the high-resolution primary ASMD icon to the 32px display box', () => {
    expect(getLoadoutIconDisplaySize('ASMD_PRIM', 256, 256, 32, 32)).toEqual({
      width: 32,
      height: 32,
    });
  });

  it('fits the secondary ASMD icon without an additional scale', () => {
    expect(getLoadoutIconDisplaySize('ASMD_SEC', 256, 256, 44, 44)).toEqual({
      width: 44,
      height: 44,
    });
  });

  it.each(['ASMD_PRIM', 'ASMD_SEC'])('uses the normal runtime fit for the high-resolution %s texture', (textureKey) => {
    const image = {
      texture: { key: textureKey },
      frame: { width: 256, height: 256 },
      setDisplaySize: vi.fn(),
    };

    fitLoadoutIcon(image as Parameters<typeof fitLoadoutIcon>[0], 32, 32);

    expect(image.setDisplaySize).toHaveBeenCalledWith(32, 32);
  });

  it.each(['ASMD_PRIM', 'ASMD_SEC'])('keeps the original %s key and uses LINEAR filtering', (textureKey) => {
    const setFilter = vi.fn();
    const scene = {
      textures: {
        exists: vi.fn(() => true),
        get: vi.fn(() => ({ setFilter, has: () => true })),
      },
    };

    expect(getLoadoutIconTextureKey(scene as Parameters<typeof getLoadoutIconTextureKey>[0], textureKey))
      .toBe(textureKey);
    expect(setFilter).toHaveBeenCalledWith('LINEAR');
  });

  it('does not change filtering for standard icons', () => {
    const setFilter = vi.fn();
    const scene = {
      textures: {
        exists: vi.fn(() => true),
        get: vi.fn(() => ({ setFilter, has: () => true })),
      },
    };

    expect(getLoadoutIconTextureKey(scene as Parameters<typeof getLoadoutIconTextureKey>[0], 'P90'))
      .toBe('P90');
    expect(setFilter).not.toHaveBeenCalled();
  });

  it('keeps standard icons at their existing maximum size', () => {
    expect(getLoadoutIconDisplaySize('P90', 32, 32, 32, 32)).toEqual({
      width: 32,
      height: 32,
    });
  });

  it('fits non-square textures proportionally inside the target box', () => {
    expect(getLoadoutIconDisplaySize('custom', 16, 8, 24, 24)).toEqual({
      width: 24,
      height: 12,
    });
  });
});
