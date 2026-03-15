import type { PlayerManager }     from '../entities/PlayerManager';
import type { ProjectileManager } from '../entities/ProjectileManager';
import type { ResourceSystem }    from '../systems/ResourceSystem';
import type { NetworkBridge }     from '../network/NetworkBridge';
import type { LoadoutSlot, PlayerAimNetState, WeaponSlot } from '../types';
import type { UltimateConfig, UtilityConfig, WeaponConfig } from './LoadoutConfig';
import { WEAPON_CONFIGS, UTILITY_CONFIGS, ULTIMATE_CONFIGS } from './LoadoutConfig';
import { isVelocityMoving } from './SpreadMath';

export interface LoadoutSelection {
  weapon1?:  WeaponConfig;
  weapon2?:  WeaponConfig;
  utility?:  UtilityConfig;
  ultimate?: UltimateConfig;
}
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
 * prüft Cooldowns/Adrenalin, dispatcht Aktionen, tracked Spread-Bloom und Ultimate-Zustand.
 */
export class LoadoutManager {
  private loadouts       = new Map<string, PlayerLoadout>();
  private ultimateStates = new Map<string, UltimateState>();
  private aimNetStates   = new Map<string, PlayerAimNetState>();

  constructor(
    private playerManager:     PlayerManager,
    private projectileManager: ProjectileManager,
    private resourceSystem:    ResourceSystem,
    private bridge:            NetworkBridge,
  ) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  assignDefaultLoadout(playerId: string, selection?: LoadoutSelection): void {
    const w1Cfg  = selection?.weapon1  ?? WEAPON_CONFIGS.GLOCK;
    const w2Cfg  = selection?.weapon2  ?? WEAPON_CONFIGS.P90;
    const utCfg  = selection?.utility  ?? UTILITY_CONFIGS.HE_GRENADE;
    const ultCfg = selection?.ultimate ?? ULTIMATE_CONFIGS.HONEY_BADGER_RAGE;
    this.loadouts.set(playerId, {
      weapon1:  new GenericWeapon(w1Cfg),
      weapon2:  new GenericWeapon(w2Cfg),
      utility:  new GenericUtility(utCfg),
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
    this.aimNetStates.delete(playerId);
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
      case 'weapon1':
        this.fireWeapon(loadout.weapon1, x, y, angle, playerId, now, player.color);
        break;

      case 'weapon2':
        this.fireWeapon(loadout.weapon2, x, y, angle, playerId, now, player.color);
        break;

      case 'utility': {
        if (loadout.utility.isOnCooldown(now)) return;
        const cfg = loadout.utility.config;
        this.projectileManager.spawnProjectile(x, y, angle, playerId, {
          speed:         cfg.projectileSpeed,
          size:          cfg.projectileSize,
          damage:        0,              // kein Direkttreffer-Schaden
          color:         player.color,
          lifetime:      cfg.fuseTime,   // Lifetime = Zündzeit
          maxBounces:    0,
          isGrenade:     true,
          adrenalinGain: 0,              // Granaten geben kein Adrenalin
          weaponName:    cfg.id,
          fuseTime:      cfg.fuseTime,
          aoeRadius:     cfg.aoeRadius,
          aoeDamage:     cfg.aoeDamage,
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

  // ── Frame-Update (Spread-Decay, Rage-Drain, Ultimate-Ablauf) ─────────────

  update(delta: number): void {
    const now = Date.now();

    // Spread-Decay für alle ausgerüsteten Waffen
    for (const loadout of this.loadouts.values()) {
      loadout.weapon1.decaySpread(delta, now);
      loadout.weapon2.decaySpread(delta, now);
    }

    // Ultimate: Rage proportional drainieren + Effekt nach duration deaktivieren
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

  // ── Waffen-Getter (für AimSystem) ────────────────────────────────────────

  /**
   * Gibt die WeaponConfig der tatsächlich ausgerüsteten Waffe zurück.
   * Ermöglicht dem AimSystem die echten Waffenwerte (Range, Spread-Parameter)
   * zu nutzen, unabhängig davon welches Loadout der Spieler ausgewählt hat.
   */
  getEquippedWeaponConfig(playerId: string, slot: 'weapon1' | 'weapon2'): WeaponConfig | undefined {
    return this.loadouts.get(playerId)?.[slot].config;
  }

  /**
   * Gibt den aktuellen dynamischen Spread (Bloom) der Waffe zurück.
   * Direkt aus dem BaseWeapon-Objekt – das AimSystem braucht auf dem Host
   * keine eigene Simulation und nutzt stattdessen den autoritären Wert.
   */
  getDynamicSpread(playerId: string, slot: 'weapon1' | 'weapon2'): number {
    return this.loadouts.get(playerId)?.[slot].getDynamicSpread() ?? 0;
  }

  getAimNetState(playerId: string, isMoving: boolean): PlayerAimNetState | undefined {
    const loadout = this.loadouts.get(playerId);
    if (!loadout) return undefined;

    const weapon1DynamicSpread = loadout.weapon1.getDynamicSpread();
    const weapon2DynamicSpread = loadout.weapon2.getDynamicSpread();
    const previous = this.aimNetStates.get(playerId);
    const changed = !previous
      || previous.isMoving !== isMoving
      || previous.weapon1DynamicSpread !== weapon1DynamicSpread
      || previous.weapon2DynamicSpread !== weapon2DynamicSpread;

    const nextState: PlayerAimNetState = {
      revision: changed ? (previous?.revision ?? 0) + 1 : (previous?.revision ?? 0),
      isMoving,
      weapon1DynamicSpread,
      weapon2DynamicSpread,
    };

    this.aimNetStates.set(playerId, nextState);
    return nextState;
  }

  /** Cooldown-Fraktion eines Slots: 0 = bereit, 1 = gerade benutzt. */
  getCooldownFrac(playerId: string, slot: LoadoutSlot, now: number): number {
    const loadout = this.loadouts.get(playerId);
    if (!loadout || slot === 'ultimate') return 0;
    return loadout[slot].getCooldownFrac(now);
  }

  // ── Interne Helfer ────────────────────────────────────────────────────────

  /**
   * Feuert eine Waffe ab: prüft Cooldown + Adrenalin, berechnet den
   * gestreuten Winkel (Basis + dynamischer Bloom), errechnet Lifetime
   * aus Reichweite und spawnt das Projektil.
   */
  private fireWeapon(
    weapon:   BaseWeapon,
    x:        number,
    y:        number,
    angle:    number,
    playerId: string,
    now:      number,
    playerColor: number,
  ): void {
    // 1. Cooldown-Check
    if (weapon.isOnCooldown(now)) return;

    const cfg = weapon.config;

    // 2. Adrenalin-Check (nur wenn Kosten > 0, sonst Regen-Pause nicht unterbrechen)
    if (cfg.adrenalinCost > 0) {
      if (this.resourceSystem.getAdrenaline(playerId) < cfg.adrenalinCost) return;
      this.resourceSystem.drainAdrenaline(playerId, cfg.adrenalinCost);
    }

    // 3. Gesamtspread ermitteln: Basis (stehend / bewegend) + dynamischer Bloom
    // Bewegungsstatus direkt vom Physics-Body lesen – der Host besitzt die Simulation,
    // daher ist velocity immer aktuell (kein Netzwerk-Lag wie bei getPlayerInput).
    const shooterBody = this.playerManager.getPlayer(playerId)?.body;
    const isMoving    = isVelocityMoving(shooterBody?.velocity.x ?? 0, shooterBody?.velocity.y ?? 0);
    const baseSpread    = isMoving ? cfg.spreadMoving : cfg.spreadStanding;
    const totalSpreadDeg = baseSpread + weapon.getDynamicSpread();
    const halfSpreadRad  = (totalSpreadDeg * Math.PI / 180) / 2;
    const finalAngle     = angle + (Math.random() * 2 - 1) * halfSpreadRad;

    // 4. Lifetime aus Reichweite berechnen (Projektil verschwindet exakt an der Reichweite)
    const lifetime = (cfg.range / cfg.projectileSpeed) * 1000;

    // 5. Projektil spawnen
    this.projectileManager.spawnProjectile(x, y, finalAngle, playerId, {
      speed:         cfg.projectileSpeed,
      size:          cfg.projectileSize,
      damage:        cfg.damage,
      color:         playerColor,
      lifetime,
      maxBounces:    cfg.projectileMaxBounces,
      isGrenade:     false,
      adrenalinGain: cfg.adrenalinGain,
      weaponName:    cfg.id,
    });

    // 6. Bloom erhöhen, dann Cooldown-Timestamp setzen
    weapon.addSpread();
    weapon.recordUse(now);
  }
}
