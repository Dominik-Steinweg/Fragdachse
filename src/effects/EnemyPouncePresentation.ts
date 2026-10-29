import * as Phaser from 'phaser';
import { getCoopDefenseEnemyConfig } from '../config/coopDefenseEnemies';
import type { EnemyVisualSource } from '../entities/EnemyVisualSource';
import { enemyPouncePhaseAt, type EnemyPounceTargetRef } from '../systems/EnemyPounceState';
import { createPounceReticle, createPounceTargetTrack, pounceAirMs, predictPounceLanding, stepPounceReticle, trackPounceTarget,
  type PounceReticle, type PounceTargetTrack } from '../systems/enemyPounceRules';
import type { EnemyLandingMark } from './EnemyClawRenderer';

export type EnemyPounceMarkSink = (id: string, mark: EnemyLandingMark | null, now: number, visible: boolean) => void;
/** Displayed position of a hunted body (the local player uses its predicted position), or null. */
export type EnemyPounceTargetResolver = (target: EnemyPounceTargetRef) => { x: number; y: number } | null;

/** The landing mark lingers briefly after the impact so the hit reads. */
const IMPACT_LINGER_MS = 80;
/** Display smoothing of the mark centre: the hint glides instead of twitching with every turn. */
const MARK_GLIDE_MS = 90;
/** Below this residual the smoothed mark sits exactly on its aim point. */
const MARK_SNAP_PX = 1;

interface MarkTrack {
  aimAt: number;
  track: PounceTargetTrack;
  reticle: PounceReticle;
  x: number;
  y: number;
  at: number;
}

/**
 * Always-on, light telegraph owner of the pounce, on one calm timeline per leap: while a body aims,
 * a faint hint in the shared danger family glides where it would land if the target keeps its
 * course; at the lock it firms up into a mark on the announced landing point whose soft ring closes
 * at the impact. The body itself carries the take-off signal (see `pounceMenace`), so there is no
 * lane. It only observes replicated state.
 */
export class EnemyPouncePresentation {
  private enemies: () => readonly EnemyVisualSource[] = () => [];
  private clock: () => number = () => this.scene.time.now;
  private resolveTarget: EnemyPounceTargetResolver = () => null;
  private markSink: EnemyPounceMarkSink | null = null;
  private readonly sunk = new Set<string>();
  /** Target velocity, speed-limited aim point and smoothed mark centre per pouncing body. */
  private readonly tracks = new Map<string, MarkTrack>();

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.render, this);
  }

  setEnemySource(source: () => readonly EnemyVisualSource[]): void { this.enemies = source; }
  /** Host-synchronised time: pounce timestamps are host timestamps. */
  setClock(clock: () => number): void { this.clock = clock; }
  setTargetResolver(resolver: EnemyPounceTargetResolver): void { this.resolveTarget = resolver; }
  /** Landing marks are drawn by the shared enemy danger renderer. */
  setMarkSink(sink: EnemyPounceMarkSink | null): void { this.markSink = sink; }

  clear(): void {
    const now = this.clock();
    for (const id of this.sunk) this.markSink?.(id, null, now, false);
    this.sunk.clear();
    this.tracks.clear();
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.render, this);
    this.clear();
  }

  private render(): void {
    const now = this.clock();
    const live = new Set<string>();
    for (const enemy of this.enemies()) {
      const config = getCoopDefenseEnemyConfig(enemy.kind).pounce;
      if (!config || !enemy.sprite.active || enemy.faction !== 'hostile') continue;
      const state = enemy.getPounceState?.();
      const pounce = state?.pounce;
      const phase = state ? enemyPouncePhaseAt(state, now) : 'idle';
      const landing = pounce?.landing;
      const showing = !!pounce && (phase === 'aim'
        || (landing?.armed === true && (phase === 'lock' || phase === 'air' || now < landing.landAt + IMPACT_LINGER_MS)));
      if (!pounce || !showing) {
        if (this.sunk.has(enemy.id)) this.release(enemy.id, now);
        continue;
      }
      let entry = this.tracks.get(enemy.id);
      if (entry && entry.aimAt !== pounce.aimAt) entry = undefined;
      let aimX: number, aimY: number, hitAt: number;
      if (landing) {
        aimX = landing.x; aimY = landing.y; hitAt = landing.landAt;
      } else {
        // Before the lock the hint predicts the landing from the target's displayed course.
        const target = this.resolveTarget(pounce.target);
        if (!target) { this.release(enemy.id, now); continue; }
        if (!entry) {
          const reticle = createPounceReticle(target.x, target.y, now, pounce.originX, pounce.originY, config);
          entry = { aimAt: pounce.aimAt, track: createPounceTargetTrack(target.x, target.y, now), reticle,
            x: reticle.x, y: reticle.y, at: now };
        } else trackPounceTarget(entry.track, target.x, target.y, now);
        const predicted = predictPounceLanding(pounce.originX, pounce.originY, target.x, target.y, entry.track.vx, entry.track.vy,
          Math.max(0, pounce.lockAt - now) + config.lockMs, config);
        // The same speed-limited aim point as the host: the hint swings over instead of flipping with every turn.
        stepPounceReticle(entry.reticle, target.x, target.y, predicted.x, predicted.y, now, pounce.originX, pounce.originY, config);
        aimX = entry.reticle.x; aimY = entry.reticle.y;
        hitAt = Math.max(now, pounce.lockAt) + config.lockMs
          + pounceAirMs(Math.hypot(aimX - pounce.originX, aimY - pounce.originY), config);
      }
      entry ??= { aimAt: pounce.aimAt, track: createPounceTargetTrack(aimX, aimY, now),
        reticle: { x: aimX, y: aimY, offsetX: 0, offsetY: 0, at: now }, x: aimX, y: aimY, at: now };
      this.tracks.set(enemy.id, entry);
      glide(entry, aimX, aimY, now);
      live.add(enemy.id);
      this.sunk.add(enemy.id);
      this.markSink?.(enemy.id, { attackId: `pounce:${enemy.id}:${pounce.aimAt}`, x: entry.x, y: entry.y,
        radius: config.impact.radiusPx, startedAt: pounce.aimAt, lockAt: pounce.lockAt, hitAt }, now, enemy.sprite.visible);
    }
    for (const id of [...this.sunk]) if (!live.has(id)) this.release(id, now);
    for (const id of [...this.tracks.keys()]) if (!live.has(id)) this.tracks.delete(id);
  }

  private release(id: string, now: number): void {
    this.markSink?.(id, null, now, false);
    this.sunk.delete(id);
    this.tracks.delete(id);
  }
}

/** Frame-rate independent glide of the displayed mark towards its aim point. */
function glide(entry: MarkTrack, x: number, y: number, now: number): void {
  const blend = 1 - Math.exp(-Math.max(0, now - entry.at) / MARK_GLIDE_MS);
  entry.at = Math.max(entry.at, now);
  entry.x += (x - entry.x) * blend;
  entry.y += (y - entry.y) * blend;
  if (Math.hypot(x - entry.x, y - entry.y) < MARK_SNAP_PX) { entry.x = x; entry.y = y; }
}
