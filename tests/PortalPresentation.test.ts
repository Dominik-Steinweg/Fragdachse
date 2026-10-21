import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({
  Scenes: { Events: { PRE_RENDER: 'prerender' } }, Textures: { FilterMode: { LINEAR: 0 } }, BlendModes: { NORMAL: 0, ADD: 1 },
}));
vi.mock('../src/effects/EffectUtils', () => ({ mixColors: (color: number) => color, registerGraphicsObject: () => {} }));
vi.mock('../src/graphics/GraphicsQuality', () => ({ getGraphicsQualityProfile: () => ({ level: 'high' }) }));
import { PortalApertureKind, PortalGpuLayer, type PortalApertureInstance } from '../src/effects/gpu/PortalGpuLayer';
import { PortalPresentation } from '../src/effects/portal/PortalPresentation';
import type { PortalEndView } from '../src/effects/portal/PortalViews';
import { TerrainColorSnapshot } from '../src/arena/TerrainColorSnapshot';

function setup() {
  let render: () => void = () => {};
  const scene = {
    sys: {}, time: { now: 1000 },
    events: { on: (_event: string, fn: () => void, ctx: unknown) => { render = fn.bind(ctx); }, off: vi.fn() },
    cameras: { main: { width: 800, height: 600, originX: 0, originY: 0, zoom: 1, scrollX: 0, scrollY: 0 } },
    textures: { addUint8Array: vi.fn(() => ({ setFilter: vi.fn() })), remove: vi.fn() },
  };
  const lighting = { setLight: vi.fn(), releaseLight: vi.fn(), pulse: vi.fn(), getArtificialLightFactor: () => 0 };
  const apertures: PortalApertureInstance[] = [];
  vi.spyOn(PortalGpuLayer.prototype, 'addAperture').mockImplementation(instance => { apertures.push({ ...instance }); return true; });
  const motes = vi.spyOn(PortalGpuLayer.prototype, 'addMote').mockImplementation(() => true);
  const presentation = new PortalPresentation(scene as never, lighting as never);
  const frame = () => { apertures.length = 0; motes.mockClear(); render(); };
  return { scene, lighting, presentation, apertures, motes, frame };
}

const pairEnds = (): PortalEndView[] => [
  { key: 'a', x: 100, y: 100, radius: 16, style: 'translocator-a', open: 1, partner: { x: 400, y: 100 }, ground: 1 },
  { key: 'b', x: 400, y: 100, radius: 16, style: 'translocator-b', open: 1, partner: { x: 100, y: 100 }, ground: 1 },
];

describe('shared portal presentation', () => {
  it('draws every submitted end with motes and a light until its owner withdraws it', () => {
    const w = setup();
    w.presentation.submit('translocator', pairEnds());
    w.frame();
    expect(w.apertures.map(a => a.kind)).toEqual([PortalApertureKind.Portal, PortalApertureKind.Portal]);
    expect(w.apertures[0]).toMatchObject({ x: 100, dx: 300, dy: 0, ground: 1 });
    expect(w.motes).toHaveBeenCalled();
    expect(w.lighting.setLight.mock.calls.map(call => call[0])).toEqual(['portal:translocator:a', 'portal:translocator:b']);
    w.presentation.submit('translocator', []);
    w.frame();
    expect(w.apertures).toEqual([]);
    expect(w.lighting.releaseLight.mock.calls.map(call => call[0]).sort()).toEqual(['portal:translocator:a', 'portal:translocator:b']);
  });

  it('turns a teleport flash into a swallow at the entry and a release at the exit along one direction', () => {
    const w = setup();
    w.presentation.submit('translocator', pairEnds());
    w.presentation.playFlashAt(103, 98, 0x4fb4ff, 'start');
    w.presentation.playFlashAt(398, 101, 0x4fb4ff, 'end');
    w.frame();
    const swallow = w.apertures.find(a => a.kind === PortalApertureKind.SwallowFlare)!;
    const release = w.apertures.find(a => a.kind === PortalApertureKind.ReleaseWave)!;
    expect(swallow).toMatchObject({ x: 100, y: 100, dx: 1 });
    // The traveller keeps going the way it entered: entry -> exit.
    expect(release).toMatchObject({ x: 400, y: 100, dx: 1 });
    expect(Math.abs(swallow.dy) + Math.abs(release.dy)).toBe(0);
    expect(w.lighting.pulse).toHaveBeenCalledTimes(2);
  });

  it('keeps a flash away from every portal undirected and forgets events after their life', () => {
    const w = setup();
    w.presentation.playFlashAt(600, 500, 0xffffff, 'end');
    w.frame();
    expect(w.apertures.find(a => a.kind === PortalApertureKind.ReleaseWave)).toMatchObject({ dx: 0, dy: 0 });
    expect(w.presentation.debugCounts.events).toBe(1);
    w.scene.time.now += 1000;
    w.frame();
    expect(w.presentation.debugCounts.events).toBe(0);
  });

  it('skips drawing ends far outside the camera but keeps their light', () => {
    const w = setup();
    w.presentation.submit('void-portal', [{ key: 'far', x: 5000, y: 5000, radius: 28, style: 'void', open: 1 }]);
    w.frame();
    expect(w.apertures).toEqual([]);
    expect(w.lighting.setLight).toHaveBeenCalledWith('portal:void-portal:far', 'portal', 5000, 5000, expect.any(Object));
  });

  it('clears all ends and events per World but keeps the terrain, which it uploads once as RGBA', () => {
    const w = setup();
    w.presentation.setTerrainColorSnapshot(new TerrainColorSnapshot(2, 1, 0, 0, new Uint8Array([10, 20, 30, 40, 50, 60])));
    expect(w.scene.textures.addUint8Array).toHaveBeenCalledWith(expect.any(String),
      new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]), 2, 1);
    w.presentation.submit('translocator', pairEnds());
    w.presentation.playCollapse([{ x: 100, y: 100 }], 16, 'translocator-a');
    w.frame();
    w.presentation.clearAll();
    w.frame();
    expect(w.apertures).toEqual([]);
    expect(w.scene.textures.remove).not.toHaveBeenCalled();
    w.presentation.destroy(); w.presentation.destroy();
    expect(w.scene.textures.remove).toHaveBeenCalledTimes(1);
  });
});
