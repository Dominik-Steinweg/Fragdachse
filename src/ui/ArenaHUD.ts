/**
 * ArenaHUD – Premium left-sidebar HUD for the arena phase.
 *
 * Bar rendering inspired by BfgRenderer: multi-layered canvas textures
 * with core + outer energy particle layers using additive blending,
 * giving bars a living, breathing energy-plasma feel.
 *
 * Layout (top→bottom):
 *  1. Spielername (large, scrolling marquee if overflow)
 *  2. HP bar (green gradient) + numeric value
 *  3. Adrenalin bar (blue gradient) + particle burst on gain / syringe
 *  4. Ultimate bar (red gradient) – glow when ready
 *  5. Weapon 1 cooldown (metallic)
 *  6. Weapon 2 cooldown (metallic)
 *  7. Utility cooldown (gold) – wobble on special override
 */
import Phaser from 'phaser';
import {
  HP_MAX, ADRENALINE_MAX, RAGE_MAX,
  COLORS, toCssColor,
} from '../config';

// ── Layout ──────────────────────────────────────────────────────────────────
const PANEL_W   = 240;
const PAD       = 14;
const BAR_X     = PAD;
const BAR_W     = PANEL_W - PAD * 2; // 212
const BAR_H     = 14;

// Vertical rhythm
const NAME_Y    = 16;
const NAME_H    = 28;
const DIV1_Y    = 52;

const HP_LBL_Y  = 62;
const HP_BAR_Y  = 82;

const ADR_LBL_Y = 110;
const ADR_BAR_Y = 130;

const ULT_LBL_Y = 158;
const ULT_BAR_Y = 178;
const DIV2_Y    = 204;

const W1_LBL_Y  = 214;
const W1_BAR_Y  = 234;
const W2_LBL_Y  = 260;
const W2_BAR_Y  = 280;
const UT_LBL_Y  = 306;
const UT_BAR_Y  = 326;

// Fonts
const LABEL_FONT  = { fontSize: '15px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_3) };
const NAME_FONT   = { fontSize: '26px', fontFamily: 'monospace', fontStyle: 'bold' as const, color: '#ffffff' };
const VALUE_FONT  = { fontSize: '12px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_1) };

// ── Colour definitions per bar ──────────────────────────────────────────────
interface BarPalette {
  dark:  number;  // gradient left (darker)
  mid:   number;  // gradient middle
  light: number;  // gradient right / highlight
  spark: number;  // bright spark tint
}

const PAL_HP:   BarPalette = { dark: COLORS.GREEN_4, mid: COLORS.GREEN_3, light: COLORS.GREEN_1, spark: 0xffffff };
const PAL_ADR:  BarPalette = { dark: COLORS.BLUE_4,  mid: COLORS.BLUE_3,  light: COLORS.BLUE_1,  spark: 0xffffff };
const PAL_ULT:  BarPalette = { dark: COLORS.RED_3,   mid: COLORS.RED_2,   light: COLORS.RED_1,   spark: 0xffffff };
const PAL_WPN:  BarPalette = { dark: COLORS.GREY_5,  mid: COLORS.GREY_4,  light: COLORS.GREY_2,  spark: COLORS.GREY_1 };
const PAL_UTIL: BarPalette = { dark: 0x8a4018,  mid: 0xd97030,  light: 0xf0a048,  spark: 0xffffff };

const COL_HP_TRAIL = COLORS.RED_1;
const COL_BAR_BG   = COLORS.GREY_9;
const COL_BAR_BG2  = COLORS.GREY_8;
const COL_BORDER   = COLORS.GREY_6;
const COL_DIVIDER  = COLORS.GREY_7;

// Texture keys
const TEX_PARTICLE   = '_hud_particle';
const TEX_CORE       = '_hud_core';
const TEX_OUTER      = '_hud_outer';
const TEX_SPARK      = '_hud_spark';

// ── Helpers ─────────────────────────────────────────────────────────────────

function hexToRgb(hex: number): { r: number; g: number; b: number } {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff };
}

function rgbStr(hex: number, a = 1): string {
  const { r, g, b } = hexToRgb(hex);
  return a === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}

/** Create a horizontal 3-stop gradient canvas texture with glassy highlight. */
function makeBarGradient(scene: Phaser.Scene, key: string, pal: BarPalette): void {
  if (scene.textures.exists(key)) return;
  const ct = scene.textures.createCanvas(key, BAR_W, BAR_H)!;
  const ctx = ct.context;
  // Main gradient: dark → mid → light
  const grad = ctx.createLinearGradient(0, 0, BAR_W, 0);
  grad.addColorStop(0,   rgbStr(pal.dark));
  grad.addColorStop(0.5, rgbStr(pal.mid));
  grad.addColorStop(1,   rgbStr(pal.light));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, BAR_W, BAR_H);
  // Top highlight for glassy depth
  const topGrad = ctx.createLinearGradient(0, 0, 0, BAR_H);
  topGrad.addColorStop(0, 'rgba(255,255,255,0.3)');
  topGrad.addColorStop(0.4, 'rgba(255,255,255,0.05)');
  topGrad.addColorStop(0.6, 'rgba(0,0,0,0.0)');
  topGrad.addColorStop(1, 'rgba(0,0,0,0.15)');
  ctx.fillStyle = topGrad;
  ctx.fillRect(0, 0, BAR_W, BAR_H);
  ct.refresh();
}

function makeBgTexture(scene: Phaser.Scene, key: string): void {
  if (scene.textures.exists(key)) return;
  const ct = scene.textures.createCanvas(key, BAR_W, BAR_H)!;
  const ctx = ct.context;
  const grad = ctx.createLinearGradient(0, 0, 0, BAR_H);
  grad.addColorStop(0, rgbStr(COL_BAR_BG2));
  grad.addColorStop(1, rgbStr(COL_BAR_BG));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, BAR_W, BAR_H);
  // Inner shadow line at top
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(0, 0, BAR_W, 1);
  ct.refresh();
}

function makeRadialTexture(scene: Phaser.Scene, key: string, size: number, colorStops: [number, string][]): void {
  if (scene.textures.exists(key)) return;
  const ct = scene.textures.createCanvas(key, size, size)!;
  const ctx = ct.context;
  const half = size / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  for (const [stop, color] of colorStops) grad.addColorStop(stop, color);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  ct.refresh();
}

/** Creates a random rectangular emit zone for particles within a bar. */
function rectZone(x: number, y: number, w: number, h: number): {
  zone: Phaser.Geom.Rectangle;
  data: Phaser.Types.GameObjects.Particles.EmitZoneData;
} {
  const rect = new Phaser.Geom.Rectangle(x, y, w, h);
  return {
    zone: rect,
    data: { type: 'random', source: rect } as Phaser.Types.GameObjects.Particles.EmitZoneData,
  };
}

// ── Types ───────────────────────────────────────────────────────────────────

interface BarBundle {
  label:        Phaser.GameObjects.Text;
  bgImg:        Phaser.GameObjects.Image;
  trail?:       Phaser.GameObjects.Rectangle;
  fgImg:        Phaser.GameObjects.Image;
  // Energized mode: small, fast, dense sparkle particles
  coreEmitter:  Phaser.GameObjects.Particles.ParticleEmitter;
  outerEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  // Idle mode: large, slow, overlapping blob particles (fluid feel)
  idleCore:     Phaser.GameObjects.Particles.ParticleEmitter;
  idleOuter:    Phaser.GameObjects.Particles.ParticleEmitter;
  emitZone:     Phaser.Geom.Rectangle; // shared zone, updated in setBarFrac
  border:       Phaser.GameObjects.Rectangle;
  valueText?:   Phaser.GameObjects.Text;
  highlight?:   Phaser.GameObjects.Rectangle;
  palette:      BarPalette;
  texKey:       string;
  prevFrac:     number;
  currentFrac:  number;
  energized:    boolean;       // true = intense sparkle, false = calm breathing
  breathTween:  Phaser.Tweens.Tween | null; // idle glow pulse
  breathGlow:   Phaser.FX.Glow | null;      // idle PostFX glow
}

/** Data pushed every frame from ArenaScene. */
export interface ArenaHUDData {
  hp:                       number;
  adrenaline:               number;
  rage:                     number;
  isUltimateActive:         boolean;
  weapon1CooldownFrac:      number;
  weapon2CooldownFrac:      number;
  utilityCooldownFrac:      number;
  utilityDisplayName?:      string;
  adrenalineSyringeActive?: boolean;
  isUtilityOverridden?:     boolean;
}

// ── Class ───────────────────────────────────────────────────────────────────

export class ArenaHUD {
  private hp!:      BarBundle;
  private adr!:     BarBundle;
  private ult!:     BarBundle;
  private w1!:      BarBundle;
  private w2!:      BarBundle;
  private util!:    BarBundle;

  // Name
  private nameText!:        Phaser.GameObjects.Text;
  private nameMask!:        Phaser.GameObjects.Graphics;
  private nameScrollTween:  Phaser.Tweens.Tween | null = null;

  // Ultimate glow
  private ultGlow:          Phaser.FX.Glow | null = null;
  private ultPulseTween:    Phaser.Tweens.Tween | null = null;
  private wasUltReady       = false;

  // HP catch-up
  private hpTrailDelay:     Phaser.Time.TimerEvent | null = null;

  // Adrenaline burst particles (separate from bar core emitter)
  private adrBurstEmitter:  Phaser.GameObjects.Particles.ParticleEmitter | null = null;

  // Adrenaline syringe state
  private adrSyringeGlow:   Phaser.FX.Glow | null = null;
  private adrSyringeTween:  Phaser.Tweens.Tween | null = null;
  private wasSyringeActive  = false;

  // Utility override
  private utilWobbleGlow:     Phaser.FX.Glow | null = null;
  private utilWobbleTween:    Phaser.Tweens.Tween | null = null;
  private utilLabelPulseTween: Phaser.Tweens.Tween | null = null;
  private wasUtilityOverridden = false;

  private currentUtilityName = '';

  // Adrenaline tick marks (weapon2 cost indicators)
  private adrTickMarks: Phaser.GameObjects.Rectangle[] = [];
  private weapon2AdrCost = 0;
  private w2Insufficient = false;
  private w2RedOverlay!: Phaser.GameObjects.Rectangle;

  constructor(
    private scene: Phaser.Scene,
    private container: Phaser.GameObjects.Container,
  ) {
    this.ensureTextures();
    this.build();
  }

  // ── Textures ──────────────────────────────────────────────────────────────

  private ensureTextures(): void {
    const s = this.scene;
    makeBgTexture(s, '_hud_bar_bg');
    makeBarGradient(s, '_hud_hp',   PAL_HP);
    makeBarGradient(s, '_hud_adr',  PAL_ADR);
    makeBarGradient(s, '_hud_ult',  PAL_ULT);
    makeBarGradient(s, '_hud_wpn',  PAL_WPN);
    makeBarGradient(s, '_hud_util', PAL_UTIL);

    // Soft particle for adrenaline bursts (16x16 radial glow)
    makeRadialTexture(s, TEX_PARTICLE, 16, [
      [0,   'rgba(255,255,255,1)'],
      [0.3, 'rgba(255,255,255,0.6)'],
      [1,   'rgba(255,255,255,0)'],
    ]);

    // Core energy particle (14x14, bright center) — main inner energy
    makeRadialTexture(s, TEX_CORE, 14, [
      [0,   'rgba(255,255,255,1.0)'],
      [0.3, 'rgba(255,255,255,0.7)'],
      [0.6, 'rgba(255,255,255,0.2)'],
      [1,   'rgba(255,255,255,0)'],
    ]);

    // Outer glow particle (20x20, softer, wider spread)
    makeRadialTexture(s, TEX_OUTER, 20, [
      [0,   'rgba(255,255,255,0.8)'],
      [0.3, 'rgba(255,255,255,0.4)'],
      [0.7, 'rgba(255,255,255,0.1)'],
      [1,   'rgba(255,255,255,0)'],
    ]);

    // Spark (6x6, sharp)
    makeRadialTexture(s, TEX_SPARK, 6, [
      [0,   'rgba(255,255,255,1)'],
      [0.5, 'rgba(255,255,255,0.5)'],
      [1,   'rgba(255,255,255,0)'],
    ]);
  }

  // ── Build ─────────────────────────────────────────────────────────────────

  private build(): void {
    const c = this.container;

    // Player name (large, masked for marquee)
    this.nameText = this.scene.add.text(BAR_X, NAME_Y, '', NAME_FONT).setScrollFactor(0);
    c.add(this.nameText);

    // Geometry mask for name overflow clipping.
    // IMPORTANT: create the graphics without adding to the scene display list
    // so it doesn't render as a visible white rectangle.
    this.nameMask = new Phaser.GameObjects.Graphics(this.scene);
    this.nameMask.fillStyle(0xffffff);
    this.nameMask.fillRect(0, 0, PANEL_W, NAME_H + NAME_Y + 4);
    this.nameText.setMask(this.nameMask.createGeometryMask());

    // Dividers
    c.add(this.divider(DIV1_Y));
    c.add(this.divider(DIV2_Y));

    // Bars
    this.hp   = this.createBar(HP_LBL_Y,  HP_BAR_Y,  'HP',        PAL_HP,   '_hud_hp',   { trail: true, value: true });
    this.adr  = this.createBar(ADR_LBL_Y, ADR_BAR_Y, 'Adrenalin', PAL_ADR,  '_hud_adr');
    this.ult  = this.createBar(ULT_LBL_Y, ULT_BAR_Y, 'Ultimate',  PAL_ULT,  '_hud_ult');
    this.w1   = this.createBar(W1_LBL_Y,  W1_BAR_Y,  'Waffe 1',   PAL_WPN,  '_hud_wpn',  { highlight: true });
    this.w2   = this.createBar(W2_LBL_Y,  W2_BAR_Y,  'Waffe 2',   PAL_WPN,  '_hud_wpn',  { highlight: true });
    this.util = this.createBar(UT_LBL_Y,  UT_BAR_Y,  'Utility',   PAL_UTIL, '_hud_util', { highlight: true });

    // Red overlay on weapon 2 bar — shown when adrenaline is insufficient
    this.w2RedOverlay = this.scene.add.rectangle(BAR_X, W2_BAR_Y, BAR_W, BAR_H, COLORS.RED_3)
      .setOrigin(0, 0).setScrollFactor(0).setAlpha(0);
    c.add(this.w2RedOverlay);

    // Adrenaline burst particle emitter (intense, for hit-gain + syringe)
    this.adrBurstEmitter = this.scene.add.particles(0, 0, TEX_PARTICLE, {
      speed:     { min: 15, max: 60 },
      angle:     { min: 220, max: 320 },
      scale:     { start: 0.5, end: 0 },
      alpha:     { start: 0.9, end: 0 },
      lifespan:  { min: 300, max: 600 },
      tint:      [PAL_ADR.light, PAL_ADR.mid, 0xffffff],
      blendMode: Phaser.BlendModes.ADD,
      emitting:  false,
      quantity:  16,
    }).setScrollFactor(0);
    c.add(this.adrBurstEmitter);
  }

  // ── Bar factory ───────────────────────────────────────────────────────────

  private createBar(
    labelY:    number,
    barY:      number,
    labelText: string,
    palette:   BarPalette,
    texKey:    string,
    opts?:     { trail?: boolean; value?: boolean; highlight?: boolean },
  ): BarBundle {
    const c = this.container;
    const s = this.scene;

    const label = s.add.text(BAR_X, labelY, labelText, LABEL_FONT).setScrollFactor(0);
    c.add(label);

    // Background
    const bgImg = s.add.image(BAR_X, barY, '_hud_bar_bg')
      .setOrigin(0, 0).setScrollFactor(0);
    c.add(bgImg);

    // HP trail
    let trail: Phaser.GameObjects.Rectangle | undefined;
    if (opts?.trail) {
      trail = s.add.rectangle(BAR_X, barY, BAR_W, BAR_H, COL_HP_TRAIL)
        .setOrigin(0, 0).setScrollFactor(0);
      c.add(trail);
    }

    // Foreground gradient (cropped)
    const fgImg = s.add.image(BAR_X, barY, texKey)
      .setOrigin(0, 0).setScrollFactor(0);
    fgImg.setCrop(0, 0, BAR_W, BAR_H);
    c.add(fgImg);

    // Shared emit zone (rectangle within the bar area)
    const { zone: emitZone, data: zoneData } = rectZone(BAR_X + 2, barY + 1, BAR_W - 4, BAR_H - 2);

    // ── Idle particles: large, slow, overlapping blobs — fluid/liquid feel ──
    const idleCore = s.add.particles(0, 0, TEX_OUTER, {
      lifespan:  { min: 1200, max: 2500 },
      frequency: 90,
      quantity:  1,
      speedX:    { min: -2, max: 2 },
      speedY:    { min: -1, max: 1 },
      scale:     { start: 1.0, end: 0.4 },
      alpha:     { start: 0.35, end: 0.05 },
      tint:      [palette.mid, palette.dark, palette.light],
      blendMode: Phaser.BlendModes.ADD,
      emitting:  true,
    }).setScrollFactor(0);
    idleCore.addEmitZone(zoneData);
    c.add(idleCore);

    const idleOuter = s.add.particles(0, 0, TEX_OUTER, {
      lifespan:  { min: 2000, max: 3500 },
      frequency: 160,
      quantity:  1,
      speedX:    { min: -1, max: 1 },
      speedY:    { min: -0.5, max: 0.5 },
      scale:     { start: 1.5, end: 0.7 },
      alpha:     { start: 0.2, end: 0.03 },
      tint:      [palette.dark, palette.mid],
      blendMode: Phaser.BlendModes.ADD,
      emitting:  true,
    }).setScrollFactor(0);
    idleOuter.addEmitZone(zoneData);
    c.add(idleOuter);

    // ── Energized particles: small, fast, dense sparkle (BFG core style) ──
    const coreEmitter = s.add.particles(0, 0, TEX_CORE, {
      lifespan:  { min: 200, max: 500 },
      frequency: 30,
      quantity:  2,
      speedX:    { min: -8, max: 8 },
      speedY:    { min: -3, max: 3 },
      scale:     { start: 0.6, end: 0.1 },
      alpha:     { start: 0.9, end: 0 },
      tint:      [palette.light, palette.spark, 0xffffff],
      blendMode: Phaser.BlendModes.ADD,
      emitting:  false,
    }).setScrollFactor(0);
    coreEmitter.addEmitZone(zoneData);
    c.add(coreEmitter);

    const outerEmitter = s.add.particles(0, 0, TEX_OUTER, {
      lifespan:  { min: 400, max: 800 },
      frequency: 50,
      quantity:  1,
      speedX:    { min: -5, max: 5 },
      speedY:    { min: -2, max: 2 },
      scale:     { start: 0.7, end: 0.15 },
      alpha:     { start: 0.5, end: 0 },
      tint:      [palette.mid, palette.light, palette.dark],
      blendMode: Phaser.BlendModes.ADD,
      emitting:  false,
    }).setScrollFactor(0);
    outerEmitter.addEmitZone(zoneData);
    c.add(outerEmitter);

    // Border
    const border = s.add.rectangle(BAR_X, barY, BAR_W, BAR_H)
      .setOrigin(0, 0).setScrollFactor(0)
      .setStrokeStyle(1, COL_BORDER)
      .setFillStyle(0x000000, 0);
    c.add(border);

    // Value text
    let valueText: Phaser.GameObjects.Text | undefined;
    if (opts?.value) {
      valueText = s.add.text(BAR_X + BAR_W, labelY, '', VALUE_FONT)
        .setOrigin(1, 0).setScrollFactor(0);
      c.add(valueText);
    }

    // Fire highlight
    let highlight: Phaser.GameObjects.Rectangle | undefined;
    if (opts?.highlight) {
      highlight = s.add.rectangle(BAR_X - 4, barY - 4, BAR_W + 8, BAR_H + 8, palette.mid, 0)
        .setOrigin(0, 0).setScrollFactor(0);
      c.add(highlight);
      c.sendToBack(highlight);
    }

    // Start in idle mode with breathing PostFX glow
    const breathGlow = fgImg.postFX.addGlow(palette.mid, 0, 0, false, 0.1, 6);
    const breathTween = s.tweens.add({
      targets: breathGlow,
      outerStrength: 2.5,
      duration: 2000,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    return { label, bgImg, trail, fgImg, coreEmitter, outerEmitter, idleCore, idleOuter, emitZone, border, valueText, highlight, palette, texKey, prevFrac: 1, currentFrac: 1, energized: false, breathTween, breathGlow };
  }

  private divider(y: number): Phaser.GameObjects.Rectangle {
    return this.scene.add.rectangle(BAR_X, y, BAR_W, 1, COL_DIVIDER, 0.5)
      .setOrigin(0, 0).setScrollFactor(0);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  setPlayerInfo(name: string, color: number): void {
    this.nameText.setText(name);
    this.nameText.setColor(toCssColor(color));
    this.setupNameScroll();
  }

  setLoadoutNames(weapon1: string, weapon2: string, utility: string, ultimate: string): void {
    this.w1.label.setText(`Waffe 1: ${weapon1}`);
    this.w2.label.setText(`Waffe 2: ${weapon2}`);
    this.util.label.setText(`Utility: ${utility}`);
    this.ult.label.setText(`Ultimate: ${ultimate}`);
    this.currentUtilityName = utility;
  }

  update(data: ArenaHUDData): void {
    this.updateHP(data.hp);
    this.updateAdrenaline(data.adrenaline, data.adrenalineSyringeActive ?? false);
    this.updateUltimate(data.rage, data.isUltimateActive);
    this.updateCooldownBar(this.w1, data.weapon1CooldownFrac);
    this.updateCooldownBar(this.w2, data.weapon2CooldownFrac);
    this.updateCooldownBar(this.util, data.utilityCooldownFrac);

    if (data.utilityDisplayName && data.utilityDisplayName !== this.currentUtilityName) {
      this.onUtilityNameChanged(data.utilityDisplayName);
    }
    this.updateUtilityOverrideVisual(data.isUtilityOverridden ?? false);
  }

  flashSlot(slot: 'weapon1' | 'weapon2' | 'utility'): void {
    const bundle = slot === 'weapon1' ? this.w1 : slot === 'weapon2' ? this.w2 : this.util;
    if (!bundle.highlight) return;
    this.scene.tweens.killTweensOf(bundle.highlight);
    bundle.highlight.setAlpha(0.4);
    this.scene.tweens.add({
      targets: bundle.highlight,
      alpha: 0,
      duration: 350,
      ease: 'Power2',
    });
  }

  /**
   * Set weapon 2 adrenaline cost per shot. Creates tick marks on the adrenaline
   * bar showing how much each shot costs. Only shown if cost >= 5.
   */
  setAdrenalinTickCost(cost: number): void {
    // Clean up old tick marks
    for (const mark of this.adrTickMarks) mark.destroy();
    this.adrTickMarks = [];
    this.weapon2AdrCost = cost;

    if (cost < 5) return;

    // Create subtle tick marks at each cost interval
    const steps = Math.floor(ADRENALINE_MAX / cost);
    for (let i = 1; i <= steps; i++) {
      const frac = (i * cost) / ADRENALINE_MAX;
      const x = BAR_X + Math.round(BAR_W * frac);
      const mark = this.scene.add.rectangle(x, ADR_BAR_Y + 2, 1, BAR_H - 4, 0xffffff, 0.3)
        .setOrigin(0.5, 0).setScrollFactor(0);
      this.container.add(mark);
      this.adrTickMarks.push(mark);
    }
  }

  reset(): void {
    this.removeUltGlow();
    this.wasUltReady = false;
    this.hp.prevFrac = 1; this.hp.currentFrac = 1;
    this.adr.prevFrac = 1; this.adr.currentFrac = 1;
    this.ult.prevFrac = 0; this.ult.currentFrac = 0;
    this.w1.prevFrac = 0; this.w1.currentFrac = 0;
    this.w2.prevFrac = 0; this.w2.currentFrac = 0;
    this.util.prevFrac = 0; this.util.currentFrac = 0;
    this.hpTrailDelay?.remove();
    this.hpTrailDelay = null;
    this.removeAdrSyringe();
    this.removeUtilWobble();
    this.wasSyringeActive = false;
    this.wasUtilityOverridden = false;
    this.w2Insufficient = false;
    this.w2RedOverlay.setAlpha(0);
    for (const mark of this.adrTickMarks) mark.destroy();
    this.adrTickMarks = [];
    this.weapon2AdrCost = 0;
    // Reset all bars to idle breathing mode
    for (const b of [this.hp, this.adr, this.ult, this.w1, this.w2, this.util]) {
      b.energized = true; // force re-apply
      this.setBarEnergized(b, false);
    }
    if (this.nameScrollTween) {
      this.nameScrollTween.destroy();
      this.nameScrollTween = null;
    }
    this.nameText.x = BAR_X;
  }

  destroy(): void {
    this.removeUltGlow();
    this.hpTrailDelay?.remove();
    this.removeAdrSyringe();
    this.removeUtilWobble();
    for (const b of [this.hp, this.adr, this.ult, this.w1, this.w2, this.util]) {
      b.breathTween?.destroy();
      if (b.breathGlow) b.fgImg.postFX.remove(b.breathGlow);
    }
    if (this.nameScrollTween) this.nameScrollTween.destroy();
    this.nameMask.destroy();
    this.adrBurstEmitter?.destroy();
  }

  // ── Name marquee ──────────────────────────────────────────────────────────

  private setupNameScroll(): void {
    if (this.nameScrollTween) {
      this.nameScrollTween.destroy();
      this.nameScrollTween = null;
    }
    this.nameText.x = BAR_X;

    const textWidth = this.nameText.width;
    const maxWidth = BAR_W;
    if (textWidth <= maxWidth) return;

    const overflow = textWidth - maxWidth;
    this.nameScrollTween = this.scene.tweens.add({
      targets: this.nameText,
      x: BAR_X - overflow,
      duration: overflow * 30,
      ease: 'Linear',
      yoyo: true,
      hold: 1500,
      repeatDelay: 1500,
      repeat: -1,
    });
  }

  // ── HP ────────────────────────────────────────────────────────────────────

  private updateHP(hp: number): void {
    const frac = Math.max(0, Math.min(1, hp / HP_MAX));
    const prev = this.hp.prevFrac;

    this.setBarFrac(this.hp, frac);
    this.hp.valueText?.setText(`${Math.round(hp)}/${HP_MAX}`);

    if (frac < prev - 0.005) {
      this.hpTrailDelay?.remove();
      this.hpTrailDelay = this.scene.time.delayedCall(400, () => {
        this.scene.tweens.add({
          targets: this.hp.trail,
          width: BAR_W * frac,
          duration: 600,
          ease: 'Power2',
        });
        this.hpTrailDelay = null;
      });
      this.flashBorder(this.hp, COLORS.RED_2);
      this.shakeBar(this.hp);
    } else if (frac > prev + 0.005) {
      if (this.hp.trail) this.hp.trail.width = BAR_W * frac;
      this.flashBar(this.hp);
    }

    this.hp.prevFrac = frac;
  }

  // ── Adrenaline ────────────────────────────────────────────────────────────

  private updateAdrenaline(adrenaline: number, syringeActive: boolean): void {
    const frac = Math.max(0, Math.min(1, adrenaline / ADRENALINE_MAX));
    const prev = this.adr.prevFrac;

    this.setBarFrac(this.adr, frac);

    // Intense particle burst on gain (hit reward)
    if (frac > prev + 0.01) {
      this.flashBar(this.adr);
      this.emitAdrBurst(frac);
    }

    // Syringe: energized particles + glow
    this.setBarEnergized(this.adr, syringeActive);
    if (syringeActive && !this.wasSyringeActive) {
      this.startAdrSyringe();
    } else if (!syringeActive && this.wasSyringeActive) {
      this.removeAdrSyringe();
    }
    this.wasSyringeActive = syringeActive;

    // Weapon 2 insufficient adrenaline indicator
    this.updateW2InsufficientIndicator(adrenaline);

    this.adr.prevFrac = frac;
  }

  private emitAdrBurst(frac: number): void {
    if (!this.adrBurstEmitter) return;
    const px = BAR_X + BAR_W * frac;
    const py = ADR_BAR_Y + BAR_H / 2;
    this.adrBurstEmitter.setPosition(px, py);
    this.adrBurstEmitter.explode(16);
  }

  /** Show red background on weapon 2 bar when adrenaline is too low for a single shot. */
  private updateW2InsufficientIndicator(adrenaline: number): void {
    if (this.weapon2AdrCost <= 0) return;
    const insufficient = adrenaline < this.weapon2AdrCost;
    if (insufficient === this.w2Insufficient) return;
    this.w2Insufficient = insufficient;
    if (insufficient) {
      this.scene.tweens.killTweensOf(this.w2RedOverlay);
      this.scene.tweens.add({
        targets: this.w2RedOverlay,
        alpha: 0.45,
        duration: 200,
        ease: 'Quad.easeOut',
      });
    } else {
      this.scene.tweens.killTweensOf(this.w2RedOverlay);
      this.scene.tweens.add({
        targets: this.w2RedOverlay,
        alpha: 0,
        duration: 300,
        ease: 'Quad.easeIn',
      });
    }
  }

  private startAdrSyringe(): void {
    if (this.adrSyringeGlow) return;
    this.adrSyringeGlow = this.adr.fgImg.postFX.addGlow(PAL_ADR.light, 2, 0, false, 0.2, 8);
    this.adrSyringeTween = this.scene.tweens.add({
      targets: this.adrSyringeGlow,
      outerStrength: 6,
      duration: 500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private removeAdrSyringe(): void {
    if (this.adrSyringeTween) {
      this.adrSyringeTween.destroy();
      this.adrSyringeTween = null;
    }
    if (this.adrSyringeGlow) {
      this.adr.fgImg.postFX.remove(this.adrSyringeGlow);
      this.adrSyringeGlow = null;
    }
  }

  // ── Ultimate ──────────────────────────────────────────────────────────────

  private updateUltimate(rage: number, isActive: boolean): void {
    const frac = Math.max(0, Math.min(1, rage / RAGE_MAX));
    const prev = this.ult.prevFrac;
    this.setBarFrac(this.ult, frac);

    if (frac > prev + 0.01) {
      this.flashBar(this.ult);
    }

    const isReady = frac >= 1 || isActive;
    this.setBarEnergized(this.ult, isReady);
    if (isReady && !this.wasUltReady) this.addUltGlow();
    else if (!isReady && this.wasUltReady) this.removeUltGlow();
    this.wasUltReady = isReady;
    this.ult.prevFrac = frac;
  }

  private addUltGlow(): void {
    if (this.ultGlow) return;
    this.ultGlow = this.ult.fgImg.postFX.addGlow(0xff3300, 4, 0, false, 0.3, 10);
    this.ultPulseTween = this.scene.tweens.add({
      targets: this.ultGlow,
      outerStrength: 8,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private removeUltGlow(): void {
    if (this.ultPulseTween) { this.ultPulseTween.destroy(); this.ultPulseTween = null; }
    if (this.ultGlow) { this.ult.fgImg.postFX.remove(this.ultGlow); this.ultGlow = null; }
  }

  // ── Cooldown bars ─────────────────────────────────────────────────────────

  private updateCooldownBar(bundle: BarBundle, cooldownFrac: number): void {
    const readyFrac = Math.max(0, Math.min(1, 1 - cooldownFrac));
    this.setBarFrac(bundle, readyFrac);

    if (readyFrac >= 1 && bundle.prevFrac < 0.99) {
      this.flashBar(bundle);
    }
    bundle.prevFrac = readyFrac;
  }

  // ── Utility override visual ───────────────────────────────────────────────

  private onUtilityNameChanged(newName: string): void {
    this.currentUtilityName = newName;
    this.util.label.setText(`Utility: ${newName}`);
    this.scene.tweens.killTweensOf(this.util.label);
    this.util.label.setScale(1);
    this.scene.tweens.add({
      targets: this.util.label,
      scaleX: 1.12,
      scaleY: 1.12,
      duration: 120,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  private updateUtilityOverrideVisual(isOverridden: boolean): void {
    this.setBarEnergized(this.util, isOverridden);
    if (isOverridden && !this.wasUtilityOverridden) this.startUtilWobble();
    else if (!isOverridden && this.wasUtilityOverridden) this.removeUtilWobble();
    this.wasUtilityOverridden = isOverridden;
  }

  private startUtilWobble(): void {
    if (this.utilWobbleGlow) return;
    this.utilWobbleGlow = this.util.fgImg.postFX.addGlow(PAL_UTIL.light, 3, 0, false, 0.4, 8);
    this.utilWobbleTween = this.scene.tweens.add({
      targets: this.utilWobbleGlow,
      outerStrength: 8,
      duration: 400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.utilLabelPulseTween = this.scene.tweens.add({
      targets: this.util.label,
      scaleX: 1.06,
      scaleY: 1.06,
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private removeUtilWobble(): void {
    if (this.utilWobbleTween) { this.utilWobbleTween.destroy(); this.utilWobbleTween = null; }
    if (this.utilWobbleGlow) { this.util.fgImg.postFX.remove(this.utilWobbleGlow); this.utilWobbleGlow = null; }
    if (this.utilLabelPulseTween) { this.utilLabelPulseTween.destroy(); this.utilLabelPulseTween = null; }
    this.util.label.setScale(1);
  }

  // ── Bar intensity mode ──────────────────────────────────────────────────

  /**
   * Switch a bar between calm idle (breathing fluid) and energized (intense sparkle) mode.
   * Modular — can be called for any bar from any trigger.
   */
  private setBarEnergized(bundle: BarBundle, energized: boolean): void {
    if (bundle.energized === energized) return;
    bundle.energized = energized;
    const hasFill = bundle.currentFrac > 0.03;

    if (energized) {
      // Stop idle blobs, start energized sparkle
      bundle.idleCore.stop();
      bundle.idleOuter.stop();
      if (hasFill) {
        bundle.coreEmitter.start();
        bundle.outerEmitter.start();
      }
      // Remove breathing glow
      if (bundle.breathTween) { bundle.breathTween.destroy(); bundle.breathTween = null; }
      if (bundle.breathGlow) { bundle.fgImg.postFX.remove(bundle.breathGlow); bundle.breathGlow = null; }
    } else {
      // Stop energized sparkle, start idle blobs
      bundle.coreEmitter.stop();
      bundle.outerEmitter.stop();
      if (hasFill) {
        bundle.idleCore.start();
        bundle.idleOuter.start();
      }
      // Start breathing glow
      if (!bundle.breathGlow) {
        bundle.breathGlow = bundle.fgImg.postFX.addGlow(bundle.palette.mid, 0, 0, false, 0.1, 6);
        bundle.breathTween = this.scene.tweens.add({
          targets: bundle.breathGlow,
          outerStrength: 2.5,
          duration: 2000,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
      }
    }
  }

  // ── Shared bar helpers ────────────────────────────────────────────────────

  /** Set the visible fill fraction and constrain particles to the filled area. */
  private setBarFrac(bundle: BarBundle, frac: number): void {
    const w = Math.max(0, Math.round(BAR_W * frac));
    bundle.fgImg.setCrop(0, 0, w, BAR_H);
    bundle.currentFrac = frac;

    // Update the shared emit zone rectangle — all 4 emitters reference this.
    if (w > 6) {
      bundle.emitZone.width = w - 4;
      if (bundle.energized) {
        if (!bundle.coreEmitter.emitting) bundle.coreEmitter.start();
        if (!bundle.outerEmitter.emitting) bundle.outerEmitter.start();
      } else {
        if (!bundle.idleCore.emitting) bundle.idleCore.start();
        if (!bundle.idleOuter.emitting) bundle.idleOuter.start();
      }
    } else {
      bundle.coreEmitter.stop();
      bundle.outerEmitter.stop();
      bundle.idleCore.stop();
      bundle.idleOuter.stop();
    }
  }

  /** Quick flash effect on bar (border highlight). */
  private flashBar(bundle: BarBundle): void {
    bundle.border.setStrokeStyle(2, bundle.palette.light);
    this.scene.tweens.add({
      targets: bundle.border,
      alpha: { from: 1, to: 0.6 },
      duration: 150,
      yoyo: true,
      onComplete: () => {
        bundle.border.setStrokeStyle(1, COL_BORDER);
        bundle.border.setAlpha(1);
      },
    });
  }

  /** Flash border with a specific color (damage). */
  private flashBorder(bundle: BarBundle, flashColor: number): void {
    bundle.border.setStrokeStyle(2, flashColor);
    this.scene.tweens.add({
      targets: bundle.border,
      alpha: { from: 1, to: 0.5 },
      duration: 100,
      yoyo: true,
      onComplete: () => {
        bundle.border.setStrokeStyle(1, COL_BORDER);
        bundle.border.setAlpha(1);
      },
    });
  }

  /** Shake bar elements horizontally. */
  private shakeBar(bundle: BarBundle): void {
    const targets = [bundle.bgImg, bundle.fgImg, bundle.border, bundle.trail].filter(Boolean);
    const origX = BAR_X;
    this.scene.tweens.add({
      targets,
      x: origX + 3,
      duration: 40,
      yoyo: true,
      repeat: 2,
      ease: 'Linear',
      onComplete: () => {
        for (const t of targets) (t as any).x = origX;
      },
    });
  }
}
