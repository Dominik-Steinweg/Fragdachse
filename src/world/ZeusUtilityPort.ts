import type { TaserUtilityConfig } from '../loadout/LoadoutConfig';

export interface ZeusUtilityPort {
  activate(config: TaserUtilityConfig, playerId: string, x: number, y: number, angle: number, color: number, now: number, charged?: boolean): boolean;
  removePlayer(playerId: string): void;
}
