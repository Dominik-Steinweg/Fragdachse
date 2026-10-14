import * as Phaser from 'phaser';
import { DEPTH, GAME_WIDTH } from '../../config';
import { dawnClockTexture, type DawnClockPart } from '../../assets/DawnClockAssets';
import type { DawnSchedule } from '../../config/dawn/dawnContent';
import type { DawnActivityPlan } from '../../dawn/contracts/DawnPlans';
import type { CoopDefenseMapConfig } from '../../config/coopDefenseMaps';
import { promoteToClarityCamera } from '../../scenes/arena/ClarityCameraRegistry';
import { hudTextStyle, HUD_TEXT_PRIMARY } from '../HudCard';
import { buildDawnSundialLayout, buildDawnSundialState, type DawnSundialLayout } from './DawnSundialClockModel';

/** All kit layers share the untrimmed 300×160 canvas and pivot (150,140). */
export class DawnSundialClock {
  readonly root: Phaser.GameObjects.Container;
  private readonly dial: Phaser.GameObjects.Container;
  private readonly sectors: Phaser.GameObjects.Graphics;
  private readonly elapsed: Phaser.GameObjects.Graphics;
  private readonly glint: Phaser.GameObjects.Graphics;
  private readonly symbols: Phaser.GameObjects.Container;
  private readonly notches: Phaser.GameObjects.Container;
  private readonly hand: Phaser.GameObjects.Image;
  private readonly tip: Phaser.GameObjects.Image;
  private readonly modifier: Phaser.GameObjects.Image;
  private readonly label: Phaser.GameObjects.Text;
  private layout: DawnSundialLayout | null = null;
  private phase = '';
  private glintStart = -Infinity;
  private lastElapsedAngle = -Infinity;

  constructor(private readonly scene: Phaser.Scene) {
    this.root = scene.add.container(GAME_WIDTH / 2, 8).setDepth(DEPTH.OVERLAY).setScrollFactor(0).setVisible(false);
    this.dial = scene.add.container(0, 70).setScale(0.5);
    this.root.add(this.dial);
    // Manifest order: face → sectors → grain → elapsed → frame → icons → notches → hand → tip → hub.
    this.part('face');
    this.sectors = this.graphics();
    this.part('arc-grain');
    this.elapsed = this.graphics();
    this.glint = this.graphics();
    this.part('frame');
    this.symbols = scene.add.container(); this.dial.add(this.symbols);
    this.notches = scene.add.container(); this.dial.add(this.notches);
    this.hand = this.part('hand');
    this.tip = this.part('tip-sun');
    this.part('medallion');
    // Existing modifier assets have a circular alpha silhouette, inside the radius-16 slot at 30px.
    this.modifier = scene.add.image(0, 0, '__WHITE').setDisplaySize(30, 30).setVisible(false);
    this.dial.add(this.modifier);
    this.label = scene.add.text(0, 84, '', hudTextStyle(15, HUD_TEXT_PRIMARY, true)).setOrigin(0.5, 0);
    this.root.add(this.label);
    promoteToClarityCamera(scene, this.root);
  }

  private part(part: DawnClockPart, parent = this.dial): Phaser.GameObjects.Image {
    const image = this.scene.add.image(0, 0, dawnClockTexture(part)).setOrigin(0.5, 0.875).setDisplaySize(300, 160);
    parent.add(image);
    return image;
  }

  private graphics(): Phaser.GameObjects.Graphics {
    const graphics = this.scene.add.graphics(); this.dial.add(graphics); return graphics;
  }

  private ring(graphics: Phaser.GameObjects.Graphics, start: number, end: number, color: number, alpha = 1): void {
    if (end <= start) return;
    const from = start * Math.PI / 180, to = end * Math.PI / 180;
    graphics.fillStyle(color, alpha).beginPath();
    graphics.arc(0, 0, 119, from, to, false);
    graphics.arc(0, 0, 86, to, from, true);
    graphics.closePath().fillPath();
  }

  setRound(schedule: DawnSchedule, encounters: CoopDefenseMapConfig['encounters']): void {
    this.clear();
    this.layout = buildDawnSundialLayout(schedule, encounters);
    this.sectors.clear();
    for (const segment of this.layout.segments) this.ring(this.sectors, segment.startAngle, segment.endAngle, segment.color);
    this.symbols.removeAll(true); this.notches.removeAll(true);
    const night = this.layout.segments.find(segment => segment.phase === 'night');
    for (const [part, angle] of [['icon-sun', 180], ['icon-sunrise', 360], ['icon-moon', night?.startAngle ?? 270]] as const) {
      const radians = angle * Math.PI / 180;
      const x = Math.cos(radians) * 103, y = Math.sin(radians) * 103;
      const backing = this.scene.add.circle(x, y, 14, 0x1b1a17, 0.9);
      this.symbols.add(backing);
      // Glyph's canonical center is 103px above the common origin; keep it upright.
      this.part(part, this.symbols).setPosition(x, y + 103);
    }
    for (const notch of this.layout.notches) this.part(notch.finale ? 'notch-final' : 'notch-wave', this.notches).setAngle(notch.angle);
  }

  sync(schedule: DawnSchedule, plan: DawnActivityPlan, elapsedMs: number, presentationMs: number): void {
    if (!this.layout) return;
    const state = buildDawnSundialState(schedule, plan, this.layout, elapsedMs);
    this.root.setVisible(true);
    this.hand.setAngle(state.handAngle);
    this.tip.setTexture(dawnClockTexture(state.tip)).setDisplaySize(300, 160).setAngle(state.handAngle);
    this.modifier.setVisible(state.modifierIcon !== null);
    if (state.modifierIcon) this.modifier.setTexture(state.modifierIcon).setDisplaySize(30, 30);
    if (this.label.text !== state.label) this.label.setText(state.label);
    if (this.phase !== state.phase) {
      if (this.phase) this.glintStart = presentationMs;
      this.phase = state.phase;
    }
    // A quarter degree is under 0.3 design pixels at the outer rim. Leave static sectors alone.
    if (Math.abs(state.elapsedEndAngle - this.lastElapsedAngle) >= 0.25
      || (state.progress === 0 || state.progress === 1) && state.elapsedEndAngle !== this.lastElapsedAngle) {
      this.lastElapsedAngle = state.elapsedEndAngle;
      this.elapsed.clear(); this.ring(this.elapsed, 180, state.elapsedEndAngle, 0x000000, 0.42);
    }
    this.layout.notches.forEach((notch, index) => {
      const image = this.notches.list[index] as Phaser.GameObjects.Image;
      const pulse = notch.id === state.pulsingNotch ? (Math.sin(presentationMs / 140) + 1) / 2 : 0;
      if (pulse > 0) image.setTint(Phaser.Display.Color.GetColor(143 + Math.round(pulse * 80), 47 + Math.round(pulse * 18), 36)).setTintMode(Phaser.TintModes.FILL);
      else image.clearTint().setTint(notch.atMs <= elapsedMs ? 0x999999 : 0xffffff);
    });
    this.glint.clear();
    const shine = (presentationMs - this.glintStart) / 650;
    if (shine >= 0 && shine < 1) {
      const angle = 180 + shine * 180;
      this.ring(this.glint, Math.max(180, angle - 14), Math.min(360, angle + 14), 0xd6b978, Math.sin(shine * Math.PI) * 0.32);
    }
  }

  clear(): void {
    this.root.setVisible(false); this.phase = ''; this.glintStart = -Infinity; this.lastElapsedAngle = -Infinity;
    this.elapsed.clear(); this.glint.clear();
    if (this.layout) {
      this.layout = null; this.sectors.clear();
      this.symbols.removeAll(true); this.notches.removeAll(true);
    }
  }

  getReservedHudRects() {
    return this.root.visible ? [{ left: GAME_WIDTH / 2 - 110, right: GAME_WIDTH / 2 + 110, top: 8, bottom: 108 }] : [];
  }

  destroy(): void { this.root.destroy(); }
}
