import type { PlayerManager }     from '../entities/PlayerManager';
import type { ProjectileManager } from '../entities/ProjectileManager';
import type { ResourceSystem }    from '../systems/ResourceSystem';
import type { NetworkBridge }     from '../network/NetworkBridge';
import type { LoadoutSlot }    from '../types';
import type { UltimateConfig } from './LoadoutConfig';
import { WEAPON_CONFIGS, UTILITY_CONFIGS, ULTIMATE_CONFIGS } from './LoadoutConfig';
import { GenericWeapon }   from './GenericWeapon';
import { GenericUtility }  from './GenericUtility';
import { GenericUltimate } from './GenericUltimate';
import type { BaseWeapon }   from './BaseWeapon';
import type { BaseUtility }  from './BaseUtility';
import type { BaseUltimate } from './BaseUltimate';

interface PlayerLoadout {
  weapon1:  BaseWeapon;
  weapon2:  BaseWeapon;
  utility:  BaseUtility;
  ultimate: BaseUltimate;
}

interface UltimateState {
  active:    boolean;
  startTime: number;
  config:    UltimateConfig;
}

/**
 * LoadoutManager – Host-autoritär.
 * Verwaltet pro Spieler 4 Slots (weapon1, weapon2, utility, ultimate),
 * prüft Cooldowns, dispatcht Aktionen und tracked den Ultimate-Zustand.
 */
export class LoadoutManager {
  private loadouts       = new Map<string, PlayerLoadout>();
  private ultimateStates = new Map<string, UltimateState>();

  constructor(
    private playerManager:     PlayerManager,
    private projectileManager: ProjectileManager,
    private resourceSystem:    ResourceSystem,
    private _bridge:           NetworkBridge,
  ) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  assignDefaultLoadout(playerId: string): void {
    const ultCfg = ULTIMATE_CONFIGS.HONEY_BADGER_RAGE;
    this.loadouts.set(playerId, {
      weapon1:  new GenericWeapon(WEAPON_CONFIGS.TEST_WEAPON_1),
      weapon2:  new GenericWeapon(WEAPON_CONFIGS.TEST_WEAPON_2),
      utility:  new GenericUtility(UTILITY_CONFIGS.HE_GRENADE),
      ultimate: new GenericUltimate(ultCfg),
    });
    this.ultimateStates.set(playerId, {
      active:    false,
      startTime: 0,
      config:    ultCfg,
    });
  }

  removePlayer(playerId: string): void {
    this.loadouts.delete(playerId);
    this.ultimateStates.delete(playerId);
  }

  // ── Haupt-Dispatch (vom Host-RPC-Handler) ────────────────────────────────

  use(
    slot:     LoadoutSlot,
    playerId: string,
    angle:    number,
    _targetX: number,
    _targetY: number,
    now:      number,
  ): void {
    const loadout = this.loadouts.get(playerId);
    if (!loadout) return;

    const player = this.playerManager.getPlayer(playerId);
    if (!player) return;
    const x = player.sprite.x;
    const y = player.sprite.y;

    switch (slot) {
      case 'weapon1': {
        if (loadout.weapon1.isOnCooldown(now)) return;
        const cfg = loadout.weapon1.config;
        this.projectileManager.spawnProjectile(x, y, angle, playerId, {
          speed:      cfg.projectileSpeed,
          size:       cfg.projectileSize,
          damage:     cfg.damage,
          color:      cfg.projectileColor,
          lifetime:   cfg.projectileLifetime,
          maxBounces: cfg.projectileMaxBounces,
          isGrenade:  false,
        });
        loadout.weapon1.recordUse(now);
        break;
      }

      case 'weapon2': {
        if (loadout.weapon2.isOnCooldown(now)) return;
        const cfg = loadout.weapon2.config;
        this.projectileManager.spawnProjectile(x, y, angle, playerId, {
          speed:      cfg.projectileSpeed,
          size:       cfg.projectileSize,
          damage:     cfg.damage,
          color:      cfg.projectileColor,
          lifetime:   cfg.projectileLifetime,
          maxBounces: cfg.projectileMaxBounces,
          isGrenade:  false,
        });
        loadout.weapon2.recordUse(now);
        break;
      }

      case 'utility': {
        if (loadout.utility.isOnCooldown(now)) return;
        const cfg = loadout.utility.config;
        this.projectileManager.spawnProjectile(x, y, angle, playerId, {
          speed:      cfg.projectileSpeed,
          size:       cfg.projectileSize,
          damage:     0,              // kein Direkttreffer-Schaden
          color:      cfg.projectileColor,
          lifetime:   cfg.fuseTime,   // Lifetime = Zündzeit
          maxBounces: 0,
          isGrenade:  true,
          fuseTime:   cfg.fuseTime,
          aoeRadius:  cfg.aoeRadius,
          aoeDamage:  cfg.aoeDamage,
        });
        loadout.utility.recordUse(now);
        break;
      }

      case 'ultimate': {
        const ultState = this.ultimateStates.get(playerId);
        if (ultState?.active) return;            // bereits aktiv
        const cfg  = loadout.ultimate.config;
        const rage = this.resourceSystem.getRage(playerId);
        if (rage < cfg.rageRequired) return;     // nicht genug Rage
        this.ultimateStates.set(playerId, { active: true, startTime: now, config: cfg });
        break;
      }
    }
  }

  // ── Frame-Update (Rage-Drain, Ultimate-Ablauf) ────────────────────────────

  update(_delta: number): void {
    const now = Date.now();
    for (const [playerId, state] of this.ultimateStates) {
      if (!state.active) continue;

      const elapsed  = now - state.startTime;
      const fraction = Math.min(1, elapsed / state.config.rageDrainDuration);
      const targetRage  = state.config.rageRequired * (1 - fraction);
      const currentRage = this.resourceSystem.getRage(playerId);
      const drain = currentRage - targetRage;
      if (drain > 0) {
        this.resourceSystem.addRage(playerId, -drain);
      }

      if (elapsed >= state.config.duration) {
        state.active = false;
      }
    }
  }

  // ── Multiplier-Getter ─────────────────────────────────────────────────────

  getSpeedMultiplier(playerId: string): number {
    const state = this.ultimateStates.get(playerId);
    return state?.active ? state.config.speedMultiplier : 1;
  }

  getDamageMultiplier(playerId: string): number {
    const state = this.ultimateStates.get(playerId);
    return state?.active ? state.config.damageMultiplier : 1;
  }

  isUltimateActive(playerId: string): boolean {
    return this.ultimateStates.get(playerId)?.active ?? false;
  }

  /** Cooldown-Fraktion eines Slots: 0 = bereit, 1 = gerade benutzt. */
  getCooldownFrac(playerId: string, slot: LoadoutSlot, now: number): number {
    const loadout = this.loadouts.get(playerId);
    if (!loadout || slot === 'ultimate') return 0;
    return loadout[slot].getCooldownFrac(now);
  }
}
