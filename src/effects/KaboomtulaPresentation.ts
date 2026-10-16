import * as Phaser from 'phaser';
import { getCoopDefenseEnemyConfig } from '../config/coopDefenseEnemies';
import type { EnemyVisualSource } from '../entities/EnemyVisualSource';
import type { KaboomtulaTargetRef } from '../systems/KaboomtulaState';
import type { EnemyLaneAttack, EnemyZoneAttack } from './EnemyClawRenderer';

export type KaboomtulaLaneSink = (id: string, attack: EnemyLaneAttack | null, now: number, visible: boolean) => void;
export type KaboomtulaZoneSink = (id: string, attack: EnemyZoneAttack | null, now: number, visible: boolean) => void;
/** Displayed position of a hunted body (the local player uses its predicted position), or null. */
export type KaboomtulaTargetResolver = (target: KaboomtulaTargetRef) => { x: number; y: number } | null;

/** The lane turns from warning to strike this long before the launch. */
const LAUNCH_STRIKE_LEAD_MS = 120;
/** Lane and ring linger briefly after the launch so the flash reads as the lock. */
const LAUNCH_LINGER_MS = 90;
/** Ring around the hunted body, on top of its radius. */
const TARGET_RING_RADIUS_PX = 24;

/**
 * Always-on, light telegraph owner of the Kabummtula leap: while a spider pounces, a red lane in
 * the shared danger family runs from the spider to the hunted body and a ring marks that body;
 * both follow the bodies every frame and flash at the launch. It only observes replicated state.
 */
export class KaboomtulaPresentation {
  private enemies: () => readonly EnemyVisualSource[] = () => [];
  private clock: () => number = () => this.scene.time.now;
  private resolveTarget: KaboomtulaTargetResolver = () => null;
  private laneSink: KaboomtulaLaneSink | null = null;
  private zoneSink: KaboomtulaZoneSink | null = null;
  private readonly sunk = new Set<string>();

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.render, this);
  }

  setEnemySource(source: () => readonly EnemyVisualSource[]): void { this.enemies = source; }
  /** Host-synchronised time: spider timestamps are host timestamps. */
  setClock(clock: () => number): void { this.clock = clock; }
  setTargetResolver(resolver: KaboomtulaTargetResolver): void { this.resolveTarget = resolver; }
  /** Tracking lanes and rings are drawn by the shared enemy danger renderer. */
  setSinks(lane: KaboomtulaLaneSink | null, zone: KaboomtulaZoneSink | null): void { this.laneSink = lane; this.zoneSink = zone; }

  clear(): void {
    const now = this.clock();
    for (const id of this.sunk) { this.laneSink?.(id, null, now, false); this.zoneSink?.(id, null, now, false); }
    this.sunk.clear();
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.render, this);
    this.clear();
  }

  private render(): void {
    const now = this.clock();
    const live = new Set<string>();
    for (const enemy of this.enemies()) {
      const config = getCoopDefenseEnemyConfig(enemy.kind);
      if (!config.kaboomtula || !enemy.sprite.active || enemy.faction !== 'hostile') continue;
      const state = enemy.getKaboomtulaState?.();
      // The telegraph belongs to the pounce; it lingers into the first frames of the leap for the lock flash.
      const launchAt = state?.phase === 'pounce' ? state.endsAt : state?.phase === 'leap' ? state.leap?.takeoffAt ?? 0 : 0;
      if (!state || !launchAt || now >= launchAt + LAUNCH_LINGER_MS || !state.target) {
        if (this.sunk.has(enemy.id)) this.release(enemy.id, now);
        continue;
      }
      const x = enemy.sprite.x, y = enemy.sprite.y;
      const target = this.resolveTarget(state.target);
      const facing = enemy.sprite.rotation;
      const tx = target?.x ?? x + Math.cos(facing) * config.kaboomtula.pounce.triggerPx;
      const ty = target?.y ?? y + Math.sin(facing) * config.kaboomtula.pounce.triggerPx;
      const length = Math.hypot(tx - x, ty - y);
      // One identity per pounce: the leap phase keeps it, so the lane is not re-created at the launch.
      const startedAt = state.phase === 'pounce' ? state.startedAt : launchAt - config.kaboomtula.pounce.telegraphMs;
      const timing = { startedAt, strikeAt: Math.max(startedAt, launchAt - LAUNCH_STRIKE_LEAD_MS), hitAt: launchAt,
        endsAt: launchAt + LAUNCH_LINGER_MS };
      const attackId = `kaboomtula:${enemy.id}:${launchAt}`;
      live.add(enemy.id);
      this.sunk.add(enemy.id);
      this.laneSink?.(enemy.id, length > 1 ? { attackId, x, y, angle: Math.atan2(ty - y, tx - x), length,
        width: config.size, ...timing } : null, now, enemy.sprite.visible);
      this.zoneSink?.(enemy.id, target ? { attackId: `${attackId}:ring`, x: tx, y: ty, radius: TARGET_RING_RADIUS_PX,
        ...timing } : null, now, enemy.sprite.visible);
    }
    for (const id of [...this.sunk]) if (!live.has(id)) this.release(id, now);
  }

  private release(id: string, now: number): void {
    this.laneSink?.(id, null, now, false);
    this.zoneSink?.(id, null, now, false);
    this.sunk.delete(id);
  }
}
