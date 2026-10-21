import * as Phaser from 'phaser';
import { DEPTH, DEPTH_FX, DEPTH_LIGHTING, VOID_PALETTE } from '../../config';
import type { ResolvedCoopDefensePortalLinkConfig } from '../../config/coopDefensePortalLinks';
import type { PortalLinkEndpoints, PortalLinkStateEntry } from '../../systems/portal/PortalLinkSystem';
import { resolveDawnSitePropHitFlash, type DawnSitePropHitFlash } from '../../arena/DawnSitePropModel';
import { makeAdditive, mixColors, registerGraphicsObject } from '../EffectUtils';
import type { LightingSystem } from '../LightingSystem';
import { GpuVfxEase } from '../gpu/GpuVfxEase';
import { GpuVfxFrameId, getGpuVfxFrame } from '../gpu/GpuVfxAtlas';
import { GpuVfxEffectId } from '../gpu/GpuVfxEffects';
import type { GpuVfxSpawnSpec } from '../gpu/GpuVfxSpawnSpec';
import type { GpuVfxSystem } from '../gpu/GpuVfxSystem';
import { getVisibleWorldView, createVisibleWorldView } from '../../graphics/CameraWorldView';
import {
  ensurePortalGeneratorAssets, PORTAL_GENERATOR_ASSET, PORTAL_GENERATOR_DISPLAY_SIZE, PORTAL_GENERATOR_EMISSIVE_CORE,
  PORTAL_GENERATOR_EMISSIVE_FLOW, portalGeneratorFrame, portalGeneratorOutletOffset, resolvePortalGeneratorOutlet,
  resolvePortalGeneratorState, type PortalGeneratorOutlet,
} from './PortalGeneratorAssets';
import { resolveVoidPortalViews, VoidPortalTransitionTracker, type VoidPortalLinkView } from './VoidPortalModel';

export interface VoidPortalScenario {
  readonly links: readonly ResolvedCoopDefensePortalLinkConfig[];
  readonly endpoints: ReadonlyMap<string, PortalLinkEndpoints>;
}

/** Replicated structure read model of a generator; the renderer never decides its state. */
export interface VoidPortalGeneratorView {
  readonly x: number;
  readonly y: number;
  readonly hp: number | null;
  readonly maxHp: number | null;
  readonly destroyed: boolean;
}

export type VoidPortalLightingPort = Pick<LightingSystem, 'setLight' | 'releaseLight' | 'pulse' | 'getArtificialLightFactor'>;

const EFFECT = GpuVfxEffectId.VoidPortal;
const HIT_FLASH_TINT = 0x5a3a6a;
/** Emissive passes keep a visible floor by day; the night carries their full strength. */
const EMISSIVE_DAY_FLOOR = 0.4;

interface GeneratorVisual {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly core: Phaser.GameObjects.Sprite;
  readonly flow: Phaser.GameObjects.Sprite;
  outlet: PortalGeneratorOutlet;
  flash?: DawnSitePropHitFlash;
}
interface Burst { x: number; y: number; radius: number; inward: boolean }

/**
 * Generator portals: the generator with its resonance core, the conduit to the entry, the violet
 * apertures that charge, hold open and implode, their light at night and their particles. It reads
 * the replicated lifecycle and the generator's structure state only.
 */
export class VoidPortalRenderer {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly transitions = new VoidPortalTransitionTracker();
  private readonly transient = new Map<Phaser.GameObjects.Graphics, Phaser.Tweens.Tween>();
  private readonly generators = new Map<string, GeneratorVisual>();
  private readonly lightKeys = new Set<string>();
  private readonly cameraView = createVisibleWorldView();
  private readonly spec: GpuVfxSpawnSpec;
  private readonly source: number;
  private readonly stopEmission: () => void;
  private readonly bursts: Burst[] = [];
  private emitViews: { view: VoidPortalLinkView; outletWorld: { x: number; y: number } | null }[] = [];
  private nextEmission = 0;
  private generation: number;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, private readonly gpu: GpuVfxSystem,
    private readonly lighting: VoidPortalLightingPort | null) {
    this.graphics = scene.add.graphics().setDepth(DEPTH_FX - 0.2);
    registerGraphicsObject(scene, 'teleportEffects', this.graphics);
    this.spec = gpu.createSpec(EFFECT);
    this.source = gpu.createSource(EFFECT);
    this.generation = gpu.emissionGeneration;
    this.stopEmission = gpu.registerEmission((_delta, now) => this.emitParticles(now));
    ensurePortalGeneratorAssets(scene);
  }

  /** Returns the visible links of this frame, so markers read the same view the world shows. */
  sync(scenario: VoidPortalScenario | null, entries: readonly PortalLinkStateEntry[] | null, elapsedMs: number,
    generatorOf: (baseId: string) => VoidPortalGeneratorView | null): readonly VoidPortalLinkView[] {
    if (this.destroyed) return [];
    const views = scenario ? resolveVoidPortalViews(scenario.links, scenario.endpoints, entries, elapsedMs) : [];
    for (const event of this.transitions.observe(scenario ? entries : null)) {
      const ends = scenario?.endpoints.get(event.id);
      const radius = scenario?.links.find((link) => link.id === event.id)?.collapse.radiusPx ?? 96;
      const portalRadius = scenario?.links.find((link) => link.id === event.id)?.radiusPx ?? 28;
      if (ends) this.playCollapse(ends, event.wasOpen ? radius : portalRadius * 1.6, event.wasOpen);
    }
    const g = this.graphics;
    g.clear();
    const seenLights = new Set<string>();
    const seenGenerators = new Set<string>();
    const emitViews: typeof this.emitViews = [];
    const night = this.lighting?.getArtificialLightFactor() ?? 1;
    for (const link of scenario?.links ?? []) {
      const ends = scenario!.endpoints.get(link.id);
      const generator = generatorOf(link.generatorBaseId);
      const view = views.find((candidate) => candidate.id === link.id) ?? null;
      let outletWorld: { x: number; y: number } | null = null;
      if (generator && ends) {
        seenGenerators.add(link.id);
        outletWorld = this.syncGenerator(link.id, generator, ends.a, view, elapsedMs, night, seenLights);
      }
      if (!view) continue;
      if (outletWorld && !generator?.destroyed) this.drawConduit(g, outletWorld, view.a, view, elapsedMs);
      for (const [end, exit] of [[view.a, false], [view.b, true]] as const) {
        if (view.phase === 'charging') this.drawCharging(g, end.x, end.y, view, exit, elapsedMs);
        else this.drawOpen(g, end.x, end.y, view, elapsedMs);
        this.syncEndpointLight(`void-portal:${link.id}:${exit ? 'b' : 'a'}`, end, view, exit, elapsedMs, seenLights);
      }
      emitViews.push({ view, outletWorld });
    }
    this.emitViews = emitViews;
    for (const [id, visual] of this.generators) if (!seenGenerators.has(id)) this.destroyGenerator(id, visual);
    for (const key of this.lightKeys) {
      if (seenLights.has(key)) continue;
      this.lighting?.releaseLight(key);
      this.lightKeys.delete(key);
    }
    return views;
  }

  hide(): void {
    if (this.destroyed) return;
    this.graphics.clear();
    this.transitions.reset();
    this.emitViews = [];
    for (const [id, visual] of this.generators) this.destroyGenerator(id, visual);
    for (const key of this.lightKeys) this.lighting?.releaseLight(key, { immediate: true });
    this.lightKeys.clear();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.hide();
    this.destroyed = true;
    this.stopEmission();
    this.bursts.length = 0;
    this.gpu.releaseSource(this.source);
    for (const [g, tween] of this.transient) { tween.remove(); g.destroy(); }
    this.transient.clear();
    this.graphics.destroy();
  }

  private syncGenerator(id: string, generator: VoidPortalGeneratorView, entry: { x: number; y: number },
    view: VoidPortalLinkView | null, elapsedMs: number, night: number, seenLights: Set<string>): { x: number; y: number } | null {
    const key = PORTAL_GENERATOR_ASSET.sheetTextureKey;
    if (![key, PORTAL_GENERATOR_EMISSIVE_CORE, PORTAL_GENERATOR_EMISSIVE_FLOW].every((texture) => this.scene.textures.exists(texture))) {
      return null;
    }
    const outlet = resolvePortalGeneratorOutlet(generator, entry);
    let visual = this.generators.get(id);
    if (!visual) {
      const size = PORTAL_GENERATOR_DISPLAY_SIZE;
      // Body on the structure layer; both emissive passes above the light map, like site emissions.
      const sprite = this.scene.add.sprite(generator.x, generator.y, key, 0).setOrigin(0.5).setDisplaySize(size, size);
      sprite.setDepth(DEPTH.BASES);
      const core = this.scene.add.sprite(generator.x, generator.y, PORTAL_GENERATOR_EMISSIVE_CORE, 0).setOrigin(0.5)
        .setDisplaySize(size, size);
      core.setDepth(DEPTH_LIGHTING + 0.08).setBlendMode(Phaser.BlendModes.ADD);
      const flow = this.scene.add.sprite(generator.x, generator.y, PORTAL_GENERATOR_EMISSIVE_FLOW, 0).setOrigin(0.5)
        .setDisplaySize(size, size);
      flow.setDepth(DEPTH_LIGHTING + 0.08).setBlendMode(Phaser.BlendModes.ADD);
      visual = { sprite, core, flow, outlet };
      this.generators.set(id, visual);
    }
    const state = resolvePortalGeneratorState(generator.hp, generator.maxHp, generator.destroyed);
    const frame = portalGeneratorFrame(state, outlet);
    for (const part of [visual.sprite, visual.core, visual.flow]) part.setFrame(frame).setPosition(generator.x, generator.y);
    visual.outlet = outlet;
    visual.flash = resolveDawnSitePropHitFlash(visual.flash, generator.destroyed ? null : generator.hp, this.scene.time.now);
    if (visual.flash.active) visual.sprite.setTint(HIT_FLASH_TINT).setTintMode(Phaser.TintModes.ADD);
    else visual.sprite.clearTint();

    // Core: building while charging, full while open, a spent ember in the rubble. Flow: only an open link.
    const emissive = Math.max(EMISSIVE_DAY_FLOOR, night);
    const charging = view?.phase === 'charging', open = view?.phase === 'open';
    const breathe = 0.5 + 0.5 * Math.sin(elapsedMs * (charging ? 0.004 + view!.chargeFraction * 0.008 : 0.0025));
    const coreAlpha = generator.destroyed ? 0.22 : open ? 0.8 + 0.2 * breathe
      : charging ? 0.3 + 0.5 * view!.chargeFraction + 0.15 * breathe : 0.25;
    visual.core.setTint(VOID_PALETTE.bright).setAlpha(coreAlpha * emissive);
    visual.flow.setTint(VOID_PALETTE.primary).setAlpha(open && !generator.destroyed ? (0.75 + 0.25 * breathe) * emissive : 0);
    if (!generator.destroyed) {
      const lightKey = `void-portal:${id}:core`;
      this.lighting?.setLight(lightKey, 'voidPortal', generator.x, generator.y, {
        radiusPx: open ? 120 : 70 + 50 * (view?.chargeFraction ?? 0), intensity: (open ? 0.7 : 0.35) + 0.15 * breathe,
      });
      this.lightKeys.add(lightKey);
      seenLights.add(lightKey);
    }
    const offset = portalGeneratorOutletOffset(outlet);
    return { x: generator.x + offset.x, y: generator.y + offset.y };
  }

  private syncEndpointLight(key: string, end: { x: number; y: number }, view: VoidPortalLinkView, exit: boolean,
    elapsedMs: number, seenLights: Set<string>): void {
    if (!this.lighting) return;
    const flicker = exit && view.phase === 'charging' ? 0.55 + 0.45 * Math.abs(Math.sin(elapsedMs * 0.011)) : 1;
    const strength = view.phase === 'open' ? 1 : view.chargeFraction * 0.6 * flicker;
    if (strength <= 0.01) return;
    this.lighting.setLight(key, 'voidPortal', end.x, end.y, {
      radiusPx: 90 + 70 * strength, intensity: 0.85 * strength,
    });
    this.lightKeys.add(key);
    seenLights.add(key);
  }

  /** The conduit carries the generator's energy to the entry: a dashed pulse while charging, a steady arc when open. */
  private drawConduit(g: Phaser.GameObjects.Graphics, from: { x: number; y: number }, to: { x: number; y: number },
    view: VoidPortalLinkView, elapsedMs: number): void {
    const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
    if (length < 4) return;
    const nx = -dy / length, ny = dx / length;
    const open = view.phase === 'open';
    const segments = Math.max(6, Math.round(length / 10));
    const phase = elapsedMs * (open ? 0.012 : 0.006);
    for (let i = 0; i < segments; i++) {
      const t0 = i / segments, t1 = (i + 1) / segments;
      const pulse = 0.5 + 0.5 * Math.sin(t0 * 9 - phase);
      if (!open && pulse < 0.55 - view.chargeFraction * 0.4) continue;
      const wobble = (t: number) => Math.sin(t * 13 + phase * 0.7) * 2.2 * Math.sin(t * Math.PI);
      const x0 = from.x + dx * t0 + nx * wobble(t0), y0 = from.y + dy * t0 + ny * wobble(t0);
      const x1 = from.x + dx * t1 + nx * wobble(t1), y1 = from.y + dy * t1 + ny * wobble(t1);
      g.lineStyle(open ? 3.2 : 2.2, VOID_PALETTE.deep, (open ? 0.5 : 0.3) * (0.6 + 0.4 * pulse)).lineBetween(x0, y0, x1, y1);
      g.lineStyle(1.1, open ? VOID_PALETTE.bright : VOID_PALETTE.primary, (open ? 0.85 : 0.55) * pulse).lineBetween(x0, y0, x1, y1);
    }
  }

  private drawCharging(g: Phaser.GameObjects.Graphics, x: number, y: number, view: VoidPortalLinkView,
    exit: boolean, elapsedMs: number): void {
    const r = view.radius, f = view.chargeFraction;
    const flicker = exit ? 0.55 + 0.45 * Math.abs(Math.sin(elapsedMs * 0.011) * Math.sin(elapsedMs * 0.0047)) : 1;
    g.fillStyle(VOID_PALETTE.shadow, 0.6 * f * flicker).fillCircle(x, y, r * (0.3 + 0.6 * f));
    g.lineStyle(6, VOID_PALETTE.primary, 0.05 * flicker).strokeCircle(x, y, r);
    g.lineStyle(1.2, VOID_PALETTE.deep, (0.35 + 0.4 * f) * flicker).strokeCircle(x, y, r);
    // Charge meter: the clockwise arc both endpoints share, so the flank's opening is readable at the exit.
    g.lineStyle(2.4, VOID_PALETTE.bright, 0.9 * flicker);
    g.beginPath().arc(x, y, r + 5, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2).strokePath();
    g.lineStyle(1, mixColors(VOID_PALETTE.bright, 0xffffff, 0.5), 0.6 * flicker);
    for (let tick = 0; tick < 12; tick++) {
      if (tick / 12 > f) break;
      const a = -Math.PI / 2 + tick / 12 * Math.PI * 2;
      g.lineBetween(x + Math.cos(a) * (r + 8), y + Math.sin(a) * (r + 8), x + Math.cos(a) * (r + 11), y + Math.sin(a) * (r + 11));
    }
    if (exit) {
      // The tear telegraphs where the flank will open: jagged, widening with the charge.
      const reach = r * (0.35 + 0.55 * f);
      g.lineStyle(1.6, VOID_PALETTE.bright, 0.75 * flicker * Math.max(0.3, f));
      const jag = [[-1, -0.25], [-0.45, 0.1], [0, -0.12], [0.5, 0.18], [1, -0.05]];
      for (let i = 0; i < jag.length - 1; i++) {
        g.lineBetween(x + jag[i][0] * reach, y + jag[i][1] * reach, x + jag[i + 1][0] * reach, y + jag[i + 1][1] * reach);
      }
    }
  }

  private drawOpen(g: Phaser.GameObjects.Graphics, x: number, y: number, view: VoidPortalLinkView, elapsedMs: number): void {
    const r = view.radius, opening = Math.min(1, view.openAgeMs / 400);
    const pulse = (1 + Math.sin(elapsedMs * 0.006)) / 2;
    // Dark throat holds contrast against terrain; the bright rim is the exact trigger radius.
    g.fillStyle(VOID_PALETTE.shadow, 0.95 * opening).fillCircle(x, y, r);
    g.fillStyle(VOID_PALETTE.deep, 0.24 * opening).fillCircle(x, y, r * 0.84);
    g.fillStyle(0x050008, 0.88 * opening).fillCircle(x, y, r * 0.58);
    g.lineStyle(10, VOID_PALETTE.primary, 0.05 * opening).strokeCircle(x, y, r + 1);
    g.lineStyle(4, VOID_PALETTE.primary, 0.2 * opening).strokeCircle(x, y, r);
    g.lineStyle(1.7, VOID_PALETTE.bright, (0.72 + 0.28 * pulse) * opening).strokeCircle(x, y, r);
    g.lineStyle(0.7, VOID_PALETTE.core, 0.8 * opening).strokeCircle(x, y, r - 0.6);
    const phase = -elapsedMs * 0.0018;
    for (let i = 0; i < 4; i++) {
      const angle = phase + i * Math.PI / 2;
      for (let segment = 0; segment < 9; segment++) {
        const t = segment / 9, next = (segment + 1) / 9;
        const a = angle - t * 2, b = angle - next * 2;
        const ra = r * (0.88 - t * 0.6), rb = r * (0.88 - next * 0.6);
        g.lineStyle(1.6 * (1 - t), VOID_PALETTE.bright, (0.58 - t * 0.42) * opening);
        g.lineBetween(x + Math.cos(a) * ra, y + Math.sin(a) * ra, x + Math.cos(b) * rb, y + Math.sin(b) * rb);
      }
    }
    if (view.openAgeMs < 400) {
      g.lineStyle(2.2, VOID_PALETTE.core, (1 - opening) * 0.85).strokeCircle(x, y, r * (0.4 + 0.6 * opening));
    }
  }

  private playCollapse(ends: PortalLinkEndpoints, radius: number, wasOpen: boolean): void {
    for (const point of [ends.a, ends.b]) {
      this.queueBurst(point.x, point.y, radius, true);
      this.lighting?.pulse('teleportFlash', point.x, point.y, { color: VOID_PALETTE.bright, radiusPx: wasOpen ? 220 : 130 });
    }
    const g = this.scene.add.graphics().setDepth(DEPTH_FX);
    registerGraphicsObject(this.scene, 'teleportEffects', g);
    makeAdditive(g);
    const draw = (t: number) => {
      g.clear();
      for (const point of [ends.a, ends.b]) {
        const r = Math.max(1, radius * (1 - t) ** 1.6);
        g.lineStyle(2.4, VOID_PALETTE.bright, Math.sin(t * Math.PI) * 0.8).strokeCircle(point.x, point.y, r);
        g.lineStyle(1, VOID_PALETTE.core, Math.sin(t * Math.PI) * 0.5).strokeCircle(point.x, point.y, r * 0.7);
        g.fillStyle(VOID_PALETTE.primary, (1 - t) * 0.18).fillCircle(point.x, point.y, Math.min(26, r));
        g.lineStyle(1.2, VOID_PALETTE.core, (1 - t) * 0.55);
        for (let i = 0; i < 12; i++) {
          const angle = i * Math.PI / 6 + t * 1.4;
          g.lineBetween(point.x + Math.cos(angle) * r, point.y + Math.sin(angle) * r,
            point.x + Math.cos(angle) * r * 0.72, point.y + Math.sin(angle) * r * 0.72);
        }
      }
    };
    draw(0);
    const tween = this.scene.tweens.addCounter({ from: 0, to: 1, duration: wasOpen ? 520 : 320,
      onUpdate: (counter) => draw(counter.getValue() ?? 0),
      onComplete: () => { this.transient.delete(g); g.destroy(); },
    });
    this.transient.set(g, tween);
  }

  private queueBurst(x: number, y: number, radius: number, inward: boolean): void {
    if (this.generation !== this.gpu.emissionGeneration) {
      this.bursts.length = 0;
      this.generation = this.gpu.emissionGeneration;
    }
    if (this.bursts.length < 16 && !this.gpu.isSuppressed()) this.bursts.push({ x, y, radius, inward });
  }

  /** Runs after the shared pool's retire sweep; motion and fading then run on the GPU. */
  private emitParticles(now: number): void {
    if (this.generation !== this.gpu.emissionGeneration || this.gpu.isSuppressed() || this.source < 0) {
      this.bursts.length = 0;
      this.generation = this.gpu.emissionGeneration;
      return;
    }
    const view = getVisibleWorldView(this.scene.cameras.main, this.cameraView);
    const visible = (x: number, y: number, r: number) => x + r >= view.x && y + r >= view.y
      && x - r <= view.right && y - r <= view.bottom;
    for (const burst of this.bursts) {
      if (!visible(burst.x, burst.y, burst.radius + 32)) continue;
      const count = this.gpu.quality.scaleDiscreteBurst(EFFECT, 28);
      for (let i = 0; i < count; i++) {
        const angle = i * Math.PI * 2 / count + Math.random() * 0.2;
        const from = burst.radius * (0.8 + Math.random() * 0.3);
        this.particle(burst.x + Math.cos(angle) * from, burst.y + Math.sin(angle) * from,
          burst.x + Math.cos(angle + 0.6) * 2, burst.y + Math.sin(angle + 0.6) * 2,
          i % 3 ? VOID_PALETTE.bright : VOID_PALETTE.core, 2.4 + Math.random() * 2, 340 + Math.random() * 200, now, false);
      }
    }
    this.bursts.length = 0;
    const interval = this.gpu.quality.scaleFrequency(40, EFFECT);
    if (!interval || now < this.nextEmission) return;
    this.nextEmission = now + interval; // No backlog after pauses, offscreen time or admission drops.
    for (const { view: link, outletWorld } of this.emitViews) {
      const open = link.phase === 'open';
      for (const end of [link.a, link.b]) {
        const r = link.radius;
        if (!visible(end.x, end.y, r + 24)) continue;
        // Open: matter spirals into the throat. Charging: a sparse shimmer gathers at the rim.
        const motes = open ? 3 : Math.random() < link.chargeFraction ? 1 : 0;
        for (let i = 0; i < motes; i++) {
          const angle = Math.random() * Math.PI * 2;
          const from = r * (1 + Math.random() * 0.35), to = open ? r * 0.15 : r * 0.92;
          this.particle(end.x + Math.cos(angle) * from, end.y + Math.sin(angle) * from,
            end.x + Math.cos(angle - 0.9) * to, end.y + Math.sin(angle - 0.9) * to,
            VOID_PALETTE.bright, 1.8 + Math.random() * 1.4, 380 + Math.random() * 220, now, i === 0 && open);
        }
      }
      // Energy rides the conduit from the generator to the entry.
      if (outletWorld && visible(outletWorld.x, outletWorld.y, 64) && Math.random() < (open ? 0.9 : link.chargeFraction * 0.7)) {
        this.particle(outletWorld.x, outletWorld.y, link.a.x, link.a.y, VOID_PALETTE.primary, 2.6, open ? 420 : 640, now, true);
      }
    }
  }

  private particle(x: number, y: number, tx: number, ty: number, color: number, size: number,
    lifeMs: number, now: number, glow: boolean): void {
    const s = this.spec;
    s.frame = glow ? GpuVfxFrameId.DeathGlow : GpuVfxFrameId.ExplosionSpark;
    s.x = x; s.y = y; s.lifeMs = lifeMs;
    s.vx = (tx - x) * 1000 / lifeMs; s.vy = (ty - y) * 1000 / lifeMs;
    s.positionEase = GpuVfxEase.QuadOut;
    s.rotation = Math.atan2(ty - y, tx - x); s.angularVelocity = 2.5;
    s.scaleStart = size / getGpuVfxFrame(s.frame).width; s.scaleEnd = s.scaleStart * 0.15;
    s.stretchStart = glow ? 1 : 2.6; s.stretchEnd = 1;
    s.alphaStart = glow ? 0.35 : 0.9; s.alphaEnd = 0; s.alphaEase = GpuVfxEase.Linear;
    s.tint = color; s.tintBlendStart = glow ? 1 : 0.4; s.tintBlendEnd = 1;
    this.gpu.spawn(s, this.source, now);
  }

  private destroyGenerator(id: string, visual: GeneratorVisual): void {
    visual.sprite.destroy(); visual.core.destroy(); visual.flow.destroy();
    this.generators.delete(id);
  }
}
