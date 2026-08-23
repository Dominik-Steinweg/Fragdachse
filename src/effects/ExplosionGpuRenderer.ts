import * as Phaser from 'phaser';
import type { ExplosionVisualStyle } from '../types';
import { emissiveAlpha } from './EmissiveScale';
import {
  FLAME_COLORS_CORE,
  FLAME_COLORS_OUTER,
  FLAME_COLORS_SPARK,
} from './FlameShared';
import {
  getCombatExplosionProfile,
  type CombatExplosionVisualStyle,
  type ExplosionVisualProfile,
} from './ExplosionVisualProfiles';
import { GpuVfxFrameId } from './gpu/GpuVfxAtlas';
import {
  GPU_VFX_EFFECTS,
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
type PendingStageKind = 'secondary' | 'cascade' | 'smoke';

export interface ExplosionCombatPalette {
  readonly core: number;
  readonly hot: number;
  readonly body: number;
  readonly outer: number;
  readonly ember: number;
  readonly smoke: number;
}

export interface ExplosionCombatVisualRequest {
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
  gravityFactor?: number;
  rotation?: number;
  angularVelocity?: number;
  scaleEase?: typeof GpuVfxEase.Linear | typeof GpuVfxEase.QuadOut;
  stretchStart?: number;
  stretchEnd?: number;
  alphaEnd?: number;
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
    const coreEnd = Math.max(coreStart, radius / 50) * profile.bodyScale;
    this.spawnBurst(GpuVfxEffectId.ExplosionBody, 2, (spec, index) => {
      this.configure(spec, {
        x,
        y,
        vx: 0,
        vy: 0,
        lifeMs: coreLife * (index === 0 ? 0.72 : 1),
        scaleStart: coreStart * (index === 0 ? 0.72 : 1),
        scaleEnd: coreEnd * (index === 0 ? 0.72 : 1),
        scaleEase: GpuVfxEase.QuadOut,
        alphaStart: index === 0 ? 0.96 : 0.72,
        tint: index === 0 ? palette.core : palette.hot,
        tintBlendStart: 0,
        tintBlendEnd: 1,
        frame: GpuVfxFrameId.ExplosionCore,
        rotation: Phaser.Math.FloatBetween(0, TWO_PI),
      });
    });

    if (profile.family === 'pop') return;
    const bodyCount = this.resolveBodyCount(radius, profile);
    this.spawnFireballs(GpuVfxEffectId.ExplosionBody, request, profile, bodyCount, 0.72);
  }

  private spawnFireballs(
    effect: GpuVfxEffectIdType,
    request: ExplosionCombatVisualRequest,
    profile: ExplosionVisualProfile,
    count: number,
    alpha: number,
  ): void {
    const { x, y, radius, palette } = request;
    this.spawnBurst(effect, count, (spec, index) => {
      const point = this.randomPointInCircle(radius * 0.16);
      const angle = Math.atan2(point.y, point.x) + Phaser.Math.FloatBetween(-0.55, 0.55);
      const speed = Phaser.Math.FloatBetween(radius * 0.12, radius * 0.42);
      const lifeMs = Phaser.Math.FloatBetween(300, 560) * profile.lifeScale;
      const startScale = Math.max(0.18, radius / 190) * profile.bodyScale;
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
        tint: pickGpuVfxTint([palette.hot, palette.body, palette.outer]),
        tintBlendStart: 0.08,
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
    this.spawnBurst(GpuVfxEffectId.ExplosionShockwave, 1, (spec) => {
      this.configure(spec, {
        x,
        y,
        vx: 0,
        vy: 0,
        lifeMs: profile.family === 'nuke' ? 520 : 360,
        scaleStart: startScale,
        scaleEnd: endScale,
        scaleEase: GpuVfxEase.QuadOut,
        alphaStart: profile.family === 'lightning' ? 0.92 : 0.78,
        tint: palette.hot,
        frame: GpuVfxFrameId.ExplosionRing,
      });
    });
  }

  private spawnStreaks(request: ExplosionCombatVisualRequest, profile: ExplosionVisualProfile): void {
    const { x, y, radius, palette } = request;
    const count = this.resolveSparkCount(radius, profile);
    const effect = profile.family === 'train'
      ? GpuVfxEffectId.ExplosionTrainSpark
      : profile.family === 'lightning'
        ? GpuVfxEffectId.ExplosionLightningSpark
        : GpuVfxEffectId.ExplosionSpark;
    const tints = profile.family === 'train'
      ? [0xffffff, ...FLAME_COLORS_SPARK, palette.body]
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
        tintBlendStart: 0,
        tintBlendEnd: 1,
        frame: GpuVfxFrameId.ExplosionStreak,
        rotation: angle,
        stretchStart: Phaser.Math.FloatBetween(1.4, 2.5),
        stretchEnd: 0.55,
      });
    });
  }

  private spawnChunks(request: ExplosionCombatVisualRequest, profile: ExplosionVisualProfile): void {
    const count = this.resolveChunkCount(request.radius, profile);
    if (count <= 0) return;
    const { x, y, radius, palette } = request;
    const effect = profile.upwardEmbers ? GpuVfxEffectId.ExplosionEmberUp : GpuVfxEffectId.ExplosionEmberDown;
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
        tintBlendStart: 0.05,
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
    this.spawnFireballs(GpuVfxEffectId.ExplosionSecondary, request, profile, count, 0.5);
    if (profile.family === 'nuke') this.spawnNukePlume(request, profile);
  }

  private spawnCascade(request: ExplosionCombatVisualRequest): void {
    const { x, y, radius, palette } = request;
    const count = Math.max(8, Math.ceil(radius / 7));
    this.spawnBurst(GpuVfxEffectId.ExplosionCascade, count, (spec) => {
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
        tint: pickGpuVfxTint([palette.core, palette.hot, palette.body]),
        tintBlendStart: 0,
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
    const count = this.resolveSmokeCount(radius, profile);
    this.spawnBurst(GpuVfxEffectId.ExplosionSmoke, count, (spec) => {
      const point = this.randomPointInCircle(radius * 0.3);
      this.configure(spec, {
        x: x + point.x,
        y: y + point.y,
        vx: Phaser.Math.FloatBetween(-radius * 0.11, radius * 0.11),
        vy: Phaser.Math.FloatBetween(-radius * 0.28, -radius * 0.08),
        lifeMs: Phaser.Math.FloatBetween(900, 1900),
        scaleStart: Math.max(0.2, radius / 190),
        scaleEnd: Math.max(0.5, radius / 72),
        scaleEase: GpuVfxEase.QuadOut,
        alphaStart: profile.family === 'nuke' ? 0.42 : 0.3,
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
        tint: pickGpuVfxTint([0xffffff, ...FLAME_COLORS_CORE, ...FLAME_COLORS_OUTER, palette.body]),
        tintBlendStart: 0,
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
        tint: pickGpuVfxTint([palette.core, palette.hot, palette.body]),
        tintBlendStart: 0,
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
        tint: pickGpuVfxTint([palette.core, palette.hot, palette.body, palette.outer]),
        tintBlendStart: 0,
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
        tintBlendStart: 0.12,
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
      else this.spawnSmoke(stage.request);
    }
  }

  private recordDroppedStage(stage: PendingExplosionStage): void {
    const profile = getCombatExplosionProfile(stage.request.style);
    if (!profile || !this.gpuVfx) return;
    const effect = stage.kind === 'smoke'
      ? GpuVfxEffectId.ExplosionSmoke
      : stage.kind === 'cascade'
        ? GpuVfxEffectId.ExplosionCascade
        : GpuVfxEffectId.ExplosionSecondary;
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
    spec.alphaEase = GpuVfxEase.Linear;
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
