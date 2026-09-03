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
import type { ConstructionId, GrenadeEffectConfig, LoadoutSlot, LoadoutToolRef, LoadoutUseParams, LoadoutUseResult, PlayerAimNetState, ShieldBuffHudState, SyncedActiveHudBuff, TrackedProjectile, WeaponSlot } from '../types';
import { getCoopDefenseConstructionDefinition } from '../config/coopDefenseConstructions';
import type {
  AirstrikeUltimateConfig,
  BfgUtilityConfig,
  ChargedThrowUtilityActivationConfig,
  DecoyUtilityConfig,
  EnergyShieldWeaponFireConfig,
  GaussUltimateConfig,
  LeafBlowerWeaponFireConfig,
  NukeUtilityConfig,
  ReinforcementMatrixWeaponFireConfig,
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
  EnergyInjectorWeaponFireConfig,
  UltimateConfig,
  UtilityConfig,
  WeaponConfig,
} from './LoadoutConfig';
import { applyCoopDefenseModifiersToUtilityConfig } from './CoopDefenseLoadoutModifiers';
import { COLORS, PLAYER_SIZE, type MuzzleOrigin } from '../config';
import { areLoadoutConfigsEquivalent, sanitizeLoadoutSelectionForMode } from './LoadoutRules';
import { isVelocityMoving } from './SpreadMath';
import { resolveShotPlan } from './ShotPlanResolver';
import type { WeaponExecutionCapability, WeaponFireOptions } from './WeaponFireExecutor';
import { getHeldWeaponGameplayMuzzleOrigin, getHeldWeaponMuzzleOrigin } from './HeldItemVisuals';

export interface LoadoutSelection {
  weapon1?:  WeaponConfig;
  weapon2?:  WeaponConfig;
  utility?:  UtilityConfig;
  ultimate?: UltimateConfig;
}

import { HeldItemSlotTracker, type HeldItemSlot } from './HeldItemSlotTracker';
import { GenericWeapon }   from './GenericWeapon';
import { GenericUtility }  from './GenericUtility';
import { GenericUltimate } from './GenericUltimate';
import {
  TemporaryUtilityCollection,
  type TemporaryUtilityRuntimeInstance,
} from './TemporaryUtilityCollection';
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
  fireSuperiorityShotsAvailable: number;
  fireSuperiorityTotalShots: number;
  pendingFireSuperiorityShotIds: Set<number>;
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
  /** Zeitpunkt des letzten tatsaechlich abgefeuerten Negev-Schusses. */
  lastShotAt: number;
}

export interface NegevKillstreakExplosionEvent {
  ownerId: string;
  x: number;
  y: number;
  kills: number;
  radius: number;
  damage: number;
  nowMs: number;
  fireChunkDurationMs: number;
  fireChunkBurnDurationMs: number;
  fireChunkBurnDamagePerTick: number;
}

type CombatResolverType = Pick<CombatSystem, 'addArmor' | 'heal' | 'applyAoeDamage' | 'resolveHitscanShot' | 'traceHitscan' | 'resolveMeleeSwing'>
  & Partial<Pick<CombatSystem, 'resolveSafeHitscanStart'>>;
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
  /** Inspector utilities keep an independent cooldown state per player and utility id. */
  private inspectorUtilities = new Map<string, Map<string, GenericUtility>>();
  /** Constructions bypass GenericUtility, so their build cooldown is tracked separately. */
  private constructionCooldowns = new Map<string, Map<ConstructionId, number>>();
  /** Kurzer Doppelinput-Schutz je Management-Aktion; derselbe keyed Cooldown-Vertrag wie Bauen. */
  private readonly managementActionCooldowns = new Map<string, Map<string, number>>();
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
  private placeableRockHandler: ((cfg: PlaceableUtilityConfig, playerId: string, x: number, y: number, targetX: number, targetY: number, now: number, playerColor: number, params?: LoadoutUseParams) => boolean) | null = null;
  private tunnelPlacementHandler: ((cfg: TunnelUltimateConfig, playerId: string, x: number, y: number, targetX: number, targetY: number, playerColor: number, params?: LoadoutUseParams) => boolean) | null = null;
  private utilityUsedCallback: ((playerId: string, utilityType: UtilityConfig['type']) => void) | null = null;
  private utilityUsedObserver: ((playerId: string, utilityType: UtilityConfig['type']) => void) | null = null;
  private ultimateUsedObserver: ((playerId: string, ultimateType: UltimateConfig['type']) => void) | null = null;
  private utilityConfigModifierSource: ((playerId: string) => { additive: Readonly<Record<string, number>>; percentage: Readonly<Record<string, number>> } | null) | null = null;
  /**
   * Verbraucht eine gespeicherte kinetische Ladung und liefert den Schadensbonus als Anteil.
   * Injiziert statt direkt referenziert, weil das Item-Laufzeitsystem Round-Lifetime hat.
   */
  private itemRuntimeChargeConsumer: ((playerId: string) => number) | null = null;
  private itemRuntimeWeaponFiredHandler: ((playerId: string, sourceSlot: WeaponSlot) => void) | null = null;
  private shotCounters = new Map<string, number>();
  private ak47States = new Map<string, Ak47CombatState>();
  private ak47StrategicTargetHitResolver: ((playerId: string, enemyId: string) => boolean) | null = null;
  private negevStates = new Map<string, NegevCombatState>();
  private shotgunLightningQueue: ShotgunLightningEvent[] = [];
  private negevKillstreakExplosionHandler: ((event: NegevKillstreakExplosionEvent) => void) | null = null;
  /** Welches Item die Figur gerade in den Pfoten haelt – rein visuell, aber host-autoritativ. */
  private readonly heldItemSlots = new HeldItemSlotTracker();

  /** Host-authoritative weapon intent. A weapon request claims its slot immediately. */
  private activeWeaponSlots = new Map<string, WeaponSlot>();

  /**
   * Gemeinsame Immediate-Weapon-Execution-Capability für Projektil-, Hitscan- und Melee-Waffen.
   * Seit Teilphase 4A world-composed injiziert statt vom Loadout selbst gebaut: der Executor
   * gehört nicht mehr logisch dem Loadout. Für Player-Fire delegiert der Manager weiterhin hierher.
   */
  private weaponExecution: WeaponExecutionCapability | null = null;

  setWeaponExecutionCapability(capability: WeaponExecutionCapability | null): void {
    this.weaponExecution = capability;
  }

  // Held-Fire-Tracking: Feuerknopf gilt als gehalten wenn innerhalb HOLD_EXPIRE_MS gefeuert wurde
  private heldFireSlots = new Map<string, { slot: WeaponSlot; lastAt: number; angle: number }>();
  private static readonly HOLD_EXPIRE_MS = 100;
  /**
   * Dauerfeuer gilt als unterbrochen, wenn so lange kein Negev-Schuss mehr fiel.
   * Bewusst an den echten Schuessen statt am gehaltenen Feuerknopf gemessen: So
   * endet der Killstreak auch bei leerem Adrenalin, Tod, Eingraben oder Dodge.
   */
  private static readonly NEGEV_STREAK_GAP_MS = 300;
  /** Kill-Zahl, ab der die HUD-Partikel des Killstreaks ihre volle Staerke erreichen. */
  private static readonly NEGEV_STREAK_FULL_INTENSITY_KILLS = 15;

  private readonly okResult: LoadoutUseResult = { ok: true };

  // ── Temporaere Utilities (host-autoritative Multi-Instance-Collection) ───
  private readonly temporaryUtilities = new TemporaryUtilityCollection();

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
    this.inspectorUtilities.set(playerId, new Map());
    this.constructionCooldowns.set(playerId, new Map());
    this.managementActionCooldowns.set(playerId, new Map());
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
    this.temporaryUtilities.clearPlayer(playerId);
    this.bridge.publishUtilityCooldownUntil(playerId, 0, '__clear__');
    this.bridge.publishTemporaryUtilityInstances(playerId, []);
    this.bridge.publishHeldUtilityId(playerId, '');
    this.teslaDomeSystem?.hostDeactivateForPlayer(playerId);
    this.energyShieldSystem?.hostDeactivateForPlayer(playerId);
    this.getActiveWeaponSlots().set(playerId, 'weapon1');
    this.shieldBuffSystem?.resetPlayer(playerId);
    this.resetAk47State(playerId);
    this.negevStates.set(playerId, { kills: 0, lastShotAt: 0 });
    // Ein frisches Loadout beginnt mit Waffe 1 in den Pfoten, sonst zeigte die Figur nach einem
    // Waffenwechsel in der Lobby weiter den Slot der letzten Runde.
    this.heldItemSlots.removePlayer(playerId);
  }

  /**
   * Slot, dessen Item die Figur gerade sichtbar traegt. Host-autoritativ und rein visuell; der
   * Wert wird als Slot repliziert, die Zuordnung zum Bild passiert lokal auf jeder Seite.
   */
  getHeldItemSlot(playerId: string, now = Date.now()): HeldItemSlot {
    return this.heldItemSlots.resolve(playerId, now);
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
    this.inspectorUtilities.delete(playerId);
    this.constructionCooldowns.delete(playerId);
    this.managementActionCooldowns.delete(playerId);
    this.ultimateStates.delete(playerId);
    this.aimNetStates.delete(playerId);
    this.temporaryUtilities.clearPlayer(playerId);
    // Per-player network state survives a round reset while the player remains connected.
    // Clear the temporary utility collection before the next loadout is created.
    this.bridge.publishUtilityCooldownUntil(playerId, 0, '__clear__');
    this.bridge.publishTemporaryUtilityInstances(playerId, []);
    this.bridge.publishHeldUtilityId(playerId, '');
    this.heldFireSlots.delete(playerId);
    this.activeWeaponSlots?.delete(playerId);
    this.teslaDomeSystem?.hostDeactivateForPlayer(playerId);
    this.energyShieldSystem?.hostDeactivateForPlayer(playerId);
    this.shieldBuffSystem?.removePlayer(playerId);
    this.translocatorSystem?.removePlayer(playerId);
    this.decoySystem?.clearPlayer(playerId);
    this.ak47States.delete(playerId);
    this.negevStates.delete(playerId);
    this.heldItemSlots.removePlayer(playerId);
    this.shotgunLightningQueue = this.shotgunLightningQueue.filter((event) => event.ownerId !== playerId);
  }

  resetAk47State(playerId: string): void {
    this.ak47States.set(playerId, {
      stacks: 0,
      fireSuperiorityShotsAvailable: 0,
      fireSuperiorityTotalShots: 0,
      pendingFireSuperiorityShotIds: new Set<number>(),
      nextShotId: 1,
      confirmedShotIds: new Set<number>(),
    });
  }

  setAk47StrategicTargetHitResolver(resolver: ((playerId: string, enemyId: string) => boolean) | null): void {
    this.ak47StrategicTargetHitResolver = resolver;
  }

  /** Refunds a specific penetrative shot at most once. */
  registerAk47StrategicTargetHit(projectile: TrackedProjectile, enemyId: string): boolean {
    const shotId = projectile.ak47ShotId;
    if (!projectile.ak47FireSuperiorityShot || shotId === undefined || projectile.ak47StrategicRefunded) return false;
    if (!this.ak47StrategicTargetHitResolver?.(projectile.ownerId, enemyId)) return false;
    const state = this.ak47States.get(projectile.ownerId);
    if (!state || !state.pendingFireSuperiorityShotIds.has(shotId)) return false;

    state.pendingFireSuperiorityShotIds.delete(shotId);
    state.fireSuperiorityShotsAvailable += 1;
    projectile.ak47StrategicRefunded = true;
    return true;
  }

  registerAk47ProjectileHit(projectile: TrackedProjectile, now = Date.now()): void {
    const shotId = projectile.ak47ShotId;
    if (shotId === undefined || projectile.ak47HitConfirmed) return;
    projectile.ak47HitConfirmed = true;

    const config = this.getAk47Config(projectile.ownerId);
    const focus = config?.ak47Focus;
    if (!focus || this.getAk47MaxStacks(focus) <= 0) return;

    const state = this.getOrCreateAk47State(projectile.ownerId);
    state.confirmedShotIds.add(shotId);
    void now;

    // Durchbruchmunition baut waehrend der laufenden Belohnungsphase keine neue
    // Belohnungsschleife auf. Nach dem Magazin beginnt die Praezisionsserie neu.
    if (projectile.ak47FireSuperiorityShot) return;

    const maxStacks = this.getAk47MaxStacks(focus);
    state.stacks = Math.min(maxStacks, state.stacks + 1);

    if (
      state.stacks >= maxStacks
      && focus.fireSuperiorityShots > 0
      && !this.isAk47FireSuperiorityPhaseActive(state)
    ) {
      const shotCount = Math.max(1, Math.round(focus.fireSuperiorityShots));
      state.fireSuperiorityShotsAvailable = shotCount;
      state.fireSuperiorityTotalShots = shotCount;
      state.stacks = maxStacks;
    }
  }

  resolveAk47Projectile(projectile: TrackedProjectile, now = Date.now()): void {
    const shotId = projectile.ak47ShotId;
    if (shotId === undefined) return;
    const state = this.ak47States.get(projectile.ownerId);
    if (!state) return;

    const didHit = projectile.ak47HitConfirmed || state.confirmedShotIds.has(shotId);
    state.confirmedShotIds.delete(shotId);
    state.pendingFireSuperiorityShotIds.delete(shotId);
    void now;
    if (projectile.ak47FireSuperiorityShot && !this.isAk47FireSuperiorityPhaseActive(state)) {
      state.fireSuperiorityTotalShots = 0;
      state.stacks = 0;
    } else if (!didHit && !this.isAk47FireSuperiorityPhaseActive(state)) {
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
    const maxStacks = this.getAk47MaxStacks(focus);
    if (state.stacks > 0 && maxStacks > 0) {
      const damagePct = Math.round(state.stacks * focus.damagePerStack * 100);
      result.push({
        defId: 'AK47_FOCUS',
        remainingFrac: state.stacks / maxStacks,
        stacks: state.stacks,
        maxStacks,
        value: damagePct / 100,
      });
    }
    const pending = state.pendingFireSuperiorityShotIds.size;
    if (state.fireSuperiorityShotsAvailable > 0 || pending > 0) {
      result.push({
        defId: 'AK47_FIRE_SUPERIORITY',
        remainingFrac: (state.fireSuperiorityShotsAvailable + pending) / Math.max(1, state.fireSuperiorityTotalShots),
        availableCount: state.fireSuperiorityShotsAvailable,
        pendingCount: pending,
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
      count: state.kills,
      value: state.kills * damagePerKill,
      // Der Streak ist unbegrenzt – ab dieser Kill-Zahl laeuft die Anzeige auf Vollgas.
      intensity: Math.min(1, state.kills / LoadoutManager.NEGEV_STREAK_FULL_INTENSITY_KILLS),
    }];
  }

  isAk47FireSuperiorityActive(playerId: string): boolean {
    return this.getAk47Config(playerId) !== null
      && this.isAk47FireSuperiorityPhaseActive(this.ak47States.get(playerId));
  }

  /** True only while at least one breakthrough shot can be fired immediately. */
  isAk47FireSuperiorityAvailable(playerId: string): boolean {
    return this.getAk47Config(playerId) !== null
      && (this.ak47States.get(playerId)?.fireSuperiorityShotsAvailable ?? 0) > 0;
  }

  /** True when the shared Einschießen series has reached its hard five-stack cap. */
  isAk47FocusAtMaxStacks(playerId: string): boolean {
    const focus = this.getAk47Config(playerId)?.ak47Focus;
    if (!focus) return false;
    const maxStacks = this.getAk47MaxStacks(focus);
    return maxStacks > 0 && (this.ak47States.get(playerId)?.stacks ?? 0) >= maxStacks;
  }

  beginUtilityCooldown(playerId: string, utilityId: string, now: number): void {
    const loadout = this.loadouts.get(playerId);
    if (!loadout) return;
    if (loadout.utility.config.id !== utilityId) return;
    loadout.utility.recordUse(now);
    this.bridge.publishUtilityCooldownUntil(playerId, now + loadout.utility.config.cooldown, utilityId);
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

  setUtilityUsedObserver(observer: ((playerId: string, utilityType: UtilityConfig['type']) => void) | null): void {
    this.utilityUsedObserver = observer;
  }

  setUltimateUsedObserver(observer: ((playerId: string, ultimateType: UltimateConfig['type']) => void) | null): void {
    this.ultimateUsedObserver = observer;
  }

  setUtilityConfigModifierSource(source: ((playerId: string) => { additive: Readonly<Record<string, number>>; percentage: Readonly<Record<string, number>> } | null) | null): void {
    this.utilityConfigModifierSource = source;
  }

  setItemRuntimeChargeConsumer(consumer: ((playerId: string) => number) | null): void {
    this.itemRuntimeChargeConsumer = consumer;
  }

  /**
   * Meldung ueber einen tatsaechlich erfolgten Waffeneinsatz (Kreuzfeuer).
   *
   * Bewusst ohne Zeitstempel: `use()` bekommt die Client-Uhr durchgereicht, das Zeitfenster des
   * Laufzeitsystems laeuft aber gegen `Date.now()` des Hosts. Ein durchgereichtes `now` wuerde
   * die Dauer um den Clock-Skew verschieben.
   */
  setItemRuntimeWeaponFiredHandler(handler: ((playerId: string, sourceSlot: WeaponSlot) => void) | null): void {
    this.itemRuntimeWeaponFiredHandler = handler;
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

  setPlaceableRockHandler(handler: ((cfg: PlaceableUtilityConfig, playerId: string, x: number, y: number, targetX: number, targetY: number, now: number, playerColor: number, params?: LoadoutUseParams) => boolean) | null): void {
    this.placeableRockHandler = handler;
  }

  setTunnelPlacementHandler(handler: ((cfg: TunnelUltimateConfig, playerId: string, x: number, y: number, targetX: number, targetY: number, playerColor: number, params?: LoadoutUseParams) => boolean) | null): void {
    this.tunnelPlacementHandler = handler;
  }

  /**
   * Host-authoritative dispatch for an Inspector utility. Unlike the regular
   * utility slot, every Inspector utility owns its own cooldown, taken from the
   * utility's own config. Inspector utilities never cost adrenaline; constructs
   * are limited by the fixed construction capacity instead.
   */
  useInspectorUtility(
    playerId: string,
    config: UtilityConfig,
    angle: number,
    targetX: number,
    targetY: number,
    now: number,
    params?: LoadoutUseParams,
  ): LoadoutUseResult {
    const loadout = this.loadouts.get(playerId);
    const player = this.playerManager.getPlayer(playerId);
    if (!loadout || !player) return { ok: false, reason: 'invalid' };
    if (this.actionBlockedChecker?.(playerId, 'utility')) return { ok: false, reason: 'blocked' };

    const effectiveConfig: UtilityConfig = this.resolveUtilityConfig(playerId, config);
    const utilities = this.inspectorUtilities.get(playerId) ?? new Map<string, GenericUtility>();
    this.inspectorUtilities.set(playerId, utilities);
    let utility = utilities.get(effectiveConfig.id);
    if (!utility || utility.config !== effectiveConfig) {
      const previousLastUsedAt = utility?.getLastUsedAt() ?? 0;
      utility = new GenericUtility(effectiveConfig);
      utility.setLastUsedAt(previousLastUsedAt);
      utilities.set(effectiveConfig.id, utility);
    }

    if (utility.isOnCooldown(now)) return { ok: false, reason: 'cooldown' };

    // Inspector actions are host-authoritative: the client may submit an aim
    // target, but never its own origin for range or spawn validation.
    const x = player.x;
    const y = player.y;
    const didUse = this.useUtility(utility, x, y, angle, targetX, targetY, playerId, now, player.color, params);
    if (!didUse) return { ok: false, reason: 'blocked' };
    this.heldItemSlots.noteUtilityUsed(playerId, now);
    this.bridge.publishHeldUtilityId(playerId, effectiveConfig.id);
    return this.okResult;
  }

  // ── Bau-Cooldowns der Konstruktionen ──────────────────────────────────────
  // Konstruktionen laufen nicht ueber `GenericUtility`; ihr Bau-Cooldown kommt aus
  // der jeweiligen Konstruktsdefinition.

  isConstructionOnCooldown(playerId: string, constructionId: ConstructionId, now: number): boolean {
    const readyAt = this.constructionCooldowns.get(playerId)?.get(constructionId) ?? 0;
    return now < readyAt;
  }

  markConstructionUsed(playerId: string, constructionId: ConstructionId, now: number): void {
    const perPlayer = this.constructionCooldowns.get(playerId) ?? new Map<ConstructionId, number>();
    this.constructionCooldowns.set(playerId, perPlayer);
    perPlayer.set(constructionId, now + getCoopDefenseConstructionDefinition(constructionId).buildCooldownMs);
  }

  /**
   * Endzeitpunkt des Doppelinput-Schutzes einer Management-Aktion.
   *
   * Der Wert haengt bewusst an der Aktion und nicht am bewegten Objekt: Verschieben und
   * Einzel-Rueckbau verwenden denselben festen Schutz, unabhaengig vom Konstruktionstyp.
   */
  getManagementActionCooldownUntil(playerId: string, action: string): number {
    return this.managementActionCooldowns.get(playerId)?.get(action) ?? 0;
  }

  isManagementActionOnCooldown(playerId: string, action: string, now: number): boolean {
    return now < this.getManagementActionCooldownUntil(playerId, action);
  }

  markManagementActionUsed(playerId: string, action: string, now: number, cooldownMs: number): void {
    const perPlayer = this.managementActionCooldowns.get(playerId) ?? new Map<string, number>();
    this.managementActionCooldowns.set(playerId, perPlayer);
    perPlayer.set(action, now + Math.max(0, cooldownMs));
  }

  // ── Temporaere Utility-Instanzen ─────────────────────────────────────────

  addTemporaryUtility(playerId: string, config: UtilityConfig, charges: number): string | null {
    if (!this.loadouts.has(playerId)) return null;
    const modifierSource = this.utilityConfigModifierSource?.(playerId);
    const effectiveConfig = modifierSource ? applyCoopDefenseModifiersToUtilityConfig(config, modifierSource) : config;
    const instance = this.temporaryUtilities.add(
      playerId,
      effectiveConfig,
      charges,
      config.type === 'placeable_pedestal'
        ? { kind: 'objective-placement', objectiveId: config.rewardObjectiveId, powerUpDefId: config.powerUpDefId }
        : { kind: 'utility' },
    );
    if (!instance) return null;
    this.publishTemporaryUtilities(playerId);
    return instance.instanceId;
  }

  getTemporaryUtilityConfig(playerId: string, instanceId: string): UtilityConfig | null {
    return this.temporaryUtilities.get(playerId, instanceId)?.utility.config ?? null;
  }

  releaseTemporaryUtilityForObjective(playerId: string, objectiveId: string): void {
    if (!this.temporaryUtilities.removeForObjective(playerId, objectiveId)) return;
    this.publishTemporaryUtilities(playerId);
  }

  clearTemporaryUtilities(playerId: string): void {
    this.temporaryUtilities.clearPlayer(playerId);
    this.publishTemporaryUtilities(playerId);
  }

  private publishTemporaryUtilities(playerId: string): void {
    this.bridge.publishTemporaryUtilityInstances(
      playerId,
      this.temporaryUtilities.getDescriptors(playerId),
    );
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
    const x = clientX ?? player.x;
    const y = clientY ?? player.y;

    // Schießen während Dash-Phase 1 (Burst) blockiert
    if ((slot === 'weapon1' || slot === 'weapon2') && this.dashBurstChecker?.(playerId)) return { ok: false, reason: 'blocked' };

    // Held-Fire-Tracking: Feuerknopf-Halte-Zustand aktualisieren
    if (slot === 'weapon1' || slot === 'weapon2') {
      this.claimWeaponSlot(playerId, slot);
      this.heldFireSlots.set(playerId, { slot, lastAt: now, angle });
      this.decoySystem?.breakStealth(playerId, now);
    }

    // scopeHolding: Scope-Waffe wird gehalten, aber noch kein Schuss – nur holdSpeedFactor aktiv
    if (params?.scopeHolding && (slot === 'weapon1' || slot === 'weapon2')) {
      return this.okResult;
    }

    switch (slot) {
      case 'weapon1': {
        const result = this.fireWeapon(loadout.weapon1, x, y, angle, targetX, targetY, playerId, now, player.color, 'weapon1', shotId);
        if (result.ok) this.heldItemSlots.noteWeaponUsed(playerId, 'weapon1', now);
        return result;
      }

      case 'weapon2': {
        // Der Kreuzfeuer-Melder haengt bewusst hier und nicht in `fireWeapon`: nur ein Aufruf,
        // der tatsaechlich gefeuert hat, oeffnet das Fenster – Cooldown, fehlendes Adrenalin und
        // blockierte Schuesse liefern `ok: false` und zaehlen nicht. Dasselbe gilt fuer das
        // getragene Item: ein abgelehnter Schuss nimmt die Waffe nicht in die Pfoten.
        const result = this.fireWeapon(loadout.weapon2, x, y, angle, targetX, targetY, playerId, now, player.color, 'weapon2', shotId, params);
        if (result.ok) {
          this.itemRuntimeWeaponFiredHandler?.(playerId, 'weapon2');
          this.heldItemSlots.noteWeaponUsed(playerId, 'weapon2', now);
        }
        return result;
      }

      case 'utility': {
        const temporaryInstance = params?.temporaryUtilityInstanceId
          ? this.temporaryUtilities.get(playerId, params.temporaryUtilityInstanceId)
          : null;
        if (params?.temporaryUtilityInstanceId && !temporaryInstance) {
          return { ok: false, reason: 'invalid' };
        }
        const utility = temporaryInstance?.utility ?? loadout.utility;
        if (utility.config.type !== 'decoy') {
          this.decoySystem?.breakStealth(playerId, now);
        }
        const didUse = this.useUtility(
          utility,
          x,
          y,
          angle,
          targetX,
          targetY,
          playerId,
          now,
          player.color,
          params,
          temporaryInstance,
        );
        if (didUse) {
          this.heldItemSlots.noteUtilityUsed(playerId, now);
          this.bridge.publishHeldUtilityId(playerId, utility.config.id);
        }
        return didUse ? this.okResult : { ok: false, reason: 'blocked' };
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
              return p ? { x: p.x, y: p.y } : null;
            });
          }
          this.ultimateUsedObserver?.(playerId, cfg.type);
          return this.okResult;
        }

        if (cfg.type === 'airstrike') {
          const rage = this.resourceSystem.getRage(playerId);
          if (rage < cfg.rageCost) return { ok: false, reason: 'resource', resourceKind: 'rage' };
          const ok = this.airstrikeHandler?.(playerId, targetX, targetY, cfg) ?? false;
          if (!ok) return { ok: false, reason: 'blocked' };
          this.resourceSystem.addRage(playerId, -cfg.rageCost);
          this.ultimateUsedObserver?.(playerId, cfg.type);
          return this.okResult;
        }

        if (cfg.type === 'tunnel') {
          const rage = this.resourceSystem.getRage(playerId);
          if (rage < cfg.rageRequired) return { ok: false, reason: 'resource', resourceKind: 'rage' };
          if (params?.tunnelAction !== 'commit') return { ok: false, reason: 'blocked' };
          const ok = this.tunnelPlacementHandler?.(cfg, playerId, x, y, targetX, targetY, player.color, params) ?? false;
          if (!ok) return { ok: false, reason: 'blocked' };
          this.resourceSystem.addRage(playerId, -cfg.rageCost);
          this.ultimateUsedObserver?.(playerId, cfg.type);
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

  update(delta: number, nowMs?: number): void {
    const now = nowMs ?? Date.now();

    // Spread-Decay für alle ausgerüsteten Waffen
    for (const loadout of this.loadouts.values()) {
      loadout.weapon1.decaySpread(delta, now);
      loadout.weapon2.decaySpread(delta, now);
    }

    for (const [playerId, state] of this.negevStates) {
      if (state.kills <= 0) continue;
      const stillFiringNegev = now - state.lastShotAt < LoadoutManager.NEGEV_STREAK_GAP_MS
        && this.loadouts.get(playerId)?.weapon2.config.id === 'NEGEV';
      if (!stillFiringNegev) this.finishNegevKillstreak(playerId, state.kills, now);
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
                if (Phaser.Math.Distance.Between(owner.x, owner.y, ally.x, ally.y) <= aura.radius) {
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
              auraOwner.x,
              auraOwner.y,
              aura.radius,
              aura.damagePerTick,
              playerId,
              false,
              {
                category: 'damage_over_time',
                sourceId: state.config.id,
                sourceSlot: 'ultimate',
                baseDamageMult: aura.baseDamageMult,
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

  getSpeedMultiplier(playerId: string, now: number = Date.now()): number {
    const state        = this.ultimateStates.get(playerId);
    const ultimateMult = (state?.active && state.config.type === 'buff' ? state.config.speedMultiplier : 1)
      * this.getAllyAuraMultiplier(playerId, 'speed', now);
    const gaussSlowMult = state?.config.type === 'gauss' && state.gaussChargeStartedAt !== null
      ? state.config.movementSlowFactor
      : 1;

    // Energie-Schild/Kuppel verlangsamt, solange er aktiv ist – auch im Toggle-Modus ohne Halten.
    if (this.energyShieldSystem?.isActive(playerId)) {
      const shieldCfg = this.loadouts.get(playerId)?.weapon2.config;
      if (shieldCfg?.fire.type === 'energy_shield') {
        return ultimateMult * gaussSlowMult * (shieldCfg.fire as EnergyShieldWeaponFireConfig).movementSlowFactor;
      }
    }

    // holdSpeedFactor: Verlangsamung wenn Feuerknopf gehalten wird
    const held = this.heldFireSlots.get(playerId);
    if (held && now - held.lastAt < LoadoutManager.HOLD_EXPIRE_MS) {
      const cfg = this.loadouts.get(playerId)?.[held.slot].config;
      if (cfg?.fire.type === 'tesla_dome') {
        // Feldstabilisierung hebt den Bewegungsfaktor mit der Ladestufe an. Der maßgebliche
        // Wert steht deshalb im Laufzeitzustand des TeslaDomeSystem, nicht in der statischen Config.
        const holdFactor = this.teslaDomeSystem?.getMovementSlowFactor(playerId) ?? 1;
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

  getHeldSelfPushVelocity(playerId: string, now: number = Date.now()): { vx: number; vy: number } | null {
    const held = this.heldFireSlots.get(playerId);
    if (!held || now - held.lastAt >= LoadoutManager.HOLD_EXPIRE_MS) return null;

    const cfg = this.loadouts.get(playerId)?.[held.slot].config;
    if (!cfg || cfg.fire.type !== 'leaf_blower') return null;

    const selfPush = cfg.fire.selfPush;
    if (selfPush <= 0) return null;

    return {
      vx: -Math.cos(held.angle) * selfPush,
      vy: -Math.sin(held.angle) * selfPush,
    };
  }

  getDamageMultiplier(playerId: string, now: number = Date.now()): number {
    const state = this.ultimateStates.get(playerId);
    return (state?.active && state.config.type === 'buff' ? state.config.damageMultiplier : 1)
      * this.getAllyAuraMultiplier(playerId, 'damage', now);
  }
  private getAllyAuraMultiplier(playerId: string, kind: 'speed' | 'damage', now: number = Date.now()): number {
    const target = this.playerManager.getPlayer(playerId);
    if (!target) return 1;
    let multiplier = 1;
    for (const [ownerId, state] of this.ultimateStates) {
      if (ownerId === playerId || state.config.type !== 'buff' || !state.config.aura) continue;
      if (!state.active && state.auraLingerUntil < now) continue;
      if (this.bridge.isEnemyPair(ownerId, playerId)) continue;
      const owner = this.playerManager.getPlayer(ownerId);
      if (!owner || Phaser.Math.Distance.Between(owner.x, owner.y, target.x, target.y) > state.config.aura.radius) continue;
      multiplier *= kind === 'speed'
        ? (state.config.aura.allySpeedMultiplier ?? 1)
        : (state.config.aura.allyDamageMultiplier ?? 1);
    }
    return multiplier;
  }

  getWeaponDamageMultiplier(playerId: string, slot: WeaponSlot, now = Date.now()): number {
    const baseMultiplier = this.getDamageMultiplier(playerId, now);
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
      this.ultimateUsedObserver?.(playerId, cfg.type);
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
    this.spawnGaussProjectile(
      cfg,
      x,
      y,
      angle,
      playerId,
      playerColor,
      undefined,
      this.getGameplayMuzzleOrigin(playerId, cfg.id, x, y, angle),
    );

    this.physicsSystem?.addRecoil(
      playerId,
      -Math.cos(angle) * cfg.shotRecoilForce,
      -Math.sin(angle) * cfg.shotRecoilForce,
      cfg.shotRecoilDuration,
    );
  }

  private spawnGaussProjectile(
    cfg: GaussUltimateConfig,
    x: number,
    y: number,
    angle: number,
    playerId: string,
    playerColor: number,
    remainingRangePx?: number,
    gameplayMuzzleOrigin?: MuzzleOrigin,
  ): void {
    const lifetime = (cfg.range / cfg.projectileSpeed) * 1000;
    this.projectileManager.spawnProjectile(x, y, angle, playerId, {
      speed:             cfg.projectileSpeed,
      size:              cfg.projectileSize,
      damage:            cfg.damage,
      color:             cfg.projectileColor,
      ownerColor:        playerColor,
      projectileVisualScale: cfg.projectileVisualScale,
      lifetime,
      maxBounces:        0,
      isGrenade:         false,
      adrenalinGain:     0,
      sourceId:        cfg.id,
      gameplayMuzzleOrigin,
      projectileStyle:   cfg.projectileStyle ?? 'gauss',
      bulletVisualPreset: cfg.bulletVisualPreset,
      tracerConfig:      cfg.tracerConfig,
      rockDamageMult:    cfg.rockDamageMult,
      trainDamageMult:   cfg.trainDamageMult,
      baseDamageMult:    cfg.baseDamageMult,
      shotAudioKey:      cfg.shotAudio?.successKey,
      gaussChainRadius:  cfg.chainRadius,
      gaussChainDamageFactor: cfg.chainDamageFactor,
      remainingRangePx,
    });
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

  /** Gibt ausschließlich die Config der tatsächlich ausgerüsteten Utility zurück. */
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
    sourceId: string,
    x: number,
    y: number,
    source?: { dirX?: number; dirY?: number; projectileColor?: number; shotgunLightningGeneration?: number },
  ): void {
    const loadout = this.loadouts.get(killerId);
    if (!loadout) return;
    const negev = loadout.weapon2.config.id === 'NEGEV' ? loadout.weapon2.config : null;
    if (
      negev
      && sourceId === negev.id
      && (negev.negevKillstreak?.damageBonusPerKill ?? 0) > 0
    ) {
      const state = this.getOrCreateNegevState(killerId);
      state.kills += 1;
      const heal = negev.negevKillstreak?.healPerKill ?? 0;
      const armor = negev.negevKillstreak?.armorPerKill ?? 0;
      if (heal > 0) this.combatSystem?.heal(killerId, heal);
      if (armor > 0) this.combatSystem?.addArmor(killerId, armor);
    }
    const shotgun = loadout.weapon2.config.id === 'SHOTGUN' ? loadout.weapon2.config : null;
    if (shotgun) {
      if (sourceId === shotgun.id && (shotgun.shotgunLightningRadius ?? 0) > 0 && (shotgun.shotgunLightningDamage ?? 0) > 0) {
        this.shotgunLightningQueue.push({ ownerId: killerId, x, y, generation: 0 });
      } else if (
        sourceId === 'weapon.SHOTGUN.lightning'
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
      if (cfg.id !== sourceId) continue;
      if ((cfg.killHeal ?? 0) > 0) this.combatSystem?.heal(killerId, cfg.killHeal ?? 0);
      if ((cfg.killAdrenaline ?? 0) > 0) this.resourceSystem.addAdrenaline(killerId, cfg.killAdrenaline ?? 0);
      return;
    }
  }

  private getOrCreateNegevState(playerId: string): NegevCombatState {
    let state = this.negevStates.get(playerId);
    if (!state) {
      state = { kills: 0, lastShotAt: 0 };
      this.negevStates.set(playerId, state);
    }
    return state;
  }

  private finishNegevKillstreak(playerId: string, kills: number, now: number = Date.now()): void {
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
      this.combatSystem?.applyAoeDamage(player.x, player.y, radius, damage, playerId, false, {
        category: 'explosion',
        sourceId: 'weapon.NEGEV.killstreak',
        sourceSlot: 'weapon2',
      });
    }
    if (knockback > 0 && radius > 0) {
      this.physicsSystem?.applyRadialImpulse(player.x, player.y, radius, knockback, playerId, 0);
    }
    this.negevKillstreakExplosionHandler?.({
      ownerId: playerId,
      x: player.x,
      y: player.y,
      kills,
      radius,
      damage,
      nowMs: now,
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
        sourceId: 'weapon.SHOTGUN.lightning',
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

  private getAk47MaxStacks(focus: NonNullable<WeaponConfig['ak47Focus']>): number {
    // Firepower and fire control share one hard cap. Fire control does not add another +5.
    return focus.maxStacks > 0 || focus.fireControlEnabled > 0 ? 5 : 0;
  }

  private isAk47FireSuperiorityPhaseActive(state: Ak47CombatState | undefined): boolean {
    return !!state && (
      state.fireSuperiorityShotsAvailable > 0
      || state.pendingFireSuperiorityShotIds.size > 0
    );
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
      this.activateTeslaDomeWeapon(weapon, x, y, angle, playerId, now, playerColor);
      return this.okResult;
    }
    if (weapon.config.fire.type === 'energy_shield') {
      this.activateEnergyShieldWeapon(weapon, playerId, now, playerColor, params?.inputStarted === true);
      return this.okResult;
    }

    // 1. Cooldown-Check
    if (weapon.isOnCooldown(now)) return { ok: false, reason: 'cooldown' };

    const cfg = weapon.config;
    const ak47State = cfg.id === 'AK47' ? this.getOrCreateAk47State(playerId) : null;
    const ak47Focus = cfg.id === 'AK47' ? cfg.ak47Focus : null;
    const fireSuperiorityCanFire = (ak47State?.fireSuperiorityShotsAvailable ?? 0) > 0;

    // 2. Adrenalin-Check (nur wenn Kosten > 0, sonst Regen-Pause nicht unterbrechen)
    const effectiveAdrenalineCost = fireSuperiorityCanFire
      ? 0
      : this.resourceSystem.resolveAdrenalineCost(playerId, cfg.adrenalinCost);
    if (effectiveAdrenalineCost > 0) {
      if (this.resourceSystem.getAdrenaline(playerId) < effectiveAdrenalineCost) {
        // Zu wenig Adrenalin fuer den naechsten Schuss = Dauerfeuer vorbei.
        // Sofort beenden, damit nachtropfendes Adrenalin den Streak nicht am Leben haelt.
        if (cfg.id === 'NEGEV') {
          const streakKills = this.negevStates.get(playerId)?.kills ?? 0;
          if (streakKills > 0) this.finishNegevKillstreak(playerId, streakKills, now);
        }
        return { ok: false, reason: 'resource', resourceKind: 'adrenaline' };
      }
    }

    // 3. Spread-Parameter berechnen
    // Bewegungsstatus direkt vom Physics-Body lesen – der Host besitzt die Simulation,
    // daher ist velocity immer aktuell (kein Netzwerk-Lag wie bei getPlayerInput).
    const shooterBody = this.playerManager.getPlayer(playerId)?.body;
    const isMoving    = isVelocityMoving(shooterBody?.velocity.x ?? 0, shooterBody?.velocity.y ?? 0);
    const scopeProgress = params?.scopeProgress;
    const fireControlSpreadMultiplier = cfg.id === 'AK47' && ak47Focus && ak47Focus.fireControlEnabled > 0
      ? Math.max(0, 1 - ak47State!.stacks * ak47Focus.fireControlSpreadPerStack)
      : 1;

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
      const corridorActive = fullyCharged && cfg.awpCharge.corridorEnabled > 0;
      shotCfg = {
        ...shotCfg,
        damage: shotCfg.damage * (1 + chargeProgress * cfg.awpCharge.maxDamageBonus) * fullChargeMultiplier,
        // Voll aufgeladene Schuesse sind sofort erkennbar: groesser + rot, mit Schneise nochmals groesser.
        bulletVisualPreset: corridorActive
          ? 'awp_corridor'
          : fullyCharged ? 'awp_charged' : shotCfg.bulletVisualPreset,
        awpCharge: {
          ...cfg.awpCharge,
          fireTrailBurnDamagePerTick: cfg.awpCharge.fireTrailBurnDamagePerTick * fullChargeMultiplier,
          // Saemtliche Schneisen-Boni – inklusive der breiteren Feuerspur – gelten
          // ausschliesslich fuer voll aufgeladene Schuesse (Geduldiger Tod).
          corridorEnabled: corridorActive ? cfg.awpCharge.corridorEnabled : 0,
          corridorDamage: cfg.awpCharge.corridorDamage * fullChargeMultiplier,
          fireTrailHalfWidthCells: fullyCharged ? cfg.awpCharge.fireTrailHalfWidthCells : 0,
        },
      };
    }
    if (cfg.id === 'NEGEV') {
      const negevState = this.getOrCreateNegevState(playerId);
      negevState.lastShotAt = now;
      const kills = negevState.kills;
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
      const fireControlRangeMultiplier = cfg.ak47Focus.fireControlEnabled > 0
        ? Math.max(0, 1 + ak47State.stacks * cfg.ak47Focus.fireControlRangePerStack)
        : 1;
      const fireControlProjectileSpeedMultiplier = cfg.ak47Focus.fireControlEnabled > 0
        ? Math.max(0, 1 + ak47State.stacks * cfg.ak47Focus.fireControlProjectileSpeedPerStack)
        : 1;
      shotCfg = {
        ...shotCfg,
        range: shotCfg.range * fireControlRangeMultiplier,
        fire: shotCfg.fire.type === 'projectile'
          ? { ...shotCfg.fire, projectileSpeed: shotCfg.fire.projectileSpeed * fireControlProjectileSpeedMultiplier }
          : shotCfg.fire,
        penetrationCount: fireSuperiorityCanFire ? 1_000_000 : shotCfg.penetrationCount,
        penetrationDamageRetention: fireSuperiorityCanFire ? 1 : shotCfg.penetrationDamageRetention,
        penetratesRocks: fireSuperiorityCanFire && (shotCfg.rockDamageMult ?? 0) > 0 ? 1 : 0,
        ak47ShotId: ak47State.nextShotId++,
        ak47DamageMultiplier: focusDamageMultiplier,
        ak47FireSuperiorityShot: fireSuperiorityCanFire,
      };
    }
    // Kinetische Ladung: der Bonus wird in `shotCfg.damage` gebacken, **bevor** sich der Schuss in
    // Pellets aufteilt. Dadurch gilt er fuer die vollstaendige Salve statt je Projektil erneut,
    // greift ohne Sonderfall auch bei Hitscan-Waffen, und Sekundaerschaden erbt ihn nicht.
    // Verbraucht wird beim Feuern, nicht beim Treffen – ein verfehlter Schuss zaehlt ebenfalls.
    if (sourceSlot === 'weapon1') {
      const kineticBonus = this.itemRuntimeChargeConsumer?.(playerId) ?? 0;
      if (kineticBonus > 0) shotCfg = { ...shotCfg, damage: shotCfg.damage * (1 + kineticBonus) };
    }

    const shotPlan = resolveShotPlan({
      config: shotCfg,
      aimAngle: angle,
      dynamicSpread: weapon.getDynamicSpread(),
      isMoving,
      scopeProgress,
      fireControlSpreadMultiplier,
      random: Math.random,
    });

    let didFire = false;
    for (const shot of shotPlan.shots) {
      const fired = this.dispatchWeaponFire(
        shot.config,
        x,
        y,
        shot.angle,
        targetX,
        targetY,
        playerId,
        playerColor,
        sourceSlot,
        shotId,
        undefined,
        this.getGameplayMuzzleOrigin(playerId, shot.config.id, x, y, shot.angle),
      );
      if (fired) didFire = true;
    }
    if (!didFire) return { ok: false, reason: 'blocked' };

    if (fireSuperiorityCanFire && ak47State && shotCfg.ak47ShotId !== undefined) {
      ak47State.fireSuperiorityShotsAvailable = Math.max(0, ak47State.fireSuperiorityShotsAvailable - 1);
      ak47State.pendingFireSuperiorityShotIds.add(shotCfg.ak47ShotId);
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
        this.dispatchWeaponFire(
          sideCfg,
          x,
          y,
          angle - sideAngle,
          targetX,
          targetY,
          playerId,
          playerColor,
          sourceSlot,
          shotId,
          undefined,
          this.getGameplayMuzzleOrigin(playerId, sideCfg.id, x, y, angle - sideAngle),
        );
        this.dispatchWeaponFire(
          sideCfg,
          x,
          y,
          angle + sideAngle,
          targetX,
          targetY,
          playerId,
          playerColor,
          sourceSlot,
          shotId,
          undefined,
          this.getGameplayMuzzleOrigin(playerId, sideCfg.id, x, y, angle + sideAngle),
        );
      }
    }

    // 5. Ressourcen erst nach erfolgreichem Fire-Dispatch abbuchen.
    if (effectiveAdrenalineCost > 0) {
      this.resourceSystem.drainAdrenaline(playerId, cfg.adrenalinCost, now);
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
    temporaryInstance?: TemporaryUtilityRuntimeInstance | null,
  ): boolean {
    if (utility.isOnCooldown(now)) return false;
    if (temporaryInstance && (temporaryInstance.charges <= 0 || temporaryInstance.cooldownUntil > now)) return false;

    const cfg = utility.config;
    const gameplayMuzzleOrigin = this.getGameplayMuzzleOrigin(playerId, cfg.id, x, y, angle);
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
            gameplayMuzzleOrigin,
          );
        }
        break;

      case 'charged_gate':
        if ((params?.utilityChargeFraction ?? 0) < 1.0) return false; // nicht voll geladen → abbrechen
        if (cfg.type === 'bfg') {
          didUse = this.fireBfgUtility(cfg as BfgUtilityConfig, x, y, angle, playerId, gameplayMuzzleOrigin);
        }
        break;

      case 'targeted_click':
        if (cfg.type === 'nuke') {
          didUse = this.triggerNukeUtility(cfg as NukeUtilityConfig, playerId, targetX, targetY);
        }
        break;

      case 'placement_mode':
        if (cfg.type === 'placeable_rock' || cfg.type === 'placeable_turret' || cfg.type === 'placeable_pedestal') {
          didUse = this.placeableRockHandler?.(cfg as PlaceableUtilityConfig, playerId, x, y, targetX, targetY, now, playerColor, params) ?? false;
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
            taserCfg.id, playerColor,
            undefined,   // kein sourceSlot (Utility)
            taserCfg.rockDamageMult ?? 1,
            taserCfg.trainDamageMult ?? 1,
            taserCfg.visualPreset,
            taserCfg.shotAudio?.successKey,
            undefined,
            (taserCfg.chainCount ?? 0) > 0 ? { count: taserCfg.chainCount ?? 0, radius: taserCfg.chainRadius ?? 0, damageFactor: taserCfg.chainDamageFactor ?? 0 } : undefined,
            undefined,
            undefined,
            1,
            undefined,
            taserCfg.baseDamageMult ?? 1,
          ) ?? false;
        } else if (cfg.type === 'decoy') {
          didUse = this.decoySystem?.activate(cfg as DecoyUtilityConfig, playerId, angle, playerColor, now) ?? false;
        }
        break;
    }

    if (didUse) {
      this.utilityUsedCallback?.(playerId, cfg.type);
      this.utilityUsedObserver?.(playerId, cfg.type);

      if (temporaryInstance) {
        this.temporaryUtilities.recordSuccessfulUse(playerId, temporaryInstance.instanceId, now);
        this.publishTemporaryUtilities(playerId);
      } else if (!cfg.skipCooldownPublish) {
        utility.recordUse(now);
        this.bridge.publishUtilityCooldownUntil(playerId, now + cfg.cooldown, cfg.id);
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
    gameplayMuzzleOrigin?: MuzzleOrigin,
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
      sourceId:    cfg.id,
      gameplayMuzzleOrigin,
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
    gameplayMuzzleOrigin?: MuzzleOrigin,
  ): boolean {
    this.projectileManager.spawnProjectile(x, y, angle, playerId, {
      speed:            cfg.projectileSpeed,
      size:             cfg.projectileSize,
      damage:           cfg.directDamage,
      color:            COLORS.GREEN_2,
      allowTeamDamage:  cfg.allowTeamDamage,
      lifetime:         (cfg.range / cfg.projectileSpeed) * 1000,
      remainingRangePx: cfg.range,
      maxBounces:       0,
      isGrenade:        false,
      adrenalinGain:    0,
      sourceId:       cfg.id,
      gameplayMuzzleOrigin,
      projectileStyle:  'bfg',
      isBfg:            true,
      proximityPulse:   cfg.proximityPulse,
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
      cfg.baseDamageMult ?? 1,
      cfg.afterCloudDurationMs ?? 0,
      cfg.afterCloudRadiusFactor ?? 0,
      cfg.afterCloudDamageFactor ?? 0,
      cfg.visualVariant ?? 'stink',
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
        baseDamageMult:  cfg.baseDamageMult,
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
        baseDamageMult:  cfg.baseDamageMult,
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
    options?: WeaponFireOptions,
    gameplayMuzzleOrigin?: MuzzleOrigin,
  ): boolean {
    const visualMuzzleOrigin = this.getVisualMuzzleOrigin(playerId, config.id);
    switch (config.fire.type) {
      case 'projectile':
        return this.fireProjectileWeapon(config, config.fire, x, y, angle, targetX, targetY, playerId, playerColor, sourceSlot, options, visualMuzzleOrigin, gameplayMuzzleOrigin);

      case 'hitscan':
        return this.fireHitscanWeapon(config, config.fire, x, y, angle, targetX, targetY, playerId, playerColor, sourceSlot as WeaponSlot | undefined, shotId, visualMuzzleOrigin, gameplayMuzzleOrigin);

      case 'melee':
        return this.fireMeleeWeapon(config, config.fire, x, y, angle, playerId, playerColor, sourceSlot as WeaponSlot | undefined);

      case 'flamethrower':
        return this.fireFlamethrowerWeapon(config, config.fire, x, y, angle, playerId, playerColor, sourceSlot, options, visualMuzzleOrigin, gameplayMuzzleOrigin);

      case 'leaf_blower':
        return this.fireLeafBlowerWeapon(config, config.fire, x, y, angle, playerId, playerColor, sourceSlot, options, visualMuzzleOrigin, gameplayMuzzleOrigin);

      case 'reinforcement_matrix':
        return this.fireReinforcementMatrixWeapon(
          config,
          config.fire,
          x,
          y,
          angle,
          targetX,
          targetY,
          playerId,
          playerColor,
          sourceSlot,
          visualMuzzleOrigin,
        );

      case 'energy_injector':
        return this.fireEnergyInjectorWeapon(config, config.fire, x, y, angle, playerId, playerColor, sourceSlot, visualMuzzleOrigin, gameplayMuzzleOrigin);

      case 'tesla_dome':
      case 'healing_aura':
      case 'energy_shield':
        return false;

      default:
        return false;
    }
  }

  private getVisualMuzzleOrigin(playerId: string, itemId: string): MuzzleOrigin | undefined {
    const player = this.playerManager?.getPlayer(playerId);
    if (!player) return undefined;
    return getHeldWeaponMuzzleOrigin(
      itemId,
      player.x,
      player.y,
      player.rotation,
      player.displayObject?.displayWidth ?? PLAYER_SIZE,
    ) ?? undefined;
  }

  private getGameplayMuzzleOrigin(
    playerId: string,
    itemId: string,
    gameplayX: number,
    gameplayY: number,
    angle: number,
  ): MuzzleOrigin | undefined {
    const player = this.playerManager?.getPlayer(playerId);
    if (!player) return undefined;
    return getHeldWeaponGameplayMuzzleOrigin(
      itemId,
      gameplayX,
      gameplayY,
      angle,
      player.displayObject?.displayWidth ?? PLAYER_SIZE,
    ) ?? undefined;
  }

  /**
   * Feuert die Verstärkungsmatrix wie eine langsame Rakete bis zum Cursor oder zur
   * maximalen Reichweite. Die spezielle Explosionsnutzlast wird erst am Einschlag
   * vom HostUpdateCoordinator in ein Feld umgewandelt.
   */
  private fireReinforcementMatrixWeapon(
    config: WeaponConfig,
    fireConfig: ReinforcementMatrixWeaponFireConfig,
    x: number,
    y: number,
    fallbackAngle: number,
    targetX: number,
    targetY: number,
    playerId: string,
    playerColor: number,
    sourceSlot?: LoadoutSlot,
    visualMuzzleOrigin?: MuzzleOrigin,
  ): boolean {
    const dx = targetX - x;
    const dy = targetY - y;
    const cursorDistance = Math.hypot(dx, dy);
    const travelDistance = Math.min(config.range, cursorDistance);
    const angle = cursorDistance > 0.001 ? Math.atan2(dy, dx) : fallbackAngle;
    const lifetime = (travelDistance / fireConfig.projectileSpeed) * 1000;
    const resolvedGameplayMuzzleOrigin = this.getGameplayMuzzleOrigin(
      playerId,
      config.id,
      x,
      y,
      angle,
    );

    this.projectileManager.spawnProjectile(x, y, angle, playerId, {
      speed: fireConfig.projectileSpeed,
      size: fireConfig.projectileSize,
      damage: 0,
      color: config.projectileColor ?? fireConfig.fieldColor,
      ownerColor: playerColor,
      projectileVisualScale: config.projectileVisualScale,
      smokeTrailColor: config.rocketSmokeTrailColor ?? fireConfig.fieldColor,
      lifetime,
      remainingRangePx: travelDistance,
      maxBounces: 0,
      isGrenade: false,
      adrenalinGain: 0,
      sourceId: config.id,
      gameplayMuzzleOrigin: resolvedGameplayMuzzleOrigin,
      explosion: {
        radius: fireConfig.radius,
        maxDamage: 0,
        knockback: 0,
        selfDamageMult: 0,
        rockDamageMult: 0,
        trainDamageMult: 0,
        color: fireConfig.fieldColor,
        reinforcementMatrix: {
          durationMs: fireConfig.durationMs,
          damageReduction: fireConfig.damageReduction,
          vulnerabilityBonus: fireConfig.vulnerabilityBonus,
          color: fireConfig.fieldColor,
        },
      },
      projectileStyle: config.projectileStyle,
      sourceSlot: sourceSlot ?? 'weapon2',
      visualMuzzleOrigin,
      shotAudioKey: config.shotAudio?.successKey,
    });
    return true;
  }

  /**
   * Feuert einen Energiebolzen ohne Lenkwirkung. Der Host ordnet einen Treffer dem Ziel zu und
   * ermittelt die typisierte Konstruktionswirkung aus dessen Definition.
   */
  private fireEnergyInjectorWeapon(
    config: WeaponConfig,
    fireConfig: EnergyInjectorWeaponFireConfig,
    x: number,
    y: number,
    angle: number,
    playerId: string,
    playerColor: number,
    sourceSlot?: LoadoutSlot,
    visualMuzzleOrigin?: MuzzleOrigin,
    gameplayMuzzleOrigin?: MuzzleOrigin,
  ): boolean {
    this.projectileManager.spawnProjectile(x, y, angle, playerId, {
      speed: fireConfig.projectileSpeed,
      size: fireConfig.projectileSize,
      damage: 0,
      color: config.projectileColor ?? fireConfig.injectorColor,
      ownerColor: playerColor,
      projectileVisualScale: config.projectileVisualScale,
      lifetime: (config.range / fireConfig.projectileSpeed) * 1000,
      remainingRangePx: config.range,
      maxBounces: 0,
      isGrenade: false,
      adrenalinGain: 0,
      sourceId: config.id,
      rockDamageMult: 0,
      trainDamageMult: 0,
      energyInjectorPayload: {
        durationMs: fireConfig.durationMs,
        focusDurationMs: fireConfig.focusDurationMs,
        vulnerabilityBonus: fireConfig.vulnerabilityBonus,
        color: fireConfig.injectorColor,
      },
      projectileStyle: config.projectileStyle,
      energyBallVariant: config.energyBallVariant,
      sourceSlot: sourceSlot ?? 'weapon2',
      gameplayMuzzleOrigin,
      visualMuzzleOrigin,
      shotAudioKey: config.shotAudio?.successKey,
    });
    return true;
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
    aimAngle: number,
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
    this.teslaDomeSystem.hostRefresh(playerId, x, y, now, cfg, cfg.projectileColor ?? playerColor, aimAngle);
  }

  private activateEnergyShieldWeapon(
    weapon: BaseWeapon,
    playerId: string,
    now: number,
    playerColor: number,
    pressed: boolean,
  ): void {
    if (!this.energyShieldSystem) return;
    if (this.resourceSystem.getAdrenaline(playerId) <= 0) {
      this.energyShieldSystem.hostDeactivateForPlayer(playerId);
      return;
    }

    const cfg = weapon.config as WeaponConfig & { fire: EnergyShieldWeaponFireConfig };
    this.energyShieldSystem.hostRefresh(playerId, now, cfg, cfg.projectileColor ?? playerColor, pressed);
  }

  /**
   * Claims a weapon slot on the host before cooldown/resource resolution. A deliberate switch
   * must stop the previous non-autonomous channel immediately, even when the newly requested
   * weapon is currently on cooldown or lacks a resource.
   */
  private claimWeaponSlot(playerId: string, slot: WeaponSlot): void {
    const activeWeaponSlots = this.getActiveWeaponSlots();
    const previous = activeWeaponSlots.get(playerId);
    if (previous === slot) return;

    activeWeaponSlots.set(playerId, slot);
    this.deactivateNonAutonomousWeaponEffect(playerId, slot === 'weapon1' ? 'weapon2' : 'weapon1');
  }

  private getActiveWeaponSlots(): Map<string, WeaponSlot> {
    return this.activeWeaponSlots ??= new Map<string, WeaponSlot>();
  }

  /**
   * Ends the persistent effect owned by the other weapon slot. Explicit autonomous toggles are
   * not channels and therefore survive a weapon switch by design.
   */
  private deactivateNonAutonomousWeaponEffect(playerId: string, slot: WeaponSlot): void {
    const config = this.loadouts.get(playerId)?.[slot].config;
    if (!config || isAutonomousWeaponToggle(config)) return;

    if (config.fire.type === 'tesla_dome') {
      this.teslaDomeSystem?.hostDeactivateForPlayer(playerId);
    } else if (config.fire.type === 'energy_shield') {
      this.energyShieldSystem?.hostDeactivateForPlayer(playerId);
    }
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
    options?: WeaponFireOptions,
    visualMuzzleOrigin?: MuzzleOrigin,
    gameplayMuzzleOrigin?: MuzzleOrigin,
  ): boolean {
    void fireConfig;
    return (this.weaponExecution?.fire(config, {
      x, y, angle, targetX, targetY,
      ownerId: playerId,
      ownerColor: playerColor,
      sourceSlot,
      options,
      gameplayMuzzleOrigin,
      visualMuzzleOrigin,
      // Die gezahlten Adrenalinkosten kennt nur der Manager; der Executor fragt sie lediglich
      // für die Mini-Rakete ab und bleibt damit frei von Ressourcenverwaltung.
      resolvePaidAdrenalineCost: () => Math.min(
        this.resourceSystem.getAdrenaline(playerId),
        this.resourceSystem.resolveAdrenalineCost(playerId, config.adrenalinCost),
      ),
    }) ?? false);
  }

  private fireHitscanWeapon(
    config:      WeaponConfig,
    fireConfig:  import('./LoadoutConfig').HitscanWeaponFireConfig,
    x:           number,
    y:           number,
    angle:       number,
    targetX:     number,
    targetY:     number,
    playerId:    string,
    playerColor: number,
    sourceSlot:  WeaponSlot | undefined,
    shotId?:     number,
    visualMuzzleOrigin?: MuzzleOrigin,
    gameplayMuzzleOrigin?: MuzzleOrigin,
  ): boolean {
    void fireConfig;
    return (this.weaponExecution?.fire(config, {
      x, y, angle, targetX, targetY,
      ownerId: playerId,
      ownerColor: playerColor,
      sourceSlot,
      shotId,
      gameplayMuzzleOrigin,
      visualMuzzleOrigin,
    }) ?? false);
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
    void fireConfig;
    return (this.weaponExecution?.fire(config, {
      x, y, angle,
      targetX: x,
      targetY: y,
      ownerId: playerId,
      ownerColor: playerColor,
      sourceSlot,
    }) ?? false);
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
    options?: WeaponFireOptions,
    visualMuzzleOrigin?: MuzzleOrigin,
    gameplayMuzzleOrigin?: MuzzleOrigin,
  ): boolean {
    const fireball = fireConfig.fireball;
    if ((fireball?.enabled ?? 0) > 0) {
      const groundEffect = {
        durationMs: fireball?.groundDurationMs ?? 2000,
        burnDurationMs: fireConfig.burnDurationMs,
        burnDamagePerTick: fireball?.groundBurnDamagePerTick ?? 0.5,
                sourceId: 'weapon.fireball_fire',
        baseDamageMult: config.baseDamageMult ?? 1,
      };
      const chunkCount = Math.max(0, Math.floor(fireball?.chunkCount ?? 0));
      this.projectileManager.spawnProjectile(x, y, angle, playerId, {
        speed: fireball?.projectileSpeed ?? 450,
        ignoreBaseCollisions: options?.ignoreBaseCollisions,
        ignoreRockIndex: options?.ignoreRockIndex,
        size: fireball?.projectileSize ?? 28,
        damage: config.damage,
        color: 0xff7417,
        ownerColor: playerColor,
        lifetime: config.range / Math.max(1, fireball?.projectileSpeed ?? 450) * 1000,
        maxBounces: 0,
        isGrenade: false,
        adrenalinGain: config.adrenalinGain,
                sourceId: 'weapon.fireball_launcher',
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
          baseDamageMult: config.baseDamageMult ?? 1,
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
        sourceTurretId: options?.sourceTurretId,
        gameplayMuzzleOrigin,
        visualMuzzleOrigin,
        shotAudioKey: config.shotAudio?.successKey,
      });
      return true;
    }

    const lifetime = this.calculateDecayLifetime(config.range, fireConfig.projectileSpeed, fireConfig.velocityDecay);

    this.projectileManager.spawnProjectile(x, y, angle, playerId, {
      speed:           fireConfig.projectileSpeed,
      ignoreBaseCollisions: options?.ignoreBaseCollisions,
      ignoreRockIndex: options?.ignoreRockIndex,
      size:            fireConfig.hitboxStartSize,
      damage:          config.damage,
      color:           config.projectileColor ?? playerColor,
      lifetime,
      maxBounces:      999999,  // Flammen sterben nicht durch Bounces, sondern durch Lifetime/Kollision
      isGrenade:       false,
      adrenalinGain:   config.adrenalinGain,
      sourceId:      config.id,
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
      projectileBurnVisualStyle: config.projectileBurnVisualStyle,
      flamePiercing:     (fireConfig.piercingCount ?? 0) > 0,
      sourceSlot,
      sourceTurretId:    options?.sourceTurretId,
      gameplayMuzzleOrigin,
      visualMuzzleOrigin,
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
    options?: WeaponFireOptions,
    visualMuzzleOrigin?: MuzzleOrigin,
    gameplayMuzzleOrigin?: MuzzleOrigin,
  ): boolean {
    const lifetime = this.calculateDecayLifetime(config.range, fireConfig.projectileSpeed, fireConfig.velocityDecay);
    // Der Debuff-Wurf faellt pro Luftstoss: ein Stoss verbraucht sich am ersten Ziel, damit
    // entspricht der Schuss-Wurf genau der beworbenen Trefferchance.
    const debuffHit = (config.hitDebuffChance ?? 0) > 0 && Math.random() < (config.hitDebuffChance ?? 0);

    this.projectileManager.spawnProjectile(x, y, angle, playerId, {
      speed:           fireConfig.projectileSpeed,
      ignoreBaseCollisions: options?.ignoreBaseCollisions,
      ignoreRockIndex: options?.ignoreRockIndex,
      size:            fireConfig.hitboxStartSize,
      damage:          config.directDamageOverride ?? config.damage,
      color:           config.projectileColor ?? playerColor,
      ownerColor:      playerColor,
      lifetime,
      maxBounces:      999999,
      isGrenade:       false,
      adrenalinGain:   config.adrenalinGain,
      sourceId:      config.id,
      projectileStyle: 'leaf_blower',
      rockDamageMult:  config.rockDamageMult,
      trainDamageMult: config.trainDamageMult,
      hitboxGrowRate:  fireConfig.hitboxGrowRate,
      hitboxMaxSize:   fireConfig.hitboxEndSize,
      velocityDecay:   fireConfig.velocityDecay,
      leafBlowerMinKnockback: fireConfig.minKnockback,
      leafBlowerMaxKnockback: fireConfig.maxKnockback,
      leafBlowerSelfPush: fireConfig.selfPush,
      leafBlowerDeflectsProjectiles: fireConfig.deflectProjectiles > 0,
      hitSlowFraction:   debuffHit ? config.hitSlowFraction : undefined,
      hitSlowDurationMs: debuffHit ? config.hitSlowDurationMs : undefined,
      hitVulnerabilityDurationMs: debuffHit ? config.hitVulnerabilityDurationMs : undefined,
      sourceSlot,
      sourceTurretId:    options?.sourceTurretId,
      gameplayMuzzleOrigin,
      visualMuzzleOrigin,
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

function isAutonomousWeaponToggle(config: WeaponConfig): boolean {
  return config.fire.type === 'energy_shield'
    && config.fire.domeEnabled > 0
    && config.fire.domeToggleEnabled > 0;
}
