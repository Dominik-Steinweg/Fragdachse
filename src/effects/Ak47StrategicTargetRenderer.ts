import * as Phaser from 'phaser';
import { COLORS, DEPTH } from '../config';
import type { EnemyManager } from '../entities/EnemyManager';
import type { SyncedAk47StrategicTarget } from '../types';

const MAX_MARKERS = 8;
const MARKER_COLOR = COLORS.PURPLE_1;
const CONFIRM_COLOR = COLORS.GOLD_1;
const MARKER_RADIUS = 25;
const ARM_LENGTH = 9;
const ARM_GAP = 5;

interface MarkerVisual {
  readonly container: Phaser.GameObjects.Container;
  readonly crosshair: Phaser.GameObjects.Graphics;
  readonly confirmation: Phaser.GameObjects.Graphics;
  ownerId: string | null;
  enemyId: string | null;
  lockTween: Phaser.Tweens.Tween | null;
}

/** Pooled, world-space crosshairs for host-replicated AK strategic targets. */
export class Ak47StrategicTargetRenderer {
  private readonly markers: MarkerVisual[] = [];
  private built = false;

  constructor(private readonly scene: Phaser.Scene) {
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  build(): void {
    if (this.built) return;
    this.built = true;
    for (let index = 0; index < MAX_MARKERS; index += 1) {
      const crosshair = this.scene.add.graphics();
      const confirmation = this.scene.add.graphics().setVisible(false);
      const container = this.scene.add.container(0, 0, [confirmation, crosshair])
        .setDepth(DEPTH.PROJECTILES + 2)
        .setVisible(false);
      this.drawCrosshair(crosshair);
      this.drawConfirmation(confirmation);
      this.markers.push({ container, crosshair, confirmation, ownerId: null, enemyId: null, lockTween: null });
    }
  }

  sync(snapshot: readonly SyncedAk47StrategicTarget[], enemyManager: EnemyManager | null, now = Date.now(), active = true): void {
    if (!this.built) return;
    const visible = active
      ? snapshot.filter(entry => entry.phaseEndsAt > now && enemyManager?.getEnemy(entry.enemyId)?.sprite.active)
      : [];

    for (let index = 0; index < this.markers.length; index += 1) {
      const marker = this.markers[index];
      const entry = visible[index];
      if (!entry || !enemyManager) {
        this.hide(marker);
        continue;
      }
      const enemy = enemyManager.getEnemy(entry.enemyId);
      if (!enemy) {
        this.hide(marker);
        continue;
      }

      const targetChanged = marker.ownerId !== entry.ownerId || marker.enemyId !== entry.enemyId;
      if (targetChanged) {
        marker.ownerId = entry.ownerId;
        marker.enemyId = entry.enemyId;
        marker.lockTween?.stop();
        marker.container.setScale(1.55).setAlpha(0).setVisible(true);
        marker.lockTween = this.scene.tweens.add({
          targets: marker.container,
          scale: 1,
          alpha: 1,
          duration: 140,
          ease: 'Back.Out',
        });
      } else {
        marker.container.setVisible(true);
      }

      marker.container.setPosition(enemy.sprite.x, enemy.sprite.y);
      const confirming = entry.confirmationUntil > now;
      marker.confirmation.setVisible(confirming);
      if (confirming) marker.container.setAlpha(1);
    }
  }

  clear(): void {
    for (const marker of this.markers) this.hide(marker);
  }

  destroy(): void {
    for (const marker of this.markers) {
      marker.lockTween?.stop();
      marker.container.destroy(true);
    }
    this.markers.length = 0;
    this.built = false;
  }

  private hide(marker: MarkerVisual): void {
    marker.lockTween?.stop();
    marker.lockTween = null;
    marker.container.setVisible(false).setAlpha(0).setScale(1);
    marker.confirmation.setVisible(false);
    marker.ownerId = null;
    marker.enemyId = null;
  }

  private drawCrosshair(graphics: Phaser.GameObjects.Graphics): void {
    graphics.clear();
    graphics.lineStyle(2, MARKER_COLOR, 0.95);
    graphics.strokeCircle(0, 0, MARKER_RADIUS);
    graphics.lineBetween(-MARKER_RADIUS - 3, 0, -ARM_GAP, 0);
    graphics.lineBetween(ARM_GAP, 0, MARKER_RADIUS + 3, 0);
    graphics.lineBetween(0, -MARKER_RADIUS - 3, 0, -ARM_GAP);
    graphics.lineBetween(0, ARM_GAP, 0, MARKER_RADIUS + 3);
    graphics.lineStyle(3, MARKER_COLOR, 0.95);
    graphics.lineBetween(-MARKER_RADIUS, -MARKER_RADIUS + ARM_LENGTH, -MARKER_RADIUS, -MARKER_RADIUS);
    graphics.lineBetween(-MARKER_RADIUS, -MARKER_RADIUS, -MARKER_RADIUS + ARM_LENGTH, -MARKER_RADIUS);
    graphics.lineBetween(MARKER_RADIUS - ARM_LENGTH, -MARKER_RADIUS, MARKER_RADIUS, -MARKER_RADIUS);
    graphics.lineBetween(MARKER_RADIUS, -MARKER_RADIUS, MARKER_RADIUS, -MARKER_RADIUS + ARM_LENGTH);
    graphics.lineBetween(-MARKER_RADIUS, MARKER_RADIUS - ARM_LENGTH, -MARKER_RADIUS, MARKER_RADIUS);
    graphics.lineBetween(-MARKER_RADIUS, MARKER_RADIUS, -MARKER_RADIUS + ARM_LENGTH, MARKER_RADIUS);
    graphics.lineBetween(MARKER_RADIUS - ARM_LENGTH, MARKER_RADIUS, MARKER_RADIUS, MARKER_RADIUS);
    graphics.lineBetween(MARKER_RADIUS, MARKER_RADIUS - ARM_LENGTH, MARKER_RADIUS, MARKER_RADIUS);
  }

  private drawConfirmation(graphics: Phaser.GameObjects.Graphics): void {
    graphics.clear();
    graphics.lineStyle(3, CONFIRM_COLOR, 0.95);
    graphics.strokeCircle(0, 0, MARKER_RADIUS - 4);
  }
}

