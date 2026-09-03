import * as Phaser from 'phaser';
import type { PlayerManager }     from '../entities/PlayerManager';
import type { ProjectileManager } from '../entities/ProjectileManager';
import type { ResourceSystem }    from '../systems/ResourceSystem';
import type { NetworkBridge }     from '../network/NetworkBridge';
import type { EnergyShieldSystem } from '../systems/EnergyShieldSystem';
import type { ShieldBuffSystem }   from '../systems/ShieldBuffSystem';
import type { TeslaDomeSystem }   from '../systems/TeslaDomeSystem';
import type { LoadoutSlot, LoadoutUseParams, LoadoutUseResult, PlayerAimNetState, ShieldBuffHudState, WeaponSlot } from '../types';
import type {
  EnergyShieldWeaponFireConfig,
  MeleeWeaponFireConfig,
  ProjectileWeaponFireConfig,
  TeslaDomeWeaponFireConfig,
  UltimateConfig,
  UtilityConfig,
  WeaponConfig,
} from './LoadoutConfig';
import { applyCoopDefenseModifiersToUtilityConfig } from './CoopDefenseLoadoutModifiers';
import { COLORS, PLAYER_SIZE, type MuzzleOrigin } from '../config';
import { areLoadoutConfigsEquivalent, sanitizeLoadoutSelectionForMode } from './LoadoutRules';
import { isVelocityMoving } from './SpreadMath';
import { resolveShotPlan } from './ShotPlanResolver';
import type {
  SpecializedWeaponExecutionCapability,
  WeaponExecutionCapability,
  WeaponFireOptions,
} from './WeaponFireExecutor';
import type { Ak47BehaviorPort } from './Ak47BehaviorPort';
import type { NegevBehaviorPort } from './NegevBehaviorPort';
import { getHeldWeaponGameplayMuzzleOrigin, getHeldWeaponMuzzleOrigin } from './HeldItemVisuals';

export interface LoadoutSelection {
  weapon1?:  WeaponConfig;
  weapon2?:  WeaponConfig;
  utility?:  UtilityConfig;
  ultimate?: UltimateConfig;
}

import { HeldItemSlotTracker, type HeldItemSlot } from './HeldItemSlotTracker';
import { GenericWeapon }   from './GenericWeapon';
import { GenericUltimate } from './GenericUltimate';
import { EnergyShieldWeapon } from './EnergyShieldWeapon';
import { TeslaDomeWeapon } from './TeslaDomeWeapon';
import type { BaseWeapon }   from './BaseWeapon';
import type { BaseUltimate } from './BaseUltimate';

interface PlayerLoadout {
  weapon1:  BaseWeapon;
  weapon2:  BaseWeapon;
  utility:  UtilityConfig;
  ultimate: BaseUltimate;
}

/** Read-only dynamic modifiers supplied by the World-owned sustained Ultimate behavior. */
export interface UltimateModifierReadPort {
  getSpeedMultiplier(playerId: string, nowMs: number): number;
  getDamageMultiplier(playerId: string, nowMs: number): number;
}

type PhysicsSystemType  = {
  addRecoil(id: string, vx: number, vy: number, durationMs?: number): void;
  applyRadialImpulse(x: number, y: number, radius: number, force: number, ownerId?: string, selfMultiplier?: number, durationMs?: number): void;
};

/**
 * LoadoutManager – Host-autoritär.
 * Verwaltet pro Spieler 4 Slots (weapon1, weapon2, utility, ultimate),
 * prüft Cooldowns/Adrenalin, dispatcht Aktionen und tracked Spread-Bloom.
 */
export class LoadoutManager {
  private loadouts          = new Map<string, PlayerLoadout>();
  private aimNetStates      = new Map<string, PlayerAimNetState>();
  private physicsSystem:      PhysicsSystemType | null = null;
  private teslaDomeSystem:    TeslaDomeSystem | null = null;
  private energyShieldSystem: EnergyShieldSystem | null = null;
  private shieldBuffSystem:   ShieldBuffSystem | null = null;
  private ultimateModifierReadPort: UltimateModifierReadPort | null = null;
  private utilityConfigModifierSource: ((playerId: string) => { additive: Readonly<Record<string, number>>; percentage: Readonly<Record<string, number>> } | null) | null = null;
  /**
   * Verbraucht eine gespeicherte kinetische Ladung und liefert den Schadensbonus als Anteil.
   * Injiziert statt direkt referenziert, weil das Item-Laufzeitsystem Round-Lifetime hat.
   */
  private itemRuntimeChargeConsumer: ((playerId: string) => number) | null = null;
  private itemRuntimeWeaponFiredHandler: ((playerId: string, sourceSlot: WeaponSlot) => void) | null = null;
  private shotCounters = new Map<string, number>();
  private ak47Behavior: Ak47BehaviorPort | null = null;
  private negevBehavior: NegevBehaviorPort | null = null;
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
  private specializedWeaponExecution: SpecializedWeaponExecutionCapability | null = null;

  setWeaponExecutionCapability(capability: WeaponExecutionCapability | null): void {
    this.weaponExecution = capability;
  }

  setSpecializedWeaponExecutionCapability(capability: SpecializedWeaponExecutionCapability | null): void {
    this.specializedWeaponExecution = capability;
  }

  // Held-Fire-Tracking: Feuerknopf gilt als gehalten wenn innerhalb HOLD_EXPIRE_MS gefeuert wurde
  private heldFireSlots = new Map<string, { slot: WeaponSlot; lastAt: number; angle: number }>();
  private static readonly HOLD_EXPIRE_MS = 100;
  private readonly okResult: LoadoutUseResult = { ok: true };

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
      utility:  utCfg,
      ultimate: new GenericUltimate(ultCfg),
    });
    this.teslaDomeSystem?.hostDeactivateForPlayer(playerId);
    this.energyShieldSystem?.hostDeactivateForPlayer(playerId);
    this.getActiveWeaponSlots().set(playerId, 'weapon1');
    this.shieldBuffSystem?.resetPlayer(playerId);
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
  syncSelectedLoadout(playerId: string, selection?: LoadoutSelection): boolean {
    const sanitized = sanitizeLoadoutSelectionForMode(selection, this.bridge.getGameMode());
    const nextWeapon1 = sanitized.weapon1;
    const nextWeapon2 = sanitized.weapon2;
    const nextUtility = sanitized.utility;
    const nextUltimate = sanitized.ultimate;
    const current = this.loadouts.get(playerId);
    const currentUltimate = current?.ultimate.config;

    if (
      current
      && areLoadoutConfigsEquivalent(current.weapon1.config, nextWeapon1)
      && areLoadoutConfigsEquivalent(current.weapon2.config, nextWeapon2)
      && areLoadoutConfigsEquivalent(current.utility, nextUtility)
      && areLoadoutConfigsEquivalent(currentUltimate, nextUltimate)
    ) {
      return false;
    }

    this.assignDefaultLoadout(playerId, selection);
    return true;
  }

  removePlayer(playerId: string): void {
    this.loadouts.delete(playerId);
    this.aimNetStates.delete(playerId);
    this.heldFireSlots.delete(playerId);
    this.activeWeaponSlots?.delete(playerId);
    this.teslaDomeSystem?.hostDeactivateForPlayer(playerId);
    this.energyShieldSystem?.hostDeactivateForPlayer(playerId);
    this.shieldBuffSystem?.removePlayer(playerId);
    this.heldItemSlots.removePlayer(playerId);
  }

  setAk47Behavior(behavior: Ak47BehaviorPort | null): void {
    this.ak47Behavior = behavior;
  }

  setNegevBehavior(behavior: NegevBehaviorPort | null): void {
    this.negevBehavior = behavior;
  }

  /** Injiziert das HostPhysicsSystem für Rückstoß-Impulse. */
  setPhysicsSystem(ps: PhysicsSystemType | null): void {
    this.physicsSystem = ps;
  }

  setUltimateModifierReadPort(port: UltimateModifierReadPort | null): void {
    this.ultimateModifierReadPort = port;
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
   * Bewusst ohne Zeitstempel: der semantische Action-Owner leitet die Meldung nach erfolgreichem
   * Dispatch weiter; das Zeitfenster des Laufzeitsystems läuft gegen die Host-Uhr.
   */
  setItemRuntimeWeaponFiredHandler(handler: ((playerId: string, sourceSlot: WeaponSlot) => void) | null): void {
    this.itemRuntimeWeaponFiredHandler = handler;
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

  // ── Frame-Update (Spread-Decay, Rage-Drain, Ultimate-Ablauf) ─────────────

  update(delta: number, nowMs?: number): void {
    const now = nowMs ?? Date.now();

    // Spread-Decay für alle ausgerüsteten Waffen
    for (const loadout of this.loadouts.values()) {
      loadout.weapon1.decaySpread(delta, now);
      loadout.weapon2.decaySpread(delta, now);
    }

    this.negevBehavior?.update(now);
  }

  // ── Multiplier-Getter ─────────────────────────────────────────────────────

  getSpeedMultiplier(playerId: string, now: number = Date.now()): number {
    const ultimateMult = this.ultimateModifierReadPort?.getSpeedMultiplier(playerId, now) ?? 1;

    // Energie-Schild/Kuppel verlangsamt, solange er aktiv ist – auch im Toggle-Modus ohne Halten.
    if (this.energyShieldSystem?.isActive(playerId)) {
      const shieldCfg = this.loadouts.get(playerId)?.weapon2.config;
      if (shieldCfg?.fire.type === 'energy_shield') {
        return ultimateMult * (shieldCfg.fire as EnergyShieldWeaponFireConfig).movementSlowFactor;
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
        return ultimateMult * holdFactor;
      }
      if (cfg?.fire.type === 'energy_shield') {
        const fireCfg = cfg.fire as EnergyShieldWeaponFireConfig;
        const holdFactor = this.energyShieldSystem?.isActive(playerId) ? fireCfg.movementSlowFactor : 1;
        return ultimateMult * holdFactor;
      }
      const holdFactor = cfg?.holdSpeedFactor ?? 1;
      return ultimateMult * holdFactor;
    }

    return ultimateMult;
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
    return this.ultimateModifierReadPort?.getDamageMultiplier(playerId, now) ?? 1;
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

  getEquippedUltimateConfig(playerId: string): UltimateConfig | undefined {
    return this.loadouts.get(playerId)?.ultimate.config;
  }

  getUltimateRequiredRage(playerId: string): number {
    return this.loadouts.get(playerId)?.ultimate.config.rageRequired ?? this.resourceSystem.getMaxRage(playerId);
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

  // ── Waffen-Getter (für AimSystem) ────────────────────────────────────────

  /**
   * Claims a host weapon action before readiness/resource resolution. The PlayerActionRuntime owns
   * the semantic action boundary; this method keeps the existing slot/channel mutation in the
   * loadout owner so there is still exactly one writer for it.
   */
  claimWeaponAction(playerId: string, slot: WeaponSlot, now: number, angle: number): void {
    this.claimWeaponSlot(playerId, slot);
    this.heldFireSlots.set(playerId, { slot, lastAt: now, angle });
  }

  /**
   * Activates the equipped weapon after the PlayerActionRuntime has resolved actor, slot and
   * position. Weapon readiness, resource checks, capability dispatch and weapon commit ordering
   * remain in the existing ability-specific activation implementation.
   */
  activateWeapon(
    playerId: string,
    slot: WeaponSlot,
    x: number,
    y: number,
    angle: number,
    targetX: number,
    targetY: number,
    now: number,
    shotId?: number,
    params?: LoadoutUseParams,
  ): LoadoutUseResult {
    const loadout = this.loadouts.get(playerId);
    const player = this.playerManager.getPlayer(playerId);
    if (!loadout || !player) return { ok: false, reason: 'invalid' };
    return this.fireWeapon(
      loadout[slot],
      x,
      y,
      angle,
      targetX,
      targetY,
      playerId,
      now,
      player.color,
      slot,
      shotId,
      params,
    );
  }

  /** Applies post-dispatch weapon observations owned by the equipped loadout. */
  completeWeaponAction(playerId: string, slot: WeaponSlot, now: number): void {
    if (slot === 'weapon2') this.itemRuntimeWeaponFiredHandler?.(playerId, slot);
    this.heldItemSlots.noteWeaponUsed(playerId, slot, now);
  }

  /** Visual held-item state is kept with the equipped loadout, not utility execution. */
  noteUtilityUsed(playerId: string, now: number): void {
    this.heldItemSlots.noteUtilityUsed(playerId, now);
  }

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
    return this.loadouts.get(playerId)?.utility;
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
    if (!loadout || slot === 'ultimate' || slot === 'utility') return 0;
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
    const fireSuperiorityCanFire = cfg.id === 'AK47'
      && (this.ak47Behavior?.isFireSuperiorityAvailable(playerId) ?? false);

    // 2. Adrenalin-Check (nur wenn Kosten > 0, sonst Regen-Pause nicht unterbrechen)
    const effectiveAdrenalineCost = fireSuperiorityCanFire
      ? 0
      : this.resourceSystem.resolveAdrenalineCost(playerId, cfg.adrenalinCost);
    if (effectiveAdrenalineCost > 0) {
      if (this.resourceSystem.getAdrenaline(playerId) < effectiveAdrenalineCost) {
        // Zu wenig Adrenalin fuer den naechsten Schuss = Dauerfeuer vorbei.
        // Sofort beenden, damit nachtropfendes Adrenalin den Streak nicht am Leben haelt.
        if (cfg.id === 'NEGEV') {
          this.negevBehavior?.terminateStreak(playerId, now);
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
    const negevShot = cfg.id === 'NEGEV'
      ? this.negevBehavior?.prepareShot(playerId, shotCfg) ?? null
      : null;
    if (negevShot) shotCfg = negevShot.shotConfig;
    const ak47Shot = cfg.id === 'AK47'
      ? this.ak47Behavior?.prepareShot(playerId, shotCfg) ?? null
      : null;
    if (ak47Shot) shotCfg = ak47Shot.shotConfig;
    const fireControlSpreadMultiplier = ak47Shot?.fireControlSpreadMultiplier ?? 1;
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

    if (negevShot) this.negevBehavior?.commitShot(playerId, now);

    if (ak47Shot) {
      this.ak47Behavior?.commitShot(playerId, ak47Shot.shotId, ak47Shot.fireSuperiorityShot);
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
      case 'leaf_blower':
      case 'reinforcement_matrix':
      case 'energy_injector':
        return (this.specializedWeaponExecution?.fire(config, {
          x,
          y,
          angle,
          targetX,
          targetY,
          ownerId: playerId,
          ownerColor: playerColor,
          sourceSlot,
          options,
          visualMuzzleOrigin,
          gameplayMuzzleOrigin: config.fire.type === 'reinforcement_matrix'
            ? this.getGameplayMuzzleOrigin(
              playerId,
              config.id,
              x,
              y,
              resolveReinforcementAimAngle(x, y, angle, targetX, targetY),
            )
            : gameplayMuzzleOrigin,
        }) ?? false);

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

function resolveReinforcementAimAngle(
  x: number,
  y: number,
  fallbackAngle: number,
  targetX: number,
  targetY: number,
): number {
  const dx = targetX - x;
  const dy = targetY - y;
  return Math.hypot(dx, dy) > 0.001 ? Math.atan2(dy, dx) : fallbackAngle;
}
