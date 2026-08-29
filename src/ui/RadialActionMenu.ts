import * as Phaser from 'phaser';
import { COLORS, DEPTH, toCssColor } from '../config';
import { toDesignSpace } from '../graphics/RenderResolution';
import { formatNumber, getLocale, t } from '../i18n';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import {
  cloneRadialActionRef,
  isSameRadialActionRef,
  type RadialActionDisabledReason,
  type RadialActionRef,
  type RadialActionState,
} from '../systems/RadialActionModel';
import { fitLoadoutIcon, getLoadoutIconTextureKey } from './LoadoutIconLayout';
import { getRadialMenuSegmentIndex } from './RadialMenuGeometry';

const INNER_RADIUS = 34;
const BASE_OUTER_RADIUS = 112;

/** Screen-space renderer for the flat, domain-neutral action ring. */
export class RadialActionMenu {
  private container: Phaser.GameObjects.Container | null = null;
  private graphics: Phaser.GameObjects.Graphics | null = null;
  private entries: readonly RadialActionState[] = [];
  private currentIndex = -1;
  private hoveredIndex = -1;
  private origin = { x: 0, y: 0 };

  constructor(private readonly scene: Phaser.Scene) {}

  get isOpen(): boolean {
    return this.container !== null;
  }

  open(
    originX: number,
    originY: number,
    entries: readonly RadialActionState[],
    selected: RadialActionRef | null,
  ): void {
    this.close();
    this.entries = entries.map((entry) => ({ ...entry, ref: cloneRadialActionRef(entry.ref) }));
    if (this.entries.length === 0) return;
    this.origin = {
      x: toDesignSpace(this.scene.scale, originX),
      y: toDesignSpace(this.scene.scale, originY),
    };
    this.currentIndex = selected
      ? this.entries.findIndex((entry) => isSameRadialActionRef(entry.ref, selected))
      : 0;
    if (this.currentIndex < 0) this.currentIndex = 0;
    this.hoveredIndex = -1;
    this.container = this.scene.add.container(this.origin.x, this.origin.y)
      .setScrollFactor(0)
      .setDepth(DEPTH.LOCAL_UI + 20);
    promoteToClarityCamera(this.scene, this.container);
    this.graphics = this.scene.add.graphics();
    this.container.add(this.graphics);
    this.render(Date.now());
  }

  update(pointerX: number, pointerY: number, now = Date.now()): void {
    if (!this.container || this.entries.length === 0) return;
    const designX = toDesignSpace(this.scene.scale, pointerX);
    const designY = toDesignSpace(this.scene.scale, pointerY);
    this.hoveredIndex = getRadialMenuSegmentIndex(
      designX - this.origin.x,
      designY - this.origin.y,
      this.entries.length,
      INNER_RADIUS,
    ) ?? -1;
    this.render(now);
  }

  close(pointerX?: number, pointerY?: number): RadialActionRef | null {
    if (pointerX !== undefined && pointerY !== undefined) this.update(pointerX, pointerY);
    const entry = this.hoveredIndex >= 0 ? this.entries[this.hoveredIndex] : undefined;
    const selection = entry ? cloneRadialActionRef(entry.ref) : null;
    this.container?.destroy(true);
    this.container = null;
    this.graphics = null;
    this.entries = [];
    this.currentIndex = -1;
    this.hoveredIndex = -1;
    return selection;
  }

  destroy(): void {
    this.close();
  }

  private render(now: number): void {
    if (!this.graphics || !this.container) return;
    for (const child of this.container.list.slice()) {
      if (child !== this.graphics) child.destroy();
    }
    this.container.removeAll(false);
    this.container.add(this.graphics);
    this.graphics.clear();

    const count = this.entries.length;
    const outerRadius = Math.min(156, BASE_OUTER_RADIUS + Math.max(0, count - 7) * 5);
    const labelRadius = outerRadius - 36;
    const step = Math.PI * 2 / count;
    const start = -Math.PI / 2;
    const compact = count > 9;
    for (let index = 0; index < count; index += 1) {
      const from = start + index * step + 0.025;
      const to = start + (index + 1) * step - 0.025;
      const entry = this.entries[index];
      const active = index === (this.hoveredIndex >= 0 ? this.hoveredIndex : this.currentIndex);
      const cooldownRemaining = Math.max(0, entry.cooldownUntil - now);
      const cooldownActive = cooldownRemaining > 0;
      const available = entry.available || (entry.disabledReason === 'cooldown' && !cooldownActive);
      const color = available ? entry.accentColor : COLORS.RED_2;
      const contentAlpha = available ? (active ? 1 : 0.8) : 0.45;
      this.drawSegment(from, to, outerRadius, active ? color : COLORS.GREY_8, color, active);

      if (cooldownActive && entry.cooldownDurationMs > 0) {
        const fraction = Math.min(1, cooldownRemaining / entry.cooldownDurationMs);
        this.drawCooldownFill(from, from + (to - from) * fraction, outerRadius);
      }

      const center = start + (index + 0.5) * step;
      const labelX = labelRadius * Math.cos(center);
      const labelY = labelRadius * Math.sin(center);
      if (entry.iconKey && this.scene.textures.exists(entry.iconKey)) {
        const size = compact ? 22 : 28;
        const icon = fitLoadoutIcon(
          this.scene.add.image(labelX, labelY - 8, getLoadoutIconTextureKey(this.scene, entry.iconKey)),
          size,
          size,
        ).setAlpha(contentAlpha);
        this.container.add(icon);
      }
      this.container.add(this.scene.add.text(labelX, labelY + 18, entry.label.slice(0, compact ? 11 : 14), {
        fontSize: compact ? '8px' : '10px',
        fontFamily: 'monospace',
        fontStyle: active ? 'bold' : 'normal',
        color: toCssColor(COLORS.GREY_1),
      }).setOrigin(0.5).setAlpha(contentAlpha));

      let detailY = labelY + 30;
      if ((entry.capacityCost ?? 0) > 0) {
        this.container.add(this.scene.add.text(labelX, detailY, t('ui.radial.capacity', { cost: entry.capacityCost ?? 0 }), {
          fontSize: '8px',
          fontFamily: 'monospace',
          color: toCssColor(entry.disabledReason === 'capacity' ? COLORS.RED_2 : COLORS.GOLD_2),
        }).setOrigin(0.5).setAlpha(available ? (active ? 1 : 0.75) : 0.9));
        detailY += 10;
      }
      if (cooldownActive) {
        this.container.add(this.scene.add.text(labelX, detailY, t('ui.radial.cooldown', {
          seconds: formatNumber(cooldownRemaining / 1000, getLocale(), {
            maximumFractionDigits: 1,
            useGrouping: false,
          }),
        }), {
          fontSize: '7px',
          fontFamily: 'monospace',
          color: toCssColor(COLORS.GREY_3),
        }).setOrigin(0.5).setAlpha(active ? 1 : 0.7));
      } else if (!available && entry.disabledReason) {
        this.container.add(this.scene.add.text(labelX, detailY, getDisabledReasonLabel(entry.disabledReason), {
          fontSize: '7px',
          fontFamily: 'monospace',
          color: toCssColor(COLORS.RED_2),
        }).setOrigin(0.5).setAlpha(0.9));
      }
    }

    this.graphics.fillStyle(COLORS.GREY_9, 0.95);
    this.graphics.fillCircle(0, 0, INNER_RADIUS - 2);
    this.graphics.lineStyle(2, COLORS.GREY_3, 0.9);
    this.graphics.strokeCircle(0, 0, INNER_RADIUS - 2);
    this.container.add(this.scene.add.text(0, 0, t('ui.radial.releaseKey'), {
      fontSize: '18px',
      fontFamily: 'monospace',
      fontStyle: 'bold',
      color: toCssColor(COLORS.GREY_1),
    }).setOrigin(0.5));
  }

  private drawSegment(
    from: number,
    to: number,
    outerRadius: number,
    fillColor: number,
    strokeColor: number,
    active: boolean,
  ): void {
    if (!this.graphics) return;
    this.graphics.fillStyle(fillColor, active ? 0.92 : 0.9);
    this.graphics.lineStyle(active ? 3 : 1.5, strokeColor, active ? 1 : 0.75);
    this.graphics.beginPath();
    this.graphics.moveTo(INNER_RADIUS * Math.cos(from), INNER_RADIUS * Math.sin(from));
    this.graphics.arc(0, 0, outerRadius, from, to, false);
    this.graphics.lineTo(INNER_RADIUS * Math.cos(to), INNER_RADIUS * Math.sin(to));
    this.graphics.arc(0, 0, INNER_RADIUS, to, from, true);
    this.graphics.closePath();
    this.graphics.fillPath();
    this.graphics.strokePath();
  }

  private drawCooldownFill(from: number, to: number, outerRadius: number): void {
    if (!this.graphics || to <= from) return;
    this.graphics.fillStyle(COLORS.GREY_9, 0.72);
    this.graphics.beginPath();
    this.graphics.moveTo(INNER_RADIUS * Math.cos(from), INNER_RADIUS * Math.sin(from));
    this.graphics.arc(0, 0, outerRadius, from, to, false);
    this.graphics.lineTo(INNER_RADIUS * Math.cos(to), INNER_RADIUS * Math.sin(to));
    this.graphics.arc(0, 0, INNER_RADIUS, to, from, true);
    this.graphics.closePath();
    this.graphics.fillPath();
  }
}

function getDisabledReasonLabel(reason: RadialActionDisabledReason): string {
  switch (reason) {
    case 'capacity': return t('ui.radial.disabled.capacity');
    case 'no-charges': return t('ui.radial.disabled.noCharges');
    case 'cooldown': return t('ui.radial.disabled.cooldown');
    case 'player-blocked':
    case 'unavailable':
      return t('ui.radial.disabled.unavailable');
  }
}
