import * as Phaser from 'phaser';
import { getCoopDefenseEnemyConfig } from '../config/coopDefenseEnemies';
import type { EnemyVisualSource } from '../entities/EnemyVisualSource';
import { pounceMenace } from '../animations/EnemyPounceAnimation';
import { enemyPouncePhaseAt } from '../systems/EnemyPounceState';
import { pounceUnitHash } from '../systems/enemyPounceRules';
import type { EnemyLandingMark } from './EnemyClawRenderer';

export type EnemyPounceMarkSink = (id: string, mark: EnemyLandingMark | null, now: number, visible: boolean) => void;
/**
 * One frame of the charge aura of a visible body of `size` px: void haze around (x, y) without a
 * direction; `strength` (0..1) follows the body glow, `turn` (±1) is its swirl sense.
 */
export type EnemyPounceAuraSink = (x: number, y: number, size: number, strength: number, color: number, turn: number) => void;

/** The landing mark lingers briefly after the impact so the hit reads. */
const IMPACT_LINGER_MS = 80;
const DEFAULT_VOID_COLOR = 0xb45cff;

/**
 * Always-on, light telegraph owner of the pounce. While a body aims nothing marks the ground: the
 * body's own glow (see `pounceMenace`) and a swirling void haze aura around it carry the warning.
 * From the lock on, a mark in the shared danger family announces the landing point and fills up
 * to the impact. Nothing points along the jump: it must not read as an attack already travelling.
 * It only observes replicated state.
 */
export class EnemyPouncePresentation {
  private enemies: () => readonly EnemyVisualSource[] = () => [];
  private clock: () => number = () => this.scene.time.now;
  private markSink: EnemyPounceMarkSink | null = null;
  private auraSink: EnemyPounceAuraSink | null = null;
  private readonly sunk = new Set<string>();

  constructor(private readonly scene: Phaser.Scene) {
    scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.render, this);
  }

  setEnemySource(source: () => readonly EnemyVisualSource[]): void { this.enemies = source; }
  /** Host-synchronised time: pounce timestamps are host timestamps. */
  setClock(clock: () => number): void { this.clock = clock; }
  /** Landing marks are drawn by the shared enemy danger renderer. */
  setMarkSink(sink: EnemyPounceMarkSink | null): void { this.markSink = sink; }
  /** Charge aura haze is emitted by the GPU particle renderer. */
  setAuraSink(sink: EnemyPounceAuraSink | null): void { this.auraSink = sink; }

  clear(): void {
    const now = this.clock();
    for (const id of this.sunk) this.markSink?.(id, null, now, false);
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
      const enemyConfig = getCoopDefenseEnemyConfig(enemy.kind), config = enemyConfig.pounce;
      if (!config || !enemy.sprite.active || enemy.faction !== 'hostile') continue;
      const state = enemy.getPounceState?.();
      const pounce = state?.pounce, landing = pounce?.landing;
      const phase = state ? enemyPouncePhaseAt(state, now) : 'idle';
      if (state && (phase === 'aim' || phase === 'lock') && enemy.sprite.visible) {
        const glow = Math.max(0, Math.min(1, pounceMenace(state, now).glow));
        if (glow > 0.02) this.auraSink?.(enemy.sprite.x, enemy.sprite.y, enemyConfig.size, glow,
          enemyConfig.eyeGlow?.color ?? DEFAULT_VOID_COLOR, pounceUnitHash(enemy.id, 0, 23) < 0.5 ? -1 : 1);
      }
      if (!pounce || !landing?.armed || !(phase === 'lock' || phase === 'air' || now < landing.landAt + IMPACT_LINGER_MS)) {
        if (this.sunk.has(enemy.id)) this.release(enemy.id, now);
        continue;
      }
      const visible = enemy.sprite.visible;
      // The host locks `lockMs` before the take-off; the announcement starts there.
      const lockedAt = landing.takeoffAt - config.lockMs;
      live.add(enemy.id);
      this.sunk.add(enemy.id);
      this.markSink?.(enemy.id, { attackId: `pounce:${enemy.id}:${pounce.aimAt}`, x: landing.x, y: landing.y,
        radius: config.impact.radiusPx, startedAt: lockedAt, hitAt: landing.landAt }, now, visible);
    }
    for (const id of [...this.sunk]) if (!live.has(id)) this.release(id, now);
  }

  private release(id: string, now: number): void {
    this.markSink?.(id, null, now, false);
    this.sunk.delete(id);
  }
}
