import Phaser from 'phaser';
import type { PlayerManager } from '../entities/PlayerManager';
import type { CombatSystem } from './CombatSystem';
import type { PlacementSystem } from './PlacementSystem';
import type { TunnelUltimateConfig } from '../loadout/LoadoutConfig';
import type { BurrowSystem } from './BurrowSystem';
import type { HostPhysicsSystem } from './HostPhysicsSystem';
import type { SyncedTunnel, SyncedTunnelEndpoint } from '../types';
import { PLAYER_SIZE } from '../config';

interface ActiveTunnel {
  ownerId: string;
  ownerColor: number;
  entranceA: SyncedTunnelEndpoint;
  entranceB: SyncedTunnelEndpoint;
  config: TunnelUltimateConfig;
}

interface TunnelTransitState {
  playerId: string;
  destination: SyncedTunnelEndpoint;
  startAt: number;
  durationMs: number;
  velocityX: number;
  velocityY: number;
}

type TunnelEnterCallback = (playerId: string, x: number, y: number) => void;

const REENTRY_BLOCK_MS = 380;

export class TunnelSystem {
  private readonly tunnels = new Map<string, ActiveTunnel>();
  private readonly activeTransitByPlayer = new Map<string, TunnelTransitState>();
  private readonly reentryBlockedUntil = new Map<string, number>();
  private onTunnelEnter: TunnelEnterCallback | null = null;

  constructor(
    private readonly playerManager: PlayerManager,
    private readonly combatSystem: CombatSystem,
    private readonly placementSystem: PlacementSystem,
    private readonly burrowSystem: BurrowSystem,
    private readonly hostPhysics: HostPhysicsSystem,
  ) {}

  setTunnelEnterCallback(cb: TunnelEnterCallback | null): void {
    this.onTunnelEnter = cb;
  }

  tryPlaceTunnel(
    cfg: TunnelUltimateConfig,
    playerId: string,
    ownerColor: number,
    originX: number,
    originY: number,
    startGridX: number,
    startGridY: number,
    targetX: number,
    targetY: number,
  ): boolean {
    const startIsValid = this.placementSystem.canPlaceSingleCell(startGridX, startGridY);
    if (!startIsValid) return false;

    const endCell = this.placementSystem.getClampedTargetCell(originX, originY, targetX, targetY, cfg.placement.range);
    if (!endCell) return false;
    if (!this.placementSystem.canPlaceSingleCell(endCell.gridX, endCell.gridY)) return false;
    if (startGridX === endCell.gridX && startGridY === endCell.gridY) return false;

    const entranceA = this.toEndpoint(startGridX, startGridY);
    const entranceB = this.toEndpoint(endCell.gridX, endCell.gridY);
    this.tunnels.set(playerId, {
      ownerId: playerId,
      ownerColor,
      entranceA,
      entranceB,
      config: cfg,
    });
    return true;
  }

  update(now: number): void {
    this.updateTransits(now);
    this.tryEnterTunnels(now);
  }

  getSnapshot(): SyncedTunnel[] {
    return [...this.tunnels.values()].map((tunnel) => ({
      ownerId: tunnel.ownerId,
      ownerColor: tunnel.ownerColor,
      entranceA: { ...tunnel.entranceA },
      entranceB: { ...tunnel.entranceB },
    }));
  }

  removePlayer(playerId: string): void {
    this.tunnels.delete(playerId);
    this.clearTransit(playerId);
    this.reentryBlockedUntil.delete(playerId);
  }

  clear(): void {
    for (const playerId of [...this.activeTransitByPlayer.keys()]) {
      this.clearTransit(playerId);
    }
    this.tunnels.clear();
    this.reentryBlockedUntil.clear();
  }

  notifyTransitEnded(playerId: string): void {
    this.clearTransit(playerId);
    this.reentryBlockedUntil.set(playerId, Date.now() + REENTRY_BLOCK_MS);
  }

  private updateTransits(now: number): void {
    for (const [playerId, transit] of [...this.activeTransitByPlayer]) {
      if (!this.combatSystem.isAlive(playerId)) {
        this.clearTransit(playerId);
        continue;
      }

      const player = this.playerManager.getPlayer(playerId);
      if (!player) {
        this.clearTransit(playerId);
        continue;
      }

      const elapsed = now - transit.startAt;
      if (elapsed >= transit.durationMs) {
        player.sprite.setPosition(transit.destination.x, transit.destination.y);
        player.body.reset(transit.destination.x, transit.destination.y);
        this.hostPhysics.clearForcedMovement(playerId);
        this.burrowSystem.completeTunnelTransit(playerId);
        continue;
      }

      this.hostPhysics.setForcedMovement(playerId, transit.velocityX, transit.velocityY);
    }
  }

  private tryEnterTunnels(now: number): void {
    if (this.tunnels.size === 0) return;

    for (const player of this.playerManager.getAllPlayers()) {
      if (!this.combatSystem.isAlive(player.id)) continue;
      if (this.activeTransitByPlayer.has(player.id)) continue;
      if ((this.reentryBlockedUntil.get(player.id) ?? 0) > now) continue;
      if (this.burrowSystem.getPhase(player.id) !== 'idle') continue;

      for (const tunnel of this.tunnels.values()) {
        const source = this.resolveEntryTouch(player.sprite.x, player.sprite.y, tunnel);
        if (!source) continue;

        const destination = source === 'A' ? tunnel.entranceB : tunnel.entranceA;
        const dx = destination.x - player.sprite.x;
        const dy = destination.y - player.sprite.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 1) continue;

        const durationMs = Phaser.Math.Clamp(
          Math.round((distance / Math.max(1, tunnel.config.travelSpeed)) * 1000),
          tunnel.config.travelMinDurationMs,
          tunnel.config.travelMaxDurationMs,
        );

        this.onTunnelEnter?.(player.id, player.sprite.x, player.sprite.y);
        this.burrowSystem.startTunnelTransit(player.id);
        this.activeTransitByPlayer.set(player.id, {
          playerId: player.id,
          destination,
          startAt: now,
          durationMs,
          velocityX: dx / (durationMs / 1000),
          velocityY: dy / (durationMs / 1000),
        });
        this.hostPhysics.setForcedMovement(player.id, dx / (durationMs / 1000), dy / (durationMs / 1000));
        break;
      }
    }
  }

  private resolveEntryTouch(x: number, y: number, tunnel: ActiveTunnel): 'A' | 'B' | null {
    const threshold = tunnel.config.placement.entranceRadius + PLAYER_SIZE * 0.35;
    const touchingA = Phaser.Math.Distance.Between(x, y, tunnel.entranceA.x, tunnel.entranceA.y) <= threshold;
    if (touchingA) return 'A';
    const touchingB = Phaser.Math.Distance.Between(x, y, tunnel.entranceB.x, tunnel.entranceB.y) <= threshold;
    return touchingB ? 'B' : null;
  }

  private clearTransit(playerId: string): void {
    this.activeTransitByPlayer.delete(playerId);
    this.hostPhysics.clearForcedMovement(playerId);
  }

  private toEndpoint(gridX: number, gridY: number): SyncedTunnelEndpoint {
    const world = this.placementSystem.getWorldPointForCell(gridX, gridY);
    return {
      gridX,
      gridY,
      x: world.x,
      y: world.y,
    };
  }
}