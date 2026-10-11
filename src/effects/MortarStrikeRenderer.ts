import * as Phaser from 'phaser';
import { VOID_PALETTE, toCssColor } from '../config';
import type { SyncedMortarStrike } from '../types';
import { ensureCanvasTexture } from './EffectUtils';

const TEXTURE = 'mortar-gate1-markers';
const TILE = 160;
const RADIUS = 70;
const STEPS = 32;
const FLIGHT_FRAME = STEPS + 1;
const SHADOW_FRAME = STEPS + 2;

/** Scene-lifetime placeholder. Baked rings avoid per-frame Graphics tessellation. */
export class MortarStrikeRenderer {
  private readonly visuals = new Map<number, { marker: Phaser.GameObjects.Image; shadow: Phaser.GameObjects.Image }>();

  constructor(private readonly scene: Phaser.Scene) {
    ensureCanvasTexture(scene.textures, TEXTURE, TILE * 8, TILE * 5, (ctx, texture) => {
      for (let frame = 0; frame <= SHADOW_FRAME; frame++) {
        const x = frame % 8 * TILE, y = Math.floor(frame / 8) * TILE;
        texture.add(frame, 0, x, y, TILE, TILE);
        ctx.save();
        ctx.translate(x + TILE / 2, y + TILE / 2);
        if (frame === SHADOW_FRAME) {
          ctx.fillStyle = toCssColor(VOID_PALETTE.shadow);
          ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
        } else {
          const flight = frame === FLIGHT_FRAME;
          ctx.strokeStyle = toCssColor(flight ? VOID_PALETTE.bright : VOID_PALETTE.primary);
          ctx.lineWidth = flight ? 3 : 2;
          ctx.setLineDash(flight ? [] : [RADIUS * Math.PI / 24, RADIUS * Math.PI / 24]);
          ctx.beginPath(); ctx.arc(0, 0, RADIUS, 0, Math.PI * 2); ctx.stroke();
          if (!flight && frame > 0) {
            ctx.setLineDash([]);
            ctx.strokeStyle = toCssColor(VOID_PALETTE.bright);
            ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(0, 0, RADIUS - 5, -Math.PI / 2, -Math.PI / 2 + frame / STEPS * Math.PI * 2); ctx.stroke();
          }
        }
        ctx.restore();
      }
    });
  }

  sync(strikes: readonly SyncedMortarStrike[], nowMs: number): void {
    const active = new Set<number>();
    for (const strike of strikes) {
      if (nowMs >= strike.impactAt) continue;
      active.add(strike.id);
      let visual = this.visuals.get(strike.id);
      if (!visual) {
        const marker = this.scene.add.image(0, 0, TEXTURE, 0).setDepth(19.8);
        const shadow = this.scene.add.image(0, 0, TEXTURE, SHADOW_FRAME).setDepth(5.1);
        visual = { marker, shadow };
        this.visuals.set(strike.id, visual);
      }
      const launched = nowMs >= strike.launchAt;
      const progress = Phaser.Math.Clamp((nowMs - strike.armedAt) / (strike.launchAt - strike.armedAt), 0, 1);
      visual.marker.setFrame(launched ? FLIGHT_FRAME : Math.floor(progress * STEPS))
        .setPosition(strike.targetX, strike.targetY).setScale(strike.radius / RADIUS).setAlpha(launched ? 0.95 : 0.7);
      const flight = launched ? Phaser.Math.Clamp((nowMs - strike.launchAt) / (strike.impactAt - strike.launchAt), 0, 1) : 0;
      visual.shadow.setPosition(strike.targetX, strike.targetY)
        .setScale(launched ? 0.4 + flight * 0.7 : 0.3).setAlpha(launched ? 0.3 + flight * 0.4 : 0.25);
    }
    for (const [id, visual] of this.visuals) if (!active.has(id)) {
      visual.marker.destroy(); visual.shadow.destroy(); this.visuals.delete(id);
    }
  }

  clear(): void {
    for (const visual of this.visuals.values()) { visual.marker.destroy(); visual.shadow.destroy(); }
    this.visuals.clear();
  }

  destroy(): void { this.clear(); this.scene.textures.remove(TEXTURE); }
}
