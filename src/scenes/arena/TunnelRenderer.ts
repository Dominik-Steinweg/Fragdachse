import Phaser from 'phaser';
import type { SyncedTunnel } from '../../types';
import { TunnelEndpointVisual } from './TunnelEndpointVisual';

interface TunnelEndpointRecord {
  key: string;
  visual: TunnelEndpointVisual;
  ownerColor: number;
  x: number;
  y: number;
}

export class TunnelRenderer {
  private readonly visuals = new Map<string, TunnelEndpointRecord>();

  constructor(private readonly scene: Phaser.Scene) {}

  sync(snapshot: readonly SyncedTunnel[]): void {
    const nextKeys = new Set<string>();

    for (const tunnel of snapshot) {
      this.syncEndpoint(`${tunnel.ownerId}:A`, tunnel.entranceA.x, tunnel.entranceA.y, tunnel.ownerColor);
      this.syncEndpoint(`${tunnel.ownerId}:B`, tunnel.entranceB.x, tunnel.entranceB.y, tunnel.ownerColor);
      nextKeys.add(`${tunnel.ownerId}:A`);
      nextKeys.add(`${tunnel.ownerId}:B`);
    }

    for (const key of [...this.visuals.keys()]) {
      if (nextKeys.has(key)) continue;
      this.destroyVisual(key);
    }
  }

  update(now: number): void {
    for (const visual of this.visuals.values()) {
      visual.visual.sync({
        x: visual.x,
        y: visual.y,
        ownerColor: visual.ownerColor,
        alpha: 1,
        particleIntensity: 1,
      }, now);
    }
  }

  clear(): void {
    for (const key of [...this.visuals.keys()]) {
      this.destroyVisual(key);
    }
  }

  destroy(): void {
    this.clear();
  }

  private syncEndpoint(key: string, x: number, y: number, ownerColor: number): void {
    const existing = this.visuals.get(key);
    if (existing) {
      existing.x = x;
      existing.y = y;
      existing.ownerColor = ownerColor;
      return;
    }

    const visual = new TunnelEndpointVisual(this.scene, key, {
      x,
      y,
      ownerColor,
      alpha: 1,
      particleIntensity: 1,
    });

    this.visuals.set(key, {
      key,
      visual,
      ownerColor,
      x,
      y,
    });
  }

  private destroyVisual(key: string): void {
    const visual = this.visuals.get(key);
    if (!visual) return;
    visual.visual.destroy();
    this.visuals.delete(key);
  }
}