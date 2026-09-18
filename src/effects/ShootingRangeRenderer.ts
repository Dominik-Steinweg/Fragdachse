import * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH } from '../config';
import { formatNumber, getLocale } from '../i18n';
import { AutoTiler, ROCK_AUTOTILE } from '../arena/AutoTiler';
import { ensureForestButton } from '../ui/forestTextures';
import { worldCellCenter, type WorldMetrics } from '../world/WorldMetrics';
import { SHOOTING_RANGE, SHOOTING_RANGE_CONTROLS, shootingRangeControlPosition } from '../shootingRange/ShootingRangeLayout';
import { shootingRangeAction, type ShootingRangeState } from '../shootingRange/ShootingRangeContracts';
import { registerGraphicsObject } from './EffectUtils';

/** A bounded board, four wall props and target markings; no gameplay writes or collision geometry. */
export class ShootingRangeRenderer {
  private readonly ground: Phaser.GameObjects.Graphics;
  private readonly controls: Phaser.GameObjects.Graphics;
  private readonly controlProps: Phaser.GameObjects.Image[];
  private readonly panel: Phaser.GameObjects.Container;
  private readonly chart: Phaser.GameObjects.Graphics;
  private readonly value: Phaser.GameObjects.Text;
  private readonly axisTop: Phaser.GameObjects.Text;
  private readonly chartBounds: { left: number; right: number; top: number; bottom: number };
  private signature = '';

  constructor(private readonly scene: Phaser.Scene, private readonly metrics: WorldMetrics) {
    this.ground = this.graphics(DEPTH.DECALS + 0.1);
    this.controls = this.graphics(DEPTH.LOCAL_UI - 1);
    this.controlProps = SHOOTING_RANGE_CONTROLS.map(control => {
      const point = shootingRangeControlPosition(metrics, control);
      return scene.add.image(point.x, point.y, 'walls', AutoTiler.getFrame(0, ROCK_AUTOTILE))
        .setDisplaySize(CELL_SIZE, CELL_SIZE).setDepth(DEPTH.ROCKS);
    });
    const board = SHOOTING_RANGE.board;
    const origin = worldCellCenter(metrics, board.minX, board.minY);
    const width = (board.maxX - board.minX + 1) * CELL_SIZE;
    const height = (board.maxY - board.minY + 1) * CELL_SIZE;
    this.panel = scene.add.container(origin.x - CELL_SIZE / 2, origin.y - CELL_SIZE / 2).setDepth(DEPTH.LOCAL_UI);
    const backing = scene.add.image(0, 0, ensureForestButton(scene, width, height, 'neutral', 'rest'))
      .setOrigin(0).setDisplaySize(width, height);
    this.value = this.text(16, 11, 40, '#fff2d5');
    this.chartBounds = { left: 48, right: width - 16, top: 61, bottom: height - 16 };
    this.axisTop = this.text(39, this.chartBounds.top - 5, 12, '#dfceb1').setOrigin(1, 0);
    const zero = this.text(39, this.chartBounds.bottom - 10, 12, '#dfceb1').setOrigin(1, 0).setText('0');
    this.chart = this.graphics(0);
    this.panel.add([backing, this.chart, this.value, this.axisTop, zero]);
  }

  sync(state: ShootingRangeState): void {
    const signature = JSON.stringify([state, getLocale()]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.panel.setVisible(state.enabled);
    this.ground.clear();
    if (state.enabled) {
      if (state.supply) {
        const area = SHOOTING_RANGE.supplyArea;
        const min = worldCellCenter(this.metrics, area.minX, area.minY);
        this.ground.lineStyle(2, 0x80dba9, 0.65).strokeRoundedRect(min.x - 14, min.y - 14,
          (area.maxX - area.minX + 1) * CELL_SIZE - 4, (area.maxY - area.minY + 1) * CELL_SIZE - 4, 8);
      }
      state.targets.forEach((target, slot) => {
        if (!target) return;
        const [gx, gy] = SHOOTING_RANGE.targets[slot];
        const point = worldCellCenter(this.metrics, gx, gy);
        const radius = CELL_SIZE * 0.43;
        const outline = Array.from({ length: 16 }, (_, index) => new Phaser.Math.Vector2(
          point.x + Math.cos(index * Math.PI / 8) * radius, point.y + Math.sin(index * Math.PI / 8) * radius,
        ));
        this.ground.lineStyle(1.5, 0xf4d780, 0.85).strokePoints(outline, true, true)
          .lineBetween(point.x - 20, point.y, point.x - 15, point.y)
          .lineBetween(point.x + 15, point.y, point.x + 20, point.y);
      });
    }
    this.syncControls(state);
    if (!state.enabled) return;
    this.value.setFontSize(40).setText(formatNumber(state.dps, getLocale(), { maximumFractionDigits: 0 }));
    const maxValueWidth = this.chartBounds.right - 16;
    if (this.value.width > maxValueWidth) this.value.setFontSize(Math.max(16, 40 * maxValueWidth / this.value.width));
    this.axisTop.setText(formatNumber(state.scale, getLocale(), { notation: 'compact', maximumFractionDigits: 0 }));
    const { left, right, top, bottom } = this.chartBounds;
    this.chart.clear().lineStyle(1, 0xc5ab7d, 0.65).lineBetween(left, top, right, top)
      .lineBetween(left, bottom, right, bottom).lineBetween(left, top, left, bottom);
    const end = state.samples[state.samples.length - 1]?.at;
    if (end === undefined) return;
    this.chart.lineStyle(2.5, 0xffe0a0).beginPath();
    state.samples.forEach((sample, index) => {
      const x = right - (end - sample.at) / SHOOTING_RANGE.historyMs * (right - left);
      const y = bottom - Math.min(1, sample.dps / state.scale) * (bottom - top);
      if (index === 0) this.chart.moveTo(x, y); else this.chart.lineTo(x, y);
    });
    this.chart.strokePath();
  }

  private syncControls(state: ShootingRangeState): void {
    this.controls.clear();
    SHOOTING_RANGE_CONTROLS.forEach((control, index) => {
      const visible = control === 'power' || state.enabled;
      const prop = this.controlProps[index].setVisible(visible);
      if (!visible) return;
      const { x, y } = shootingRangeControlPosition(this.metrics, control);
      const available = shootingRangeAction(state, control) !== null;
      const active = control === 'power' ? state.enabled : control === 'supply' ? state.supply : available;
      const color = !available ? 0x90948c : active ? 0xa1f0bd : 0xf4d496;
      prop.setTint(available ? 0xffffff : 0x90948c);
      // Small inlaid pictograms leave the existing masonry visible across the rest of the cell.
      this.controls.fillStyle(0x18201b, 0.92).fillRoundedRect(x - 9, y - 9, 18, 18, 3).lineStyle(2, color);
      if (control === 'plus' || control === 'minus') {
        this.controls.lineBetween(x - 5, y, x + 5, y);
        if (control === 'plus') this.controls.lineBetween(x, y - 5, x, y + 5);
      } else if (control === 'power') {
        const outline = Array.from({ length: 13 }, (_, i) => {
          const angle = -Math.PI / 4 + i * Math.PI * 1.5 / 12;
          return new Phaser.Math.Vector2(x + Math.cos(angle) * 5.5, y + Math.sin(angle) * 5.5);
        });
        this.controls.strokePoints(outline, false).lineBetween(x, y - 7, x, y);
      } else {
        this.controls.fillStyle(color).fillPoints([
          new Phaser.Math.Vector2(x + 1, y - 7), new Phaser.Math.Vector2(x - 5, y + 1),
          new Phaser.Math.Vector2(x - 1, y + 1), new Phaser.Math.Vector2(x - 2, y + 7),
          new Phaser.Math.Vector2(x + 5, y - 2), new Phaser.Math.Vector2(x + 1, y - 2),
        ], true);
      }
    });
  }

  destroy(): void {
    this.ground.destroy(); this.controls.destroy(); this.panel.destroy(true);
    this.controlProps.forEach(prop => prop.destroy());
  }
  private graphics(depth: number): Phaser.GameObjects.Graphics {
    const graphics = this.scene.add.graphics().setDepth(depth);
    registerGraphicsObject(this.scene, 'shootingRange', graphics);
    return graphics;
  }
  private text(x: number, y: number, size: number, color: string): Phaser.GameObjects.Text {
    return this.scene.add.text(x, y, '', { fontFamily: 'Arial', fontSize: `${size}px`, color });
  }
}
