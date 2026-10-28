import * as Phaser from 'phaser';
import { getCoopDefenseEnemyConfig } from '../config/coopDefenseEnemies';
import type { EnemyVisualSource } from '../entities/EnemyVisualSource';
import { enemyPouncePhaseAt, type EnemyPounceTargetRef } from '../systems/EnemyPounceState';
import { createPounceTargetTrack, predictPounceLanding, trackPounceTarget, type PounceTargetTrack } from '../systems/enemyPounceRules';
import type { EnemyLaneAttack, EnemyZoneAttack } from './EnemyClawRenderer';

export type EnemyPounceLaneSink = (id: string, attack: EnemyLaneAttack | null, now: number, visible: boolean) => void;
export type EnemyPounceZoneSink = (id: string, attack: EnemyZoneAttack | null, now: number, visible: boolean) => void;
/** Displayed position of a hunted body (the local player uses its predicted position), or null. */
export type EnemyPounceTargetResolver = (target: EnemyPounceTargetRef) => { x: number; y: number } | null;

/** The zone turns from warning to strike this long before its hit moment. */
const STRIKE_LEAD_MS = 120;
/** The landing zone lingers briefly after the impact so the hit reads. */
const IMPACT_LINGER_MS = 80;
/** The lane lingers into the first frames of the flight. */
const TAKEOFF_LINGER_MS = 90;

/**
 * Always-on, light telegraph owner of the pounce: while a body aims, a red zone in the shared
 * danger family marks where it will land if the target keeps its course (it follows the target and
 * flashes at the lock); after the lock the zone holds the announced landing point until the impact.
 * A soft lane from the body to the zone shows who is coming. It only observes replicated state.
 */
export class EnemyPouncePresentation {
  private enemies: () => readonly EnemyVisualSource[] = () => [];
  private clock: () => number = () => this.scene.time.now;
  private resolveTarget: EnemyPounceTargetResolver = () => null;
  private laneSink: EnemyPounceLaneSink | null = null;
  private zoneSink: EnemyPounceZoneSink | null = null;
  private readonly sunk = new Set<string>();
  /** Target velocity per aiming body, estimated from the displayed target positions. */
  private readonly tracks = new Map<string, { aimAt: number; track: PounceTargetTrack }>();

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.render, this);
  }

  setEnemySource(source: () => readonly EnemyVisualSource[]): void { this.enemies = source; }
  /** Host-synchronised time: pounce timestamps are host timestamps. */
  setClock(clock: () => number): void { this.clock = clock; }
  setTargetResolver(resolver: EnemyPounceTargetResolver): void { this.resolveTarget = resolver; }
  /** Tracking lanes and zones are drawn by the shared enemy danger renderer. */
  setSinks(lane: EnemyPounceLaneSink | null, zone: EnemyPounceZoneSink | null): void { this.laneSink = lane; this.zoneSink = zone; }

  clear(): void {
    const now = this.clock();
    for (const id of this.sunk) { this.laneSink?.(id, null, now, false); this.zoneSink?.(id, null, now, false); }
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
      const enemyConfig = getCoopDefenseEnemyConfig(enemy.kind), config = enemyConfig.pounce;
      if (!config || !enemy.sprite.active || enemy.faction !== 'hostile') continue;
      const state = enemy.getPounceState?.();
      const pounce = state?.pounce;
      const phase = state ? enemyPouncePhaseAt(state, now) : 'idle';
      const landing = pounce?.landing;
      const showing = !!pounce && (phase === 'aim' || phase === 'lock'
        || (landing?.armed === true && (phase === 'air' || now < landing.landAt + IMPACT_LINGER_MS)));
      if (!pounce || !showing) {
        if (this.sunk.has(enemy.id)) this.release(enemy.id, now);
        continue;
      }
      const x = enemy.sprite.x, y = enemy.sprite.y, visible = enemy.sprite.visible;
      const identity = `pounce:${enemy.id}:${pounce.aimAt}`;
      let zone: EnemyZoneAttack | null;
      let endX: number, endY: number;
      if (landing) {
        endX = landing.x; endY = landing.y;
        zone = landing.armed ? { attackId: `${identity}:land`, x: endX, y: endY, radius: config.impact.radiusPx,
          startedAt: pounce.lockAt, strikeAt: Math.max(pounce.lockAt, landing.landAt - STRIKE_LEAD_MS), hitAt: landing.landAt,
          endsAt: landing.landAt + IMPACT_LINGER_MS } : null;
      } else {
        // Before the lock the zone predicts the landing from the target's displayed course.
        const target = this.resolveTarget(pounce.target);
        if (!target) { this.release(enemy.id, now); continue; }
        let entry = this.tracks.get(enemy.id);
        if (!entry || entry.aimAt !== pounce.aimAt) {
          entry = { aimAt: pounce.aimAt, track: createPounceTargetTrack(target.x, target.y, now) };
          this.tracks.set(enemy.id, entry);
        } else trackPounceTarget(entry.track, target.x, target.y, now);
        const predicted = predictPounceLanding(pounce.originX, pounce.originY, target.x, target.y, entry.track.vx, entry.track.vy,
          Math.max(0, pounce.lockAt - now) + config.lockMs, config);
        endX = predicted.x; endY = predicted.y;
        zone = { attackId: `${identity}:aim`, x: endX, y: endY, radius: config.impact.radiusPx, startedAt: pounce.aimAt,
          strikeAt: Math.max(pounce.aimAt, pounce.lockAt - STRIKE_LEAD_MS), hitAt: pounce.lockAt, endsAt: pounce.lockAt + IMPACT_LINGER_MS };
      }
      const takeoffAt = landing?.takeoffAt ?? pounce.lockAt + config.lockMs;
      const length = Math.hypot(endX - x, endY - y);
      const lane: EnemyLaneAttack | null = now < takeoffAt + TAKEOFF_LINGER_MS && length > 1 ? {
        attackId: `${identity}:lane`, x, y, angle: Math.atan2(endY - y, endX - x), length, width: enemyConfig.size,
        startedAt: pounce.aimAt, strikeAt: Math.max(pounce.aimAt, takeoffAt - STRIKE_LEAD_MS), hitAt: takeoffAt,
        endsAt: takeoffAt + TAKEOFF_LINGER_MS } : null;
      live.add(enemy.id);
      this.sunk.add(enemy.id);
      this.laneSink?.(enemy.id, lane, now, visible);
      this.zoneSink?.(enemy.id, zone, now, visible);
    }
    for (const id of [...this.sunk]) if (!live.has(id)) this.release(id, now);
    for (const id of [...this.tracks.keys()]) if (!live.has(id)) this.tracks.delete(id);
  }

  private release(id: string, now: number): void {
    this.laneSink?.(id, null, now, false);
    this.zoneSink?.(id, null, now, false);
    this.sunk.delete(id);
    this.tracks.delete(id);
  }
}
