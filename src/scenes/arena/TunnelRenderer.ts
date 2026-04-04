import Phaser from 'phaser';
import { CELL_SIZE, DEPTH } from '../../config';
import type { SyncedTunnel } from '../../types';

export class TunnelRenderer {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private snapshot: readonly SyncedTunnel[] = [];

  constructor(private readonly scene: Phaser.Scene) {
    this.graphics = scene.add.graphics().setDepth(DEPTH.OVERLAY - 4);
  }

  sync(snapshot: readonly SyncedTunnel[]): void {
    this.snapshot = snapshot;
    this.redraw();
  }

  clear(): void {
    this.snapshot = [];
    this.graphics.clear();
  }

  destroy(): void {
    this.graphics.destroy();
  }

  private redraw(): void {
    this.graphics.clear();
    for (const tunnel of this.snapshot) {
      this.drawTunnel(tunnel.entranceA, tunnel.ownerColor);
      this.drawTunnel(tunnel.entranceB, tunnel.ownerColor);
    }
  }

  private drawTunnel(endpoint: SyncedTunnel['entranceA'], ownerColor: number): void {
    this.graphics.fillStyle(0x24140a, 0.92);
    this.graphics.fillCircle(endpoint.x, endpoint.y, CELL_SIZE * 0.4);

    this.graphics.fillStyle(0x4a2a14, 0.95);
    this.graphics.fillEllipse(endpoint.x - 2, endpoint.y - 1, CELL_SIZE * 0.62, CELL_SIZE * 0.46);

    this.graphics.lineStyle(2, 0x140d08, 0.95);
    this.graphics.strokeEllipse(endpoint.x - 2, endpoint.y - 1, CELL_SIZE * 0.62, CELL_SIZE * 0.46);

    this.graphics.lineStyle(2, ownerColor, 0.18);
    this.graphics.strokeCircle(endpoint.x, endpoint.y, CELL_SIZE * 0.46);
  }
}