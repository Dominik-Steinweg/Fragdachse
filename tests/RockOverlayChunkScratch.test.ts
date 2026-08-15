import { describe, expect, it, vi } from 'vitest';

// Phaser braucht beim Laden ein DOM. Der Chunk-Pfad ruft davon nichts auf; die Attrappe stellt nur
// so viel bereit, dass die Modulkette von `ArenaBuilder` importierbar bleibt.
vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0, MULTIPLY: 1, ADD: 2, ERASE: 17 },
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
    Between: (min: number) => min,
    RND: { pick: <T>(items: readonly T[]) => items[0] },
  },
  Geom: { Rectangle: class {} },
  GameObjects: {
    Image: class {
      constructor(public scene: unknown, public x: number, public y: number, public key: string) {}
      setOrigin(): this { return this; }
      setPosition(x: number, y: number): this {
        this.x = x;
        this.y = y;
        return this;
      }
      destroy(): void {}
    },
  },
}));

import { ArenaBuilder } from '../src/arena/ArenaBuilder';
import type { ArenaBuilderResult } from '../src/arena/ArenaBuilder';
import type { ArenaLayout } from '../src/types';
import { CELL_SIZE } from '../src/config';
import { createRockOverlaySource, syncRockOverlaySource } from '../src/arena/RockOverlayRegions';

/**
 * Der Chunk-Neubau schreibt jede Schicht erst in ein 128er-Scratch-Ziel und blittet es dann in den
 * arenagrossen Layer. Phasers `clear()` ist dabei ein **gepufferter** Befehl: Er wird erst von
 * `render()` ausgefuehrt. Wird der Puffer nicht geleert, blittet der naechste Chunk den Inhalt des
 * vorigen – im Spiel sichtbar als Moos oder Vegetation, die nach einer Zerstoerung auf leerem Boden
 * auftaucht, um den Chunkabstand versetzt.
 *
 * Die Attrappe bildet genau diese Verzoegerung nach; ein Fake, der sofort ausfuehrt, koennte den
 * Fehler prinzipiell nicht zeigen.
 */
class FakeRenderTexture {
  private static readonly textures = new Map<string, FakeRenderTexture>();

  active = true;
  visible = false;
  x = 0;
  y = 0;
  content: string[] = [];
  /** Was dieser Layer je in eine Chunk-Region geblittet hat – nur fuer die Arena-Layer relevant. */
  blits: Array<{ localX: number; localY: number; content: string[] }> = [];
  camera = { setScroll: () => {} };
  texture: { key: string };
  private pending: Array<() => void> = [];

  constructor(key: string) {
    this.texture = { key };
    FakeRenderTexture.textures.set(key, this);
  }

  setOrigin(): this { return this; }
  setDepth(): this { return this; }
  setAlpha(): this { return this; }
  setBlendMode(): this { return this; }
  setRenderMode(): this { return this; }
  setVisible(visible: boolean): this {
    this.visible = visible;
    return this;
  }
  setPosition(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  clear(localX?: number, localY?: number): this {
    this.pending.push(() => {
      if (localX === undefined) {
        this.content = [];
        return;
      }
      this.blits.push({ localX, localY: localY ?? 0, content: [] });
    });
    return this;
  }

  fill(): this { return this; }
  erase(): this { return this; }

  stamp(key: string, _frame: unknown, x: number, y: number): this {
    this.pending.push(() => {
      const source = FakeRenderTexture.textures.get(key);
      if (!source || source === this) {
        this.content.push(`${key}@${Math.round(x)},${Math.round(y)}`);
        return;
      }
      const drawn = source.content.map((entry) => entry.replace(
        /@(-?\d+),(-?\d+)/,
        (_match, sourceX: string, sourceY: string) => `@${Number(sourceX) + x},${Number(sourceY) + y}`,
      ));
      const target = this.blits[this.blits.length - 1];
      if (target) target.content = [...drawn];
      this.content.push(...drawn);
    });
    return this;
  }

  draw(entries: unknown): this {
    const list = Array.isArray(entries) ? entries : [entries];
    this.pending.push(() => {
      for (const entry of list) {
        // Ein geblittetes Scratch-Ziel wird erst hier ausgelesen – genau wie die GPU es taete.
        if (entry instanceof FakeRenderTexture) {
          const target = this.blits[this.blits.length - 1];
          if (target) target.content = [...entry.content];
          this.content.push(...entry.content);
        }
      }
    });
    return this;
  }

  render(): this {
    for (const command of this.pending) command();
    this.pending.length = 0;
    return this;
  }

  destroy(): void {
    this.active = false;
    if (FakeRenderTexture.textures.get(this.texture.key) === this) {
      FakeRenderTexture.textures.delete(this.texture.key);
    }
  }
}

function createScene() {
  let created = 0;
  return {
    add: {
      renderTexture: () => new FakeRenderTexture(`fake_rt_${created++}`),
      image: () => ({
        setDisplaySize: () => ({ destroy: () => {} }),
        destroy: () => {},
      }),
    },
    textures: {
      exists: () => true,
      getFrame: () => ({ width: 32, height: 32 }),
      addDynamicTexture: () => null,
    },
  };
}

function rockImage(gridX: number, gridY: number) {
  return {
    active: true,
    x: gridX * CELL_SIZE + CELL_SIZE / 2,
    y: gridY * CELL_SIZE + CELL_SIZE / 2,
    frame: { name: 0 },
    destroy() { this.active = false; },
  };
}

/**
 * Zwei Chunks nebeneinander: In `0:0` steht Fels und liegt Bewuchs, in `128:0` liegt gar nichts.
 * Die Zerstoerung auf Zelle (2, 1) zieht wegen des Maskenrands beide Chunks in den Neubau.
 */
function buildFixture() {
  const rocks = [
    { gridX: 0, gridY: 1 },
    { gridX: 1, gridY: 1 },
    { gridX: 2, gridY: 1 },
    { gridX: 3, gridY: 1 },
  ];
  const layout = { seed: 1, rocks, trees: [], decals: [] } as unknown as ArenaLayout;

  const rockObjects: Array<ReturnType<typeof rockImage> | null> = rocks.map((cell) => rockImage(cell.gridX, cell.gridY));
  const mossLayer = new FakeRenderTexture('moss_layer');
  const vegetationLayer = new FakeRenderTexture('vegetation_layer');
  // Zustand nach dem Rundenaufbau: Die Materialquelle steht bereits, die Zerstoerung ist damit die
  // einzige Aenderung und bestimmt die Chunk-Auswahl allein.
  const rockOverlaySource = createRockOverlaySource();
  syncRockOverlaySource(rockOverlaySource, rocks);

  const result = {
    rockObjects,
    rockStateTints: rocks.map(() => 0xffffff),
    rockDecalLayer: null,
    rockDecalCutout: null,
    rockOverlaySource,
    rockMossLayer: mossLayer,
    rockMossCutout: new FakeRenderTexture('moss_cutout'),
    // Beide Platzierungen liegen klar im linken Chunk.
    rockMossPlacements: [
      { textureKey: 'rock_moss_01', worldX: 48, worldY: 48, sizePx: 32, rotation: 0, alpha: 1, mirrorX: false, mirrorY: false },
    ],
    rockVegetationLayer: vegetationLayer,
    rockVegetationCutout: new FakeRenderTexture('vegetation_cutout'),
    rockVegetationPlacements: [
      { textureKey: 'rock_veg_01_small', worldX: 48, worldY: 32, lengthPx: 32, bandPx: 32, rotation: 0, alpha: 1, mirrorX: false },
    ],
    rockMottleLayers: [new FakeRenderTexture('mottle_0'), new FakeRenderTexture('mottle_1')],
    rockSilhouetteCutout: null,
    rockOverlayScratch: null,
  } as unknown as ArenaBuilderResult;

  return { layout, result, mossLayer, vegetationLayer, rockObjects };
}

describe('rock overlay chunk scratch', () => {
  it('does not blit the previous chunk into a chunk without any placements', () => {
    const scene = createScene();
    const { layout, result, mossLayer, vegetationLayer, rockObjects } = buildFixture();

    rockObjects[2] = null; // Zelle (2, 1) zerstoert
    ArenaBuilder.rebuildRockOverlayRegions(
      scene as never,
      result,
      layout,
      new Set([2]),
      { offsetX: 0, offsetY: 0, width: 256, height: 256 },
    );

    for (const layer of [mossLayer, vegetationLayer]) {
      // Beide Chunks wurden angefasst – sonst pruefte der Test nichts.
      expect(layer.blits.map((blit) => blit.localX)).toEqual([0, 128]);
      const rightChunk = layer.blits.find((blit) => blit.localX === 128);
      expect(rightChunk?.content).toEqual([]);
    }
  });

  it('still writes the placements of a chunk that has them', () => {
    const scene = createScene();
    const { layout, result, mossLayer, vegetationLayer, rockObjects } = buildFixture();

    rockObjects[2] = null;
    ArenaBuilder.rebuildRockOverlayRegions(
      scene as never,
      result,
      layout,
      new Set([2]),
      { offsetX: 0, offsetY: 0, width: 256, height: 256 },
    );

    expect(mossLayer.blits.find((blit) => blit.localX === 0)?.content).toEqual(['rock_moss_01@48,48']);
    expect(vegetationLayer.blits.find((blit) => blit.localX === 0)?.content)
      .toEqual(['rock_veg_01_small@48,32']);
  });
});
