import * as Phaser from 'phaser';
import { bridge }            from '../../network/bridge';
import { dequantizeAngle }   from '../../utils/angle';
import { DEPTH, ARENA_OFFSET_X, ARENA_OFFSET_Y, ARENA_WIDTH, ARENA_HEIGHT, getTopDownMuzzleOrigin } from '../../config';

/**
 * Draws the Gauss charge beam for every remote player currently charging
 * their Gauss ultimate. Called every frame from ArenaScene.update().
 *
 * The local player's own beam is handled by AimSystem (via ultimatePreview).
 */
export class GaussWarningRenderer {
  private readonly gfx: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.gfx = scene.add.graphics().setDepth(DEPTH.OVERLAY - 2);
  }

  update(inArena: boolean): void {
    this.gfx.clear();
    if (!inArena) return;

    const state = bridge.getLatestGameState();
    if (!state) return;

    const localId = bridge.getLocalPlayerId();
    const time    = (this.gfx.scene as Phaser.Scene).time.now;

    for (const [playerId, playerState] of Object.entries(state.players)) {
      if (playerId === localId || !playerState.alive || !playerState.isChargingUltimate) continue;
      const range          = Math.max(0, playerState.ultimateChargeRange ?? 0);
      const chargeFraction = Phaser.Math.Clamp(playerState.ultimateChargeFraction ?? 0, 0, 1);
      if (range <= 0 || chargeFraction <= 0) continue;

      const aimAngle = dequantizeAngle(playerState.rot);
      const dirX     = Math.cos(aimAngle);
      const dirY     = Math.sin(aimAngle);
      const pulse    = 0.92 + 0.08 * Math.sin(time * 0.018);
      const muzzle   = getTopDownMuzzleOrigin(playerState.x, playerState.y, aimAngle);
      const beamEnd  = this.clipBeamToArena(
        muzzle.x, muzzle.y,
        muzzle.x + dirX * Math.max(10, range * chargeFraction),
        muzzle.y + dirY * Math.max(10, range * chargeFraction),
      );
      const sx    = Math.round(muzzle.x);
      const sy    = Math.round(muzzle.y);
      const ex    = Math.round(beamEnd.x);
      const ey    = Math.round(beamEnd.y);
      const alpha = Math.max(0.04, chargeFraction * chargeFraction);

      this.gfx.lineStyle(18, 0x0a1118, 0.05 * alpha);
      this.gfx.beginPath(); this.gfx.moveTo(sx, sy); this.gfx.lineTo(ex, ey); this.gfx.strokePath();
      this.gfx.lineStyle(14, 0xbcefff, 0.14 * alpha * pulse);
      this.gfx.beginPath(); this.gfx.moveTo(sx, sy); this.gfx.lineTo(ex, ey); this.gfx.strokePath();
      this.gfx.lineStyle(9, 0x78d6ff, 0.3 * alpha * pulse);
      this.gfx.beginPath(); this.gfx.moveTo(sx, sy); this.gfx.lineTo(ex, ey); this.gfx.strokePath();
      this.gfx.lineStyle(4, 0xe1fbff, 0.55 * alpha);
      this.gfx.beginPath(); this.gfx.moveTo(sx, sy); this.gfx.lineTo(ex, ey); this.gfx.strokePath();
      this.gfx.lineStyle(2, 0xffffff, 0.9 * alpha);
      this.gfx.beginPath(); this.gfx.moveTo(sx, sy); this.gfx.lineTo(ex, ey); this.gfx.strokePath();

      const emitterRadius = 6 + chargeFraction * 6;
      this.gfx.fillStyle(0xbcefff, 0.12 * alpha * pulse);
      this.gfx.fillCircle(sx, sy, emitterRadius * 2.1);
      this.gfx.fillStyle(0x78d6ff, 0.25 * alpha);
      this.gfx.fillCircle(sx, sy, emitterRadius * 1.3);
      this.gfx.fillStyle(0xffffff, 0.5 * alpha);
      this.gfx.fillCircle(sx, sy, Math.max(2, emitterRadius * 0.55));
    }
  }

  private clipBeamToArena(sx: number, sy: number, ex: number, ey: number): { x: number; y: number } {
    const maxX = ARENA_OFFSET_X + ARENA_WIDTH;
    const maxY = ARENA_OFFSET_Y + ARENA_HEIGHT;
    if (ex >= ARENA_OFFSET_X && ex <= maxX && ey >= ARENA_OFFSET_Y && ey <= maxY) {
      return { x: ex, y: ey };
    }
    const dx = ex - sx;
    const dy = ey - sy;
    let t = 1;
    if (dx !== 0) {
      if (dx > 0) t = Math.min(t, (maxX - sx) / dx);
      else        t = Math.min(t, (ARENA_OFFSET_X - sx) / dx);
    }
    if (dy !== 0) {
      if (dy > 0) t = Math.min(t, (maxY - sy) / dy);
      else        t = Math.min(t, (ARENA_OFFSET_Y - sy) / dy);
    }
    return { x: sx + dx * t, y: sy + dy * t };
  }
}
