import type { PlayerManager }     from '../entities/PlayerManager';
import type { ProjectileManager } from '../entities/ProjectileManager';
import type { ResourceSystem }    from '../systems/ResourceSystem';
import type { NetworkBridge }     from '../network/NetworkBridge';
import type { CombatSystem }      from '../systems/CombatSystem';
import type { GrenadeEffectConfig, LoadoutSlot, LoadoutUseParams, PlayerAimNetState, WeaponSlot } from '../types';
import type {
  BfgUtilityConfig,
  ChargedThrowUtilityActivationConfig,
  FlamethrowerWeaponFireConfig,
  MeleeWeaponFireConfig,
  ProjectileWeaponFireConfig,
  UltimateConfig,
  UtilityConfig,
  WeaponConfig,
} from './LoadoutConfig';
import { COLORS } from '../config';
import { WEAPON_CONFIGS, UTILITY_CONFIGS, ULTIMATE_CONFIGS } from './LoadoutConfig';
import { isVelocityMoving, calcPelletAngles } from './SpreadMath';

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

type CombatResolverType = Pick<CombatSystem, 'resolveHitscanShot' | 'traceHitscan' | 'resolveMeleeSwing'>;
type PhysicsSystemType  = { addRecoil(id: string, vx: number, vy: number, durationMs?: number): void };

/**
 * LoadoutManager – Host-autoritär.
 * Verwaltet pro Spieler 4 Slots (weapon1, weapon2, utility, ultimate),
 * prüft Cooldowns/Adrenalin, dispatcht Aktionen, tracked Spread-Bloom und Ultimate-Zustand.
 */
export class LoadoutManager {
  private loadouts          = new Map<string, PlayerLoadout>();
  private ultimateStates    = new Map<string, UltimateState>();
  private aimNetStates      = new Map<string, PlayerAimNetState>();
  private combatSystem:       CombatResolverType | null = null;
  private dashBurstChecker: ((id: string) => boolean) | null = null;
  private physicsSystem:      PhysicsSystemType | null = null;

  // Held-Fire-Tracking: Feuerknopf gilt als gehalten wenn innerhalb HOLD_EXPIRE_MS gefeuert wurde
  private heldFireSlots = new Map<string, { slot: WeaponSlot; lastAt: number }>();
  private static readonly HOLD_EXPIRE_MS = 100;

  // ── Utility-Override (Heilige Handgranate etc.) ─────────────────────────
  private savedUtilities    = new Map<string, { config: UtilityConfig; lastUsedAt: number }>();
  private utilityAmmo       = new Map<string, number>(); // playerId → verbleibende Einsätze (-1/absent = unbegrenzt)

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
    // Eventuell gespeichertes Utility-Override aufräumen (z.B. Tod während HHG)
    this.savedUtilities.delete(playerId);
    this.utilityAmmo.delete(playerId);
    this.bridge.publishUtilityCooldownUntil(playerId, 0);
  }

  removePlayer(playerId: string): void {
    this.loadouts.delete(playerId);
    this.ultimateStates.delete(playerId);
    this.aimNetStates.delete(playerId);
    this.savedUtilities.delete(playerId);
    this.utilityAmmo.delete(playerId);
    this.heldFireSlots.delete(playerId);
  }

  setCombatSystem(combatSystem: CombatResolverType | null): void {
    this.combatSystem = combatSystem;
  }

  /** Injiziert einen Checker, der während Dash-Phase 1 das Schießen blockiert. */
  setDashBurstChecker(fn: (id: string) => boolean): void {
    this.dashBurstChecker = fn;
  }

  /** Injiziert das HostPhysicsSystem für Rückstoß-Impulse. */
  setPhysicsSystem(ps: PhysicsSystemType | null): void {
    this.physicsSystem = ps;
  }

  // ── Utility-Override (temporärer Slot-Tausch, z.B. Heilige Handgranate) ──

  /**
   * Überschreibt den Utility-Slot eines Spielers temporär.
   * Der aktuelle Zustand (Config + Cooldown) wird zwischengespeichert.
   */
  overrideUtility(playerId: string, config: UtilityConfig, ammo: number): void {
    const loadout = this.loadouts.get(playerId);
    if (!loadout) return;

    // Aktuellen Zustand sichern (Config + Cooldown-Zeitstempel)
    this.savedUtilities.set(playerId, {
      config:     loadout.utility.config,
      lastUsedAt: loadout.utility.getLastUsedAt(),
    });

    // Neues Utility einsetzen
    loadout.utility = new GenericUtility(config);
    this.utilityAmmo.set(playerId, ammo);
    this.bridge.publishUtilityCooldownUntil(playerId, 0); // sofort einsatzbereit
  }

  /**
   * Stellt das zuvor gespeicherte Utility wieder her.
   * Wird automatisch aufgerufen wenn die Ammo aufgebraucht ist.
   */
  private restoreUtility(playerId: string): void {
    const saved = this.savedUtilities.get(playerId);
    if (!saved) return;

    const loadout = this.loadouts.get(playerId);
    if (!loadout) return;

    const restored = new GenericUtility(saved.config);
    restored.setLastUsedAt(saved.lastUsedAt);
    loadout.utility = restored;

    this.savedUtilities.delete(playerId);
    this.utilityAmmo.delete(playerId);

    // Cooldown-Status an Clients publizieren
    const now = Date.now();
    const remaining = saved.config.cooldown - (now - saved.lastUsedAt);
    this.bridge.publishUtilityCooldownUntil(playerId, remaining > 0 ? now + remaining : 0);
  }

  // ── Haupt-Dispatch (vom Host-RPC-Handler) ────────────────────────────────

  use(
    slot:      LoadoutSlot,
    playerId:  string,
    angle:     number,
    _targetX:  number,
    _targetY:  number,
    now:       number,
    shotId?:   number,
    params?:   LoadoutUseParams,
    clientX?:  number,
    clientY?:  number,
  ): void {
    const loadout = this.loadouts.get(playerId);
    if (!loadout) return;

    const player = this.playerManager.getPlayer(playerId);
    if (!player) return;
    // Client-Position verwenden falls vorhanden (kompensiert Netzwerk-Tick-Latenz),
    // sonst Fallback auf autoritative Host-Position.
    const x = clientX ?? player.sprite.x;
    const y = clientY ?? player.sprite.y;

    // Schießen während Dash-Phase 1 (Burst) blockiert
    if ((slot === 'weapon1' || slot === 'weapon2') && this.dashBurstChecker?.(playerId)) return;

    // Held-Fire-Tracking: Feuerknopf-Halte-Zustand aktualisieren
    if (slot === 'weapon1' || slot === 'weapon2') {
      this.heldFireSlots.set(playerId, { slot, lastAt: now });
    }

    switch (slot) {
      case 'weapon1':
        this.fireWeapon(loadout.weapon1, x, y, angle, playerId, now, player.color, shotId);
        break;

      case 'weapon2':
        this.fireWeapon(loadout.weapon2, x, y, angle, playerId, now, player.color, shotId);
        break;

      case 'utility': {
        this.useUtility(loadout.utility, x, y, angle, playerId, now, player.color, params);
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
    const state        = this.ultimateStates.get(playerId);
    const ultimateMult = state?.active ? state.config.speedMultiplier : 1;

    // holdSpeedFactor: Verlangsamung wenn Feuerknopf gehalten wird
    const held = this.heldFireSlots.get(playerId);
    if (held && Date.now() - held.lastAt < LoadoutManager.HOLD_EXPIRE_MS) {
      const cfg        = this.loadouts.get(playerId)?.[held.slot].config;
      const holdFactor = cfg?.holdSpeedFactor ?? 1;
      return ultimateMult * holdFactor;
    }

    return ultimateMult;
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

  /** Gibt die Config der tatsächlich ausgerüsteten Utility zurück (inkl. Override). */
  getEquippedUtilityConfig(playerId: string): UtilityConfig | undefined {
    return this.loadouts.get(playerId)?.utility.config;
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
   * gestreuten Winkel (Basis + dynamischer Bloom) und dispatcht dann
   * auf die typ-spezifische Waffenlogik.
   */
  private fireWeapon(
    weapon:   BaseWeapon,
    x:        number,
    y:        number,
    angle:    number,
    playerId: string,
    now:      number,
    playerColor: number,
    shotId?: number,
  ): void {
    // 1. Cooldown-Check
    if (weapon.isOnCooldown(now)) return;

    const cfg = weapon.config;

    // 2. Adrenalin-Check (nur wenn Kosten > 0, sonst Regen-Pause nicht unterbrechen)
    if (cfg.adrenalinCost > 0) {
      if (this.resourceSystem.getAdrenaline(playerId) < cfg.adrenalinCost) return;
    }

    // 3. Spread-Parameter berechnen
    // Bewegungsstatus direkt vom Physics-Body lesen – der Host besitzt die Simulation,
    // daher ist velocity immer aktuell (kein Netzwerk-Lag wie bei getPlayerInput).
    const shooterBody = this.playerManager.getPlayer(playerId)?.body;
    const isMoving    = isVelocityMoving(shooterBody?.velocity.x ?? 0, shooterBody?.velocity.y ?? 0);
    const baseSpread    = isMoving ? cfg.spreadMoving : cfg.spreadStanding;
    const totalSpreadDeg = Math.max(0, baseSpread + weapon.getDynamicSpread());
    const halfSpreadRad  = (totalSpreadDeg * Math.PI / 180) / 2;

    // 4. Typ-spezifische Waffenlogik ausführen.
    //    Multi-Pellet-Waffen (z.B. Shotgun) feuern alle Projektile gleichzeitig ab.
    //    Jedes Pellet erhält seinen eigenen zufälligen Spread-Offset zusätzlich zum Pellet-Winkel.
    const pelletCount = cfg.pelletCount ?? 1;
    let didFire: boolean;
    if (pelletCount > 1) {
      const pelletOffsets = calcPelletAngles(pelletCount, cfg.pelletSpreadAngle ?? 0);
      for (const offset of pelletOffsets) {
        const pelletAngle = angle + offset + (Math.random() * 2 - 1) * halfSpreadRad;
        this.dispatchWeaponFire(cfg, x, y, pelletAngle, playerId, playerColor, shotId);
      }
      didFire = true;
    } else {
      const finalAngle = angle + (Math.random() * 2 - 1) * halfSpreadRad;
      didFire = this.dispatchWeaponFire(cfg, x, y, finalAngle, playerId, playerColor, shotId);
    }
    if (!didFire) return;

    // 5. Ressourcen erst nach erfolgreichem Fire-Dispatch abbuchen.
    if (cfg.adrenalinCost > 0) {
      this.resourceSystem.drainAdrenaline(playerId, cfg.adrenalinCost);
    }

    // 6. Bloom erhöhen, dann Cooldown-Timestamp setzen
    weapon.addSpread();
    weapon.recordUse(now);

    // 7. Rückstoß-Impuls (host-autoritativ, Quad-Ease-Out über shotRecoilDuration)
    if (cfg.shotRecoilForce) {
      const oppVx = -Math.cos(angle) * cfg.shotRecoilForce;
      const oppVy = -Math.sin(angle) * cfg.shotRecoilForce;
      this.physicsSystem?.addRecoil(playerId, oppVx, oppVy, cfg.shotRecoilDuration ?? 180);
    }

    // 8. Screenshake beim Schützen (via RPC an alle, gefiltert auf lokalen Spieler)
    if (cfg.shotScreenShake) {
      this.bridge.broadcastShotFx(playerId, cfg.shotScreenShake.duration, cfg.shotScreenShake.intensity);
    }
  }

  private useUtility(
    utility: BaseUtility,
    x: number,
    y: number,
    angle: number,
    playerId: string,
    now: number,
    playerColor: number,
    params?: LoadoutUseParams,
  ): void {
    if (utility.isOnCooldown(now)) return;

    // Ammo-Check (falls Ammo-Tracking aktiv, z.B. Heilige Handgranate)
    const ammo = this.utilityAmmo.get(playerId);
    if (ammo !== undefined && ammo <= 0) return;

    const cfg = utility.config;
    let didUse = false;

    switch (cfg.activation.type) {
      case 'charged_throw':
        didUse = this.throwGrenadeUtility(
          cfg as UtilityConfig & { activation: ChargedThrowUtilityActivationConfig },
          x,
          y,
          angle,
          playerId,
          playerColor,
          params?.utilityChargeFraction ?? 0,
        );
        break;

      case 'charged_gate':
        if ((params?.utilityChargeFraction ?? 0) < 1.0) return; // nicht voll geladen → abbrechen
        if (cfg.type === 'bfg') {
          didUse = this.fireBfgUtility(cfg as BfgUtilityConfig, x, y, angle, playerId);
        }
        break;

      case 'instant':
        didUse = false;
        break;
    }

    if (didUse) {
      // skipCooldownPublish: kein recordUse/publishCooldown für Ammo-basierte Einmal-Items,
      // damit der Cooldown der wiederhergestellten Utility nicht überschrieben wird.
      if (!cfg.skipCooldownPublish) {
        utility.recordUse(now);
        this.bridge.publishUtilityCooldownUntil(playerId, now + cfg.cooldown);
      }

      // Ammo dekrementieren und ggf. altes Utility wiederherstellen
      if (ammo !== undefined) {
        const remaining = ammo - 1;
        if (remaining <= 0) {
          this.restoreUtility(playerId);
        } else {
          this.utilityAmmo.set(playerId, remaining);
        }
      }
    }
  }

  private throwGrenadeUtility(
    cfg: UtilityConfig & { activation: ChargedThrowUtilityActivationConfig },
    x: number,
    y: number,
    angle: number,
    playerId: string,
    playerColor: number,
    chargeFraction: number,
  ): boolean {
    const clampedCharge = Math.max(0, Math.min(1, chargeFraction));
    const speed = cfg.activation.minThrowSpeed
      + (cfg.projectileSpeed - cfg.activation.minThrowSpeed) * clampedCharge;

    this.projectileManager.spawnProjectile(x, y, angle, playerId, {
      speed,
      size:          cfg.projectileSize,
      damage:        0,
      color:         playerColor,
      lifetime:      cfg.fuseTime,
      maxBounces:    cfg.maxBounces,
      isGrenade:     true,
      adrenalinGain: 0,
      weaponName:    cfg.displayName,
      fuseTime:      cfg.fuseTime,
      grenadeEffect: this.buildGrenadeEffect(cfg),
    });

    return true;
  }

  private fireBfgUtility(
    cfg:       BfgUtilityConfig,
    x:         number,
    y:         number,
    angle:     number,
    playerId:  string,
  ): boolean {
    this.projectileManager.spawnProjectile(x, y, angle, playerId, {
      speed:            cfg.projectileSpeed,
      size:             cfg.projectileSize,
      damage:           cfg.directDamage,
      color:            COLORS.GREEN_2,
      lifetime:         5000,      // großzügig – endet durch Arena-Wand
      maxBounces:       0,
      isGrenade:        false,
      adrenalinGain:    0,
      weaponName:       cfg.displayName,
      projectileStyle:  'bfg',
      isBfg:            true,
      bfgLaserRadius:   cfg.laserRadius,
      bfgLaserDamage:   cfg.laserDamage,
      bfgLaserInterval: cfg.laserInterval,
    });

    return true;
  }

  private buildGrenadeEffect(cfg: UtilityConfig): GrenadeEffectConfig {
    if (cfg.type === 'explosive') {
      return {
        type:   'damage',
        radius: cfg.aoeRadius,
        damage: cfg.aoeDamage,
        rockDamageMult:  cfg.rockDamageMult,
        trainDamageMult: cfg.trainDamageMult,
        isHoly:          cfg.holyExplosion,
      };
    }

    if (cfg.type === 'molotov') {
      return {
        type:           'fire',
        radius:         cfg.fireRadius,
        damagePerTick:  cfg.fireDamagePerTick,
        tickInterval:   cfg.fireTickInterval,
        lingerDuration: cfg.fireLingerDuration,
        rockDamageMult:  cfg.rockDamageMult,
        trainDamageMult: cfg.trainDamageMult,
      };
    }

    if (cfg.type === 'smoke') {
      return {
        type:              'smoke',
        radius:            cfg.smokeRadius,
        spreadDuration:    cfg.smokeExpandDuration,
        lingerDuration:    cfg.smokeLingerDuration,
        dissipateDuration: cfg.smokeDissipateDuration,
        maxAlpha:          cfg.smokeMaxAlpha,
      };
    }

    // BFG und andere Typen haben keinen Granaten-Effekt
    return { type: 'damage', radius: 0, damage: 0 };
  }

  private dispatchWeaponFire(
    config:      WeaponConfig,
    x:           number,
    y:           number,
    angle:       number,
    playerId:    string,
    playerColor: number,
    shotId?:     number,
  ): boolean {
    switch (config.fire.type) {
      case 'projectile':
        return this.fireProjectileWeapon(config, config.fire, x, y, angle, playerId, playerColor);

      case 'hitscan':
        return this.fireHitscanWeapon(config, config.fire, x, y, angle, playerId, playerColor, shotId);

      case 'melee':
        return this.fireMeleeWeapon(config, config.fire, x, y, angle, playerId, playerColor);

      case 'flamethrower':
        return this.fireFlamethrowerWeapon(config, config.fire, x, y, angle, playerId, playerColor);

      default:
        return false;
    }
  }

  private fireProjectileWeapon(
    config:      WeaponConfig,
    fireConfig:  ProjectileWeaponFireConfig,
    x:           number,
    y:           number,
    angle:       number,
    playerId:    string,
    playerColor: number,
  ): boolean {
    const lifetime = (config.range / fireConfig.projectileSpeed) * 1000;

    this.projectileManager.spawnProjectile(x, y, angle, playerId, {
      speed:           fireConfig.projectileSpeed,
      size:            fireConfig.projectileSize,
      damage:          config.damage,
      color:           config.projectileColor ?? playerColor,  // Waffen-eigene Farbe hat Vorrang
      lifetime,
      maxBounces:      fireConfig.projectileMaxBounces,
      isGrenade:       false,
      adrenalinGain:   config.adrenalinGain,
      weaponName:      config.displayName,
      projectileStyle: config.projectileStyle,
      tracerConfig:    config.tracerConfig,
      detonable:       config.detonable,
      detonator:       config.detonator,
      rockDamageMult:  config.rockDamageMult,
      trainDamageMult: config.trainDamageMult,
    });

    return true;
  }

  private fireHitscanWeapon(
    config:      WeaponConfig,
    fireConfig:  import('./LoadoutConfig').HitscanWeaponFireConfig,
    x:           number,
    y:           number,
    angle:       number,
    playerId:    string,
    playerColor: number,
    shotId?:     number,
  ): boolean {
    void playerColor;
    return this.combatSystem?.resolveHitscanShot(
      playerId,
      x,
      y,
      angle,
      config.range,
      config.damage,
      fireConfig.traceThickness,
      playerColor,
      config.adrenalinGain,
      config.displayName,
      shotId,
      config.detonator,  // DetonatorConfig weitergeben (optional)
      config.rockDamageMult  ?? 1,
      config.trainDamageMult ?? 1,
    ) ?? false;
  }

  private fireMeleeWeapon(
    config:      WeaponConfig,
    fireConfig:  MeleeWeaponFireConfig,
    x:           number,
    y:           number,
    angle:       number,
    playerId:    string,
    playerColor: number,
  ): boolean {
    return this.combatSystem?.resolveMeleeSwing(
      playerId,
      x,
      y,
      angle,
      config.range,
      fireConfig.hitArcDegrees,
      config.damage,
      config.adrenalinGain,
      config.displayName,
      playerColor,
      config.rockDamageMult  ?? 1,
      config.trainDamageMult ?? 1,
    ) ?? false;
  }

  private fireFlamethrowerWeapon(
    config:      WeaponConfig,
    fireConfig:  FlamethrowerWeaponFireConfig,
    x:           number,
    y:           number,
    angle:       number,
    playerId:    string,
    playerColor: number,
  ): boolean {
    // Lifetime berechnen: Bei velocityDecay < 1 verlangsamt sich die Hitbox exponentiell.
    // Zurückgelegte Strecke = speed / -ln(decay) * (1 - decay^t)
    // → t = ln(1 - range * -ln(decay) / speed) / ln(decay)
    const decay = fireConfig.velocityDecay;
    let lifetime: number;
    if (decay >= 1 || decay <= 0) {
      lifetime = (config.range / fireConfig.projectileSpeed) * 1000;
    } else {
      const lnDecay   = Math.log(decay);
      const maxDist   = fireConfig.projectileSpeed / -lnDecay;
      const distRatio = config.range / maxDist;
      if (distRatio >= 1) {
        lifetime = 3000; // Range nie erreichbar → Cap
      } else {
        lifetime = Math.log(1 - distRatio) / lnDecay * 1000;
      }
    }

    this.projectileManager.spawnProjectile(x, y, angle, playerId, {
      speed:           fireConfig.projectileSpeed,
      size:            fireConfig.hitboxStartSize,
      damage:          config.damage,
      color:           config.projectileColor ?? playerColor,
      lifetime,
      maxBounces:      999999,  // Flammen sterben nicht durch Bounces, sondern durch Lifetime/Kollision
      isGrenade:       false,
      adrenalinGain:   config.adrenalinGain,
      weaponName:      config.displayName,
      projectileStyle: 'flame',
      rockDamageMult:  config.rockDamageMult,
      trainDamageMult: config.trainDamageMult,
      // Flammenwerfer-spezifische Felder
      isFlame:         true,
      hitboxGrowRate:  fireConfig.hitboxGrowRate,
      hitboxMaxSize:   fireConfig.hitboxEndSize,
      velocityDecay:   fireConfig.velocityDecay,
    });

    return true;
  }
}
