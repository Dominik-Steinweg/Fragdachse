import type { ResourceSystem }    from '../systems/ResourceSystem';
import type { ShieldBuffSystem }   from '../systems/ShieldBuffSystem';
import type { GameMode, LoadoutSlot, PlayerAimNetState, ShieldBuffHudState, WeaponSlot } from '../types';
import type {
  EnergyShieldWeaponFireConfig,
  TeslaDomeWeaponFireConfig,
  UltimateConfig,
  UtilityConfig,
  WeaponConfig,
} from './LoadoutConfig';
import { applyCoopDefenseModifiersToUtilityConfig } from './CoopDefenseLoadoutModifiers';
import { areLoadoutConfigsEquivalent, sanitizeLoadoutSelectionForMode } from './LoadoutRules';
import type { SustainedWeaponBehaviorPort } from './SustainedWeaponBehaviorPort';

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

/** Minimal mode context needed to sanitize a selected equipment set. */
export interface LoadoutSelectionModePort {
  getGameMode(): GameMode;
}

/**
 * LoadoutManager – Host-autoritär.
 * Verwaltet pro Spieler 4 Slots (weapon1, weapon2, utility, ultimate),
 * löst die effektiven Slot-Konfigurationen auf und tracked item-lokale Readiness/Spread-Zustände.
 */
export class LoadoutManager {
  private loadouts          = new Map<string, PlayerLoadout>();
  private aimNetStates      = new Map<string, PlayerAimNetState>();
  private shieldBuffSystem:   ShieldBuffSystem | null = null;
  private sustainedWeaponBehavior: SustainedWeaponBehaviorPort | null = null;
  private ultimateModifierReadPort: UltimateModifierReadPort | null = null;
  private utilityConfigModifierSource: ((playerId: string) => { additive: Readonly<Record<string, number>>; percentage: Readonly<Record<string, number>> } | null) | null = null;
  /** Welches Item die Figur gerade in den Pfoten haelt – rein visuell, aber host-autoritativ. */
  private readonly heldItemSlots = new HeldItemSlotTracker();

  // Held-Fire-Tracking: Feuerknopf gilt als gehalten wenn innerhalb HOLD_EXPIRE_MS gefeuert wurde
  private heldFireSlots = new Map<string, { slot: WeaponSlot; lastAt: number; angle: number }>();
  private static readonly HOLD_EXPIRE_MS = 100;

  constructor(
    private resourceSystem:    ResourceSystem,
    private selectionMode:    LoadoutSelectionModePort,
  ) {}

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  assignDefaultLoadout(playerId: string, selection?: LoadoutSelection): void {
    const sanitized = sanitizeLoadoutSelectionForMode(selection, this.selectionMode.getGameMode());
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
    const sanitized = sanitizeLoadoutSelectionForMode(selection, this.selectionMode.getGameMode());
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
    this.shieldBuffSystem?.removePlayer(playerId);
    this.heldItemSlots.removePlayer(playerId);
  }

  setUltimateModifierReadPort(port: UltimateModifierReadPort | null): void {
    this.ultimateModifierReadPort = port;
  }

  setUtilityConfigModifierSource(source: ((playerId: string) => { additive: Readonly<Record<string, number>>; percentage: Readonly<Record<string, number>> } | null) | null): void {
    this.utilityConfigModifierSource = source;
  }

  /** Injects the concrete two-weapon behavior without making Loadout the lifecycle owner. */
  setSustainedWeaponBehavior(behavior: SustainedWeaponBehaviorPort | null): void {
    this.sustainedWeaponBehavior = behavior;
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

  }

  // ── Multiplier-Getter ─────────────────────────────────────────────────────

  getSpeedMultiplier(playerId: string, now: number = Date.now()): number {
    const ultimateMult = this.ultimateModifierReadPort?.getSpeedMultiplier(playerId, now) ?? 1;

    const sustainedFactor = this.sustainedWeaponBehavior?.getMovementSlowFactor(playerId, now) ?? null;
    if (sustainedFactor !== null) return ultimateMult * sustainedFactor;

    // holdSpeedFactor: Verlangsamung wenn Feuerknopf gehalten wird
    const held = this.heldFireSlots.get(playerId);
    if (held && now - held.lastAt < LoadoutManager.HOLD_EXPIRE_MS) {
      const cfg = this.loadouts.get(playerId)?.[held.slot].config;
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

  /** Records generic held-fire input; sustained slot/channel state belongs to its behavior owner. */
  noteWeaponAction(playerId: string, slot: WeaponSlot, now: number, angle: number): void {
    this.heldFireSlots.set(playerId, { slot, lastAt: now, angle });
  }

  /** Readiness read consumed by the World-owned immediate weapon activation boundary. */
  isWeaponOnCooldown(playerId: string, slot: WeaponSlot, now: number): boolean {
    return this.loadouts.get(playerId)?.[slot].isOnCooldown(now) ?? true;
  }

  /** Item-local spread mutation committed after a successful weapon dispatch. */
  addWeaponSpread(playerId: string, slot: WeaponSlot): void {
    this.loadouts.get(playerId)?.[slot].addSpread();
  }

  /** Item-local cooldown mutation committed after a successful weapon dispatch. */
  recordWeaponUse(playerId: string, slot: WeaponSlot, now: number): void {
    this.loadouts.get(playerId)?.[slot].recordUse(now);
  }

  /** Records the equipped item that was actually used for held-item projection. */
  noteWeaponUsed(playerId: string, slot: WeaponSlot, now: number): void {
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

  private createWeapon(config: WeaponConfig): BaseWeapon {
    if (config.fire.type === 'tesla_dome') {
      return new TeslaDomeWeapon(config as WeaponConfig & { fire: TeslaDomeWeaponFireConfig });
    }
    if (config.fire.type === 'energy_shield') {
      return new EnergyShieldWeapon(config as WeaponConfig & { fire: EnergyShieldWeaponFireConfig });
    }
    return new GenericWeapon(config);
  }

  private getEquippedEnergyShieldFireConfig(playerId: string): EnergyShieldWeaponFireConfig | null {
    const weapon = this.loadouts.get(playerId)?.weapon2.config;
    if (!weapon || weapon.fire.type !== 'energy_shield') return null;
    return weapon.fire as EnergyShieldWeaponFireConfig;
  }
}
