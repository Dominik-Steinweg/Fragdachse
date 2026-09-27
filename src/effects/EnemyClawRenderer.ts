import * as Phaser from 'phaser';
import { DEPTH, DEPTH_TRACE } from '../config';
import type { SyncedMeleeSwing } from '../types';
import type { EnemyClawAttack, EnemyClawState } from '../systems/EnemyClawAttack';
import { createEmitter, ensureCanvasTexture, killAllAndResetParticlePositions, registerGraphicsObject } from './EffectUtils';

interface Telegraph {
  readonly attack: EnemyClawAttack;
  readonly graphics: Phaser.GameObjects.Graphics;
  crossedImpact: boolean;
}

/** Scene-owned visual pools. Only the host's melee result emits contact/blood particles. */
export class EnemyClawRenderer {
  private readonly telegraphs = new Map<string, Telegraph>();
  private readonly freeTelegraphs: Phaser.GameObjects.Graphics[] = [];
  private readonly slashes = new Set<Phaser.GameObjects.Graphics>();
  private readonly freeSlashes: Phaser.GameObjects.Graphics[] = [];
  private readonly struck = new Map<string, number>();
  private readonly confirmed = new Map<string, number>();
  private flecks: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private blood: Phaser.GameObjects.Particles.ParticleEmitter | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  sync(id: string, state: EnemyClawState, x: number, y: number, now: number, visible: boolean): void {
    const attack = state.attack;
    if (!attack || now >= attack.endsAt || !visible) { this.release(id); return; }
    let current = this.telegraphs.get(id);
    if (current?.attack.attackId !== attack.attackId) {
      this.release(id);
      const graphics = this.freeTelegraphs.pop() ?? this.graphics('enemyStatus');
      graphics.clear().setDepth(DEPTH.PLAYERS - .1).setVisible(true);
      const half = attack.arcDegrees * Math.PI / 360;
      const points = [new Phaser.Math.Vector2(0, 0)];
      for (let i = 0; i <= 24; i++) {
        const angle = -half + 2 * half * i / 24;
        points.push(new Phaser.Math.Vector2(Math.cos(angle) * attack.range, Math.sin(angle) * attack.range));
      }
      graphics.fillStyle(0xd55340, .085).fillPoints(points, true);
      graphics.lineStyle(1.5, 0xf18b6d, .9).strokePoints(points.slice(1), false);
      graphics.lineStyle(1, 0xa84437, .55);
      graphics.lineBetween(0, 0, points[1].x, points[1].y);
      graphics.lineBetween(0, 0, points[points.length - 1].x, points[points.length - 1].y);
      // An initial late snapshot establishes a baseline, never replays past strikes.
      current = { attack, graphics, crossedImpact: now >= attack.hitAt };
      if (current.crossedImpact) { this.prune(); this.struck.set(attack.attackId, now); }
      this.telegraphs.set(id, current);
    }
    const progress = Math.max(0, Math.min(1, (now - attack.startedAt) / (attack.hitAt - attack.startedAt)));
    current.graphics.setPosition(x, y).setRotation(attack.angle).setAlpha(.45 + .5 * progress).setVisible(now < attack.hitAt);
    if (!current.crossedImpact && now >= attack.hitAt) {
      current.crossedImpact = true;
      this.strike(attack.attackId, x, y, attack.angle, attack.range, attack.arcDegrees);
    }
  }

  confirm(swing: SyncedMeleeSwing): void {
    const id = swing.clawAttackId ?? `${swing.shooterId}:${swing.swingId}`;
    this.prune();
    if (this.confirmed.has(id)) return;
    this.confirmed.set(id, this.scene.time.now + 4000);
    this.strike(id, swing.x, swing.y, swing.angle, swing.range, swing.arcDegrees);
    if (!swing.hitPlayer || swing.impactX === undefined || swing.impactY === undefined) return;
    this.ensureParticles();
    this.blood!.setEmitterAngle({ min: Phaser.Math.RadToDeg(swing.angle) - 24, max: Phaser.Math.RadToDeg(swing.angle) + 24 });
    this.blood!.explode(Math.min(8, Math.max(0, Math.round(5 * (swing.bloodEffectMultiplier ?? 1)))), swing.impactX, swing.impactY);
  }

  private strike(id: string, x: number, y: number, angle: number, range: number, arc: number): void {
    this.prune();
    if (this.struck.has(id)) return;
    this.struck.set(id, this.scene.time.now + 4000);
    if (this.slashes.size >= 96) return;
    const graphics = this.freeSlashes.pop() ?? this.graphics('biteEffects');
    graphics.clear().setPosition(x, y).setRotation(angle).setDepth(DEPTH_TRACE).setAlpha(1).setVisible(true);
    this.slashes.add(graphics);
    // Mirrored tapered claw wakes, contained inside the announced sector.
    const spread = Math.sin(arc * Math.PI / 360) * .66;
    for (const side of [-1, 1]) {
      const edge: Phaser.Math.Vector2[] = [], inner: Phaser.Math.Vector2[] = [];
      for (let i = 0; i <= 14; i++) {
        const t = i / 14, px = range * (.20 + .72 * t);
        const py = side * range * spread * (.18 + .63 * t + .25 * Math.sin(t * Math.PI));
        const width = range * .055 * Math.sin(Math.PI * t);
        edge.push(new Phaser.Math.Vector2(px, py + width)); inner.unshift(new Phaser.Math.Vector2(px, py - width));
      }
      graphics.fillStyle(0x472720, .72).fillPoints([...edge, ...inner], true);
      graphics.lineStyle(Math.max(.8, range * .013), 0xf4d8b7, .93).strokePoints(edge, false);
    }
    this.scene.tweens.add({ targets: graphics, alpha: 0, duration: 155, ease: 'Cubic.easeOut', onComplete: () => {
      this.slashes.delete(graphics); graphics.clear().setVisible(false); this.freeSlashes.push(graphics);
    } });
    this.ensureParticles();
    this.flecks!.setEmitterAngle({ min: Phaser.Math.RadToDeg(angle) - 15, max: Phaser.Math.RadToDeg(angle) + 15 });
    for (const side of [-1, 1]) {
      const dx = range * .72, dy = side * range * spread * .64;
      this.flecks!.explode(2, x + Math.cos(angle) * dx - Math.sin(angle) * dy, y + Math.sin(angle) * dx + Math.cos(angle) * dy);
    }
  }

  private graphics(family: 'enemyStatus' | 'biteEffects'): Phaser.GameObjects.Graphics {
    const graphics = this.scene.add.graphics();
    if (family === 'enemyStatus') registerGraphicsObject(this.scene, 'enemyStatus', graphics);
    else registerGraphicsObject(this.scene, 'biteEffects', graphics);
    return graphics;
  }

  private ensureParticles(): void {
    if (this.flecks) return;
    ensureCanvasTexture(this.scene.textures, '__enemy_claw_fleck', 12, 6, ctx => {
      const gradient = ctx.createLinearGradient(0, 0, 12, 0);
      gradient.addColorStop(0, 'rgba(255,255,255,0)'); gradient.addColorStop(.65, 'rgba(255,255,255,.95)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient; ctx.beginPath(); ctx.moveTo(0, 3); ctx.lineTo(9, 1); ctx.lineTo(12, 3); ctx.lineTo(9, 5); ctx.closePath(); ctx.fill();
    });
    this.flecks = createEmitter(this.scene, 0, 0, '__enemy_claw_fleck', {
      emitting: false, lifespan: { min: 90, max: 160 }, speed: { min: 35, max: 95 },
      scale: { start: .42, end: .05 }, alpha: { start: .75, end: 0 }, tint: 0xebc5a1,
      maxParticles: 384, maxAliveParticles: 192,
    }, DEPTH_TRACE, 'standard', 'bite');
    this.blood = createEmitter(this.scene, 0, 0, '__enemy_claw_fleck', {
      emitting: false, lifespan: { min: 120, max: 220 }, speed: { min: 35, max: 100 },
      scale: { start: .55, end: .1 }, alpha: { start: .85, end: 0 }, tint: 0x9e302a,
      maxParticles: 256, maxAliveParticles: 128,
    }, DEPTH_TRACE, 'standard', 'bite');
  }

  private prune(): void {
    // Keep recent identities across long packet delays, with a fixed memory bound.
    for (const entries of [this.struck, this.confirmed]) while (entries.size >= 4096) entries.delete(entries.keys().next().value!);
  }

  release(id: string): void {
    const entry = this.telegraphs.get(id);
    if (!entry) return;
    entry.graphics.clear().setVisible(false);
    if (this.freeTelegraphs.length < 128) this.freeTelegraphs.push(entry.graphics); else entry.graphics.destroy();
    this.telegraphs.delete(id);
  }

  clear(): void {
    for (const id of this.telegraphs.keys()) this.release(id);
    for (const graphics of this.slashes) {
      this.scene.tweens.killTweensOf(graphics); graphics.clear().setVisible(false); this.freeSlashes.push(graphics);
    }
    this.slashes.clear(); this.struck.clear(); this.confirmed.clear();
    for (const emitter of [this.flecks, this.blood]) if (emitter) killAllAndResetParticlePositions(emitter);
  }

  destroy(): void {
    this.clear();
    for (const graphics of [...this.freeTelegraphs, ...this.freeSlashes]) graphics.destroy();
    this.freeTelegraphs.length = this.freeSlashes.length = 0;
    this.flecks?.destroy(); this.blood?.destroy(); this.flecks = this.blood = null;
  }
}
