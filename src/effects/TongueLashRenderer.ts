import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import type { EnemyClawAttack } from '../systems/EnemyClawAttack';
import type { SyncedMeleeSwing } from '../types';
import { registerGraphicsObject } from './EffectUtils';

/** Zombie tongue: bruised rose-violet flesh with a dark rim (enemy anatomy, not a heal colour). */
const TONGUE = { rim: 0x34101f, flesh: 0x93355f, sheen: 0xd47aa2, tip: 0xa8406f } as const;
const BASE_WIDTH_PX = 7;
const TIP_WIDTH_PX = 3.4;
const TIP_RADIUS_PX = 5;
const SEGMENTS = 12;
/** The tongue rests at full reach this long after the hit before it snaps back. */
const HOLD_MS = 70;
/** A swing without a seen windup (allied toads, late joiners) still lashes out and back. */
const QUICK_LASH_MS = { extend: 70, hold: 40, retract: 120 } as const;
const SPLAT_MS = 260;
/** The tongue leaves the mouth this far in front of the body centre (share of the body radius). */
const MOUTH_OFFSET = 0.8;

interface Lash {
  readonly attackId: string;
  x: number;
  y: number;
  readonly angle: number;
  readonly radius: number;
  readonly range: number;
  /** Local presentation clock. */
  readonly strikeAt: number;
  readonly hitAt: number;
  readonly endsAt: number;
  reach: number;
  splatAt: number | null;
  splatX: number;
  splatY: number;
}

/**
 * Runtime tongue of melee weapons with the `enemy_tongue` preset (Quacksalber toad): it shoots out
 * of the mouth along the replicated windup between strike and hit, holds, and snaps back by the end
 * of the attack. A confirmed hit shortens it to the contact and leaves a sticky splat. The sprite
 * clip only carries the lunge; gameplay stays the shared melee swing.
 */
export class TongueLashRenderer {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly lashes = new Map<string, Lash>();
  private serial = 0;

  constructor(private readonly scene: Phaser.Scene) {
    // Under the body: the tongue leaves from beneath the head, above the ground.
    this.gfx = scene.add.graphics().setDepth(DEPTH.PLAYERS - 0.06);
    registerGraphicsObject(scene, 'tongueLash', this.gfx);
    scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.update, this);
  }

  /** Mirrors the replicated windup of one enemy; `null` or a hidden body releases its tongue. */
  sync(id: string, attack: EnemyClawAttack | null, x: number, y: number, radius: number, now: number, visible: boolean): void {
    const lash = this.lashes.get(id);
    if (!attack || !visible) {
      if (lash && this.scene.time.now >= lash.endsAt) this.lashes.delete(id);
      return;
    }
    if (lash?.attackId === attack.attackId) { lash.x = x; lash.y = y; return; }
    const offset = this.scene.time.now - now;
    this.lashes.set(id, { attackId: attack.attackId, x, y, angle: attack.angle, radius, range: attack.range,
      strikeAt: attack.strikeAt + offset, hitAt: attack.hitAt + offset, endsAt: Math.max(attack.endsAt, attack.hitAt + HOLD_MS + 80) + offset,
      reach: attack.range, splatAt: null, splatX: 0, splatY: 0 });
  }

  /** Host result of the lash: a hit shortens the tongue to the contact; an unseen windup plays a quick lash. */
  confirm(swing: SyncedMeleeSwing, radius: number): void {
    const local = this.scene.time.now;
    let lash = [...this.lashes.values()].find(entry => entry.attackId === swing.clawAttackId);
    if (!lash) {
      lash = { attackId: swing.clawAttackId ?? `quick:${++this.serial}`, x: swing.x, y: swing.y, angle: swing.angle, radius,
        range: swing.range, strikeAt: local, hitAt: local + QUICK_LASH_MS.extend,
        endsAt: local + QUICK_LASH_MS.extend + QUICK_LASH_MS.hold + QUICK_LASH_MS.retract,
        reach: swing.range, splatAt: null, splatX: 0, splatY: 0 };
      this.lashes.set(`${swing.shooterId}:${lash.attackId}`, lash);
    }
    if (swing.hitPlayer && swing.impactX !== undefined && swing.impactY !== undefined) {
      const mouth = this.mouth(lash);
      lash.reach = Math.max(8, Math.min(lash.range, Math.hypot(swing.impactX - mouth.x, swing.impactY - mouth.y)));
      lash.splatAt = Math.max(local, lash.hitAt); lash.splatX = swing.impactX; lash.splatY = swing.impactY;
    }
  }

  update(): void {
    const now = this.scene.time.now;
    const g = this.gfx;
    g.clear();
    for (const [id, lash] of this.lashes) {
      if (now >= lash.endsAt + SPLAT_MS) { this.lashes.delete(id); continue; }
      const extension = this.extension(lash, now);
      if (extension > 0) this.drawTongue(g, lash, extension, now);
      if (lash.splatAt !== null && now >= lash.splatAt && now < lash.splatAt + SPLAT_MS) this.drawSplat(g, lash, now - lash.splatAt);
    }
  }

  clear(): void { this.lashes.clear(); this.gfx.clear(); }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.update, this);
    this.lashes.clear();
    this.gfx.destroy();
  }

  private extension(lash: Lash, now: number): number {
    if (now < lash.strikeAt) return 0;
    if (now < lash.hitAt) {
      const t = (now - lash.strikeAt) / Math.max(1, lash.hitAt - lash.strikeAt);
      return 1 - (1 - t) * (1 - t);
    }
    const holdEnd = lash.hitAt + HOLD_MS;
    if (now < holdEnd) return 1;
    const t = (now - holdEnd) / Math.max(1, lash.endsAt - holdEnd);
    return t >= 1 ? 0 : 1 - t * t;
  }

  private mouth(lash: Lash): { x: number; y: number } {
    const reach = lash.radius * MOUTH_OFFSET;
    return { x: lash.x + Math.cos(lash.angle) * reach, y: lash.y + Math.sin(lash.angle) * reach };
  }

  private drawTongue(g: Phaser.GameObjects.Graphics, lash: Lash, extension: number, now: number): void {
    const mouth = this.mouth(lash);
    const length = lash.reach * extension;
    const cos = Math.cos(lash.angle), sin = Math.sin(lash.angle);
    // A slack tongue sags sideways while it travels and straightens at full reach.
    const slack = (1 - extension) * 0.5 + 0.08;
    const wave = Math.sin(now * 0.03 + lash.angle * 3) * length * 0.07 * slack;
    const point = (t: number) => {
      const bend = Math.sin(Math.PI * t) * wave;
      return { x: mouth.x + cos * length * t - sin * bend, y: mouth.y + sin * length * t + cos * bend };
    };
    let previous = point(0);
    for (let i = 1; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS, next = point(t);
      const width = BASE_WIDTH_PX + (TIP_WIDTH_PX - BASE_WIDTH_PX) * t;
      g.lineStyle(width + 2.2, TONGUE.rim, 0.95).lineBetween(previous.x, previous.y, next.x, next.y);
      g.lineStyle(width, TONGUE.flesh, 1).lineBetween(previous.x, previous.y, next.x, next.y);
      g.lineStyle(Math.max(1, width * 0.28), TONGUE.sheen, 0.55).lineBetween(previous.x, previous.y, next.x, next.y);
      previous = next;
    }
    g.fillStyle(TONGUE.rim, 0.95).fillCircle(previous.x, previous.y, TIP_RADIUS_PX + 1.2);
    g.fillStyle(TONGUE.tip, 1).fillCircle(previous.x, previous.y, TIP_RADIUS_PX);
    g.fillStyle(TONGUE.sheen, 0.6).fillCircle(previous.x - cos * 1.2 - sin * 1.4, previous.y - sin * 1.2 + cos * 1.4, TIP_RADIUS_PX * 0.35);
  }

  /** Sticky slime flecks at the contact, gone within a quarter second. */
  private drawSplat(g: Phaser.GameObjects.Graphics, lash: Lash, age: number): void {
    const t = age / SPLAT_MS, alpha = 1 - t;
    for (let i = 0; i < 5; i++) {
      const angle = lash.angle + Math.PI + (i - 2) * 0.55;
      const distance = 4 + 10 * t * (1 + (i % 2) * 0.6);
      g.fillStyle(TONGUE.flesh, 0.7 * alpha).fillCircle(lash.splatX + Math.cos(angle) * distance,
        lash.splatY + Math.sin(angle) * distance, 2.6 * (1 - t * 0.5));
    }
  }
}
