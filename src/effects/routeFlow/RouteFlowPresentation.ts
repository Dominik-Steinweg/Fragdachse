import type * as Phaser from 'phaser';
import type { ActivityVoidDanger, VoidDangerAlert } from '../../arena/VoidDangerField';
import { MAX_VOID_DANGER_ALERTS } from '../../arena/VoidDangerField';
import type { GroundGlowLightFrame, LightingSystem } from '../LightingSystem';
import { createRouteFlowLayers, createRouteFlowMinimapLayer, type RouteFlowLayers } from './RouteFlowGpuLayer';
import { buildRouteFlowGeometry, RouteFlowKind, RouteFlowStore, type RouteFlowRoute } from './RouteFlowStore';

interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

export interface RouteFlowPlan {
  /** Routes drawn in the World view. */
  readonly view: readonly RouteFlowRoute[];
  /** Routes drawn on the minimap: the whole map. */
  readonly overview: readonly RouteFlowRoute[];
  /** Spawn zones whose routes matter; their void haze breathes. */
  readonly zones: readonly Rect[];
  readonly clip: Rect;
  readonly isInsideBuildArea: (x: number, y: number) => boolean;
}

const ENTRY_LIGHT_COLOR = 0xb27cff;
const BREACH_LIGHT_COLOR = 0xff4f86;

/**
 * Owner of the situation map's Void-Strömung: GPU streams in the World and on the minimap, the
 * breathing haze over the spawn zones that feed them and small ground lights at the entries.
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
  /** Spawn-zone haze for the World's void presentation; the World has no Activity of its own. */
  readonly voidDanger: ActivityVoidDanger;

  constructor(private readonly scene: Phaser.Scene, private readonly lighting: LightingSystem) {
    this.layers = createRouteFlowLayers(scene, this.store, () => this.clockMs);
    const alerts = this.alertList;
    this.voidDanger = { sources: [], presenceOf: () => 1, get alerts() { return alerts; } };
  }

  /** Shows a plan; streams that keep flowing keep their age, rerouted ones surge in. */
  setPlan(plan: RouteFlowPlan): void {
    this.plan = plan;
    const geometry = buildRouteFlowGeometry(plan.view, { tolerance: .75, clip: plan.clip, isInsideBuildArea: plan.isInsideBuildArea });
    this.store.setGeometry(geometry, this.clockMs);
    const entries = geometry.marks.filter((mark) => mark.kind === RouteFlowKind.Entry);
    this.lights.lights = entries.map((mark) => ({
      x: mark.x, y: mark.y, radiusPx: mark.radius * 2.6, intensity: .55 * mark.strength, color: ENTRY_LIGHT_COLOR }));
    this.lights.lightCount = entries.length;
    this.lighting.setGroundGlowLights(this, entries.length ? this.lights : null, { decorative: true });
    const breaches = new Set<string>();
    for (const mark of geometry.marks) if (mark.kind === RouteFlowKind.Breach) {
      breaches.add(mark.key);
      if (!this.breaches.has(mark.key)) this.lighting.pulse('explosion', mark.x, mark.y, { radiusPx: 150, color: BREACH_LIGHT_COLOR });
    }
    this.breaches = breaches;
    this.zones = plan.zones.slice(0, MAX_VOID_DANGER_ALERTS);
    this.syncMinimap();
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
    // The haze over feeding zones breathes; each zone in its own rhythm.
    this.alertList.length = 0;
    this.zones.forEach((zone, i) => this.alertList.push({ ...zone,
      level: .45 + .3 * (.5 + .5 * Math.sin(this.clockMs * .0016 + i * 1.7)) }));
  }

  destroy(): void {
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
