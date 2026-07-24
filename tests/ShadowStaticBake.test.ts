import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { MULTIPLY: 3, ERASE: 17 },
  Math: { Vector2: class { x = 0; y = 0; } },
}));

import { ShadowSystem } from '../src/effects/ShadowSystem';
import type { ArenaLayout } from '../src/types';

interface BakeEvent { depth: number; fills: number; draws: number; visible: boolean }

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

  const makeRenderTexture = () => {
    const event: BakeEvent = { depth: 0, fills: 0, draws: 0, visible: true };
    bakes.push(event);
    const rt: Record<string, unknown> = {
      camera: { setScroll: () => undefined },
    };
    for (const name of ['setOrigin', 'setBlendMode', 'setMask', 'clearMask',
      'render', 'clear', 'destroy']) {
      rt[name] = () => rt;
    }
    rt.setVisible = (visible: boolean) => { event.visible = visible; return rt; };
    rt.setDepth = (d: number) => { event.depth = d; return rt; };
    rt.fill = () => { event.fills += 1; return rt; };
    rt.draw = () => { event.draws += 1; return rt; };
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
