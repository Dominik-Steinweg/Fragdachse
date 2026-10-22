import * as Phaser from 'phaser';
import { getArenaVisualAttribution } from '../../scenes/arena/ArenaVisualAttribution';
import { getClarityCameraRegistry } from '../../scenes/arena/ClarityCameraRegistry';
import { attachBarSdf, type BarSdfSource } from '../bars/BarSdfGpu';
import { BAR_SDF_KIND, createBarSdfInstance, mixBarRgb, packBarColor, type BarSdfInstance } from '../bars/barSdfInstance';
import { HealthBarFeedbackModel, type HealthBarFeedbackTuning } from './HealthBarFeedbackModel';
import {
  HEALTH_BAR_BACKING, HEALTH_BAR_SHAPE, HEALTH_BAR_TRAIL, HEALTH_BAR_TUNING, type HealthBarFamily, type HealthBarStyle,
} from './healthBarStyles';

export interface HealthBarHandle { readonly slot: number; readonly generation: number }
interface Binding {
  readonly handle: HealthBarHandle;
  readonly scope: object;
  readonly style: HealthBarStyle;
  readonly model: HealthBarFeedbackModel;
  x: number; y: number; alpha: number; backgroundAlpha: number;
  suppressed: boolean;
}

/** All bars of one family and depth: one Image, one SDF batch, one draw. */
interface Layer {
  readonly family: HealthBarFamily;
  readonly depth: number;
  readonly instances: BarSdfInstance[];
  readonly source: BarSdfSource;
  readonly image: Phaser.GameObjects.Image;
}

/** Read-only view for diagnostics and tests; world coordinates, unrounded. */
export interface WorldHealthBarLayerSnapshot {
  readonly family: HealthBarFamily;
  readonly depth: number;
  readonly visible: boolean;
  readonly bars: readonly BarSdfInstance[];
}

const FAMILIES: readonly HealthBarFamily[] = ['enemyStatus', 'playerStatus', 'baseMarkers', 'rockTools'];

/**
 * Concrete scene-owned presenter. Bindings belong to a World and never enter a static handoff.
 * Every visible bar is one instance in the GPU layer of its family; there are no per-bar Game
 * Objects, so hundreds of damaged enemies cost one buffer write each instead of three Rectangles.
 */
export class WorldHealthBarRenderer {
  private readonly slots: (Binding | null)[] = [];
  private readonly generations: number[] = [];
  private readonly freeSlots: number[] = [];
  private readonly active = new Set<Binding>();
  private readonly layers = new Map<string, Layer>();
  private scope: object | null = null;
  private enabled = true;
  private destroyed = false;
  private bindings = 0;
  private processedLastFrame = 0;
  private drawnLastFrame = 0;
  private pixelScale = 1;
  private lastNow = 0;
  private diagnosticMask = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly clock: () => number = () => performance.now(),
    private readonly tuning: HealthBarFeedbackTuning = HEALTH_BAR_TUNING,
  ) {}

  openWorld(scope: object): void { if (!this.destroyed) this.scope = scope; }

  closeWorld(scope: object): void {
    for (const binding of this.slots) if (binding?.scope === scope) this.release(binding.handle);
    if (this.scope === scope) this.scope = null;
  }

  isValid(handle: HealthBarHandle | null): handle is HealthBarHandle { return this.lookup(handle) !== null; }

  bind(style: HealthBarStyle, hp: number, maxHp: number, x: number, y: number, suppressed = false): HealthBarHandle | null {
    if (this.destroyed || !this.scope) return null;
    const slot = this.freeSlots.pop() ?? this.slots.length;
    const generation = (this.generations[slot] ?? 0) + 1;
    this.generations[slot] = generation;
    const handle = { slot, generation };
    const model = new HealthBarFeedbackModel(style.visibility, this.tuning);
    const now = this.now();
    model.baseline(hp, maxHp, now);
    const binding: Binding = { handle, scope: this.scope, style, model, x, y, alpha: 1, backgroundAlpha: 1, suppressed };
    model.setSuppressed(this.isSuppressed(binding), now);
    this.slots[slot] = binding;
    this.bindings++;
    this.schedule(binding, now);
    return handle;
  }

  baseline(handle: HealthBarHandle | null, hp: number, maxHp: number): void {
    const b = this.lookup(handle);
    if (!b) return;
    const now = this.now();
    b.model.baseline(hp, maxHp, now);
    this.schedule(b, now);
  }

  observe(handle: HealthBarHandle | null, hp: number, maxHp: number): void {
    const b = this.lookup(handle);
    if (!b) return;
    const now = this.now();
    b.model.setSuppressed(this.isSuppressed(b), now);
    b.model.observe(hp, maxHp, now, b.style.width * this.pixelScale);
    this.schedule(b, now);
  }

  position(handle: HealthBarHandle | null, x: number, y: number): void {
    const b = this.lookup(handle);
    if (b) { b.x = x; b.y = y; }
  }

  suppress(handle: HealthBarHandle | null, suppressed: boolean): void {
    const b = this.lookup(handle);
    if (!b || b.suppressed === suppressed) return;
    b.suppressed = suppressed;
    const now = this.now();
    b.model.setSuppressed(this.isSuppressed(b), now);
    this.schedule(b, now);
  }

  alpha(handle: HealthBarHandle | null, alpha: number, backgroundAlpha = alpha): void {
    const b = this.lookup(handle);
    if (b) { b.alpha = alpha; b.backgroundAlpha = backgroundAlpha; }
  }

  release(handle: HealthBarHandle | null): void {
    const b = this.lookup(handle);
    if (!b) return;
    this.active.delete(b);
    this.slots[b.handle.slot] = null;
    this.freeSlots.push(b.handle.slot);
    this.bindings--;
  }

  /** Only the central presentation frame calls this; position and camera sync never integrate time. */
  update(enabled: boolean): void {
    if (this.destroyed) return;
    const now = this.now();
    const camera = this.scene.cameras.main;
    // Camera zoom produces backing pixels; displayScale converts these to visible CSS pixels.
    const displayScale = this.scene.scale?.displayScale?.x ?? 1;
    this.pixelScale = Math.max(0.001, (camera.zoomX ?? camera.zoom ?? 1) / Math.max(0.001, displayScale));
    let diagnosticMask = 0;
    const attribution = getArenaVisualAttribution(this.scene);
    for (let i = 0; i < FAMILIES.length; i++) {
      if (attribution.isGraphicsFamilySuppressed(FAMILIES[i])) diagnosticMask |= 1 << i;
    }
    if (enabled !== this.enabled || diagnosticMask !== this.diagnosticMask) {
      this.enabled = enabled;
      this.diagnosticMask = diagnosticMask;
      for (const b of this.slots) if (b) {
        b.model.setSuppressed(this.isSuppressed(b), now);
        this.schedule(b, now);
      }
    }
    for (const layer of this.layers.values()) layer.source.count = 0;
    this.processedLastFrame = 0;
    this.drawnLastFrame = 0;
    for (const b of this.active) {
      this.processedLastFrame++;
      b.model.advance(now, b.style.width * this.pixelScale);
      if (!b.model.isVisible(now)) {
        this.active.delete(b);
        continue;
      }
      this.write(this.layer(b.style), b, now);
      this.drawnLastFrame++;
    }
    for (const layer of this.layers.values()) {
      const visible = layer.source.count! > 0 && !attribution.isGraphicsFamilySuppressed(layer.family);
      if (layer.image.visible !== visible) layer.image.setVisible(visible);
    }
  }

  getStats(): { bindings: number; active: number; drawn: number; layers: number; processed: number } {
    return { bindings: this.bindings, active: this.active.size, drawn: this.drawnLastFrame,
      layers: this.layers.size, processed: this.processedLastFrame };
  }

  getLayers(): WorldHealthBarLayerSnapshot[] {
    return [...this.layers.values()].map(layer => ({ family: layer.family, depth: layer.depth,
      visible: layer.image.visible, bars: layer.instances.slice(0, layer.source.count ?? 0) }));
  }

  destroy(): void {
    if (this.destroyed) return;
    for (const b of this.slots) if (b) this.release(b.handle);
    for (const layer of this.layers.values()) layer.image.destroy();
    this.layers.clear();
    this.scope = null;
    this.destroyed = true;
  }

  private now(): number { return this.lastNow = Math.max(this.lastNow, this.clock()); }

  private isSuppressed(b: Binding): boolean {
    return b.suppressed || !this.enabled
      || getArenaVisualAttribution(this.scene).isGraphicsFamilySuppressed(b.style.family);
  }

  private lookup(handle: HealthBarHandle | null): Binding | null {
    if (!handle || this.destroyed) return null;
    const b = this.slots[handle.slot];
    return b?.handle === handle && b.handle.generation === handle.generation ? b : null;
  }

  private schedule(b: Binding, now: number): void {
    if (b.model.isVisible(now)) this.active.add(b);
    else this.active.delete(b);
  }

  private layer(style: HealthBarStyle): Layer {
    const key = `${style.family}:${style.fillDepth}`;
    let layer = this.layers.get(key);
    if (layer) return layer;
    const image = this.scene.add.image(0, 0, '__WHITE').setOrigin(0, 0).setDepth(style.fillDepth)
      .setScrollFactor(1).setVisible(false);
    // World presentation: drawn by the World camera with its lighting, like the former Rectangles.
    getClarityCameraRegistry(this.scene)?.demote(image);
    const instances: BarSdfInstance[] = [];
    const source: BarSdfSource = { instances, count: 0,
      unitWidth: image.frame?.realWidth || 1, unitHeight: image.frame?.realHeight || 1 };
    attachBarSdf(image, source);
    getArenaVisualAttribution(this.scene).registerGraphicsObject(style.family, image);
    layer = { family: style.family, depth: style.fillDepth, instances, source, image };
    this.layers.set(key, layer);
    return layer;
  }

  private write(layer: Layer, b: Binding, now: number): void {
    const index = layer.source.count!;
    const inst = layer.instances[index] ?? (layer.instances[index] = createBarSdfInstance(BAR_SDF_KIND.world));
    layer.source.count = index + 1;
    const s = b.style;
    const model = b.model;
    const ratio = model.hp / model.maxHp;
    const baseColor = ratio > 0.5 ? s.healthy : ratio > 0.25 ? s.hurt : s.critical;
    const backgroundAlpha = Phaser.Math.Clamp(b.backgroundAlpha, 0, 1);
    inst.kind = BAR_SDF_KIND.world;
    inst.x = b.x - s.width / 2;
    inst.y = b.y - s.height / 2;
    inst.width = s.width;
    inst.height = s.height;
    inst.radius = Math.min(s.height * HEALTH_BAR_SHAPE.radiusPerHeight, HEALTH_BAR_SHAPE.maxRadius);
    inst.margin = HEALTH_BAR_SHAPE.outlineWidth;
    inst.alpha = Phaser.Math.Clamp(b.alpha, 0, 1);
    inst.a0 = s.width * ratio;
    inst.a1 = s.width * (model.trailHp / model.maxHp);
    inst.a2 = s.stroke === undefined ? 0 : 1;
    inst.a3 = HEALTH_BAR_SHAPE.outlineWidth;
    inst.b0 = HEALTH_BAR_SHAPE.gloss;
    inst.b1 = HEALTH_BAR_SHAPE.edge;
    inst.b2 = HEALTH_BAR_SHAPE.shade;
    inst.b3 = HEALTH_BAR_SHAPE.outlineAlpha * backgroundAlpha;
    inst.c0 = packBarColor(mixBarRgb(baseColor, 0xffffff, model.healEmphasis(now)));
    inst.c1 = packBarColor(HEALTH_BAR_TRAIL.color, HEALTH_BAR_TRAIL.alpha);
    inst.c2 = packBarColor(HEALTH_BAR_BACKING.color, HEALTH_BAR_BACKING.alpha * backgroundAlpha);
    inst.c3 = packBarColor(s.stroke ?? 0, s.stroke === undefined ? 0 : backgroundAlpha);
  }
}
