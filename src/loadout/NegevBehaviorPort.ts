import type { SyncedActiveHudBuff } from '../types';
import type { WeaponConfig } from './LoadoutConfig';

/** Read-only equipment boundary consumed by the world-owned Negev behavior. */
export interface NegevLoadoutReadPort {
  getEquippedWeaponConfig(playerId: string, slot: 'weapon2'): WeaponConfig | undefined;
}

/** The semantic kill outcome that can advance a player's Negev streak. */
export interface NegevKillOutcome {
  readonly killerId: string;
  readonly sourceId: string;
}

/** Resolved Negev shot data; streak state remains in the behavior owner. */
export interface NegevShotPreparation {
  readonly shotConfig: WeaponConfig;
  readonly damageMultiplier: number;
}

export interface NegevKillstreakExplosionEvent {
  readonly ownerId: string;
  readonly x: number;
  readonly y: number;
  readonly kills: number;
  readonly radius: number;
  readonly damage: number;
  readonly nowMs: number;
  readonly fireChunkDurationMs: number;
  readonly fireChunkBurnDurationMs: number;
  readonly fireChunkBurnDamagePerTick: number;
}

/** Narrow command/read boundary between weapon activation, Combat and Negev behavior. */
export interface NegevBehaviorPort {
  prepareShot(playerId: string, config: WeaponConfig): NegevShotPreparation | null;
  commitShot(playerId: string, nowMs: number): void;
  registerKill(outcome: NegevKillOutcome): void;
  terminateStreak(playerId: string, nowMs: number): void;
  update(nowMs: number): void;
  resetPlayer(playerId: string): void;
  removePlayer(playerId: string): void;
  clear(): void;
  destroy(): void;
  getHudBuffs(playerId: string): readonly SyncedActiveHudBuff[];
}
