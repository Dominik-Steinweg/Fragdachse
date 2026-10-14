import type * as Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';
import { LobbyMerchantRenderer, resolveLobbyMerchantNameplateAlpha } from '../src/arena/LobbyMerchantRenderer';
import { CELL_SIZE } from '../src/config';
import { LOBBY_SPAWN_FOCUS_CELL } from '../src/arena/LobbyWorldLayout';
import { worldCellCenter } from '../src/world/WorldMetrics';
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
      setDepth: vi.fn().mockReturnThis(), setAlpha: vi.fn().mockReturnThis(), setRotation: vi.fn().mockReturnThis(), play: vi.fn(), destroy: vi.fn() };
    objects.push(object); return object;
  };
  const registered = new Set<string>();
  const scene = { textures: { exists: (key: string) => !missing.includes(key) },
    add: { image: vi.fn(create), sprite: vi.fn(create), text: vi.fn(create) },
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
    expect(f.objects[0].setDisplaySize).toHaveBeenCalledWith(LOBBY_MERCHANT.stall.sizeCells * CELL_SIZE, LOBBY_MERCHANT.stall.sizeCells * CELL_SIZE);
    expect(f.objects[1].setDisplaySize).toHaveBeenCalledWith(LOBBY_MERCHANT.dealer.displaySize, LOBBY_MERCHANT.dealer.displaySize);
    expect(f.objects[1].play).toHaveBeenCalledWith('dawn_dealer_sheet_idle');
    const focus = worldCellCenter(f.metrics, LOBBY_SPAWN_FOCUS_CELL.gridX, LOBBY_SPAWN_FOCUS_CELL.gridY);
    const dealer = f.objects[1];
    expect(dealer.setRotation.mock.calls[0][0]).toBeCloseTo(Math.atan2(focus.y - dealer.y, focus.x - dealer.x) + Math.PI / 2);
  });

  it('skips each missing texture and destroys sprites with the owning presentation exactly once', () => {
    const absent = fixture([LOBBY_MERCHANT.stall.textureKey, LOBBY_DEALER_ASSET.sheetTextureKey]);
    absent.render().destroy();
    expect(absent.objects).toEqual([]);
    expect(absent.scene.anims.create).not.toHaveBeenCalled();
    const partial = fixture([LOBBY_DEALER_ASSET.sheetTextureKey]);
    partial.render().destroy();
    expect(partial.objects).toHaveLength(2);
    const f = fixture();
    const binding = new WorldPresentationBinding({} as never, {} as never, { destroyPresentation: vi.fn() });
    binding.lobbyMerchant = f.render();
    binding.destroy(); binding.destroy();
    expect(binding.lobbyMerchant).toBeNull();
    for (const object of f.objects) expect(object.destroy).toHaveBeenCalledTimes(1);
  });

  it('fades in world coordinates from the local player and hides without a player', () => {
    const f = fixture();
    const renderer = f.render();
    const dealer = f.objects[1], nameplate = f.objects[2];
    const position = worldCellCenter(f.metrics, LOBBY_MERCHANT.dealer.gridX, LOBBY_MERCHANT.dealer.gridY);
    expect(dealer).toMatchObject(position);
    expect(nameplate).toMatchObject({ x: position.x,
      y: position.y + LOBBY_MERCHANT.nameplate.offsetYCells * CELL_SIZE });
    expect(nameplate.setAlpha).toHaveBeenLastCalledWith(0);
    const { fullVisibilityCells, hiddenAtCells } = LOBBY_MERCHANT.nameplate;
    renderer.update({ x: dealer.x + fullVisibilityCells * CELL_SIZE, y: dealer.y });
    expect(nameplate.setAlpha).toHaveBeenLastCalledWith(1);
    renderer.update({ x: dealer.x, y: dealer.y - (fullVisibilityCells + hiddenAtCells) / 2 * CELL_SIZE });
    expect(nameplate.setAlpha).toHaveBeenLastCalledWith(0.5);
    renderer.update(null);
    expect(nameplate.setAlpha).toHaveBeenLastCalledWith(0);
  });

  it('clamps the pure fade and decreases smoothly through the authored interval', () => {
    const { fullVisibilityCells: near, hiddenAtCells: far } = LOBBY_MERCHANT.nameplate;
    expect(resolveLobbyMerchantNameplateAlpha(0)).toBe(1);
    expect(resolveLobbyMerchantNameplateAlpha(near)).toBe(1);
    expect(resolveLobbyMerchantNameplateAlpha(far)).toBe(0);
    expect(resolveLobbyMerchantNameplateAlpha(far * 2)).toBe(0);
    expect(resolveLobbyMerchantNameplateAlpha(NaN)).toBe(0);
    let previous = 1;
    for (let step = 1; step <= 20; step++) {
      const alpha = resolveLobbyMerchantNameplateAlpha(near + (far - near) * step / 20);
      expect(alpha).toBeLessThan(previous);
      expect(alpha).toBeGreaterThanOrEqual(0);
      previous = alpha;
    }
    const epsilon = (far - near) / 1000;
    expect(1 - resolveLobbyMerchantNameplateAlpha(near + epsilon)).toBeLessThan(0.00001);
    expect(resolveLobbyMerchantNameplateAlpha(far - epsilon)).toBeLessThan(0.00001);
  });
});
