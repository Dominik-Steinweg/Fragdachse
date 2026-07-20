import * as Phaser from 'phaser';
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
import type { GrenadeEffectConfig, LoadoutSlot, LoadoutUseParams, LoadoutUseResult, PlayerAimNetState, ShieldBuffHudState, SyncedActiveHudBuff, TrackedProjectile, WeaponSlot } from '../types';
import type {
  AirstrikeUltimateConfig,
  BfgUtilityConfig,
  ChargedThrowUtilityActivationConfig,
  DecoyUtilityConfig,
  EnergyShieldWeaponFireConfig,
  GaussUltimateConfig,
  LeafBlowerWeaponFireConfig,
  NukeUtilityConfig,
  PlaceableUtilityConfig,
  StinkCloudUtilityConfig,
  TaserUtilityConfig,
  TimeBubbleUtilityConfig,
  TranslocatorUtilityConfig,
  TunnelUltimateConfig,
  FlamethrowerWeaponFireConfig,
  MeleeWeaponFireConfig,
  ProjectileWeaponFireConfig,
  TeslaDomeWeaponFireConfig,
  UltimateConfig,
  UtilityConfig,
  WeaponConfig,
} from './LoadoutConfig';
import { applyCoopDefenseModifiersToUtilityConfig } from './CoopDefenseLoadoutModifiers';
import { COLORS, getTopDownMuzzleOrigin } from '../config';
import { WEAPON_CONFIGS, UTILITY_CONFIGS, ULTIMATE_CONFIGS } from './LoadoutConfig';
import { areLoadoutConfigsEquivalent, sanitizeLoadoutSelectionForMode } from './LoadoutRules';
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
  nextAuraTickAt: number;
  auraLingerUntil: number;
  gaussChargeStartedAt: number | null;
}

interface Ak47CombatState {
  stacks: number;
  fireSuperiorityShotsRemaining: number;
  fireSuperiorityTotalShots: number;
  nextShotId: number;
  confirmedShotIds: Set<number>;
}

interface ShotgunLightningEvent {
  ownerId: string;
  x: number;
  y: number;
  generation: number;
}

interface NegevCombatState {
  kills: number;
}

export interface NegevKillstreakExplosionEvent {
  ownerId: string;
  x: number;
  y: number;
  kills: number;
  radius: number;
  damage: number;
  fireChunkDurationMs: number;
  fireChunkBurnDurationMs: number;
  fireChunkBurnDamagePerTick: number;
}

type CombatResolverType = Pick<CombatSystem, 'addArmor' | 'heal' | 'applyAoeDamage' | 'resolveHitscanShot' | 'traceHitscan' | 'resolveMeleeSwing'>;
type PhysicsSystemType  = {
  addRecoil(id: string, vx: number, vy: number, durationMs?: number): void;
  applyRadialImpulse(x: number, y: number, radius: number, force: number, ownerId?: string, selfMultiplier?: number, durationMs?: number): void;
};

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
  private utilityConfigModifierSource: ((playerId: string) => { additive: Readonly<Record<string, number>>; percentage: Readonly<Record<string, number>> } | null) | null = null;
  private shotCounters = new Map<string, number>();
  private ak47States = new Map<string, Ak47CombatState>();
  private negevStates = new Map<string, NegevCombatState>();
  private shotgunLightningQueue: ShotgunLightningEvent[] = [];
  private negevKillstreakExplosionHandler: ((event: NegevKillstreakExplosionEvent) => void) | null = null;

  // Held-Fire-Tracking: Feuerknopf gilt als gehalten wenn innerhalb HOLD_EXPIRE_MS gefeuert wurde
  private heldFireSlots = new Map<string, { slot: WeaponSlot; lastAt: number; angle: number }>();
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
    this.shotgunLightningQueue = this.shotgunLightningQueue.filter((event) => event.ownerId !== playerId);
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
      nextAuraTickAt: 0,
      auraLingerUntil: 0,
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
    this.resetAk47State(playerId);
    this.negevStates.set(playerId, { kills: 0 });
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
      && areLoadoutConfigsEquivalent(current.weapon1.config, nextWeapon1)
      && areLoadoutConfigsEquivalent(current.weapon2.config, nextWeapon2)
      && areLoadoutConfigsEquivalent(current.utility.config, nextUtility)
      && areLoadoutConfigsEquivalent(currentUltimate, nextUltimate)
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
    this.ak47States.delete(playerId);
    this.negevStates.delete(playerId);
    this.shotgunLightningQueue = this.shotgunLightningQueue.filter((event) => event.ownerId !== playerId);
  }

  resetAk47State(playerId: string): void {
    this.ak47States.set(playerId, {
      stacks: 0,
      fireSuperiorityShotsRemaining: 0,
      fireSuperiorityTotalShots: 0,
      nextShotId: 1,
      confirmedShotIds: new Set<number>(),
    });
  }

  registerAk47ProjectileHit(projectile: TrackedProjectile, now = Date.now()): void {
    const shotId = projectile.ak47ShotId;
    if (shotId === undefined || projectile.ak47HitConfirmed) return;
    projectile.ak47HitConfirmed = true;

    const config = this.getAk47Config(projectile.ownerId);
    const focus = config?.ak47Focus;
    if (!focus || focus.maxStacks <= 0) return;

    const state = this.getOrCreateAk47State(projectile.ownerId);
    state.confirmedShotIds.add(shotId);
    void now;

    // Durchbruchmunition baut waehrend der laufenden Belohnungsphase keine neue
    // Belohnungsschleife auf. Nach dem Magazin beginnt die Praezisionsserie neu.
    if (projectile.ak47FireSuperiorityShot) return;

    state.stacks = Math.min(focus.maxStacks, state.stacks + 1);

    if (
      state.stacks >= focus.maxStacks
      && focus.fireSuperiorityShots > 0
      && state.fireSuperiorityShotsRemaining <= 0
    ) {
      const shotCount = Math.max(1, Math.round(focus.fireSuperiorityShots));
      state.fireSuperiorityShotsRemaining = shotCount;
      state.fireSuperiorityTotalShots = shotCount;
      state.stacks = focus.maxStacks;
    }
  }

  resolveAk47Projectile(projectile: TrackedProjectile, now = Date.now()): void {
    const shotId = projectile.ak47ShotId;
    if (shotId === undefined) return;
    const state = this.ak47States.get(projectile.ownerId);
    if (!state) return;

    const didHit = projectile.ak47HitConfirmed || state.confirmedShotIds.has(shotId);
    state.confirmedShotIds.delete(shotId);
    void now;
    if (!didHit && state.fireSuperiorityShotsRemaining <= 0) {
      state.stacks = 0;
    }
  }

  getAk47HudBuffs(playerId: string, now = Date.now()): SyncedActiveHudBuff[] {
    const config = this.getAk47Config(playerId);
    const focus = config?.ak47Focus;
    const state = this.ak47States.get(playerId);
    if (!focus || !state) return [];

    void now;
    const result: SyncedActiveHudBuff[] = [];
    if (state.stacks > 0) {
      const damagePct = Math.round(state.stacks * focus.damagePerStack * 100);
      result.push({
        defId: 'AK47_FOCUS',
        remainingFrac: state.stacks / Math.max(1, Math.round(focus.maxStacks)),
        valueText: `${state.stacks}/${Math.max(1, Math.round(focus.maxStacks))} · +${damagePct}%`,
      });
    }
    if (state.fireSuperiorityShotsRemaining > 0) {
      result.push({
        defId: 'AK47_FIRE_SUPERIORITY',
        remainingFrac: state.fireSuperiorityShotsRemaining / Math.max(1, state.fireSuperiorityTotalShots),
        valueText: `${state.fireSuperiorityShotsRemaining} Schuss`,
      });
    }
    return result;
  }

  getNegevHudBuffs(playerId: string): SyncedActiveHudBuff[] {
    const config = this.loadouts.get(playerId)?.weapon2.config;
    const state = this.negevStates.get(playerId);
    const damagePerKill = config?.id === 'NEGEV'
      ? (config.negevKillstreak?.damageBonusPerKill ?? 0)
      : 0;
    if (!state || state.kills <= 0 || damagePerKill <= 0) return [];
    return [{
      defId: 'NEGEV_KILLSTREAK',
      remainingFrac: 1,
      valueText: `${state.kills} Kills · +${Math.round(state.kills * damagePerKill * 100)}%`,
    }];
  }

  isAk47FireSuperiorityActive(playerId: string): boolean {
    return this.getAk47Config(playerId) !== null
      && (this.ak47States.get(playerId)?.fireSuperiorityShotsRemaining ?? 0) > 0;
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
    state.nextAuraTickAt = 0;
    state.auraLingerUntil = 0;
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

  setUtilityConfigModifierSource(source: ((playerId: string) => { additive: Readonly<Record<string, number>>; percentage: Readonly<Record<string, number>> } | null) | null): void {
    this.utilityConfigModifierSource = source;
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

  setNegevKillstreakExplosionHandler(
    handler: ((event: NegevKillstreakExplosionEvent) => void) | null,
  ): void {
    this.negevKillstreakExplosionHandler = handler;
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
    options?: { ignoreBaseCollisions?: boolean },
  ): boolean {
    return this.dispatchWeaponFire(config, x, y, angle, targetX, targetY, playerId, playerColor, undefined, undefined, options);
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
    const modifierSource = this.utilityConfigModifierSource?.(playerId);
    const effectiveConfig = modifierSource ? applyCoopDefenseModifiersToUtilityConfig(config, modifierSource) : config;
    loadout.utility = new GenericUtility(effectiveConfig);
    this.utilityAmmo.set(playerId, ammo);
    this.bridge.publishUtilityCooldownUntil(playerId, 0); // sofort einsatzbereit
    this.bridge.publishUtilityOverrideName(playerId, effectiveConfig.displayName);
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
      this.heldFireSlots.set(playerId, { slot, lastAt: now, angle });
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
          const consumedRage = Math.min(rage, this.resourceSystem.getMaxRage(playerId));
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
            nextAuraTickAt: cfg.aura && cfg.aura.tickIntervalMs > 0 ? now + cfg.aura.tickIntervalMs : 0,
            auraLingerUntil: 0,
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

    for (const [playerId, state] of this.negevStates) {
      if (state.kills <= 0) continue;
      const held = this.heldFireSlots.get(playerId);
      const stillFiringNegev = held?.slot === 'weapon2'
        && now - held.lastAt < LoadoutManager.HOLD_EXPIRE_MS
        && this.loadouts.get(playerId)?.weapon2.config.id === 'NEGEV';
      if (!stillFiringNegev) this.finishNegevKillstreak(playerId, state.kills);
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
          const aura = state.config.aura;
          if (aura && (aura.allyArmorPerTick ?? 0) > 0) {
            const owner = this.playerManager.getPlayer(playerId);
            if (owner) {
              for (const ally of this.playerManager.getAllPlayers()) {
                if (ally.id === playerId || this.bridge.isEnemyPair(playerId, ally.id)) continue;
                if (Phaser.Math.Distance.Between(owner.sprite.x, owner.sprite.y, ally.sprite.x, ally.sprite.y) <= aura.radius) {
                  this.combatSystem.addArmor(ally.id, aura.allyArmorPerTick ?? 0);
                }
              }
            }
          }
          state.nextArmorTickAt += state.config.armorTickIntervalMs;
        }
      }

      const aura = state.config.aura;
      const auraOwner = aura ? this.playerManager.getPlayer(playerId) : null;
      if (aura && aura.damagePerTick > 0 && aura.tickIntervalMs > 0 && aura.radius > 0 && this.combatSystem) {
        while (state.nextAuraTickAt > 0 && state.nextAuraTickAt <= now && state.nextAuraTickAt <= endTime) {
          if (auraOwner) {
            this.combatSystem.applyAoeDamage(
              auraOwner.sprite.x,
              auraOwner.sprite.y,
              aura.radius,
              aura.damagePerTick,
              playerId,
              false,
              {
                category: 'damage_over_time',
                weaponName: state.config.displayName,
                sourceSlot: 'ultimate',
              },
            );
          }
          state.nextAuraTickAt += aura.tickIntervalMs;
        }
      }

      if (elapsed >= state.durationMs) {
        state.auraLingerUntil = now + (state.config.aura?.lingerMs ?? 0);
        state.active = false;
        state.consumedRage = 0;
        state.durationMs = 0;
        state.drainDurationMs = 0;
        state.nextArmorTickAt = 0;
        state.nextAuraTickAt = 0;
        // Armageddon: Meteor-Spawning stoppen (In-Flight-Meteore schlagen noch ein)
        if (state.config.armageddon && this.armageddonSystem) {
          this.armageddonSystem.deactivate(playerId);
        }
      }
    }

    this.processShotgunLightningQueue();
  }

  // ── Multiplier-Getter ─────────────────────────────────────────────────────

  getSpeedMultiplier(playerId: string): number {
    const state        = this.ultimateStates.get(playerId);
    const ultimateMult = (state?.active && state.config.type === 'buff' ? state.config.speedMultiplier : 1)
      * this.getAllyAuraMultiplier(playerId, 'speed');
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

  getHeldSelfPushVelocity(playerId: string): { vx: number; vy: number } | null {
    const held = this.heldFireSlots.get(playerId);
    if (!held || Date.now() - held.lastAt >= LoadoutManager.HOLD_EXPIRE_MS) return null;

    const cfg = this.loadouts.get(playerId)?.[held.slot].config;
    if (!cfg || cfg.fire.type !== 'leaf_blower') return null;

    const selfPush = cfg.fire.selfPush;
    if (selfPush <= 0) return null;

    return {
      vx: -Math.cos(held.angle) * selfPush,
      vy: -Math.sin(held.angle) * selfPush,
    };
  }

  getDamageMultiplier(playerId: string): number {
    const state = this.ultimateStates.get(playerId);
    return (state?.active && state.config.type === 'buff' ? state.config.damageMultiplier : 1)
      * this.getAllyAuraMultiplier(playerId, 'damage');
  }
  private getAllyAuraMultiplier(playerId: string, kind: 'speed' | 'damage'): number {
    const now = Date.now();
    const target = this.playerManager.getPlayer(playerId);
    if (!target) return 1;
    let multiplier = 1;
    for (const [ownerId, state] of this.ultimateStates) {
      if (ownerId === playerId || state.config.type !== 'buff' || !state.config.aura) continue;
      if (!state.active && state.auraLingerUntil < now) continue;
      if (this.bridge.isEnemyPair(ownerId, playerId)) continue;
      const owner = this.playerManager.getPlayer(ownerId);
      if (!owner || Phaser.Math.Distance.Between(owner.sprite.x, owner.sprite.y, target.sprite.x, target.sprite.y) > state.config.aura.radius) continue;
      multiplier *= kind === 'speed'
        ? (state.config.aura.allySpeedMultiplier ?? 1)
        : (state.config.aura.allyDamageMultiplier ?? 1);
    }
    return multiplier;
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

  getActiveUltimateId(playerId: string): string | null {
    const state = this.ultimateStates.get(playerId);
    return state?.active ? state.config.id : null;
  }

  getEquippedUltimateConfig(playerId: string): UltimateConfig | undefined {
    return this.loadouts.get(playerId)?.ultimate.config;
  }

  getUltimateRequiredRage(playerId: string): number {
    return this.loadouts.get(playerId)?.ultimate.config.rageRequired ?? this.resourceSystem.getMaxRage(playerId);
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
      const maxRage = this.resourceSystem.getMaxRage(playerId);
      for (let value = config.rageCost; value < maxRage; value += config.rageCost) {
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
      nextAuraTickAt: 0,
      auraLingerUntil: 0,
      gaussChargeStartedAt: null,
    };
    currentState.config = cfg;
    const clearGaussCharge = (): void => {
      if (currentState.gaussChargeStartedAt === null && state) {
        this.ultimateStates.set(playerId, currentState);
        return;
      }
      if (currentState.gaussChargeStartedAt === null) return;
      currentState.gaussChargeStartedAt = null;
      this.ultimateStates.set(playerId, currentState);
    };

    if (action === 'press') {
      if (currentState.gaussChargeStartedAt !== null) {
        clearGaussCharge();
        return { ok: false, reason: 'blocked' };
      }
      if (this.resourceSystem.getRage(playerId) < cfg.rageRequired) {
        clearGaussCharge();
        return { ok: false, reason: 'resource', resourceKind: 'rage' };
      }
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

    clearGaussCharge();
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
      gaussChainRadius:  cfg.chainRadius,
      gaussChainDamageFactor: cfg.chainDamageFactor,
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

  /** Wendet die Coop-Upgrades eines Spielers auf eine beliebige Utility-Basiskonfiguration an. */
  resolveUtilityConfig(playerId: string, config: UtilityConfig): UtilityConfig {
    const modifierSource = this.utilityConfigModifierSource?.(playerId);
    return modifierSource ? applyCoopDefenseModifiersToUtilityConfig(config, modifierSource) : config;
  }

  /**
   * Gibt den aktuellen dynamischen Spread (Bloom) der Waffe zurück.
   * Direkt aus dem BaseWeapon-Objekt – das AimSystem braucht auf dem Host
   * keine eigene Simulation und nutzt stattdessen den autoritären Wert.
   */
  getDynamicSpread(playerId: string, slot: 'weapon1' | 'weapon2'): number {
    return this.loadouts.get(playerId)?.[slot].getDynamicSpread() ?? 0;
  }

  handleKill(
    killerId: string,
    weaponName: string,
    x: number,
    y: number,
    source?: { dirX?: number; dirY?: number; projectileColor?: number; shotgunLightningGeneration?: number },
  ): void {
    const loadout = this.loadouts.get(killerId);
    if (!loadout) return;
    const negev = loadout.weapon2.config.id === 'NEGEV' ? loadout.weapon2.config : null;
    if (
      negev
      && weaponName === negev.displayName
      && (negev.negevKillstreak?.damageBonusPerKill ?? 0) > 0
    ) {
      const state = this.negevStates.get(killerId) ?? { kills: 0 };
      state.kills += 1;
      this.negevStates.set(killerId, state);
      const heal = negev.negevKillstreak?.healPerKill ?? 0;
      const armor = negev.negevKillstreak?.armorPerKill ?? 0;
      if (heal > 0) this.combatSystem?.heal(killerId, heal);
      if (armor > 0) this.combatSystem?.addArmor(killerId, armor);
    }
    const shotgun = loadout.weapon2.config.id === 'SHOTGUN' ? loadout.weapon2.config : null;
    if (shotgun) {
      if (weaponName === shotgun.displayName && (shotgun.shotgunLightningRadius ?? 0) > 0 && (shotgun.shotgunLightningDamage ?? 0) > 0) {
        this.shotgunLightningQueue.push({ ownerId: killerId, x, y, generation: 0 });
      } else if (
        weaponName === 'Schrotflinten-Blitz'
        && (shotgun.shotgunChainEnabled ?? 0) > 0
        && source?.shotgunLightningGeneration !== undefined
      ) {
        this.shotgunLightningQueue.push({
          ownerId: killerId,
          x,
          y,
          generation: source.shotgunLightningGeneration + 1,
        });
      }
    }
    for (const weapon of [loadout.weapon1, loadout.weapon2]) {
      const cfg = weapon.config;
      if (cfg.displayName !== weaponName) continue;
      if ((cfg.killHeal ?? 0) > 0) this.combatSystem?.heal(killerId, cfg.killHeal ?? 0);
      if ((cfg.killAdrenaline ?? 0) > 0) this.resourceSystem.addAdrenaline(killerId, cfg.killAdrenaline ?? 0);
      if ((cfg.killSplitCount ?? 0) > 0 && cfg.fire.type === 'projectile') {
        const count = Math.max(0, Math.floor(cfg.killSplitCount ?? 0));
        const baseAngle = source?.dirX !== undefined && source?.dirY !== undefined
          ? Math.atan2(source.dirY, source.dirX)
          : 0;
        const splitAngle = Phaser.Math.DegToRad(cfg.killSplitAngleDegrees ?? 30);
        for (let index = 0; index < count; index += 1) {
          const offset = count === 1
            ? 0
            : Phaser.Math.Linear(-splitAngle, splitAngle, index / (count - 1));
          const angle = baseAngle + offset;
          this.projectileManager.spawnProjectile(x, y, angle, killerId, {
            speed: cfg.fire.projectileSpeed,
            size: cfg.fire.projectileSize,
            damage: cfg.damage * (cfg.killSplitDamageFactor ?? 0),
            color: source?.projectileColor ?? cfg.projectileColor ?? 0xffffff,
            lifetime: (cfg.range / cfg.fire.projectileSpeed) * 1000,
            maxBounces: 0,
            isGrenade: false,
            adrenalinGain: 0,
            weaponName: `${cfg.displayName}-Splitter`,
            homing: cfg.fire.homing,
            projectileStyle: cfg.projectileStyle,
            suppressSpawnFx: true,
            sourceSlot: 'weapon1',
          });
        }
      }
      return;
    }
  }

  private finishNegevKillstreak(playerId: string, kills: number): void {
    const state = this.negevStates.get(playerId);
    if (state) state.kills = 0;
    if (kills <= 0) return;

    const config = this.loadouts.get(playerId)?.weapon2.config;
    const streak = config?.id === 'NEGEV' ? config.negevKillstreak : undefined;
    if (!streak || streak.explosionEnabled <= 0) return;
    const player = this.playerManager.getPlayer(playerId);
    if (!player) return;

    const radius = streak.explosionBaseRadius + kills * streak.explosionRadiusPerKill;
    const damage = kills * streak.explosionDamagePerKill;
    const knockback = streak.explosionBaseKnockback + kills * streak.explosionKnockbackPerKill;
    if (damage > 0 && radius > 0) {
      this.combatSystem?.applyAoeDamage(player.sprite.x, player.sprite.y, radius, damage, playerId, false, {
        category: 'explosion',
        weaponName: 'Negev-Killstreak',
        sourceSlot: 'weapon2',
      });
    }
    if (knockback > 0 && radius > 0) {
      this.physicsSystem?.applyRadialImpulse(player.sprite.x, player.sprite.y, radius, knockback, playerId, 0);
    }
    this.negevKillstreakExplosionHandler?.({
      ownerId: playerId,
      x: player.sprite.x,
      y: player.sprite.y,
      kills,
      radius,
      damage,
      fireChunkDurationMs: streak.fireChunkDurationMs,
      fireChunkBurnDurationMs: streak.fireChunkBurnDurationMs,
      fireChunkBurnDamagePerTick: streak.fireChunkBurnDamagePerTick,
    });
  }

  private processShotgunLightningQueue(): void {
    if (!this.combatSystem || this.shotgunLightningQueue.length === 0) return;

    // Grosse Ketten werden ueber mehrere Frames verteilt, aber logisch nicht begrenzt.
    const events = this.shotgunLightningQueue.splice(0, 256);
    for (const event of events) {
      const loadout = this.loadouts.get(event.ownerId);
      const shotgun = loadout?.weapon2.config.id === 'SHOTGUN' ? loadout.weapon2.config : null;
      if (!shotgun) continue;

      const baseRadius = shotgun.shotgunLightningRadius ?? 0;
      const baseDamage = shotgun.shotgunLightningDamage ?? 0;
      if (baseRadius <= 0 || baseDamage <= 0) continue;

      const damageRetention = event.generation > 0
        ? Phaser.Math.Clamp(shotgun.shotgunChainDamageRetention ?? 0, 0, 1)
        : 1;
      const radiusRetention = event.generation > 0
        ? Phaser.Math.Clamp(shotgun.shotgunChainRadiusRetention ?? 0, 0, 1)
        : 1;
      if (event.generation > 0 && ((shotgun.shotgunChainEnabled ?? 0) <= 0 || damageRetention <= 0 || radiusRetention <= 0)) continue;

      const damage = baseDamage * Math.pow(damageRetention, event.generation);
      const radius = baseRadius * Math.pow(radiusRetention, event.generation);
      if (damage < 0.5 || radius < 4) continue;

      this.combatSystem.applyAoeDamage(event.x, event.y, radius, damage, event.ownerId, false, {
        category: 'explosion',
        allowTeamDamage: false,
        weaponName: 'Schrotflinten-Blitz',
        sourceSlot: 'weapon2',
        enemySlowFraction: (shotgun.shotgunLightningAppliesSlow ?? 0) > 0 ? shotgun.shotgunSlowFraction ?? 0 : 0,
        enemySlowDurationMs: shotgun.shotgunSlowDurationMs ?? 0,
        killSource: { shotgunLightningGeneration: event.generation },
      });
      this.bridge.broadcastExplosionEffect(event.x, event.y, radius, 0x78dfff, 'lightning');
    }
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

  private getAk47Config(playerId: string): WeaponConfig | null {
    const config = this.loadouts.get(playerId)?.weapon2.config;
    return config?.id === 'AK47' ? config : null;
  }

  private getOrCreateAk47State(playerId: string): Ak47CombatState {
    const current = this.ak47States.get(playerId);
    if (current) return current;
    this.resetAk47State(playerId);
    return this.ak47States.get(playerId)!;
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
    const ak47State = cfg.id === 'AK47' ? this.getOrCreateAk47State(playerId) : null;
    const ak47Focus = this.getAk47Config(playerId)?.ak47Focus;
    const primaryWeaponFocusState = sourceSlot === 'weapon1' ? this.ak47States.get(playerId) : null;
    const fireSuperiorityActive = (ak47State?.fireSuperiorityShotsRemaining ?? 0) > 0;

    // 2. Adrenalin-Check (nur wenn Kosten > 0, sonst Regen-Pause nicht unterbrechen)
    if (!fireSuperiorityActive && cfg.adrenalinCost > 0) {
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
    const warmupFraction = cfg.maxDynamicSpread < 0
      ? Math.min(1, Math.abs(weapon.getDynamicSpread()) / Math.max(0.0001, Math.abs(cfg.maxDynamicSpread)))
      : 0;
    let shotCfg = (cfg.warmupBurnThreshold ?? 0) > 0 && warmupFraction < (cfg.warmupBurnThreshold ?? 0)
      ? { ...cfg, burnOnHit: undefined }
      : cfg;
    if (cfg.id === 'AWP' && cfg.awpCharge) {
      const chargeProgress = Phaser.Math.Clamp(params?.scopeChargeProgress ?? 0, 0, 1);
      const fullyCharged = chargeProgress >= 0.999;
      const fullChargeMultiplier = fullyCharged ? 1 + cfg.awpCharge.fullChargeDamageBonus : 1;
      shotCfg = {
        ...shotCfg,
        damage: shotCfg.damage * (1 + chargeProgress * cfg.awpCharge.maxDamageBonus) * fullChargeMultiplier,
        awpCharge: {
          ...cfg.awpCharge,
          fireTrailBurnDamagePerTick: cfg.awpCharge.fireTrailBurnDamagePerTick * fullChargeMultiplier,
          corridorEnabled: fullyCharged ? cfg.awpCharge.corridorEnabled : 0,
          corridorDamage: cfg.awpCharge.corridorDamage * fullChargeMultiplier,
        },
      };
    }
    if (cfg.id === 'NEGEV') {
      const kills = this.negevStates.get(playerId)?.kills ?? 0;
      const damageMultiplier = 1 + kills * (cfg.negevKillstreak?.damageBonusPerKill ?? 0);
      if (damageMultiplier > 1) {
        shotCfg = {
          ...shotCfg,
          damage: shotCfg.damage * damageMultiplier,
          burnOnHit: shotCfg.burnOnHit ? {
            ...shotCfg.burnOnHit,
            damagePerTick: shotCfg.burnOnHit.damagePerTick * damageMultiplier,
          } : undefined,
        };
      }
    }
    if (ak47State && cfg.ak47Focus) {
      const focusDamageMultiplier = 1 + ak47State.stacks * cfg.ak47Focus.damagePerStack;
      const superiorityDamageMultiplier = fireSuperiorityActive
        ? 1 + cfg.ak47Focus.fireSuperiorityDamageBonus
        : 1;
      shotCfg = {
        ...shotCfg,
        penetrationCount: fireSuperiorityActive ? 1_000_000 : shotCfg.penetrationCount,
        penetrationDamageRetention: fireSuperiorityActive ? 1 : shotCfg.penetrationDamageRetention,
        ak47ShotId: ak47State.nextShotId++,
        ak47DamageMultiplier: focusDamageMultiplier * superiorityDamageMultiplier,
        ak47FireSuperiorityShot: fireSuperiorityActive,
      };
    } else if (
      primaryWeaponFocusState
      && (ak47Focus?.applyDamageToPrimaryWeapon ?? 0) > 0
      && primaryWeaponFocusState.stacks > 0
    ) {
      // Einschiessen überträgt ausschließlich den Stack-Schaden auf Waffe 1.
      // Durchbruchmunition bleibt weiterhin ein exklusiver AK-47-Bonus.
      shotCfg = {
        ...shotCfg,
        damage: shotCfg.damage * (1 + primaryWeaponFocusState.stacks * (ak47Focus?.damagePerStack ?? 0)),
      };
    }
    const pelletCount = Math.max(1, Math.round((shotCfg.pelletCount ?? 1) * (shotCfg.pelletCountMultiplier ?? 1)));
    let didFire: boolean;
    if (pelletCount > 1) {
      const pelletOffsets = calcPelletAngles(pelletCount, cfg.pelletSpreadAngle ?? 0);
      for (let pelletIndex = 0; pelletIndex < pelletOffsets.length; pelletIndex += 1) {
        const offset = pelletOffsets[pelletIndex];
        const pelletAngle = angle + offset + (Math.random() * 2 - 1) * halfSpreadRad;
        // Eine Salve ist ein einzelner Schuss: Nur das erste Projektil darf den
        // Waffensound auf Host und Remote-Clients replizieren. Mündungsfeuer und
        // Projektilvisuals bleiben für jedes Pellet aktiv.
        const pelletConfig = pelletIndex === 0
          ? shotCfg
          : { ...shotCfg, shotAudio: undefined };
        this.dispatchWeaponFire(pelletConfig, x, y, pelletAngle, targetX, targetY, playerId, playerColor, sourceSlot, shotId);
      }
      didFire = true;
    } else {
      const finalAngle = angle + (Math.random() * 2 - 1) * halfSpreadRad;
      didFire = this.dispatchWeaponFire(shotCfg, x, y, finalAngle, targetX, targetY, playerId, playerColor, sourceSlot, shotId);
    }
    if (!didFire) return { ok: false, reason: 'blocked' };

    if (fireSuperiorityActive && ak47State) {
      ak47State.fireSuperiorityShotsRemaining = Math.max(0, ak47State.fireSuperiorityShotsRemaining - 1);
      if (ak47State.fireSuperiorityShotsRemaining <= 0) {
        ak47State.fireSuperiorityTotalShots = 0;
        ak47State.stacks = 0;
      }
    }

    if ((shotCfg.sideBurstEveryShots ?? 0) > 0 && (shotCfg.sideBurstCount ?? 0) >= 2) {
      const counterKey = `${playerId}:${sourceSlot}:${shotCfg.id}`;
      const count = (this.shotCounters.get(counterKey) ?? 0) + 1;
      this.shotCounters.set(counterKey, count);
      if (count % (shotCfg.sideBurstEveryShots ?? 1) === 0) {
        const sideAngle = (shotCfg.sideBurstAngleDegrees ?? 0) * Math.PI / 180;
        const sideCfg = {
          ...shotCfg,
          damage: shotCfg.damage * (shotCfg.sideBurstDamageFactor ?? 0),
          sideBurstEveryShots: 0,
          shotAudio: undefined,
        };
        this.dispatchWeaponFire(sideCfg, x, y, angle - sideAngle, targetX, targetY, playerId, playerColor, sourceSlot, shotId);
        this.dispatchWeaponFire(sideCfg, x, y, angle + sideAngle, targetX, targetY, playerId, playerColor, sourceSlot, shotId);
      }
    }

    // 5. Ressourcen erst nach erfolgreichem Fire-Dispatch abbuchen.
    if (!fireSuperiorityActive && cfg.adrenalinCost > 0) {
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
          didUse = this.translocatorSystem?.handleUse(playerId, angle, targetX, targetY, now, params, cfg as TranslocatorUtilityConfig) ?? false;
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
            undefined,
            (taserCfg.chainCount ?? 0) > 0 ? { count: taserCfg.chainCount ?? 0, radius: taserCfg.chainRadius ?? 0, damageFactor: taserCfg.chainDamageFactor ?? 0 } : undefined,
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
      grenadeEffect: this.buildGrenadeEffect(cfg, playerColor),
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
      cfg.afterCloudDurationMs ?? 0,
      cfg.afterCloudRadiusFactor ?? 0,
      cfg.afterCloudDamageFactor ?? 0,
    );
    return true;
  }

  private buildGrenadeEffect(cfg: UtilityConfig, playerColor?: number): GrenadeEffectConfig {
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
        clusterCount:    cfg.clusterCount,
        clusterRadiusFactor: cfg.clusterRadiusFactor,
        clusterDamageFactor: cfg.clusterDamageFactor,
      };
    }

    if (cfg.type === 'molotov') {
      return {
        type:           'fire',
        radius:         cfg.fireRadius,
        damagePerTick:  cfg.fireDamagePerTick,
        lingerDuration: cfg.fireLingerDuration,
        allowTeamDamage: cfg.allowTeamDamage,
        rockDamageMult:  cfg.rockDamageMult,
        trainDamageMult: cfg.trainDamageMult,
        burnDurationMs:     cfg.fireBurnDurationMs,
        burnDamagePerTick:  cfg.fireBurnDamagePerTick,
        wildfire: (cfg.wildfireEnabled ?? 0) > 0 ? {
          speedMultiplier: cfg.wildfirePanicSpeedMultiplier ?? 1.5,
          trailDurationMs: cfg.wildfireTrailDurationMs ?? 2000,
          trailDamagePerTick: cfg.wildfireTrailDamagePerTick ?? 2,
        } : undefined,
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
        dotDamagePerTick:  cfg.smokeDotDamagePerTick,
        dotTickIntervalMs: cfg.smokeDotTickIntervalMs,
      };
    }

    if (cfg.type === 'time_bubble') {
      return {
        type:               'time_bubble',
        radius:             cfg.bubbleRadius,
        duration:           cfg.bubbleDuration,
        projectileSlowFactor: cfg.projectileSlowFactor,
        playerSlowFactor:   cfg.playerSlowFactor,
        trainSlowFactor:    cfg.trainSlowFactor,
        color:              cfg.bubbleColor ?? cfg.projectileColor ?? playerColor,
        distortion:         cfg.bubbleDistortion,
        friendlyImmunity:   cfg.friendlyImmunity,
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
    options?: { ignoreBaseCollisions?: boolean },
  ): boolean {
    switch (config.fire.type) {
      case 'projectile':
        return this.fireProjectileWeapon(config, config.fire, x, y, angle, targetX, targetY, playerId, playerColor, sourceSlot, options);

      case 'hitscan':
        return this.fireHitscanWeapon(config, config.fire, x, y, angle, playerId, playerColor, sourceSlot as WeaponSlot | undefined, shotId);

      case 'melee':
        return this.fireMeleeWeapon(config, config.fire, x, y, angle, playerId, playerColor, sourceSlot as WeaponSlot | undefined);

      case 'flamethrower':
        return this.fireFlamethrowerWeapon(config, config.fire, x, y, angle, playerId, playerColor, sourceSlot);

      case 'leaf_blower':
        return this.fireLeafBlowerWeapon(config, config.fire, x, y, angle, playerId, playerColor, sourceSlot);

      case 'tesla_dome':
      case 'healing_aura':
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
    options?: { ignoreBaseCollisions?: boolean },
  ): boolean {
    const cursorRange = Math.hypot(targetX - x, targetY - y);
    const effectiveRange = fireConfig.limitRangeToCursor
      ? Math.min(config.range, cursorRange)
      : config.range;
    const lifetime = (effectiveRange / fireConfig.projectileSpeed) * 1000;
    const isMiniRocket = config.id === 'MINI_ROCKET_LAUNCHER';
    const hasExtendedMiniRocketFlight = isMiniRocket
      && ((config.multiExplosionCount ?? 1) > 1 || (config.miniRocketReturnEnabled ?? 0) > 0);

    this.projectileManager.spawnProjectile(x, y, angle, playerId, {
      speed:           fireConfig.projectileSpeed,
      ignoreBaseCollisions: options?.ignoreBaseCollisions,
      size:            fireConfig.projectileSize,
      damage:          config.directDamageOverride ?? config.damage,
      color:           config.projectileColor ?? playerColor,  // Waffen-eigene Farbe hat Vorrang
      ownerColor:      playerColor,
      projectileVisualScale: config.projectileVisualScale,
      smokeTrailColor: config.rocketSmokeTrailColor ?? playerColor,
      lifetime: hasExtendedMiniRocketFlight ? (config.miniRocketSafetyLifetimeMs ?? 12_000) : lifetime,
      maxBounces:      fireConfig.projectileMaxBounces,
      isGrenade:       false,
      adrenalinGain:   config.adrenalinGain,
      weaponName:      config.displayName,
      splitCount:      config.splitCount,
      splitSpread:     config.splitSpread,
      splitFactor:     config.splitFactor,
      splitHoming:     (config.splitHomingEnabled ?? 0) > 0 ? {
        acquireDelayMs: 0,
        searchRadius: 500,
        retargetIntervalMs: 50,
        maxTurnDegreesPerStep: 20,
        targetTypes: ['players', 'enemies'],
        requireLineOfSight: true,
        excludeOwner: true,
        distanceWeight: 1,
        forwardWeight: 0.5,
      } : undefined,
      remainingRangePx: effectiveRange,
      explosion:       fireConfig.impactExplosion,
      enemyHitExplosion: fireConfig.enemyHitExplosion,
      impactCloud:     fireConfig.impactCloud,
      homing:          config.homingEnabled === undefined || config.homingEnabled > 0
        ? fireConfig.homing
        : undefined,
      projectileStyle: config.projectileStyle,
      bulletVisualPreset: config.bulletVisualPreset,
      energyBallVariant: config.energyBallVariant,
      tracerConfig:    config.tracerConfig,
      detonable:       config.detonable,
      detonator:       config.detonator,
      rockDamageMult:  config.rockDamageMult,
      trainDamageMult: config.trainDamageMult,
      // Brennende Kugeln (z.B. Glock/Negev-Upgrade): Burn-Felder aufs Projektil übertragen.
      burnDurationMs:     config.burnOnHit?.durationMs,
      burnDamagePerTick:  config.burnOnHit?.damagePerTick,
      canReceiveFireImbue: sourceSlot === 'weapon1' || sourceSlot === 'weapon2',
      sourceSlot,
      shotAudioKey:    config.shotAudio?.successKey,
      penetrationCount: config.penetrationCount,
      penetrationDamageRetention: config.penetrationDamageRetention,
      penetratesRocks: (config.penetratesRocks ?? 0) > 0,
      multiExplosionCount: config.multiExplosionCount,
      multiExplosionCoastMs: isMiniRocket ? config.multiExplosionCoastMs : undefined,
      miniRocketStageRangePx: hasExtendedMiniRocketFlight ? effectiveRange : undefined,
      miniRocketReturnEnabled: isMiniRocket && (config.miniRocketReturnEnabled ?? 0) > 0,
      miniRocketReturnRangeBuffer: isMiniRocket ? config.miniRocketReturnRangeBuffer : undefined,
      miniRocketPickupRadius: isMiniRocket ? config.miniRocketPickupRadius : undefined,
      miniRocketPickupAdrenalineRefundFraction: isMiniRocket ? config.miniRocketPickupAdrenalineRefundFraction : undefined,
      miniRocketPickupArmor: isMiniRocket ? config.miniRocketPickupArmor : undefined,
      miniRocketAdrenalineCostPaid: isMiniRocket
        ? Math.min(
            this.resourceSystem.getAdrenaline(playerId),
            this.resourceSystem.resolveAdrenalineCost(playerId, config.adrenalinCost),
          )
        : undefined,
      miniRocketSafetyLifetimeMs: hasExtendedMiniRocketFlight ? (config.miniRocketSafetyLifetimeMs ?? 12_000) : undefined,
      miniRocketCascadeInitialDamageBonus: isMiniRocket ? config.miniRocketCascadeInitialDamageBonus : undefined,
      miniRocketCascadeDamageBonusPerExplosion: isMiniRocket ? config.miniRocketCascadeDamageBonusPerExplosion : undefined,
      shotgunOriginX: config.id === 'SHOTGUN' ? x : undefined,
      shotgunOriginY: config.id === 'SHOTGUN' ? y : undefined,
      shotgunResolvedRange: config.id === 'SHOTGUN' ? effectiveRange : undefined,
      shotgunProximityMaxDamageBonus: config.id === 'SHOTGUN' ? config.shotgunProximityMaxDamageBonus : undefined,
      shotgunSlowFraction: config.id === 'SHOTGUN' ? config.shotgunSlowFraction : undefined,
      shotgunSlowDurationMs: config.id === 'SHOTGUN' ? config.shotgunSlowDurationMs : undefined,
      hitSlowFraction: config.hitSlowFraction,
      hitSlowDurationMs: config.hitSlowDurationMs,
      hitKnockback: config.hitKnockback,
      hitKnockbackDurationMs: config.hitKnockbackDurationMs,
      fireTrail: config.id === 'AWP' && (config.awpCharge?.fireTrailDurationMs ?? 0) > 0 ? {
        durationMs: config.awpCharge?.fireTrailDurationMs ?? 0,
        burnDurationMs: config.awpCharge?.fireTrailBurnDurationMs ?? 0,
        burnDamagePerTick: config.awpCharge?.fireTrailBurnDamagePerTick ?? 0,
        weaponName: 'AWP-Brandspur',
      } : undefined,
      fireTrailHalfWidthCells: config.id === 'AWP' ? config.awpCharge?.fireTrailHalfWidthCells : undefined,
      awpCorridorHalfWidth: config.id === 'AWP' && (config.awpCharge?.corridorEnabled ?? 0) > 0
        ? config.awpCharge?.corridorHalfWidth
        : undefined,
      awpCorridorDamage: config.id === 'AWP' && (config.awpCharge?.corridorEnabled ?? 0) > 0
        ? config.awpCharge?.corridorDamage
        : undefined,
      awpCorridorKnockback: config.id === 'AWP' && (config.awpCharge?.corridorEnabled ?? 0) > 0
        ? config.awpCharge?.corridorKnockback
        : undefined,
      awpCorridorKnockbackDurationMs: config.id === 'AWP' && (config.awpCharge?.corridorEnabled ?? 0) > 0
        ? config.awpCharge?.corridorKnockbackDurationMs
        : undefined,
      proximityArc: config.proximityArc,
      ak47ShotId: config.ak47ShotId,
      ak47DamageMultiplier: config.ak47DamageMultiplier,
      ak47FireSuperiorityShot: config.ak47FireSuperiorityShot,
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
      config.chainLightning,  // ChainLightningConfig weitergeben (optional)
      config.burnOnHit,       // BurnOnHitConfig weitergeben (optional)
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
      config.burnOnHit,       // BurnOnHitConfig weitergeben (optional)
      undefined,
      config.hitHeal ?? 0,
      config.hitAdrenaline ?? 0,
      config.bloodEffectMultiplier ?? 1,
      fireConfig.damageTargets,
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
    const fireball = fireConfig.fireball;
    if ((fireball?.enabled ?? 0) > 0) {
      const groundEffect = {
        durationMs: fireball?.groundDurationMs ?? 2000,
        burnDurationMs: fireConfig.burnDurationMs,
        burnDamagePerTick: fireball?.groundBurnDamagePerTick ?? 0.5,
        weaponName: 'Feuerball-Brand',
      };
      const chunkCount = Math.max(0, Math.floor(fireball?.chunkCount ?? 0));
      this.projectileManager.spawnProjectile(x, y, angle, playerId, {
        speed: fireball?.projectileSpeed ?? 450,
        size: fireball?.projectileSize ?? 28,
        damage: config.damage,
        color: 0xff7417,
        ownerColor: playerColor,
        lifetime: config.range / Math.max(1, fireball?.projectileSpeed ?? 450) * 1000,
        maxBounces: 0,
        isGrenade: false,
        adrenalinGain: config.adrenalinGain,
        weaponName: 'Feuerball-Werfer',
        projectileStyle: 'fireball',
        rockDamageMult: 1,
        trainDamageMult: 1.15,
        explosion: {
          radius: fireball?.explosionRadius ?? 120,
          maxDamage: fireball?.explosionMaxDamage ?? 90,
          minDamage: fireball?.explosionMinDamage ?? 20,
          knockback: fireball?.explosionKnockback ?? 1250,
          selfDamageMult: fireball?.selfDamageMult ?? 0.25,
          rockDamageMult: 1,
          trainDamageMult: 1.15,
          color: 0xff6a14,
          visualStyle: 'rocket',
          burnOnHit: { durationMs: fireConfig.burnDurationMs, damagePerTick: fireConfig.burnDamagePerTick },
          burnOrigin: 'flamethrower_direct',
          fireChunkBurst: {
            ...groundEffect,
            count: chunkCount,
            searchRadius: fireball?.chunkSearchRadius ?? 96,
            flightMs: fireball?.chunkFlightMs ?? 320,
            igniteCenter: true,
          },
        },
        fireTrail: (fireball?.trailEnabled ?? 0) > 0 ? groundEffect : undefined,
        sourceSlot,
        shotAudioKey: config.shotAudio?.successKey,
      });
      return true;
    }

    const lifetime = this.calculateDecayLifetime(config.range, fireConfig.projectileSpeed, fireConfig.velocityDecay);

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
      flamePiercing:     (fireConfig.piercingCount ?? 0) > 0,
      sourceSlot,
      shotAudioKey:    config.shotAudio?.successKey,
    });

    return true;
  }

  private fireLeafBlowerWeapon(
    config:      WeaponConfig,
    fireConfig:  LeafBlowerWeaponFireConfig,
    x:           number,
    y:           number,
    angle:       number,
    playerId:    string,
    playerColor: number,
    sourceSlot?: LoadoutSlot,
  ): boolean {
    const lifetime = this.calculateDecayLifetime(config.range, fireConfig.projectileSpeed, fireConfig.velocityDecay);

    this.projectileManager.spawnProjectile(x, y, angle, playerId, {
      speed:           fireConfig.projectileSpeed,
      size:            fireConfig.hitboxStartSize,
      damage:          config.directDamageOverride ?? config.damage,
      color:           config.projectileColor ?? playerColor,
      ownerColor:      playerColor,
      lifetime,
      maxBounces:      999999,
      isGrenade:       false,
      adrenalinGain:   config.adrenalinGain,
      weaponName:      config.displayName,
      projectileStyle: 'leaf_blower',
      rockDamageMult:  config.rockDamageMult,
      trainDamageMult: config.trainDamageMult,
      hitboxGrowRate:  fireConfig.hitboxGrowRate,
      hitboxMaxSize:   fireConfig.hitboxEndSize,
      velocityDecay:   fireConfig.velocityDecay,
      leafBlowerMinKnockback: fireConfig.minKnockback,
      leafBlowerMaxKnockback: fireConfig.maxKnockback,
      leafBlowerSelfPush: fireConfig.selfPush,
      sourceSlot,
      shotAudioKey:    config.shotAudio?.successKey,
    });

    return true;
  }

  private calculateDecayLifetime(range: number, projectileSpeed: number, decay: number): number {
    if (decay >= 1 || decay <= 0) {
      return (range / projectileSpeed) * 1000;
    }

    const lnDecay   = Math.log(decay);
    const maxDist   = projectileSpeed / -lnDecay;
    const distRatio = range / maxDist;
    if (distRatio >= 1) {
      return 3000;
    }

    return Math.log(1 - distRatio) / lnDecay * 1000;
  }

  private getEquippedEnergyShieldFireConfig(playerId: string): EnergyShieldWeaponFireConfig | null {
    const weapon = this.loadouts.get(playerId)?.weapon2.config;
    if (!weapon || weapon.fire.type !== 'energy_shield') return null;
    return weapon.fire as EnergyShieldWeaponFireConfig;
  }
}
