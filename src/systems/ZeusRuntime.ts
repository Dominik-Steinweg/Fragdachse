import type { ProjectileHomingConfig } from '../types';
import type { CombatTargetRef } from '../combat/CombatScope';
import { combatTargetInstanceKey } from '../combat/CombatScope';
import type { CombatDamageMutationOutcome } from '../combat/CombatMutation';
import type { SyncedCombatStun } from './CombatStunStatusSystem';

export interface ZeusConfig {
  readonly dynamoRefundMs: number;
  readonly stunDurationMs: number;
  /** Positive duration enables the charged electrical body. */
  readonly ballDurationMs: number;
  readonly groundEnabled: number;
  readonly stormEnabled: number;
  readonly extraBolts: number;
  readonly killRangeBonus: number;
  readonly groundDurationMs: number;
  readonly groundDamagePerSecond: number;
  readonly groundMoveBonus: number;
  readonly groundMoveDurationMs: number;
  readonly boltCount: number;
  readonly boltDamage: number;
  readonly boltSpeed: number;
  readonly boltSize: number;
  readonly boltRange: number;
  readonly boltJitterDegrees: number;
  readonly boltHoming: ProjectileHomingConfig;
}
export interface ZeusPoint { readonly x: number; readonly y: number; readonly radius: number }
export interface ZeusTarget extends ZeusPoint { readonly ref: CombatTargetRef }
export interface ZeusMovement extends ZeusPoint {
  readonly playerId: string;
  readonly positionRevision: number;
}
export interface ZeusUse {
  readonly id: number;
  readonly ownerId: string;
  readonly color: number;
  readonly angle: number;
  readonly damage: number;
  readonly damageMultiplier: number;
  readonly config: ZeusConfig;
}
interface Ball { readonly use: ZeusUse; readonly hit: Set<string>; readonly expiresAt: number; previous: ZeusMovement }
export interface ZeusGround {
  readonly id: number;
  readonly ownerId: string;
  readonly from: ZeusPoint;
  readonly to: ZeusPoint;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly color: number;
}
interface GroundState { readonly view: ZeusGround; readonly use: ZeusUse }
export interface ZeusSnapshot {
  readonly balls: readonly (ZeusMovement & { readonly useId: number; readonly color: number; readonly expiresAt: number })[];
  readonly ground: readonly ZeusGround[];
  readonly stuns: readonly SyncedCombatStun[];
}
export const EMPTY_ZEUS_SNAPSHOT: ZeusSnapshot = { balls: [], ground: [], stuns: [] };
export interface ZeusPorts {
  readonly isOwnerActive?: (ownerId: string) => boolean;
  readonly queryTargets: (minX: number, minY: number, maxX: number, maxY: number) => readonly ZeusTarget[];
  readonly canHit: (ownerId: string, target: ZeusTarget, x: number, y: number) => boolean;
  readonly damage: (use: ZeusUse, target: ZeusTarget, amount: number, origin: ZeusPoint, ground: boolean, now: number) => CombatDamageMutationOutcome | null;
  readonly stun: (target: CombatTargetRef, durationMs: number, now: number) => void;
  readonly bolt: (use: ZeusUse, target: ZeusTarget, angle: number, range: number) => void;
  readonly friendlyPlayers: (ownerId: string) => readonly (ZeusPoint & { readonly id: string })[];
  readonly random?: () => number;
}

/** First time a linearly changing circle reaches a target circle, including growth at rest. */
export function zeusSweepTime(from: ZeusPoint, to: ZeusPoint, target: ZeusPoint): number | null {
  const x = from.x - target.x, y = from.y - target.y;
  const dx = to.x - from.x, dy = to.y - from.y;
  const r = from.radius + target.radius, dr = to.radius - from.radius;
  const c = x * x + y * y - r * r;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy - dr * dr;
  const b = 2 * (x * dx + y * dy - r * dr);
  const roots = Math.abs(a) < 1e-9 ? (Math.abs(b) < 1e-9 ? [] : [-c / b])
    : b * b - 4 * a * c < 0 ? [] : [(-b - Math.sqrt(b * b - 4 * a * c)) / (2 * a), (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a)];
  return roots.filter(t => t >= 0 && t <= 1).sort((l, r) => l - r)[0] ?? null;
}

/** Owns electrical reactions and ground. Movement and damage authority stay behind ports. */
export class ZeusRuntime {
  private readonly balls = new Map<string, Ball>();
  private readonly ground = new Map<number, GroundState>();
  private readonly groundBuckets = new Map<string, Set<number>>();
  private readonly speed = new Map<string, { bonus: number; until: number }>();
  private sequence = 0;
  private destroyed = false;
  private lastGroundStep: number | null = null;
  constructor(private readonly ports: ZeusPorts) {}

  createUse(ownerId: string, color: number, angle: number, damage: number, damageMultiplier: number, config: ZeusConfig): ZeusUse {
    if (this.destroyed) throw new Error('Zeus world has ended');
    return { id: ++this.sequence, ownerId, color, angle, damage, damageMultiplier, config: structuredClone(config) };
  }
  startBall(use: ZeusUse, movement: ZeusMovement, now: number): void {
    this.balls.set(use.ownerId, { use, previous: movement, hit: new Set(), expiresAt: now + use.config.ballDurationMs });
    this.move(movement, now);
  }
  endBall(ownerId: string): void {
    this.balls.delete(ownerId);
  }
  canApplyDashImpact(ownerId: string, target: CombatTargetRef | null): boolean {
    const ball = this.balls.get(ownerId);
    return !ball || (target !== null && ball.hit.has(combatTargetInstanceKey(target)));
  }
  move(next: ZeusMovement, now: number): void {
    if (this.destroyed) return;
    const ball = this.balls.get(next.playerId);
    if (!ball) return;
    if (now >= ball.expiresAt || this.ports.isOwnerActive?.(ball.use.ownerId) === false) { this.endBall(next.playerId); return; }
    const from = ball.previous.positionRevision === next.positionRevision ? ball.previous : next;
    ball.previous = next;
    const r = Math.max(from.radius, next.radius);
    const candidates = this.ports.queryTargets(Math.min(from.x, next.x) - r, Math.min(from.y, next.y) - r,
      Math.max(from.x, next.x) + r, Math.max(from.y, next.y) + r)
      .map(target => ({ target, t: zeusSweepTime(from, next, target) }))
      .filter((c): c is { target: ZeusTarget; t: number } => c.t !== null)
      .sort((a, b) => a.t - b.t || combatTargetInstanceKey(a.target.ref).localeCompare(combatTargetInstanceKey(b.target.ref)));
    for (const { target, t } of candidates) {
      if (this.destroyed) return;
      if (this.ports.isOwnerActive?.(ball.use.ownerId) === false) { this.endBall(next.playerId); return; }
      const key = combatTargetInstanceKey(target.ref);
      if (ball.hit.has(key)) continue;
      const origin = { x: from.x + (next.x - from.x) * t, y: from.y + (next.y - from.y) * t, radius: from.radius + (next.radius - from.radius) * t };
      if (!this.ports.canHit(ball.use.ownerId, target, origin.x, origin.y)) continue;
      ball.hit.add(key);
      const outcome = this.ports.damage(ball.use, target, ball.use.damage, origin, false, now);
      this.directHit(ball.use, target, outcome, true, now);
    }
    if (this.ports.isOwnerActive?.(ball.use.ownerId) === false) { this.endBall(next.playerId); return; }
    if (!this.destroyed && ball.use.config.groundEnabled > 0 && Math.hypot(next.x - from.x, next.y - from.y) > 0.01) {
      const view: ZeusGround = { id: ++this.sequence, ownerId: next.playerId,
        from: { x: from.x, y: from.y, radius: from.radius }, to: { x: next.x, y: next.y, radius: next.radius },
        createdAt: now, expiresAt: now + ball.use.config.groundDurationMs, color: ball.use.color };
      this.ground.set(view.id, { view, use: ball.use });
      for (const key of this.bucketKeys(view.from, view.to)) {
        let bucket = this.groundBuckets.get(key);
        if (!bucket) this.groundBuckets.set(key, bucket = new Set());
        bucket.add(view.id);
      }
    }
  }
  directHit(use: ZeusUse, target: ZeusTarget, outcome: CombatDamageMutationOutcome | null, ball: boolean, now: number): void {
    if (this.destroyed || outcome?.kind !== 'damage-applied' || outcome.actualDamage <= 0) return;
    if (outcome.transition.kind === 'none') this.ports.stun(outcome.target, use.config.stunDurationMs, now);
    if (use.config.stormEnabled <= 0) return;
    const count = Math.max(0, Math.floor(use.config.boltCount + use.config.extraBolts));
    const spread = ball ? Math.PI * 2 : Math.PI * 2 / 3;
    const step = spread / Math.max(1, ball ? count : count - 1);
    const jitter = Math.min(use.config.boltJitterDegrees * Math.PI / 180, step * 0.4);
    const range = use.config.boltRange * (1 + (outcome.transition.kind === 'dead' ? use.config.killRangeBonus : 0));
    for (let i = 0; i < count && !this.destroyed; i++) {
      const angle = (ball ? 0 : use.angle - spread / 2) + step * i + ((this.ports.random?.() ?? Math.random()) * 2 - 1) * jitter;
      this.ports.bolt(use, target, angle, range);
    }
  }
  step(now: number): void {
    if (this.destroyed) return;
    for (const [id, ball] of this.balls) if (now >= ball.expiresAt || this.ports.isOwnerActive?.(id) === false) this.endBall(id);
    const previous = this.lastGroundStep ?? now;
    this.lastGroundStep = now;
    // Aggregate overlapping segments before committing damage: at most one contribution per owner.
    const contributions = new Map<string, { target: ZeusTarget; state: GroundState; seconds: number }>();
    for (const state of this.ground.values()) {
      const g = state.view;
      if (g.expiresAt <= previous) continue;
      const r = Math.max(g.from.radius, g.to.radius);
      const seconds = Math.max(0, Math.min(now, g.expiresAt) - Math.max(previous, g.createdAt)) / 1000;
      for (const target of this.ports.queryTargets(Math.min(g.from.x, g.to.x) - r, Math.min(g.from.y, g.to.y) - r,
        Math.max(g.from.x, g.to.x) + r, Math.max(g.from.y, g.to.y) + r)) {
        const t = zeusSweepTime(g.from, g.to, target);
        if (t === null || !this.ports.canHit(g.ownerId, target,
          g.from.x + (g.to.x - g.from.x) * t, g.from.y + (g.to.y - g.from.y) * t)) continue;
        const key = g.ownerId + ':' + combatTargetInstanceKey(target.ref);
        const old = contributions.get(key);
        if (!old || old.seconds * old.state.use.config.groundDamagePerSecond * old.state.use.damageMultiplier < seconds * state.use.config.groundDamagePerSecond * state.use.damageMultiplier)
          contributions.set(key, { target, state, seconds });
      }
    }
    const owners = new Set([...this.ground.values()].filter(g => g.view.expiresAt > now).map(g => g.view.ownerId));
    for (const owner of owners) for (const player of this.ports.friendlyPlayers(owner)) {
      const nearby = new Set<number>();
      for (const key of this.bucketKeys(player, player)) for (const id of this.groundBuckets.get(key) ?? []) nearby.add(id);
      for (const id of nearby) {
        const state = this.ground.get(id)!;
        const g = state.view;
        if (g.ownerId !== owner || g.expiresAt <= now || zeusSweepTime(g.from, g.to, player) === null) continue;
        const old = this.speed.get(player.id);
        this.speed.set(player.id, { bonus: Math.max(old && old.until > now ? old.bonus : 0, state.use.config.groundMoveBonus),
          until: now + state.use.config.groundMoveDurationMs });
      }
    }
    for (const { target, state, seconds } of contributions.values()) if (seconds > 0)
      this.ports.damage(state.use, target, seconds * state.use.config.groundDamagePerSecond, target, true, now);
    for (const [id, state] of this.ground) if (state.view.expiresAt <= now) {
      for (const key of this.bucketKeys(state.view.from, state.view.to)) {
        const bucket = this.groundBuckets.get(key); bucket?.delete(id); if (!bucket?.size) this.groundBuckets.delete(key);
      }
      this.ground.delete(id);
    }
    for (const [id, value] of this.speed) if (value.until <= now) this.speed.delete(id);
  }
  getMoveBonus(playerId: string, now: number): number { const s = this.speed.get(playerId); return s && now < s.until ? s.bonus : 0; }
  snapshot(stuns: readonly SyncedCombatStun[] = []): ZeusSnapshot {
    return { balls: [...this.balls.values()].map(b => ({ ...b.previous, useId: b.use.id, color: b.use.color, expiresAt: b.expiresAt })),
      ground: [...this.ground.values()].map(g => g.view), stuns };
  }
  removePlayer(id: string): void { this.endBall(id); this.speed.delete(id); }
  destroy(): void { this.destroyed = true; this.balls.clear(); this.ground.clear(); this.groundBuckets.clear(); this.speed.clear(); this.lastGroundStep = null; }
  private *bucketKeys(from: ZeusPoint, to: ZeusPoint): Generator<string> {
    const r = Math.max(from.radius, to.radius), size = 128;
    for (let x = Math.floor((Math.min(from.x, to.x) - r) / size); x <= Math.floor((Math.max(from.x, to.x) + r) / size); x++)
      for (let y = Math.floor((Math.min(from.y, to.y) - r) / size); y <= Math.floor((Math.max(from.y, to.y) + r) / size); y++) yield `${x}:${y}`;
  }
}
