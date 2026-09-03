import type { EnergyShieldSystem } from '../systems/EnergyShieldSystem';
import type { ResourceSystem } from '../systems/ResourceSystem';
import type { TeslaDomeSystem } from '../systems/TeslaDomeSystem';
import type { LoadoutUseResult, WeaponSlot } from '../types';
import type {
  SustainedWeaponActionRequest,
  SustainedWeaponBehaviorPort,
  SustainedWeaponLoadoutReadPort,
} from '../loadout/SustainedWeaponBehaviorPort';
import type {
  EnergyShieldWeaponFireConfig,
  TeslaDomeWeaponFireConfig,
  WeaponConfig,
} from '../loadout/LoadoutConfig';

interface HeldSustainedWeapon {
  slot: WeaponSlot;
  lastAt: number;
}

/** World-owned orchestration for Tesla Dome and Energy Shield player lifecycles. */
export class SustainedWeaponBehaviorRuntime implements SustainedWeaponBehaviorPort {
  private static readonly HOLD_EXPIRE_MS = 100;
  private readonly heldWeapons = new Map<string, HeldSustainedWeapon>();
  private teslaDomeSystem: TeslaDomeSystem | null = null;
  private energyShieldSystem: EnergyShieldSystem | null = null;
  private destroyed = false;

  constructor(
    private readonly loadout: SustainedWeaponLoadoutReadPort,
    private readonly resourceSystem: ResourceSystem,
  ) {}

  claimWeaponAction(playerId: string, slot: WeaponSlot, nowMs: number, _angle: number): void {
    if (this.destroyed) return;

    const previous = this.heldWeapons.get(playerId)?.slot;
    if (previous !== undefined && previous !== slot) {
      this.deactivateNonAutonomousWeaponEffect(playerId, previous);
    }
    this.heldWeapons.set(playerId, { slot, lastAt: nowMs });
  }

  activateWeapon(request: SustainedWeaponActionRequest): LoadoutUseResult | null {
    if (this.destroyed) return { ok: false, reason: 'invalid' };

    const { config } = request;
    if (config.fire.type === 'tesla_dome') {
      if (this.resourceSystem.getAdrenaline(request.playerId) <= 0) {
        this.teslaDomeSystem?.hostDeactivateForPlayer(request.playerId);
        return { ok: true };
      }

      this.teslaDomeSystem?.hostRefresh(
        request.playerId,
        request.x,
        request.y,
        request.nowMs,
        config as WeaponConfig & { fire: TeslaDomeWeaponFireConfig },
        config.projectileColor ?? request.playerColor,
        request.angle,
      );
      return { ok: true };
    }

    if (config.fire.type === 'energy_shield') {
      if (this.resourceSystem.getAdrenaline(request.playerId) <= 0) {
        this.energyShieldSystem?.hostDeactivateForPlayer(request.playerId);
        return { ok: true };
      }

      this.energyShieldSystem?.hostRefresh(
        request.playerId,
        request.nowMs,
        config as WeaponConfig & { fire: EnergyShieldWeaponFireConfig },
        config.projectileColor ?? request.playerColor,
        request.params?.inputStarted === true,
      );
      return { ok: true };
    }

    return null;
  }

  getMovementSlowFactor(playerId: string, nowMs: number): number | null {
    if (this.destroyed) return null;

    // An autonomous Energy Dome remains movement-relevant after the input slot changes.
    const energyConfig = this.loadout.getEquippedWeaponConfig(playerId, 'weapon2');
    if (this.energyShieldSystem?.isActive(playerId) && energyConfig?.fire.type === 'energy_shield') {
      return energyConfig.fire.movementSlowFactor;
    }

    const held = this.heldWeapons.get(playerId);
    if (!held || nowMs - held.lastAt >= SustainedWeaponBehaviorRuntime.HOLD_EXPIRE_MS) return null;

    const config = this.loadout.getEquippedWeaponConfig(playerId, held.slot);
    if (!config) return null;
    if (config.fire.type === 'tesla_dome') {
      return this.teslaDomeSystem?.getMovementSlowFactor(playerId) ?? 1;
    }
    if (config.fire.type === 'energy_shield') {
      return this.energyShieldSystem?.isActive(playerId) ? config.fire.movementSlowFactor : 1;
    }
    return null;
  }

  setTeslaDomeSystem(system: TeslaDomeSystem | null): void {
    this.teslaDomeSystem = system;
  }

  setEnergyShieldSystem(system: EnergyShieldSystem | null): void {
    this.energyShieldSystem = system;
  }

  resetPlayer(playerId: string): void {
    if (this.destroyed) return;
    this.stopPlayerEffect(playerId);
    this.heldWeapons.delete(playerId);
  }

  removePlayer(playerId: string): void {
    if (this.destroyed) return;
    this.stopPlayerEffect(playerId);
    this.heldWeapons.delete(playerId);
  }

  destroy(): void {
    if (this.destroyed) return;
    for (const playerId of this.heldWeapons.keys()) this.stopPlayerEffect(playerId);
    this.heldWeapons.clear();
    this.teslaDomeSystem = null;
    this.energyShieldSystem = null;
    this.destroyed = true;
  }

  private stopPlayerEffect(playerId: string): void {
    this.teslaDomeSystem?.hostDeactivateForPlayer(playerId);
    this.energyShieldSystem?.hostDeactivateForPlayer(playerId);
  }

  private deactivateNonAutonomousWeaponEffect(playerId: string, slot: WeaponSlot): void {
    const config = this.loadout.getEquippedWeaponConfig(playerId, slot);
    if (!config || isAutonomousWeaponToggle(config)) return;

    if (config.fire.type === 'tesla_dome') {
      this.teslaDomeSystem?.hostDeactivateForPlayer(playerId);
    } else if (config.fire.type === 'energy_shield') {
      this.energyShieldSystem?.hostDeactivateForPlayer(playerId);
    }
  }
}

function isAutonomousWeaponToggle(config: WeaponConfig): boolean {
  return config.fire.type === 'energy_shield'
    && config.fire.domeEnabled > 0
    && config.fire.domeToggleEnabled > 0;
}
