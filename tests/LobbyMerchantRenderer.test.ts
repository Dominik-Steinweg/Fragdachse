import type * as Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';
import { LobbyMerchantRenderer, resolveLobbyMerchantNameplateAlpha } from '../src/arena/LobbyMerchantRenderer';
import { CELL_SIZE } from '../src/config';
import { LOBBY_SPAWN_FOCUS_CELL } from '../src/arena/LobbyWorldLayout';
import { worldCellCenter } from '../src/world/WorldMetrics';
import { LOBBY_DEALER_ASSET, preloadLobbyMerchantAssets } from '../src/animations/LobbyMerchantAssets';
import { getWalkingSheetForStaticTexture } from '../src/animations/BadgerAnimations';
import { LOBBY_MERCHANT } from '../src/config/authoring/lobbyMerchant';
import { LOBBY_BUILDINGS } from '../src/config/authoring/lobbyBuildings';
import { t } from '../src/i18n';
import { WorldPresentationBinding } from '../src/world/WorldPresentationBinding';
import type { WorldMetrics } from '../src/world/WorldMetrics';

vi.mock('phaser', () => ({ Math: { Vector2: class { constructor(public x: number, public y: number) {} } } }));
vi.mock('../src/effects/EffectUtils', () => ({ registerGraphicsObject: vi.fn() }));

function fixture(missing: readonly string[] = []) {
  const objects: any[] = [];
  const create = (x = 0, y = 0, texture = '') => {
    const object = { x, y, texture, setOrigin: vi.fn().mockReturnThis(), setDisplaySize: vi.fn().mockReturnThis(),
      width: 100, setText: vi.fn(function (this: any, text: string) { this.texture = text; return this; }),
      setPosition: vi.fn(function (this: any, x: number, y: number) { this.x = x; this.y = y; return this; }),
      setVisible: vi.fn().mockReturnThis(), clear: vi.fn().mockReturnThis(),
      fillStyle: vi.fn().mockReturnThis(), lineStyle: vi.fn().mockReturnThis(),
      fillRoundedRect: vi.fn().mockReturnThis(), strokeRoundedRect: vi.fn().mockReturnThis(),
      fillCircle: vi.fn().mockReturnThis(), strokeCircle: vi.fn().mockReturnThis(),
      fillTriangle: vi.fn().mockReturnThis(), setColor: vi.fn().mockReturnThis(), setScale: vi.fn().mockReturnThis(),
      lineBetween: vi.fn().mockReturnThis(), strokePoints: vi.fn().mockReturnThis(),
      setDepth: vi.fn().mockReturnThis(), setAlpha: vi.fn().mockReturnThis(), setRotation: vi.fn().mockReturnThis(), play: vi.fn(), destroy: vi.fn() };
    objects.push(object); return object;
  };
  const registered = new Set<string>();
  const scene = { textures: { exists: (key: string) => !missing.includes(key) },
    add: { image: vi.fn(create), sprite: vi.fn(create), text: vi.fn(create), graphics: vi.fn(() => create()) },
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
    const stall = f.objects.find(object => object.texture === LOBBY_MERCHANT.stall.textureKey);
    const dealer = f.objects.find(object => object.texture === LOBBY_DEALER_ASSET.sheetTextureKey);
    expect(stall.setDisplaySize).toHaveBeenCalledWith(LOBBY_MERCHANT.stall.sizeCells * CELL_SIZE, LOBBY_MERCHANT.stall.sizeCells * CELL_SIZE);
    expect(dealer.setDisplaySize).toHaveBeenCalledWith(LOBBY_MERCHANT.dealer.displaySize, LOBBY_MERCHANT.dealer.displaySize);
    expect(dealer.play).toHaveBeenCalledWith('dawn_dealer_sheet_idle');
    for (const building of LOBBY_BUILDINGS) {
      expect(loader.image.mock.calls.some(call => call[0] === building.textureKey)).toBe(true);
      expect(f.objects.find(object => object.texture === building.textureKey).setDisplaySize).toHaveBeenCalledWith(128, 128);
    }
    const focus = worldCellCenter(f.metrics, LOBBY_SPAWN_FOCUS_CELL.gridX, LOBBY_SPAWN_FOCUS_CELL.gridY);
    expect(dealer.setRotation.mock.calls[0][0]).toBeCloseTo(Math.atan2(focus.y - dealer.y, focus.x - dealer.x) + Math.PI / 2);
  });

  it('skips each missing texture and destroys sprites with the owning presentation exactly once', () => {
    const absent = fixture([LOBBY_MERCHANT.stall.textureKey, LOBBY_DEALER_ASSET.sheetTextureKey, ...LOBBY_BUILDINGS.map(building => building.textureKey)]);
    absent.render().destroy();
    expect(absent.objects).toEqual([]);
    expect(absent.scene.anims.create).not.toHaveBeenCalled();
    const partial = fixture([LOBBY_DEALER_ASSET.sheetTextureKey]);
    partial.render().destroy();
    expect(partial.objects.some(object => object.texture === LOBBY_DEALER_ASSET.sheetTextureKey)).toBe(false);
    expect(partial.objects.some(object => object.texture === LOBBY_MERCHANT.stall.textureKey)).toBe(true);
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
    const dealer = f.objects.find(object => object.texture === LOBBY_DEALER_ASSET.sheetTextureKey);
    const nameplate = f.objects.find(object => object.texture === t('ui.dawn.dealerName'));
    const position = worldCellCenter(f.metrics, LOBBY_MERCHANT.dealer.gridX, LOBBY_MERCHANT.dealer.gridY);
    expect(dealer).toMatchObject(position);
    const stall = f.objects.find(object => object.texture === LOBBY_MERCHANT.stall.textureKey);
    expect(nameplate.x).toBe(stall.x);
    expect(nameplate.y).toBeGreaterThan(stall.y + LOBBY_MERCHANT.stall.sizeCells * CELL_SIZE / 2);
    expect(nameplate.setAlpha).toHaveBeenLastCalledWith(0);
    const { fullVisibilityCells, hiddenAtCells } = LOBBY_MERCHANT.nameplate;
    renderer.update({ x: dealer.x + fullVisibilityCells * CELL_SIZE, y: dealer.y });
    expect(nameplate.setAlpha).toHaveBeenLastCalledWith(1);
    renderer.update({ x: dealer.x, y: dealer.y - (fullVisibilityCells + hiddenAtCells) / 2 * CELL_SIZE });
    expect(nameplate.setAlpha).toHaveBeenLastCalledWith(0.5);
    renderer.update(null);
    expect(nameplate.setAlpha).toHaveBeenLastCalledWith(0);
    for (const building of LOBBY_BUILDINGS) {
      const image = f.objects.find(object => object.texture === building.textureKey);
      const label = f.objects.find(object => object.texture === t(building.nameKey));
      expect(label.y).toBeGreaterThan(image.y + 1.5 * CELL_SIZE);
      expect(label.setAlpha).toHaveBeenLastCalledWith(0);
      renderer.update(image);
      expect(label.setAlpha).toHaveBeenLastCalledWith(1);
      renderer.update({ x: image.x + hiddenAtCells * CELL_SIZE, y: image.y });
      expect(label.setAlpha).toHaveBeenLastCalledWith(0);
    }
  });

  it('hides only the selected building name while its interaction prompt is visible', () => {
    const f = fixture(), renderer = f.render();
    for (const building of LOBBY_BUILDINGS) {
      const image = f.objects.find(object => object.texture === building.textureKey);
      const label = f.objects.find(object => object.texture === t(building.nameKey));
      renderer.update(image, building.menu);
      expect(label.setAlpha).toHaveBeenLastCalledWith(0);
      renderer.update(image);
      expect(label.setAlpha).toHaveBeenLastCalledWith(1);
    }
    const dealer = f.objects.find(object => object.texture === LOBBY_DEALER_ASSET.sheetTextureKey);
    const label = f.objects.find(object => object.texture === t('ui.dawn.dealerName'));
    renderer.update(dealer, 'merchant');
    expect(label.setAlpha).toHaveBeenLastCalledWith(0);
    renderer.update(dealer);
    expect(label.setAlpha).toHaveBeenLastCalledWith(1);
  });

  it('lights all four buildings at night without participation and releases lights on day/handoff/teardown', () => {
    const f = fixture(), renderer = f.render();
    const lighting = { setLight: vi.fn(), releaseLight: vi.fn(), getArtificialLightFactor: vi.fn(() => 1) };
    renderer.update(null, null, lighting);
    expect(lighting.setLight).toHaveBeenCalledTimes(4);
    expect(new Set(lighting.setLight.mock.calls.map(call => call[0])).size).toBe(4);
    const lanterns = f.objects.filter(object => object.lineBetween.mock.calls.length > 0);
    expect(lanterns).toHaveLength(4);
    for (const lantern of lanterns) expect(lantern.setAlpha).toHaveBeenLastCalledWith(1);
    lighting.setLight.mockClear();
    lighting.getArtificialLightFactor.mockReturnValue(0);
    renderer.update(null, null, lighting);
    expect(lighting.setLight).not.toHaveBeenCalled();
    expect(lighting.releaseLight).toHaveBeenCalledTimes(4);
    for (const lantern of lanterns) expect(lantern.setAlpha).toHaveBeenLastCalledWith(0);
    lighting.getArtificialLightFactor.mockReturnValue(1);
    renderer.update(null, null, lighting);
    lighting.releaseLight.mockClear();
    renderer.update(null);
    expect(lighting.releaseLight).toHaveBeenCalledTimes(4);
    renderer.update(null, null, lighting);
    lighting.releaseLight.mockClear();
    renderer.destroy();
    expect(lighting.releaseLight).toHaveBeenCalledTimes(4);
    for (const object of f.objects) expect(object.destroy).toHaveBeenCalledTimes(1);
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
