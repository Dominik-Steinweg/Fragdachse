import * as Phaser from 'phaser';
import type { PlayerManager } from '../entities/PlayerManager';
import { WEAPON_CONFIGS, type PlaceableTurretUtilityConfig, type WeaponConfig } from '../loadout/LoadoutConfig';
import type { CombatActorStatePort, CombatRelationshipQueryPort } from '../combat/CombatCapabilities';
import type { TurretDamageBuff } from '../types';
import { DEFAULT_TURRET_AIM_TOLERANCE_DEG, type TurretAimConfig } from '../config/turretAim';
import { stepTurretAngle, turretAngleDifference } from '../utils/turretAngle';

/**
 * Schusslinienprüfung des Turrets. Bewusst die Schuss- und nicht die Sichtlinie: ein Turret,
 * dessen Projektil im Zug einschlägt, darf das Ziel gar nicht erst wählen.
 */
type LineOfFireChecker = (
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  skipRockIndex?: number,
  sourceCarrierBaseId?: string,
) => boolean;
export type AutomatedTurretId = number | string;
export type AutomatedTurretTargetMode = 'players' | 'enemies';
export interface AutomatedTurret extends TurretAimConfig {
  readonly angle?: number;
  readonly id: AutomatedTurretId;
  readonly x: number;
  readonly y: number;
  readonly ownerId: string;
  readonly ownerColor: number;
  readonly weaponId?: keyof typeof WEAPON_CONFIGS;
  readonly skipRockIndex?: number;
  /** Nur der konkrete Träger ist bis zum ersten vollständigen Austritt freigegeben. */
  readonly sourceCarrierBaseId?: string;
  readonly secondProjectileDamageFactor?: number;
  /** Beim Platzieren eingefrorene Zielreichweite; fehlt bei Basis-Turrets (dann gilt die Config). */
  readonly targetRange?: number;
  readonly projectileRange?: number;
  readonly cooldownMs?: number;
  readonly damage?: number;
  readonly muzzleOffset?: number;
  /** Erzwingt die Laufzeit-Zielfraktion; ohne Wert bleibt das bisherige gemischte Verhalten. */
  readonly targetMode?: AutomatedTurretTargetMode;
}
type TurretProvider = () => readonly AutomatedTurret[];
type TurretAngleUpdater = (id: AutomatedTurretId, angle: number) => void;
type EnemyTargetProvider = () => readonly { id: string; x: number; y: number }[];
type FocusTargetProvider = (ownerId: string) => { targetType: 'enemy' | 'base'; targetId: string } | null;
type FocusedBaseTargetProvider = (targetId: string, turretX: number, turretY: number) => { id: string; x: number; y: number } | null;
interface PendingTurretBurst {
  shotsRemaining: number;
  nextShotAt: number;
  targetX: number;
  targetY: number;
  damageMultiplier: number;
  rangeFactor: number;
}
type TurretFireHandler = (
  ownerId: string,
  color: number,
  weaponId: keyof typeof WEAPON_CONFIGS,
  x: number,
  y: number,
  angle: number,
  targetX: number,
  targetY: number,
  damageFactor?: number,
  rangeFactor?: number,
  sourceTurretId?: AutomatedTurretId,
  skipRockIndex?: number,
  sourceCarrierBaseId?: string,
) => void;

export class TurretSystem {
  private lineOfFireChecker: LineOfFireChecker | null = null;
  private turretProvider: TurretProvider | null = null;
  private turretAngleUpdater: TurretAngleUpdater | null = null;
  private enemyTargetProvider: EnemyTargetProvider | null = null;
  private focusTargetProvider: FocusTargetProvider | null = null;
  private focusedBaseTargetProvider: FocusedBaseTargetProvider | null = null;
  private fireHandler: TurretFireHandler | null = null;
  private turretDamageBuffProvider: ((x: number, y: number) => TurretDamageBuff | null) | null = null;
  private turretDamageMultiplierProvider: ((turret: AutomatedTurret, turrets: readonly AutomatedTurret[]) => number) | null = null;
  private nextFireAt = new Map<AutomatedTurretId, number>();
  private pendingBursts = new Map<AutomatedTurretId, PendingTurretBurst>();
  private targetScore: ((turret: AutomatedTurret, kind: 'player' | 'enemy' | 'base', id: string, now: number) => number) | null = null;

  setTargetScoreProvider(provider: typeof this.targetScore): void { this.targetScore = provider; }

  constructor(
    private readonly playerManager: PlayerManager,
    private readonly combatSystem: CombatActorStatePort & CombatRelationshipQueryPort,
  ) {}

  setLineOfFireChecker(checker: LineOfFireChecker | null): void {
    this.lineOfFireChecker = checker;
  }

  setTurretProvider(provider: TurretProvider | null, angleUpdater: TurretAngleUpdater | null): void {
    this.turretProvider = provider;
    this.turretAngleUpdater = angleUpdater;
  }

  setEnemyTargetProvider(provider: EnemyTargetProvider | null): void {
    this.enemyTargetProvider = provider;
  }

  setFocusTargetProvider(provider: FocusTargetProvider | null): void {
    this.focusTargetProvider = provider;
  }

  setFocusedBaseTargetProvider(provider: FocusedBaseTargetProvider | null): void {
    this.focusedBaseTargetProvider = provider;
  }

  setFireHandler(handler: TurretFireHandler | null): void {
    this.fireHandler = handler;
    if (!handler) {
      this.nextFireAt.clear();
      this.pendingBursts.clear();
    }
  }

  /**
   * Ortsbezogener Konstruktionsbuff aus der Verstärkungsmatrix-/Energieinjektor-Pipeline.
   * Bewusst positionsbasiert, damit platzierte Konstruktionen, Fliegenpilze und Basistuerme
   * ohne Sonderfall profitieren.
   */
  setTurretDamageBuffProvider(provider: ((x: number, y: number) => TurretDamageBuff | null) | null): void {
    this.turretDamageBuffProvider = provider;
  }

  /** Zusätzlicher, quellenbezogener Schadensmultiplikator für Konstrukte. */
  setTurretDamageMultiplierProvider(
    provider: ((turret: AutomatedTurret, turrets: readonly AutomatedTurret[]) => number) | null,
  ): void {
    this.turretDamageMultiplierProvider = provider;
  }

  /**
   * Aktueller Turmbestand aus derselben Quelle, die auch das Turmfeuer speist. Der
   * Energieinjektor braucht ihn fuer Zielsuche und Treffer-Zuordnung; ein zweiter
   * Enumerationspfad wuerde sonst Basistuerme oder Fliegenpilze vergessen.
   */
  getTurrets(): readonly AutomatedTurret[] {
    return this.turretProvider?.() ?? [];
  }

  hostUpdate(
    now: number,
    config: PlaceableTurretUtilityConfig,
    _weaponConfig: WeaponConfig,
    deltaMs = 0,
  ): void {
    const turrets = this.turretProvider?.() ?? [];
    const activeIds = new Set<AutomatedTurretId>();

    for (const turret of turrets) {
      activeIds.add(turret.id);

      const turretX = turret.x;
      const turretY = turret.y;
      // Zielreichweite-Upgrades haengen am platzierten Turret, nicht an der Basis-Config. Der
      // gleiche Faktor streckt die Waffenreichweite mit, sonst sterben Projektile vor dem Ziel.
      const baseTargetRange = config.placeable.targetRange;
      const targetRange = turret.targetRange ?? baseTargetRange;
      const turretWeaponId = turret.weaponId ?? 'SPORES';
      const turretWeaponConfig = WEAPON_CONFIGS[turretWeaponId] ?? _weaponConfig;
      // Tesla-Konstrukte werden vom TeslaDomeSystem als Feldwaffe verarbeitet und
      // duerfen hier nicht zusaetzlich den generischen Projektilpfad ausloesen.
      if (turretWeaponConfig.fire.type === 'tesla_dome') continue;
      const rangeFactor = turret.projectileRange !== undefined ? turret.projectileRange / turretWeaponConfig.range : turret.muzzleOffset === undefined
        ? (baseTargetRange > 0 ? targetRange / baseTargetRange : 1)
        : Math.max(1, targetRange / Math.max(1, turretWeaponConfig.range));
      const muzzleOffset = turret.muzzleOffset ?? config.placeable.muzzleOffset;

      const pendingBurst = this.pendingBursts.get(turret.id);
      if (pendingBurst) {
        // Legacy bursts only update their pose when due; limited turrets track between shots.
        if (turret.rotationSpeedDegPerSec === undefined && (now < pendingBurst.nextShotAt || !this.fireHandler)) continue;
        const desiredAngle = Phaser.Math.Angle.Between(
          turretX,
          turretY,
          pendingBurst.targetX,
          pendingBurst.targetY,
        );
        const burstAngle = this.updateAim(turret, desiredAngle, deltaMs);
        if (now < pendingBurst.nextShotAt || !this.fireHandler) continue;
        if (turret.rotationSpeedDegPerSec === undefined
          && !this.hasLineOfFireFromMuzzle(turret, turretX, turretY, pendingBurst.targetX, pendingBurst.targetY, muzzleOffset)) continue;
        if (!this.canFireAtAngle(turret, burstAngle, pendingBurst.targetX, pendingBurst.targetY, muzzleOffset)) continue;
        const muzzleX = turretX + Math.cos(burstAngle) * muzzleOffset;
        const muzzleY = turretY + Math.sin(burstAngle) * muzzleOffset;
        this.fireHandler?.(
          turret.ownerId,
          turret.ownerColor,
          turretWeaponId,
          muzzleX,
          muzzleY,
          burstAngle,
          pendingBurst.targetX,
          pendingBurst.targetY,
          pendingBurst.damageMultiplier,
          pendingBurst.rangeFactor,
          turret.id,
          turret.skipRockIndex,
          turret.sourceCarrierBaseId,
        );
        pendingBurst.shotsRemaining -= 1;
        if (pendingBurst.shotsRemaining > 0) {
          pendingBurst.nextShotAt = now + Math.max(1, turretWeaponConfig.turretBurst?.intervalMs ?? 1);
        } else {
          this.pendingBursts.delete(turret.id);
          this.nextFireAt.set(turret.id, now + Math.max(1, turretWeaponConfig.cooldown));
        }
        continue;
      }

      const target = this.findNearestTarget(
        turret,
        turretX,
        turretY,
        targetRange,
        muzzleOffset,
        now,
      );
      if (!target) continue;

      const angle = this.updateAim(turret, Phaser.Math.Angle.Between(turretX, turretY, target.x, target.y), deltaMs);

      if (now < (this.nextFireAt.get(turret.id) ?? 0)) continue;
      if (!this.canFireAtAngle(turret, angle, target.x, target.y, muzzleOffset)) continue;
      const buff = this.turretDamageBuffProvider?.(turretX, turretY) ?? null;
      const damageMultiplier = (buff?.damageMultiplier ?? 1)
        * (turret.damage === undefined ? 1 : turret.damage / turretWeaponConfig.damage)
        * Math.max(0, this.turretDamageMultiplierProvider?.(turret, turrets) ?? 1);

      const muzzleDistance = muzzleOffset;
      const muzzleX = turretX + Math.cos(angle) * muzzleDistance;
      const muzzleY = turretY + Math.sin(angle) * muzzleDistance;
      if (!this.fireHandler) continue;
      this.fireHandler?.(
        turret.ownerId,
        turret.ownerColor,
        turretWeaponId,
        muzzleX,
        muzzleY,
        angle,
        target.x,
        target.y,
        damageMultiplier,
        rangeFactor,
        turret.id,
        turret.skipRockIndex,
        turret.sourceCarrierBaseId,
      );
      const burstCount = turretWeaponConfig.turretBurst
        ? Math.max(1, Math.floor(turretWeaponConfig.turretBurst.count))
        : 1;
      if (burstCount > 1) {
        this.pendingBursts.set(turret.id, {
          shotsRemaining: burstCount - 1,
          nextShotAt: now + Math.max(1, turretWeaponConfig.turretBurst?.intervalMs ?? 1),
          targetX: target.x,
          targetY: target.y,
          damageMultiplier,
          rangeFactor,
        });
      } else {
        this.nextFireAt.set(turret.id, now + Math.max(1, turret.cooldownMs ?? turretWeaponConfig.cooldown));
      }
      if (burstCount <= 1 && (turret.secondProjectileDamageFactor ?? 0) > 0) {
        const secondTarget = this.findNearestTarget(
          turret,
          turretX,
          turretY,
          targetRange,
          muzzleOffset,
          now,
          target,
        );
        if (secondTarget) {
          const secondAngle = turret.rotationSpeedDegPerSec === undefined
            ? Phaser.Math.Angle.Between(turretX, turretY, secondTarget.x, secondTarget.y) : angle;
          if (!this.canFireAtAngle(turret, secondAngle, secondTarget.x, secondTarget.y, muzzleOffset)) continue;
          this.fireHandler?.(
            turret.ownerId,
            turret.ownerColor,
            turretWeaponId,
            muzzleX,
            muzzleY,
            secondAngle,
            secondTarget.x,
            secondTarget.y,
            (turret.secondProjectileDamageFactor ?? 0) * damageMultiplier,
            rangeFactor,
            turret.id,
            turret.skipRockIndex,
            turret.sourceCarrierBaseId,
          );
        }
      }
    }

    for (const id of [...this.nextFireAt.keys()]) {
      if (!activeIds.has(id)) this.nextFireAt.delete(id);
    }
    for (const id of [...this.pendingBursts.keys()]) {
      if (!activeIds.has(id)) this.pendingBursts.delete(id);
    }
  }

  private updateAim(turret: AutomatedTurret, desiredAngle: number, deltaMs: number): number {
    const angle = turret.rotationSpeedDegPerSec === undefined ? desiredAngle
      : stepTurretAngle(turret.angle ?? 0, desiredAngle, turret.rotationSpeedDegPerSec, deltaMs);
    this.turretAngleUpdater?.(turret.id, angle);
    return angle;
  }

  private canFireAtAngle(turret: AutomatedTurret, angle: number, targetX: number, targetY: number, muzzleOffset: number): boolean {
    if (turret.rotationSpeedDegPerSec === undefined) return true;
    const desiredAngle = Math.atan2(targetY - turret.y, targetX - turret.x);
    const tolerance = (turret.aimToleranceDeg ?? DEFAULT_TURRET_AIM_TOLERANCE_DEG) * Math.PI / 180;
    if (Math.abs(turretAngleDifference(angle, desiredAngle)) > tolerance + 1e-10) return false;
    if (!this.lineOfFireChecker) return true;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const distance = Math.max(muzzleOffset, Math.hypot(targetX - turret.x, targetY - turret.y));
    return this.lineOfFireChecker(
      turret.x + dx * muzzleOffset, turret.y + dy * muzzleOffset,
      turret.x + dx * distance, turret.y + dy * distance,
      turret.skipRockIndex, turret.sourceCarrierBaseId,
    );
  }

  private findNearestTarget(
    turret: AutomatedTurret,
    turretX: number,
    turretY: number,
    range: number,
    lineOfFireStartOffset: number,
    now: number,
    excluded?: { x: number; y: number },
  ): { x: number; y: number } | null {
    let bestTarget: { x: number; y: number } | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestPriority = Number.POSITIVE_INFINITY;
    let bestScore = Number.NEGATIVE_INFINITY;
    let bestKey = '';
    const focus = this.focusTargetProvider?.(turret.ownerId) ?? null;

    const consider = (candidate: { x: number; y: number }, priority: number, kind: 'player' | 'enemy' | 'base', id: string): void => {
      const distance = Phaser.Math.Distance.Between(turretX, turretY, candidate.x, candidate.y);
      if (distance > range) return;
      if (!this.hasLineOfFireFromMuzzle(turret, turretX, turretY, candidate.x, candidate.y, lineOfFireStartOffset)) return;
      const score = this.targetScore?.(turret, kind, id, now) ?? 0;
      const key = kind + ':' + id;
      if (priority > bestPriority || (priority === bestPriority && (score < bestScore
        || (score === bestScore && (distance > bestDistance || (distance === bestDistance && key >= bestKey)))))) return;
      bestPriority = priority;
      bestScore = score;
      bestKey = key;
      bestDistance = distance;
      bestTarget = candidate;
    };

    if (turret.targetMode !== 'enemies') for (const player of this.playerManager.getAllPlayers()) {
      if (excluded && player.x === excluded.x && player.y === excluded.y) continue;
      if (player.id === turret.ownerId) continue;
      if (!player.active) continue;
      if (!this.combatSystem.isAlive(player.id)) continue;
      if (this.combatSystem.isBurrowed(player.id)) continue;
      if (!this.combatSystem.canDamageTarget(turret.ownerId, player.id)) continue;

      // Fokusziele werden nur priorisiert; Reichweite und Sichtlinie bleiben verbindlich.
      consider(
        { x: player.x, y: player.y },
        focus?.targetType === 'enemy' && focus.targetId === player.id ? 0 : 1,
        'player', player.id,
      );
    }

    if (turret.targetMode !== 'players') for (const enemy of this.enemyTargetProvider?.() ?? []) {
      if (excluded && enemy.x === excluded.x && enemy.y === excluded.y) continue;
      if (!this.combatSystem.isAlive(enemy.id)) continue;
      if (!this.combatSystem.canDamageTarget(turret.ownerId, enemy.id)) continue;

      consider(
        { x: enemy.x, y: enemy.y },
        focus?.targetType === 'enemy' && focus.targetId === enemy.id ? 0 : 1,
        'enemy', enemy.id,
      );
    }

    if (focus?.targetType === 'base') {
      const base = this.focusedBaseTargetProvider?.(focus.targetId, turretX, turretY) ?? null;
      if (base) consider({ x: base.x, y: base.y }, 0, 'base', base.id);
    }

    return bestTarget;
  }

  private hasLineOfFireFromMuzzle(
    turret: AutomatedTurret,
    turretX: number,
    turretY: number,
    targetX: number,
    targetY: number,
    muzzleOffset: number,
  ): boolean {
    if (!this.lineOfFireChecker) return true;
    const angle = Phaser.Math.Angle.Between(turretX, turretY, targetX, targetY);
    const startX = turretX + Math.cos(angle) * muzzleOffset;
    const startY = turretY + Math.sin(angle) * muzzleOffset;
    return this.lineOfFireChecker(
      startX,
      startY,
      targetX,
      targetY,
      turret.skipRockIndex,
      turret.sourceCarrierBaseId,
    );
  }
}
