import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0, MULTIPLY: 3, ERASE: 17 },
  Math: { Vector2: class { x = 0; y = 0; } },
}));

import { ShadowSystem } from '../src/effects/ShadowSystem';
import { SHADOW_CASTERS } from '../src/effects/ShadowConfig';
import { ARENA_HEIGHT, ARENA_OFFSET_X, ARENA_OFFSET_Y, ARENA_WIDTH, DEPTH } from '../src/config';
import { ARENA_RENDER_CHUNK_SIZE } from '../src/arena/chunks/ArenaChunkGrid';
import { CHUNK_SAMPLING_GUTTER_PX, ChunkedRenderSurface } from '../src/arena/chunks/ChunkedRenderSurface';
import type { ArenaLayout } from '../src/types';

/** Kantenlaenge eines Chunk-Renderziels: logischer Chunk plus beidseitiger Sampling-Gutter. */
const CHUNK_TARGET_SIZE = ARENA_RENDER_CHUNK_SIZE + 2 * CHUNK_SAMPLING_GUTTER_PX;
/** Kantenlaenge des Scratch-Ziels einer 128er-Dirty-Region – ebenfalls samt Gutter. */
const DIRTY_SCRATCH_SIZE = 128 + 2 * CHUNK_SAMPLING_GUTTER_PX;

/**
 * Die gebackenen statischen Schatten.
 *
 * Sie lagen frueher in je einer arenagrossen RenderTexture pro Tiefe – auf einer 400 x 80-Karte
 * waeren das vier Ziele zu 12 800 x 2 560 px gewesen. Jetzt liegen sie in denselben Render-Chunks
 * wie die uebrigen Weltschichten; die Zusicherungen dieses Tests sind entsprechend:
 *
 * - kein Renderziel skaliert mit der Weltflaeche,
 * - jeder Chunk startet deckend weiss (neutral fuer MULTIPLY),
 * - eine Dirty-Region schreibt chunklokal, nicht in Weltkoordinaten,
 * - der Teardown laesst nichts stehen.
 */

interface TextureEvent {
  depth: number;
  fills: number;
  draws: number;
  visible: boolean;
  width: number;
  height: number;
  x: number;
  y: number;
  destroyed: boolean;
  stamps: Array<{ x: number; y: number; originX?: number; originY?: number; key?: string; frame?: unknown;
    rotation?: number; scaleX?: number; scaleY?: number; alpha?: number; tint?: number }>;
  cameraScrolls: Array<{ x: number; y: number }>;
}

interface GraphicsEvent {
  depth: number;
  clears: number;
  fillPoints: Array<Array<{ x: number; y: number }>>;
}

function makeScene() {
  const textures: TextureEvent[] = [];
  const graphicsLog: GraphicsEvent[] = [];

  const makeGraphics = () => {
    const state: GraphicsEvent = { depth: 0, clears: 0, fillPoints: [] };
    graphicsLog.push(state);
    const g: Record<string, unknown> = {};
    for (const name of ['fillStyle', 'fillEllipse', 'fillCircle', 'fillRect', 'fillPoints',
      'beginPath', 'closePath', 'fillPath', 'moveTo', 'lineTo', 'setBlendMode', 'setVisible',
      'setMask', 'clearMask', 'destroy', 'lineStyle', 'strokePath']) {
      g[name] = () => g;
    }
    g.fillPoints = (points: Array<{ x: number; y: number }>) => {
      state.fillPoints.push(points.map(({ x, y }) => ({ x, y })));
      return g;
    };
    g.setDepth = (d: number) => { state.depth = d; return g; };
    g.clear = () => { state.clears += 1; return g; };
    return g;
  };

  let textureId = 0;
  const makeRenderTexture = (x: number, y: number, width: number, height: number) => {
    const event: TextureEvent = {
      depth: 0,
      fills: 0,
      draws: 0,
      visible: true,
      width,
      height,
      x,
      y,
      destroyed: false,
      stamps: [],
      cameraScrolls: [],
    };
    textures.push(event);
    const camera = {
      scrollX: 0,
      scrollY: 0,
      setScroll(nextX: number, nextY: number) {
        this.scrollX = nextX;
        this.scrollY = nextY;
        event.cameraScrolls.push({ x: nextX, y: nextY });
      },
    };
    // `active` ist kein Detail: Der Teardown raeumt nur auf, was noch aktiv ist.
    const frames: Record<string, {
      x: number;
      y: number;
      width: number;
      height: number;
      setSize(width: number, height: number, x?: number, y?: number): this;
    }> = {};
    const rt: Record<string, unknown> = {
      camera,
      active: true,
      texture: {
        key: `shadow_rt_${textureId++}`,
        firstFrame: '__BASE',
        frames,
        has: (name: string) => name in frames,
        add: (name: string, _sourceIndex: number, fx: number, fy: number, fw: number, fh: number) => {
          frames[name] = {
            x: fx,
            y: fy,
            width: fw,
            height: fh,
            setSize(width, height, x = 0, y = 0) {
              this.x = x;
              this.y = y;
              this.width = width;
              this.height = height;
              return this;
            },
          };
        },
        get: (name: string) => frames[name],
      },
    };
    for (const name of ['setOrigin', 'setBlendMode', 'setMask', 'clearMask', 'setRenderMode',
      'setFrame', 'clear', 'render']) {
      rt[name] = () => rt;
    }
    rt.setPosition = (nextX: number, nextY: number) => { event.x = nextX; event.y = nextY; return rt; };
    rt.setVisible = (visible: boolean) => { event.visible = visible; return rt; };
    rt.setDepth = (d: number) => { event.depth = d; return rt; };
    rt.fill = () => { event.fills += 1; return rt; };
    rt.draw = () => { event.draws += 1; return rt; };
    rt.destroy = () => { event.destroyed = true; rt.active = false; return rt; };
    rt.stamp = (
      _key: string,
      _frame: unknown,
      sx: number,
      sy: number,
      config?: { originX?: number; originY?: number; rotation?: number; scaleX?: number; scaleY?: number; alpha?: number; tint?: number },
    ) => {
      event.stamps.push({ x: sx, y: sy, key: _key, frame: _frame, ...config });
      return rt;
    };
    return rt;
  };

  const scene = { add: { graphics: makeGraphics, renderTexture: makeRenderTexture } } as never;
  return { scene, textures, graphicsLog };
}

function layout(rockCount: number, treeCount: number): ArenaLayout {
  return {
    rocks: Array.from({ length: rockCount }, (_, i) => ({ gridX: i + 1, gridY: 1 })),
    trees: Array.from({ length: treeCount }, (_, i) => ({ gridX: i + 1, gridY: 3 })),
  } as unknown as ArenaLayout;
}

/** Alle je erzeugten Chunk-Ziele; das Scratch-Ziel ist an seiner Kantenlaenge erkennbar. */
function chunkTargets(textures: TextureEvent[]): TextureEvent[] {
  return textures.filter((texture) => texture.width === CHUNK_TARGET_SIZE);
}

/** Die gerade residenten: Ein freigegebenes Ziel wandert unsichtbar in den Pool. */
function visibleChunkTargets(textures: TextureEvent[]): TextureEvent[] {
  return chunkTargets(textures).filter((texture) => texture.visible && !texture.destroyed);
}

function totalDraws(textures: TextureEvent[]): number {
  return textures.reduce((sum, texture) => sum + texture.draws, 0);
}

function drain(scene: object): void {
  ChunkedRenderSurface.drainBakeQueue(scene as never);
}

describe('static shadow baking', () => {
  it('invalidates a changed woodland profile, scales its southeast cast with the crown and restores the baseline', () => {
    const { scene, textures } = makeScene(), shadows = new ShadowSystem(scene);
    shadows.setWorldBoundsOverride({ minX: 0, minY: 0, maxX: 1536, maxY: 1024 });
    shadows.setTimeOfDay(1020);
    shadows.rebuildStaticLayoutShadows(layout(0, 0), { offsetX: 0, offsetY: 0 }); drain(scene);
    const source = { worldX: 500, worldY: 300, gfx: { texture: { key: 'canopy-proof' }, frame: { name: '__BASE' },
      displayWidth: 200, displayHeight: 200, scaleX: .5, scaleY: .5, rotation: 0 } };
    const sources = [source];
    const stamps = () => [...new Map(textures.flatMap(t => t.stamps).filter(s => s.key === 'canopy-proof')
      .map(s => [s.x + ':' + s.y, s] as const)).values()];
    const clear = () => { for (const t of textures) t.stamps.length = 0; };
    const centre = (s: ReturnType<typeof stamps>) => [s.reduce((n, v) => n + v.x, 0) / s.length,
      s.reduce((n, v) => n + v.y, 0) / s.length];
    shadows.setCanopyShadows(sources as never); drain(scene);
    const baseline = stamps(); clear();
    shadows.setCanopyShadows(sources as never, true); drain(scene);
    const woodland = stamps(), c = centre(woodland);
    expect(woodland.length).toBeGreaterThan(0);
    expect(c[0]).toBeGreaterThan(source.worldX); expect(c[1]).toBeGreaterThan(source.worldY);
    expect(c[0] - source.worldX).toBeCloseTo(c[1] - source.worldY);
    expect(woodland[0].tint).not.toBe(baseline[0].tint);
    expect(woodland[0].alpha!).toBeGreaterThan(baseline[0].alpha!);
    const draws = totalDraws(textures);
    shadows.setCanopyShadows(sources as never, true); drain(scene);
    expect(totalDraws(textures)).toBe(draws);
    clear();
    source.gfx.displayWidth *= 2; source.gfx.displayHeight *= 2;
    source.gfx.scaleX *= 2; source.gfx.scaleY *= 2;
    shadows.setCanopyShadows([source] as never, true); drain(scene);
    const larger = centre(stamps());
    expect(larger[0] - source.worldX).toBeCloseTo(2 * (c[0] - source.worldX));
    expect(larger[1] - source.worldY).toBeCloseTo(2 * (c[1] - source.worldY));
    clear();
    shadows.setCanopyShadows(null); drain(scene);
    expect(stamps()).toHaveLength(0); shadows.destroy();
  });

  it('bakes canopy silhouettes through the world camera and releases the opt-in source on clear', () => {
    const { scene, textures } = makeScene(), shadows = new ShadowSystem(scene);
    shadows.setWorldBoundsOverride({ minX: 0, minY: 0, maxX: 1536, maxY: 512 });
    shadows.setTimeOfDay(720);
    shadows.rebuildStaticLayoutShadows(layout(0, 0), { offsetX: 0, offsetY: 0 });
    drain(scene);
    const originalDepths = visibleChunkTargets(textures).map(texture => texture.depth).sort();
    const sources = [{ worldX: 1000, worldY: 220, gfx: { texture: { key: 'canopy-proof' }, frame: { name: '__BASE' },
      displayWidth: 192, displayHeight: 192, scaleX: .5, scaleY: .5, rotation: .63, tint: 0x345678 } }];
    const originalSources = structuredClone(sources);
    shadows.setCanopyShadows(sources as never); drain(scene);
    const stamps = textures.flatMap(texture => texture.stamps).filter(stamp => stamp.key === 'canopy-proof');
    expect(stamps.length).toBeGreaterThan(0);
    // Local coordinates would be wrong in Phaser 4: the scratch camera already subtracts the region origin.
    expect(stamps.every(stamp => stamp.x > 1000 && stamp.y > 220 && stamp.rotation === .63)).toBe(true);
    expect(stamps.every(stamp => stamp.frame === '__BASE' && stamp.scaleX === .5 && stamp.scaleY === .5)).toBe(true);
    expect(sources).toEqual(originalSources);
    const trialTargets = visibleChunkTargets(textures);
    expect(trialTargets).toHaveLength(originalDepths.length);
    expect(trialTargets.some(texture => texture.depth === SHADOW_CASTERS.canopy.layerDepth)).toBe(false);
    expect(trialTargets.some(texture => texture.depth < DEPTH.GROUND_FOG)).toBe(true);
    const draws = totalDraws(textures);
    shadows.setCanopyShadows(sources as never); drain(scene);
    expect(totalDraws(textures)).toBe(draws);
    shadows.clear();
    for (const texture of textures) texture.stamps.length = 0;
    shadows.rebuildStaticLayoutShadows(layout(0, 1), { offsetX: 0, offsetY: 0 }); drain(scene);
    expect(textures.flatMap(texture => texture.stamps).some(stamp => stamp.key === 'canopy-proof')).toBe(false);
    expect(visibleChunkTargets(textures).map(texture => texture.depth).sort()).toEqual(originalDepths);
    shadows.destroy();
  });

  it('keeps the soft canopy kernel centred, weakens it at night, and restores original layers when disabled', () => {
    const { scene, textures } = makeScene(), shadows = new ShadowSystem(scene);
    shadows.setWorldBoundsOverride({ minX: 0, minY: 0, maxX: 512, maxY: 512 });
    shadows.setTimeOfDay(720);
    shadows.rebuildStaticLayoutShadows(layout(0, 1), { offsetX: 0, offsetY: 0 }); drain(scene);
    const originalDepths = visibleChunkTargets(textures).map(texture => texture.depth).sort();
    const sources = [{ worldX: 220, worldY: 220, gfx: { texture: { key: 'canopy-proof' }, frame: { name: 'crown' },
      displayWidth: 100, displayHeight: 100, scaleX: .5, scaleY: .5, rotation: .4 } }];
    shadows.setCanopyShadows(sources as never); drain(scene);
    // Each intersecting bake region records the same world-space kernel.
    const canopyStamps = () => [...new Map(textures.flatMap(texture => texture.stamps)
      .filter(stamp => stamp.key === 'canopy-proof').map(stamp => [`${stamp.x}:${stamp.y}`, stamp] as const)).values()];
    const day = canopyStamps();
    expect(new Set(day.map(stamp => stamp.alpha)).size).toBeGreaterThan(1);
    // Optical weights are centred around one translated silhouette; jitter has no preferred side.
    const weighted = (axis:'x'|'y') => day.reduce((sum, stamp) => sum + stamp[axis] * -Math.log(1-stamp.alpha!), 0)
      / day.reduce((sum, stamp) => sum - Math.log(1-stamp.alpha!), 0);
    const centreX = weighted('x'), centreY = weighted('y');
    expect(centreX).toBeCloseTo(centreY);
    expect(day.every(stamp => day.some(other => Math.abs(stamp.x+other.x-centreX*2)<.0001
      && Math.abs(stamp.y+other.y-centreY*2)<.0001 && stamp.alpha===other.alpha))).toBe(true);
    const dayOpacity = 1-day.reduce((transmission,stamp)=>transmission*(1-stamp.alpha!),1);
    for(const texture of textures)texture.stamps.length=0;
    shadows.setTimeOfDay(0);shadows.syncStaticProfile(1000,true);drain(scene);
    const night = canopyStamps();
    expect(night.length).toBe(day.length);
    const nightOpacity = 1-night.reduce((transmission,stamp)=>transmission*(1-stamp.alpha!),1);
    expect(nightOpacity).toBeGreaterThan(0);expect(nightOpacity).toBeLessThan(dayOpacity);
    shadows.setCanopyShadows(null);drain(scene);
    expect(visibleChunkTargets(textures).map(texture => texture.depth).sort()).toEqual(originalDepths);
    shadows.destroy();
  });

  it('caches base cells and removes their shadows as surface images disappear', () => {
    const { scene, graphicsLog, textures } = makeScene();
    const shadows = new ShadowSystem(scene);
    shadows.setWorldBoundsOverride({ minX: 0, minY: 0, maxX: ARENA_RENDER_CHUNK_SIZE * 2, maxY: 512 });
    shadows.rebuildStaticLayoutShadows(layout(0, 0), { offsetX: 0, offsetY: 0 });
    const cell = { x: ARENA_RENDER_CHUNK_SIZE, y: 100, active: true, visible: true };
    shadows.syncBaseShadows([cell]);
    drain(scene);
    const graphics = graphicsLog.find((entry) => entry.depth === SHADOW_CASTERS.base.layerDepth)!;
    expect(graphics.fillPoints.length).toBeGreaterThan(0);

    const draws = totalDraws(textures);
    shadows.syncBaseShadows([cell]);
    drain(scene);
    expect(totalDraws(textures)).toBe(draws);

    graphics.fillPoints.length = 0;
    for (const texture of textures) texture.stamps.length = 0;
    cell.active = false;
    shadows.syncBaseShadows([cell]);
    drain(scene);
    expect(totalDraws(textures)).toBeGreaterThan(draws);
    expect(graphics.fillPoints).toHaveLength(0);
    const updatedChunks = chunkTargets(textures).filter((texture) => texture.stamps.length > 0);
    expect(updatedChunks.some((texture) => texture.x <= 0)).toBe(true);
    expect(updatedChunks.some((texture) => texture.x > ARENA_RENDER_CHUNK_SIZE / 2)).toBe(true);
    shadows.destroy();
  });

  it('bakes a far-right lobby rock through the public layout path', () => {
    const { scene, graphicsLog } = makeScene();
    const shadows = new ShadowSystem(scene);
    shadows.setWorldBoundsOverride({ minX: 0, minY: 0, maxX: 1_920, maxY: 1_080 });

    shadows.rebuildStaticLayoutShadows({
      rocks: [{ gridX: 50, gridY: 1 }],
      trees: [],
    } as unknown as ArenaLayout, { offsetX: 0, offsetY: 0 });
    drain(scene);

    const rockGraphics = graphicsLog.find((entry) => entry.depth === SHADOW_CASTERS.rock.layerDepth);
    expect(rockGraphics?.fillPoints.some((points) => points.some(({ x }) => x > 1_500))).toBe(true);
  });

  it('never allocates a render target that scales with the arena', () => {
    const { scene, textures } = makeScene();
    const shadows = new ShadowSystem(scene);

    shadows.rebuildStaticLayoutShadows(layout(3, 2));
    drain(scene);

    expect(textures.length).toBeGreaterThan(0);
    for (const texture of textures) {
      expect(texture.width).toBeLessThanOrEqual(CHUNK_TARGET_SIZE);
      expect(texture.height).toBeLessThanOrEqual(CHUNK_TARGET_SIZE);
      // Die frueheren Ziele waren so gross wie die Arena; genau das darf nicht wiederkommen.
      expect(texture.width).toBeLessThan(ARENA_WIDTH);
      expect(texture.height).toBeLessThan(ARENA_HEIGHT);
    }
  });

  it('fills every baked chunk with white, the neutral element of MULTIPLY', () => {
    const { scene, textures } = makeScene();
    const shadows = new ShadowSystem(scene);

    shadows.rebuildStaticLayoutShadows(layout(3, 2));
    drain(scene);

    // Der weisse Grund entsteht im chunklokalen Scratch-Ziel und wird von dort geblittet.
    const scratch = textures.find((texture) => texture.fills > 0);
    expect(scratch).toBeTruthy();
    expect(scratch!.draws).toBeGreaterThan(0);
    // Fels, Stamm und Krone liegen auf verschiedenen Tiefen -> je eine Ebene je Chunk.
    const depths = new Set(chunkTargets(textures).map((texture) => texture.depth));
    expect(depths.size).toBeGreaterThanOrEqual(3);
  });

  it('positions each chunk target at its own world corner', () => {
    const { scene, textures } = makeScene();
    const shadows = new ShadowSystem(scene);

    shadows.rebuildStaticLayoutShadows(layout(3, 2));
    drain(scene);

    const positions = new Set(chunkTargets(textures).map((texture) => `${texture.x}:${texture.y}`));
    expect(positions.has(`${ARENA_OFFSET_X}:${ARENA_OFFSET_Y}`)).toBe(true);
    // Mehr als eine Ecke: Die Arena ist breiter als ein Chunk.
    expect(positions.size).toBeGreaterThan(1);
  });

  it('rebuilds a known rock change through a bounded 128 px region, not the whole world', () => {
    const { scene, textures } = makeScene();
    const shadows = new ShadowSystem(scene);
    const arenaLayout = layout(20, 2);
    const rockObjects = Array.from({ length: 20 }, () => ({ active: true }));
    const arenaResult = { rockPhysicsProxies: rockObjects } as never;

    shadows.rebuildArenaStaticShadows(arenaLayout, arenaResult);
    drain(scene);
    const drawsAfterBuild = totalDraws(textures);

    rockObjects[4].active = false;
    shadows.rebuildArenaStaticShadowRegions(arenaLayout, arenaResult, new Set([4]));
    drain(scene);
    const dirtyDraws = totalDraws(textures) - drawsAfterBuild;

    expect(dirtyDraws).toBeGreaterThan(0);
    // Eine einzelne Zerstoerung darf nur einen Bruchteil der Arbeit des Vollaufbaus kosten.
    expect(dirtyDraws).toBeLessThan(drawsAfterBuild / 2);
    // Und sie laeuft ueber ein 128er-Scratch-Ziel.
    expect(textures.some(
      (texture) => texture.width === DIRTY_SCRATCH_SIZE && texture.height === DIRTY_SCRATCH_SIZE,
    )).toBe(true);
  });

  it('keeps finished chunks visible during a preserved full rebuild', () => {
    const { scene, textures } = makeScene();
    const shadows = new ShadowSystem(scene);
    const arenaLayout = layout(3, 2);
    const arenaResult = { rockPhysicsProxies: Array.from({ length: 3 }, () => ({ active: true })) } as never;

    shadows.rebuildArenaStaticShadows(arenaLayout, arenaResult);
    drain(scene);
    const visibleBefore = visibleChunkTargets(textures);
    expect(visibleBefore.length).toBeGreaterThan(0);

    shadows.rebuildArenaStaticShadows(arenaLayout, arenaResult, [], true);

    expect(visibleChunkTargets(textures)).toHaveLength(visibleBefore.length);
    expect(shadows.getStaticSurfaceStats()?.pendingRegions).toBeGreaterThan(0);
    drain(scene);
    expect(visibleChunkTargets(textures)).toHaveLength(visibleBefore.length);
  });

  it('blits a dirty shadow chunk in chunk-local coordinates, with a neutral target camera', () => {
    const { scene, textures } = makeScene();
    const shadows = new ShadowSystem(scene);
    const arenaLayout = layout(20, 0);
    const rockObjects = Array.from({ length: 20 }, () => ({ active: true }));
    const arenaResult = { rockPhysicsProxies: rockObjects } as never;

    shadows.rebuildArenaStaticShadows(arenaLayout, arenaResult);
    drain(scene);
    for (const texture of textures) texture.stamps.length = 0;

    rockObjects[4].active = false;
    shadows.rebuildArenaStaticShadowRegions(arenaLayout, arenaResult, new Set([4]));
    drain(scene);

    const written = chunkTargets(textures).filter((texture) => texture.stamps.length > 0);
    expect(written.length).toBeGreaterThan(0);
    for (const target of written) {
      for (const stamp of target.stamps) {
        // Chunklokal: innerhalb des Ziels und am 128er-Raster ausgerichtet – nie die Weltposition.
        expect(stamp.x).toBeGreaterThanOrEqual(0);
        expect(stamp.x).toBeLessThan(ARENA_RENDER_CHUNK_SIZE);
        expect(stamp.y).toBeGreaterThanOrEqual(0);
        expect(stamp.y).toBeLessThan(ARENA_RENDER_CHUNK_SIZE);
        expect(stamp.x % 128).toBe(0);
        expect(stamp.originX).toBe(0);
        expect(stamp.originY).toBe(0);
      }
      // Die Zielkamera bleibt neutral; den Weltversatz traegt allein die Position des Ziels.
      expect(target.cameraScrolls.every((scroll) => scroll.x === 0 && scroll.y === 0)).toBe(true);
    }

    // Das Scratch-Ziel dagegen liest weltpositionierte Graphics ein und scrollt dafuer auf die
    // Weltecke der Region – der Arena-Offset von 12 px steckt genau dort, um den Gutter nach
    // aussen versetzt.
    const scratchScrolls = textures
      .filter((texture) => texture.width === DIRTY_SCRATCH_SIZE)
      .flatMap((texture) => texture.cameraScrolls);
    expect(scratchScrolls.some((scroll) => scroll.y === ARENA_OFFSET_Y - CHUNK_SAMPLING_GUTTER_PX)).toBe(true);
  });

  it('drops every chunk target on teardown so no shadows survive into the lobby', () => {
    const { scene, textures } = makeScene();
    const shadows = new ShadowSystem(scene);
    shadows.rebuildStaticLayoutShadows(layout(3, 2));
    drain(scene);

    const targets = visibleChunkTargets(textures);
    expect(targets.length).toBeGreaterThan(0);

    shadows.clear();

    // Verworfen statt weiss gefuellt: Ohne Layout gibt es nichts zu backen, und ein neutrales
    // Vollflaechen-Ziel waere nur ein Blendpass pro Frame. Das unsichtbare Scratch-Ziel bleibt
    // bewusst stehen – es ist wiederverwendeter Arbeitsspeicher, kein sichtbarer Inhalt.
    expect(targets.every((texture) => texture.destroyed)).toBe(true);
    expect(visibleChunkTargets(textures)).toEqual([]);
  });

  it('keeps a fresh layout rebuilding every chunk', () => {
    const { scene, textures } = makeScene();
    const shadows = new ShadowSystem(scene);
    const arenaResult = { rockPhysicsProxies: [{ active: true }] } as never;

    shadows.rebuildArenaStaticShadows(layout(1, 1), arenaResult);
    drain(scene);
    const first = totalDraws(textures);
    // Neues Layout-Objekt -> alles muss neu entstehen.
    shadows.rebuildArenaStaticShadows(layout(1, 1), arenaResult);
    drain(scene);
    expect(totalDraws(textures)).toBeGreaterThan(first + 1);
  });

  it('throttles static profile bakes and still forces the scripted final state', () => {
    const { scene, textures } = makeScene();
    const shadows = new ShadowSystem(scene);
    shadows.rebuildStaticLayoutShadows(layout(3, 2));
    drain(scene);
    const initialDraws = totalDraws(textures);
    const initiallyVisible = visibleChunkTargets(textures).length;

    shadows.setTimeOfDay(19 * 60 + 45);
    expect(shadows.syncStaticProfile(1_000)).toBe(true);
    expect(visibleChunkTargets(textures)).toHaveLength(initiallyVisible);
    expect(shadows.getStaticSurfaceStats()?.pendingRegions).toBeGreaterThan(0);
    drain(scene);
    const firstProfileDraws = totalDraws(textures);
    expect(firstProfileDraws).toBeGreaterThan(initialDraws);

    shadows.setTimeOfDay(21 * 60 + 30);
    expect(shadows.syncStaticProfile(1_200)).toBe(false);
    expect(totalDraws(textures)).toBe(firstProfileDraws);
    expect(shadows.syncStaticProfile(1_600)).toBe(true);
    drain(scene);
    const throttledDraws = totalDraws(textures);
    expect(throttledDraws).toBeGreaterThan(firstProfileDraws);

    shadows.setTimeOfDay(23 * 60 + 30);
    expect(shadows.syncStaticProfile(1_601, true)).toBe(true);
    drain(scene);
    expect(totalDraws(textures)).toBeGreaterThan(throttledDraws);
    expect(shadows.syncStaticProfile(1_602)).toBe(false);
  });

  it('streams its chunks with the camera once a view is reported', () => {
    const { scene, textures } = makeScene();
    const shadows = new ShadowSystem(scene);
    shadows.rebuildStaticLayoutShadows(layout(3, 2));
    drain(scene);
    const fullyResident = visibleChunkTargets(textures).length;
    expect(fullyResident).toBeGreaterThan(0);

    // Ein gemeldeter Ausschnitt engt die Residenz ein; ohne Meldung – wie in der
    // Lobby-Vorschau – bleibt der gesamte Rahmen resident.
    shadows.updateStaticResidency({ x: ARENA_OFFSET_X, y: ARENA_OFFSET_Y, width: 200, height: 200 });
    drain(scene);
    expect(visibleChunkTargets(textures).length).toBeLessThan(fullyResident);
  });
});

it('throttles direction rebakes, preserves unchanged bins and restores the production hull',async()=>{
  const {createSunPath,resolveSunPath}=await import('../src/effects/sunlight/SunPath');
  const {scene,graphicsLog}=makeScene(),shadows=new ShadowSystem(scene);
  shadows.setWorldBoundsOverride({minX:0,minY:0,maxX:512,maxY:512});shadows.setTimeOfDay(720);
  shadows.rebuildStaticLayoutShadows(layout(1,0),{offsetX:0,offsetY:0});drain(scene);
  const rock=graphicsLog.find(g=>g.depth===SHADOW_CASTERS.rock.layerDepth)!;
  const original=structuredClone(rock.fillPoints);const path=resolveSunPath(720,0,createSunPath());
  shadows.setSunPath(path);expect(shadows.syncStaticProfile(1000)).toBe(true);drain(scene);
  resolveSunPath(720,1,path);shadows.setSunPath(path);expect(shadows.syncStaticProfile(2000)).toBe(false);
  resolveSunPath(720,6,path);shadows.setSunPath(path);expect(shadows.syncStaticProfile(1200)).toBe(false);
  expect(shadows.syncStaticProfile(1600)).toBe(true);drain(scene);
  rock.fillPoints.length=0;shadows.setSunPath(null);drain(scene);expect(rock.fillPoints).toEqual(original);
  expect(shadows.syncStaticProfile(5000)).toBe(false);shadows.destroy();
});
it('builds gapless convex stadiums in every shadow direction',async()=>{
  const {createSunPath,resolveSunPath}=await import('../src/effects/sunlight/SunPath');
  const {scene}=makeScene(),shadows=new ShadowSystem(scene),path=createSunPath();
  let pts:{x:number;y:number}[]=[];const graphics={fillStyle(){},fillPoints(p:typeof pts){pts=p.map(v=>({...v}));}};
  for(const angle of [0,45,90,135,180,225,270,315]){
    resolveSunPath(720,angle,path);shadows.setSunPath(path);const dx=-path.direction[0]*60,dy=-path.direction[1]*60;
    (shadows as any).fillStadiumShadow(graphics,0,0,12,dx,dy,.5);
    let area=0;
    for(let i=0;i<pts.length;i++) {const a=pts[i],b=pts[(i+1)%pts.length],c=pts[(i+2)%pts.length];area+=a.x*b.y-a.y*b.x;
      expect((b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x)).toBeGreaterThanOrEqual(-1e-8);
      for(const p of [{x:0,y:0},{x:dx,y:dy}])expect((b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x)).toBeGreaterThanOrEqual(-1e-8);
    }
    expect(area/2).toBeGreaterThan(60*24+12*12*Math.PI*.95);expect(area/2).toBeLessThanOrEqual(60*24+12*12*Math.PI);
  }shadows.destroy();
});

it('visits enemy casters only with a bound sun path and omits hidden or burrowed enemies',async()=>{
  const {createSunPath,resolveSunPath}=await import('../src/effects/sunlight/SunPath');
  const {scene}=makeScene();const shadows=new ShadowSystem(scene as any);
  const enemy={sprite:{active:true,visible:true,x:12,y:34},getHp:()=>10,getSize:()=>30,isBurrowed:()=>false};
  const source={forEachEnemy:vi.fn((visit:any)=>visit(enemy))};
  const draw=vi.spyOn(shadows as any,'drawFootprint');
  shadows.setSunPath(resolveSunPath(720,null,createSunPath()),source as any);
  shadows.syncDynamicShadows([],[],null);expect(source.forEachEnemy).toHaveBeenCalledTimes(1);expect(draw).toHaveBeenCalledTimes(1);
  enemy.sprite.visible=false;shadows.syncDynamicShadows([],[],null);expect(draw).toHaveBeenCalledTimes(1);
  enemy.sprite.visible=true;enemy.isBurrowed=()=>true;shadows.syncDynamicShadows([],[],null);expect(draw).toHaveBeenCalledTimes(1);
  shadows.setSunPath(null);shadows.syncDynamicShadows([],[],null);expect(source.forEachEnemy).toHaveBeenCalledTimes(3);
  shadows.destroy();
});
