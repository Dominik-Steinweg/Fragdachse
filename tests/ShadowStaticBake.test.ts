import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { MULTIPLY: 3, ERASE: 17 },
  Math: { Vector2: class { x = 0; y = 0; } },
}));

import { ShadowSystem } from '../src/effects/ShadowSystem';
import type { ArenaLayout } from '../src/types';

interface StampEvent {
  x: number;
  y: number;
  originX?: number;
  originY?: number;
}

interface BakeEvent {
  depth: number;
  fills: number;
  draws: number;
  visible: boolean;
  width: number;
  height: number;
  stamps: StampEvent[];
  renderScrollYs: number[];
  cameraScrollY: number;
}

function makeScene() {
  const bakes: BakeEvent[] = [];
  const graphicsLog: Array<{ depth: number; clears: number }> = [];

  const makeGraphics = () => {
    const state = { depth: 0, clears: 0 };
    graphicsLog.push(state);
    const g: Record<string, unknown> = {};
    for (const name of ['fillStyle', 'fillEllipse', 'fillCircle', 'fillRect', 'fillPoints',
      'beginPath', 'closePath', 'fillPath', 'moveTo', 'lineTo', 'setBlendMode', 'setVisible',
      'setMask', 'clearMask', 'destroy', 'lineStyle', 'strokePath']) {
      g[name] = () => g;
    }
    g.setDepth = (d: number) => { state.depth = d; return g; };
    g.clear = () => { state.clears += 1; return g; };
    return g;
  };

  let textureId = 0;
  const makeRenderTexture = (_x: number, _y: number, width: number, height: number) => {
    const event: BakeEvent = {
      depth: 0,
      fills: 0,
      draws: 0,
      visible: true,
      width,
      height,
      stamps: [],
      renderScrollYs: [],
      cameraScrollY: 0,
    };
    bakes.push(event);
    const camera = {
      scrollX: 0,
      scrollY: 0,
      setScroll(x: number, y: number) {
        this.scrollX = x;
        this.scrollY = y;
        event.cameraScrollY = y;
      },
    };
    const rt: Record<string, unknown> = {
      camera,
      texture: { key: `shadow_rt_${textureId++}` },
    };
    for (const name of ['setOrigin', 'setPosition', 'setBlendMode', 'setMask', 'clearMask',
      'clear', 'destroy']) {
      rt[name] = () => rt;
    }
    rt.render = () => {
      event.renderScrollYs.push(camera.scrollY);
      return rt;
    };
    rt.setVisible = (visible: boolean) => { event.visible = visible; return rt; };
    rt.setDepth = (d: number) => { event.depth = d; return rt; };
    rt.fill = () => { event.fills += 1; return rt; };
    rt.draw = () => { event.draws += 1; return rt; };
    rt.stamp = (
      _key: string,
      _frame: unknown,
      x: number,
      y: number,
      config?: { originX?: number; originY?: number },
    ) => {
      event.stamps.push({ x, y, originX: config?.originX, originY: config?.originY });
      return rt;
    };
    return rt;
  };

  const scene = {
    add: { graphics: makeGraphics, renderTexture: makeRenderTexture },
  } as never;

  return { scene, bakes, graphicsLog };
}

function layout(rockCount: number, treeCount: number): ArenaLayout {
  return {
    rocks: Array.from({ length: rockCount }, (_, i) => ({ gridX: i + 1, gridY: 1 })),
    trees: Array.from({ length: treeCount }, (_, i) => ({ gridX: i + 1, gridY: 3 })),
  } as unknown as ArenaLayout;
}

/** Zaehlt nur Bakes, bei denen tatsaechlich gezeichnet wurde. */
function drawCounts(bakes: BakeEvent[]): number {
  return bakes.reduce((sum, bake) => sum + bake.draws, 0);
}

describe('static shadow baking', () => {
  it('bakes static footprints into render textures instead of keeping live graphics', () => {
    const { scene, bakes } = makeScene();
    const shadows = new ShadowSystem(scene);

    shadows.rebuildStaticLayoutShadows(layout(3, 2));

    // Fels, Stamm und Krone liegen auf verschiedenen Tiefen -> je ein gebackener Layer.
    expect(bakes.length).toBeGreaterThanOrEqual(3);
    // Jede gebackene Textur startet deckend weiss (neutrales Element fuer MULTIPLY).
    for (const bake of bakes) expect(bake.fills).toBeGreaterThan(0);
    expect(drawCounts(bakes)).toBeGreaterThanOrEqual(3);
  });

  it('re-bakes only rock layers when obstacles change, leaving tree layers untouched', () => {
    const { scene, bakes } = makeScene();
    const shadows = new ShadowSystem(scene);
    const arenaLayout = layout(3, 2);

    const arenaResult = {
      rockObjects: [{ active: true }, { active: true }, { active: true }],
    } as never;

    shadows.rebuildArenaStaticShadows(arenaLayout, arenaResult);
    const drawsAfterBuild = bakes.map((bake) => bake.draws);

    // Zweiter Aufruf mit demselben Layout = Invalidierungspfad nach einer Zerstoerung.
    shadows.rebuildArenaStaticShadows(arenaLayout, arenaResult);

    const changed = bakes.filter((bake, index) => bake.draws !== drawsAfterBuild[index]);
    // Genau die Fels-/Turret-Tiefen duerfen neu gebacken werden, die Baum-Tiefen nicht.
    expect(changed.length).toBeGreaterThan(0);
    const treeDepths = changed.map((bake) => bake.depth);
    // Kronen liegen deutlich hoeher (nahe DEPTH.CANOPY) als Fels-/Stamm-Schatten.
    for (const depth of treeDepths) expect(depth).toBeLessThan(15);
  });

  it('rebuilds a known rock change through bounded scratch chunks', () => {
    const { scene, bakes } = makeScene();
    const shadows = new ShadowSystem(scene);
    const arenaLayout = layout(20, 2);
    const rockObjects = Array.from({ length: 20 }, () => ({ active: true }));
    const arenaResult = { rockObjects } as never;

    shadows.rebuildArenaStaticShadows(arenaLayout, arenaResult);
    const treeDraws = bakes.filter((bake) => bake.depth >= 15).map((bake) => bake.draws);
    rockObjects[4].active = false;
    shadows.rebuildArenaStaticShadowRegions(arenaLayout, arenaResult, new Set([4]));

    expect(bakes.some((bake) => bake.width === 128 && bake.height === 128)).toBe(true);
    expect(bakes.filter((bake) => bake.depth >= 15).map((bake) => bake.draws)).toEqual(treeDraws);
  });

  it('blits a dirty shadow chunk in texture-local coordinates with the 12 px arena offset', () => {
    const { scene, bakes } = makeScene();
    const shadows = new ShadowSystem(scene);
    const arenaLayout = layout(20, 0);
    const rockObjects = Array.from({ length: 20 }, () => ({ active: true }));
    const arenaResult = { rockObjects } as never;

    shadows.rebuildArenaStaticShadows(arenaLayout, arenaResult);
    rockObjects[4].active = false;
    shadows.rebuildArenaStaticShadowRegions(arenaLayout, arenaResult, new Set([4]));

    const regionalStamps = bakes
      .filter((bake) => bake.width > 128 || bake.height > 128)
      .flatMap((bake) => bake.stamps);
    expect(regionalStamps.length).toBeGreaterThan(0);
    expect(regionalStamps).toContainEqual({
      x: 128,
      y: 0,
      originX: 0,
      originY: 0,
    });
    const regionalTargets = bakes.filter(
      (bake) => (bake.width > 128 || bake.height > 128) && bake.stamps.length > 0,
    );
    expect(regionalTargets.length).toBeGreaterThan(0);
    for (const target of regionalTargets) {
      expect(target.renderScrollYs.at(-1)).toBe(0);
      expect(target.cameraScrollY).toBe(12);
    }
  });

  it('blanks and hides baked layers on teardown so no shadows survive into the lobby', () => {
    const { scene, bakes } = makeScene();
    const shadows = new ShadowSystem(scene);
    shadows.rebuildStaticLayoutShadows(layout(3, 2));

    const fillsAfterBuild = bakes.map((bake) => bake.fills);
    // Nach dem Aufbau sind die gebackenen Layer sichtbar.
    expect(bakes.some((bake) => bake.visible)).toBe(true);

    shadows.clear();

    // Jede gebackene Textur wurde erneut auf Weiss gesetzt (Inhalt verworfen) ...
    bakes.forEach((bake, index) => {
      expect(bake.fills).toBeGreaterThan(fillsAfterBuild[index]);
    });
    // ... und ist danach ausgeblendet. Sonst ueberleben die Schatten den Arena-Teardown
    // und bleiben als Raster in der Lobby stehen.
    expect(bakes.every((bake) => !bake.visible)).toBe(true);
  });

  it('keeps a fresh layout rebuilding both groups', () => {
    const { scene, bakes } = makeScene();
    const shadows = new ShadowSystem(scene);
    const arenaResult = { rockObjects: [{ active: true }] } as never;

    shadows.rebuildArenaStaticShadows(layout(1, 1), arenaResult);
    const first = drawCounts(bakes);
    // Neues Layout-Objekt -> Baum-Schatten muessen ebenfalls neu entstehen.
    shadows.rebuildArenaStaticShadows(layout(1, 1), arenaResult);
    expect(drawCounts(bakes)).toBeGreaterThan(first + 1);
  });
});
