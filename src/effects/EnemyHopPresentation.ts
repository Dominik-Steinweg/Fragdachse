import * as Phaser from 'phaser';
import { getCoopDefenseEnemyConfig } from '../config/coopDefenseEnemies';
import type { EnemyVisualSource } from '../entities/EnemyVisualSource';
import type { EnemyZoneAttack } from './EnemyClawRenderer';
import { readEyeAnchorFrame, writeEyePose, type EnemyEyePose } from './EnemyEyeGlowModel';
import type { LightingSystem } from './LightingSystem';
import type { RestHealChannel, RestHealTendrilRenderer } from './RestHealTendrilRenderer';

export type EnemyHopZoneSink = (id: string, attack: EnemyZoneAttack | null, now: number, visible: boolean) => void;

/** The telegraph turns from warning to strike this long before the landing. */
const LANDING_STRIKE_LEAD_MS = 120;
/** The zone lingers briefly after the landing so the splash reads as its result. */
const LANDING_LINGER_MS = 80;
/** The back cross sits this far behind the body centre (share of the body radius; GA1 cross socket). */
const CROSS_BEHIND_SHARE = 0.27;

/**
 * Always-on, light presentation owner of hopping enemies: it reads the replicated hop states,
 * announces armed landings in the shared red danger family and hands rest heal links to the
 * tendril renderer, which loads with the first healer. It only observes replicated state.
 */
export class EnemyHopPresentation {
  private enemies: () => readonly EnemyVisualSource[] = () => [];
  private clock: () => number = () => this.scene.time.now;
  private zoneSink: EnemyHopZoneSink | null = null;
  private readonly sunkZones = new Set<string>();
  private tendrils: RestHealTendrilRenderer | null = null;
  private tendrilState: 'idle' | 'loading' | 'destroyed' = 'idle';
  private lighting: LightingSystem | null = null;
  private readonly eyePose = {} as EnemyEyePose;

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.render, this);
  }

  setEnemySource(source: () => readonly EnemyVisualSource[]): void { this.enemies = source; }
  /** Host-synchronised time: hop timestamps are host timestamps. */
  setClock(clock: () => number): void { this.clock = clock; }
  /** Armed landings are drawn by the shared enemy danger-zone renderer. */
  setZoneSink(sink: EnemyHopZoneSink | null): void { this.zoneSink = sink; }
  setLightingSystem(lighting: LightingSystem | null): void { this.lighting = lighting; this.tendrils?.setLightingSystem(lighting); }

  clear(): void {
    for (const id of this.sunkZones) this.zoneSink?.(id, null, this.clock(), false);
    this.sunkZones.clear();
    this.tendrils?.clear();
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.render, this);
    this.clear();
    this.tendrils?.destroy(); this.tendrils = null; this.tendrilState = 'destroyed';
  }

  private render(): void {
    const now = this.clock();
    const live = new Set<string>();
    const enemies = this.enemies();
    let byId: Map<string, EnemyVisualSource> | null = null;
    const channels: RestHealChannel[] = [];
    let healers = false;
    for (const enemy of enemies) {
      const config = getCoopDefenseEnemyConfig(enemy.kind), hop = config.hop;
      if (!hop || !enemy.sprite.active) continue;
      const snapshot = enemy.getNetSnapshot(), state = snapshot.hop, jump = state?.jump;
      if (hop.heal) healers = true;
      if (hop.heal && state?.links.length && enemy.sprite.visible && enemy.getHp() > 0) {
        byId ??= new Map(enemies.map(other => [other.id, other]));
        const targets = state.links.flatMap(id => {
          const other = byId!.get(id);
          return other?.sprite.active && other.sprite.visible ? [{ id, x: other.sprite.x, y: other.sprite.y }] : [];
        });
        const facing = snapshot.rot ?? 0, behind = config.size / 2 * CROSS_BEHIND_SHARE;
        channels.push({ id: enemy.id, allied: enemy.faction === 'allied', facing, targets,
          cross: { x: enemy.sprite.x - Math.cos(facing) * behind, y: enemy.sprite.y - Math.sin(facing) * behind },
          eyes: this.eyesOf(enemy), eyeColor: config.eyeGlow?.color ?? 0xb45cff,
          restAt: jump?.settleUntil ?? 0, tickMs: hop.heal.tickIntervalMs });
      }
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
    if (healers) this.loadTendrils();
    this.tendrils?.draw(channels, now);
  }

  private eyesOf(enemy: EnemyVisualSource): { x: number; y: number }[] {
    const frame = readEyeAnchorFrame(enemy.sprite);
    if (!frame) return [];
    return [frame.left, frame.right, ...(frame.extra ?? [])].map(anchor => {
      writeEyePose(this.eyePose, anchor, enemy.sprite, 0);
      return { x: this.eyePose.x, y: this.eyePose.y };
    });
  }

  /** The tendril renderer loads with the first healer; maps without one never touch it. */
  private loadTendrils(): void {
    if (this.tendrils || this.tendrilState !== 'idle') return;
    this.tendrilState = 'loading';
    void import('./RestHealTendrilRenderer').then(({ RestHealTendrilRenderer }) => {
      if (this.tendrilState !== 'loading') return;
      this.tendrils = new RestHealTendrilRenderer(this.scene);
      this.tendrils.setLightingSystem(this.lighting);
    });
  }
}
