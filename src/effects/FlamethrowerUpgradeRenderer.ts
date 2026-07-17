import * as Phaser from 'phaser';
import { COLORS, DEPTH } from '../config';
import type { PlayerManager } from '../entities/PlayerManager';
import type { PlayerNetState, SyncedBurningGroundSnapshot } from '../types';

const CELL_SIZE = 32;
const TEX_GROUND_FIRE = '__flamethrower_burning_ground_cell';

interface GroundVisual {
  image: Phaser.GameObjects.Image;
  expiresAt: number;
}

/** Lightweight pooled visuals for replicated ground cells and player-following fire rings. */
export class FlamethrowerUpgradeRenderer {
  private readonly ground = new Map<number, GroundVisual>();
  private readonly rings = new Map<string, Phaser.GameObjects.Graphics>();
  private readonly ringRadii = new Map<string, number>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly playerManager: PlayerManager,
  ) {
    this.ensureTexture();
  }

  syncGround(snapshot: SyncedBurningGroundSnapshot): void {
    const activeIds = new Set(snapshot.cells.map(cell => cell.id));
    for (const [id, visual] of this.ground) {
      if (activeIds.has(id)) continue;
      visual.image.destroy();
      this.ground.delete(id);
    }
    for (const cell of snapshot.cells) {
      let visual = this.ground.get(cell.id);
      if (!visual) {
        visual = {
          image: this.scene.add.image(0, 0, TEX_GROUND_FIRE)
            .setDepth(DEPTH.FIRE)
            .setBlendMode(Phaser.BlendModes.ADD),
          expiresAt: cell.expiresAt,
        };
        this.ground.set(cell.id, visual);
      }
      visual.image.setPosition((cell.gridX + 0.5) * CELL_SIZE, (cell.gridY + 0.5) * CELL_SIZE);
      visual.expiresAt = cell.expiresAt;
    }
  }

  syncRings(players: Readonly<Record<string, PlayerNetState>>): void {
    this.ringRadii.clear();
    for (const [playerId, state] of Object.entries(players)) {
      if ((state.flameRingRadius ?? 0) > 0 && state.alive && !state.isBurrowed) {
        this.ringRadii.set(playerId, state.flameRingRadius ?? 0);
      }
    }
    for (const [playerId, gfx] of this.rings) {
      if (this.ringRadii.has(playerId)) continue;
      gfx.destroy();
      this.rings.delete(playerId);
    }
  }

  update(now: number): void {
    for (const [id, visual] of this.ground) {
      const remaining = visual.expiresAt - now;
      if (remaining <= 0) {
        visual.image.destroy();
        this.ground.delete(id);
        continue;
      }
      const pulse = 0.82 + Math.sin(now * 0.018 + id) * 0.18;
      visual.image.setAlpha(Math.min(1, remaining / 350) * pulse);
      visual.image.setScale(0.94 + pulse * 0.08);
    }

    for (const [playerId, radius] of this.ringRadii) {
      const player = this.playerManager.getPlayer(playerId);
      if (!player?.sprite.visible) {
        this.rings.get(playerId)?.clear();
        continue;
      }
      let gfx = this.rings.get(playerId);
      if (!gfx) {
        gfx = this.scene.add.graphics().setDepth(DEPTH.FIRE + 0.05);
        this.rings.set(playerId, gfx);
      }
      const pulse = 0.5 + Math.sin(now * 0.014 + radius) * 0.5;
      gfx.clear();
      gfx.lineStyle(16, COLORS.RED_2, 0.32 + pulse * 0.12);
      gfx.strokeCircle(player.sprite.x, player.sprite.y, radius);
      gfx.lineStyle(5, COLORS.GOLD_1, 0.52 + pulse * 0.22);
      gfx.strokeCircle(player.sprite.x, player.sprite.y, radius);
      gfx.lineStyle(2, 0xffffff, 0.2 + pulse * 0.18);
      gfx.strokeCircle(player.sprite.x, player.sprite.y, radius - 3);
    }
  }

  clear(): void {
    for (const visual of this.ground.values()) visual.image.destroy();
    for (const gfx of this.rings.values()) gfx.destroy();
    this.ground.clear();
    this.rings.clear();
    this.ringRadii.clear();
  }

  private ensureTexture(): void {
    if (this.scene.textures.exists(TEX_GROUND_FIRE)) return;
    const gfx = this.scene.add.graphics();
    gfx.fillStyle(COLORS.RED_4, 0.48);
    gfx.fillRoundedRect(1, 3, CELL_SIZE - 2, CELL_SIZE - 5, 6);
    gfx.fillStyle(COLORS.RED_1, 0.74);
    gfx.fillTriangle(3, 27, 9, 7, 14, 27);
    gfx.fillTriangle(11, 28, 18, 2, 23, 28);
    gfx.fillStyle(COLORS.GOLD_1, 0.92);
    gfx.fillTriangle(17, 28, 24, 10, 30, 28);
    gfx.fillStyle(0xffffff, 0.72);
    gfx.fillCircle(18, 22, 3);
    gfx.generateTexture(TEX_GROUND_FIRE, CELL_SIZE, CELL_SIZE);
    gfx.destroy();
  }
}
