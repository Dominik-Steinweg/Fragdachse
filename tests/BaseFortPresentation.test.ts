import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const fort = vi.hoisted(() => ({ calls: [] as unknown[][] }));

// Decorative accents are exercised with both factions in BaseGrounding.test.ts.
vi.mock('../src/arena/BaseAccentGlowRenderer', () => ({
  BaseAccentGlowRenderer: class { destroyCell() {} destroy() {} },
}));
vi.mock('../src/arena/baseStructures/BaseFortAssets', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/arena/baseStructures/BaseFortAssets')>(),
  isBaseFortLoaded: () => true,
}));
vi.mock('../src/arena/baseStructures/BaseFortRenderer', () => ({
  BaseFortRenderer: class {
    add(...args: unknown[]) { fort.calls.push(['add', ...args]); }
    addOutpost(...args: unknown[]) { fort.calls.push(['addOutpost', ...args]); return true; }
    destroyCell(...args: unknown[]) { fort.calls.push(['destroyCell', ...args]); }
    remove(...args: unknown[]) { fort.calls.push(['remove', ...args]); }
    setLighting() {} setShadows() {} setParticles() {} setSunlight() {} releaseLights() {} update() {} destroy() {}
    *getFogSurfaces() {}
  },
}));
vi.mock('phaser', () => ({ Math: { Clamp: (v: number, a: number, b: number) => Math.min(b, Math.max(a, v)),
  Linear: (a: number, b: number, t: number) => a + (b - a) * t } }));

import { BaseManager } from '../src/entities/BaseManager';
import { getLobbyWorldDefinition } from '../src/config/authoring/lobbyWorld';
import { resolveWorldBases } from '../src/arena/BaseRegistry';
import { resolveActiveArenaWorldMetrics } from '../src/world/WorldMetrics';
import { CELL_SIZE } from '../src/config';
import { baseFortCoreAsset, baseFortKitAsset, type BaseFortPass } from '../src/arena/baseStructures/BaseFortAssets';
import { AutoTiler } from '../src/arena/AutoTiler';

const METRICS = resolveActiveArenaWorldMetrics();

function fakeObject(): any {
  const object: any = { active: true, visible: true, data: new Map() };
  for (const method of ['setDisplaySize', 'setDepth', 'setRotation', 'setAlpha', 'setTint', 'setPosition', 'setOrigin',
    'setVisible', 'setStrokeStyle', 'setFillStyle', 'lineStyle', 'strokeRect']) object[method] = () => object;
  object.setData = (key: string, value: unknown) => { object.data.set(key, value); return object; };
  object.destroy = () => { object.active = false; };
  return object;
}

function makeScene(): any {
  return {
    add: { image: fakeObject, sprite: fakeObject, rectangle: fakeObject, graphics: fakeObject },
    physics: { add: { existing: (o: any) => { o.body = { setSize() {}, updateFromGameObject() {} }; },
      staticGroup: () => ({ add() {}, destroy() {} }) } },
    tweens: { add: () => ({ remove() {} }) },
    time: { delayedCall: () => ({ remove() {} }) },
  };
}

function lobbyBases() {
  return resolveWorldBases(getLobbyWorldDefinition(), METRICS, { includePersistentBaseCore: true,
    parameters: { persistentBaseUnlocked: true } });
}

describe('persistent base fort presentation', () => {
  it('presents the friendly persistent core as the fort, centred on its anchor cell, without tiles or base glow', () => {
    fort.calls.length = 0;
    const specs = lobbyBases();
    const core = specs.find((spec) => spec.persistentReservationRadiusCells !== undefined)!;
    const manager = new BaseManager(makeScene(), specs, METRICS, {}, true, false);
    const adds = fort.calls.filter(([kind]) => kind === 'add');
    expect(adds).toHaveLength(1);
    const { region } = core;
    expect(adds[0]).toEqual(['add', core.id, METRICS.offsetX + (region.minGridX + region.maxGridX + 1) / 2 * CELL_SIZE,
      METRICS.offsetY + (region.minGridY + region.maxGridY + 1) / 2 * CELL_SIZE,
      core.cells.map(cell => ({ gridX: cell.gridX, gridY: cell.gridY,
        x: METRICS.offsetX + (cell.gridX + .5) * CELL_SIZE, y: METRICS.offsetY + (cell.gridY + .5) * CELL_SIZE }))]);
    // Every other friendly cell base (outposts, middle bases) is composed from the outpost kit.
    const outposts = specs.filter(spec => spec !== core && spec.faction === 'friendly' && spec.surface !== 'none' && spec.role !== 'spawn-point');
    expect(fort.calls.filter(([kind]) => kind === 'addOutpost').map(([, id]) => id).sort()).toEqual(outposts.map(spec => spec.id).sort());
    const entity = manager.getBase(core.id)!;
    expect(entity.getSurfaceImages()).toHaveLength(0);
    expect(entity.getLightSpots()).toHaveLength(0);
    // The decks stay raised shadow receivers (turret shadows land on them); the fort casts its own shadow.
    const raised = entity.getShadowSurfaceCells();
    expect(raised.map(({ x, y }) => ({ x, y }))).toEqual(core.cells.map(cell => ({
      x: METRICS.offsetX + (cell.gridX + .5) * CELL_SIZE, y: METRICS.offsetY + (cell.gridY + .5) * CELL_SIZE })));
    expect(raised.every(cell => cell.active && cell.footprint === false)).toBe(true);
    // Collision stays cell based: every base-surface cell keeps its body.
    expect(entity.getCellBodies()).toHaveLength(core.cells.length);
    entity.destroyCellVisual(0);
    expect(fort.calls.at(-1)).toEqual(['destroyCell', core.id]);
    expect(raised.map(cell => cell.active)).toEqual(core.cells.map((_, index) => index !== 0));
    manager.destroy();
    expect(fort.calls.at(-1)).toEqual(['remove', core.id]);
  });

  it('publishes every runtime pass of the core with lights on the posts and outside the palisade', () => {
    const asset = baseFortCoreAsset()!;
    expect(asset).not.toBeNull();
    const passes: BaseFortPass[] = ['beauty', 'albedo', 'elevation', 'solid', 'caster-height', 'ground',
      ...asset.layers.map((layer) => `emission-${layer}` as const)];
    for (const pass of passes) expect(existsSync(`public/assets/sprites/pipeline-v2/${asset.asset}/${pass}.png`), pass).toBe(true);
    const half = asset.displaySize / 2;
    const sockets = Object.entries(asset.sockets);
    for (const [, socket] of sockets) {
      expect(Math.abs(socket.x)).toBeLessThan(half);
      expect(Math.abs(socket.y)).toBeLessThan(half);
    }
    // Four gate posts per bastion carry a lantern; no light stands inside the deck cells' centres.
    expect(sockets.filter(([name]) => name.startsWith('lamp_'))).toHaveLength(16);
    expect(sockets.some(([name]) => name.startsWith('torch'))).toBe(true);
  });

  it('publishes the outpost kit variants with one frame per corner-suppressed mask and sockets inside their frames', () => {
    const kit = baseFortKitAsset()!;
    expect(kit).not.toBeNull();
    expect(kit.variants.length).toBeGreaterThan(1);
    for (const variant of kit.variants) {
      for (const pass of ['beauty', 'albedo', 'elevation', 'solid', 'caster-height', ...kit.layers.map(layer => `emission-${layer}`)]) {
        expect(existsSync(`public/assets/sprites/pipeline-v2/${variant.asset}/${pass}.png`), `${variant.asset} ${pass}`).toBe(true);
      }
    }
    // Every mask a cell set can produce has its frame: the masks of all 256 neighbourhoods.
    const masks = new Set<number>();
    for (let bits = 0; bits < 256; bits++) {
      const occupied = (x: number, y: number) => {
        const index = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]].findIndex(([dx, dy]) => dx === x && dy === y);
        return index >= 0 && (bits & (1 << index)) !== 0;
      };
      masks.add(AutoTiler.computeMask(0, 0, occupied));
    }
    for (const variant of kit.variants) expect(variant.frames.map(frame => frame.mask)).toEqual([...masks].sort((a, b) => a - b));
    expect(masks.size).toBe(47);
    for (const variant of kit.variants) for (const frame of variant.frames) for (const socket of Object.values(frame.sockets)) {
      expect(Math.abs(socket.x)).toBeLessThan(kit.framePx / 2);
      expect(Math.abs(socket.y)).toBeLessThan(kit.framePx / 2);
    }
  });
});
