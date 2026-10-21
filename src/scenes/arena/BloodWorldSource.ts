import { getBridgeDeckWorldRect, type BridgeWorldRect } from '../../arena/BridgeGeometry';
import { WaterSurfaceModel } from '../../arena/WaterSurfaceModel';
import type { BloodWorld } from '../../effects/blood/BloodFieldSystem';
import type { BloodTerrain } from '../../effects/blood/BloodTerrain';
import type { ArenaLifecycleCoordinator } from './ArenaLifecycleCoordinator';

type BloodWorldFlow = Pick<ArenaLifecycleCoordinator, 'getWorldRuntime' | 'getWorldGeometryBinding'>;

/**
 * The current World for the scene's blood field. One `BloodWorld` per World layout and geometry
 * binding: a new World yields a new object, which starts a clean field. Every surface is read
 * lazily from the live World, so collapsed bridges, rock repairs and the sky are always current.
 */
export function createBloodWorldSource(flow: BloodWorldFlow): () => BloodWorld | null {
  let cache: { layout: object; geometry: object; world: BloodWorld } | null = null;
  return () => {
    const runtime = flow.getWorldRuntime();
    const layout = runtime?.presentation?.layout ?? null;
    const geometry = flow.getWorldGeometryBinding();
    const metrics = runtime?.context.metrics;
    if (!runtime || !layout || !geometry || !metrics) { cache = null; return null; }
    if (cache && cache.layout === layout && cache.geometry === geometry) return cache.world;

    const water = new WaterSurfaceModel(layout.water ?? [], { width: metrics.widthPx, height: metrics.heightPx });
    const bridges = layout.bridges ?? [];
    let decksFor: ReadonlySet<string> | null = null;
    let standing: BridgeWorldRect[] = [];
    const decks = (): readonly BridgeWorldRect[] => {
      const collapsed = geometry.getCollapsedBridgeIds();
      if (collapsed !== decksFor) {
        decksFor = collapsed;
        standing = bridges.filter(bridge => !collapsed.has(bridge.id)).map(bridge => getBridgeDeckWorldRect(bridge, metrics));
      }
      return standing;
    };
    const terrain: BloodTerrain = {
      traceObstacle: (startX, startY, endX, endY) => geometry.getQueries().traceDirectFire(startX, startY, endX, endY),
      waterDepth: (x, y) => water.sample(x - metrics.offsetX, y - metrics.offsetY),
      onDeck: (x, y) => {
        for (const deck of decks()) if (x >= deck.x && x < deck.x + deck.width && y >= deck.y && y < deck.y + deck.height) return true;
        return false;
      },
      bounds: { x: metrics.offsetX, y: metrics.offsetY, width: metrics.widthPx, height: metrics.heightPx },
      gridX: metrics.offsetX,
      gridY: metrics.offsetY,
    };
    const world: BloodWorld = {
      terrain,
      decks,
      rockCoverage: () => flow.getWorldRuntime()?.materialization?.arena?.rockVisualSystem?.getFormationCoverage() ?? null,
      sunlight: () => flow.getWorldRuntime()?.presentationFrame?.sunlight?.clouds,
      night: () => flow.getWorldRuntime()?.presentationFrame?.sunlight?.waterNight ?? null,
      water: () => flow.getWorldRuntime()?.materialization?.arena?.waterSurface ?? null,
    };
    cache = { layout, geometry, world };
    return world;
  };
}
