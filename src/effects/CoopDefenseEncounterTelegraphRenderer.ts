import * as Phaser from 'phaser';
import {
  ARENA_HEIGHT,
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  COLORS,
  DEPTH_FX,
} from '../config';
import type { CoopDefenseEncounterPresentationState } from '../types';
import {
  ensureCanvasTexture,
  killAllAndResetParticlePositions,
  setEmitterTintArray,
} from './EffectUtils';

const TEX_ENCOUNTER_SPARK = '__coop_defense_encounter_spark';
const TEX_ENCOUNTER_BAND = '__coop_defense_encounter_band';
const TEX_ENCOUNTER_EDGE = '__coop_defense_encounter_edge';

/** Vertikale Reserve, damit die Front nicht in den Arenarahmen läuft. */
const TELEGRAPH_INSET_Y = 30;
const CHEVRON_ROWS = 7;
/** Weglänge einer Marschmarke, bevor sie wieder an der Kante beginnt. */
const CHEVRON_TRAVEL = 190;
const CHEVRON_START_OFFSET = 16;
const CHEVRON_HALF_H = 11;
const CHEVRON_LENGTH = 15;
const CHEVRON_THICKNESS = 5;

interface TelegraphProfile {
  readonly color: number;
  /** Breite des einlaufenden Lichtbands in Weltpixeln. */
  readonly bandWidth: number;
  /** Marschgeschwindigkeit der Richtungsmarken in Weltpixeln pro Sekunde. */
  readonly chevronSpeed: number;
  readonly chevronsPerRow: number;
  readonly intensity: number;
  readonly sparkFrequency: number;
  readonly sparkTints: readonly number[];
}

const PROFILE_INCOMING: TelegraphProfile = {
  color: COLORS.RED_1,
  bandWidth: 152,
  chevronSpeed: 118,
  chevronsPerRow: 2,
  intensity: 1,
  sparkFrequency: 55,
  sparkTints: [0xffffff, COLORS.GOLD_1, COLORS.RED_1],
};
/**
 * Während des laufenden Angriffs bleibt nur eine ruhige Richtungsangabe stehen. Die volle
 * Warnstärke gehört der Ankündigung; neben Gegnern und Kampfeffekten wäre sie nur Rauschen.
 */
const PROFILE_ACTIVE: TelegraphProfile = {
  color: COLORS.GOLD_1,
  bandWidth: 94,
  chevronSpeed: 62,
  chevronsPerRow: 1,
  intensity: 0.44,
  sparkFrequency: 150,
  sparkTints: [0xffffff, COLORS.GOLD_1, COLORS.GOLD_3],
};
/** Abklingende Front nach dem Clear – dieselbe Grüntönung wie im HUD-Panel. */
const PROFILE_CLEARED: TelegraphProfile = {
  color: COLORS.GREEN_2,
  bandWidth: 94,
  chevronSpeed: 38,
  chevronsPerRow: 1,
  intensity: 0.55,
  sparkFrequency: 220,
  sparkTints: [0xffffff, COLORS.GREEN_1, COLORS.GREEN_3],
};

/**
 * Welt-Telegraph für den nächsten endlichen Encounter.
 *
 * Die Richtung ist hier absichtlich die bestehende Arena-Ecke links. Eine spätere Front-
 * Abstraktion gehört in die Map-/Spawn-Verträge und wird nicht aus diesem Effekt vorweggenommen.
 * Der Effekt liest ausschließlich den host-autoritativ replizierten Präsentationszustand.
 *
 * Gezeichnet wird genau **eine** Front: Sie steht an der Arenakante und wird an den sichtbaren
 * Bildrand geklemmt, sobald die Kante aus dem Bild gescrollt ist. Ein zweiter, bildschirmfester
 * Hinweis daneben verdoppelte bei nicht gescrollter Kamera nur dieselbe Aussage.
 */
export class CoopDefenseEncounterTelegraphRenderer {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private band: Phaser.GameObjects.Image | null = null;
  private edge: Phaser.GameObjects.Image | null = null;
  private sparks: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private activeProfile: TelegraphProfile | null = null;
  private readonly chevronPoints: Phaser.Math.Vector2[] = Array.from(
    { length: 6 },
    () => new Phaser.Math.Vector2(0, 0),
  );

  constructor(private readonly scene: Phaser.Scene) {
    this.graphics = scene.add.graphics()
      .setDepth(DEPTH_FX)
      // Dieser Telegraph muss auch bei hellem Tagesboden lesbar bleiben.
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
  }

  generateTextures(): void {
    ensureCanvasTexture(this.scene.textures, TEX_ENCOUNTER_SPARK, 12, 12, (ctx) => {
      const center = 6;
      const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.35, 'rgba(255,208,112,0.85)');
      gradient.addColorStop(1, 'rgba(255,90,24,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 12, 12);
    });

    // Band und Kantenschein tragen ihren vertikalen Auslauf in der Textur. Gestreckt bleibt
    // der Anteil dadurch proportional, und die Front endet oben und unten weich statt mit
    // einer harten Linie quer durch die Arena.
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

    this.band ??= this.scene.add.image(0, 0, TEX_ENCOUNTER_BAND)
      .setOrigin(0, 0.5)
      .setDepth(DEPTH_FX - 0.2)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
    this.edge ??= this.scene.add.image(0, 0, TEX_ENCOUNTER_EDGE)
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH_FX - 0.1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);

    if (this.sparks) return;
    this.sparks = this.scene.add.particles(0, 0, TEX_ENCOUNTER_SPARK, {
      lifespan: { min: 320, max: 720 },
      frequency: 90,
      quantity: 1,
      speedX: { min: 42, max: 110 },
      speedY: { min: -24, max: 24 },
      scale: { start: 0.62, end: 0.08 },
      alpha: { start: 0.78, end: 0 },
      tint: [0xffffff, COLORS.GOLD_1, COLORS.RED_1],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    this.sparks
      .setDepth(DEPTH_FX + 0.1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
    this.sparks.addEmitZone({
      type: 'random',
      source: new Phaser.Geom.Rectangle(0, -ARENA_HEIGHT / 2 + TELEGRAPH_INSET_Y, 8, ARENA_HEIGHT - TELEGRAPH_INSET_Y * 2),
    } as unknown as Phaser.Types.GameObjects.Particles.EmitZoneData);
    this.sparks.stop();
  }

  sync(
    state: CoopDefenseEncounterPresentationState | null,
    elapsedMs: number,
    inArena: boolean,
  ): void {
    if (
      !state
      || !inArena
      || state.phase === 'rest'
      || state.phase === 'complete'
      || !this.sparks
      || !this.band
      || !this.edge
    ) {
      this.clear();
      return;
    }

    const now = Number.isFinite(elapsedMs) ? elapsedMs : 0;
    const phaseProgress = state.phaseEndsAtMs === null
      ? 1
      : Phaser.Math.Clamp(
        (now - state.phaseStartedAtMs) / Math.max(1, state.phaseEndsAtMs - state.phaseStartedAtMs),
        0,
        1,
      );
    const isIncoming = state.phase === 'incoming';
    const isCleared = state.phase === 'cleared';
    const profile = isIncoming ? PROFILE_INCOMING : isCleared ? PROFILE_CLEARED : PROFILE_ACTIVE;
    // Die abgewehrte Front verlischt über ihre Haltezeit, statt schlagartig zu verschwinden.
    const fade = isCleared ? 1 - phaseProgress : 1;
    const pulse = 0.78 + Math.sin(now / (isIncoming ? 115 : 210)) * 0.16;
    const intensity = Phaser.Math.Clamp(profile.intensity * fade * pulse, 0, 1);
    if (intensity <= 0.02) {
      this.clear();
      return;
    }

    const top = ARENA_OFFSET_Y + TELEGRAPH_INSET_Y;
    const bottom = ARENA_OFFSET_Y + ARENA_HEIGHT - TELEGRAPH_INSET_Y;
    const height = bottom - top;
    const centerY = (top + bottom) / 2;
    // Die Front bleibt an der Arenakante, wird aber in den sichtbaren Ausschnitt geklemmt.
    // Ohne die Klemmung stünde bei gescrollter Kamera gar kein Hinweis mehr im Bild.
    const camera = this.scene.cameras.main;
    const zoom = Math.max(0.1, camera.zoom);
    const anchorX = Math.max(ARENA_OFFSET_X + 5, camera.scrollX + 6 / zoom);

    this.band
      .setPosition(anchorX, centerY)
      .setDisplaySize(profile.bandWidth, height)
      .setTint(profile.color)
      .setAlpha(Phaser.Math.Clamp(0.62 * intensity, 0, 1))
      .setVisible(true);
    this.edge
      .setPosition(anchorX, centerY)
      .setDisplaySize(26, height)
      .setTint(profile.color)
      .setAlpha(Phaser.Math.Clamp(0.85 * intensity, 0, 1))
      .setVisible(true);

    this.drawChevrons(anchorX, top, height, now, profile, intensity);

    this.sparks
      .setPosition(anchorX + 4, centerY)
      // Die Funken folgen der Intensität bis auf null, damit die abklingende Front nicht mit
      // einem harten Schnitt endet, wenn der Effekt sich abschaltet.
      .setAlpha(Phaser.Math.Clamp(intensity * 1.1, 0, 1))
      .setVisible(true);
    this.sparks.frequency = profile.sparkFrequency;
    // Array-Tints muessen ueber loadConfig neu gebunden werden; `setParticleTint` allein
    // erreicht die Emit-Methode nicht (siehe `setEmitterTintArray`).
    if (profile !== this.activeProfile) {
      setEmitterTintArray(this.sparks, [...profile.sparkTints]);
      this.activeProfile = profile;
    }
    if (!this.sparks.emitting) this.sparks.start();
  }

  clear(): void {
    this.graphics.clear().setVisible(false);
    this.band?.setVisible(false);
    this.edge?.setVisible(false);
    if (!this.sparks) return;
    this.sparks.stop();
    killAllAndResetParticlePositions(this.sparks);
    this.sparks.setVisible(false);
  }

  destroy(): void {
    this.clear();
    this.sparks?.destroy();
    this.sparks = null;
    this.activeProfile = null;
    this.band?.destroy();
    this.band = null;
    this.edge?.destroy();
    this.edge = null;
    this.graphics.destroy();
  }

  /**
   * Nach innen marschierende Richtungsmarken. Sie geben die Anmarschrichtung an, ohne einen
   * einzelnen exakten Spawnpunkt zu behaupten: Position, Deckkraft und Größe leiten sich
   * allein aus dem Weganteil ab, deshalb erscheinen und verlöschen sie weich.
   */
  private drawChevrons(
    anchorX: number,
    top: number,
    height: number,
    now: number,
    profile: TelegraphProfile,
    intensity: number,
  ): void {
    this.graphics.clear().setVisible(true);
    const rowSpacing = height / CHEVRON_ROWS;
    const travelPhase = (now / 1000) * profile.chevronSpeed;

    for (let row = 0; row < CHEVRON_ROWS; row += 1) {
      const y = top + rowSpacing * (row + 0.5);
      // Äußere Reihen laufen schwächer, damit die Front zu den Rändern hin ausläuft.
      const rowEnvelope = 0.55 + Math.sin(Math.PI * ((row + 0.5) / CHEVRON_ROWS)) * 0.45;
      for (let index = 0; index < profile.chevronsPerRow; index += 1) {
        const offset = (row * 41 + index * (CHEVRON_TRAVEL / profile.chevronsPerRow)) % CHEVRON_TRAVEL;
        const travelled = (travelPhase + offset) % CHEVRON_TRAVEL;
        const progress = travelled / CHEVRON_TRAVEL;
        const alpha = intensity * rowEnvelope * Math.sin(Math.PI * progress);
        if (alpha <= 0.02) continue;
        const scale = 0.72 + (1 - progress) * 0.38;
        this.graphics.fillStyle(profile.color, alpha);
        this.graphics.fillPoints(
          this.buildChevron(anchorX + CHEVRON_START_OFFSET + travelled, y, scale),
          true,
        );
      }
    }

    // Harte Kernlinie direkt auf der Kante: Sie hält die Front auch dann ablesbar, wenn der
    // additive Schein über hellem Boden flach wird.
    this.graphics.lineStyle(2.5, profile.color, Phaser.Math.Clamp(0.8 * intensity, 0, 1));
    this.graphics.beginPath();
    this.graphics.moveTo(anchorX, top);
    this.graphics.lineTo(anchorX, top + height);
    this.graphics.strokePath();
  }

  /** Füllt den wiederverwendeten Punktpuffer mit einem nach rechts zeigenden Chevron. */
  private buildChevron(x: number, y: number, scale: number): Phaser.Math.Vector2[] {
    const halfH = CHEVRON_HALF_H * scale;
    const length = CHEVRON_LENGTH * scale;
    const thickness = CHEVRON_THICKNESS * scale;
    const points = this.chevronPoints;
    points[0].set(x, y - halfH);
    points[1].set(x + length, y);
    points[2].set(x, y + halfH);
    points[3].set(x - thickness, y + halfH);
    points[4].set(x + length - thickness, y);
    points[5].set(x - thickness, y - halfH);
    return points;
  }
}

/** Blendet eine Canvas-Textur an ihrer Ober- und Unterkante weich aus. */
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
