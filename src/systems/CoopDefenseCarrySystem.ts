import {
  getCoopDefenseMapObjectiveZoneWorldRect,
  type ResolvedCoopDefenseMapSecondaryObjectiveConfig,
} from '../config/coopDefenseMaps';
import type {
  SyncedCoopDefenseCarryItem,
  SyncedCoopDefenseCarryState,
} from '../types';

const CARRY_ITEM_SIZE = 16;
const CARRY_ITEM_HALF_SIZE = CARRY_ITEM_SIZE * 0.5;

export interface CoopDefenseCarryPlayerLike {
  readonly id: string;
  readonly body: { readonly enable: boolean };
  readonly sprite: {
    readonly x: number;
    readonly y: number;
    getBounds(): CarryBounds;
  };
}

export interface CarryBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CoopDefenseCarryPlayerManagerLike {
  getAllPlayers(): readonly CoopDefenseCarryPlayerLike[];
  getPlayer(playerId: string): CoopDefenseCarryPlayerLike | undefined;
}

export interface CoopDefenseCarrySystemOptions {
  /** Participant/spectator gate. This is evaluated on the host for every pickup. */
  readonly isPlayerEligible?: (playerId: string) => boolean;
  /** Combat authority gate, kept separate so a dead carrier can drop deterministically. */
  readonly isPlayerAlive?: (playerId: string) => boolean;
  readonly isPlayerBurrowed?: (playerId: string) => boolean;
  /** Returns true only when the objective system accepted this unique delivery. */
  readonly onDelivered: (objectiveId: string, itemId: string, playerId: string) => boolean;
}

interface LocalCarryItem extends SyncedCoopDefenseCarryItem {
  readonly spawnX: number;
  readonly spawnY: number;
  pickupBlockedByPlayerId: string | null;
}

/**
 * Host-only world state for Coop-Defense Carry objectives.
 *
 * Items are created only from an objective activation callback. Clients never run this system;
 * they receive the resulting item snapshot and render it. The item id is stable for the round,
 * so pickup, delivery and removal are all naturally idempotent at the host boundary.
 */
export class CoopDefenseCarrySystem {
  private readonly carryConfigs = new Map<string, ResolvedCoopDefenseMapSecondaryObjectiveConfig>();
  private readonly items = new Map<string, LocalCarryItem>();
  private readonly activeObjectives = new Set<string>();
  private readonly scratchItemBounds: { x: number; y: number; width: number; height: number } = {
    x: 0, y: 0, width: 0, height: 0,
  };

  constructor(
    configs: readonly ResolvedCoopDefenseMapSecondaryObjectiveConfig[],
    private readonly playerManager: CoopDefenseCarryPlayerManagerLike,
    private readonly options: CoopDefenseCarrySystemOptions,
  ) {
    for (const config of configs) {
      if (config.type === 'carry' && config.carry) this.carryConfigs.set(config.id, config);
    }
  }

  reset(): void {
    this.items.clear();
    this.activeObjectives.clear();
  }

  destroy(): void {
    this.reset();
  }

  activateObjective(objectiveId: string): void {
    if (this.activeObjectives.has(objectiveId)) return;
    const config = this.carryConfigs.get(objectiveId);
    if (!config?.carry) return;

    this.activeObjectives.add(objectiveId);
    const itemCount = config.carry.itemCount ?? config.targetGoal;
    for (let index = 0; index < itemCount; index += 1) {
      const spawnPosition = getCarrySpawnPosition(config.carry.spawnZone, index, itemCount);
      const itemId = `${objectiveId}:beer-${this.items.size}`;
      this.items.set(itemId, {
        id: itemId,
        objectiveId,
        x: spawnPosition.x,
        y: spawnPosition.y,
        holderId: null,
        state: 'spawned',
        spawnX: spawnPosition.x,
        spawnY: spawnPosition.y,
        pickupBlockedByPlayerId: null,
      });
    }
  }

  /** Advances all host-owned item transitions and returns the authoritative snapshot. */
  hostUpdate(interactionsEnabled: boolean): SyncedCoopDefenseCarryState {
    this.releasePickupBlocks();
    this.resolveUnavailableCarriers();
    this.syncCarrierPositions();

    if (interactionsEnabled) {
      this.resolveGroundInteractions();
      this.syncCarrierPositions();
      this.resolveDeliveries();
    }

    return this.getSnapshot();
  }

  /** Death path: drop at the authoritative death position and prevent an instant re-claim. */
  dropForPlayer(playerId: string, x?: number, y?: number): void {
    for (const item of this.items.values()) {
      if (item.holderId !== playerId) continue;
      const player = this.playerManager.getPlayer(playerId);
      this.dropItem(
        item,
        Number.isFinite(x) ? x as number : player?.sprite.x ?? item.spawnX,
        Number.isFinite(y) ? y as number : player?.sprite.y ?? item.spawnY,
        playerId,
      );
    }
  }

  /** Disconnect and spectator transitions return the item to its authored safe spawn. */
  handlePlayerUnavailable(playerId: string): void {
    for (const item of this.items.values()) {
      if (item.holderId !== playerId) continue;
      this.dropItem(item, item.spawnX, item.spawnY, null);
    }
  }

  getSnapshot(): SyncedCoopDefenseCarryState {
    return [...this.items.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(({ id, objectiveId, x, y, holderId, state }) => ({
        id,
        objectiveId,
        x,
        y,
        holderId,
        state,
      }));
  }

  private resolveUnavailableCarriers(): void {
    for (const item of this.items.values()) {
      if (item.state !== 'carried' || !item.holderId) continue;
      const player = this.playerManager.getPlayer(item.holderId);
      if (
        player
        && player.body.enable
        && this.canPlayerInteract(player.id)
        && this.isPlayerAlive(player.id)
      ) continue;

      this.dropItem(
        item,
        player?.sprite.x ?? item.spawnX,
        player?.sprite.y ?? item.spawnY,
        null,
      );
    }
  }

  private syncCarrierPositions(): void {
    for (const item of this.items.values()) {
      if (item.state !== 'carried' || !item.holderId) continue;
      const player = this.playerManager.getPlayer(item.holderId);
      if (!player) continue;
      item.x = player.sprite.x;
      item.y = player.sprite.y;
    }
  }

  private resolveGroundInteractions(): void {
    const players = [...this.playerManager.getAllPlayers()]
      .filter((player) => (
        player.body.enable
        && this.canPlayerInteract(player.id)
        && !this.isPlayerBurrowed(player.id)
        && this.isPlayerAlive(player.id)
      ))
      .sort((left, right) => left.id.localeCompare(right.id));
    const carryingPlayers = new Set(
      [...this.items.values()]
        .filter((item) => item.state === 'carried' && item.holderId)
        .map((item) => item.holderId as string),
    );

    for (const item of this.items.values()) {
      if (item.state === 'carried') continue;
      for (const player of players) {
        if (carryingPlayers.has(player.id)) continue;
        if (item.pickupBlockedByPlayerId === player.id) continue;
        if (!this.isPlayerTouchingItem(player.sprite.getBounds(), item)) continue;

        item.holderId = player.id;
        item.state = 'carried';
        item.pickupBlockedByPlayerId = null;
        item.x = player.sprite.x;
        item.y = player.sprite.y;
        carryingPlayers.add(player.id);
        break;
      }
    }
  }

  private resolveDeliveries(): void {
    for (const item of [...this.items.values()]) {
      if (item.state !== 'carried' || !item.holderId) continue;
      const player = this.playerManager.getPlayer(item.holderId);
      const config = this.carryConfigs.get(item.objectiveId);
      if (!player || !config?.carry || !this.isPlayerAlive(item.holderId)) continue;
      const deliveryZone = getCoopDefenseMapObjectiveZoneWorldRect(config.carry.deliveryZone);
      if (
        player.sprite.x < deliveryZone.x
        || player.sprite.x > deliveryZone.x + deliveryZone.width
        || player.sprite.y < deliveryZone.y
        || player.sprite.y > deliveryZone.y + deliveryZone.height
      ) continue;
      if (!this.options.onDelivered(item.objectiveId, item.id, item.holderId)) continue;
      this.items.delete(item.id);
    }
  }

  private dropItem(item: LocalCarryItem, x: number, y: number, blockedBy: string | null): void {
    item.holderId = null;
    item.state = 'dropped';
    item.x = Number.isFinite(x) ? x : item.spawnX;
    item.y = Number.isFinite(y) ? y : item.spawnY;
    item.pickupBlockedByPlayerId = blockedBy;
  }

  private releasePickupBlocks(): void {
    for (const item of this.items.values()) {
      if (!item.pickupBlockedByPlayerId) continue;
      const player = this.playerManager.getPlayer(item.pickupBlockedByPlayerId);
      if (!player || !this.isPlayerTouchingItem(player.sprite.getBounds(), item)) {
        item.pickupBlockedByPlayerId = null;
      }
    }
  }

  private isPlayerTouchingItem(playerBounds: CarryBounds, item: LocalCarryItem): boolean {
    this.scratchItemBounds.x = item.x - CARRY_ITEM_HALF_SIZE;
    this.scratchItemBounds.y = item.y - CARRY_ITEM_HALF_SIZE;
    this.scratchItemBounds.width = CARRY_ITEM_SIZE;
    this.scratchItemBounds.height = CARRY_ITEM_SIZE;
    return playerBounds.x < this.scratchItemBounds.x + this.scratchItemBounds.width
      && playerBounds.x + playerBounds.width > this.scratchItemBounds.x
      && playerBounds.y < this.scratchItemBounds.y + this.scratchItemBounds.height
      && playerBounds.y + playerBounds.height > this.scratchItemBounds.y;
  }

  private canPlayerInteract(playerId: string): boolean {
    return this.options.isPlayerEligible?.(playerId) ?? true;
  }

  private isPlayerAlive(playerId: string): boolean {
    return this.options.isPlayerAlive?.(playerId) ?? true;
  }

  private isPlayerBurrowed(playerId: string): boolean {
    return this.options.isPlayerBurrowed?.(playerId) ?? false;
  }
}

function getCarrySpawnPosition(
  zone: NonNullable<ResolvedCoopDefenseMapSecondaryObjectiveConfig['carry']>['spawnZone'],
  index: number,
  itemCount: number,
): { x: number; y: number } {
  const rect = getCoopDefenseMapObjectiveZoneWorldRect(zone);
  if (itemCount <= 1) {
    return { x: rect.x + rect.width * 0.5, y: rect.y + rect.height * 0.5 };
  }
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / itemCount;
  const radius = 4;
  return {
    x: rect.x + rect.width * 0.5 + Math.round(Math.cos(angle) * radius),
    y: rect.y + rect.height * 0.5 + Math.round(Math.sin(angle) * radius),
  };
}
