import type * as Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';
import { LobbyMerchantRenderer } from '../src/arena/LobbyMerchantRenderer';
import { LOBBY_DEALER_ASSET, preloadLobbyMerchantAssets } from '../src/animations/LobbyMerchantAssets';
import { getWalkingSheetForStaticTexture } from '../src/animations/BadgerAnimations';
import { LOBBY_MERCHANT } from '../src/config/authoring/lobbyMerchant';
import { WorldPresentationBinding } from '../src/world/WorldPresentationBinding';
import type { WorldMetrics } from '../src/world/WorldMetrics';

vi.mock('phaser', () => ({}));

function fixture(missing: readonly string[] = []) {
  const objects: any[] = [];
  const create = (x: number, y: number, texture: string) => {
    const object = { x, y, texture, setOrigin: vi.fn().mockReturnThis(), setDisplaySize: vi.fn().mockReturnThis(),
      setDepth: vi.fn().mockReturnThis(), setRotation: vi.fn().mockReturnThis(), play: vi.fn(), destroy: vi.fn() };
    objects.push(object); return object;
  };
  const registered = new Set<string>();
  const scene = { textures: { exists: (key: string) => !missing.includes(key) },
    add: { image: vi.fn(create), sprite: vi.fn(create) },
    anims: { exists: (key: string) => registered.has(key),
      create: vi.fn(config => registered.add(config.key)),
      generateFrameNumbers: vi.fn((key, config) => config.frames.map((frame: number) => ({ key, frame }))) } };
  const metrics = { offsetX: 120, offsetY: 48 } as WorldMetrics;
  const render = () => new LobbyMerchantRenderer(scene as unknown as Phaser.Scene, metrics);
  return { scene, objects, render, metrics };
}

describe('Lobby merchant presentation', () => {
  it('loads and registers only the authored idle clip, independently of locomotion', () => {
    const loader = { image: vi.fn(), spritesheet: vi.fn() };
    preloadLobbyMerchantAssets(loader as unknown as Phaser.Loader.LoaderPlugin);
    expect(loader.image.mock.calls[0][0]).toBe(LOBBY_MERCHANT.stall.textureKey);
    expect(loader.spritesheet.mock.calls[0][0]).toBe(LOBBY_DEALER_ASSET.sheetTextureKey);
    expect(getWalkingSheetForStaticTexture(LOBBY_MERCHANT.dealer.textureKey)).toBeNull();
    const f = fixture();
    f.render(); f.render();
    const idle = LOBBY_DEALER_ASSET.clips.find(clip => clip.name === 'idle')!;
    expect(f.scene.anims.create).toHaveBeenCalledTimes(1);
    expect(f.scene.anims.create.mock.calls[0][0]).toMatchObject({ key: 'dawn_dealer_sheet_idle', frameRate: idle.frameRate, repeat: -1,
      frames: idle.frames.map(frame => ({ key: LOBBY_DEALER_ASSET.sheetTextureKey, frame })) });
    expect(f.objects[0].setDisplaySize).toHaveBeenCalledWith(96, 96);
    expect(f.objects[1].setDisplaySize).toHaveBeenCalledWith(38, 38);
    expect(f.objects[1].play).toHaveBeenCalledWith('dawn_dealer_sheet_idle');
    expect(f.objects[1].y).toBeLessThan(f.objects[0].y);
    expect(f.objects[1].setRotation.mock.calls[0][0]).toBeLessThan(0);
  });

  it('skips each missing texture and destroys sprites with the owning presentation exactly once', () => {
    const absent = fixture([LOBBY_MERCHANT.stall.textureKey, LOBBY_DEALER_ASSET.sheetTextureKey]);
    absent.render().destroy();
    expect(absent.objects).toEqual([]);
    expect(absent.scene.anims.create).not.toHaveBeenCalled();
    const partial = fixture([LOBBY_DEALER_ASSET.sheetTextureKey]);
    partial.render().destroy();
    expect(partial.objects).toHaveLength(1);
    const f = fixture();
    const binding = new WorldPresentationBinding({} as never, {} as never, { destroyPresentation: vi.fn() });
    binding.lobbyMerchant = f.render();
    binding.destroy(); binding.destroy();
    expect(binding.lobbyMerchant).toBeNull();
    for (const object of f.objects) expect(object.destroy).toHaveBeenCalledTimes(1);
  });
});
