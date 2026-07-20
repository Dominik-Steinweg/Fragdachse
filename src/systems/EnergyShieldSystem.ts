import * as Phaser from 'phaser';
import type { PlayerManager } from '../entities/PlayerManager';
import type { NetworkBridge } from '../network/NetworkBridge';
import type { EnergyShieldWeaponFireConfig, WeaponConfig } from '../loadout/LoadoutConfig';
import type { ShieldBlockCategory, SyncedEnergyShield } from '../types';
import { dequantizeAngle } from '../utils/angle';
import type { ResourceSystem } from './ResourceSystem';
import type { ShieldBuffSystem } from './ShieldBuffSystem';
import type { CombatSystem } from './CombatSystem';
import type { EnemyManager } from '../entities/EnemyManager';
import type { BaseManager } from '../entities/BaseManager';

interface ActiveEnergyShield {
  ownerId: string;
  color: number;
  config: WeaponConfig & { fire: EnergyShieldWeaponFireConfig };
  lastRefreshAt: number;
  lastDrainAt: number;
  lastHealAt: number;
  flashUntil: number;
  toggleActive: boolean; // true = per Toggle aktiviert (kein HOLD_GRACE-Ablauf)
}

interface ShieldBlockAttempt {
  targetId: string;
  category: ShieldBlockCategory;
  damage: number;
  sourceX: number;
  sourceY: number;
  now: number;
}

/** Kompakte Beschreibung einer aktiven Reflex-Kuppel für den Projektil-Barriere-Pass. */
export interface ReflectDomeInfo {
  ownerId: string;
  x: number;
  y: number;
  radius: number;
  color: number;
  reflect: boolean; // true = abprallen (d2), false = absorbieren (a1)
}

export class EnergyShieldSystem {
  private readonly activeShields = new Map<string, ActiveEnergyShield>();
  /** Persistenter Toggle-Zustand je Spieler (überlebt das Entfernen des Shield-Eintrags). */
  private readonly domeToggleOn = new Map<string, boolean>();
  private static readonly HOLD_GRACE_MS = 150;

  private combatSystem: CombatSystem | null = null;
  private enemyManager: EnemyManager | null = null;
  private baseManager: BaseManager | null = null;
  /** true, wenn Waffe 2 aktuell nicht nutzbar ist (Tod, Einbuddeln, Dodge-Phase-1 …). */
  private weaponUsageBlockedChecker: ((playerId: string) => boolean) | null = null;

  constructor(
    private readonly playerManager: PlayerManager,
    private readonly resourceSystem: ResourceSystem,
    private readonly bridge: NetworkBridge,
    private readonly shieldBuffSystem: ShieldBuffSystem,
  ) {}

  setCombatSystem(system: CombatSystem | null): void { this.combatSystem = system; }
  setEnemyManager(manager: EnemyManager | null): void { this.enemyManager = manager; }
  setBaseManager(manager: BaseManager | null): void { this.baseManager = manager; }
  setWeaponUsageBlockedChecker(checker: ((playerId: string) => boolean) | null): void {
    this.weaponUsageBlockedChecker = checker;
  }

  hostRefresh(
    ownerId: string,
    now: number,
    config: WeaponConfig & { fire: EnergyShieldWeaponFireConfig },
    color: number,
    pressed = false,
  ): void {
    const isDome = config.fire.domeEnabled > 0;
    const isToggle = isDome && config.fire.domeToggleEnabled > 0;

    if (isToggle) {
      if (pressed) {
        const turnOn = !this.domeToggleOn.get(ownerId);
        this.domeToggleOn.set(ownerId, turnOn);
        if (turnOn) {
          this.upsertShield(ownerId, now, config, color, true);
        } else {
          this.activeShields.delete(ownerId);
        }
      } else if (this.domeToggleOn.get(ownerId)) {
        // Gehalten ohne neue Flanke: aktive Toggle-Kuppel am Leben halten / Config aktualisieren.
        this.upsertShield(ownerId, now, config, color, true);
      }
      return;
    }

    // Halte-Modus (gerichteter Schild oder Kuppel ohne Autonomie-Upgrade).
    this.domeToggleOn.delete(ownerId);
    this.upsertShield(ownerId, now, config, color, false);
  }

  private upsertShield(
    ownerId: string,
    now: number,
    config: WeaponConfig & { fire: EnergyShieldWeaponFireConfig },
    color: number,
    toggleActive: boolean,
  ): void {
    const existing = this.activeShields.get(ownerId);
    if (existing) {
      existing.lastRefreshAt = now;
      existing.config = config;
      existing.color = color;
      existing.toggleActive = toggleActive;
      return;
    }
    this.activeShields.set(ownerId, {
      ownerId,
      color,
      config,
      lastRefreshAt: now,
      lastDrainAt: now,
      lastHealAt: now,
      flashUntil: 0,
      toggleActive,
    });
  }

  hostDeactivateForPlayer(playerId: string): void {
    this.activeShields.delete(playerId);
    this.domeToggleOn.delete(playerId);
  }

  /** Schaltet die Kuppel erzwungen ab und verhindert Auto-Resume bis zum nächsten Tastendruck. */
  private forceOff(playerId: string): void {
    this.activeShields.delete(playerId);
    this.domeToggleOn.set(playerId, false);
  }

  isActive(playerId: string): boolean {
    return this.activeShields.has(playerId);
  }

  isDomeActive(playerId: string): boolean {
    const shield = this.activeShields.get(playerId);
    return !!shield && shield.config.fire.domeEnabled > 0;
  }

  getEquippedFireConfig(playerId: string): EnergyShieldWeaponFireConfig | null {
    return this.activeShields.get(playerId)?.config.fire ?? null;
  }

  getReflectionDamageFactor(playerId: string): number {
    return this.activeShields.get(playerId)?.config.fire.reflectionDamageFactor ?? 0;
  }

  /**
   * Gerichteter Block des Basis-Schilds (Nicht-Kuppel). Prüft den eigenen Schild des Ziels
   * anhand des Blockbogens in Blickrichtung. Für Kuppeln inaktiv – dort greift {@link tryDomeProtect}.
   */
  tryBlockDamage(attempt: ShieldBlockAttempt): boolean {
    const shield = this.activeShields.get(attempt.targetId);
    if (!shield) return false;
    if (shield.config.fire.domeEnabled > 0) return false; // Kuppel: zentrale Positionsprüfung übernimmt
    if (!shield.config.fire.blockableCategories.includes(attempt.category)) return false;

    const player = this.playerManager.getPlayer(attempt.targetId);
    if (!player?.sprite.active) return false;

    const aimAngle = this.getAimAngle(attempt.targetId, player.sprite.rotation);
    const dx = attempt.sourceX - player.sprite.x;
    const dy = attempt.sourceY - player.sprite.y;
    if (dx === 0 && dy === 0) return false;

    const sourceAngle = Math.atan2(dy, dx);
    const halfArcRad = Phaser.Math.DegToRad(shield.config.fire.blockArcDegrees) * 0.5;
    const angleDiff = Phaser.Math.Angle.Wrap(sourceAngle - aimAngle);
    if (Math.abs(angleDiff) > halfArcRad) return false;

    shield.flashUntil = Math.max(shield.flashUntil, attempt.now + shield.config.fire.flashDurationMs);
    this.shieldBuffSystem.addBlockedDamage(attempt.targetId, attempt.damage, shield.config.fire, attempt.now);
    return true;
  }

  /**
   * Positionsbasierter Kuppel-Schutz. Prüft, ob der Schadenspunkt (impactX/impactY) von einer
   * aktiven Kuppel eines verbündeten Spielers abgedeckt wird. Jeder abdeckende Besitzer erhält
   * den Schadensbonus. Gibt true zurück, wenn der Schaden vollständig abgewehrt wird.
   *
   * @param victimPlayerId  Spieler-ID des Opfers oder null (Basis / verbündeter Gegner).
   */
  tryDomeProtect(impactX: number, impactY: number, victimPlayerId: string | null, damage: number, now: number): boolean {
    let blocked = false;
    for (const [ownerId, shield] of this.activeShields) {
      if (shield.config.fire.domeEnabled <= 0) continue;
      if (victimPlayerId !== null
        && ownerId !== victimPlayerId
        && !this.bridge.areTeammates(ownerId, victimPlayerId)) continue;

      const owner = this.playerManager.getPlayer(ownerId);
      if (!owner || !owner.sprite.active) continue;
      const radius = shield.config.fire.domeRadius;
      if (Phaser.Math.Distance.Between(impactX, impactY, owner.sprite.x, owner.sprite.y) > radius) continue;

      shield.flashUntil = Math.max(shield.flashUntil, now + shield.config.fire.flashDurationMs);
      this.shieldBuffSystem.addBlockedDamage(ownerId, damage, shield.config.fire, now);
      blocked = true;
    }
    return blocked;
  }

  /** Aktive Kuppeln mit Projektil-Barriere (a1 absorbiert, d2 reflektiert) für den Barriere-Pass. */
  getReflectDomes(): ReflectDomeInfo[] {
    const result: ReflectDomeInfo[] = [];
    for (const [ownerId, shield] of this.activeShields) {
      if (shield.config.fire.domeEnabled <= 0) continue;
      const owner = this.playerManager.getPlayer(ownerId);
      if (!owner || !owner.sprite.active) continue;
      result.push({
        ownerId,
        x: owner.sprite.x,
        y: owner.sprite.y,
        radius: shield.config.fire.domeRadius,
        color: shield.color,
        reflect: shield.config.fire.domeReflectProjectiles > 0,
      });
    }
    return result;
  }

  /** Buff + Flash, wenn die Kuppel ein Projektil absorbiert oder abprallen lässt. */
  onDomeAbsorb(ownerId: string, damage: number, now: number): void {
    const shield = this.activeShields.get(ownerId);
    if (!shield) return;
    shield.flashUntil = Math.max(shield.flashUntil, now + shield.config.fire.flashDurationMs);
    this.shieldBuffSystem.addBlockedDamage(ownerId, damage, shield.config.fire, now);
  }

  hostUpdate(now: number): SyncedEnergyShield[] {
    const synced: SyncedEnergyShield[] = [];

    for (const [ownerId, shield] of this.activeShields) {
      const fire = shield.config.fire;
      const isDome = fire.domeEnabled > 0;

      // Halte-Modus läuft ohne Refresh aus; Toggle-Kuppeln bleiben aktiv.
      if (!shield.toggleActive && now - shield.lastRefreshAt > EnergyShieldSystem.HOLD_GRACE_MS) {
        this.activeShields.delete(ownerId);
        continue;
      }

      const player = this.playerManager.getPlayer(ownerId);
      if (!player || !player.sprite.active) {
        this.forceOff(ownerId);
        continue;
      }

      // Zustände ohne Waffennutzung (Tod, Einbuddeln, Dodge-Phase-1) → Kuppel aus, kein Auto-Resume.
      if (this.weaponUsageBlockedChecker?.(ownerId)) {
        this.forceOff(ownerId);
        continue;
      }

      if (this.resourceSystem.getAdrenaline(ownerId) <= 0) {
        this.forceOff(ownerId);
        continue;
      }

      const elapsedDrainMs = Math.max(0, now - shield.lastDrainAt);
      if (elapsedDrainMs > 0) {
        const drain = fire.adrenalineDrainPerSecond * (elapsedDrainMs / 1000);
        if (drain > 0) this.resourceSystem.drainAdrenaline(ownerId, drain);
        shield.lastDrainAt = now;
      }

      if (this.resourceSystem.getAdrenaline(ownerId) <= 0) {
        this.forceOff(ownerId);
        continue;
      }

      if (isDome && fire.domeHealPerSecond > 0) {
        this.applyDomeHeal(ownerId, player.sprite.x, player.sprite.y, shield, now);
      } else {
        shield.lastHealAt = now;
      }

      const aimAngle = this.getAimAngle(ownerId, player.sprite.rotation);
      const flashRemaining = Math.max(0, shield.flashUntil - now);
      const flashFrac = fire.flashDurationMs > 0 ? flashRemaining / fire.flashDurationMs : 0;

      if (isDome) {
        synced.push({
          ownerId,
          x: Math.round(player.sprite.x),
          y: Math.round(player.sprite.y),
          angle: aimAngle,
          anchorDistance: 0,
          radius: Math.round(fire.domeRadius),
          thickness: fire.visualThickness,
          arcDegrees: 360,
          color: shield.color,
          alpha: fire.visualInnerAlpha,
          flashAlpha: fire.flashMaxAlpha * flashFrac,
          isDome: true,
        });
        continue;
      }

      const anchorX = player.sprite.x + Math.cos(aimAngle) * fire.anchorDistance;
      const anchorY = player.sprite.y + Math.sin(aimAngle) * fire.anchorDistance;
      synced.push({
        ownerId,
        x: Math.round(anchorX),
        y: Math.round(anchorY),
        angle: aimAngle,
        anchorDistance: fire.anchorDistance,
        radius: fire.visualRadius,
        thickness: fire.visualThickness,
        arcDegrees: fire.blockArcDegrees,
        color: shield.color,
        alpha: fire.visualInnerAlpha,
        flashAlpha: fire.flashMaxAlpha * flashFrac,
        isDome: false,
      });
    }

    return synced;
  }

  /** Heilt Spieler (Self + Verbündete), verbündete Gegner und Basen innerhalb der Kuppel. */
  private applyDomeHeal(ownerId: string, cx: number, cy: number, shield: ActiveEnergyShield, now: number): void {
    const dt = Math.max(0, now - shield.lastHealAt);
    shield.lastHealAt = now;
    if (dt <= 0) return;
    const amount = shield.config.fire.domeHealPerSecond * (dt / 1000);
    if (amount <= 0) return;
    const radius = shield.config.fire.domeRadius;

    for (const p of this.playerManager.getAllPlayers()) {
      if (!p.sprite.active) continue;
      if (p.id !== ownerId && !this.bridge.areTeammates(ownerId, p.id)) continue;
      if (this.combatSystem && !this.combatSystem.isAlive(p.id)) continue;
      if (Phaser.Math.Distance.Between(cx, cy, p.sprite.x, p.sprite.y) > radius) continue;
      this.combatSystem?.heal(p.id, amount);
    }

    for (const ally of this.enemyManager?.getAlliedEnemies() ?? []) {
      if (!ally.sprite.active || ally.getHp() <= 0) continue;
      if (Phaser.Math.Distance.Between(cx, cy, ally.sprite.x, ally.sprite.y) > radius) continue;
      ally.setHp(Math.min(ally.getMaxHp(), ally.getHp() + amount));
    }

    for (const base of this.baseManager?.getBases() ?? []) {
      if (base.getHp() <= 0) continue;
      const surface = base.getNearestSurfacePoint(cx, cy);
      if (!surface || surface.distance > radius) continue;
      this.baseManager?.heal(base.id, amount);
    }
  }

  private getAimAngle(playerId: string, fallback: number): number {
    const input = this.bridge.getPlayerInput(playerId);
    if (input) return dequantizeAngle(input.aim);
    return fallback;
  }
}
