import {
  COOP_DEFENSE_REPAIR_DRONE_CONFIG,
} from '../config/coopDefenseConstructions';
import type { PlayerManager } from '../entities/PlayerManager';
import type { SyncedPlaceableRock, SyncedRepairDrone } from '../types';
import type { CombatSystem } from './CombatSystem';
import type { PlacementSystem } from './PlacementSystem';

interface RepairDroneRuntime extends SyncedRepairDrone {
  orbitAngle: number;
}

type UpgradeResolver = (playerId: string) => boolean;

const ORBIT_RADIANS_PER_SECOND = 1.75;

export class RepairDroneSystem {
  private readonly drones = new Map<string, RepairDroneRuntime>();

  constructor(
    private readonly playerManager: PlayerManager,
    private readonly combatSystem: CombatSystem,
    private readonly placementSystem: PlacementSystem,
    private readonly hasUpgrade: UpgradeResolver,
  ) {}

  update(deltaMs: number): void {
    const deltaSeconds = Math.max(0, deltaMs) / 1000;
    const eligibleOwners = new Set<string>();

    for (const player of this.playerManager.getAllPlayers()) {
      if (
        !player.active
        || !this.combatSystem.isAlive(player.id)
        || !this.hasUpgrade(player.id)
      ) {
        continue;
      }
      eligibleOwners.add(player.id);
      const drone = this.drones.get(player.id) ?? this.createDrone(
        player.id,
        player.color,
        player.x,
        player.y,
      );
      drone.ownerColor = player.color;
      drone.orbitAngle = wrapAngle(
        drone.orbitAngle + ORBIT_RADIANS_PER_SECOND * deltaSeconds,
      );

      const currentTarget = drone.targetConstructionId === undefined
        ? undefined
        : this.placementSystem.getRuntimeRock(drone.targetConstructionId);
      const validTarget = this.isValidTarget(player.x, player.y, player.id, currentTarget)
        ? currentTarget
        : undefined;
      const target = validTarget ?? this.findNearestTarget(
        player.x,
        player.y,
        player.id,
      );

      if (target) {
        drone.targetConstructionId = target.id;
        const targetWorld = this.placementSystem.getWorldPointForCell(target.gridX, target.gridY);
        const distance = distanceBetween(drone.x, drone.y, targetWorld.x, targetWorld.y);
        if (distance <= COOP_DEFENSE_REPAIR_DRONE_CONFIG.repairDistance) {
          drone.phase = 'repairing';
          this.placementSystem.repairRock(
            target.id,
            COOP_DEFENSE_REPAIR_DRONE_CONFIG.repairPerSecond * deltaSeconds,
          );
        } else {
          drone.phase = 'travelling';
          this.moveTowards(
            drone,
            targetWorld.x,
            targetWorld.y,
            COOP_DEFENSE_REPAIR_DRONE_CONFIG.outboundSpeed,
            deltaSeconds,
          );
        }
        continue;
      }

      drone.targetConstructionId = undefined;
      const orbit = this.getOrbitPoint(
        player.x,
        player.y,
        drone.orbitAngle,
      );
      if (drone.phase === 'orbiting') {
        drone.x = orbit.x;
        drone.y = orbit.y;
      } else {
        drone.phase = 'returning';
        this.moveTowards(
          drone,
          orbit.x,
          orbit.y,
          COOP_DEFENSE_REPAIR_DRONE_CONFIG.returnSpeed,
          deltaSeconds,
        );
        if (distanceBetween(drone.x, drone.y, orbit.x, orbit.y) <= 4) {
          drone.x = orbit.x;
          drone.y = orbit.y;
          drone.phase = 'orbiting';
        }
      }
    }

    for (const ownerId of [...this.drones.keys()]) {
      if (!eligibleOwners.has(ownerId)) this.drones.delete(ownerId);
    }
  }

  getSnapshot(): SyncedRepairDrone[] {
    return [...this.drones.values()]
      .sort((left, right) => left.ownerId.localeCompare(right.ownerId))
      .map((drone) => ({
        ownerId: drone.ownerId,
        ownerColor: drone.ownerColor,
        x: drone.x,
        y: drone.y,
        phase: drone.phase,
        targetConstructionId: drone.targetConstructionId,
      }));
  }

  clear(): void {
    this.drones.clear();
  }

  private createDrone(
    ownerId: string,
    ownerColor: number,
    ownerX: number,
    ownerY: number,
  ): RepairDroneRuntime {
    const orbitAngle = 0;
    const orbit = this.getOrbitPoint(ownerX, ownerY, orbitAngle);
    const drone: RepairDroneRuntime = {
      ownerId,
      ownerColor,
      x: orbit.x,
      y: orbit.y,
      phase: 'orbiting',
      orbitAngle,
    };
    this.drones.set(ownerId, drone);
    return drone;
  }

  private findNearestTarget(
    ownerX: number,
    ownerY: number,
    ownerId: string,
  ): SyncedPlaceableRock | undefined {
    let best: SyncedPlaceableRock | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const construction of this.placementSystem.getOwnedConstructions(ownerId)) {
      if (construction.hp <= 0 || construction.hp >= construction.maxHp) continue;
      const world = this.placementSystem.getWorldPointForCell(
        construction.gridX,
        construction.gridY,
      );
      const distance = distanceBetween(ownerX, ownerY, world.x, world.y);
      if (
        distance > COOP_DEFENSE_REPAIR_DRONE_CONFIG.scanRadius
        || distance >= bestDistance
      ) {
        continue;
      }
      best = construction;
      bestDistance = distance;
    }
    return best;
  }

  private isValidTarget(
    ownerX: number,
    ownerY: number,
    ownerId: string,
    construction: SyncedPlaceableRock | undefined,
  ): construction is SyncedPlaceableRock {
    if (
      !construction
      || construction.ownerId !== ownerId
      || !construction.constructionId
      || construction.hp <= 0
      || construction.hp >= construction.maxHp
    ) {
      return false;
    }
    const world = this.placementSystem.getWorldPointForCell(
      construction.gridX,
      construction.gridY,
    );
    return distanceBetween(ownerX, ownerY, world.x, world.y)
      <= COOP_DEFENSE_REPAIR_DRONE_CONFIG.scanRadius;
  }

  private getOrbitPoint(ownerX: number, ownerY: number, angle: number): { x: number; y: number } {
    return {
      x: ownerX + Math.cos(angle) * COOP_DEFENSE_REPAIR_DRONE_CONFIG.orbitRadius,
      y: ownerY + Math.sin(angle) * COOP_DEFENSE_REPAIR_DRONE_CONFIG.orbitRadius * 0.72,
    };
  }

  private moveTowards(
    drone: RepairDroneRuntime,
    targetX: number,
    targetY: number,
    speed: number,
    deltaSeconds: number,
  ): void {
    const dx = targetX - drone.x;
    const dy = targetY - drone.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= 0.001) return;
    const step = Math.min(distance, speed * deltaSeconds);
    drone.x += dx / distance * step;
    drone.y += dy / distance * step;
  }
}

function distanceBetween(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

function wrapAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  return ((angle + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
}
