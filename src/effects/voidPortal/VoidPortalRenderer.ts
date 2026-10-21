import * as Phaser from 'phaser';
import { DEPTH, DEPTH_FX, DEPTH_LIGHTING, VOID_PALETTE } from '../../config';
import type { ResolvedCoopDefensePortalLinkConfig } from '../../config/coopDefensePortalLinks';
import type { PortalLinkEndpoints, PortalLinkStateEntry } from '../../systems/portal/PortalLinkSystem';
import { resolveDawnSitePropHitFlash, type DawnSitePropHitFlash } from '../../arena/DawnSitePropModel';
import { registerGraphicsObject } from '../EffectUtils';
import type { PortalPresentation } from '../portal/PortalPresentation';
import type { PortalEndView } from '../portal/PortalViews';
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
import { resolveVoidPortalViews, voidPortalEndViews, VoidPortalTransitionTracker, type VoidPortalLinkView } from './VoidPortalModel';

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
const OWNER = 'void-portal';

interface GeneratorVisual {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly core: Phaser.GameObjects.Sprite;
  readonly flow: Phaser.GameObjects.Sprite;
  outlet: PortalGeneratorOutlet;
  flash?: DawnSitePropHitFlash;
}

/**
 * Generator portals: the generator with its resonance core and the conduit to the entry. The
 * apertures themselves (charging, open, collapse, light and particles) use the shared portal look;
 * this renderer only submits their views. It reads the replicated lifecycle and the generator's
 * structure state only.
 */
export class VoidPortalRenderer {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly transitions = new VoidPortalTransitionTracker();
  private readonly generators = new Map<string, GeneratorVisual>();
  private readonly lightKeys = new Set<string>();
  private readonly cameraView = createVisibleWorldView();
  private readonly spec: GpuVfxSpawnSpec;
  private readonly source: number;
  private readonly stopEmission: () => void;
  private emitViews: { view: VoidPortalLinkView; outletWorld: { x: number; y: number } | null }[] = [];
  private nextEmission = 0;
  private generation: number;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene, private readonly gpu: GpuVfxSystem,
    private readonly lighting: VoidPortalLightingPort | null, private readonly portals: PortalPresentation) {
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
      const link = scenario?.links.find((candidate) => candidate.id === event.id);
      const portalRadius = link?.radiusPx ?? 28;
      // An open portal implodes over its gameplay pull radius; a half-built one just fizzles out.
      if (ends) this.portals.playCollapse([ends.a, ends.b], portalRadius, 'void',
        event.wasOpen ? link?.collapse.radiusPx ?? 128 : portalRadius * 1.6);
    }
    const g = this.graphics;
    g.clear();
    const seenLights = new Set<string>();
    const seenGenerators = new Set<string>();
    const emitViews: typeof this.emitViews = [];
    const ends: PortalEndView[] = [];
    const night = this.lighting?.getArtificialLightFactor() ?? 1;
    for (const link of scenario?.links ?? []) {
      const linkEnds = scenario!.endpoints.get(link.id);
      const generator = generatorOf(link.generatorBaseId);
      const view = views.find((candidate) => candidate.id === link.id) ?? null;
      let outletWorld: { x: number; y: number } | null = null;
      if (generator && linkEnds) {
        seenGenerators.add(link.id);
        outletWorld = this.syncGenerator(link.id, generator, linkEnds.a, view, elapsedMs, night, seenLights);
      }
      if (!view) continue;
      if (outletWorld && !generator?.destroyed) this.drawConduit(g, outletWorld, view.a, view, elapsedMs);
      ends.push(...voidPortalEndViews(view));
      emitViews.push({ view, outletWorld });
    }
    this.portals.submit(OWNER, ends);
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
    this.portals.clear(OWNER);
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
    this.gpu.releaseSource(this.source);
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

  /** Energy riding the conduit; emitted after the shared pool's retire sweep, moved and faded on the GPU. */
  private emitParticles(now: number): void {
    if (this.generation !== this.gpu.emissionGeneration || this.gpu.isSuppressed() || this.source < 0) {
      this.generation = this.gpu.emissionGeneration;
      return;
    }
    const view = getVisibleWorldView(this.scene.cameras.main, this.cameraView);
    const visible = (x: number, y: number, r: number) => x + r >= view.x && y + r >= view.y
      && x - r <= view.right && y - r <= view.bottom;
    const interval = this.gpu.quality.scaleFrequency(40, EFFECT);
    if (!interval || now < this.nextEmission) return;
    this.nextEmission = now + interval; // No backlog after pauses, offscreen time or admission drops.
    for (const { view: link, outletWorld } of this.emitViews) {
      const open = link.phase === 'open';
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
