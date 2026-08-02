import * as Phaser from 'phaser';
import type { PlayerManager } from '../entities/PlayerManager';
import { WEAPON_CONFIGS, type PlaceableTurretUtilityConfig, type WeaponConfig } from '../loadout/LoadoutConfig';
import type { CombatSystem } from './CombatSystem';
import type { TurretDamageBuff } from '../types';

type LineOfSightChecker = (
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  skipRockIndex?: number,
  ignoreBaseObstacles?: boolean,
) => boolean;
export type AutomatedTurretId = number | string;
export type AutomatedTurretTargetMode = 'players' | 'enemies';
export interface AutomatedTurret {
  readonly id: AutomatedTurretId;
  readonly x: number;
  readonly y: number;
  readonly ownerId: string;
  readonly ownerColor: number;
  readonly weaponId?: keyof typeof WEAPON_CONFIGS;
  readonly skipRockIndex?: number;
  /** Basistürme stehen auf ihrer Basis und ignorieren deren Sichtlinien-Hindernisse. */
  readonly ignoreBaseObstacles?: boolean;
  readonly secondProjectileDamageFactor?: number;
  /** Beim Platzieren eingefrorene Zielreichweite; fehlt bei Basis-Turrets (dann gilt die Config). */
  readonly targetRange?: number;
  readonly muzzleOffset?: number;
  /** Erzwingt die Laufzeit-Zielfraktion; ohne Wert bleibt das bisherige gemischte Verhalten. */
  readonly targetMode?: AutomatedTurretTargetMode;
}
type TurretProvider = () => readonly AutomatedTurret[];
type TurretAngleUpdater = (id: AutomatedTurretId, angle: number) => void;
type EnemyTargetProvider = () => readonly { id: string; x: number; y: number }[];
type FocusTargetProvider = (ownerId: string) => { targetType: 'enemy' | 'base'; targetId: string } | null;
type FocusedBaseTargetProvider = (targetId: string, turretX: number, turretY: number) => { id: string; x: number; y: number } | null;
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
) => void;

export class TurretSystem {
  private lineOfSightChecker: LineOfSightChecker | null = null;
  private turretProvider: TurretProvider | null = null;
  private turretAngleUpdater: TurretAngleUpdater | null = null;
  private enemyTargetProvider: EnemyTargetProvider | null = null;
  private focusTargetProvider: FocusTargetProvider | null = null;
  private focusedBaseTargetProvider: FocusedBaseTargetProvider | null = null;
  private fireHandler: TurretFireHandler | null = null;
  private turretDamageBuffProvider: ((x: number, y: number) => TurretDamageBuff | null) | null = null;
  private turretDamageMultiplierProvider: ((turret: AutomatedTurret, turrets: readonly AutomatedTurret[]) => number) | null = null;
  private nextFireAt = new Map<AutomatedTurretId, number>();

  constructor(
    private readonly playerManager: PlayerManager,
    private readonly combatSystem: CombatSystem,
  ) {}

  setLineOfSightChecker(checker: LineOfSightChecker | null): void {
    this.lineOfSightChecker = checker;
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
      const turretWeaponId = turret.weaponId ?? 'SPOREN';
      const turretWeaponConfig = WEAPON_CONFIGS[turretWeaponId] ?? _weaponConfig;
      // Tesla-Konstrukte werden vom TeslaDomeSystem als Feldwaffe verarbeitet und
      // duerfen hier nicht zusaetzlich den generischen Projektilpfad ausloesen.
      if (turretWeaponConfig.fire.type === 'tesla_dome') continue;
      const rangeFactor = turret.muzzleOffset === undefined
        ? (baseTargetRange > 0 ? targetRange / baseTargetRange : 1)
        : Math.max(1, targetRange / Math.max(1, turretWeaponConfig.range));
      const muzzleOffset = turret.muzzleOffset ?? config.placeable.muzzleOffset;
      const target = this.findNearestTarget(
        turret,
        turretX,
        turretY,
        targetRange,
        muzzleOffset,
      );
      if (!target) continue;

      const angle = Phaser.Math.Angle.Between(turretX, turretY, target.x, target.y);
      this.turretAngleUpdater?.(turret.id, angle);

      if (now < (this.nextFireAt.get(turret.id) ?? 0)) continue;
      const buff = this.turretDamageBuffProvider?.(turretX, turretY) ?? null;
      const damageMultiplier = (buff?.damageMultiplier ?? 1)
        * Math.max(0, this.turretDamageMultiplierProvider?.(turret, turrets) ?? 1);
      this.nextFireAt.set(turret.id, now + Math.max(1, turretWeaponConfig.cooldown));

      const muzzleDistance = muzzleOffset;
      const muzzleX = turretX + Math.cos(angle) * muzzleDistance;
      const muzzleY = turretY + Math.sin(angle) * muzzleDistance;
      this.fireHandler?.(turret.ownerId, turret.ownerColor, turretWeaponId, muzzleX, muzzleY, angle, target.x, target.y, damageMultiplier, rangeFactor, turret.id);
      if ((turret.secondProjectileDamageFactor ?? 0) > 0) {
        const secondTarget = this.findNearestTarget(
          turret,
          turretX,
          turretY,
          targetRange,
          muzzleOffset,
          target,
        );
        if (secondTarget) {
          const secondAngle = Phaser.Math.Angle.Between(turretX, turretY, secondTarget.x, secondTarget.y);
          this.fireHandler?.(turret.ownerId, turret.ownerColor, turretWeaponId, muzzleX, muzzleY, secondAngle, secondTarget.x, secondTarget.y, (turret.secondProjectileDamageFactor ?? 0) * damageMultiplier, rangeFactor, turret.id);
        }
      }
    }

    for (const id of [...this.nextFireAt.keys()]) {
      if (!activeIds.has(id)) this.nextFireAt.delete(id);
    }
  }

  private findNearestTarget(
    turret: AutomatedTurret,
    turretX: number,
    turretY: number,
    range: number,
    lineOfSightStartOffset: number,
    excluded?: { x: number; y: number },
  ): { x: number; y: number } | null {
    let bestTarget: { x: number; y: number } | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestPriority = Number.POSITIVE_INFINITY;
    const focus = this.focusTargetProvider?.(turret.ownerId) ?? null;

    const consider = (candidate: { x: number; y: number }, priority: number): void => {
      const distance = Phaser.Math.Distance.Between(turretX, turretY, candidate.x, candidate.y);
      if (distance > range) return;
      if (!this.hasLineOfSightFromMuzzle(turret, turretX, turretY, candidate.x, candidate.y, lineOfSightStartOffset)) return;
      if (priority > bestPriority || (priority === bestPriority && distance >= bestDistance)) return;
      bestPriority = priority;
      bestDistance = distance;
      bestTarget = candidate;
    };

    if (turret.targetMode !== 'enemies') for (const player of this.playerManager.getAllPlayers()) {
      if (excluded && player.sprite.x === excluded.x && player.sprite.y === excluded.y) continue;
      if (player.id === turret.ownerId) continue;
      if (!player.sprite.active) continue;
      if (!this.combatSystem.isAlive(player.id)) continue;
      if (this.combatSystem.isBurrowed(player.id)) continue;
      if (!this.combatSystem.canDamageTarget(turret.ownerId, player.id)) continue;

      // Fokusziele werden nur priorisiert; Reichweite und Sichtlinie bleiben verbindlich.
      consider(
        { x: player.sprite.x, y: player.sprite.y },
        focus?.targetType === 'enemy' && focus.targetId === player.id ? 0 : 1,
      );
    }

    if (turret.targetMode !== 'players') for (const enemy of this.enemyTargetProvider?.() ?? []) {
      if (excluded && enemy.x === excluded.x && enemy.y === excluded.y) continue;
      if (!this.combatSystem.isAlive(enemy.id)) continue;
      if (!this.combatSystem.canDamageTarget(turret.ownerId, enemy.id)) continue;

      consider(
        { x: enemy.x, y: enemy.y },
        focus?.targetType === 'enemy' && focus.targetId === enemy.id ? 0 : 1,
      );
    }

    if (focus?.targetType === 'base') {
      const base = this.focusedBaseTargetProvider?.(focus.targetId, turretX, turretY) ?? null;
      if (base) consider({ x: base.x, y: base.y }, 0);
    }

    return bestTarget;
  }

  private hasLineOfSightFromMuzzle(
    turret: AutomatedTurret,
    turretX: number,
    turretY: number,
    targetX: number,
    targetY: number,
    muzzleOffset: number,
  ): boolean {
    if (!this.lineOfSightChecker) return true;
    const angle = Phaser.Math.Angle.Between(turretX, turretY, targetX, targetY);
    const startX = turretX + Math.cos(angle) * muzzleOffset;
    const startY = turretY + Math.sin(angle) * muzzleOffset;
    return this.lineOfSightChecker(
      startX,
      startY,
      targetX,
      targetY,
      turret.skipRockIndex,
      turret.ignoreBaseObstacles,
    );
  }
}
