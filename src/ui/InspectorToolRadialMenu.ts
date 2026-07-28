import * as Phaser from 'phaser';
import { COLORS, DEPTH, toCssColor } from '../config';
import { getCoopDefenseConstructionDefinition } from '../config/coopDefenseConstructions';
import { toDesignSpace } from '../graphics/RenderResolution';
import { UTILITY_CONFIGS } from '../loadout/LoadoutConfig';
import { describeLoadoutTool } from '../loadout/LoadoutCatalog';
import type { LoadoutToolRef } from '../types';
import { getInspectorToolRadialSegmentIndex } from './InspectorToolRadialGeometry';

const INNER_RADIUS = 34;
const OUTER_RADIUS = 112;
const LABEL_RADIUS = 76;

/** Screen-space radial selection for the Inspector's shared tool loadout. */
export class InspectorToolRadialMenu {
  private container: Phaser.GameObjects.Container | null = null;
  private graphics: Phaser.GameObjects.Graphics | null = null;
  private tools: readonly LoadoutToolRef[] = [];
  private currentIndex = -1;
  private hoveredIndex = -1;
  private origin = { x: 0, y: 0 };

  constructor(private readonly scene: Phaser.Scene) {}

  get isOpen(): boolean {
    return this.container !== null;
  }

  open(originX: number, originY: number, tools: readonly LoadoutToolRef[], selected: LoadoutToolRef | null): void {
    this.close();
    if (tools.length === 0) return;
    this.tools = tools;
    this.origin = {
      x: toDesignSpace(this.scene.scale, originX),
      y: toDesignSpace(this.scene.scale, originY),
    };
    this.currentIndex = selected
      ? tools.findIndex((tool) => tool.kind === selected.kind && tool.id === selected.id)
      : 0;
    if (this.currentIndex < 0) this.currentIndex = 0;
    this.hoveredIndex = -1;
    this.container = this.scene.add.container(this.origin.x, this.origin.y)
      .setScrollFactor(0)
      .setDepth(DEPTH.LOCAL_UI + 20);
    this.graphics = this.scene.add.graphics();
    this.container.add(this.graphics);
    this.render();
  }

  update(pointerX: number, pointerY: number): void {
    if (!this.container || this.tools.length === 0) return;
    const designX = toDesignSpace(this.scene.scale, pointerX);
    const designY = toDesignSpace(this.scene.scale, pointerY);
    this.hoveredIndex = getInspectorToolRadialSegmentIndex(
      designX - this.origin.x,
      designY - this.origin.y,
      this.tools.length,
      INNER_RADIUS,
    ) ?? -1;
    this.render();
  }

  close(pointerX?: number, pointerY?: number): LoadoutToolRef | null {
    if (pointerX !== undefined && pointerY !== undefined) this.update(pointerX, pointerY);
    const selected = this.hoveredIndex >= 0 ? this.tools[this.hoveredIndex] ?? null : null;
    this.container?.destroy(true);
    this.container = null;
    this.graphics = null;
    this.tools = [];
    this.currentIndex = -1;
    this.hoveredIndex = -1;
    return selected ? { ...selected } : null;
  }

  destroy(): void {
    this.close();
  }

  private render(): void {
    if (!this.graphics || !this.container) return;
    for (const child of this.container.list.slice()) {
      if (child !== this.graphics) child.destroy();
    }
    this.container.removeAll(false);
    this.container.add(this.graphics);
    this.graphics.clear();
    const count = this.tools.length;
    const step = Math.PI * 2 / count;
    const start = -Math.PI / 2;
    for (let index = 0; index < count; index += 1) {
      const from = start + index * step + 0.025;
      const to = start + (index + 1) * step - 0.025;
      const tool = this.tools[index];
      const active = index === (this.hoveredIndex >= 0 ? this.hoveredIndex : this.currentIndex);
      const presentation = describeLoadoutTool(tool);
      const color = presentation.accentColor;
      this.graphics.fillStyle(active ? color : COLORS.GREY_8, active ? 0.92 : 0.9);
      this.graphics.lineStyle(active ? 3 : 1.5, color, active ? 1 : 0.75);
      this.graphics.beginPath();
      this.graphics.moveTo(INNER_RADIUS * Math.cos(from), INNER_RADIUS * Math.sin(from));
      this.graphics.arc(0, 0, OUTER_RADIUS, from, to, false);
      this.graphics.lineTo(INNER_RADIUS * Math.cos(to), INNER_RADIUS * Math.sin(to));
      this.graphics.arc(0, 0, INNER_RADIUS, to, from, true);
      this.graphics.closePath();
      this.graphics.fillPath();
      this.graphics.strokePath();

      const center = start + (index + 0.5) * step;
      const labelX = LABEL_RADIUS * Math.cos(center);
      const labelY = LABEL_RADIUS * Math.sin(center);
      if (this.scene.textures.exists(presentation.textureKey)) {
        const icon = this.scene.add.image(labelX, labelY - 8, presentation.textureKey)
          .setDisplaySize(28, 28)
          .setAlpha(active ? 1 : 0.82);
        this.container.add(icon);
      }
      const label = presentation.displayName;
      const cost = tool.kind === 'construction'
        ? getCoopDefenseConstructionDefinition(tool.id).adrenalineCost
        : UTILITY_CONFIGS[tool.id as keyof typeof UTILITY_CONFIGS]?.inspectorAdrenalineCost;
      this.container.add(this.scene.add.text(labelX, labelY + 18, label.slice(0, 14), {
        fontSize: '10px', fontFamily: 'monospace', fontStyle: active ? 'bold' : 'normal',
        color: toCssColor(COLORS.GREY_1),
      }).setOrigin(0.5).setAlpha(active ? 1 : 0.8));
      if (cost !== undefined) {
        this.container.add(this.scene.add.text(labelX, labelY + 30, `${cost} ADR`, {
          fontSize: '8px', fontFamily: 'monospace', color: toCssColor(COLORS.BLUE_2),
        }).setOrigin(0.5).setAlpha(active ? 1 : 0.75));
      }
      if (tool.kind === 'utility') {
        this.container.add(this.scene.add.text(labelX, labelY + 40, 'CD 1.0s', {
          fontSize: '7px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_3),
        }).setOrigin(0.5).setAlpha(active ? 1 : 0.65));
      }
    }
    this.graphics.fillStyle(COLORS.GREY_9, 0.95);
    this.graphics.fillCircle(0, 0, INNER_RADIUS - 2);
    this.graphics.lineStyle(2, COLORS.GREY_3, 0.9);
    this.graphics.strokeCircle(0, 0, INNER_RADIUS - 2);
    this.container.add(this.scene.add.text(0, 0, 'E', {
      fontSize: '18px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.GREY_1),
    }).setOrigin(0.5));
  }
}
