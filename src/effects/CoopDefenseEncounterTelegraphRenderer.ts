import * as Phaser from 'phaser';
import {
  ARENA_HEIGHT,
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  COLORS,
  DEPTH_FX,
  GAME_HEIGHT,
} from '../config';
import type { CoopDefenseEncounterPresentationState } from '../types';
import { ensureCanvasTexture, killAllAndResetParticlePositions } from './EffectUtils';

const TEX_ENCOUNTER_SPARK = '__coop_defense_encounter_spark';

/**
 * Welt-Telegraph für den nächsten endlichen Encounter.
 *
 * Die Richtung ist hier absichtlich die bestehende Arena-Ecke links. Eine spätere Front-
 * Abstraktion gehört in die Map-/Spawn-Verträge und wird nicht aus diesem Effekt vorweggenommen.
 * Der Effekt liest ausschließlich den host-autoritativ replizierten Präsentationszustand.
 */
export class CoopDefenseEncounterTelegraphRenderer {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private sparks: Phaser.GameObjects.Particles.ParticleEmitter | null = null;

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
      source: new Phaser.Geom.Rectangle(0, -ARENA_HEIGHT / 2, 8, ARENA_HEIGHT),
    } as unknown as Phaser.Types.GameObjects.Particles.EmitZoneData);
    this.sparks.stop();
  }

  sync(
    state: CoopDefenseEncounterPresentationState | null,
    elapsedMs: number,
    inArena: boolean,
  ): void {
    if (!state || !inArena || state.phase === 'rest' || state.phase === 'complete' || !this.sparks) {
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
    const fade = isCleared ? 1 - phaseProgress : 1;
    const pulse = 0.72 + Math.sin(now / (isIncoming ? 105 : 180)) * 0.18;
    const intensity = Phaser.Math.Clamp((isIncoming ? 1 : 0.58) * fade * pulse, 0, 1);
    const color = isIncoming ? COLORS.RED_1 : COLORS.GOLD_1;
    const arenaTop = ARENA_OFFSET_Y + 32;
    const arenaBottom = ARENA_OFFSET_Y + ARENA_HEIGHT - 32;
    const arenaLeft = ARENA_OFFSET_X + 5;
    const worldRayLength = isIncoming ? 150 : 95;

    this.graphics.clear().setVisible(true);
    this.graphics.fillStyle(color, 0.045 * intensity);
    this.graphics.fillRect(arenaLeft, arenaTop, 20, arenaBottom - arenaTop);
    this.graphics.lineStyle(3, color, 0.74 * intensity);
    this.drawLine(arenaLeft, arenaTop, arenaLeft, arenaBottom);

    // Mehrere kurze, nach innen laufende Scanlinien geben die Richtung an, ohne einen
    // einzelnen exakten Spawnpunkt zu behaupten.
    for (let i = 0; i < 7; i += 1) {
      const y = arenaTop + 42 + i * ((arenaBottom - arenaTop - 84) / 6);
      const linePulse = 0.58 + Math.sin(now / 130 + i * 0.75) * 0.28;
      this.graphics.lineStyle(2, color, intensity * linePulse);
      this.drawLine(arenaLeft + 8, y, arenaLeft + worldRayLength * (0.72 + linePulse * 0.28), y);
      this.graphics.lineStyle(2, color, intensity * 0.74 * linePulse);
      this.drawLine(arenaLeft + 32, y - 11, arenaLeft + 20, y);
      this.drawLine(arenaLeft + 20, y, arenaLeft + 32, y + 11);
    }

    // Screen-edge cue: an die sichtbare linke Kante der horizontal scrollenden Kamera gebunden.
    const camera = this.scene.cameras.main;
    const zoom = Math.max(0.1, camera.zoom);
    const cueX = camera.scrollX + 34 / zoom;
    const cueTop = camera.scrollY + 166 / zoom;
    const cueBottom = camera.scrollY + (GAME_HEIGHT - 166) / zoom;
    const cueWidth = 2 / zoom;
    this.graphics.lineStyle(cueWidth, color, 0.55 * intensity);
    this.drawLine(cueX, cueTop, cueX, cueBottom);
    for (let i = 0; i < 4; i += 1) {
      const y = cueTop + 54 / zoom + i * ((cueBottom - cueTop - 108 / zoom) / 3);
      this.graphics.lineStyle(cueWidth, color, 0.8 * intensity);
      this.drawLine(cueX + 18 / zoom, y - 15 / zoom, cueX, y);
      this.drawLine(cueX, y, cueX + 18 / zoom, y + 15 / zoom);
    }

    this.sparks
      .setPosition(arenaLeft + 5, ARENA_OFFSET_Y + ARENA_HEIGHT / 2)
      .setAlpha(Phaser.Math.Clamp(0.35 + intensity * 0.65, 0, 1))
      .setVisible(true);
    if (!this.sparks.emitting) this.sparks.start();
  }

  clear(): void {
    this.graphics.clear().setVisible(false);
    if (!this.sparks) return;
    this.sparks.stop();
    killAllAndResetParticlePositions(this.sparks);
    this.sparks.setVisible(false);
  }

  destroy(): void {
    this.clear();
    this.sparks?.destroy();
    this.sparks = null;
    this.graphics.destroy();
  }

  private drawLine(x1: number, y1: number, x2: number, y2: number): void {
    this.graphics.beginPath();
    this.graphics.moveTo(x1, y1);
    this.graphics.lineTo(x2, y2);
    this.graphics.strokePath();
  }
}
