import type * as Phaser from 'phaser';
import type { ActivityVoidDanger, VoidDangerAlert } from '../../arena/VoidDangerField';
import { MAX_VOID_DANGER_ALERTS } from '../../arena/VoidDangerField';
import { RouteFlowMarchers } from './RouteFlowMarchers';
import type { GroundGlowLightFrame, LightingSystem } from '../LightingSystem';
import { createRouteFlowLayers, createRouteFlowMinimapLayer, type RouteFlowLayers } from './RouteFlowGpuLayer';
import { buildRouteFlowGeometry, RouteFlowKind, RouteFlowStore, type RouteFlowRoute } from './RouteFlowStore';

interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

export interface RouteFlowPlan {
  /** Routes drawn in the World view. */
  readonly view: readonly RouteFlowRoute[];
  /** Routes drawn on the minimap: the whole map. */
  readonly overview: readonly RouteFlowRoute[];
  /** Spawn zones the shown routes leave from, those that matter first; they stand active and breathe. */
  readonly zones: readonly Rect[];
  readonly clip: Rect;
}

const STREAM_LIGHT_COLOR = 0xb27cff;
const BREACH_LIGHT_COLOR = 0xff4f86;
/** The current's own light: subtle by day over its bed, the whole stream at night. */
const STREAM_GLOW = { day: .75, night: 1.5 } as const;
/** Warning level of feeding zones: active, with a slow breath. */
const ZONE_ALERT = { base: .8, swing: .2, rate: .0012 } as const;
/** Small violet ground lights along the streams, so the current lights its soil at night. */
const STREAM_LIGHT = { spacingPx: 150, radiusPx: 72, intensity: .32, max: 40 } as const;

/**
 * Owner of the situation map's Void-Strömung: GPU streams in the World and on the minimap, the
 * breathing haze over the spawn zones that feed them, small ground lights at the entries and the
 * phantom marchers that taint the fog along the routes as the round's enemies will (E14).
 */
export class RouteFlowPresentation {
  private readonly store = new RouteFlowStore();
  private readonly layers: RouteFlowLayers;
  private minimap: { store: RouteFlowStore; image: Phaser.GameObjects.Image | null } | null = null;
  private clockMs = 0;
  private plan: RouteFlowPlan | null = null;
  private breaches = new Set<string>();
  private zones: readonly Rect[] = [];
  private readonly alertList: VoidDangerAlert[] = [];
  private readonly lights: { lights: GroundGlowLightFrame['lights']; lightCount: number } = { lights: [], lightCount: 0 };
  private readonly marchers = new RouteFlowMarchers();
  private fogShape: { readonly texture: Phaser.Textures.Texture; readonly view: Float32Array } | null = null;
  /** Spawn-zone haze and marchers for the World's void presentation; the World has no Activity of its own. */
  readonly voidDanger: ActivityVoidDanger;

  constructor(private readonly scene: Phaser.Scene, private readonly lighting: LightingSystem) {
    this.layers = createRouteFlowLayers(scene, this.store, () => this.clockMs, () => {
      // The same night curve as the void fog's spores: the lamps' own dusk.
      const night = Math.max(0, Math.min(1, (lighting.getArtificialLightFactor() - .1) / .6));
      return STREAM_GLOW.day + (STREAM_GLOW.night - STREAM_GLOW.day) * night;
    }, () => this.fogShape);
    const alerts = this.alertList;
    this.voidDanger = { sources: [], presenceOf: () => 1, get alerts() { return alerts; }, marchers: this.marchers };
  }

  /** Shows a plan; streams that keep flowing keep their age and marchers, rerouted ones surge in. */
  setPlan(plan: RouteFlowPlan): void {
    this.plan = plan;
    const geometry = buildRouteFlowGeometry(plan.view, { tolerance: .75, clip: plan.clip });
    this.store.setGeometry(geometry, this.clockMs);
    this.marchers.setRoutes(plan.view, plan.clip);
    this.lights.lights = streamLights(plan.view, plan.clip);
    this.lights.lightCount = this.lights.lights.length;
    this.lighting.setGroundGlowLights(this, this.lights.lightCount ? this.lights : null, { decorative: true });
    const breaches = new Set<string>();
    for (const mark of geometry.marks) if (mark.kind === RouteFlowKind.Breach) {
      breaches.add(mark.key);
      if (!this.breaches.has(mark.key)) this.lighting.pulse('explosion', mark.x, mark.y, { radiusPx: 150, color: BREACH_LIGHT_COLOR });
    }
    this.breaches = breaches;
    this.zones = plan.zones.slice(0, MAX_VOID_DANGER_ALERTS);
    this.syncMinimap();
  }

  /** The ground fog's shape after its draw this frame; thick banks veil the current's light. */
  setFogShape(shape: { readonly texture: Phaser.Textures.Texture; readonly view: Float32Array } | null): void {
    this.fogShape = shape;
  }

  /** The current also flows over the minimap, in its panel space. */
  attachMinimap(container: Phaser.GameObjects.Container, placement: { readonly originX: number; readonly originY: number; readonly unit: number }): void {
    this.detachMinimap();
    const store = new RouteFlowStore({ ...placement, minHalfWidth: 1.1 });
    const image = createRouteFlowMinimapLayer(this.scene, store, () => this.clockMs, placement.unit);
    if (image) container.add(image);
    this.minimap = { store, image };
    this.syncMinimap();
  }

  update(deltaMs: number): void {
    this.clockMs += Math.max(0, deltaMs);
    this.marchers.update(deltaMs);
    // Feeding zones stand as in a round when they are about to release enemies: thick haze that
    // breathes, each zone in its own rhythm, so the current visibly gathers out of it.
    this.alertList.length = 0;
    this.zones.forEach((zone, i) => this.alertList.push({ ...zone,
      level: ZONE_ALERT.base + ZONE_ALERT.swing * (.5 + .5 * Math.sin(this.clockMs * ZONE_ALERT.rate + i * 1.7)) }));
  }

  destroy(): void {
    this.marchers.clear(); this.fogShape = null;
    this.lighting.setGroundGlowLights(this, null);
    this.detachMinimap();
    this.layers.destroy();
    this.alertList.length = 0;
  }

  private syncMinimap(): void {
    if (!this.minimap) return;
    if (!this.plan) { this.minimap.store.clear(); return; }
    this.minimap.store.setGeometry(buildRouteFlowGeometry(this.plan.overview, { tolerance: 6 }), this.clockMs);
  }

  private detachMinimap(): void {
    this.minimap?.image?.destroy();
    this.minimap = null;
  }
}

/** Lights every few steps along the visible streams, dimmer where a route matters less. */
type GroundGlowLight = GroundGlowLightFrame['lights'][number];

function streamLights(routes: readonly RouteFlowRoute[], clip: Rect): GroundGlowLight[] {
  const lights: GroundGlowLight[] = [];
  for (const route of routes) {
    let travelled = STREAM_LIGHT.spacingPx / 2;
    for (let i = 1; i < route.points.length && lights.length < STREAM_LIGHT.max; i++) {
      const a = route.points[i - 1]!, b = route.points[i]!;
      // Nothing walks through a portal jump; the lights start over at its exit.
      if (b.portal) { travelled = 0; continue; }
      travelled += Math.hypot(b.x - a.x, b.y - a.y);
      if (travelled < STREAM_LIGHT.spacingPx) continue;
      travelled = 0;
      if (b.x < clip.x || b.y < clip.y || b.x > clip.x + clip.width || b.y > clip.y + clip.height) continue;
      lights.push({ x: b.x, y: b.y, radiusPx: STREAM_LIGHT.radiusPx, intensity: STREAM_LIGHT.intensity * route.strength,
        color: STREAM_LIGHT_COLOR });
    }
  }
  return lights;
}

