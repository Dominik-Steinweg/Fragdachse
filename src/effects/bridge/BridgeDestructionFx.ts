import * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import { getVisibleWorldView } from '../../ui/HostileBaseIndicator';
import { ensureCanvasTexture } from '../EffectUtils';
import { ensureExplosionSmokeTexture, TEX_EXPLOSION_SMOKE } from '../gpu/GpuVfxSourceTextures';
import { buildBridgeDestructionPlan, BRIDGE_DESTRUCTION_PIECE_COUNT, type BridgeDestructionPiece } from './BridgeDestructionPlan';

const MAX_COLLAPSES = 3;
let nextTextureOwner = 0;
interface PieceSlot { readonly image: Phaser.GameObjects.Image; plan: BridgeDestructionPiece | null }
interface CollapseSlot { ageMs: number; active: boolean; readonly pieces: PieceSlot[] }

/**
 * World presentation owner of bridge collapses: debris bursts from the deck, tumbles and sinks,
 * dust hangs over the gap and splash rings mark the impacts. Owns its postupdate listener and a
 * fixed image pool; no timers or tweens.
 */
export class BridgeDestructionFx {
  private readonly slots: CollapseSlot[] = [];
  private readonly woodKey: string;
  private readonly ironKey: string;
  private readonly splashKey: string;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene) {
    const prefix = `bridge-collapse-${nextTextureOwner++}`;
    this.woodKey = `${prefix}-wood`;
    this.ironKey = `${prefix}-iron`;
    this.splashKey = `${prefix}-splash`;
    this.createTextures();
    for (let i = 0; i < MAX_COLLAPSES; i++) {
      const pieces: PieceSlot[] = [];
      for (let j = 0; j < BRIDGE_DESTRUCTION_PIECE_COUNT; j++) {
        pieces.push({ image: scene.add.image(0, 0, this.woodKey)
          .setVisible(false).setActive(false).setDepth(DEPTH.WATER + .5), plan: null });
      }
      this.slots.push({ ageMs: 0, active: false, pieces });
    }
    scene.events.on('postupdate', this.update, this);
    scene.events.once('shutdown', this.destroy, this);
  }

  /** Returns false when invalid, offscreen, destroyed or the concurrent budget is full. */
  play(deck: { x: number; y: number; width: number; height: number }, horizontal: boolean): boolean {
    if (this.destroyed) return false;
    const camera = this.scene.cameras?.main;
    if (camera) {
      const view = getVisibleWorldView(camera), margin = Math.max(deck.width, deck.height);
      if (deck.x + deck.width + margin < view.x || deck.y + deck.height + margin < view.y
        || deck.x - margin > view.x + view.width || deck.y - margin > view.y + view.height) return false;
    }
    const plan = buildBridgeDestructionPlan(deck, horizontal);
    const slot = plan.length > 0 ? this.slots.find(candidate => !candidate.active) : undefined;
    if (!slot) return false;
    slot.ageMs = 0;
    slot.active = true;
    for (let i = 0; i < slot.pieces.length; i++) {
      const piece = slot.pieces[i]!, p = plan[i]!;
      piece.plan = p;
      const texture = p.material === 'iron' ? this.ironKey : p.material === 'dust' ? TEX_EXPLOSION_SMOKE
        : p.material === 'splash' ? this.splashKey : this.woodKey;
      piece.image.setTexture(texture).setPosition(p.x, p.y).setRotation(p.rotation)
        .setDisplaySize(p.width, p.height).setTint(p.tint).setAlpha(0).setVisible(false)
        .setDepth(DEPTH.WATER + (p.material === 'splash' ? .45 : p.material === 'dust' ? .55 : .5));
    }
    return true;
  }

  private update(_time: number, delta: number): void {
    if (this.destroyed || !Number.isFinite(delta)) return;
    for (const slot of this.slots) {
      if (!slot.active) continue;
      slot.ageMs += Math.max(0, delta);
      let alive = false;
      for (const piece of slot.pieces) {
        const p = piece.plan;
        if (!p) continue;
        const age = slot.ageMs - p.delayMs;
        if (age >= p.lifeMs) { piece.image.setVisible(false); piece.plan = null; continue; }
        alive = true;
        if (age < 0) continue;
        const flight = Math.min(1, age / p.flightMs), eased = 1 - (1 - flight) ** 3;
        const progress = age / p.lifeMs;
        let scale: number, alpha: number;
        if (p.material === 'splash') {
          scale = 0.35 + eased * 0.9;
          alpha = 0.55 * (1 - progress) ** 1.6;
        } else if (p.material === 'dust') {
          scale = 0.5 + eased * 1.4;
          alpha = 0.5 * Math.min(1, age / 90) * (1 - progress);
        } else {
          // Debris rises a little while flying, then sinks: it shrinks and fades into the river.
          const sink = Math.max(0, (progress - 0.45) / 0.55);
          scale = (1.15 - flight * 0.15) * (1 - sink * 0.55);
          alpha = 0.95 * (1 - sink);
        }
        piece.image.setVisible(true).setAlpha(alpha)
          .setPosition(p.x + (p.endX - p.x) * eased, p.y + (p.endY - p.y) * eased)
          .setRotation(p.rotation + p.spin * eased).setDisplaySize(p.width * scale, p.height * scale);
      }
      slot.active = alive;
    }
  }

  clear(): void {
    for (const slot of this.slots) {
      slot.active = false;
      slot.ageMs = 0;
      for (const piece of slot.pieces) { piece.plan = null; piece.image.setVisible(false).setAlpha(0); }
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events.off('postupdate', this.update, this);
    this.scene.events.off('shutdown', this.destroy, this);
    this.clear();
    for (const slot of this.slots) for (const piece of slot.pieces) piece.image.destroy();
    this.slots.length = 0;
    for (const key of [this.woodKey, this.ironKey, this.splashKey]) this.scene.textures.remove(key);
    // Explosion smoke is a borrowed scene texture used by other renderers.
  }

  private createTextures(): void {
    ensureExplosionSmokeTexture(this.scene);
    ensureCanvasTexture(this.scene.textures, this.woodKey, 48, 12, ctx => {
      ctx.beginPath(); ctx.moveTo(1, 2); ctx.lineTo(44, 1); ctx.lineTo(41, 4); ctx.lineTo(47, 6);
      ctx.lineTo(42, 11); ctx.lineTo(2, 11); ctx.lineTo(5, 7); ctx.closePath();
      ctx.fillStyle = '#d2c3a8'; ctx.fill();
      ctx.save(); ctx.clip();
      ctx.fillStyle = 'rgba(255,244,220,0.6)'; ctx.fillRect(2, 2, 40, 1);
      ctx.strokeStyle = 'rgba(96,80,60,0.8)'; ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(4, 4 + i * 2.5); ctx.bezierCurveTo(16, 3 + i * 2.5, 28, 7 + i * 2, 43, 4 + i * 2.5); ctx.stroke();
      }
      ctx.restore();
    });
    ensureCanvasTexture(this.scene.textures, this.ironKey, 16, 12, ctx => {
      ctx.fillStyle = '#b8bcb7'; ctx.beginPath(); ctx.moveTo(1, 1); ctx.lineTo(15, 1);
      ctx.lineTo(14, 5); ctx.lineTo(6, 6); ctx.lineTo(5, 11); ctx.lineTo(1, 10); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#555c57'; ctx.beginPath(); ctx.arc(4, 4, 1.4, 0, Math.PI * 2); ctx.fill();
    });
    ensureCanvasTexture(this.scene.textures, this.splashKey, 64, 64, ctx => {
      const gradient = ctx.createRadialGradient(32, 32, 14, 32, 32, 31);
      gradient.addColorStop(0, 'rgba(255,255,255,0)');
      gradient.addColorStop(.55, 'rgba(255,255,255,.75)');
      gradient.addColorStop(.75, 'rgba(255,255,255,.3)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
    });
  }
}
