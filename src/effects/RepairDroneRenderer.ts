import * as Phaser from 'phaser';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE, DEPTH } from '../config';
import type { SyncedPlaceableRock, SyncedRepairDrone } from '../types';
import { ensureCanvasTexture } from './EffectUtils';

const TEX_REPAIR_DRONE = '__repair_drone';
const DRONE_DEPTH = DEPTH.PROJECTILES + 0.4;
const SMOOTH_TIME_MS = 48;

interface RepairDroneVisual {
  body: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Arc;
  beam: Phaser.GameObjects.Graphics;
  currentX: number;
  currentY: number;
  targetX: number;
  targetY: number;
  repairTarget?: { x: number; y: number };
}

/** Top-down repair drone with a host-synchronized repair beam. */
export class RepairDroneRenderer {
  private readonly visuals = new Map<string, RepairDroneVisual>();

  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    ensureCanvasTexture(this.scene.textures, TEX_REPAIR_DRONE, 32, 32, (ctx) => {
      ctx.translate(16, 16);
      ctx.fillStyle = '#26343c';
      ctx.strokeStyle = '#bcebd4';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#7fffc1';
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#8297a1';
      ctx.lineWidth = 3;
      for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        ctx.beginPath();
        ctx.moveTo(Math.cos(angle) * 6, Math.sin(angle) * 6);
        ctx.lineTo(Math.cos(angle) * 12, Math.sin(angle) * 12);
        ctx.stroke();
      }
      ctx.strokeStyle = '#d5f5e6';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(-12, 0, 3, 0, Math.PI * 2);
      ctx.moveTo(15, 0);
      ctx.arc(12, 0, 3, 0, Math.PI * 2);
      ctx.moveTo(3, -12);
      ctx.arc(0, -12, 3, 0, Math.PI * 2);
      ctx.moveTo(3, 12);
      ctx.arc(0, 12, 3, 0, Math.PI * 2);
      ctx.stroke();
    });
  }

  syncVisuals(
    snapshots: readonly SyncedRepairDrone[],
    constructions: readonly SyncedPlaceableRock[],
  ): void {
    const activeOwners = new Set(snapshots.map(snapshot => snapshot.ownerId));
    for (const [ownerId, visual] of this.visuals) {
      if (activeOwners.has(ownerId)) continue;
      this.destroyVisual(visual);
      this.visuals.delete(ownerId);
    }

    const constructionPositions = new Map(
      constructions
        .filter(construction => construction.constructionId)
        .map(construction => [
          construction.id,
          {
            x: ARENA_OFFSET_X + construction.gridX * CELL_SIZE + CELL_SIZE * 0.5,
            y: ARENA_OFFSET_Y + construction.gridY * CELL_SIZE + CELL_SIZE * 0.5,
          },
        ]),
    );
    for (const snapshot of snapshots) {
      let visual = this.visuals.get(snapshot.ownerId);
      if (!visual) {
        visual = this.createVisual(snapshot);
        this.visuals.set(snapshot.ownerId, visual);
      }
      visual.targetX = snapshot.x;
      visual.targetY = snapshot.y;
      visual.body.setTint(snapshot.ownerColor);
      visual.repairTarget = snapshot.phase === 'repairing' && snapshot.targetConstructionId !== undefined
        ? constructionPositions.get(snapshot.targetConstructionId)
        : undefined;
    }
  }

  update(delta: number): void {
    const lerp = 1 - Math.exp(-Math.max(0, delta) / SMOOTH_TIME_MS);
    const now = this.scene.time.now;
    for (const [ownerId, visual] of this.visuals) {
      visual.currentX = Phaser.Math.Linear(visual.currentX, visual.targetX, lerp);
      visual.currentY = Phaser.Math.Linear(visual.currentY, visual.targetY, lerp);
      const bob = Math.sin(now * 0.008 + ownerId.length) * 2;
      visual.body.setPosition(visual.currentX, visual.currentY + bob).setRotation(now * 0.0012);
      visual.glow
        .setPosition(visual.currentX, visual.currentY + bob)
        .setScale(0.9 + Math.sin(now * 0.01) * 0.08);
      visual.beam.clear();
      if (!visual.repairTarget) continue;
      visual.beam
        .lineStyle(7, 0x5dffac, 0.12)
        .lineBetween(visual.currentX, visual.currentY + bob, visual.repairTarget.x, visual.repairTarget.y)
        .lineStyle(2, 0xc8ffe4, 0.9)
        .lineBetween(visual.currentX, visual.currentY + bob, visual.repairTarget.x, visual.repairTarget.y);
    }
  }

  destroyAll(): void {
    for (const visual of this.visuals.values()) this.destroyVisual(visual);
    this.visuals.clear();
  }

  private createVisual(snapshot: SyncedRepairDrone): RepairDroneVisual {
    return {
      body: this.scene.add.image(snapshot.x, snapshot.y, TEX_REPAIR_DRONE)
        .setDepth(DRONE_DEPTH)
        .setTint(snapshot.ownerColor),
      glow: this.scene.add.circle(snapshot.x, snapshot.y, 13, 0x63ffc0, 0.12)
        .setStrokeStyle(1, 0xbfffe3, 0.45)
        .setDepth(DRONE_DEPTH - 0.02),
      beam: this.scene.add.graphics().setDepth(DRONE_DEPTH - 0.01),
      currentX: snapshot.x,
      currentY: snapshot.y,
      targetX: snapshot.x,
      targetY: snapshot.y,
    };
  }

  private destroyVisual(visual: RepairDroneVisual): void {
    visual.body.destroy();
    visual.glow.destroy();
    visual.beam.destroy();
  }
}
