import type { ResourceSystem } from '../systems/ResourceSystem';
import type { CombatDamageEffectPort, CombatPlayerSupportPort } from '../combat/CombatCapabilities';
import type { ExplosionVisualStyle } from '../types';
import type { WeaponConfig } from './LoadoutConfig';

/** Read-only equipment boundary used by world-owned weapon reactions. */
export interface WeaponReactionLoadoutReadPort {
  getEquippedWeaponConfig(playerId: string, slot: 'weapon1' | 'weapon2'): WeaponConfig | undefined;
}

/** Semantic kill outcome consumed by config-driven weapon reactions. */
export interface WeaponKillReactionOutcome {
  readonly killerId: string;
  readonly sourceId: string;
  readonly x: number;
  readonly y: number;
  readonly source?: {
    readonly shotgunLightningGeneration?: number;
  };
}

/** Narrow world-owned boundary for player weapon kill/reaction state. */
export interface WeaponReactionPort {
  registerKill(outcome: WeaponKillReactionOutcome): void;
  update(): void;
  resetPlayer(playerId: string): void;
  removePlayer(playerId: string): void;
  clear(): void;
  destroy(): void;
}

export type WeaponReactionCombatPort = CombatPlayerSupportPort & CombatDamageEffectPort;
export type WeaponReactionResourcePort = Pick<ResourceSystem, 'addAdrenaline'>;
export interface WeaponReactionNetworkPort {
  broadcastExplosionEffect(
    x: number,
    y: number,
    radius: number,
    color?: number,
    visualStyle?: ExplosionVisualStyle,
  ): void;
}
