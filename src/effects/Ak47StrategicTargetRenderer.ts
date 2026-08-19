import * as Phaser from 'phaser';
import { COLORS, DEPTH } from '../config';
import type { EnemyManager } from '../entities/EnemyManager';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { SyncedAk47StrategicTarget } from '../types';

const MARKER_COLOR = COLORS.GOLD_1;
const MARKER_RING_COLOR = COLORS.GOLD_2;
const CONFIRM_COLOR = 0xfff3a8;
const MIN_MARKER_RADIUS = 22;
const MAX_MARKER_RADIUS = 58;

interface MarkerVisual {
  readonly container: Phaser.GameObjects.Container;
  readonly crosshair: Phaser.GameObjects.Graphics;
  readonly confirmation: Phaser.GameObjects.Graphics;
  ownerId: string | null;
  enemyId: string | null;
  drawnRadius: number;
  lockTween: Phaser.Tweens.Tween | null;
  idleTween: Phaser.Tweens.Tween | null;
}

/** World-space tactical target marker for the local player's AK strategic target. */
export class Ak47StrategicTargetRenderer {
  private marker: MarkerVisual | null = null;
  private built = false;

  constructor(private readonly scene: Phaser.Scene) {
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  build(): void {
    if (this.built) return;
    this.built = true;
    const crosshair = this.scene.add.graphics();
    const confirmation = this.scene.add.graphics().setVisible(false);
    const container = this.scene.add.container(0, 0, [confirmation, crosshair])
      .setDepth(DEPTH.PROJECTILES + 2)
      .setVisible(false);
    this.drawCrosshair(crosshair, MIN_MARKER_RADIUS);
    this.drawConfirmation(confirmation, MIN_MARKER_RADIUS);
    this.marker = {
      container,
      crosshair,
      confirmation,
      ownerId: null,
      enemyId: null,
      drawnRadius: MIN_MARKER_RADIUS,
      lockTween: null,
      idleTween: null,
    };
  }

  sync(
    snapshot: readonly SyncedAk47StrategicTarget[],
    enemyManager: EnemyManager | null,
    localPlayerId: string,
    now = Date.now(),
    active = true,
  ): void {
    if (!this.built || !this.marker) return;

    if (!active || !enemyManager || !localPlayerId) {
      this.hide();
      return;
    }

    const myEntry = snapshot.find(entry => entry.ownerId === localPlayerId);
    if (!myEntry) {
      this.hide();
      return;
    }

    const enemy = enemyManager.getEnemy(myEntry.enemyId);
    if (!enemy || !enemy.sprite.active || enemy.getHp() <= 0) {
      this.hide();
      return;
    }

    const radius = this.getEnemyRadius(enemy);
    if (this.marker.drawnRadius !== radius) {
      this.drawCrosshair(this.marker.crosshair, radius);
      this.drawConfirmation(this.marker.confirmation, radius);
      this.marker.drawnRadius = radius;
    }

    const targetChanged = this.marker.ownerId !== myEntry.ownerId || this.marker.enemyId !== myEntry.enemyId;
    if (targetChanged) {
      this.marker.ownerId = myEntry.ownerId;
      this.marker.enemyId = myEntry.enemyId;
      this.stopTweens();
      this.marker.container
        .setScale(1.45)
        .setAlpha(0)
        .setRotation(-0.35)
        .setVisible(true);
      this.marker.lockTween = this.scene.tweens.add({
        targets: this.marker.container,
        scale: 1,
        alpha: 1,
        rotation: 0,
        duration: 150,
        ease: 'Cubic.Out',
        onComplete: () => this.startIdlePulse(),
      });
    } else if (!this.marker.container.visible) {
      this.marker.container.setVisible(true);
      this.startIdlePulse();
    }

    this.marker.container.setPosition(enemy.sprite.x, enemy.sprite.y);
    const confirming = myEntry.confirmationUntil > now;
    this.marker.confirmation.setVisible(confirming);
    if (confirming) {
      this.marker.container.setAlpha(1);
    }
  }

  clear(): void {
    this.hide();
  }

  destroy(): void {
    if (this.marker) {
      this.stopTweens();
      this.marker.container.destroy(true);
      this.marker = null;
    }
    this.built = false;
  }

  private hide(): void {
    if (!this.marker) return;
    this.stopTweens();
    this.marker.container.setVisible(false).setAlpha(0).setScale(1).setRotation(0);
    this.marker.confirmation.setVisible(false);
    this.marker.ownerId = null;
    this.marker.enemyId = null;
  }

  private stopTweens(): void {
    if (!this.marker) return;
    this.marker.lockTween?.stop();
    this.marker.lockTween = null;
    this.marker.idleTween?.stop();
    this.marker.idleTween = null;
  }

  private startIdlePulse(): void {
    if (!this.marker || !this.marker.container.visible) return;
    this.marker.idleTween?.stop();
    this.marker.idleTween = this.scene.tweens.add({
      targets: this.marker.container,
      scaleX: 1.03,
      scaleY: 1.03,
      alpha: 0.9,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    });
  }

  private getEnemyRadius(enemy: EnemyEntity): number {
    const sprite = enemy.sprite;
    const width = sprite.displayWidth || (sprite.width * Math.abs(sprite.scaleX)) || 32;
    const height = sprite.displayHeight || (sprite.height * Math.abs(sprite.scaleY)) || 32;
    const enemyRadius = Math.max(width, height) * 0.5;
    return Math.round(Phaser.Math.Clamp(enemyRadius + 8, MIN_MARKER_RADIUS, MAX_MARKER_RADIUS));
  }

  private drawCrosshair(graphics: Phaser.GameObjects.Graphics, radius: number): void {
    graphics.clear();
    const bracketLength = Math.max(7, Math.round(radius * 0.35));
    const ringRadius = Math.round(radius * 0.72);

    // 4 offene äußere Klammern (Corner Brackets)
    graphics.lineStyle(2.5, MARKER_COLOR, 0.95);
    // Oben-Links
    graphics.lineBetween(-radius, -radius + bracketLength, -radius, -radius);
    graphics.lineBetween(-radius, -radius, -radius + bracketLength, -radius);
    // Oben-Rechts
    graphics.lineBetween(radius - bracketLength, -radius, radius, -radius);
    graphics.lineBetween(radius, -radius, radius, -radius + bracketLength);
    // Unten-Links
    graphics.lineBetween(-radius, radius - bracketLength, -radius, radius);
    graphics.lineBetween(-radius, radius, -radius + bracketLength, radius);
    // Unten-Rechts
    graphics.lineBetween(radius - bracketLength, radius, radius, radius);
    graphics.lineBetween(radius, radius, radius, radius - bracketLength);

    // Dünner segmentierter Ring (4 Kreisbogen-Segmente)
    graphics.lineStyle(1.5, MARKER_RING_COLOR, 0.85);
    const degToRad = Math.PI / 180;
    const arcSpan = 60 * degToRad;
    const starts = [15 * degToRad, 105 * degToRad, 195 * degToRad, 285 * degToRad];
    for (const start of starts) {
      graphics.beginPath();
      graphics.arc(0, 0, ringRadius, start, start + arcSpan, false);
      graphics.strokePath();
    }
  }

  private drawConfirmation(graphics: Phaser.GameObjects.Graphics, radius: number): void {
    graphics.clear();
    const bracketLength = Math.max(8, Math.round(radius * 0.38));
    const ringRadius = Math.round(radius * 0.72);

    // Deutlich sichtbarer Trefferbestätigungsimpuls
    graphics.lineStyle(3, CONFIRM_COLOR, 1);
    graphics.strokeCircle(0, 0, ringRadius);

    // Helle Akzente an den Ecken
    graphics.lineStyle(3.5, CONFIRM_COLOR, 1);
    graphics.lineBetween(-radius, -radius + bracketLength, -radius, -radius);
    graphics.lineBetween(-radius, -radius, -radius + bracketLength, -radius);
    graphics.lineBetween(radius - bracketLength, -radius, radius, -radius);
    graphics.lineBetween(radius, -radius, radius, -radius + bracketLength);
    graphics.lineBetween(-radius, radius - bracketLength, -radius, radius);
    graphics.lineBetween(-radius, radius, -radius + bracketLength, radius);
    graphics.lineBetween(radius - bracketLength, radius, radius, radius);
    graphics.lineBetween(radius, radius, radius, radius - bracketLength);
  }
}
