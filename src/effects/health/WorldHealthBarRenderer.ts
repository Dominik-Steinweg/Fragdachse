import * as Phaser from 'phaser';
import { getArenaVisualAttribution } from '../../scenes/arena/ArenaVisualAttribution';
import { getClarityCameraRegistry } from '../../scenes/arena/ClarityCameraRegistry';
import { HealthBarFeedbackModel, type HealthBarFeedbackTuning } from './HealthBarFeedbackModel';
import { HEALTH_BAR_POOL, HEALTH_BAR_TRAIL, HEALTH_BAR_TUNING, type HealthBarFamily, type HealthBarStyle } from './healthBarStyles';

export interface HealthBarHandle { readonly slot: number; readonly generation: number }
interface View {
  readonly background: Phaser.GameObjects.Rectangle;
  readonly trail: Phaser.GameObjects.Rectangle;
  readonly fill: Phaser.GameObjects.Rectangle;
  readonly family: HealthBarFamily;
  x: number; y: number; hpWidth: number; trailWidth: number; color: number; alpha: number; backgroundAlpha: number;
}
interface Binding {
  readonly handle: HealthBarHandle;
  readonly scope: object;
  readonly style: HealthBarStyle;
  readonly model: HealthBarFeedbackModel;
  view: View | null;
  x: number; y: number; alpha: number; backgroundAlpha: number;
  suppressed: boolean;
}
const FAMILIES: readonly HealthBarFamily[] = ['enemyStatus', 'playerStatus', 'baseMarkers', 'rockTools'];

/** Concrete scene-owned pool. Bindings belong to a World and never enter a static handoff. */
export class WorldHealthBarRenderer {
  private readonly slots: (Binding | null)[] = [];
  private readonly generations: number[] = [];
  private readonly freeSlots: number[] = [];
  private readonly active = new Set<Binding>();
  private readonly free: Record<HealthBarFamily, View[]> = {
    enemyStatus: [], playerStatus: [], baseMarkers: [], rockTools: [],
  };
  private scope: object | null = null;
  private enabled = true;
  private destroyed = false;
  private warmed = false;
  private freeCount = 0;
  private bindings = 0;
  private createdViews = 0;
  private processedLastFrame = 0;
  private pixelScale = 1;
  private lastNow = 0;
  private diagnosticMask = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly clock: () => number = () => performance.now(),
    private readonly tuning: HealthBarFeedbackTuning = HEALTH_BAR_TUNING,
    private readonly pool = HEALTH_BAR_POOL,
  ) {}

  openWorld(scope: object): void { if (!this.destroyed) this.scope = scope; }

  closeWorld(scope: object): void {
    for (const binding of this.slots) if (binding?.scope === scope) this.release(binding.handle);
    if (this.scope === scope) this.scope = null;
  }

  isValid(handle: HealthBarHandle | null): handle is HealthBarHandle { return this.lookup(handle) !== null; }

  bind(style: HealthBarStyle, hp: number, maxHp: number, x: number, y: number, suppressed = false): HealthBarHandle | null {
    if (this.destroyed || !this.scope) return null;
    if (!this.warmed) {
      this.warmed = true;
      for (let i = 0; i < Math.min(this.pool.prewarmEnemyViews, this.pool.maxFreeViews); i++) {
        this.free.enemyStatus.push(this.createView('enemyStatus'));
        this.freeCount++;
      }
    }
    const slot = this.freeSlots.pop() ?? this.slots.length;
    const generation = (this.generations[slot] ?? 0) + 1;
    this.generations[slot] = generation;
    const handle = { slot, generation };
    const model = new HealthBarFeedbackModel(style.visibility, this.tuning);
    const now = this.now();
    model.baseline(hp, maxHp, now);
    model.setSuppressed(suppressed || !this.enabled
      || getArenaVisualAttribution(this.scene).isGraphicsFamilySuppressed(style.family), now);
    const binding: Binding = { handle, scope: this.scope, style, model, view: null,
      x, y, alpha: 1, backgroundAlpha: 1, suppressed };
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
    this.returnView(b);
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
    this.processedLastFrame = 0;
    for (const b of this.active) {
      this.processedLastFrame++;
      b.model.advance(now, b.style.width * this.pixelScale);
      if (!b.model.isVisible(now)) {
        this.returnView(b);
        this.active.delete(b);
        continue;
      }
      if (!b.view) this.borrowView(b);
      this.paint(b, now);
    }
  }

  getStats(): { bindings: number; active: number; free: number; created: number; processed: number } {
    return { bindings: this.bindings, active: this.active.size, free: this.freeCount,
      created: this.createdViews, processed: this.processedLastFrame };
  }

  destroy(): void {
    if (this.destroyed) return;
    for (const b of this.slots) if (b) this.release(b.handle);
    for (const family of Object.keys(this.free) as HealthBarFamily[]) {
      for (const view of this.free[family]) this.destroyView(view);
      this.free[family].length = 0;
    }
    this.freeCount = 0;
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
    else { this.active.delete(b); this.returnView(b); }
  }

  private createView(family: HealthBarFamily): View {
    const background = this.scene.add.rectangle(0, 0, 1, 1, 0x333333).setVisible(false).setActive(false);
    const trail = this.scene.add.rectangle(0, 0, 1, 1, HEALTH_BAR_TRAIL.color).setVisible(false).setActive(false);
    const fill = this.scene.add.rectangle(0, 0, 1, 1, 0xffffff).setVisible(false).setActive(false);
    const attribution = getArenaVisualAttribution(this.scene);
    attribution.registerGraphicsObject(family, background);
    attribution.registerGraphicsObject(family, trail);
    attribution.registerGraphicsObject(family, fill);
    this.createdViews++;
    return { background, trail, fill, family, x: NaN, y: NaN, hpWidth: NaN, trailWidth: NaN,
      color: NaN, alpha: NaN, backgroundAlpha: NaN };
  }

  private borrowView(b: Binding): void {
    const v = this.free[b.style.family].pop();
    if (v) this.freeCount--;
    const view = b.view = v ?? this.createView(b.style.family);
    const s = b.style;
    view.background.setOrigin(0.5, 0.5).setSize(s.width, s.height).setDepth(s.backgroundDepth)
      .setFillStyle(0x333333).setStrokeStyle(s.stroke === undefined ? 0 : 1, s.stroke);
    view.trail.setOrigin(0, 0.5).setDepth((s.backgroundDepth + s.fillDepth) / 2)
      .setFillStyle(HEALTH_BAR_TRAIL.color).setStrokeStyle();
    view.fill.setOrigin(0, 0.5).setDepth(s.fillDepth).setStrokeStyle();
    this.resetObject(view.background);
    this.resetObject(view.trail);
    this.resetObject(view.fill);
    view.x = view.y = view.hpWidth = view.trailWidth = view.color = view.alpha = view.backgroundAlpha = NaN;
  }

  private paint(b: Binding, now: number): void {
    const v = b.view!;
    const s = b.style;
    if (v.x !== b.x || v.y !== b.y) {
      v.background.setPosition(b.x, b.y);
      v.trail.setPosition(b.x - s.width / 2, b.y);
      v.fill.setPosition(b.x - s.width / 2, b.y);
      v.x = b.x; v.y = b.y;
    }
    const ratio = b.model.hp / b.model.maxHp;
    const hpWidth = s.width * ratio;
    const trailWidth = s.width * (b.model.trailHp / b.model.maxHp);
    if (v.hpWidth !== hpWidth) { v.fill.setSize(hpWidth, s.height); v.hpWidth = hpWidth; }
    if (v.trailWidth !== trailWidth) { v.trail.setSize(trailWidth, s.height); v.trailWidth = trailWidth; }
    const baseColor = ratio > 0.5 ? s.healthy : ratio > 0.25 ? s.hurt : s.critical;
    const strength = b.model.healEmphasis(now);
    const r = (baseColor >> 16) & 255, g = (baseColor >> 8) & 255, blue = baseColor & 255;
    const color = (Math.round(r + (255 - r) * strength) << 16)
      | (Math.round(g + (255 - g) * strength) << 8) | Math.round(blue + (255 - blue) * strength);
    if (v.color !== color) { v.fill.setFillStyle(color); v.color = color; }
    if (v.alpha !== b.alpha) {
      v.fill.setAlpha(b.alpha); v.trail.setAlpha(b.alpha * HEALTH_BAR_TRAIL.alpha); v.alpha = b.alpha;
    }
    if (v.backgroundAlpha !== b.backgroundAlpha) {
      v.background.setAlpha(b.backgroundAlpha); v.backgroundAlpha = b.backgroundAlpha;
    }
    const visible = !getArenaVisualAttribution(this.scene).isGraphicsFamilySuppressed(s.family);
    if (v.background.visible !== visible) v.background.setVisible(visible);
    if (v.fill.visible !== visible) v.fill.setVisible(visible);
    const trailVisible = visible && trailWidth > hpWidth;
    if (v.trail.visible !== trailVisible) v.trail.setVisible(trailVisible);
  }

  private returnView(b: Binding): void {
    const view = b.view;
    if (!view) return;
    b.view = null;
    view.background.setVisible(false).setActive(false);
    view.trail.setVisible(false).setActive(false);
    view.fill.setVisible(false).setActive(false);
    if (this.freeCount < this.pool.maxFreeViews) {
      this.free[view.family].push(view);
      this.freeCount++;
    } else this.destroyView(view);
  }

  private destroyView(view: View): void {
    view.background.destroy(); view.trail.destroy(); view.fill.destroy();
  }

  private resetObject(object: Phaser.GameObjects.Rectangle): void {
    object.setScale(1).setRotation(0).setScrollFactor(1).setActive(true);
    getClarityCameraRegistry(this.scene)?.demote(object);
  }
}
