import * as Phaser from 'phaser';
import type { ExplosionVisualStyle } from '../types';
import { resonanceReleaseStrength } from './timeBubbleResonanceVisual';
import { emissiveAlpha } from './EmissiveScale';
import {
  getCombatExplosionProfile,
  isThermalExplosionStyle,
  type CombatExplosionVisualStyle,
  type ExplosionVisualProfile,
} from './ExplosionVisualProfiles';
import { GpuVfxFrameId } from './gpu/GpuVfxAtlas';
import {
  GPU_VFX_EFFECTS,
  EXPLOSION_LAYER_EFFECTS,
  GpuVfxEffectId,
  type GpuVfxEffectId as GpuVfxEffectIdType,
} from './gpu/GpuVfxEffects';
import { GpuVfxEase } from './gpu/GpuVfxEase';
import { pickGpuVfxTint } from './gpu/GpuVfxMember';
import {
  GPU_VFX_NO_SOURCE_HANDLE,
  type GpuVfxSystem,
} from './gpu/GpuVfxSystem';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';

const TWO_PI = Math.PI * 2;
const MAX_PENDING_STAGES = 256;
const STALE_STAGE_GRACE_MS = 80;

type GpuVfxMotionEase = typeof GpuVfxEase.Linear | typeof GpuVfxEase.Gravity;
type PendingStageKind = 'secondary' | 'cascade' | 'smoke' | 'shock';

/** Ausstoßwellen der ASMD-Combo: die erste sofort, die weiteren im festen Takt. */
const SHOCK_WAVES = 3;
const SHOCK_WAVE_INTERVAL_MS = 55;

export interface ExplosionCombatPalette {
  readonly core: number;
  readonly hot: number;
  readonly body: number;
  readonly outer: number;
  readonly ember: number;
  readonly smoke: number;
}

export interface ExplosionCombatVisualRequest {
  readonly chargeDamage?: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly style: CombatExplosionVisualStyle;
  readonly palette: ExplosionCombatPalette;
}

interface PendingExplosionStage {
  readonly kind: PendingStageKind;
  readonly dueMs: number;
  readonly request: ExplosionCombatVisualRequest;
  /** Nur fuer 'shock': Index der Ausstosswelle. */
  readonly wave?: number;
}

interface ParticleSetup {
  x: number;
  y: number;
  vx: number;
  vy: number;
  lifeMs: number;
  scaleStart: number;
  scaleEnd: number;
  alphaStart: number;
  tint: number;
  frame?: GpuVfxFrameId;
  yMode?: GpuVfxMotionEase;
  positionEase?: typeof GpuVfxEase.Linear | typeof GpuVfxEase.QuadOut;
  gravityFactor?: number;
  rotation?: number;
  angularVelocity?: number;
  scaleEase?: typeof GpuVfxEase.Linear | typeof GpuVfxEase.QuadOut;
  stretchStart?: number;
  stretchEnd?: number;
  alphaEnd?: number;
  alphaEase?: typeof GpuVfxEase.Linear | typeof GpuVfxEase.CubicIn;
  tintBlendStart?: number;
  tintBlendEnd?: number;
}

/**
 * Szenenweiter GPU-Renderer fuer alle destruktiven Kampfexplosionen.
 *
 * Jeder Aufruf erzeugt sofort Impact, Kern, Hauptfunken und Druckwelle. Sekundaerballen und
 * Rauch liegen in einer kleinen, begrenzten Timeline. Die GPU uebernimmt danach Bewegung,
 * Skalierung, Rotation, Temperaturfarbe und Lebensdauer ohne per-Partikel-CPU-Update.
 */
export class ExplosionGpuRenderer {
  private gpuVfx: GpuVfxSystem | null = null;
  private readonly specs = new Map<GpuVfxEffectIdType, GpuVfxSpawnSpec>();
  private readonly pendingStages: PendingExplosionStage[] = [];
  private emissionRegistered = false;

  registerGpuVfx(system: GpuVfxSystem): void {
    this.gpuVfx = system;
    this.specs.clear();
    const effects: readonly GpuVfxEffectIdType[] = [
      GpuVfxEffectId.ExplosionSpark,
      GpuVfxEffectId.ExplosionEmberDown,
      GpuVfxEffectId.ExplosionEmberUp,
      GpuVfxEffectId.ExplosionAccent,
      GpuVfxEffectId.ExplosionCascade,
      GpuVfxEffectId.ExplosionTrainChunk,
      GpuVfxEffectId.ExplosionTrainSpark,
      GpuVfxEffectId.ExplosionLightningSpark,
      GpuVfxEffectId.ExplosionHolyCrown,
      GpuVfxEffectId.ExplosionTrainCore,
      GpuVfxEffectId.ExplosionNukePlume,
      GpuVfxEffectId.ExplosionNukeFallout,
      GpuVfxEffectId.ExplosionRegeneration,
      GpuVfxEffectId.ExplosionBody,
      GpuVfxEffectId.ExplosionSmoke,
      GpuVfxEffectId.ExplosionShockwave,
      GpuVfxEffectId.ExplosionSecondary,
      ...Object.values(EXPLOSION_LAYER_EFFECTS.ordinary),
    ];
    for (const effect of effects) this.specs.set(effect, system.createSpec(effect));

    if (!this.emissionRegistered) {
      system.registerEmission((_deltaMs, nowMs) => this.advancePendingStages(nowMs));
      this.emissionRegistered = true;
    }
  }

  spawnCombatExplosion(request: ExplosionCombatVisualRequest): void {
    const profile = getCombatExplosionProfile(request.style);
    if (!this.gpuVfx || !profile || request.radius <= 0) return;

    if (request.style === 'time_bubble_release') { this.spawnBubbleRelease(request); return; }
    if (profile.family === 'shock') { this.spawnShockDischarge(request, profile); return; }

    this.spawnImpact(request, profile);
    if (profile.family === 'pop' || profile.family === 'lightning') return;

    const nowMs = this.gpuVfx?.now() ?? 0;
    this.scheduleStage({
      kind: 'secondary',
      dueMs: nowMs + (profile.family === 'nuke' ? 90 : 70),
      request,
    });
    if (profile.family === 'cascade') {
      this.scheduleStage({ kind: 'cascade', dueMs: nowMs + 90, request });
    }
    if (profile.smokeScale > 0) {
      this.scheduleStage({ kind: 'smoke', dueMs: nowMs + 140, request });
    }
  }

  /** Meteor volume/flash/smoke are batched procedural fields; only ejecta use the shared
   * particle lanes. Burning gameplay chunks remain exclusively in FireChunkSystem. */
  spawnMeteorDebris(x:number,y:number,radius:number,variant:'normal'|'void'):void {
    this.spawnBurst(GpuVfxEffectId.ExplosionLowEmberDown,Math.min(28,Math.max(10,Math.round(radius/4))), (spec,index,count)=>{
      const angle=index/count*TWO_PI+Math.random()*.3;
      const speed=radius*(.6+Math.random()*1.5);
      this.configure(spec,{x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed-radius*.7,
        yMode:GpuVfxEase.Gravity,gravityFactor:1,lifeMs:700+Math.random()*650,
        scaleStart:.6+Math.random()*.9,scaleEnd:.08,alphaStart:.95,tint:index%3?0x4e3925:0x88735a,
        frame:GpuVfxFrameId.ExplosionChunk,rotation:angle,angularVelocity:Math.random()*6-3});
    });
    this.spawnBurst(GpuVfxEffectId.ExplosionLowSpark,Math.min(30,Math.round(radius/3)),spec=>{
      const angle=Math.random()*TWO_PI,speed=radius*(.8+Math.random()*1.7);
      this.configure(spec,{x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,lifeMs:350+Math.random()*650,
        scaleStart:.5+Math.random()*.7,scaleEnd:0,alphaStart:.85,tint:variant==='void'?0xbb72ff:0xffa339,
        frame:GpuVfxFrameId.ExplosionStreak,rotation:angle,stretchStart:1.9,stretchEnd:.4});
    });
  }

  /** Rundenwechsel duerfen keine verzoegerten Bursts in Lobby oder naechste Runde tragen. */
  clearPending(): void {
    this.pendingStages.length = 0;
  }

  /** Test- und Diagnoseansicht; keine mutierbare Queue wird herausgegeben. */
  getPendingStageCount(): number {
    return this.pendingStages.length;
  }

  /** Regeneration bleibt bewusst eine eigene, nicht-destruktive Effektfamilie. */
  spawnRegeneration(x: number, y: number, radius: number, count: number, color: number, brightColor: number): void {
    this.spawnBurst(GpuVfxEffectId.ExplosionRegeneration, count, (spec) => {
      this.configure(spec, {
        x,
        y,
        vx: Phaser.Math.FloatBetween(-radius * 0.35, radius * 0.35),
        vy: Phaser.Math.FloatBetween(-radius * 1.5, -radius * 0.6),
        lifeMs: Phaser.Math.FloatBetween(380, 720),
        scaleStart: 0.85,
        scaleEnd: 0,
        alphaStart: 0.9,
        tint: pickGpuVfxTint([0xffffff, brightColor, color]),
        frame: GpuVfxFrameId.ExplosionSpark,
      });
    });
  }

  private spawnBubbleRelease(request: ExplosionCombatVisualRequest): void {
    const strength = resonanceReleaseStrength(request.chargeDamage);
    if (strength <= 0) return;
    const { x, y, radius } = request;
    // A brief, soft volume flash opens the shell; the hollow fronts remain readable after it fades.
    this.spawnBurst(this.effectFor(request, 'Shockwave'), 2, (spec, index) => {
      this.configure(spec, { x, y, vx: 0, vy: 0, gravityFactor: 0,
        frame: GpuVfxFrameId.ExplosionCore, lifeMs: index ? 260 : 140,
        scaleStart: radius / 16 * (index ? 0.55 : 0.16), scaleEnd: radius / 16 * (index ? 1 : 0.65),
        scaleEase: GpuVfxEase.QuadOut, alphaStart: (index ? 0.24 : 0.55) + strength * 0.35,
        tint: index ? 0xff7418 : 0xffe9ae,
      });
    });
    this.spawnBurst(this.effectFor(request, 'Shockwave'), 3, (spec, index) => {
      this.configure(spec, { x, y, vx: 0, vy: 0, gravityFactor: 0,
        frame: GpuVfxFrameId.ExplosionRing, lifeMs: index === 0 ? 180 : (index === 1 ? 340 : 480),
        scaleStart: radius / 32 * (index === 0 ? 0.96 : 0.04), scaleEnd: radius / 32,
        scaleEase: GpuVfxEase.QuadOut, alphaStart: (index === 2 ? 0.4 : 0.7) + strength * 0.28,
        // Preserve the front's brightness during travel instead of fading most of it near the center.
        alphaEase: index === 0 ? GpuVfxEase.Linear : GpuVfxEase.CubicIn,
        tint: index === 1 ? 0xffd675 : 0xff4810,
        tintBlendStart: index === 1 ? 0.45 : 1,
      });
    });
    this.spawnBurst(GpuVfxEffectId.ExplosionAccent, 1, spec => {
      this.configure(spec, { x, y, vx: 0, vy: 0, gravityFactor: 0,
        frame: GpuVfxFrameId.ExplosionRing, lifeMs: 520,
        scaleStart: radius / 32 * 0.9, scaleEnd: radius / 32,
        alphaStart: 0.22 + strength * 0.3, tint: 0xd72d0b,
      });
    });
    // Bright radial spokes connect the source to the front; ember slivers break off the old membrane.
    this.spawnBurst(this.effectFor(request, 'Spark'), Math.round(16 + strength * 32), (spec, index, count) => {
      const angle = index / count * TWO_PI + Math.random() * 0.12;
      const lifeMs = 400 + Math.random() * 260;
      const speed = radius * 0.7 / (lifeMs / 1000);
      this.configure(spec, {
        x: x + Math.cos(angle) * radius * 0.12, y: y + Math.sin(angle) * radius * 0.12,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, gravityFactor: 0,
        frame: GpuVfxFrameId.ExplosionStreak, lifeMs,
        scaleStart: 0.4 + strength * 0.45, scaleEnd: 0.03,
        stretchStart: 2.4 + strength * 1.4, stretchEnd: 0.7, rotation: angle,
        alphaStart: 0.7 + strength * 0.25, tint: index % 3 ? 0xff931f : 0xffde81,
        tintBlendStart: 0.55,
      });
    });
    this.spawnBurst(this.effectFor(request, 'Spark'), Math.round(12 + strength * 24), (spec, index, count) => {
      const angle = index / count * TWO_PI + Math.random() * 0.18;
      const speed = radius * (0.08 + Math.random() * 0.08);
      this.configure(spec, {
        x: x + Math.cos(angle) * radius * 0.84, y: y + Math.sin(angle) * radius * 0.84,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, gravityFactor: 0,
        frame: GpuVfxFrameId.ExplosionStreak, lifeMs: 550 + Math.random() * 400,
        scaleStart: 0.35 + strength * 0.45, scaleEnd: 0.02,
        stretchStart: 2 + strength, stretchEnd: 0.4, rotation: angle + Math.PI * 0.5,
        angularVelocity: index % 2 ? 1.6 : -1.6,
        alphaStart: 0.65 + strength * 0.3, tint: index % 3 ? 0xff5b16 : 0xffc237,
      });
    });
  }

  /**
   * Energieentladung der ASMD-Combo: Energie strömt sichtbar vom Kern nach außen. Drei Wellen
   * aus Energiepfeilen und leuchtenden Plasmakugeln schießen aus dem Kern, bremsen an der
   * Kugelhülle ab und verglühen dort; einzelne Überschussfunken durchschlagen die Hülle.
   * Körper, Rauch und Brocken entfallen bewusst; die Form trägt der ShockComboExplosionRenderer.
   */
  private spawnShockDischarge(request: ExplosionCombatVisualRequest, profile: ExplosionVisualProfile): void {
    this.spawnShockWave(request, profile, 0);
    const nowMs = this.gpuVfx?.now() ?? 0;
    for (let wave = 1; wave < SHOCK_WAVES; wave += 1) {
      this.scheduleStage({ kind: 'shock', dueMs: nowMs + wave * SHOCK_WAVE_INTERVAL_MS, request, wave });
    }

    // Überschussfunken: dünn, schnell, schlagen über die Hülle hinaus.
    const { x, y, radius, palette } = request;
    this.spawnBurst(this.effectFor(request, 'Spark'), Math.round(this.resolveSparkCount(radius, profile) * 0.45), (spec, index, count) => {
      const angle = index / count * TWO_PI + Phaser.Math.FloatBetween(-0.25, 0.25);
      const lifeMs = Phaser.Math.FloatBetween(130, 260) * profile.lifeScale;
      const speed = Phaser.Math.FloatBetween(radius * 2.6, radius * 4.2);
      this.configure(spec, {
        x: x + Math.cos(angle) * radius * 0.2,
        y: y + Math.sin(angle) * radius * 0.2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        positionEase: GpuVfxEase.QuadOut,
        lifeMs,
        scaleStart: Phaser.Math.FloatBetween(0.35, 0.6),
        scaleEnd: 0,
        alphaStart: 0.9,
        tint: pickGpuVfxTint([palette.core, palette.hot]),
        tintBlendStart: 0,
        tintBlendEnd: 1,
        frame: GpuVfxFrameId.ExplosionStreak,
        rotation: angle,
        stretchStart: Phaser.Math.FloatBetween(3.2, 4.6),
        stretchEnd: 0.5,
      });
    });

    // Ionisationsfunken, die von der Hülle abdriften.
    const moteCount = clamp(Math.round(radius / 5 * profile.countScale), 6, 30);
    this.spawnBurst(this.effectFor(request, 'Spark'), moteCount, (spec) => {
      const angle = Phaser.Math.FloatBetween(0, TWO_PI);
      const shell = radius * Phaser.Math.FloatBetween(0.75, 0.95);
      const drift = radius * Phaser.Math.FloatBetween(0.1, 0.3);
      this.configure(spec, {
        x: x + Math.cos(angle) * shell,
        y: y + Math.sin(angle) * shell,
        vx: Math.cos(angle) * drift,
        vy: Math.sin(angle) * drift,
        lifeMs: Phaser.Math.FloatBetween(260, 500),
        scaleStart: Phaser.Math.FloatBetween(0.4, 0.75),
        scaleEnd: 0,
        alphaStart: emissiveAlpha(0.85),
        tint: pickGpuVfxTint([palette.core, palette.hot, palette.body]),
        tintBlendStart: 0.3,
        tintBlendEnd: 1,
        frame: GpuVfxFrameId.ExplosionSpark,
      });
    });
  }

  /**
   * Eine Ausstoßwelle: Energiepfeile starten im Kern, sind lang gestreckt, solange sie schnell
   * sind, und ziehen sich beim Abbremsen an der Hülle zu Lichtpunkten zusammen. Dazwischen
   * fliegen größere Plasmakugeln, die beim Ankommen in Hüllenfarbe verglühen.
   */
  private spawnShockWave(request: ExplosionCombatVisualRequest, profile: ExplosionVisualProfile, wave: number): void {
    const { x, y, radius, palette } = request;
    const strength = 1 - wave * 0.22;
    const offset = Phaser.Math.FloatBetween(0, TWO_PI);
    const dartCount = Math.round(clamp(Math.round(radius / 3.2 * profile.countScale), 12, 56) * strength);
    this.spawnBurst(this.effectFor(request, 'Spark'), dartCount, (spec, index, count) => {
      const angle = offset + index / count * TWO_PI + Phaser.Math.FloatBetween(-0.12, 0.12);
      const start = radius * Phaser.Math.FloatBetween(0.02, 0.14);
      const travel = radius * Phaser.Math.FloatBetween(0.7, 0.98) - start;
      const lifeMs = Phaser.Math.FloatBetween(200, 300) * profile.lifeScale;
      // Die Amplitude ist vx * Lebenszeit; mit QuadOut endet die Bahn so genau an der Hülle.
      const speed = travel / (lifeMs / 1000);
      this.configure(spec, {
        x: x + Math.cos(angle) * start,
        y: y + Math.sin(angle) * start,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        positionEase: GpuVfxEase.QuadOut,
        lifeMs,
        scaleStart: Phaser.Math.FloatBetween(0.7, 1.15) * strength,
        scaleEnd: 0.18,
        alphaStart: 1,
        alphaEase: GpuVfxEase.CubicIn,
        tint: pickGpuVfxTint([palette.hot, palette.body, palette.body]),
        tintBlendStart: 0,
        tintBlendEnd: 1,
        frame: GpuVfxFrameId.ExplosionStreak,
        rotation: angle,
        stretchStart: Phaser.Math.FloatBetween(3.4, 5.2),
        stretchEnd: 0.9,
      });
    });

    const orbCount = Math.round(clamp(Math.round(radius / 7 * profile.countScale), 6, 22) * strength);
    this.spawnBurst(this.effectFor(request, 'Spark'), orbCount, (spec, index, count) => {
      const angle = offset + (index + 0.5) / count * TWO_PI + Phaser.Math.FloatBetween(-0.2, 0.2);
      const start = radius * Phaser.Math.FloatBetween(0.04, 0.16);
      const travel = radius * Phaser.Math.FloatBetween(0.6, 0.9) - start;
      const lifeMs = Phaser.Math.FloatBetween(240, 360) * profile.lifeScale;
      const speed = travel / (lifeMs / 1000);
      this.configure(spec, {
        x: x + Math.cos(angle) * start,
        y: y + Math.sin(angle) * start,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        positionEase: GpuVfxEase.QuadOut,
        lifeMs,
        scaleStart: Phaser.Math.FloatBetween(1.3, 2) * strength,
        scaleEnd: 0.3,
        alphaStart: emissiveAlpha(0.95),
        alphaEase: GpuVfxEase.CubicIn,
        tint: palette.body,
        tintBlendStart: 0,
        tintBlendEnd: 1,
        frame: GpuVfxFrameId.ExplosionSpark,
      });
    });
  }

  private spawnImpact(request: ExplosionCombatVisualRequest, profile: ExplosionVisualProfile): void {
    // Lightning besitzt bereits den spezialisierten CPU-Flash und die gezeichneten Arcs.
    if (profile.family !== 'lightning') this.spawnCore(request, profile);
    this.spawnShockwave(request, profile);
    this.spawnStreaks(request, profile);
    this.spawnChunks(request, profile);

    if (profile.family === 'holy') this.spawnHolyCrown(request);
    if (profile.family === 'train') this.spawnTrainDebris(request);
    if (profile.family === 'nuke') this.spawnNukeImpact(request);
  }

  private spawnCore(request: ExplosionCombatVisualRequest, profile: ExplosionVisualProfile): void {
    const { x, y, radius, palette } = request;
    const coreLife = (profile.family === 'pop' ? 180 : 280) * profile.lifeScale;
    const coreStart = Math.max(0.24, radius / 180) * profile.bodyScale;
    // Thermal: a compact white-hot flash; the billowing body, not the flash, carries the volume.
    const coreEnd = Math.max(coreStart, radius / (isThermalExplosionStyle(request.style) ? 80 : 50)) * profile.bodyScale;
    this.spawnBurst(this.effectFor(request, 'Core'), 2, (spec, index) => {
      this.configure(spec, {
        x,
        y,
        vx: 0,
        vy: 0,
        lifeMs: coreLife * (index === 0 ? 0.72 : 1),
        scaleStart: coreStart * (index === 0 ? 0.72 : 1),
        scaleEnd: coreEnd * (index === 0 ? 0.72 : 1),
        scaleEase: GpuVfxEase.QuadOut,
        alphaStart: index === 0 ? 0.96 : (isThermalExplosionStyle(request.style) ? 0.55 : 0.72),
        tint: index === 0 ? palette.core : palette.hot,
        // Ein einziger kleiner Kern darf als Weissglut starten; der zweite Kern ist
        // bereits fast voll eingefärbt, damit die grosse Body-Fläche nicht weiss bleibt.
        tintBlendStart: isThermalExplosionStyle(request.style) ? (index === 0 ? 0 : 0.84) : 0,
        tintBlendEnd: 1,
        frame: GpuVfxFrameId.ExplosionCore,
        rotation: Phaser.Math.FloatBetween(0, TWO_PI),
      });
    });

    if (profile.family === 'pop') return;
    const bodyCount = this.resolveBodyCount(radius, profile);
    const thermalBody = isThermalExplosionStyle(request.style);
    this.spawnFireballs(this.effectFor(request, 'Body'), request, profile,
      thermalBody ? Math.ceil(bodyCount * 1.35) : bodyCount, thermalBody ? 0.92 : 0.72);
  }

  private spawnFireballs(
    effect: GpuVfxEffectIdType,
    request: ExplosionCombatVisualRequest,
    profile: ExplosionVisualProfile,
    count: number,
    alpha: number,
  ): void {
    const { x, y, radius, palette } = request;
    const thermal = isThermalExplosionStyle(request.style);
    this.spawnBurst(effect, count, (spec, index) => {
      const point = this.randomPointInCircle(radius * (thermal ? 0.24 : 0.16));
      // Thermal bodies start white-hot and cool into their tint; the inner billows stay hottest.
      const inner = Math.hypot(point.x, point.y) < radius * 0.11;
      const angle = Math.atan2(point.y, point.x) + Phaser.Math.FloatBetween(-0.55, 0.55);
      const speed = Phaser.Math.FloatBetween(radius * 0.12, radius * 0.42);
      // Thermal billows linger 50 % longer so the fireball reads before the smoke takes over;
      // capped below the 1400 ms lane lifetime.
      const lifeMs = Math.min(1350, Phaser.Math.FloatBetween(300, 560) * profile.lifeScale * (thermal ? 1.5 : 1));
      const startScale = Math.max(0.18, radius / (thermal ? 150 : 190)) * profile.bodyScale;
      const endScale = Phaser.Math.FloatBetween(radius / 78, radius / 56) * profile.bodyScale;
      this.configure(spec, {
        x: x + point.x,
        y: y + point.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        lifeMs,
        scaleStart: startScale,
        scaleEnd: endScale,
        scaleEase: GpuVfxEase.QuadOut,
        alphaStart: alpha,
        tint: thermal && inner ? palette.hot
          : pickGpuVfxTint(thermal ? [palette.hot, palette.body, palette.body, palette.outer] : [palette.hot, palette.body, palette.outer]),
        tintBlendStart: thermal ? (inner ? 0.55 : 0.8) : 0.08,
        tintBlendEnd: 1,
        frame: index % 2 === 0 ? GpuVfxFrameId.ExplosionFireballA : GpuVfxFrameId.ExplosionFireballB,
        rotation: Phaser.Math.FloatBetween(0, TWO_PI),
        angularVelocity: Phaser.Math.FloatBetween(-0.8, 0.8),
      });
    });
  }

  private spawnShockwave(request: ExplosionCombatVisualRequest, profile: ExplosionVisualProfile): void {
    const { x, y, radius, palette } = request;
    const startScale = Math.max(0.12, radius * 0.2 / 32);
    const endScale = Math.max(startScale, radius * (profile.family === 'nuke' ? 1.35 : 1.12) / 32);
    this.spawnBurst(this.effectFor(request, 'Shockwave'), 1, (spec) => {
      this.configure(spec, {
        x,
        y,
        vx: 0,
        vy: 0,
        lifeMs: profile.family === 'nuke' ? 520 : 360,
        scaleStart: startScale,
        scaleEnd: endScale,
        scaleEase: GpuVfxEase.QuadOut,
        alphaStart: profile.family === 'lightning' ? 0.92 : (isThermalExplosionStyle(request.style) ? 0.36 : 0.78),
        tint: palette.hot,
        frame: GpuVfxFrameId.ExplosionRing,
      });
    });
  }

  private spawnStreaks(request: ExplosionCombatVisualRequest, profile: ExplosionVisualProfile): void {
    const { x, y, radius, palette } = request;
    const thermal = isThermalExplosionStyle(request.style);
    // Thermal bursts read as fire, not as a sun: fewer, shorter streaks.
    const count = thermal ? Math.ceil(this.resolveSparkCount(radius, profile) * 0.4) : this.resolveSparkCount(radius, profile);
    const effect = profile.family === 'train'
      ? GpuVfxEffectId.ExplosionTrainSpark
      : profile.family === 'lightning'
        ? GpuVfxEffectId.ExplosionLightningSpark
        : this.effectFor(request, 'Spark');
    const tints = isThermalExplosionStyle(request.style)
      ? [palette.hot, palette.body, palette.outer]
      : [palette.core, palette.hot, palette.body, palette.outer];

    this.spawnBurst(effect, count, (spec) => {
      const angle = Phaser.Math.FloatBetween(0, TWO_PI);
      const speed = Phaser.Math.FloatBetween(radius * 0.7, radius * (profile.family === 'nuke' ? 2.8 : 2.15));
      const lifeMs = Phaser.Math.FloatBetween(220, 620) * profile.lifeScale;
      this.configure(spec, {
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        lifeMs,
        scaleStart: Phaser.Math.FloatBetween(0.62, 1.12),
        scaleEnd: 0,
        alphaStart: profile.family === 'train' ? emissiveAlpha(1) : 0.94,
        tint: pickGpuVfxTint(tints),
        tintBlendStart: isThermalExplosionStyle(request.style) ? 0.9 : 0,
        tintBlendEnd: 1,
        frame: GpuVfxFrameId.ExplosionStreak,
        rotation: angle,
        stretchStart: thermal ? Phaser.Math.FloatBetween(1.1, 1.8) : Phaser.Math.FloatBetween(1.4, 2.5),
        stretchEnd: 0.55,
      });
    });
  }

  private spawnChunks(request: ExplosionCombatVisualRequest, profile: ExplosionVisualProfile): void {
    const count = this.resolveChunkCount(request.radius, profile);
    if (count <= 0) return;
    const { x, y, radius, palette } = request;
    const effect = profile.upwardEmbers ? GpuVfxEffectId.ExplosionEmberUp : this.effectFor(request, 'EmberDown');
    const gravityFactor = profile.upwardEmbers ? (profile.family === 'holy' ? 0.45 : 0.16) : 1;
    this.spawnBurst(effect, count, (spec) => {
      const angle = Phaser.Math.FloatBetween(0, TWO_PI);
      const speed = Phaser.Math.FloatBetween(radius * 0.2, radius * 0.95);
      this.configure(spec, {
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        yMode: GpuVfxEase.Gravity,
        gravityFactor,
        lifeMs: Phaser.Math.FloatBetween(520, 1100) * profile.lifeScale,
        scaleStart: Phaser.Math.FloatBetween(0.42, 0.82) * profile.bodyScale,
        scaleEnd: 0.08,
        alphaStart: 0.74,
        tint: pickGpuVfxTint([palette.hot, palette.ember, palette.outer]),
        tintBlendStart: isThermalExplosionStyle(request.style) ? 1 : 0.05,
        tintBlendEnd: 1,
        frame: GpuVfxFrameId.ExplosionChunk,
        rotation: Phaser.Math.FloatBetween(0, TWO_PI),
        angularVelocity: Phaser.Math.FloatBetween(-3.2, 3.2),
      });
    });
  }

  private spawnSecondary(request: ExplosionCombatVisualRequest): void {
    const profile = getCombatExplosionProfile(request.style);
    if (!profile) return;
    const count = Math.max(3, Math.ceil(this.resolveBodyCount(request.radius, profile) * 0.55));
    this.spawnFireballs(this.effectFor(request, 'Secondary'), request, profile, count,
      isThermalExplosionStyle(request.style) ? 0.62 : 0.5);
    if (profile.family === 'nuke') this.spawnNukePlume(request, profile);
  }

  private spawnCascade(request: ExplosionCombatVisualRequest): void {
    const { x, y, radius, palette } = request;
    const count = Math.max(8, Math.ceil(radius / 7));
    this.spawnBurst(this.effectFor(request, 'Cascade'), count, (spec) => {
      const angle = Phaser.Math.FloatBetween(0, TWO_PI);
      const speed = Phaser.Math.FloatBetween(radius * 0.45, radius * 1.65);
      this.configure(spec, {
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        lifeMs: Phaser.Math.FloatBetween(240, 520),
        scaleStart: 0.9,
        scaleEnd: 0,
        alphaStart: 0.78,
        tint: pickGpuVfxTint([palette.hot, palette.body, palette.outer]),
        tintBlendStart: 0.9,
        tintBlendEnd: 1,
        frame: GpuVfxFrameId.ExplosionStreak,
        rotation: angle,
        stretchStart: 1.6,
        stretchEnd: 0.5,
      });
    });
  }

  private spawnSmoke(request: ExplosionCombatVisualRequest): void {
    const profile = getCombatExplosionProfile(request.style);
    if (!profile || profile.smokeScale <= 0) return;
    const { x, y, radius, palette } = request;
    const thermal = isThermalExplosionStyle(request.style);
    // Thermal fire is swallowed by a dense, swelling smoke body rather than a faint haze.
    const count = thermal ? Math.ceil(this.resolveSmokeCount(radius, profile) * 1.3) : this.resolveSmokeCount(radius, profile);
    this.spawnBurst(this.effectFor(request, 'Smoke'), count, (spec) => {
      const point = this.randomPointInCircle(radius * 0.3);
      this.configure(spec, {
        x: x + point.x,
        y: y + point.y,
        vx: Phaser.Math.FloatBetween(-radius * 0.11, radius * 0.11),
        vy: Phaser.Math.FloatBetween(-radius * 0.28, -radius * 0.08),
        lifeMs: Phaser.Math.FloatBetween(900, 1900),
        scaleStart: Math.max(0.2, radius / 190),
        scaleEnd: Math.max(0.5, radius / (thermal ? 62 : 72)),
        scaleEase: GpuVfxEase.QuadOut,
        alphaStart: profile.family === 'nuke' ? 0.42 : (thermal ? 0.46 : 0.3),
        tint: palette.smoke,
        frame: GpuVfxFrameId.ExplosionSmoke,
        rotation: Phaser.Math.FloatBetween(0, TWO_PI),
        angularVelocity: Phaser.Math.FloatBetween(-0.18, 0.18),
      });
    });

    if (profile.family === 'nuke') this.spawnNukeFallout(request);
  }

  private spawnHolyCrown(request: ExplosionCombatVisualRequest): void {
    const { x, y, radius, palette } = request;
    const count = Math.max(Math.ceil(radius / 1.9), 92);
    this.spawnBurst(GpuVfxEffectId.ExplosionHolyCrown, count, (spec) => {
      this.configure(spec, {
        x,
        y: y - radius * 0.05,
        vx: Phaser.Math.FloatBetween(-radius * 0.42, radius * 0.42),
        vy: Phaser.Math.FloatBetween(-radius * 1.35, -radius * 0.5),
        lifeMs: Phaser.Math.FloatBetween(520, 980),
        scaleStart: 0.7,
        scaleEnd: 0.02,
        alphaStart: 0.9,
        tint: pickGpuVfxTint([palette.core, palette.hot, palette.body]),
        tintBlendStart: 0,
        tintBlendEnd: 1,
        frame: GpuVfxFrameId.ExplosionStreak,
        rotation: -Math.PI / 2,
        stretchStart: 1.5,
        stretchEnd: 0.45,
        yMode: GpuVfxEase.Gravity,
        gravityFactor: 1,
      });
    });
  }

  private spawnTrainDebris(request: ExplosionCombatVisualRequest): void {
    const { x, y, radius, palette } = request;
    const count = Math.max(48, Math.ceil(radius * 1.05));
    this.spawnBurst(GpuVfxEffectId.ExplosionTrainChunk, count, (spec) => {
      const point = this.randomPointInCircle(Math.max(6, radius * 0.24));
      const speed = Phaser.Math.FloatBetween(radius * 0.42, radius * 2.15);
      const angle = Phaser.Math.FloatBetween(0, TWO_PI);
      this.configure(spec, {
        x: x + point.x,
        y: y + point.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        lifeMs: Phaser.Math.FloatBetween(620, 1450),
        scaleStart: 0.85,
        scaleEnd: 0.04,
        alphaStart: emissiveAlpha(0.96),
        tint: pickGpuVfxTint([palette.hot, palette.body, palette.outer, palette.ember]),
        tintBlendStart: 1,
        tintBlendEnd: 1,
        frame: GpuVfxFrameId.ExplosionChunk,
        yMode: GpuVfxEase.Gravity,
        gravityFactor: 1,
        rotation: Phaser.Math.FloatBetween(0, TWO_PI),
        angularVelocity: Phaser.Math.FloatBetween(-Math.PI, Math.PI),
      });
    });

    const coreCount = Math.max(16, Math.ceil(radius * 0.38));
    this.spawnBurst(GpuVfxEffectId.ExplosionTrainCore, coreCount, (spec) => {
      const angle = Phaser.Math.FloatBetween(0, TWO_PI);
      const speed = Phaser.Math.FloatBetween(radius * 0.28, radius * 1.25);
      this.configure(spec, {
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        lifeMs: Phaser.Math.FloatBetween(320, 860),
        scaleStart: 0.72,
        scaleEnd: 0.04,
        alphaStart: emissiveAlpha(0.84),
        tint: pickGpuVfxTint([palette.hot, palette.body]),
        tintBlendStart: 0.9,
        tintBlendEnd: 1,
        frame: GpuVfxFrameId.ExplosionFireballA,
        yMode: GpuVfxEase.Gravity,
        gravityFactor: 1,
        rotation: Phaser.Math.FloatBetween(0, TWO_PI),
      });
    });
  }

  private spawnNukeImpact(request: ExplosionCombatVisualRequest): void {
    const { x, y, radius, palette } = request;
    const count = Math.max(140, Math.ceil(radius / 1.8));
    this.spawnBurst(GpuVfxEffectId.ExplosionNukePlume, count, (spec, index) => {
      const angle = Phaser.Math.FloatBetween(0, TWO_PI);
      const speed = Phaser.Math.FloatBetween(radius * 0.12, radius * 0.58);
      this.configure(spec, {
        x,
        y: y + radius * 0.03,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - radius * 0.32,
        lifeMs: Phaser.Math.FloatBetween(720, 1450),
        scaleStart: Phaser.Math.FloatBetween(0.65, 1.2),
        scaleEnd: Phaser.Math.FloatBetween(1.4, 2.8),
        scaleEase: GpuVfxEase.QuadOut,
        alphaStart: 0.56,
        tint: pickGpuVfxTint(
          isThermalExplosionStyle(request.style)
            ? [palette.hot, palette.body, palette.outer]
            : [palette.core, palette.hot, palette.body, palette.outer],
        ),
        tintBlendStart: isThermalExplosionStyle(request.style) ? 0.88 : 0,
        tintBlendEnd: 1,
        frame: index % 2 === 0 ? GpuVfxFrameId.ExplosionFireballA : GpuVfxFrameId.ExplosionFireballB,
        yMode: GpuVfxEase.Gravity,
        gravityFactor: 1,
        rotation: Phaser.Math.FloatBetween(0, TWO_PI),
      });
    });
  }

  private spawnNukePlume(request: ExplosionCombatVisualRequest, profile: ExplosionVisualProfile): void {
    const { x, y, radius, palette } = request;
    const count = Math.max(48, Math.ceil(radius / 5));
    this.spawnBurst(GpuVfxEffectId.ExplosionNukePlume, count, (spec, index) => {
      this.configure(spec, {
        x: x + Phaser.Math.FloatBetween(-radius * 0.08, radius * 0.08),
        y: y + radius * 0.06,
        vx: Phaser.Math.FloatBetween(-radius * 0.1, radius * 0.1),
        vy: Phaser.Math.FloatBetween(-radius * 0.95, -radius * 0.35),
        lifeMs: Phaser.Math.FloatBetween(950, 1800) * Math.min(1.2, profile.lifeScale),
        scaleStart: Phaser.Math.FloatBetween(0.8, 1.45),
        scaleEnd: Phaser.Math.FloatBetween(1.8, 3.2),
        scaleEase: GpuVfxEase.QuadOut,
        alphaStart: 0.48,
        tint: pickGpuVfxTint([palette.hot, palette.body, palette.outer, palette.smoke]),
        tintBlendStart: isThermalExplosionStyle(request.style) ? 0.86 : 0.12,
        tintBlendEnd: 1,
        frame: index % 2 === 0 ? GpuVfxFrameId.ExplosionFireballA : GpuVfxFrameId.ExplosionFireballB,
        yMode: GpuVfxEase.Gravity,
        gravityFactor: 1,
        rotation: Phaser.Math.FloatBetween(0, TWO_PI),
      });
    });
  }

  private spawnNukeFallout(request: ExplosionCombatVisualRequest): void {
    const { x, y, radius, palette } = request;
    const count = Math.max(90, Math.ceil(radius / 3.1));
    this.spawnBurst(GpuVfxEffectId.ExplosionNukeFallout, count, (spec) => {
      this.configure(spec, {
        x,
        y: y - radius * 0.1,
        vx: Phaser.Math.FloatBetween(-radius * 0.22, radius * 0.22),
        vy: Phaser.Math.FloatBetween(-radius * 0.3, radius * 0.1),
        lifeMs: Phaser.Math.FloatBetween(1200, 2200),
        scaleStart: Phaser.Math.FloatBetween(0.6, 1.1),
        scaleEnd: Phaser.Math.FloatBetween(1.2, 2.2),
        scaleEase: GpuVfxEase.QuadOut,
        alphaStart: 0.36,
        tint: pickGpuVfxTint([palette.outer, palette.smoke]),
        tintBlendStart: 0.2,
        tintBlendEnd: 1,
        frame: GpuVfxFrameId.ExplosionSmoke,
        yMode: GpuVfxEase.Gravity,
        gravityFactor: 1,
        rotation: Phaser.Math.FloatBetween(0, TWO_PI),
        angularVelocity: Phaser.Math.FloatBetween(-1.8, 1.8),
      });
    });
  }

  private scheduleStage(stage: PendingExplosionStage): void {
    if (this.pendingStages.length < MAX_PENDING_STAGES) {
      this.pendingStages.push(stage);
      return;
    }

    const priority = (kind: PendingStageKind): number => kind === 'smoke' ? 0 : kind === 'secondary' ? 1 : 2;
    const replaceIndex = this.pendingStages.findIndex(
      (candidate) => priority(candidate.kind) < priority(stage.kind),
    );
    if (replaceIndex >= 0) {
      this.recordDroppedStage(this.pendingStages[replaceIndex]);
      this.pendingStages[replaceIndex] = stage;
      return;
    }
    this.recordDroppedStage(stage);
  }

  private advancePendingStages(nowMs: number): void {
    for (let index = this.pendingStages.length - 1; index >= 0; index -= 1) {
      const stage = this.pendingStages[index];
      if (nowMs < stage.dueMs) continue;
      this.pendingStages[index] = this.pendingStages[this.pendingStages.length - 1];
      this.pendingStages.pop();

      if (nowMs > stage.dueMs + STALE_STAGE_GRACE_MS) {
        this.recordDroppedStage(stage);
        continue;
      }

      if (stage.kind === 'secondary') this.spawnSecondary(stage.request);
      else if (stage.kind === 'cascade') this.spawnCascade(stage.request);
      else if (stage.kind === 'shock') this.spawnShockWave(stage.request, getCombatExplosionProfile(stage.request.style)!, stage.wave ?? 1);
      else this.spawnSmoke(stage.request);
    }
  }

  private recordDroppedStage(stage: PendingExplosionStage): void {
    const profile = getCombatExplosionProfile(stage.request.style);
    if (!profile || !this.gpuVfx) return;
    if (stage.kind === 'shock') {
      this.gpuVfx.recordQualityDrop(this.effectFor(stage.request, 'Spark'),
        clamp(Math.round(stage.request.radius / 3.2 * profile.countScale), 12, 56));
      return;
    }
    const effect = stage.kind === 'smoke'
      ? this.effectFor(stage.request, 'Smoke')
      : stage.kind === 'cascade'
        ? this.effectFor(stage.request, 'Cascade')
        : this.effectFor(stage.request, 'Secondary');
    const count = stage.kind === 'smoke'
      ? this.resolveSmokeCount(stage.request.radius, profile)
      : stage.kind === 'cascade'
        ? Math.max(8, Math.ceil(stage.request.radius / 7))
        : Math.max(3, Math.ceil(this.resolveBodyCount(stage.request.radius, profile) * 0.55));
    this.gpuVfx.recordQualityDrop(effect, count);
  }

  private resolveBodyCount(radius: number, profile: ExplosionVisualProfile): number {
    if (profile.family === 'nuke') return clamp(Math.round(radius / 6), 24, 64);
    if (profile.family === 'train') return clamp(Math.round(radius / 5), 12, 36);
    return clamp(Math.round(radius / 8 * profile.countScale), 6, 24);
  }

  private resolveSparkCount(radius: number, profile: ExplosionVisualProfile): number {
    if (profile.family === 'nuke') return clamp(Math.ceil(radius / 1.2), 140, 900);
    if (profile.family === 'train') return Math.max(28, Math.ceil(radius * 0.62));
    return clamp(Math.round(radius / 3 * profile.countScale), 10, 72);
  }

  private resolveChunkCount(radius: number, profile: ExplosionVisualProfile): number {
    if (profile.chunkScale <= 0) return 0;
    if (profile.family === 'nuke') return clamp(Math.ceil(radius / 2.3), 90, 450);
    return clamp(Math.round(radius / 8 * profile.chunkScale), 4, 28);
  }

  private resolveSmokeCount(radius: number, profile: ExplosionVisualProfile): number {
    if (profile.smokeScale <= 0) return 0;
    if (profile.family === 'nuke') return clamp(Math.ceil(radius / 4), 48, 160);
    if (profile.family === 'train') return clamp(Math.round(radius / 6), 8, 36);
    return clamp(Math.round(radius / 10 * profile.smokeScale), 3, 20);
  }

  private effectFor(request: ExplosionCombatVisualRequest, part: keyof typeof EXPLOSION_LAYER_EFFECTS.ordinary): GpuVfxEffectIdType {
    return EXPLOSION_LAYER_EFFECTS[getCombatExplosionProfile(request.style)!.layering][part];
  }

  private spawnBurst(
    effect: GpuVfxEffectIdType,
    count: number,
    configure: (spec: GpuVfxSpawnSpec, index: number, amount: number) => void,
  ): void {
    const system = this.gpuVfx;
    const spec = this.specs.get(effect);
    if (!system || !spec || count <= 0) return;

    const amount = system.quality.scaleBurst(effect, count);
    if (amount < count) system.recordQualityDrop(effect, count - amount);
    const nowMs = system.now();
    for (let index = 0; index < amount; index += 1) {
      configure(spec, index, amount);
      system.spawn(spec, GPU_VFX_NO_SOURCE_HANDLE, nowMs);
    }
  }

  private configure(spec: GpuVfxSpawnSpec, setup: ParticleSetup): void {
    spec.frame = setup.frame ?? GPU_VFX_EFFECTS[spec.effect].frame;
    spec.x = setup.x;
    spec.y = setup.y;
    spec.vx = setup.vx;
    spec.vy = setup.vy;
    spec.positionEase = setup.positionEase ?? GpuVfxEase.Linear;
    spec.yMode = setup.yMode ?? GpuVfxEase.Linear;
    spec.gravityFactor = setup.gravityFactor ?? 1;
    spec.rotation = setup.rotation ?? 0;
    spec.angularVelocity = setup.angularVelocity ?? 0;
    spec.lifeMs = setup.lifeMs;
    spec.scaleStart = setup.scaleStart;
    spec.scaleEnd = setup.scaleEnd;
    spec.scaleEase = setup.scaleEase ?? GpuVfxEase.Linear;
    spec.stretchStart = setup.stretchStart ?? 1;
    spec.stretchEnd = setup.stretchEnd ?? 1;
    spec.alphaStart = setup.alphaStart;
    spec.alphaEnd = setup.alphaEnd ?? 0;
    spec.alphaEase = setup.alphaEase ?? GpuVfxEase.Linear;
    spec.tint = setup.tint;
    spec.tintBlendStart = setup.tintBlendStart ?? 1;
    spec.tintBlendEnd = setup.tintBlendEnd ?? 1;
  }

  private randomPointInCircle(radius: number): { x: number; y: number } {
    const angle = Phaser.Math.FloatBetween(0, TWO_PI);
    const distance = Math.sqrt(Math.random()) * radius;
    return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
  }
}

export function isDestructiveExplosionStyle(style: ExplosionVisualStyle): style is CombatExplosionVisualStyle {
  return getCombatExplosionProfile(style) !== null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
