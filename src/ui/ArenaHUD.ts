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
 *  3. Armor bar (gold gradient) + numeric value
 *  4. Adrenalin bar (blue gradient) + particle burst on gain / syringe
 *  5. Ultimate bar (red gradient) – glow when ready
 *  6. Weapon 1 cooldown (metallic)
 *  7. Weapon 2 cooldown (metallic)
 *  8. Utility cooldown (gold) – wobble on special override
 */
import Phaser from 'phaser';
import {
  ARMOR_COLOR, ARMOR_MAX,
  HP_MAX, ADRENALINE_MAX, RAGE_MAX,
  COLORS, toCssColor,
} from '../config';
import { POWERUP_DEFS } from '../powerups/PowerUpConfig';
import {
  type LivingBarPalette,
  rgbStr, createGradientTexture, rectZone,
  ensureLivingBarTextures, LivingBarEffect,
} from './LivingBarEffect';

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

const ARM_LBL_Y = 110;
const ARM_BAR_Y = 130;

const ADR_LBL_Y = 158;
const ADR_BAR_Y = 178;

const ULT_LBL_Y = 206;
const ULT_BAR_Y = 226;
const DIV2_Y    = 252;

const W1_LBL_Y  = 262;
const W1_BAR_Y  = 282;
const W2_LBL_Y  = 308;
const W2_BAR_Y  = 328;
const UT_LBL_Y  = 354;
const UT_BAR_Y  = 374;

// Power-Up section (below utility bar)
const DIV3_Y        = 400;
const PU_SECTION_Y  = 410; // Y start for the power-up section

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
const PAL_ARM:  BarPalette = paletteFromColor(ARMOR_COLOR);
const PAL_ADR:  BarPalette = { dark: COLORS.BLUE_4,  mid: COLORS.BLUE_3,  light: COLORS.BLUE_1,  spark: 0xffffff };
const PAL_ULT:  BarPalette = { dark: COLORS.RED_3,   mid: COLORS.RED_2,   light: COLORS.RED_1,   spark: 0xffffff };
const PAL_WPN:  BarPalette = { dark: COLORS.GREY_5,  mid: COLORS.GREY_4,  light: COLORS.GREY_2,  spark: COLORS.GREY_1 };
const PAL_UTIL: BarPalette = { dark: 0x8a4018,  mid: 0xd97030,  light: 0xf0a048,  spark: 0xffffff };

const COL_HP_TRAIL = COLORS.RED_1;
const COL_BAR_BG   = COLORS.GREY_9;
const COL_BAR_BG2  = COLORS.GREY_8;
const COL_BORDER   = COLORS.GREY_6;
const COL_DIVIDER  = COLORS.GREY_7;

// Texture keys (energized-mode particles, specific to ArenaHUD)
const TEX_PARTICLE   = '_hud_particle';
const TEX_CORE       = '_hud_core';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Derive a full BarPalette from a single base colour by shifting brightness. */
function paletteFromColor(base: number): BarPalette {
  const r = (base >> 16) & 0xff;
  const g = (base >> 8) & 0xff;
  const b = base & 0xff;
  const darken  = (v: number, f: number) => Math.max(0, Math.round(v * f));
  const lighten = (v: number, f: number) => Math.min(255, Math.round(v + (255 - v) * f));
  const toHex   = (rv: number, gv: number, bv: number) => (rv << 16) | (gv << 8) | bv;
  return {
    dark:  toHex(darken(r, 0.55), darken(g, 0.55), darken(b, 0.55)),
    mid:   base,
    light: toHex(lighten(r, 0.35), lighten(g, 0.35), lighten(b, 0.35)),
    spark: 0xffffff,
  };
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

// ── Types ───────────────────────────────────────────────────────────────────

interface BarBundle {
  label:        Phaser.GameObjects.Text;
  bgImg:        Phaser.GameObjects.Image;
  trail?:       Phaser.GameObjects.Rectangle;
  fgImg:        Phaser.GameObjects.Image;
  // Energized mode: small, fast, dense sparkle particles
  coreEmitter:  Phaser.GameObjects.Particles.ParticleEmitter;
  outerEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  energyZone:   Phaser.Geom.Rectangle; // emit zone for energized emitters
  // Idle mode: reusable breathing effect
  idleEffect:   LivingBarEffect;
  border:       Phaser.GameObjects.Rectangle;
  valueText?:   Phaser.GameObjects.Text;
  highlight?:   Phaser.GameObjects.Rectangle;
  palette:      BarPalette;
  texKey:       string;
  prevFrac:     number;
  currentFrac:  number;
  renderedWidth: number;
  energized:    boolean;       // true = intense sparkle, false = calm breathing
}

/** Info about a single active power-up buff for HUD display. */
export interface ActivePowerUpInfo {
  defId:         string;
  remainingFrac: number; // 1 = full, 0 = expired
}

/** Data pushed every frame from ArenaScene. */
export interface ArenaHUDData {
  hp:                       number;
  armor:                    number;
  adrenaline:               number;
  rage:                     number;
  isUltimateActive:         boolean;
  weapon1CooldownFrac:      number;
  weapon2CooldownFrac:      number;
  utilityCooldownFrac:      number;
  utilityDisplayName?:      string;
  adrenalineSyringeActive?: boolean;
  isUtilityOverridden?:     boolean;
  activePowerUps?:          ActivePowerUpInfo[];
}

// ── Class ───────────────────────────────────────────────────────────────────

export class ArenaHUD {
  private hp!:      BarBundle;
  private armor!:   BarBundle;
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
  private armorTrailDelay:  Phaser.Time.TimerEvent | null = null;

  // Adrenaline burst particles (separate from bar core emitter)
  private adrBurstEmitter:  Phaser.GameObjects.Particles.ParticleEmitter | null = null;

  // Adrenaline syringe state
  private adrSyringeGlow:   Phaser.FX.Glow | null = null;
  private adrSyringeTween:  Phaser.Tweens.Tween | null = null;
  private wasSyringeActive  = false;
  private lastHpText: string | null = null;
  private lastArmorText: string | null = null;

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

  // Power-Up section
  private puDivider!:   Phaser.GameObjects.Rectangle;
  private puNoneLabel!: Phaser.GameObjects.Text;
  /** Currently visible power-up bar entries (keyed by defId), using full BarBundle. */
  private puEntries = new Map<string, BarBundle>();
  /** Ordered list of currently shown defIds (for layout). */
  private puOrder: string[] = [];

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
    ensureLivingBarTextures(s);

    // Bar gradient textures
    createGradientTexture(s, '_hud_hp',   PAL_HP,   BAR_W, BAR_H);
    createGradientTexture(s, '_hud_arm',  PAL_ARM,  BAR_W, BAR_H);
    createGradientTexture(s, '_hud_adr',  PAL_ADR,  BAR_W, BAR_H);
    createGradientTexture(s, '_hud_ult',  PAL_ULT,  BAR_W, BAR_H);
    createGradientTexture(s, '_hud_wpn',  PAL_WPN,  BAR_W, BAR_H);
    createGradientTexture(s, '_hud_util', PAL_UTIL, BAR_W, BAR_H);

    // Adrenaline burst particle (16x16 radial glow)
    makeRadialTexture(s, TEX_PARTICLE, 16, [
      [0,   'rgba(255,255,255,1)'],
      [0.3, 'rgba(255,255,255,0.6)'],
      [1,   'rgba(255,255,255,0)'],
    ]);

    // Energized-mode core particle (14x14, bright center)
    makeRadialTexture(s, TEX_CORE, 14, [
      [0,   'rgba(255,255,255,1.0)'],
      [0.3, 'rgba(255,255,255,0.7)'],
      [0.6, 'rgba(255,255,255,0.2)'],
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
    this.armor = this.createBar(ARM_LBL_Y, ARM_BAR_Y, 'Armor',    PAL_ARM,  '_hud_arm',  { trail: true, value: true, trailColor: ARMOR_COLOR });
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

    // Power-Up section
    this.puDivider = this.divider(DIV3_Y);
    c.add(this.puDivider);
    this.puNoneLabel = this.scene.add.text(BAR_X, PU_SECTION_Y, 'Power-Up: keins', LABEL_FONT).setScrollFactor(0);
    c.add(this.puNoneLabel);
  }

  // ── Bar factory ───────────────────────────────────────────────────────────

  private createBar(
    labelY:    number,
    barY:      number,
    labelText: string,
    palette:   BarPalette,
    texKey:    string,
    opts?:     { trail?: boolean; value?: boolean; highlight?: boolean; trailColor?: number },
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
      trail = s.add.rectangle(BAR_X, barY, BAR_W, BAR_H, opts.trailColor ?? COL_HP_TRAIL)
        .setOrigin(0, 0).setScrollFactor(0);
      c.add(trail);
    }

    // Foreground gradient (cropped)
    const fgImg = s.add.image(BAR_X, barY, texKey)
      .setOrigin(0, 0).setScrollFactor(0);
    fgImg.setCrop(0, 0, BAR_W, BAR_H);
    c.add(fgImg);

    // Idle breathing effect (shared LivingBarEffect)
    const idlePal: LivingBarPalette = { dark: palette.dark, mid: palette.mid, light: palette.light };
    const idleEffect = new LivingBarEffect(s, c, BAR_X, barY, BAR_W, BAR_H, idlePal,
      { glowTarget: fgImg, scrollFactor: 0 });

    // Energized particles: small, fast, dense sparkle (BFG core style)
    const { zone: energyZone, data: energyZoneData } = rectZone(BAR_X + 2, barY + 1, BAR_W - 4, BAR_H - 2);

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
    coreEmitter.addEmitZone(energyZoneData);
    c.add(coreEmitter);

    const outerEmitter = s.add.particles(0, 0, '_living_blob', {
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
    outerEmitter.addEmitZone(energyZoneData);
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

    return {
      label,
      bgImg,
      trail,
      fgImg,
      coreEmitter,
      outerEmitter,
      energyZone,
      idleEffect,
      border,
      valueText,
      highlight,
      palette,
      texKey,
      prevFrac: 1,
      currentFrac: 1,
      renderedWidth: BAR_W,
      energized: false,
    };
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
    this.updateArmor(data.armor);
    this.updateAdrenaline(data.adrenaline, data.adrenalineSyringeActive ?? false);
    this.updateUltimate(data.rage, data.isUltimateActive);
    this.updateCooldownBar(this.w1, data.weapon1CooldownFrac);
    this.updateCooldownBar(this.w2, data.weapon2CooldownFrac);
    this.updateCooldownBar(this.util, data.utilityCooldownFrac);

    if (data.utilityDisplayName && data.utilityDisplayName !== this.currentUtilityName) {
      this.onUtilityNameChanged(data.utilityDisplayName);
    }
    this.updateUtilityOverrideVisual(data.isUtilityOverridden ?? false);
    this.updatePowerUpSection(data.activePowerUps ?? []);
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
    this.armor.prevFrac = 0; this.armor.currentFrac = 0;
    this.adr.prevFrac = 1; this.adr.currentFrac = 1;
    this.ult.prevFrac = 0; this.ult.currentFrac = 0;
    this.w1.prevFrac = 0; this.w1.currentFrac = 0;
    this.w2.prevFrac = 0; this.w2.currentFrac = 0;
    this.util.prevFrac = 0; this.util.currentFrac = 0;
    this.lastHpText = null;
    this.lastArmorText = null;
    this.hpTrailDelay?.remove();
    this.hpTrailDelay = null;
    this.armorTrailDelay?.remove();
    this.armorTrailDelay = null;
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
    for (const b of [this.hp, this.armor, this.adr, this.ult, this.w1, this.w2, this.util]) {
      b.renderedWidth = Math.max(0, Math.round(BAR_W * b.currentFrac));
      b.energized = true; // force re-apply
      this.setBarEnergized(b, false);
    }
    this.puNoneLabel.setVisible(true);
    if (this.nameScrollTween) {
      this.nameScrollTween.destroy();
      this.nameScrollTween = null;
    }
    this.nameText.x = BAR_X;
    // Clear power-up entries
    this.clearPowerUpEntries();
  }

  destroy(): void {
    this.removeUltGlow();
    this.hpTrailDelay?.remove();
    this.armorTrailDelay?.remove();
    this.removeAdrSyringe();
    this.removeUtilWobble();
    for (const b of [this.hp, this.armor, this.adr, this.ult, this.w1, this.w2, this.util]) {
      b.idleEffect.destroy();
    }
    if (this.nameScrollTween) this.nameScrollTween.destroy();
    this.nameMask.destroy();
    this.adrBurstEmitter?.destroy();
    this.clearPowerUpEntries();
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
    this.updateTrackedValueBar(this.hp, hp, HP_MAX, this.hpTrailDelay, timer => {
      this.hpTrailDelay = timer;
    });
    const nextText = `${Math.round(hp)}/${HP_MAX}`;
    if (nextText !== this.lastHpText) {
      this.hp.valueText?.setText(nextText);
      this.lastHpText = nextText;
    }
  }

  private updateArmor(armor: number): void {
    this.updateTrackedValueBar(this.armor, armor, ARMOR_MAX, this.armorTrailDelay, timer => {
      this.armorTrailDelay = timer;
    });
    const nextText = `${Math.round(armor)}/${ARMOR_MAX}`;
    if (nextText !== this.lastArmorText) {
      this.armor.valueText?.setText(nextText);
      this.lastArmorText = nextText;
    }
  }

  private updateTrackedValueBar(
    bundle: BarBundle,
    value: number,
    maxValue: number,
    trailDelay: Phaser.Time.TimerEvent | null,
    setTrailDelay: (timer: Phaser.Time.TimerEvent | null) => void,
  ): void {
    const frac = Math.max(0, Math.min(1, value / maxValue));
    const prev = bundle.prevFrac;

    this.setBarFrac(bundle, frac);

    if (frac < prev - 0.005) {
      trailDelay?.remove();
      setTrailDelay(this.scene.time.delayedCall(400, () => {
        this.scene.tweens.add({
          targets: bundle.trail,
          width: BAR_W * frac,
          duration: 600,
          ease: 'Power2',
        });
        setTrailDelay(null);
      }));
      this.flashBorder(bundle, COLORS.RED_2);
      this.shakeBar(bundle);
    } else if (frac > prev + 0.005) {
      if (bundle.trail) bundle.trail.width = BAR_W * frac;
      this.flashBar(bundle);
    }

    bundle.prevFrac = frac;
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

  // ── Power-Up section ───────────────────────────────────────────────────

  /** Properly destroy all game objects inside a BarBundle. */
  private destroyBarBundle(b: BarBundle): void {
    b.idleEffect.destroy();
    b.coreEmitter.destroy();
    b.outerEmitter.destroy();
    b.label.destroy();
    b.bgImg.destroy();
    b.fgImg.destroy();
    b.border.destroy();
    b.trail?.destroy();
    b.valueText?.destroy();
    b.highlight?.destroy();
  }

  private clearPowerUpEntries(): void {
    for (const bundle of this.puEntries.values()) this.destroyBarBundle(bundle);
    this.puEntries.clear();
    this.puOrder = [];
  }

  /** Ensure the gradient texture for a power-up palette exists, create lazily. */
  private ensurePuTexture(defId: string, palette: BarPalette): string {
    const key = `_hud_pu_${defId}`;
    if (!this.scene.textures.exists(key)) {
      createGradientTexture(this.scene, key, palette, BAR_W, BAR_H);
    }
    return key;
  }

  private updatePowerUpSection(activePowerUps: ActivePowerUpInfo[]): void {
    const activeIds = new Set(activePowerUps.map(p => p.defId));

    // Check if the set of active IDs changed
    let setChanged = activeIds.size !== this.puOrder.length;
    if (!setChanged) {
      for (const id of this.puOrder) {
        if (!activeIds.has(id)) { setChanged = true; break; }
      }
    }

    if (setChanged) {
      // Destroy old entries and rebuild
      this.clearPowerUpEntries();

      let yOff = PU_SECTION_Y;
      for (const pu of activePowerUps) {
        const def = POWERUP_DEFS[pu.defId];
        if (!def) continue;

        const palette = paletteFromColor(def.color);
        const texKey  = this.ensurePuTexture(pu.defId, palette);
        const labelY  = yOff;
        const barY    = yOff + 20;

        const bundle = this.createBar(labelY, barY, `Power-Up: ${def.displayName}`, palette, texKey);
        // Power-up bars are always energized
        this.setBarEnergized(bundle, true);

        this.puEntries.set(pu.defId, bundle);
        this.puOrder.push(pu.defId);

        yOff = barY + BAR_H + 12;
      }
    }

    // Show/hide "keins" label
    this.puNoneLabel.setVisible(this.puOrder.length === 0);

    // Update fractions
    for (const pu of activePowerUps) {
      const bundle = this.puEntries.get(pu.defId);
      if (!bundle) continue;
      const frac = Math.max(0, Math.min(1, pu.remainingFrac));
      this.setBarFrac(bundle, frac);
    }
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
      // Stop idle breathing, start energized sparkle
      bundle.idleEffect.stop();
      if (hasFill) {
        bundle.coreEmitter.start();
        bundle.outerEmitter.start();
      }
    } else {
      // Stop energized sparkle, start idle breathing
      bundle.coreEmitter.stop();
      bundle.outerEmitter.stop();
      bundle.idleEffect.start();
    }
  }

  // ── Shared bar helpers ────────────────────────────────────────────────────

  /** Set the visible fill fraction and constrain particles to the filled area. */
  private setBarFrac(bundle: BarBundle, frac: number): void {
    const w = Math.max(0, Math.round(BAR_W * frac));
    if (bundle.renderedWidth === w && Math.abs(bundle.currentFrac - frac) < 0.0001) return;

    bundle.fgImg.setCrop(0, 0, w, BAR_H);
    bundle.currentFrac = frac;
    bundle.renderedWidth = w;

    // Update idle effect zone
    bundle.idleEffect.setFilledWidth(w);

    // Update energized zone
    if (w > 6) {
      bundle.energyZone.width = w - 4;
      if (bundle.energized) {
        if (!bundle.coreEmitter.emitting) bundle.coreEmitter.start();
        if (!bundle.outerEmitter.emitting) bundle.outerEmitter.start();
      }
    } else {
      bundle.energyZone.width = 0;
      bundle.coreEmitter.stop();
      bundle.outerEmitter.stop();
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
