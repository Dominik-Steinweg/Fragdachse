import * as Phaser from 'phaser';
import { getCoopDefenseEnemyConfig } from '../config/coopDefenseEnemies';
import type { EnemyVisualSource } from '../entities/EnemyVisualSource';
import type { EnemyZoneAttack } from './EnemyClawRenderer';

export type EnemyHopZoneSink = (id: string, attack: EnemyZoneAttack | null, now: number, visible: boolean) => void;

/** The telegraph turns from warning to strike this long before the landing. */
const LANDING_STRIKE_LEAD_MS = 120;
/** The zone lingers briefly after the landing so the splash reads as its result. */
const LANDING_LINGER_MS = 80;

/**
 * Always-on, light presentation owner of hopping enemies: it reads the replicated hop states and
 * announces armed landings in the shared red danger family. It only observes replicated state.
 */
export class EnemyHopPresentation {
  private enemies: () => readonly EnemyVisualSource[] = () => [];
  private clock: () => number = () => this.scene.time.now;
  private zoneSink: EnemyHopZoneSink | null = null;
  private readonly sunkZones = new Set<string>();

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.render, this);
  }

  setEnemySource(source: () => readonly EnemyVisualSource[]): void { this.enemies = source; }
  /** Host-synchronised time: hop timestamps are host timestamps. */
  setClock(clock: () => number): void { this.clock = clock; }
  /** Armed landings are drawn by the shared enemy danger-zone renderer. */
  setZoneSink(sink: EnemyHopZoneSink | null): void { this.zoneSink = sink; }

  clear(): void {
    for (const id of this.sunkZones) this.zoneSink?.(id, null, this.clock(), false);
    this.sunkZones.clear();
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.render, this);
    this.clear();
  }

  private render(): void {
    const now = this.clock();
    const live = new Set<string>();
    for (const enemy of this.enemies()) {
      const hop = getCoopDefenseEnemyConfig(enemy.kind).hop;
      if (!hop || !enemy.sprite.active) continue;
      const jump = enemy.getNetSnapshot().hop?.jump;
      const shock = hop.landingShock;
      const zone: EnemyZoneAttack | null = jump && jump.shock && shock && enemy.faction === 'hostile'
        && now < jump.landAt + LANDING_LINGER_MS ? {
          attackId: `hop:${enemy.id}:${jump.crouchAt}:${jump.landAt}`, x: jump.targetX, y: jump.targetY, radius: shock.radiusPx,
          startedAt: jump.crouchAt, strikeAt: Math.max(jump.crouchAt, jump.landAt - LANDING_STRIKE_LEAD_MS),
          hitAt: jump.landAt, endsAt: jump.landAt + LANDING_LINGER_MS,
        } : null;
      if (!zone && !this.sunkZones.has(enemy.id)) continue;
      live.add(enemy.id);
      this.zoneSink?.(enemy.id, zone, now, enemy.sprite.visible);
      if (zone) this.sunkZones.add(enemy.id); else this.sunkZones.delete(enemy.id);
    }
    for (const id of [...this.sunkZones]) if (!live.has(id)) { this.zoneSink?.(id, null, now, false); this.sunkZones.delete(id); }
  }
}
