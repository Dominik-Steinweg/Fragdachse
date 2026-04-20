import type { PlayerManager }     from '../entities/PlayerManager';
import type { ProjectileManager } from '../entities/ProjectileManager';
import type { ResourceSystem }    from '../systems/ResourceSystem';
import type { ArmageddonSystem }  from '../systems/ArmageddonSystem';
import type { StinkCloudSystem }  from '../effects/StinkCloudSystem';
import type { NetworkBridge }     from '../network/NetworkBridge';
import type { CombatSystem }      from '../systems/CombatSystem';
import type { EnergyShieldSystem } from '../systems/EnergyShieldSystem';
import type { ShieldBuffSystem }   from '../systems/ShieldBuffSystem';
import type { TeslaDomeSystem }   from '../systems/TeslaDomeSystem';
import type { GrenadeEffectConfig, LoadoutSlot, LoadoutUseParams, LoadoutUseResult, PlayerAimNetState, ShieldBuffHudState, WeaponSlot } from '../types';
import type {
  AirstrikeUltimateConfig,
  BfgUtilityConfig,
  ChargedThrowUtilityActivationConfig,
  DecoyUtilityConfig,
  EnergyShieldWeaponFireConfig,
  GaussUltimateConfig,
  NukeUtilityConfig,
  PlaceableUtilityConfig,
  StinkCloudUtilityConfig,
  TaserUtilityConfig,
  TunnelUltimateConfig,
  FlamethrowerWeaponFireConfig,
  MeleeWeaponFireConfig,
  ProjectileWeaponFireConfig,
  TeslaDomeWeaponFireConfig,
  UltimateConfig,
  UtilityConfig,
  WeaponConfig,
} from './LoadoutConfig';
import { COLORS, RAGE_MAX, getTopDownMuzzleOrigin } from '../config';
import { WEAPON_CONFIGS, UTILITY_CONFIGS, ULTIMATE_CONFIGS } from './LoadoutConfig';
import { sanitizeLoadoutSelectionForMode } from './LoadoutRules';
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
import { EnergyShieldWeapon } from './EnergyShieldWeapon';
import { TeslaDomeWeapon } from './TeslaDomeWeapon';
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
  consumedRage: number;
  durationMs: number;
  drainDurationMs: number;
  nextArmorTickAt: number;
  gaussChargeStartedAt: number | null;
}

type CombatResolverType = Pick<CombatSystem, 'addArmor' | 'resolveHitscanShot' | 'traceHitscan' | 'resolveMeleeSwing'>;
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
  private armageddonSystem:   ArmageddonSystem | null = null;
  private nukeStrikeHandler:      ((playerId: string, targetX: number, targetY: number) => boolean) | null = null;
  private airstrikeHandler:        ((playerId: string, targetX: number, targetY: number, cfg: AirstrikeUltimateConfig) => boolean) | null = null;
  private stinkCloudSystem:   StinkCloudSystem | null = null;
  private teslaDomeSystem:    TeslaDomeSystem | null = null;
  private energyShieldSystem: EnergyShieldSystem | null = null;
  private shieldBuffSystem:   ShieldBuffSystem | null = null;
  private translocatorSystem: import('../systems/TranslocatorSystem').TranslocatorSystem | null = null;
  private decoySystem: import('../systems/DecoySystem').DecoySystem | null = null;
  private actionBlockedChecker: ((playerId: string, slot: LoadoutSlot) => boolean) | null = null;
  private placeableRockHandler: ((cfg: PlaceableUtilityConfig, playerId: string, x: number, y: number, targetX: number, targetY: number, now: number, playerColor: number) => boolean) | null = null;
  private tunnelPlacementHandler: ((cfg: TunnelUltimateConfig, playerId: string, x: number, y: number, targetX: number, targetY: number, playerColor: number, params?: LoadoutUseParams) => boolean) | null = null;
  private utilityUsedCallback: ((playerId: string, utilityType: UtilityConfig['type']) => void) | null = null;

  // Held-Fire-Tracking: Feuerknopf gilt als gehalten wenn innerhalb HOLD_EXPIRE_MS gefeuert wurde
  private heldFireSlots = new Map<string, { slot: WeaponSlot; lastAt: number }>();
  private static readonly HOLD_EXPIRE_MS = 100;

  private readonly okResult: LoadoutUseResult = { ok: true };

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
    const sanitized = sanitizeLoadoutSelectionForMode(selection, this.bridge.getGameMode());
    const w1Cfg = sanitized.weapon1;
    const w2Cfg = sanitized.weapon2;
    const utCfg = sanitized.utility;
    const ultCfg = sanitized.ultimate;
    this.loadouts.set(playerId, {
      weapon1:  this.createWeapon(w1Cfg),
      weapon2:  this.createWeapon(w2Cfg),
      utility:  new GenericUtility(utCfg),
      ultimate: new GenericUltimate(ultCfg),
    });
    this.ultimateStates.set(playerId, {
      active:    false,
      startTime: 0,
      config:    ultCfg,
      consumedRage: 0,
      durationMs: 0,
      drainDurationMs: 0,
      nextArmorTickAt: 0,
      gaussChargeStartedAt: null,
    });
    // Eventuell gespeichertes Utility-Override aufräumen (z.B. Tod während HHG)
    this.savedUtilities.delete(playerId);
    this.utilityAmmo.delete(playerId);
    this.bridge.publishUtilityCooldownUntil(playerId, 0);
    this.bridge.publishUtilityOverrideName(playerId, '');
    this.teslaDomeSystem?.hostDeactivateForPlayer(playerId);
    this.energyShieldSystem?.hostDeactivateForPlayer(playerId);
    this.shieldBuffSystem?.resetPlayer(playerId);
  }

  /**
   * Zieht eine geaenderte Lobby-Auswahl in das autoritative Host-Loadout nach,
   * ohne unveraenderte Spieler jedes Frame neu zu initialisieren.
   */
  syncSelectedLoadout(playerId: string, selection?: LoadoutSelection): void {
    const sanitized = sanitizeLoadoutSelectionForMode(selection, this.bridge.getGameMode());
    const nextWeapon1 = sanitized.weapon1;
    const nextWeapon2 = sanitized.weapon2;
    const nextUtility = sanitized.utility;
    const nextUltimate = sanitized.ultimate;
    const current = this.loadouts.get(playerId);
    const currentUltimate = this.ultimateStates.get(playerId)?.config;

    if (
      current
      && current.weapon1.config.id === nextWeapon1.id
      && current.weapon2.config.id === nextWeapon2.id
      && current.utility.config.id === nextUtility.id
      && currentUltimate?.id === nextUltimate.id
    ) {
      return;
    }

    this.assignDefaultLoadout(playerId, selection);
  }

  removePlayer(playerId: string): void {
    this.loadouts.delete(playerId);
    this.ultimateStates.delete(playerId);
    this.aimNetStates.delete(playerId);
    this.savedUtilities.delete(playerId);
    this.utilityAmmo.delete(playerId);
    this.heldFireSlots.delete(playerId);
    this.teslaDomeSystem?.hostDeactivateForPlayer(playerId);
    this.energyShieldSystem?.hostDeactivateForPlayer(playerId);
    this.shieldBuffSystem?.removePlayer(playerId);
    this.translocatorSystem?.removePlayer(playerId);
    this.decoySystem?.clearPlayer(playerId);
  }

  beginUtilityCooldown(playerId: string, utilityId: string, now: number): void {
    const loadout = this.loadouts.get(playerId);
    if (!loadout) return;
    if (loadout.utility.config.id !== utilityId) return;
    loadout.utility.recordUse(now);
    this.bridge.publishUtilityCooldownUntil(playerId, now + loadout.utility.config.cooldown);
  }

  resetUltimateState(playerId: string): void {
    const state = this.ultimateStates.get(playerId);
    if (!state) return;
    if (state.active && state.config.type === 'buff' && state.config.armageddon && this.armageddonSystem) {
      this.armageddonSystem.deactivate(playerId);
    }
    state.active = false;
    state.startTime = 0;
    state.consumedRage = 0;
    state.durationMs = 0;
    state.drainDurationMs = 0;
    state.nextArmorTickAt = 0;
    state.gaussChargeStartedAt = null;
  }

  resetAllUltimateStates(): void {
    for (const playerId of this.ultimateStates.keys()) {
      this.resetUltimateState(playerId);
    }
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

  setTranslocatorSystem(sys: import('../systems/TranslocatorSystem').TranslocatorSystem | null): void {
    this.translocatorSystem = sys;
  }

  setDecoySystem(sys: import('../systems/DecoySystem').DecoySystem | null): void {
    this.decoySystem = sys;
  }

  setUtilityUsedCallback(cb: ((playerId: string, utilityType: UtilityConfig['type']) => void) | null): void {
    this.utilityUsedCallback = cb;
  }

  /** Injiziert das ArmageddonSystem für Meteor-Ultimates. */
  setArmageddonSystem(sys: ArmageddonSystem | null): void {
    this.armageddonSystem = sys;
  }

  /** Injiziert die Host-Logik für zielbasierte Nuke-Strikes. */
  setNukeStrikeHandler(handler: ((playerId: string, targetX: number, targetY: number) => boolean) | null): void {
    this.nukeStrikeHandler = handler;
  }

  /** Injiziert die Host-Logik für Luftangriff-Strikes. */
  setAirstrikeHandler(handler: ((playerId: string, targetX: number, targetY: number, cfg: AirstrikeUltimateConfig) => boolean) | null): void {
    this.airstrikeHandler = handler;
  }

  /** Injiziert das StinkCloudSystem für Stinkdrüsen-Utilities. */
  setStinkCloudSystem(sys: StinkCloudSystem | null): void {
    this.stinkCloudSystem = sys;
  }

  /** Injiziert das TeslaDomeSystem für kontinuierliche Tesla-Kuppeln. */
  setTeslaDomeSystem(sys: TeslaDomeSystem | null): void {
    this.teslaDomeSystem = sys;
  }

  setEnergyShieldSystem(sys: EnergyShieldSystem | null): void {
    this.energyShieldSystem = sys;
  }

  setShieldBuffSystem(sys: ShieldBuffSystem | null): void {
    this.shieldBuffSystem = sys;
  }

  /** Injiziert einen Host-seitigen Blocker für Aktionen (z.B. tot, verbuddelt, stunned). */
  setActionBlockedChecker(checker: ((playerId: string, slot: LoadoutSlot) => boolean) | null): void {
    this.actionBlockedChecker = checker;
  }

  setPlaceableRockHandler(handler: ((cfg: PlaceableUtilityConfig, playerId: string, x: number, y: number, targetX: number, targetY: number, now: number, playerColor: number) => boolean) | null): void {
    this.placeableRockHandler = handler;
  }

  setTunnelPlacementHandler(handler: ((cfg: TunnelUltimateConfig, playerId: string, x: number, y: number, targetX: number, targetY: number, playerColor: number, params?: LoadoutUseParams) => boolean) | null): void {
    this.tunnelPlacementHandler = handler;
  }

  fireAutomatedWeapon(
    config: WeaponConfig,
    x: number,
    y: number,
    angle: number,
    targetX: number,
    targetY: number,
    playerId: string,
    playerColor: number,
  ): boolean {
    return this.dispatchWeaponFire(config, x, y, angle, targetX, targetY, playerId, playerColor, undefined);
  }

  // ── Utility-Override (temporärer Slot-Tausch, z.B. Heilige Handgranate) ──

  /**
   * Überschreibt den Utility-Slot eines Spielers temporär.
   * Der aktuelle Zustand (Config + Cooldown) wird zwischengespeichert.
   */
  overrideUtility(playerId: string, config: UtilityConfig, ammo: number): void {
    const loadout = this.loadouts.get(playerId);
    if (!loadout) return;

    // Nur das urspruengliche Basis-Utility sichern. Wenn bereits ein Spezial-Utility aktiv ist,
    // darf ein neu eingesammeltes Spezial-Utility diesen Snapshot nicht ueberschreiben.
    if (!this.savedUtilities.has(playerId)) {
      this.savedUtilities.set(playerId, {
        config:     loadout.utility.config,
        lastUsedAt: loadout.utility.getLastUsedAt(),
      });
    }

    // Neues Utility einsetzen
    loadout.utility = new GenericUtility(config);
    this.utilityAmmo.set(playerId, ammo);
    this.bridge.publishUtilityCooldownUntil(playerId, 0); // sofort einsatzbereit
    this.bridge.publishUtilityOverrideName(playerId, config.displayName);
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
    this.bridge.publishUtilityOverrideName(playerId, ''); // Override aufgehoben
  }

  // ── Haupt-Dispatch (vom Host-RPC-Handler) ────────────────────────────────

  use(
    slot:      LoadoutSlot,
    playerId:  string,
    angle:     number,
    targetX:   number,
    targetY:   number,
    now:       number,
    shotId?:   number,
    params?:   LoadoutUseParams,
    clientX?:  number,
    clientY?:  number,
  ): LoadoutUseResult {
    const loadout = this.loadouts.get(playerId);
    if (!loadout) return { ok: false, reason: 'invalid' };
    if (this.actionBlockedChecker?.(playerId, slot)) return { ok: false, reason: 'blocked' };

    const player = this.playerManager.getPlayer(playerId);
    if (!player) return { ok: false, reason: 'invalid' };
    // Client-Position verwenden falls vorhanden (kompensiert Netzwerk-Tick-Latenz),
    // sonst Fallback auf autoritative Host-Position.
    const x = clientX ?? player.sprite.x;
    const y = clientY ?? player.sprite.y;

    // Schießen während Dash-Phase 1 (Burst) blockiert
    if ((slot === 'weapon1' || slot === 'weapon2') && this.dashBurstChecker?.(playerId)) return { ok: false, reason: 'blocked' };

    // Held-Fire-Tracking: Feuerknopf-Halte-Zustand aktualisieren
    if (slot === 'weapon1' || slot === 'weapon2') {
      this.heldFireSlots.set(playerId, { slot, lastAt: now });
      this.decoySystem?.breakStealth(playerId, now);
    }

    // scopeHolding: Scope-Waffe wird gehalten, aber noch kein Schuss – nur holdSpeedFactor aktiv
    if (params?.scopeHolding && (slot === 'weapon1' || slot === 'weapon2')) {
      return this.okResult;
    }

    switch (slot) {
      case 'weapon1':
        return this.fireWeapon(loadout.weapon1, x, y, angle, targetX, targetY, playerId, now, player.color, 'weapon1', shotId);

      case 'weapon2':
        return this.fireWeapon(loadout.weapon2, x, y, angle, targetX, targetY, playerId, now, player.color, 'weapon2', shotId, params);

      case 'utility': {
        if (loadout.utility.config.type !== 'decoy') {
          this.decoySystem?.breakStealth(playerId, now);
        }
        return this.useUtility(loadout.utility, x, y, angle, targetX, targetY, playerId, now, player.color, params)
          ? this.okResult
          : { ok: false, reason: 'blocked' };
      }

      case 'ultimate': {
        this.decoySystem?.breakStealth(playerId, now);
        const ultState = this.ultimateStates.get(playerId);
        const cfg  = loadout.ultimate.config;
        if (cfg.type === 'buff') {
          if (ultState?.active) return { ok: false, reason: 'blocked' };
          const rage = this.resourceSystem.getRage(playerId);
          if (rage < cfg.rageRequired) return { ok: false, reason: 'resource', resourceKind: 'rage' };
          const consumedRage = Math.min(rage, RAGE_MAX);
          const scale = consumedRage / cfg.rageRequired;
          const durationMs = Math.max(1, Math.round(cfg.duration * scale));
          const drainDurationMs = Math.max(1, Math.round(cfg.rageDrainDuration * scale));
          this.ultimateStates.set(playerId, {
            active: true,
            startTime: now,
            config: cfg,
            consumedRage,
            durationMs,
            drainDurationMs,
            nextArmorTickAt: now + cfg.armorTickIntervalMs,
            gaussChargeStartedAt: null,
          });

          if (cfg.armageddon && this.armageddonSystem) {
            const pm = this.playerManager;
            this.armageddonSystem.activate(playerId, cfg.armageddon, () => {
              const p = pm.getPlayer(playerId);
              return p ? { x: p.sprite.x, y: p.sprite.y } : null;
            });
          }
          return this.okResult;
        }

        if (cfg.type === 'airstrike') {
          const rage = this.resourceSystem.getRage(playerId);
          if (rage < cfg.rageCost) return { ok: false, reason: 'resource', resourceKind: 'rage' };
          const ok = this.airstrikeHandler?.(playerId, targetX, targetY, cfg) ?? false;
          if (!ok) return { ok: false, reason: 'blocked' };
          this.resourceSystem.addRage(playerId, -cfg.rageCost);
          return this.okResult;
        }

        if (cfg.type === 'tunnel') {
          const rage = this.resourceSystem.getRage(playerId);
          if (rage < cfg.rageRequired) return { ok: false, reason: 'resource', resourceKind: 'rage' };
          if (params?.tunnelAction !== 'commit') return { ok: false, reason: 'blocked' };
          const ok = this.tunnelPlacementHandler?.(cfg, playerId, x, y, targetX, targetY, player.color, params) ?? false;
          if (!ok) return { ok: false, reason: 'blocked' };
          this.resourceSystem.addRage(playerId, -cfg.rageCost);
          return this.okResult;
        }

        return this.handleGaussUltimateUse(
          cfg,
          playerId,
          x,
          y,
          angle,
          now,
          player.color,
          ultState,
          params,
        );
      }
    }

    return { ok: false, reason: 'invalid' };
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
      if (state.config.type !== 'buff') continue;

      const elapsed  = now - state.startTime;
      const endTime = state.startTime + state.durationMs;
      const fraction = Math.min(1, elapsed / state.drainDurationMs);
      const targetRage  = state.consumedRage * (1 - fraction);
      const currentRage = this.resourceSystem.getRage(playerId);
      const drain = currentRage - targetRage;
      if (drain > 0) {
        this.resourceSystem.addRage(playerId, -drain);
      }

      if (state.config.armorPerTick > 0 && state.config.armorTickIntervalMs > 0 && this.combatSystem) {
        while (state.nextArmorTickAt > 0 && state.nextArmorTickAt <= now && state.nextArmorTickAt <= endTime) {
          this.combatSystem.addArmor(playerId, state.config.armorPerTick);
          state.nextArmorTickAt += state.config.armorTickIntervalMs;
        }
      }

      if (elapsed >= state.durationMs) {
        state.active = false;
        state.consumedRage = 0;
        state.durationMs = 0;
        state.drainDurationMs = 0;
        state.nextArmorTickAt = 0;
        // Armageddon: Meteor-Spawning stoppen (In-Flight-Meteore schlagen noch ein)
        if (state.config.armageddon && this.armageddonSystem) {
          this.armageddonSystem.deactivate(playerId);
        }
      }
    }
  }

  // ── Multiplier-Getter ─────────────────────────────────────────────────────

  getSpeedMultiplier(playerId: string): number {
    const state        = this.ultimateStates.get(playerId);
    const ultimateMult = state?.active && state.config.type === 'buff' ? state.config.speedMultiplier : 1;
    const gaussSlowMult = state?.config.type === 'gauss' && state.gaussChargeStartedAt !== null
      ? state.config.movementSlowFactor
      : 1;

    // holdSpeedFactor: Verlangsamung wenn Feuerknopf gehalten wird
    const held = this.heldFireSlots.get(playerId);
    if (held && Date.now() - held.lastAt < LoadoutManager.HOLD_EXPIRE_MS) {
      const cfg = this.loadouts.get(playerId)?.[held.slot].config;
      if (cfg?.fire.type === 'tesla_dome') {
        const fireCfg = cfg.fire as TeslaDomeWeaponFireConfig;
        const holdFactor = this.teslaDomeSystem?.isActive(playerId) ? fireCfg.movementSlowFactor : 1;
        return ultimateMult * gaussSlowMult * holdFactor;
      }
      if (cfg?.fire.type === 'energy_shield') {
        const fireCfg = cfg.fire as EnergyShieldWeaponFireConfig;
        const holdFactor = this.energyShieldSystem?.isActive(playerId) ? fireCfg.movementSlowFactor : 1;
        return ultimateMult * gaussSlowMult * holdFactor;
      }
      const holdFactor = cfg?.holdSpeedFactor ?? 1;
      return ultimateMult * gaussSlowMult * holdFactor;
    }

    return ultimateMult * gaussSlowMult;
  }

  getDamageMultiplier(playerId: string): number {
    const state = this.ultimateStates.get(playerId);
    return state?.active && state.config.type === 'buff' ? state.config.damageMultiplier : 1;
  }

  getWeaponDamageMultiplier(playerId: string, slot: WeaponSlot, now = Date.now()): number {
    const baseMultiplier = this.getDamageMultiplier(playerId);
    if (slot !== 'weapon1') return baseMultiplier;

    const fireCfg = this.getEquippedEnergyShieldFireConfig(playerId);
    if (!fireCfg || !this.shieldBuffSystem) return baseMultiplier;
    return baseMultiplier * this.shieldBuffSystem.getPrimaryDamageMultiplier(playerId, fireCfg, now);
  }

  getShieldBuffHudState(playerId: string, now = Date.now()): ShieldBuffHudState {
    const fireCfg = this.getEquippedEnergyShieldFireConfig(playerId);
    if (!fireCfg || !this.shieldBuffSystem) {
      return {
        visible: false,
        defId: 'SHIELD_OVERCHARGE',
        value: 0,
        maxValue: 1,
        damageBonusPct: 0,
      };
    }
    return this.shieldBuffSystem.getHudState(playerId, fireCfg, true, now);
  }

  isUltimateActive(playerId: string): boolean {
    return this.ultimateStates.get(playerId)?.active ?? false;
  }

  getEquippedUltimateConfig(playerId: string): UltimateConfig | undefined {
    return this.loadouts.get(playerId)?.ultimate.config;
  }

  getUltimateRequiredRage(playerId: string): number {
    return this.loadouts.get(playerId)?.ultimate.config.rageRequired ?? RAGE_MAX;
  }

  isUltimateCharging(playerId: string): boolean {
    return this.ultimateStates.get(playerId)?.gaussChargeStartedAt !== null;
  }

  getUltimateChargeFraction(playerId: string, now: number): number {
    const state = this.ultimateStates.get(playerId);
    if (!state || state.config.type !== 'gauss' || state.gaussChargeStartedAt === null) return 0;
    if (state.config.chargeDuration <= 0) return 1;
    return Math.max(0, Math.min(1, (now - state.gaussChargeStartedAt) / state.config.chargeDuration));
  }

  getUltimateChargeRange(playerId: string): number {
    const state = this.ultimateStates.get(playerId);
    if (state?.config.type === 'gauss') return state.config.range;
    const config = this.loadouts.get(playerId)?.ultimate.config;
    return config?.type === 'gauss' ? config.range : 0;
  }

  getUltimateThresholds(playerId: string): number[] {
    const config = this.loadouts.get(playerId)?.ultimate.config;
    if (!config) return [];
    if (config.type === 'gauss') {
      const thresholds: number[] = [];
      for (let value = config.rageCost; value < RAGE_MAX; value += config.rageCost) {
        thresholds.push(value);
      }
      return thresholds;
    }
    return [config.rageRequired];
  }

  private handleGaussUltimateUse(
    cfg: GaussUltimateConfig,
    playerId: string,
    x: number,
    y: number,
    angle: number,
    now: number,
    playerColor: number,
    state: UltimateState | undefined,
    params?: LoadoutUseParams,
  ): LoadoutUseResult {
    const action = params?.ultimateAction;
    const currentState = state ?? {
      active: false,
      startTime: 0,
      config: cfg,
      consumedRage: 0,
      durationMs: 0,
      drainDurationMs: 0,
      nextArmorTickAt: 0,
      gaussChargeStartedAt: null,
    };
    currentState.config = cfg;

    if (action === 'press') {
      if (currentState.gaussChargeStartedAt !== null) return { ok: false, reason: 'blocked' };
      if (this.resourceSystem.getRage(playerId) < cfg.rageRequired) return { ok: false, reason: 'resource', resourceKind: 'rage' };
      currentState.gaussChargeStartedAt = now;
      this.ultimateStates.set(playerId, currentState);
      return this.okResult;
    }

    if (action === 'release') {
      const startedAt = currentState.gaussChargeStartedAt;
      currentState.gaussChargeStartedAt = null;
      this.ultimateStates.set(playerId, currentState);
      if (startedAt === null) return { ok: false, reason: 'blocked' };
      if (this.resourceSystem.getRage(playerId) < cfg.rageCost) return { ok: false, reason: 'resource', resourceKind: 'rage' };
      if ((params?.ultimateChargeFraction ?? 0) < 1) return { ok: false, reason: 'blocked' };
      this.fireGaussUltimate(cfg, x, y, angle, playerId, playerColor);
      this.resourceSystem.addRage(playerId, -cfg.rageCost);
      return this.okResult;
    }

    return { ok: false, reason: 'blocked' };
  }

  private fireGaussUltimate(
    cfg: GaussUltimateConfig,
    x: number,
    y: number,
    angle: number,
    playerId: string,
    playerColor: number,
  ): void {
    const lifetime = (cfg.range / cfg.projectileSpeed) * 1000;
    this.projectileManager.spawnProjectile(x, y, angle, playerId, {
      speed:             cfg.projectileSpeed,
      size:              cfg.projectileSize,
      damage:            cfg.damage,
      color:             cfg.projectileColor,
      ownerColor:        playerColor,
      lifetime,
      maxBounces:        0,
      isGrenade:         false,
      adrenalinGain:     0,
      weaponName:        cfg.displayName,
      projectileStyle:   'gauss',
      bulletVisualPreset: cfg.bulletVisualPreset,
      tracerConfig:      cfg.tracerConfig,
      rockDamageMult:    cfg.rockDamageMult,
      trainDamageMult:   cfg.trainDamageMult,
      shotAudioKey:      cfg.shotAudio?.successKey,
    });

    this.physicsSystem?.addRecoil(
      playerId,
      -Math.cos(angle) * cfg.shotRecoilForce,
      -Math.sin(angle) * cfg.shotRecoilForce,
      cfg.shotRecoilDuration,
    );
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
    targetX:  number,
    targetY:  number,
    playerId: string,
    now:      number,
    playerColor: number,
    sourceSlot: WeaponSlot,
    shotId?:  number,
    params?:  LoadoutUseParams,
  ): LoadoutUseResult {
    if (weapon.config.fire.type === 'tesla_dome') {
      this.activateTeslaDomeWeapon(weapon, x, y, playerId, now, playerColor);
      return this.okResult;
    }
    if (weapon.config.fire.type === 'energy_shield') {
      this.activateEnergyShieldWeapon(weapon, playerId, now, playerColor);
      return this.okResult;
    }

    // 1. Cooldown-Check
    if (weapon.isOnCooldown(now)) return { ok: false, reason: 'cooldown' };

    const cfg = weapon.config;

    // 2. Adrenalin-Check (nur wenn Kosten > 0, sonst Regen-Pause nicht unterbrechen)
    if (cfg.adrenalinCost > 0) {
      if (this.resourceSystem.getAdrenaline(playerId) < cfg.adrenalinCost) return { ok: false, reason: 'resource', resourceKind: 'adrenaline' };
    }

    // 3. Spread-Parameter berechnen
    // Bewegungsstatus direkt vom Physics-Body lesen – der Host besitzt die Simulation,
    // daher ist velocity immer aktuell (kein Netzwerk-Lag wie bei getPlayerInput).
    const shooterBody = this.playerManager.getPlayer(playerId)?.body;
    const isMoving    = isVelocityMoving(shooterBody?.velocity.x ?? 0, shooterBody?.velocity.y ?? 0);
    // Bei Scope-Waffen: Spread interpoliert zwischen unscopedSpreadDeg (scope=0) und normalem Spread (scope=1)
    const scopeCfg      = cfg.scopeConfig;
    const scopeProgress = params?.scopeProgress;
    let baseSpread: number;
    if (scopeCfg !== undefined && scopeProgress !== undefined) {
      const fullyAimedSpread = isMoving ? cfg.spreadMoving : cfg.spreadStanding;
      baseSpread = scopeCfg.unscopedSpreadDeg + (fullyAimedSpread - scopeCfg.unscopedSpreadDeg) * scopeProgress;
    } else {
      baseSpread = isMoving ? cfg.spreadMoving : cfg.spreadStanding;
    }
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
        this.dispatchWeaponFire(cfg, x, y, pelletAngle, targetX, targetY, playerId, playerColor, sourceSlot, shotId);
      }
      didFire = true;
    } else {
      const finalAngle = angle + (Math.random() * 2 - 1) * halfSpreadRad;
      didFire = this.dispatchWeaponFire(cfg, x, y, finalAngle, targetX, targetY, playerId, playerColor, sourceSlot, shotId);
    }
    if (!didFire) return { ok: false, reason: 'blocked' };

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

    return this.okResult;
  }

  private useUtility(
    utility: BaseUtility,
    x: number,
    y: number,
    angle: number,
    targetX: number,
    targetY: number,
    playerId: string,
    now: number,
    playerColor: number,
    params?: LoadoutUseParams,
  ): boolean {
    if (utility.isOnCooldown(now)) return false;

    // Ammo-Check (falls Ammo-Tracking aktiv, z.B. Heilige Handgranate)
    const ammo = this.utilityAmmo.get(playerId);
    if (ammo !== undefined && ammo <= 0) return false;

    const cfg = utility.config;
    let didUse = false;

    switch (cfg.activation.type) {
      case 'charged_throw':
        if (cfg.type === 'translocator') {
          didUse = this.translocatorSystem?.handleUse(playerId, angle, targetX, targetY, now, params) ?? false;
        } else {
          didUse = this.throwGrenadeUtility(
            cfg as UtilityConfig & { activation: ChargedThrowUtilityActivationConfig },
            x,
            y,
            angle,
            playerId,
            playerColor,
            params?.utilityChargeFraction ?? 0,
          );
        }
        break;

      case 'charged_gate':
        if ((params?.utilityChargeFraction ?? 0) < 1.0) return false; // nicht voll geladen → abbrechen
        if (cfg.type === 'bfg') {
          didUse = this.fireBfgUtility(cfg as BfgUtilityConfig, x, y, angle, playerId);
        }
        break;

      case 'targeted_click':
        if (cfg.type === 'nuke') {
          didUse = this.triggerNukeUtility(cfg as NukeUtilityConfig, playerId, targetX, targetY);
        }
        break;

      case 'placement_mode':
        if (cfg.type === 'placeable_rock' || cfg.type === 'placeable_turret') {
          didUse = this.placeableRockHandler?.(cfg as PlaceableUtilityConfig, playerId, x, y, targetX, targetY, now, playerColor) ?? false;
        }
        break;

      case 'instant':
        if (cfg.type === 'stinkcloud') {
          didUse = this.activateStinkCloud(cfg as StinkCloudUtilityConfig, playerId);
        } else if (cfg.type === 'taser') {
          const taserCfg = cfg as TaserUtilityConfig;
          didUse = this.combatSystem?.resolveMeleeSwing(
            playerId, x, y, angle,
            taserCfg.range, taserCfg.hitArcDegrees, taserCfg.damage,
            0,           // kein Adrenalin-Gain
            taserCfg.displayName, playerColor,
            undefined,   // kein sourceSlot (Utility)
            taserCfg.rockDamageMult ?? 1,
            taserCfg.trainDamageMult ?? 1,
            taserCfg.visualPreset,
            taserCfg.shotAudio?.successKey,
          ) ?? false;
        } else if (cfg.type === 'decoy') {
          didUse = this.decoySystem?.activate(cfg as DecoyUtilityConfig, playerId, angle, playerColor, now) ?? false;
        }
        break;
    }

    if (didUse) {
      this.utilityUsedCallback?.(playerId, cfg.type);

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

    return didUse;
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
      color:         cfg.projectileColor ?? playerColor,
      allowTeamDamage: cfg.allowTeamDamage,
      lifetime:      cfg.fuseTime,
      maxBounces:    cfg.maxBounces,
      isGrenade:     true,
      adrenalinGain: 0,
      weaponName:    cfg.displayName,
      fuseTime:      cfg.fuseTime,
      grenadeEffect: this.buildGrenadeEffect(cfg),
      projectileStyle: cfg.projectileStyle,
      grenadeVisualPreset: cfg.grenadeVisualPreset,
      frictionDelayMs: cfg.frictionDelayMs,
      airFrictionDecayPerSec: cfg.airFrictionDecayPerSec,
      bounceFrictionMultiplier: cfg.bounceFrictionMultiplier,
      stopSpeedThreshold: cfg.stopSpeedThreshold,
      shotAudioKey:    cfg.shotAudio?.successKey,
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
      allowTeamDamage:  cfg.allowTeamDamage,
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
      shotAudioKey:     cfg.shotAudio?.successKey,
    });

    return true;
  }

  private triggerNukeUtility(
    _cfg: NukeUtilityConfig,
    playerId: string,
    targetX: number,
    targetY: number,
  ): boolean {
    return this.nukeStrikeHandler?.(playerId, targetX, targetY) ?? false;
  }

  private activateStinkCloud(cfg: StinkCloudUtilityConfig, playerId: string): boolean {
    if (!this.stinkCloudSystem) return false;
    this.stinkCloudSystem.hostActivate(
      playerId,
      cfg.cloudRadius,
      cfg.cloudDuration,
      cfg.cloudDamagePerTick,
      cfg.cloudTickInterval,
      cfg.rockDamageMult ?? 1,
      cfg.trainDamageMult ?? 1,
    );
    return true;
  }

  private buildGrenadeEffect(cfg: UtilityConfig): GrenadeEffectConfig {
    if (cfg.type === 'explosive') {
      return {
        type:   'damage',
        radius: cfg.aoeRadius,
        damage: cfg.aoeDamage,
        damageFalloff:   cfg.damageFalloff,
        allowTeamDamage: cfg.allowTeamDamage,
        rockDamageMult:  cfg.rockDamageMult,
        trainDamageMult: cfg.trainDamageMult,
        visualStyle:     cfg.explosionVisualStyle,
      };
    }

    if (cfg.type === 'molotov') {
      return {
        type:           'fire',
        radius:         cfg.fireRadius,
        damagePerTick:  cfg.fireDamagePerTick,
        tickInterval:   cfg.fireTickInterval,
        lingerDuration: cfg.fireLingerDuration,
        allowTeamDamage: cfg.allowTeamDamage,
        rockDamageMult:  cfg.rockDamageMult,
        trainDamageMult: cfg.trainDamageMult,
        burnDurationMs:     cfg.fireBurnDurationMs,
        burnDamagePerTick:  cfg.fireBurnDamagePerTick,
        burnTickIntervalMs: cfg.fireBurnTickIntervalMs,
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
    targetX:     number,
    targetY:     number,
    playerId:    string,
    playerColor: number,
    sourceSlot?: LoadoutSlot,
    shotId?:     number,
  ): boolean {
    switch (config.fire.type) {
      case 'projectile':
        return this.fireProjectileWeapon(config, config.fire, x, y, angle, targetX, targetY, playerId, playerColor, sourceSlot);

      case 'hitscan':
        return this.fireHitscanWeapon(config, config.fire, x, y, angle, playerId, playerColor, sourceSlot as WeaponSlot | undefined, shotId);

      case 'melee':
        return this.fireMeleeWeapon(config, config.fire, x, y, angle, playerId, playerColor, sourceSlot as WeaponSlot | undefined);

      case 'flamethrower':
        return this.fireFlamethrowerWeapon(config, config.fire, x, y, angle, playerId, playerColor, sourceSlot);

      case 'tesla_dome':
      case 'energy_shield':
        return false;

      default:
        return false;
    }
  }

  private createWeapon(config: WeaponConfig): BaseWeapon {
    if (config.fire.type === 'tesla_dome') {
      return new TeslaDomeWeapon(config as WeaponConfig & { fire: TeslaDomeWeaponFireConfig });
    }
    if (config.fire.type === 'energy_shield') {
      return new EnergyShieldWeapon(config as WeaponConfig & { fire: EnergyShieldWeaponFireConfig });
    }
    return new GenericWeapon(config);
  }

  private activateTeslaDomeWeapon(
    weapon: BaseWeapon,
    x: number,
    y: number,
    playerId: string,
    now: number,
    playerColor: number,
  ): void {
    if (!this.teslaDomeSystem) return;
    if (this.resourceSystem.getAdrenaline(playerId) <= 0) {
      this.teslaDomeSystem.hostDeactivateForPlayer(playerId);
      return;
    }

    const cfg = weapon.config as WeaponConfig & { fire: TeslaDomeWeaponFireConfig };
    this.teslaDomeSystem.hostRefresh(playerId, x, y, now, cfg, cfg.projectileColor ?? playerColor);
  }

  private activateEnergyShieldWeapon(
    weapon: BaseWeapon,
    playerId: string,
    now: number,
    playerColor: number,
  ): void {
    if (!this.energyShieldSystem) return;
    if (this.resourceSystem.getAdrenaline(playerId) <= 0) {
      this.energyShieldSystem.hostDeactivateForPlayer(playerId);
      return;
    }

    const cfg = weapon.config as WeaponConfig & { fire: EnergyShieldWeaponFireConfig };
    this.energyShieldSystem.hostRefresh(playerId, now, cfg, cfg.projectileColor ?? playerColor);
  }

  private fireProjectileWeapon(
    config:      WeaponConfig,
    fireConfig:  ProjectileWeaponFireConfig,
    x:           number,
    y:           number,
    angle:       number,
    targetX:     number,
    targetY:     number,
    playerId:    string,
    playerColor: number,
    sourceSlot?: LoadoutSlot,
  ): boolean {
    const cursorRange = Math.hypot(targetX - x, targetY - y);
    const effectiveRange = fireConfig.limitRangeToCursor
      ? Math.min(config.range, cursorRange)
      : config.range;
    const lifetime = (effectiveRange / fireConfig.projectileSpeed) * 1000;

    this.projectileManager.spawnProjectile(x, y, angle, playerId, {
      speed:           fireConfig.projectileSpeed,
      size:            fireConfig.projectileSize,
      damage:          config.damage,
      color:           config.projectileColor ?? playerColor,  // Waffen-eigene Farbe hat Vorrang
      ownerColor:      playerColor,
      smokeTrailColor: config.rocketSmokeTrailColor ?? playerColor,
      lifetime,
      maxBounces:      fireConfig.projectileMaxBounces,
      isGrenade:       false,
      adrenalinGain:   config.adrenalinGain,
      weaponName:      config.displayName,
      splitCount:      config.splitCount,
      splitSpread:     config.splitSpread,
      splitFactor:     config.splitFactor,
      remainingRangePx: effectiveRange,
      explosion:       fireConfig.impactExplosion,
      impactCloud:     fireConfig.impactCloud,
      homing:          fireConfig.homing,
      projectileStyle: config.projectileStyle,
      bulletVisualPreset: config.bulletVisualPreset,
      energyBallVariant: config.energyBallVariant,
      tracerConfig:    config.tracerConfig,
      detonable:       config.detonable,
      detonator:       config.detonator,
      rockDamageMult:  config.rockDamageMult,
      trainDamageMult: config.trainDamageMult,
      sourceSlot,
      shotAudioKey:    config.shotAudio?.successKey,
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
    sourceSlot:  WeaponSlot | undefined,
    shotId?:     number,
  ): boolean {
    void playerColor;
    const muzzleOrigin = getTopDownMuzzleOrigin(x, y, angle);
    return this.combatSystem?.resolveHitscanShot(
      playerId,
      muzzleOrigin.x,
      muzzleOrigin.y,
      angle,
      config.range,
      config.damage,
      fireConfig.traceThickness,
      playerColor,
      config.adrenalinGain,
      config.displayName,
      fireConfig.visualPreset,
      config.shotAudio?.successKey,
      sourceSlot,
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
    sourceSlot?: WeaponSlot,
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
      sourceSlot,
      config.rockDamageMult  ?? 1,
      config.trainDamageMult ?? 1,
      fireConfig.visualPreset,
      config.shotAudio?.successKey,
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
    sourceSlot?: LoadoutSlot,
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
      burnDurationMs:    fireConfig.burnDurationMs,
      burnDamagePerTick: fireConfig.burnDamagePerTick,
      burnTickIntervalMs: fireConfig.burnTickIntervalMs,
      sourceSlot,
      shotAudioKey:    config.shotAudio?.successKey,
    });

    return true;
  }

  private getEquippedEnergyShieldFireConfig(playerId: string): EnergyShieldWeaponFireConfig | null {
    const weapon = this.loadouts.get(playerId)?.weapon2.config;
    if (!weapon || weapon.fire.type !== 'energy_shield') return null;
    return weapon.fire as EnergyShieldWeaponFireConfig;
  }
}
