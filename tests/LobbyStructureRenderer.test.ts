import type * as Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';
import { LobbyStructureRenderer, resolveLobbyStructureNameplateAlpha } from '../src/arena/lobbyStructures/LobbyStructureRenderer';
import { lobbyStructureAsset, lobbyStructureTextureKey, preloadLobbyStructureAssets } from '../src/arena/lobbyStructures/LobbyStructureAssets';
import { lobbyStaffAsset, preloadLobbyStaffAssets } from '../src/animations/LobbyStaffAssets';
import { LOBBY_BUILDINGS, lobbyBuildingWorldRects } from '../src/config/authoring/lobbyBuildings';
import { LOBBY_MERCHANT } from '../src/config/authoring/lobbyMerchant';
import { isInsideStructure, structureBounds } from '../src/arena/StructureOutline';
import { CELL_SIZE } from '../src/config';
import type { WorldMetrics } from '../src/world/WorldMetrics';
import { t } from '../src/i18n';

vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1, MULTIPLY: 2 }, Math: { Vector2: class { constructor(public x: number, public y: number) {} } } }));
// The Low quality path draws the lit beauty without shader quads.
vi.mock('../src/graphics/GraphicsQuality', () => ({ getGraphicsQualityProfile: () => ({ level: 'low' }) }));

function fixture(missing: readonly string[] = []) {
  const objects: any[] = [];
  const create = (x = 0, y = 0, texture = '') => {
    const object: any = { x, y, texture, alpha: 1, blend: 0, setOrigin: vi.fn().mockReturnThis(), setDisplaySize: vi.fn().mockReturnThis(),
      width: 100, setText: vi.fn(function (this: any, text: string) { this.text = text; return this; }),
      setPosition: vi.fn(function (this: any, px: number, py: number) { this.x = px; this.y = py; return this; }),
      setVisible: vi.fn().mockReturnThis(), clear: vi.fn().mockReturnThis(), fillStyle: vi.fn().mockReturnThis(), lineStyle: vi.fn().mockReturnThis(),
      fillRoundedRect: vi.fn().mockReturnThis(), strokeRoundedRect: vi.fn().mockReturnThis(), fillCircle: vi.fn().mockReturnThis(),
      strokeCircle: vi.fn().mockReturnThis(), fillTriangle: vi.fn().mockReturnThis(), setColor: vi.fn().mockReturnThis(),
      setScale: vi.fn().mockReturnThis(), lineBetween: vi.fn().mockReturnThis(), strokePoints: vi.fn().mockReturnThis(),
      setDepth: vi.fn().mockReturnThis(), setRotation: vi.fn().mockReturnThis(), play: vi.fn(), destroy: vi.fn(),
      setAlpha: vi.fn(function (this: any, value: number) { this.alpha = value; return this; }),
      setBlendMode: vi.fn(function (this: any, value: number) { this.blend = value; return this; }),
      anims: { currentFrame: null } };
    objects.push(object); return object;
  };
  const registered = new Set<string>();
  const scene = { textures: { exists: (key: string) => !missing.includes(key) }, time: { now: 1000 },
    add: { image: vi.fn(create), sprite: vi.fn(create), text: vi.fn(create), graphics: vi.fn(() => create()) },
    anims: { exists: (key: string) => registered.has(key), create: vi.fn(config => registered.add(config.key)),
      generateFrameNumbers: vi.fn((key, config) => config.frames.map((frame: number) => ({ key, frame }))) } };
  const metrics = { offsetX: 120, offsetY: 48 } as WorldMetrics;
  const render = () => new LobbyStructureRenderer(scene as unknown as Phaser.Scene, metrics);
  return { scene, objects, render, metrics };
}

function lighting(night: number) {
  return { setLight: vi.fn(), releaseLight: vi.fn(), getArtificialLightFactor: () => night };
}

describe('Lobby structure presentation', () => {
  it('loads every pass of every structure and the staff sheets', () => {
    const loader = { image: vi.fn(), spritesheet: vi.fn() };
    preloadLobbyStructureAssets(loader as unknown as Phaser.Loader.LoaderPlugin);
    preloadLobbyStaffAssets(loader as unknown as Phaser.Loader.LoaderPlugin);
    for (const building of LOBBY_BUILDINGS) {
      const asset = lobbyStructureAsset(building.id)!;
      for (const pass of ['beauty', 'albedo', 'elevation', 'solid'] as const) {
        expect(loader.image.mock.calls.map(call => call[0])).toContain(lobbyStructureTextureKey(asset, pass));
      }
      expect(loader.spritesheet.mock.calls.map(call => call[0])).toContain(lobbyStaffAsset(building.menu)!.sheetTextureKey);
    }
  });

  it('places each structure on its canvas, its plaque outside the outline and its staff at the staff socket', () => {
    const f = fixture();
    f.render();
    for (const building of LOBBY_BUILDINGS) {
      const asset = lobbyStructureAsset(building.id)!;
      const originX = f.metrics.offsetX + building.gridX * CELL_SIZE, originY = f.metrics.offsetY + building.gridY * CELL_SIZE;
      const body = f.objects.find(object => object.texture === lobbyStructureTextureKey(asset, 'beauty'));
      expect(body).toMatchObject({ x: originX + asset.canvasOffset.x, y: originY + asset.canvasOffset.y });
      const rects = lobbyBuildingWorldRects(f.metrics, building), bounds = structureBounds(rects);
      const label = f.objects.find(object => object.text === t(building.nameKey) && object.x !== 0);
      expect(label.y < bounds.top || label.y > bounds.bottom, building.id).toBe(true);
      const staff = f.objects.find(object => object.texture === lobbyStaffAsset(building.menu)!.sheetTextureKey);
      expect(isInsideStructure(rects, staff.x, staff.y), building.id).toBe(true);
      expect(staff.play).toHaveBeenCalled();
    }
  });

  it('gates lamps by the night, keeps the forge burning by day and releases every light on teardown', () => {
    const f = fixture();
    const renderer = f.render();
    const day = lighting(0);
    renderer.update(null, null, day);
    const lit = day.setLight.mock.calls.map(call => call[1]);
    expect(lit).toContain('lobbyForgeGlow');
    expect(lit).not.toContain('lobbyLampGlow');
    const night = lighting(1);
    renderer.update(null, null, night);
    expect(night.setLight.mock.calls.map(call => call[1])).toContain('lobbyLampGlow');
    const keys = new Set(night.setLight.mock.calls.map(call => call[0]));
    renderer.destroy();
    expect(new Set(night.releaseLight.mock.calls.map(call => call[0]))).toEqual(keys);
  });

  it('cuts the fog with each structure solid pass and skips structures whose art is missing', () => {
    const f = fixture();
    const stamps = f.render().getFogSurfaceStamps();
    expect(stamps.map(stamp => stamp.texture.key).sort())
      .toEqual(LOBBY_BUILDINGS.map(building => lobbyStructureTextureKey(lobbyStructureAsset(building.id)!, 'solid')).sort());
    const absent = fixture(LOBBY_BUILDINGS.map(building => lobbyStructureTextureKey(lobbyStructureAsset(building.id)!, 'beauty')));
    const renderer = absent.render();
    expect(renderer.getFogSurfaceStamps()).toEqual([]);
    expect(absent.objects).toEqual([]);
  });

  it('fades names smoothly with the distance to the nearest wall', () => {
    const { fullVisibilityCells: near, hiddenAtCells: far } = LOBBY_MERCHANT.nameplate;
    expect(resolveLobbyStructureNameplateAlpha(near)).toBe(1);
    expect(resolveLobbyStructureNameplateAlpha(far)).toBe(0);
    expect(resolveLobbyStructureNameplateAlpha(NaN)).toBe(0);
    let previous = 1;
    for (let step = 0; step <= 20; step++) {
      const alpha = resolveLobbyStructureNameplateAlpha(near + (far - near) * step / 20);
      expect(alpha).toBeLessThanOrEqual(previous); previous = alpha;
    }
  });
});
