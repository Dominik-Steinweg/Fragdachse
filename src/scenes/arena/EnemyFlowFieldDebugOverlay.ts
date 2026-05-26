import * as Phaser from 'phaser';
import type { EnemyFlowFieldService } from '../../systems/EnemyFlowFieldService';
import { DEPTH } from '../../config';

/**
 * Optional debug visualization for flow field vectors.
 * Displays normalized direction vectors as small arrows in each grid cell,
 * color-coded by integration field distance from goal cells.
 *
 * Managed by ArenaScene and toggled via Shift+D+B.
 */
export class EnemyFlowFieldDebugOverlay {
  private graphics: Phaser.GameObjects.Graphics | null = null;
  private flowFieldService: EnemyFlowFieldService | null = null;
  private isVisible = false;

  constructor(
    private readonly scene: Phaser.Scene,
    flowFieldService: EnemyFlowFieldService,
  ) {
    this.setFlowFieldService(flowFieldService);
  }

  showForService(flowFieldService: EnemyFlowFieldService): void {
    this.setFlowFieldService(flowFieldService);
    this.show();
  }

  private setFlowFieldService(flowFieldService: EnemyFlowFieldService): void {
    if (this.flowFieldService === flowFieldService) {
      this.refresh();
      return;
    }

    this.flowFieldService?.registerDebugOverlayCallback(null);
    this.flowFieldService = flowFieldService;
    this.flowFieldService.registerDebugOverlayCallback(() => {
      this.refresh();
    });
  }

  private show(): void {
    if (this.isVisible) return;
    if (!this.graphics) {
      this.graphics = this.scene.add.graphics({ x: 0, y: 0 });
      this.graphics.setDepth(DEPTH.OVERLAY - 1);
    }
    this.redraw();
    this.graphics.setVisible(true);
    this.isVisible = true;
  }

  private hide(): void {
    if (!this.isVisible || !this.graphics) return;
    this.graphics.setVisible(false);
    this.isVisible = false;
  }

  private redraw(): void {
    if (!this.graphics || !this.flowFieldService) return;
    this.graphics.clear();

    const flowFieldService = this.flowFieldService;
    const cellSize = flowFieldService.getCellSize();
    const cols = flowFieldService.getCols();
    const rows = flowFieldService.getRows();
    const arrowScale = cellSize * 0.3;
    const arrowHeadLength = 4;

    for (let gridY = 0; gridY < rows; gridY++) {
      for (let gridX = 0; gridX < cols; gridX++) {
        const vector = flowFieldService.getVectorAt(gridX, gridY);
        const integrationValue = flowFieldService.getIntegrationValueAt(gridX, gridY);

        // Skip non-traversable cells
        if (!flowFieldService.isTraversableAt(gridX, gridY)) {
          continue;
        }

        const worldPos = flowFieldService.gridToWorld(gridX, gridY);
        if (!worldPos) continue;

        // Color by distance: blue (close) → cyan → green → yellow → red (far)
        const maxDistance = 200; // Empirical max for visibility
        const normalizedDist = Math.min(integrationValue / maxDistance, 1);
        const color = this.distanceToColor(normalizedDist);

        // Draw arrow from cell center along vector direction
        const endX = worldPos.x + vector.x * arrowScale;
        const endY = worldPos.y + vector.y * arrowScale;

        this.graphics.lineStyle(1, color, 0.8);
        this.graphics.lineBetween(worldPos.x, worldPos.y, endX, endY);

        // Draw arrowhead
        if (vector.x !== 0 || vector.y !== 0) {
          const angle = Math.atan2(vector.y, vector.x);
          const headAngle1 = angle + Math.PI * 0.85;
          const headAngle2 = angle - Math.PI * 0.85;

          const headX1 = endX + Math.cos(headAngle1) * arrowHeadLength;
          const headY1 = endY + Math.sin(headAngle1) * arrowHeadLength;
          const headX2 = endX + Math.cos(headAngle2) * arrowHeadLength;
          const headY2 = endY + Math.sin(headAngle2) * arrowHeadLength;

          this.graphics.lineBetween(endX, endY, headX1, headY1);
          this.graphics.lineBetween(endX, endY, headX2, headY2);
        }
      }
    }

    // Draw goal cells with a special marker
    for (const goalCell of flowFieldService.getGoalCells()) {
      const worldPos = flowFieldService.gridToWorld(goalCell.gridX, goalCell.gridY);
      if (!worldPos) continue;

      this.graphics.lineStyle(2, 0x00ff00, 1); // Bright green for goals
      this.graphics.strokeCircleShape(
        new Phaser.Geom.Circle(worldPos.x, worldPos.y, cellSize * 0.15),
      );
    }
  }

  refresh(): void {
    if (!this.isVisible) return;
    this.redraw();
  }

  private distanceToColor(normalized: number): number {
    // Gradient: blue (0) → cyan → green → yellow → red (1)
    // Simple RGB interpolation via bit-shifting
    if (normalized < 0.25) {
      const t = normalized / 0.25;
      const r = Math.round(0 * (1 - t) + 0 * t);
      const g = Math.round(0 * (1 - t) + 255 * t);
      const b = Math.round(255 * (1 - t) + 255 * t);
      return (r << 16) | (g << 8) | b;
    } else if (normalized < 0.5) {
      const t = (normalized - 0.25) / 0.25;
      const r = Math.round(0 * (1 - t) + 0 * t);
      const g = 255; // Stays 255
      const b = Math.round(255 * (1 - t) + 0 * t);
      return (r << 16) | (g << 8) | b;
    } else if (normalized < 0.75) {
      const t = (normalized - 0.5) / 0.25;
      const r = Math.round(0 * (1 - t) + 255 * t);
      const g = 255; // Stays 255
      const b = 0;
      return (r << 16) | (g << 8) | b;
    } else {
      const t = (normalized - 0.75) / 0.25;
      const r = 255; // Stays 255
      const g = Math.round(255 * (1 - t) + 0 * t);
      const b = 0;
      return (r << 16) | (g << 8) | b;
    }
  }

  destroy(): void {
    this.flowFieldService?.registerDebugOverlayCallback(null);
    if (this.graphics) {
      this.graphics.destroy();
      this.graphics = null;
    }
    this.flowFieldService = null;
    this.isVisible = false;
  }
}
