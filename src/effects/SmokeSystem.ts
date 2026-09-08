import * as Phaser from 'phaser';
import { getVisibleWorldView } from '../ui/HostileBaseIndicator';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { smoothSmokeGrowth } from '../systems/SmokeRules';
import { DEPTH } from '../config';
import { createSeededRandom, ensureCanvasTexture, registerGraphicsObject } from './EffectUtils';
import { SMOKE_SHADER_NAME, SMOKE_FRAGMENT_SOURCE, sampleSmokeWeather } from './smokeCloudShader';
import { SmokeBodyEffect, type EntityStatusVisualTarget } from './SmokeBodyEffect';
import type { SyncedSmokeCloud, SyncedSmokeTargetStatus } from '../types';
import type { LightingSystem } from './LightingSystem';

const TAU = Math.PI * 2;
const TEX_BODY_A = '__smoke_body_a';
const TEX_WISP = '__smoke_wisp';
const TEX_GROWTH = '__smoke_growth_ring';
const BODY_TEXTURE_SIZE = 512;
const WISP_TEXTURE_SIZE = 256;
// Procedural structure is limited by the composition surface, not the source
// puff textures. Full resolution preserves detail on high without enlarging assets.
const QUALITY = { high: { scale: 1, detail: 2 }, medium: { scale: 0.5, detail: 1 }, low: { scale: 0.25, detail: 0 } };

interface SmokeCloudVisual {
  quad: Phaser.GameObjects.Shader;
  lightKey: string;
  uniforms: { time: number; seed: number; detail: number; pixels: number; opacity: number;
    weather: ReturnType<typeof sampleSmokeWeather> };
}

/** Presentation only: one bounded shader per visible cloud, one shared opacity cap. */
export class SmokeSystem {
  private readonly visuals = new Map<number, SmokeCloudVisual>();
  private lighting: LightingSystem | null = null;
  private surface: Phaser.GameObjects.RenderTexture | null = null;
  private readonly statusEffects = new Map<string, SmokeBodyEffect>();
  private readonly growthRings = new Map<number, Phaser.GameObjects.Image>();
  private clouds: SyncedSmokeCloud[] = [];
  private targetStates: readonly SyncedSmokeTargetStatus[] = [];
  private resolveTarget: (id: string) => EntityStatusVisualTarget | null = () => null;
  private receivedAt = 0;
  private hostNow = 0;
  private readonly growthSequences = new Map<number, number>();
  private readonly growthPulses = new Map<number, number>();
  // Retained while a cloud is offscreen. Subtract the host epoch in JS (double
  // precision), before sending animation time or lightning seeds to GPU floats.
  private readonly animationOrigins = new Map<number, number>();
  private surfaceWidth = 0;
  private surfaceHeight = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.ensureSmokeTextures();
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.renderFrame, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
  }

  setLightingSystem(lighting: LightingSystem | null): void {
    if (this.lighting === lighting) return;
    for (const visual of this.visuals.values()) this.lighting?.releaseLight(visual.lightKey, { immediate: true });
    this.lighting = lighting;
  }

  syncVisuals(clouds: SyncedSmokeCloud[], now = this.scene.time.now): void {
    this.clouds = clouds;
    this.hostNow = now;
    this.receivedAt = this.scene.time.now;
    const activeIds = new Set(clouds.map(cloud => cloud.id));
    for (const cloud of clouds) {
      if (!this.animationOrigins.has(cloud.id)) this.animationOrigins.set(cloud.id, now);
      const previous = this.growthSequences.get(cloud.id);
      if (previous !== undefined && (cloud.growthSequence ?? 0) > previous) this.growthPulses.set(cloud.id, this.scene.time.now);
      this.growthSequences.set(cloud.id, cloud.growthSequence ?? 0);
    }
    for (const id of this.growthSequences.keys()) if (!activeIds.has(id)) {
      this.growthSequences.delete(id); this.growthPulses.delete(id);
      this.animationOrigins.delete(id);
      this.growthRings.get(id)?.destroy(); this.growthRings.delete(id);
    }
    for (const [id, visual] of this.visuals) if (!activeIds.has(id)) {
      this.destroyVisual(visual); this.visuals.delete(id);
    }
    if (!clouds.length) this.destroySurface();
  }

  destroyAll(): void {
    this.syncVisuals([]);
    this.targetStates = [];
    this.resolveTarget = () => null;
    for (const effect of this.statusEffects.values()) effect.destroy();
    this.statusEffects.clear();
  }

  syncTargetVisuals(states: readonly SyncedSmokeTargetStatus[], now: number,
    resolve: (id: string) => EntityStatusVisualTarget | null): void {
    this.targetStates = states; this.resolveTarget = resolve;
    this.hostNow = now; this.receivedAt = this.scene.time.now;
  }

  private shutdown(): void {
    this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.renderFrame, this);
    this.destroyAll();
    this.lighting = null;
  }

  private destroySurface(): void {
    this.surface?.clear(); this.surface?.destroy(); this.surface = null;
    this.surfaceWidth = this.surfaceHeight = 0;
  }

  private renderFrame(): void {
    const now = this.hostNow + this.scene.time.now - this.receivedAt;
    const camera = this.scene.cameras.main;
    const view = getVisibleWorldView(camera);
    const quality = QUALITY[getGraphicsQualityProfile(this.scene).level];
    const width = Math.max(1, Math.ceil(camera.width * quality.scale));
    const height = Math.max(1, Math.ceil(camera.height * quality.scale));
    const scaleX = width / view.width, scaleY = height / view.height;
    // Normalize each cloud before compositing, then apply opacity exactly once. Even
    // six overlapping opaque cores retain the configured view through the world.
    const maxAlpha = Math.max(0, ...this.clouds.map(c => c.alpha));
    const opacity = Math.min(0.99, maxAlpha);
    const visible = new Set<number>();
    for (const snapshot of this.clouds) {
      let radius = snapshot.radius;
      if ((snapshot.growthSequence ?? 0) > 0 && snapshot.growthStartedAt !== undefined) {
        const from = snapshot.growthFromRadius ?? radius;
        radius = from + ((snapshot.growthTargetRadius ?? radius) - from)
          * smoothSmokeGrowth((now - snapshot.growthStartedAt) / Math.max(1, snapshot.growthDurationMs ?? 300));
      }
      if (radius <= 0 || snapshot.alpha <= 0 || snapshot.x + radius < view.x || snapshot.y + radius < view.y
        || snapshot.x - radius > view.x + view.width || snapshot.y - radius > view.y + view.height) continue;
      visible.add(snapshot.id);
      if (!this.surface || width !== this.surfaceWidth || height !== this.surfaceHeight) {
        this.destroySurface();
        this.surface = this.scene.add.renderTexture(view.x, view.y, width, height).setOrigin(0, 0).setDepth(DEPTH.SMOKE);
        registerGraphicsObject(this.scene, 'smokeClouds', this.surface);
        this.surface.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
        this.surfaceWidth = width; this.surfaceHeight = height;
      }
      if (visible.size === 1) {
        this.surface.clear();
        this.surface.setPosition(view.x, view.y).setDisplaySize(view.width, view.height).setAlpha(opacity);
      }
      let visual = this.visuals.get(snapshot.id);
      if (!visual) { visual = this.createVisual(snapshot); this.visuals.set(snapshot.id, visual); }
      const u = visual.uniforms;
      u.time = Math.max(0, now - (this.animationOrigins.get(snapshot.id) ?? now)) * 0.001;
      u.detail = quality.detail; u.pixels = radius * 2 * scaleX;
      u.opacity = snapshot.alpha / Math.max(0.001, maxAlpha);
      u.weather = sampleSmokeWeather(u.time, u.seed);
      if (!snapshot.storm || snapshot.phase === 'dissipating') u.weather = { a: [0, 0, 0, 0], b: [0, 0, 0, 0], flash: 0, event: 0 };
      // Shader uses Size, which does not refresh its cached display origin on resize.
      visual.quad.setPosition(snapshot.x, snapshot.y).setSize(radius * 2, radius * 2).setOrigin(0.5);
      const weather = u.weather.a;
      if (weather[2] > 0.015) {
        this.lighting?.setLight(visual.lightKey, 'electricArc', snapshot.x + weather[0] * radius, snapshot.y + weather[1] * radius,
          { radiusPx: radius * 0.65, intensity: weather[2] * snapshot.alpha * 0.35 });
      } else this.lighting?.releaseLight(visual.lightKey, { immediate: true });
      const capture = { x: (snapshot.x - view.x) * scaleX, y: (snapshot.y - view.y) * scaleY, scaleX, scaleY, visible: true };
      this.surface.capture(visual.quad, capture);
    }
    for (const [id, visual] of this.visuals) if (!visible.has(id)) {
      this.destroyVisual(visual); this.visuals.delete(id);
    }
    if (visible.size) this.surface?.render(); else this.destroySurface();
    this.updateStatusEffects(now);
  }

  private createVisual(cloud: SyncedSmokeCloud): SmokeCloudVisual {
    const seed = createSeededRandom((cloud.id + 1) * 0x9e3779b9)() * 997;
    const uniforms = { time: 0, seed, detail: 2, pixels: 1, opacity: 1, weather: sampleSmokeWeather(0, seed) };
    const quad = this.scene.add.shader({
      name: SMOKE_SHADER_NAME, shaderName: SMOKE_SHADER_NAME, fragmentSource: SMOKE_FRAGMENT_SOURCE,
      setupUniforms: (setUniform: (name: string, value: number | readonly number[]) => void) => {
        setUniform('uBody', 0); setUniform('uWisp', 1);
        setUniform('uTime', uniforms.time); setUniform('uSeed', uniforms.seed);
        setUniform('uDetail', uniforms.detail); setUniform('uPixels', uniforms.pixels); setUniform('uOpacity', uniforms.opacity);
        setUniform('uWeatherA', uniforms.weather.a); setUniform('uWeatherB', uniforms.weather.b);
        setUniform('uFlash', uniforms.weather.flash); setUniform('uArcSeed', uniforms.weather.event);
      },
    }, cloud.x, cloud.y, cloud.radius * 2, cloud.radius * 2, [TEX_BODY_A, TEX_WISP]).setOrigin(0.5).setVisible(false);
    registerGraphicsObject(this.scene, 'smokeClouds', quad, () => quad.active);
    return { quad, uniforms, lightKey: 'smoke-weather-' + cloud.id };
  }

  private destroyVisual(visual: SmokeCloudVisual): void {
    this.lighting?.releaseLight(visual.lightKey, { immediate: true });
    visual.quad.destroy();
  }

  private updateStatusEffects(now: number): void {
    const live = new Set(this.targetStates.filter(s => s.confusedUntil > now || s.chargedUntil > now).map(s => s.enemyId));
    for (const [id, effect] of this.statusEffects) if (!live.has(id)) {
      effect.destroy(); this.statusEffects.delete(id);
    }
    const view = getVisibleWorldView(this.scene.cameras.main);
    for (const status of this.targetStates) {
      if (!live.has(status.enemyId)) continue;
      const target = this.resolveTarget(status.enemyId);
      let effect = this.statusEffects.get(status.enemyId);
      const margin = (target?.bodySize ?? 0) * 2;
      if (!target || !target.visible || !target.sprite.active || !target.sprite.visible
        || target.sprite.x + margin < view.x || target.sprite.x - margin > view.x + view.width
        || target.sprite.y + margin < view.y || target.sprite.y - margin > view.y + view.height) {
        effect?.destroy(); this.statusEffects.delete(status.enemyId); continue;
      }
      if (effect && effect.sprite !== target.sprite) { effect.destroy(); effect = undefined; }
      if (!effect) {
        const seed = [...status.enemyId].reduce((hash, c) => ((hash * 31 + c.charCodeAt(0)) >>> 0), 7) % 997;
        effect = new SmokeBodyEffect(this.scene, target, TEX_WISP, seed);
        this.statusEffects.set(status.enemyId, effect);
      }
      let smokeCover = 0;
      for (const cloud of this.clouds) {
        const r = Math.hypot(target.sprite.x - cloud.x, target.sprite.y - cloud.y) / Math.max(1, cloud.radius);
        smokeCover = Math.max(smokeCover, cloud.alpha * Math.max(0, Math.min(1, (1 - r) / .3)));
      }
      effect.update(target, status.confusedUntil, status.chargedUntil, now, smokeCover);
    }
    for (const [id, started] of this.growthPulses) {
      const age = this.scene.time.now - started;
      if (age >= 350) { this.growthPulses.delete(id); this.growthRings.get(id)?.destroy(); this.growthRings.delete(id); continue; }
      const cloud = this.clouds.find(c => c.id === id);
      if (!cloud) continue;
      let ring = this.growthRings.get(id);
      if (!ring) { ring = this.scene.add.image(cloud.x, cloud.y, TEX_GROWTH).setDepth(DEPTH.SMOKE + 0.3).setTint(0xb0ecff); this.growthRings.set(id, ring); }
      const size = cloud.radius * (0.8 + age / 350 * 0.2) * 2;
      ring.setDisplaySize(size, size).setAlpha((1 - age / 350) * 0.55);
    }
  }

  private ensureSmokeTextures(): void {
    ensureCanvasTexture(this.scene.textures, TEX_GROWTH, 256, 256, ctx => {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(128, 128, 126, 0, TAU); ctx.stroke();
    });
    this.generateBodyTexture(TEX_BODY_A, 0x52fa3c17, {
      lobeCount: 30,
      plateau: 0.7,
      baseAlpha: 0.96,
      lobeAlpha: [0.4, 0.72],
    });
    this.generateWispTexture();

  }

  /**
   * A near-opaque body puff: organic billow lobes lifted to a flat, opaque
   * plateau, then carved by a radial mask that keeps the centre solid and only
   * feathers transparency into the outer rim.
   */
  private generateBodyTexture(
    key: string,
    seed: number,
    config: { lobeCount: number; plateau: number; baseAlpha: number; lobeAlpha: [number, number] },
  ): void {
    ensureCanvasTexture(this.scene.textures, key, BODY_TEXTURE_SIZE, BODY_TEXTURE_SIZE, (ctx) => {
      const size = BODY_TEXTURE_SIZE;
      const center = size / 2;
      const rand = createSeededRandom(seed);

      ctx.clearRect(0, 0, size, size);

      // 1) Organic billow lobes biased outward to fill the disc.
      for (let i = 0; i < config.lobeCount; i++) {
        const angle = rand() * TAU;
        const dist = Math.pow(rand(), 0.7) * center * 0.74;
        const r = Phaser.Math.Linear(size * 0.1, size * 0.2, rand());
        const x = center + Math.cos(angle) * dist;
        const y = center + Math.sin(angle) * dist;
        const a = Phaser.Math.Linear(config.lobeAlpha[0], config.lobeAlpha[1], rand());
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
        gradient.addColorStop(0, `rgba(255,255,255,${a})`);
        gradient.addColorStop(0.5, `rgba(255,255,255,${a * 0.72})`);
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }

      // 2) Lift the core to a near-opaque plateau (additive clamp toward white).
      ctx.globalCompositeOperation = 'lighter';
      const lift = ctx.createRadialGradient(center, center, 0, center, center, center * config.plateau);
      lift.addColorStop(0, `rgba(255,255,255,${config.baseAlpha})`);
      lift.addColorStop(0.72, `rgba(255,255,255,${config.baseAlpha * 0.92})`);
      lift.addColorStop(1, `rgba(255,255,255,${config.baseAlpha * 0.6})`);
      ctx.fillStyle = lift;
      ctx.fillRect(0, 0, size, size);
      ctx.globalCompositeOperation = 'source-over';

      // 3) Carve the silhouette: solid centre, transparency only at the rim.
      ctx.globalCompositeOperation = 'destination-in';
      const mask = ctx.createRadialGradient(
        center,
        center,
        center * config.plateau,
        center,
        center,
        center,
      );
      mask.addColorStop(0, 'rgba(255,255,255,1)');
      mask.addColorStop(0.45, 'rgba(255,255,255,0.92)');
      mask.addColorStop(0.78, 'rgba(255,255,255,0.5)');
      mask.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = mask;
      ctx.fillRect(0, 0, size, size);
      ctx.globalCompositeOperation = 'source-over';
    });
  }

  private generateWispTexture(): void {
    ensureCanvasTexture(this.scene.textures, TEX_WISP, WISP_TEXTURE_SIZE, WISP_TEXTURE_SIZE, (ctx) => {
      const size = WISP_TEXTURE_SIZE;
      const center = size / 2;
      const rand = createSeededRandom(0xd4c89a51);

      ctx.clearRect(0, 0, size, size);

      for (let i = 0; i < 16; i++) {
        const angle = rand() * TAU;
        const dist = Math.pow(rand(), 1.2) * center * 0.5;
        const r = Phaser.Math.Linear(size * 0.1, size * 0.22, rand());
        const x = center + Math.cos(angle) * dist;
        const y = center + Math.sin(angle) * dist;
        const a = Phaser.Math.Linear(0.16, 0.34, rand());
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
        gradient.addColorStop(0, `rgba(255,255,255,${a})`);
        gradient.addColorStop(0.55, `rgba(255,255,255,${a * 0.6})`);
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }

      ctx.globalCompositeOperation = 'destination-in';
      const mask = ctx.createRadialGradient(center, center, size * 0.05, center, center, center * 0.95);
      mask.addColorStop(0, 'rgba(255,255,255,1)');
      mask.addColorStop(0.6, 'rgba(255,255,255,0.85)');
      mask.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = mask;
      ctx.fillRect(0, 0, size, size);
      ctx.globalCompositeOperation = 'source-over';
    });
  }

}
