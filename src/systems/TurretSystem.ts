import * as Phaser from 'phaser';
import type { PlayerManager } from '../entities/PlayerManager';
import { WEAPON_CONFIGS, type PlaceableTurretUtilityConfig, type WeaponConfig } from '../loadout/LoadoutConfig';
import type { CombatSystem } from './CombatSystem';

type LineOfSightChecker = (sx: number, sy: number, ex: number, ey: number, skipRockIndex?: number) => boolean;
export type AutomatedTurretId = number | string;
export interface AutomatedTurret {
  readonly id: AutomatedTurretId;
  readonly x: number;
  readonly y: number;
  readonly ownerId: string;
  readonly ownerColor: number;
  readonly weaponId?: keyof typeof WEAPON_CONFIGS;
  readonly skipRockIndex?: number;
  readonly secondProjectileDamageFactor?: number;
}
type TurretProvider = () => readonly AutomatedTurret[];
type TurretAngleUpdater = (id: AutomatedTurretId, angle: number) => void;
type EnemyTargetProvider = () => readonly { id: string; x: number; y: number }[];
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
) => void;

export class TurretSystem {
  private lineOfSightChecker: LineOfSightChecker | null = null;
  private turretProvider: TurretProvider | null = null;
  private turretAngleUpdater: TurretAngleUpdater | null = null;
  private enemyTargetProvider: EnemyTargetProvider | null = null;
  private fireHandler: TurretFireHandler | null = null;
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

  setFireHandler(handler: TurretFireHandler | null): void {
    this.fireHandler = handler;
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
      const target = this.findNearestTarget(
        turret,
        turretX,
        turretY,
        config.placeable.targetRange,
        config.placeable.muzzleOffset,
      );
      if (!target) continue;

      const angle = Phaser.Math.Angle.Between(turretX, turretY, target.x, target.y);
      this.turretAngleUpdater?.(turret.id, angle);

      const turretWeaponId = turret.weaponId ?? 'SPOREN';
      const turretWeaponConfig = WEAPON_CONFIGS[turretWeaponId] ?? _weaponConfig;
      if (now < (this.nextFireAt.get(turret.id) ?? 0)) continue;
      this.nextFireAt.set(turret.id, now + Math.max(1, turretWeaponConfig.cooldown));

      const muzzleDistance = config.placeable.muzzleOffset;
      const muzzleX = turretX + Math.cos(angle) * muzzleDistance;
      const muzzleY = turretY + Math.sin(angle) * muzzleDistance;
      this.fireHandler?.(turret.ownerId, turret.ownerColor, turretWeaponId, muzzleX, muzzleY, angle, target.x, target.y);
      if ((turret.secondProjectileDamageFactor ?? 0) > 0) {
        const secondTarget = this.findNearestTarget(
          turret,
          turretX,
          turretY,
          config.placeable.targetRange,
          config.placeable.muzzleOffset,
          target,
        );
        if (secondTarget) {
          const secondAngle = Phaser.Math.Angle.Between(turretX, turretY, secondTarget.x, secondTarget.y);
          this.fireHandler?.(turret.ownerId, turret.ownerColor, turretWeaponId, muzzleX, muzzleY, secondAngle, secondTarget.x, secondTarget.y, turret.secondProjectileDamageFactor);
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

    for (const player of this.playerManager.getAllPlayers()) {
      if (excluded && player.sprite.x === excluded.x && player.sprite.y === excluded.y) continue;
      if (player.id === turret.ownerId) continue;
      if (!player.sprite.active) continue;
      if (!this.combatSystem.isAlive(player.id)) continue;
      if (this.combatSystem.isBurrowed(player.id)) continue;
      if (!this.combatSystem.canDamageTarget(turret.ownerId, player.id)) continue;

      const distance = Phaser.Math.Distance.Between(turretX, turretY, player.sprite.x, player.sprite.y);
      if (distance > range || distance >= bestDistance) continue;
      if (!this.hasLineOfSightFromMuzzle(turret, turretX, turretY, player.sprite.x, player.sprite.y, lineOfSightStartOffset)) continue;

      bestDistance = distance;
      bestTarget = { x: player.sprite.x, y: player.sprite.y };
    }

    for (const enemy of this.enemyTargetProvider?.() ?? []) {
      if (excluded && enemy.x === excluded.x && enemy.y === excluded.y) continue;
      if (!this.combatSystem.isAlive(enemy.id)) continue;
      if (!this.combatSystem.canDamageTarget(turret.ownerId, enemy.id)) continue;

      const distance = Phaser.Math.Distance.Between(turretX, turretY, enemy.x, enemy.y);
      if (distance > range || distance >= bestDistance) continue;
      if (!this.hasLineOfSightFromMuzzle(turret, turretX, turretY, enemy.x, enemy.y, lineOfSightStartOffset)) continue;

      bestDistance = distance;
      bestTarget = { x: enemy.x, y: enemy.y };
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
    return this.lineOfSightChecker(startX, startY, targetX, targetY, turret.skipRockIndex);
  }
}
