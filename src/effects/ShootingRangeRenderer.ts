import * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH } from '../config';
import { formatNumber, getLocale } from '../i18n';
import { AutoTiler, ROCK_AUTOTILE } from '../arena/AutoTiler';
import { ESSENCE_PALETTE } from '../adrenalineEssence/AdrenalineEssencePresentation';
import { ensureForestButton } from '../ui/forestTextures';
import { worldCellCenter, type WorldMetrics } from '../world/WorldMetrics';
import { SHOOTING_RANGE, SHOOTING_RANGE_CONTROLS, shootingRangeControlPosition } from '../shootingRange/ShootingRangeLayout';
import { shootingRangeAction, type ShootingRangeState } from '../shootingRange/ShootingRangeContracts';
import { shootingRangeChartPoints } from '../shootingRange/ShootingRangeChart';
import { fillRadialGradientTexture, registerGraphicsObject } from './EffectUtils';

/** Bounded world props and ground accents, without collision or gameplay writes. */
export class ShootingRangeRenderer {
  private readonly ground: Phaser.GameObjects.Graphics;
  private readonly controlProps: Phaser.GameObjects.Image[];
  private readonly controlIcons: Phaser.GameObjects.Image[];
  private readonly targetGlows: Phaser.GameObjects.Image[];
  private readonly supplyGlows: Phaser.GameObjects.Image[];
  private readonly panel: Phaser.GameObjects.Container;
  private readonly chart: Phaser.GameObjects.Graphics;
  private readonly value: Phaser.GameObjects.Text;
  private readonly axisTop: Phaser.GameObjects.Text;
  private readonly chartBounds: { left: number; right: number; top: number; bottom: number };
  private signature = '';
  private nextNumberUpdate = 0;
  private displayedSession = -1;

  constructor(private readonly scene: Phaser.Scene, private readonly metrics: WorldMetrics) {
    this.ground = this.graphics(DEPTH.DECALS + 0.1);
    this.controlProps = SHOOTING_RANGE_CONTROLS.map(control => {
      const point = shootingRangeControlPosition(metrics, control);
      return scene.add.image(point.x, point.y, 'walls', AutoTiler.getFrame(0, ROCK_AUTOTILE))
        .setDisplaySize(CELL_SIZE, CELL_SIZE).setDepth(DEPTH.ROCKS);
    });
    this.controlIcons = SHOOTING_RANGE_CONTROLS.map(control => {
      const point = shootingRangeControlPosition(metrics, control);
      return scene.add.image(point.x, point.y, `shooting-range-${control}`)
        .setDisplaySize(26, 26).setDepth(DEPTH.ROCKS + 0.1);
    });
    fillRadialGradientTexture(scene.textures, 'shooting-range-target-glow', 96, [
      [0, 'rgba(241,83,72,0)'], [0.35, 'rgba(241,83,72,0.02)'],
      [0.56, 'rgba(236,76,64,0.28)'], [0.66, 'rgba(255,120,102,0.48)'],
      [0.76, 'rgba(230,61,55,0.2)'], [1, 'rgba(230,61,55,0)'],
    ]);
    fillRadialGradientTexture(scene.textures, 'shooting-range-supply-glow', 64, [
      [0, 'rgba(255,255,255,0.35)'], [0.25, 'rgba(255,255,255,0.18)'], [1, 'rgba(255,255,255,0)'],
    ]);
    this.targetGlows = SHOOTING_RANGE.targets.map(([x, y]) => {
      const point = worldCellCenter(metrics, x, y);
      return scene.add.image(point.x, point.y, 'shooting-range-target-glow')
        .setDisplaySize(52, 52).setDepth(DEPTH.DECALS + 0.2).setVisible(false);
    });
    const area = SHOOTING_RANGE.supplyArea;
    this.supplyGlows = [[area.minX, area.minY], [area.maxX, area.minY],
      [area.minX, area.maxY], [area.maxX, area.maxY]].map(([x, y]) => {
      const point = worldCellCenter(metrics, x, y);
      return scene.add.image(point.x, point.y, 'shooting-range-supply-glow')
        .setDisplaySize(76, 76).setTint(ESSENCE_PALETTE.halo).setDepth(DEPTH.DECALS + 0.1).setVisible(false);
    });
    const board = SHOOTING_RANGE.board;
    const origin = worldCellCenter(metrics, board.minX, board.minY);
    const width = (board.maxX - board.minX + 1) * CELL_SIZE;
    const height = (board.maxY - board.minY + 1) * CELL_SIZE;
    this.panel = scene.add.container(origin.x - CELL_SIZE / 2, origin.y - CELL_SIZE / 2).setDepth(DEPTH.LOCAL_UI);
    const backing = scene.add.image(0, 0, ensureForestButton(scene, width, height, 'neutral', 'rest'))
      .setOrigin(0).setDisplaySize(width, height);
    this.value = this.text(16, 10, 34, '#fff2d5');
    this.chartBounds = { left: 48, right: width - 17, top: 59, bottom: height - 26 };
    const { left, right, top, bottom } = this.chartBounds;
    this.axisTop = this.text(left - 9, top - 6, 12, '#cbbb9f').setOrigin(1, 0);
    const zero = this.text(left - 9, bottom - 7, 12, '#cbbb9f').setOrigin(1, 0).setText('0');
    const startTime = this.text(left, bottom + 7, 10, '#bba98c').setText('−10 s');
    const midTime = this.text((left + right) / 2, bottom + 7, 10, '#bba98c').setOrigin(0.5, 0).setText('−5 s');
    const endTime = this.text(right, bottom + 7, 10, '#bba98c').setOrigin(1, 0).setText('0 s');
    const grid = this.graphics(0);
    grid.fillStyle(0x110f0c, 0.23).fillRoundedRect(left - 4, top - 4, right - left + 8, bottom - top + 8, 4);
    grid.lineStyle(1, 0xd2bd95, 0.18).lineBetween(left, top, right, top)
      .lineBetween(left, (top + bottom) / 2, right, (top + bottom) / 2);
    grid.lineStyle(1, 0xd2bd95, 0.1).lineBetween((left + right) / 2, top, (left + right) / 2, bottom);
    grid.lineStyle(1, 0xd2bd95, 0.4).lineBetween(left, bottom, right, bottom);
    this.chart = this.graphics(0);
    this.panel.add([backing, grid, this.chart, this.value, this.axisTop, zero, startTime, midTime, endTime]);
  }

  sync(state: ShootingRangeState, now: number): void {
    const signature = JSON.stringify([state.enabled, state.supply, state.count, state.targets]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.panel.setVisible(state.enabled);
      this.syncGround(state);
      this.syncControls(state);
    }
    if (!state.enabled) { this.displayedSession = -1; return; }
    if (this.displayedSession !== state.session || now >= this.nextNumberUpdate) {
      this.displayedSession = state.session;
      this.nextNumberUpdate = now + 250;
      this.value.setFontSize(34).setText(`DPS: ${formatNumber(state.dps, getLocale(), { maximumFractionDigits: 0 })}`);
      const maxValueWidth = this.chartBounds.right - 16;
      if (this.value.width > maxValueWidth) this.value.setFontSize(Math.max(16, 34 * maxValueWidth / this.value.width));
    }
    this.axisTop.setText(formatNumber(state.scale, getLocale(), { notation: 'compact', maximumFractionDigits: 0 }));
    this.drawChart(state, now);
  }

  private syncGround(state: ShootingRangeState): void {
    this.ground.clear();
    this.targetGlows.forEach((glow, slot) => glow.setVisible(state.enabled && !!state.targets[slot]));
    this.supplyGlows.forEach(glow => glow.setVisible(state.enabled && state.supply));
    if (!state.enabled || !state.supply) return;
    // Four short, soft corner accents identify the area without fencing in the landscape.
    const area = SHOOTING_RANGE.supplyArea;
    for (const [gx, gy, dx, dy] of [[area.minX, area.minY, 1, 1], [area.maxX, area.minY, -1, 1],
      [area.minX, area.maxY, 1, -1], [area.maxX, area.maxY, -1, -1]]) {
      const point = worldCellCenter(this.metrics, gx, gy);
      const x = point.x - dx * 10, y = point.y - dy * 10;
      this.ground.lineStyle(5, ESSENCE_PALETTE.halo, 0.06)
        .lineBetween(x, y + dy * 18, x, y).lineBetween(x, y, x + dx * 18, y);
      this.ground.lineStyle(1.2, ESSENCE_PALETTE.body, 0.35)
        .lineBetween(x, y + dy * 18, x, y).lineBetween(x, y, x + dx * 18, y);
    }
  }

  private drawChart(state: ShootingRangeState, now: number): void {
    this.chart.clear();
    const { left, right, top, bottom } = this.chartBounds;
    const points = shootingRangeChartPoints(state, now).map(point => ({
      x: left + point.x * (right - left),
      y: bottom - Math.max(0, Math.min(1, point.value / state.scale)) * (bottom - top),
    }));
    if (!points.length) return;
    const first = points[0], last = points[points.length - 1];
    this.chart.fillStyle(0xefc987, 0.1).beginPath().moveTo(first.x, bottom);
    points.forEach(point => this.chart.lineTo(point.x, point.y));
    this.chart.lineTo(last.x, bottom).closePath().fillPath();
    for (const [width, alpha] of [[5, 0.09], [1.8, 1]]) {
      this.chart.lineStyle(width, 0xffdda0, alpha).beginPath().moveTo(first.x, first.y);
      points.slice(1).forEach(point => this.chart.lineTo(point.x, point.y));
      this.chart.strokePath();
    }
    this.chart.fillStyle(0xfff0cd, 0.95).fillRect(last.x - 1, last.y - 1, 2, 2);
  }

  private syncControls(state: ShootingRangeState): void {
    SHOOTING_RANGE_CONTROLS.forEach((control, index) => {
      const visible = control === 'power' || state.enabled;
      const available = shootingRangeAction(state, control) !== null;
      const active = control === 'power' ? state.enabled : control === 'supply' ? state.supply : available;
      this.controlProps[index].setVisible(visible).setTint(available ? 0xffffff : 0x969c91);
      this.controlIcons[index].setVisible(visible).setTint(!available ? 0x747b72 : active ? 0xffffff : 0xa0a69e);
    });
  }

  destroy(): void {
    this.ground.destroy(); this.panel.destroy(true);
    for (const props of [this.controlProps, this.controlIcons, this.targetGlows, this.supplyGlows]) props.forEach(prop => prop.destroy());
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
