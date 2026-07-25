import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { ensureCanvasTexture } from './EffectUtils';

const TEX_CORPSE_CROSS = '__corpse_cross';
const TEX_CORPSE_CROSS_SHADOW = '__corpse_cross_shadow';

/** Kantenlänge der Kreuz-Textur; die Weltgröße entsteht erst über die Skalierung. */
const TEXTURE_SIZE = 64;
/** Bezugsgröße eines Gegners, bei der das Kreuz seine Grundgröße erreicht. */
const REFERENCE_ENEMY_SIZE = 32;
const BASE_WORLD_SIZE = 22;
const MIN_WORLD_SIZE = 12;
const MAX_WORLD_SIZE = 84;

const APPEAR_MS = 140;
const FADE_MS = 900;
const CROSS_ALPHA = 0.92;
const SHADOW_ALPHA = 0.3;

/** Leichen liegen unter Spielern und Gegnern, aber über Boden-Decals und Blutflecken. */
const DEPTH_CORPSE_CROSS = DEPTH.PLAYERS - 0.04;
const DEPTH_CORPSE_CROSS_SHADOW = DEPTH_CORPSE_CROSS - 0.01;

interface CorpseMarkerVisual {
  readonly cross: Phaser.GameObjects.Image;
  readonly shadow: Phaser.GameObjects.Image;
}

/**
 * Zeichnet die von der Nekromantie verwerteten Leichen als kleines braunes Kreuz auf dem Boden.
 * Der Renderer hält keinen Spielzustand: Host und Clients bekommen dieselben Ereignisse und
 * blenden das Kreuz nach Ablauf der Leichenzeit selbst aus.
 */
export class CorpseMarkerRenderer {
  private readonly visuals = new Map<number, CorpseMarkerVisual>();

  constructor(private readonly scene: Phaser.Scene) {
    this.generateTextures();
  }

  generateTextures(): void {
    ensureCanvasTexture(this.scene.textures, TEX_CORPSE_CROSS, TEXTURE_SIZE, TEXTURE_SIZE, (ctx) => {
      drawCross(ctx);
    });
    ensureCanvasTexture(this.scene.textures, TEX_CORPSE_CROSS_SHADOW, TEXTURE_SIZE, TEXTURE_SIZE, (ctx) => {
      ctx.filter = 'blur(3px)';
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      fillCrossPath(ctx);
      ctx.filter = 'none';
    });
  }

  /**
   * @param enemySize Volle Kantenlänge des gestorbenen Gegners – bestimmt die Kreuzgröße.
   * @param lifetimeMs Restlaufzeit der Leiche; das Kreuz fadet am Ende dieser Zeit weg.
   */
  show(corpseId: number, x: number, y: number, enemySize: number, lifetimeMs: number): void {
    this.remove(corpseId);
    if (lifetimeMs <= 0) return;

    const worldSize = Phaser.Math.Clamp(
      BASE_WORLD_SIZE * (Math.max(1, enemySize) / REFERENCE_ENEMY_SIZE),
      MIN_WORLD_SIZE,
      MAX_WORLD_SIZE,
    );
    const scale = worldSize / TEXTURE_SIZE;
    // Leicht zufällige Neigung, damit Leichenfelder nicht wie ein Raster wirken.
    const rotation = Phaser.Math.RND.realInRange(-0.34, 0.34);

    const shadow = this.scene.add.image(x + worldSize * 0.09, y + worldSize * 0.11, TEX_CORPSE_CROSS_SHADOW)
      .setDepth(DEPTH_CORPSE_CROSS_SHADOW)
      .setRotation(rotation)
      .setScale(scale)
      .setAlpha(0);
    const cross = this.scene.add.image(x, y, TEX_CORPSE_CROSS)
      .setDepth(DEPTH_CORPSE_CROSS)
      .setRotation(rotation)
      .setScale(scale * 0.72)
      .setAlpha(0);

    const fadeMs = Math.min(FADE_MS, lifetimeMs);
    const holdMs = Math.max(0, lifetimeMs - fadeMs);
    this.visuals.set(corpseId, { cross, shadow });

    this.scene.tweens.add({
      targets: cross,
      alpha: CROSS_ALPHA,
      scaleX: scale,
      scaleY: scale,
      duration: APPEAR_MS,
      ease: 'Back.easeOut',
    });
    this.scene.tweens.add({
      targets: shadow,
      alpha: SHADOW_ALPHA,
      duration: APPEAR_MS,
      ease: 'Quad.easeOut',
    });
    this.scene.tweens.add({
      targets: [cross, shadow],
      alpha: 0,
      delay: holdMs,
      duration: fadeMs,
      ease: 'Sine.easeIn',
      onComplete: () => {
        if (this.visuals.get(corpseId)?.cross !== cross) return;
        this.visuals.delete(corpseId);
        cross.destroy();
        shadow.destroy();
      },
    });
  }

  /** Entfernt das Kreuz sofort – etwa wenn die Leiche wiederbelebt wurde. */
  remove(corpseId: number): void {
    const visual = this.visuals.get(corpseId);
    if (!visual) return;
    this.visuals.delete(corpseId);
    this.scene.tweens.killTweensOf(visual.cross);
    this.scene.tweens.killTweensOf(visual.shadow);
    visual.cross.destroy();
    visual.shadow.destroy();
  }

  clearAll(): void {
    for (const corpseId of [...this.visuals.keys()]) this.remove(corpseId);
  }

  destroy(): void {
    this.clearAll();
  }
}

/** Zwei gekreuzte Bretter in direkter Draufsicht – kein Volumen, keine sichtbaren Seiten. */
function fillCrossPath(ctx: CanvasRenderingContext2D): void {
  const center = TEXTURE_SIZE / 2;
  const beamWidth = TEXTURE_SIZE * 0.19;
  const postLength = TEXTURE_SIZE * 0.88;
  const armLength = TEXTURE_SIZE * 0.62;

  ctx.beginPath();
  ctx.rect(center - beamWidth / 2, center - postLength * 0.55, beamWidth, postLength);
  ctx.rect(center - armLength / 2, center - postLength * 0.22, armLength, beamWidth);
  ctx.fill();
}

function drawCross(ctx: CanvasRenderingContext2D): void {
  const center = TEXTURE_SIZE / 2;
  const beamWidth = TEXTURE_SIZE * 0.19;
  const postLength = TEXTURE_SIZE * 0.88;
  const armLength = TEXTURE_SIZE * 0.62;
  const postTop = center - postLength * 0.55;
  const armTop = center - postLength * 0.22;

  // Dunkler Rand zuerst, damit das Kreuz auch auf hellem Gras eine geschlossene Silhouette hat.
  ctx.fillStyle = '#2a1a10';
  ctx.beginPath();
  ctx.rect(center - beamWidth / 2 - 1.6, postTop - 1.6, beamWidth + 3.2, postLength + 3.2);
  ctx.rect(center - armLength / 2 - 1.6, armTop - 1.6, armLength + 3.2, beamWidth + 3.2);
  ctx.fill();

  ctx.fillStyle = '#6b4426';
  fillCrossPath(ctx);

  // Holzmaserung: schmale hellere und dunklere Streifen längs der Bretter.
  ctx.save();
  ctx.beginPath();
  ctx.rect(center - beamWidth / 2, postTop, beamWidth, postLength);
  ctx.rect(center - armLength / 2, armTop, armLength, beamWidth);
  ctx.clip();

  ctx.fillStyle = 'rgba(150,102,60,0.75)';
  ctx.fillRect(center - beamWidth / 2, postTop, beamWidth * 0.3, postLength);
  ctx.fillRect(center - armLength / 2, armTop, armLength, beamWidth * 0.28);

  ctx.fillStyle = 'rgba(58,35,20,0.6)';
  ctx.fillRect(center + beamWidth * 0.16, postTop, beamWidth * 0.26, postLength);
  ctx.fillRect(center - armLength / 2, armTop + beamWidth * 0.68, armLength, beamWidth * 0.3);
  ctx.restore();

  // Bindung an der Kreuzung – der Punkt, an dem das Auge das Kreuz zuerst liest.
  ctx.strokeStyle = 'rgba(38,24,14,0.85)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(center - beamWidth * 0.62, armTop + beamWidth * 0.16);
  ctx.lineTo(center + beamWidth * 0.62, armTop + beamWidth * 0.86);
  ctx.moveTo(center + beamWidth * 0.62, armTop + beamWidth * 0.16);
  ctx.lineTo(center - beamWidth * 0.62, armTop + beamWidth * 0.86);
  ctx.stroke();
}
