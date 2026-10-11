import * as Phaser from 'phaser';
import { DEPTH } from '../../config';
import { getVisibleWorldView } from '../../ui/HostileBaseIndicator';
import { ensureCanvasTexture } from '../EffectUtils';
import { ensureExplosionSmokeTexture, TEX_EXPLOSION_SMOKE } from '../gpu/GpuVfxSourceTextures';
import { buildWatchtowerDestructionPlan, type WatchtowerDestructionPiece } from './WatchtowerDestructionPlan';

const MAX_COLLAPSES = 4;
let nextTextureOwner = 0;
interface PieceSlot { readonly image: Phaser.GameObjects.Image; plan: WatchtowerDestructionPiece | null }
interface CollapseSlot { ageMs: number; active: boolean; readonly pieces: PieceSlot[] }

/** World presentation owner. Call play at the removed tower's centre, clear on handoff,
 * destroy on world teardown. Owns its postupdate listener; needs no Scene update wiring.
 * The fixed image pool also bounds simultaneous mass-removal effects. No timers/tweens. */
export class WatchtowerDestructionFx {
  private readonly slots: CollapseSlot[] = [];
  private readonly woodKey: string;
  private readonly ironKey: string;
  private readonly impactKey: string;
  private destroyed = false;

  constructor(private readonly scene: Phaser.Scene) {
    const prefix = `watchtower-collapse-${nextTextureOwner++}`;
    this.woodKey = `${prefix}-wood`;
    this.ironKey = `${prefix}-iron`;
    this.impactKey = `${prefix}-impact`;
    this.createTextures();
    const count = buildWatchtowerDestructionPlan(0, 0, 1, 1).length;
    for (let i = 0; i < MAX_COLLAPSES; i++) {
      const pieces: PieceSlot[] = [];
      for (let j = 0; j < count; j++) {
        pieces.push({ image: scene.add.image(0, 0, this.woodKey)
          .setVisible(false).setActive(false).setDepth(DEPTH.ROCKS + .15), plan: null });
      }
      this.slots.push({ ageMs: 0, active: false, pieces });
    }
    scene.events.on('postupdate', this.update, this);
    scene.events.once('shutdown', this.destroy, this);
  }

  /** Returns false when invalid, offscreen, destroyed or the concurrent budget is full. */
  play(x: number, y: number, width: number, height = width): boolean {
    if (this.destroyed || ![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return false;
    const camera = this.scene.cameras?.main;
    if (camera) {
      const view = getVisibleWorldView(camera), margin = Math.max(width, height) * 1.6;
      if (x + margin < view.x || y + margin < view.y || x - margin > view.x + view.width
        || y - margin > view.y + view.height) return false;
    }
    const slot = this.slots.find(candidate => !candidate.active);
    if (!slot) return false;
    const plan = buildWatchtowerDestructionPlan(x, y, width, height);
    slot.ageMs = 0;
    slot.active = true;
    for (let i = 0; i < slot.pieces.length; i++) {
      const piece = slot.pieces[i], p = plan[i];
      piece.plan = p;
      const texture = p.material === 'iron' ? this.ironKey : p.material === 'dust' ? TEX_EXPLOSION_SMOKE
        : p.material === 'impact' ? this.impactKey : this.woodKey;
      piece.image.setTexture(texture).setPosition(p.x, p.y).setRotation(p.rotation)
        .setDisplaySize(p.width, p.height).setTint(p.tint).setAlpha(0).setVisible(false)
        .setDepth(DEPTH.ROCKS + (p.material === 'impact' ? .02 : p.material === 'dust' ? .1 : .15));
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
        const dust = p.material === 'dust', impact = p.material === 'impact';
        const scale = dust ? .55 + eased * 1.25 : impact ? .65 + eased * .55 : 1.12 - flight * .2;
        const fade = Math.max(0, (progress - (dust ? .12 : .55)) / (dust ? .88 : .45));
        const alpha = impact ? .34 * (1 - progress) ** 2
          : dust ? .58 * Math.min(1, age / 80) * (1 - fade) : .95 * (1 - fade);
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
    for (const key of [this.woodKey, this.ironKey, this.impactKey]) this.scene.textures.remove(key);
    // Explosion smoke is a borrowed scene texture used by other renderers.
  }

  private createTextures(): void {
    ensureExplosionSmokeTexture(this.scene);
    ensureCanvasTexture(this.scene.textures, this.woodKey, 48, 16, ctx => {
      ctx.beginPath(); ctx.moveTo(2, 3); ctx.lineTo(43, 1); ctx.lineTo(40, 5);
      ctx.lineTo(47, 7); ctx.lineTo(42, 14); ctx.lineTo(3, 15); ctx.lineTo(7, 10);
      ctx.lineTo(1, 8); ctx.closePath(); ctx.fillStyle = '#d8c6a5'; ctx.fill();
      ctx.save(); ctx.clip();
      ctx.fillStyle = '#fff0cd'; ctx.fillRect(3, 3, 39, 2);
      ctx.strokeStyle = '#8b765a'; ctx.lineWidth = 1;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(5 + i * 2, 7 + i * 3);
        ctx.bezierCurveTo(16, 5 + i * 3, 25, 10 + i * 2, 43, 6 + i * 3); ctx.stroke();
      }
      ctx.restore();
    });
    ensureCanvasTexture(this.scene.textures, this.ironKey, 20, 16, ctx => {
      ctx.fillStyle = '#b8bcb7'; ctx.beginPath(); ctx.moveTo(2, 2); ctx.lineTo(18, 1);
      ctx.lineTo(17, 7); ctx.lineTo(8, 8); ctx.lineTo(7, 15); ctx.lineTo(1, 13); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#eef0e6'; ctx.fillRect(3, 2, 13, 2);
      ctx.fillStyle = '#555c57'; ctx.beginPath(); ctx.arc(5, 6, 1.7, 0, Math.PI * 2); ctx.fill();
    });
    ensureCanvasTexture(this.scene.textures, this.impactKey, 96, 96, ctx => {
      const gradient = ctx.createRadialGradient(48, 48, 25, 48, 48, 47);
      gradient.addColorStop(0, 'rgba(255,255,255,0)');
      gradient.addColorStop(.45, 'rgba(255,255,255,.65)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 96, 96);
    });
  }
}
