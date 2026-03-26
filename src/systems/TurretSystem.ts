import Phaser from 'phaser';
import type { PlayerManager } from '../entities/PlayerManager';
import type { PlaceableTurretUtilityConfig, WeaponConfig } from '../loadout/LoadoutConfig';
import type { SyncedPlaceableRock } from '../types';
import type { CombatSystem } from './CombatSystem';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE } from '../config';

type LineOfSightChecker = (sx: number, sy: number, ex: number, ey: number, skipRockIndex?: number) => boolean;
type TurretProvider = () => readonly SyncedPlaceableRock[];
type TurretAngleUpdater = (id: number, angle: number) => void;
type TurretFireHandler = (
  ownerId: string,
  color: number,
  x: number,
  y: number,
  angle: number,
  targetX: number,
  targetY: number,
) => void;

export class TurretSystem {
  private lineOfSightChecker: LineOfSightChecker | null = null;
  private turretProvider: TurretProvider | null = null;
  private turretAngleUpdater: TurretAngleUpdater | null = null;
  private fireHandler: TurretFireHandler | null = null;
  private nextFireAt = new Map<number, number>();

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

  setFireHandler(handler: TurretFireHandler | null): void {
    this.fireHandler = handler;
  }

  hostUpdate(
    now: number,
    config: PlaceableTurretUtilityConfig,
    _weaponConfig: WeaponConfig,
  ): void {
    const turrets = this.turretProvider?.() ?? [];
    const activeIds = new Set<number>();

    for (const turret of turrets) {
      if (turret.kind !== 'turret') continue;
      activeIds.add(turret.id);

      const turretX = ARENA_OFFSET_X + turret.gridX * CELL_SIZE + CELL_SIZE * 0.5;
      const turretY = ARENA_OFFSET_Y + turret.gridY * CELL_SIZE + CELL_SIZE * 0.5;
      const target = this.findNearestTarget(turret, turretX, turretY, config.placeable.targetRange);
      if (!target) continue;

      const angle = Phaser.Math.Angle.Between(turretX, turretY, target.x, target.y);
      this.turretAngleUpdater?.(turret.id, angle);

      if (now < (this.nextFireAt.get(turret.id) ?? 0)) continue;
      this.nextFireAt.set(turret.id, now + Math.max(1, _weaponConfig.cooldown));

      const muzzleDistance = config.placeable.muzzleOffset;
      const muzzleX = turretX + Math.cos(angle) * muzzleDistance;
      const muzzleY = turretY + Math.sin(angle) * muzzleDistance;
      this.fireHandler?.(turret.ownerId, turret.ownerColor, muzzleX, muzzleY, angle, target.x, target.y);
    }

    for (const id of [...this.nextFireAt.keys()]) {
      if (!activeIds.has(id)) this.nextFireAt.delete(id);
    }
  }

  private findNearestTarget(
    turret: SyncedPlaceableRock,
    turretX: number,
    turretY: number,
    range: number,
  ): { x: number; y: number } | null {
    let bestTarget: { x: number; y: number } | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const player of this.playerManager.getAllPlayers()) {
      if (player.id === turret.ownerId) continue;
      if (!player.sprite.active) continue;
      if (!this.combatSystem.isAlive(player.id)) continue;
      if (this.combatSystem.isBurrowed(player.id)) continue;

      const distance = Phaser.Math.Distance.Between(turretX, turretY, player.sprite.x, player.sprite.y);
      if (distance > range || distance >= bestDistance) continue;
      if (this.lineOfSightChecker && !this.lineOfSightChecker(turretX, turretY, player.sprite.x, player.sprite.y, turret.id)) continue;

      bestDistance = distance;
      bestTarget = { x: player.sprite.x, y: player.sprite.y };
    }

    return bestTarget;
  }
}
