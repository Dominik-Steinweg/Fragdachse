import * as Phaser from 'phaser';
import {
  ARENA_HEIGHT,
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  ARENA_WIDTH,
  COLORS,
  DEPTH_FX,
} from '../config';
import type { CoopDefenseEncounterPresentationState, SpawnFront } from '../types';
import {
  ensureCanvasTexture,
  killAllAndResetParticlePositions,
  setEmitterTintArray,
} from './EffectUtils';

const TEX_ENCOUNTER_SPARK = '__coop_defense_encounter_spark';
const TEX_ENCOUNTER_BAND = '__coop_defense_encounter_band';
const TEX_ENCOUNTER_EDGE = '__coop_defense_encounter_edge';

/** Vertikale Reserve, damit die Front nicht in den Arenarahmen läuft. */
const TELEGRAPH_INSET = 30;
const CHEVRON_ROWS = 7;
/** Weglänge einer Marschmarke, bevor sie wieder an der Kante beginnt. */
const CHEVRON_TRAVEL = 190;
const CHEVRON_START_OFFSET = 16;
const CHEVRON_HALF_H = 11;
const CHEVRON_LENGTH = 15;
const CHEVRON_THICKNESS = 5;
const SPAWN_COMPLETE_FADE_MS = 4_200;

interface TelegraphProfile {
  readonly color: number;
  readonly bandWidth: number;
  readonly chevronSpeed: number;
  readonly chevronsPerRow: number;
  readonly intensity: number;
  readonly sparkFrequency: number;
  readonly sparkTints: readonly number[];
}

interface TelegraphFrontVisual {
  readonly band: Phaser.GameObjects.Image;
  readonly edge: Phaser.GameObjects.Image;
  readonly sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  readonly sparkEmitZone: Phaser.Geom.Rectangle;
}

const PROFILE_INCOMING: TelegraphProfile = {
  color: COLORS.PURPLE_1,
  bandWidth: 152,
  chevronSpeed: 118,
  chevronsPerRow: 2,
  intensity: 1,
  sparkFrequency: 55,
  sparkTints: [0xffffff, COLORS.PURPLE_1, COLORS.PURPLE_3],
};
const PROFILE_ACTIVE: TelegraphProfile = {
  color: COLORS.PURPLE_2,
  bandWidth: 94,
  chevronSpeed: 62,
  chevronsPerRow: 1,
  intensity: 0.44,
  sparkFrequency: 150,
  sparkTints: [0xffffff, COLORS.PURPLE_1, COLORS.PURPLE_3],
};
const PROFILE_REST: TelegraphProfile = {
  color: COLORS.PURPLE_2,
  bandWidth: 70,
  chevronSpeed: 28,
  chevronsPerRow: 1,
  intensity: 0.22,
  sparkFrequency: 320,
  sparkTints: [0xffffff, COLORS.PURPLE_1, COLORS.PURPLE_3],
};
const PROFILE_CLEARED: TelegraphProfile = {
  color: COLORS.GREEN_2,
  bandWidth: 94,
  chevronSpeed: 38,
  chevronsPerRow: 1,
  intensity: 0.55,
  sparkFrequency: 220,
  sparkTints: [0xffffff, COLORS.GREEN_1, COLORS.GREEN_3],
};

/** Welt-Telegraph für den host-autoritativ replizierten Encounter-Zustand. */
export class CoopDefenseEncounterTelegraphRenderer {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly visuals = new Map<SpawnFront, TelegraphFrontVisual>();
  private activeProfile: TelegraphProfile | null = null;
  private lastEncounterId: string | null = null;
  private spawnCompleteFadeStartedAtMs: number | null = null;
  private readonly chevronPoints: Phaser.Math.Vector2[] = Array.from(
    { length: 6 },
    () => new Phaser.Math.Vector2(0, 0),
  );

  constructor(private readonly scene: Phaser.Scene) {
    this.graphics = scene.add.graphics()
      .setDepth(DEPTH_FX)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
  }

  generateTextures(): void {
    ensureCanvasTexture(this.scene.textures, TEX_ENCOUNTER_SPARK, 12, 12, (ctx) => {
      const center = 6;
      const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.35, 'rgba(232,210,255,0.85)');
      gradient.addColorStop(1, 'rgba(174,88,220,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 12, 12);
    });

    ensureCanvasTexture(this.scene.textures, TEX_ENCOUNTER_BAND, 64, 64, (ctx) => {
      const horizontal = ctx.createLinearGradient(0, 0, 64, 0);
      horizontal.addColorStop(0, 'rgba(255,255,255,0.9)');
      horizontal.addColorStop(0.16, 'rgba(255,255,255,0.42)');
      horizontal.addColorStop(0.55, 'rgba(255,255,255,0.12)');
      horizontal.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = horizontal;
      ctx.fillRect(0, 0, 64, 64);
      applyVerticalFalloff(ctx, 64, 64);
    });

    ensureCanvasTexture(this.scene.textures, TEX_ENCOUNTER_EDGE, 32, 64, (ctx) => {
      const horizontal = ctx.createLinearGradient(0, 0, 32, 0);
      horizontal.addColorStop(0, 'rgba(255,255,255,0)');
      horizontal.addColorStop(0.42, 'rgba(255,255,255,0.55)');
      horizontal.addColorStop(0.5, 'rgba(255,255,255,1)');
      horizontal.addColorStop(0.58, 'rgba(255,255,255,0.55)');
      horizontal.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = horizontal;
      ctx.fillRect(0, 0, 32, 64);
      applyVerticalFalloff(ctx, 32, 64);
    });

    for (const front of ['west', 'north', 'east', 'south'] as const) {
      if (this.visuals.has(front)) continue;
      const band = this.scene.add.image(0, 0, TEX_ENCOUNTER_BAND)
        .setOrigin(0, 0.5)
        .setDepth(DEPTH_FX - 0.2)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setVisible(false);
      const edge = this.scene.add.image(0, 0, TEX_ENCOUNTER_EDGE)
        .setOrigin(0.5, 0.5)
        .setDepth(DEPTH_FX - 0.1)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setVisible(false);
      const sparkEmitZone = front === 'west' || front === 'east'
        ? new Phaser.Geom.Rectangle(0, -ARENA_HEIGHT / 2 + TELEGRAPH_INSET, 8, ARENA_HEIGHT - TELEGRAPH_INSET * 2)
        : new Phaser.Geom.Rectangle(-ARENA_WIDTH / 2 + TELEGRAPH_INSET, 0, ARENA_WIDTH - TELEGRAPH_INSET * 2, 8);
      const sparks = this.scene.add.particles(0, 0, TEX_ENCOUNTER_SPARK, {
        lifespan: { min: 320, max: 720 },
        frequency: 90,
        quantity: 1,
        speedX: this.getSparkSpeedX(front),
        speedY: this.getSparkSpeedY(front),
        scale: { start: 0.62, end: 0.08 },
        alpha: { start: 0.78, end: 0 },
        tint: [0xffffff, COLORS.PURPLE_1, COLORS.PURPLE_3],
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
      });
      sparks
        .setDepth(DEPTH_FX + 0.1)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setVisible(false);
      sparks.addEmitZone({
        type: 'random',
        source: sparkEmitZone,
      } as unknown as Phaser.Types.GameObjects.Particles.EmitZoneData);
      sparks.stop();
      this.visuals.set(front, { band, edge, sparks, sparkEmitZone });
    }
  }

  sync(
    state: CoopDefenseEncounterPresentationState | null,
    elapsedMs: number,
    inArena: boolean,
  ): void {
    if (!state || !inArena || state.phase === 'complete' || this.visuals.size === 0) {
      if (!state || !inArena) {
        this.lastEncounterId = null;
        this.spawnCompleteFadeStartedAtMs = null;
      }
      this.clear();
      return;
    }

    const fronts = state.fronts?.length > 0 ? state.fronts : ['west'] as const;
    const now = Number.isFinite(elapsedMs) ? elapsedMs : 0;
    if (state.encounterId !== this.lastEncounterId) {
      this.lastEncounterId = state.encounterId;
      this.spawnCompleteFadeStartedAtMs = null;
    }
    if (state.phase === 'active' && state.spawnComplete === true) {
      this.spawnCompleteFadeStartedAtMs ??= now;
    } else {
      this.spawnCompleteFadeStartedAtMs = null;
    }
    const phaseProgress = state.phaseEndsAtMs === null
      ? 1
      : Phaser.Math.Clamp(
        (now - state.phaseStartedAtMs) / Math.max(1, state.phaseEndsAtMs - state.phaseStartedAtMs),
        0,
        1,
      );
    const isIncoming = state.phase === 'incoming';
    const isCleared = state.phase === 'cleared';
    const isRest = state.phase === 'rest';
    const profile = isIncoming
      ? PROFILE_INCOMING
      : isCleared
        ? PROFILE_CLEARED
        : isRest
          ? PROFILE_REST
          : PROFILE_ACTIVE;
    const spawnCompleteFade = this.spawnCompleteFadeStartedAtMs === null
      ? 1
      : 1 - Phaser.Math.Clamp((now - this.spawnCompleteFadeStartedAtMs) / SPAWN_COMPLETE_FADE_MS, 0, 1);
    const fade = isCleared ? 1 - phaseProgress : spawnCompleteFade;
    const restRamp = isRest ? 0.7 + phaseProgress * 0.3 : 1;
    const pulse = 0.78 + Math.sin(now / (isIncoming ? 115 : 210)) * 0.16;
    const intensity = Phaser.Math.Clamp(profile.intensity * fade * restRamp * pulse, 0, 1);
    if (intensity <= 0.02) {
      this.clear();
      return;
    }

    this.graphics.clear().setVisible(true);
    const camera = this.scene.cameras.main;
    const zoom = Math.max(0.1, camera.zoom);
    const visibleLeft = camera.scrollX + 6 / zoom;
    const visibleRight = camera.scrollX + camera.width / zoom - 6 / zoom;
    const visibleTop = camera.scrollY + 6 / zoom;
    const visibleBottom = camera.scrollY + camera.height / zoom - 6 / zoom;
    const top = ARENA_OFFSET_Y + TELEGRAPH_INSET;
    const bottom = ARENA_OFFSET_Y + ARENA_HEIGHT - TELEGRAPH_INSET;
    const left = ARENA_OFFSET_X + 5;
    const right = ARENA_OFFSET_X + ARENA_WIDTH - 5;

    for (const [front, visual] of this.visuals) {
      if (!fronts.includes(front)) {
        this.hideVisual(visual);
        continue;
      }
      const layout = this.getFrontLayout(front, left, right, top, bottom, visibleLeft, visibleRight, visibleTop, visibleBottom);
      visual.band
        .setOrigin(layout.bandOriginX, 0.5)
        .setPosition(layout.bandX, layout.bandY)
        .setRotation(layout.rotation)
        .setFlipX(layout.flipX)
        .setDisplaySize(profile.bandWidth, layout.bandHeight)
        .setTint(profile.color)
        .setAlpha(Phaser.Math.Clamp(0.62 * intensity, 0, 1))
        .setVisible(true);
      visual.edge
        .setPosition(layout.edgeX, layout.edgeY)
        .setRotation(layout.rotation)
        .setDisplaySize(layout.edgeWidth, layout.edgeHeight)
        .setTint(profile.color)
        .setAlpha(Phaser.Math.Clamp(0.85 * intensity, 0, 1))
        .setVisible(true);

      this.drawChevrons(front, layout, now, profile, intensity);

      visual.sparks
        .setPosition(layout.sparkX, layout.sparkY)
        .setAlpha(Phaser.Math.Clamp(intensity * 1.1, 0, 1))
        .setVisible(true);
      visual.sparks.frequency = profile.sparkFrequency;
      if (profile !== this.activeProfile) {
        setEmitterTintArray(visual.sparks, [...profile.sparkTints]);
      }
      if (!visual.sparks.emitting) visual.sparks.start();
    }
    this.activeProfile = profile;
  }

  clear(): void {
    this.graphics.clear().setVisible(false);
    for (const visual of this.visuals.values()) this.hideVisual(visual);
  }

  destroy(): void {
    this.clear();
    for (const visual of this.visuals.values()) {
      visual.sparks.destroy();
      visual.band.destroy();
      visual.edge.destroy();
    }
    this.visuals.clear();
    this.activeProfile = null;
    this.lastEncounterId = null;
    this.spawnCompleteFadeStartedAtMs = null;
    this.graphics.destroy();
  }

  private hideVisual(visual: TelegraphFrontVisual): void {
    visual.band.setVisible(false);
    visual.edge.setVisible(false);
    visual.sparks.stop();
    killAllAndResetParticlePositions(visual.sparks);
    visual.sparks.setVisible(false);
  }

  private getFrontLayout(
    front: SpawnFront,
    left: number,
    right: number,
    top: number,
    bottom: number,
    visibleLeft: number,
    visibleRight: number,
    visibleTop: number,
    visibleBottom: number,
  ) {
    const centerX = (left + right) / 2;
    const centerY = (top + bottom) / 2;
    if (front === 'west') {
      const anchor = Math.max(left, visibleLeft);
      return {
        bandX: anchor, bandY: centerY, bandWidth: PROFILE_INCOMING.bandWidth, bandHeight: bottom - top,
        bandOriginX: 0, edgeX: anchor, edgeY: centerY, edgeWidth: 26, edgeHeight: bottom - top,
        sparkX: anchor + 4, sparkY: centerY, rotation: 0, flipX: false,
        spanStart: top, spanLength: bottom - top, boundary: anchor,
      };
    }
    if (front === 'east') {
      const anchor = Math.min(right, visibleRight);
      return {
        bandX: anchor, bandY: centerY, bandWidth: PROFILE_INCOMING.bandWidth, bandHeight: bottom - top,
        bandOriginX: 1, edgeX: anchor, edgeY: centerY, edgeWidth: 26, edgeHeight: bottom - top,
        sparkX: anchor - 4, sparkY: centerY, rotation: 0, flipX: true,
        spanStart: top, spanLength: bottom - top, boundary: anchor,
      };
    }
    if (front === 'north') {
      const anchor = Math.max(top, visibleTop);
      return {
        bandX: centerX, bandY: anchor, bandWidth: PROFILE_INCOMING.bandWidth, bandHeight: bottom - top,
        bandOriginX: 0, edgeX: centerX, edgeY: anchor, edgeWidth: bottom - top, edgeHeight: 26,
        sparkX: centerX, sparkY: anchor + 4, rotation: Math.PI / 2, flipX: false,
        spanStart: left, spanLength: right - left, boundary: anchor,
      };
    }
    const anchor = Math.min(bottom, visibleBottom);
    return {
      bandX: centerX, bandY: anchor, bandWidth: PROFILE_INCOMING.bandWidth, bandHeight: bottom - top,
      bandOriginX: 0, edgeX: centerX, edgeY: anchor, edgeWidth: bottom - top, edgeHeight: 26,
      sparkX: centerX, sparkY: anchor - 4, rotation: -Math.PI / 2, flipX: false,
      spanStart: left, spanLength: right - left, boundary: anchor,
    };
  }

  private drawChevrons(
    front: SpawnFront,
    layout: ReturnType<CoopDefenseEncounterTelegraphRenderer['getFrontLayout']>,
    now: number,
    profile: TelegraphProfile,
    intensity: number,
  ): void {
    const rowSpacing = layout.spanLength / CHEVRON_ROWS;
    const travelPhase = (now / 1000) * profile.chevronSpeed;
    const inwardSign = front === 'west' || front === 'north' ? 1 : -1;

    for (let row = 0; row < CHEVRON_ROWS; row += 1) {
      const cross = layout.spanStart + rowSpacing * (row + 0.5);
      const rowEnvelope = 0.55 + Math.sin(Math.PI * ((row + 0.5) / CHEVRON_ROWS)) * 0.45;
      for (let index = 0; index < profile.chevronsPerRow; index += 1) {
        const offset = (row * 41 + index * (CHEVRON_TRAVEL / profile.chevronsPerRow)) % CHEVRON_TRAVEL;
        const travelled = (travelPhase + offset) % CHEVRON_TRAVEL;
        const progress = travelled / CHEVRON_TRAVEL;
        const alpha = intensity * rowEnvelope * Math.sin(Math.PI * progress);
        if (alpha <= 0.02) continue;
        const scale = 0.72 + (1 - progress) * 0.38;
        const distance = CHEVRON_START_OFFSET + travelled * inwardSign;
        const x = front === 'west' || front === 'east' ? layout.boundary + distance : cross;
        const y = front === 'north' || front === 'south' ? layout.boundary + distance : cross;
        this.graphics.fillStyle(profile.color, alpha);
        this.graphics.fillPoints(this.buildChevron(front, x, y, scale), true);
      }
    }

    this.graphics.lineStyle(2.5, profile.color, Phaser.Math.Clamp(0.8 * intensity, 0, 1));
    this.graphics.beginPath();
    if (front === 'west' || front === 'east') {
      this.graphics.moveTo(layout.boundary, layout.spanStart);
      this.graphics.lineTo(layout.boundary, layout.spanStart + layout.spanLength);
    } else {
      this.graphics.moveTo(layout.spanStart, layout.boundary);
      this.graphics.lineTo(layout.spanStart + layout.spanLength, layout.boundary);
    }
    this.graphics.strokePath();
  }

  private buildChevron(front: SpawnFront, x: number, y: number, scale: number): Phaser.Math.Vector2[] {
    const halfH = CHEVRON_HALF_H * scale;
    const length = CHEVRON_LENGTH * scale;
    const thickness = CHEVRON_THICKNESS * scale;
    const points = this.chevronPoints;
    if (front === 'west') {
      points[0].set(x, y - halfH); points[1].set(x + length, y); points[2].set(x, y + halfH);
      points[3].set(x - thickness, y + halfH); points[4].set(x + length - thickness, y); points[5].set(x - thickness, y - halfH);
    } else if (front === 'east') {
      points[0].set(x, y - halfH); points[1].set(x - length, y); points[2].set(x, y + halfH);
      points[3].set(x + thickness, y + halfH); points[4].set(x - length + thickness, y); points[5].set(x + thickness, y - halfH);
    } else if (front === 'north') {
      points[0].set(x - halfH, y); points[1].set(x, y + length); points[2].set(x + halfH, y);
      points[3].set(x + halfH, y - thickness); points[4].set(x, y + length - thickness); points[5].set(x - halfH, y - thickness);
    } else {
      points[0].set(x - halfH, y); points[1].set(x, y - length); points[2].set(x + halfH, y);
      points[3].set(x + halfH, y + thickness); points[4].set(x, y - length + thickness); points[5].set(x - halfH, y + thickness);
    }
    return points;
  }

  private getSparkSpeedX(front: SpawnFront) {
    if (front === 'west') return { min: 42, max: 110 };
    if (front === 'east') return { min: -110, max: -42 };
    return { min: -24, max: 24 };
  }

  private getSparkSpeedY(front: SpawnFront) {
    if (front === 'north') return { min: 42, max: 110 };
    if (front === 'south') return { min: -110, max: -42 };
    return { min: -24, max: 24 };
  }
}

function applyVerticalFalloff(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const previousOperation = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'destination-in';
  const vertical = ctx.createLinearGradient(0, 0, 0, height);
  vertical.addColorStop(0, 'rgba(0,0,0,0)');
  vertical.addColorStop(0.16, 'rgba(0,0,0,1)');
  vertical.addColorStop(0.84, 'rgba(0,0,0,1)');
  vertical.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = previousOperation;
}
