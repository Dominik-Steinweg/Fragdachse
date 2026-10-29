import { BADGER_CURSOR } from './gameCursor';
import { PlasmaBurnerOverloadIndicator } from './PlasmaBurnerOverloadIndicator';
import * as Phaser from 'phaser';
import { RocketMagazineIndicator } from './RocketMagazineIndicator';
import type { WeaponConfig } from '../loadout/LoadoutConfig';
import { AimSpreadModel } from './AimSpreadModel';
import {
  AIM_CHARGE_RING_OFFSET,
  AIM_CROSS_RING_R_MAX,
  AimVisuals,
  type SlotPalette,
} from './AimVisuals';
import type { PlayerAimNetState, UltimateChargePreviewState, UtilityChargePreviewState, UtilityTargetingPreviewState, WeaponSlot } from '../types';
import {
  COLORS,
  ARENA_OFFSET_X, ARENA_OFFSET_Y,
  ARENA_WIDTH,    ARENA_HEIGHT,
  DEPTH_AIM,
  PLAYER_SIZE,
  getTopDownMuzzleOrigin,
} from '../config';
import { getHeldWeaponGameplayMuzzleOrigin } from '../loadout/HeldItemVisuals';
import { LivingBarEffect, paletteFromColor } from './LivingBarEffect';
import { getUnshakenPointerWorldPoint } from '../graphics/cameraBaseScroll';

const SLOT_PALETTES: Record<WeaponSlot, SlotPalette> = {
  weapon1: {
    beamShadow: COLORS.BLUE_6,
    beamGlow:   COLORS.BLUE_4,
    beamCore:   COLORS.BLUE_2,
    crossGlow:  COLORS.BLUE_3,
    crossMain:  COLORS.BLUE_1,
  },
  weapon2: {
    beamShadow: COLORS.GOLD_6,
    beamGlow:   COLORS.GOLD_4,
    beamCore:   COLORS.GOLD_2,
    crossGlow:  COLORS.GOLD_3,
    crossMain:  COLORS.GOLD_1,
  },
};

/** Lokale Trefferbestaetigung aus dem replizierten `hit`-Effekt. */
export interface AimHitInfo {
  totalDamage: number;
  isKill: boolean;
  isCritical?: boolean;
}

// ── Visuelle Konstanten ────────────────────────────────────────────────────
// Reine Darstellungswerte (Strichstaerken, Querschnitte, Ausblendungen) stecken in `AimVisuals`,
// weil sie dort die gebackenen Texturen definieren. Hier bleibt, was pro Frame berechnet wird.
const HIT_FLASH_MS        = 100;

// Fadenkreuz – Punkt + Spread-Ring
const RING_GAP_MIN       = 5;    // Ringradius bei 0 % Spread
const RING_GAP_MAX       = 20;   // Ringradius bei 100 % Spread
const RING_BASE_ALPHA    = 0.62; // Ringalpha ohne Spread
const RING_SPREAD_ALPHA  = 0.2;  // Zusatzalpha bei vollem Spread
const BLOOM_BASE         = 0.34; // additiver Glow relativ zur Ringalpha
const BLOOM_BREATH       = 0.06;
const BLOOM_BREATH_SPEED = 0.004;
const DOT_LIGHTEN        = 0.4;
/** Der Beam endet vor dem Spread-Ring und seinen Ticks, statt durch das Fadenkreuz zu laufen. */
const BEAM_RING_CLEARANCE = 6;

// Gefederter Ringradius: kritisch gedaempft, damit Spread-Spruenge (Stehen/Laufen, autoritative
// Updates) gleiten statt zu springen. Feste Teilschritte halten die Feder bei Framedrops stabil.
const SPRING_OMEGA       = 30;
const SPRING_STEP_S      = 1 / 120;
const SHOT_KICK_VELOCITY = 190;  // px/s Impuls, ~2.5 px Ueberschwinger
const SHOT_KICK_MAX_VEL  = 320;
const SHOT_FLASH_MS      = 90;
const SHOT_PULSE_MS      = 110;
const SHOT_PULSE_MIN_BEAM = 24;

// Einblenden, wenn die Zielhilfe erscheint (Spawn, Menue zu): der Ring zieht sich auf den Punkt.
const INTRO_MS           = 160;
const INTRO_RING_EXPAND  = 9;

// Slotwechsel: Palette blendet exponentiell ueber, ~120 ms bis praktisch am Ziel.
const PALETTE_BLEND_TAU_MS = 40;

// Ausser Reichweite: Fadenkreuz leicht gedimmt, der Reichweiten-Tick poppt beim Uebertritt.
const OUT_OF_RANGE_OPACITY = 0.8;
const RANGE_DIM_TAU_MS     = 60;
const RANGE_TICK_POP_MS    = 150;

// Hitmarker
const HIT_MARKER_MS      = 200;
const CRIT_MARKER_MS     = 240;
const KILL_MARKER_MS     = 300;
const HIT_MARKER_POP_MS  = 70;
/** Die Diagonalen liegen knapp ausserhalb des Rings. */
const HIT_MARKER_RING_GAP = 4;
const HIT_MARKER_POP_PX  = 3;
const HIT_MARKER_BLOOM   = 0.4;
const HIT_TINT_MS        = 140;
const KILL_TINT_MS       = 200;
/** Treffer innerhalb dieses Fensters gehoeren zum selben Burst (Schrotkugeln, Splash). */
const HIT_MERGE_MS       = 40;
const KILL_MARKER_COLOR  = 0xf2564a;
const HIT_MARKER_LIGHTEN = 0.5;
const CRIT_MARKER_LIGHTEN = 0.85;

// AWP-Ladering
const CHARGE_READY_FLASH_MS = 260;

const MOVE_THRESHOLD = 0.3;

const CHARGE_ANCHOR_OFFSET_X = 18;
const CHARGE_STEM_LENGTH = 12;
const CHARGE_BAR_GAP = 6;
const CHARGE_BAR_WIDTH = 52;
const CHARGE_BAR_HEIGHT = 8;
const CHARGE_BAR_START_X = CHARGE_ANCHOR_OFFSET_X + CHARGE_STEM_LENGTH + CHARGE_BAR_GAP;

/** Rang der Trefferart: hoeher gewinnt, wenn Treffer verschmelzen. */
type HitKind = 0 | 1 | 2;
const HIT_KIND_HIT: HitKind = 0;
const HIT_KIND_CRIT: HitKind = 1;
const HIT_KIND_KILL: HitKind = 2;

const HIT_KIND_DURATION_MS: Record<HitKind, number> = {
  0: HIT_MARKER_MS,
  1: CRIT_MARKER_MS,
  2: KILL_MARKER_MS,
};

function usesGameplayMuzzle(config: WeaponConfig): boolean {
  return config.fire.type === 'projectile'
    || config.fire.type === 'hitscan'
    || config.fire.type === 'flamethrower'
    || config.fire.type === 'leaf_blower'
    || config.fire.type === 'reinforcement_matrix'
    || config.fire.type === 'energy_injector';
}

function mixColor(from: number, to: number, amount: number): number {
  const mix = Phaser.Math.Clamp(amount, 0, 1);
  const channel = (shift: number): number => {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    return Math.round(a + (b - a) * mix) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}

function mixWithWhite(color: number, amount: number): number {
  return mixColor(color, 0xffffff, amount);
}

function easeOutCubic(t: number): number {
  const inv = 1 - Phaser.Math.Clamp(t, 0, 1);
  return 1 - inv * inv * inv;
}

/**
 * Zielhilfe des lokalen Spielers. Diese Klasse rechnet nur: Spread, Richtung, Reichweite,
 * Ladezustand, Trefferfeedback und die zeitbasierten Animationen. Die Darstellung uebernimmt
 * `AimVisuals` mit langlebigen Images auf gebackenen Texturen – siehe dort, warum
 * Immediate-Mode-Bogen teuer sind. Alle Animationen laufen ueber Zeitstempel statt Tweens, weil
 * `beginFrame()` jeden Frame alles versteckt und nur das Gezeigte neu setzt.
 */
export class AimSystem {
  private rocketIndicator: RocketMagazineIndicator | null = null;
  private plasmaIndicator: PlasmaBurnerOverloadIndicator | undefined;
  private plasmaState: import('../combat/plasmaBurner/PlasmaBurnerContracts').PlasmaBurnerOverloadNetState | undefined;
  setPlasmaBurnerOverloadState(state: typeof this.plasmaState): void { this.plasmaState = state; }
  private rocketMagazineState: import('../types').RocketMagazineState | undefined;
  setRocketMagazineState(state: import('../types').RocketMagazineState | undefined): void { this.rocketMagazineState = state; }
  private readonly visuals: AimVisuals;
  private readonly spreadModel: AimSpreadModel;

  private prevX: number | null = null;
  private prevY: number | null = null;
  private prevShowAim = false;
  private appliedCursor: string | null = null;
  private confirmedHitUntil = 0;
  private scopeProgress = 0;
  private weaponChargeProgress = 0;

  private ringRadius = 0;
  private ringVelocity = 0;
  private ringSettled = false;
  private introAt = -Infinity;
  private shotAt = -Infinity;
  private hitAt = -Infinity;
  private hitKind: HitKind = HIT_KIND_HIT;
  private hitStrength = 1;
  private rangeOpacity = 1;
  private wasOutOfRange = false;
  private rangeEnteredAt = -Infinity;
  private chargeWasFull = false;
  private chargeFullAt = -Infinity;
  private readonly palette: SlotPalette = { ...SLOT_PALETTES.weapon1 };
  private paletteSlot: WeaponSlot | null = null;

  constructor(
    private readonly scene:           Phaser.Scene,
    private readonly getLocalSprite:  () => Phaser.GameObjects.Image | undefined,
    private readonly getWeaponConfig: (slot: WeaponSlot) => WeaponConfig,
    private readonly getPlayerColor:  () => number,
  ) {
    this.visuals = new AimVisuals(scene);
    this.spreadModel = new AimSpreadModel(getWeaponConfig);
    this.scene.input.setDefaultCursor(BADGER_CURSOR);
    this.appliedCursor = BADGER_CURSOR;
  }

  setActiveSlot(slot: WeaponSlot): void {
    this.spreadModel.setActiveSlot(slot);
  }

  notifyShot(slot: WeaponSlot): void {
    this.spreadModel.notifyShot(slot);
    this.shotAt = this.scene.time.now;
    this.ringVelocity = Math.min(SHOT_KICK_MAX_VEL, Math.max(0, this.ringVelocity) + SHOT_KICK_VELOCITY);
  }

  setAuthoritativeState(state: PlayerAimNetState | undefined): void {
    this.spreadModel.setAuthoritativeState(state);
  }

  /**
   * Treffer desselben Bursts (Schrot, Splash) verschmelzen zu einem Marker: die staerkste Art und
   * der hoechste Schaden gewinnen. Jeder spaetere Treffer zeigt wieder seine eigene Art, sonst
   * hielte Dauerfeuer nach einem Kill das Fadenkreuz rot.
   */
  notifyConfirmedHit(info?: AimHitInfo): void {
    const now = this.scene.time.now;
    this.confirmedHitUntil = now + HIT_FLASH_MS;

    const kind: HitKind = info?.isKill ? HIT_KIND_KILL : info?.isCritical ? HIT_KIND_CRIT : HIT_KIND_HIT;
    const strength = 0.9 + Phaser.Math.Clamp((info?.totalDamage ?? 0) / 100, 0, 1) * 0.3;
    const sameBurst = now - this.hitAt < HIT_MERGE_MS;
    this.hitKind = sameBurst && this.hitKind > kind ? this.hitKind : kind;
    this.hitStrength = sameBurst ? Math.max(strength, this.hitStrength) : strength;
    if (!sameBurst) this.hitAt = now;
  }

  setScopeProgress(progress: number): void {
    this.scopeProgress = progress;
  }

  /**
   * Zielen mit einer Scope-Waffe uebernimmt sofort das Fadenkreuz von Waffe 2 –
   * inklusive Ladebalken –, auch wenn zuletzt mit Waffe 1 geschossen wurde.
   */
  setScoping(scoping: boolean): void {
    if (scoping) this.spreadModel.setActiveSlot('weapon2');
  }

  setWeaponChargeProgress(progress: number): void {
    this.weaponChargeProgress = Phaser.Math.Clamp(progress, 0, 1);
  }

  update(
    showAim: boolean,
    hideSystemCursor: boolean,
    delta: number,
    utilityTargeting?: UtilityTargetingPreviewState,
    ultimatePreview?: UltimateChargePreviewState,
  ): void {
    // Nur bei Wechsel setzen: der Aufruf schreibt in den Canvas-Style und ist kein No-Op.
    const cursor = hideSystemCursor ? 'none' : BADGER_CURSOR;
    if (cursor !== this.appliedCursor) {
      this.scene.input.setDefaultCursor(cursor);
      this.appliedCursor = cursor;
    }

    const now = this.scene.time.now;
    if (showAim && !this.prevShowAim) {
      this.prevX = null;
      this.prevY = null;
      this.introAt = now;
      this.ringSettled = false;
    }
    this.prevShowAim = showAim;

    // Versteckt alle Visuals. Steht bewusst vor jedem Early Return, damit kein Zweig etwas
    // stehen lassen kann – dieselbe Rolle, die frueher `gfx.clear()` hatte.
    this.visuals.beginFrame();
    this.rocketIndicator?.hide();
    this.plasmaIndicator?.hide();
    if (!showAim) return;

    const sprite = this.getLocalSprite();
    if (!sprite) return;

    const sx = this.snap(sprite.x);
    const sy = this.snap(sprite.y);

    if (utilityTargeting) {
      const tx = this.snap(utilityTargeting.targetX);
      const ty = this.snap(utilityTargeting.targetY);
      this.visuals.showTargetingReticle(tx, ty);
      return;
    }

    if (ultimatePreview?.reticleStyle === 'gauss' && ultimatePreview.range) {
      this.showGaussAimReticle(sx, sy, ultimatePreview);
      return;
    }

    let localIsMoving = false;
    if (this.prevX === null) {
      this.prevX = sx;
      this.prevY = sy;
    } else {
      localIsMoving = Math.abs(sx - this.prevX) > MOVE_THRESHOLD
                   || Math.abs(sy - (this.prevY ?? sy)) > MOVE_THRESHOLD;
      this.prevX = sx;
      this.prevY = sy;
    }

    this.spreadModel.setLocalMovement(localIsMoving);
    this.spreadModel.update(delta);

    const aimState = this.spreadModel.getResolvedState();
    const cfg = this.getWeaponConfig(aimState.activeSlot);
    const palette = this.updatePalette(aimState.activeSlot, delta);

    const baseSpread = aimState.isMoving ? cfg.spreadMoving : cfg.spreadStanding;
    const totalSpread = Math.max(0, baseSpread + aimState.dynamicSpread);
    const maxTotal = cfg.spreadMoving + Math.max(0, cfg.maxDynamicSpread);
    const frac = maxTotal > 0 ? Math.min(1, totalSpread / maxTotal) : 0;
    const ringRadius = this.updateRingSpring(this.getRingRadius(frac), delta);

    const pointer = this.scene.input.activePointer;
    const pointerWorld = getUnshakenPointerWorldPoint(this.scene, pointer);
    const px = pointerWorld.x;
    const py = pointerWorld.y;
    if (cfg.plasmaBurner?.overloadEnabled) {
      this.plasmaIndicator ??= new PlasmaBurnerOverloadIndicator(this.scene);
      this.plasmaIndicator.update(px, py, this.plasmaState ?? { q: 0, qMax: cfg.plasmaBurner.qMaxByLevel[cfg.plasmaBurner.capacitorLevel], building: false });
    }
    if (this.rocketMagazineState) {
      this.rocketIndicator ??= new RocketMagazineIndicator(this.scene);
      this.rocketIndicator.update(px, py, this.rocketMagazineState, Date.now());
    }
    const dx = px - sx;
    const dy = py - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const nx = dist > 0 ? dx / dist : 1;
    const ny = dist > 0 ? dy / dist : 0;
    const aimAngle = dist > 0 ? Math.atan2(dy, dx) : 0;
    const gameplayAimMuzzle = usesGameplayMuzzle(cfg)
      ? getHeldWeaponGameplayMuzzleOrigin(
        cfg.id,
        sx,
        sy,
        aimAngle,
        PLAYER_SIZE,
      )
      : null;
    const beamOrigin = gameplayAimMuzzle ?? { x: sx, y: sy };
    const cursorForwardDistance = gameplayAimMuzzle
      ? Math.max(0, (px - beamOrigin.x) * nx + (py - beamOrigin.y) * ny)
      : dist;
    const outOfRange = cursorForwardDistance > cfg.range;
    if (outOfRange && !this.wasOutOfRange) this.rangeEnteredAt = now;
    this.wasOutOfRange = outOfRange;
    this.rangeOpacity = this.approach(this.rangeOpacity, outOfRange ? OUT_OF_RANGE_OPACITY : 1, delta, RANGE_DIM_TAU_MS);

    const beamRingClearance = outOfRange ? 0 : ringRadius + BEAM_RING_CLEARANCE;
    const beamLength = Math.max(0, Math.min(cursorForwardDistance, cfg.range) - beamRingClearance);
    const ex = beamOrigin.x + nx * beamLength;
    const ey = beamOrigin.y + ny * beamLength;

    const { x: cx, y: cy } = this.clipToArena(beamOrigin.x, beamOrigin.y, ex, ey);
    const tx = this.snap(cx);
    const ty = this.snap(cy);

    const introOpacity = easeOutCubic((now - this.introAt) / INTRO_MS);

    if (cfg.showCrosshair !== false && this.scopeProgress < 0.1) {
      const originX = this.snap(beamOrigin.x);
      const originY = this.snap(beamOrigin.y);
      this.visuals.showBeam(originX, originY, tx, ty, palette, frac, introOpacity);
      this.showShotPulse(originX, originY, tx, ty, palette, now);

      if (outOfRange) {
        const rx = beamOrigin.x + nx * cfg.range;
        const ry = beamOrigin.y + ny * cfg.range;
        if (
          rx >= ARENA_OFFSET_X
          && rx <= ARENA_OFFSET_X + ARENA_WIDTH
          && ry >= ARENA_OFFSET_Y
          && ry <= ARENA_OFFSET_Y + ARENA_HEIGHT
        ) {
          const pop = 1 - Phaser.Math.Clamp((now - this.rangeEnteredAt) / RANGE_TICK_POP_MS, 0, 1);
          this.visuals.showRangeTick(this.snap(rx), this.snap(ry), nx, ny, palette.crossMain, 1 + 0.5 * pop * pop);
        }
      }
    }

    // Bewusst ausserhalb des Crosshair-/Scope-Guards: Ring und Mittelpunkt bleiben auch bei
    // `showCrosshair: false` und im Scope sichtbar.
    const crossX = this.snap(px);
    const crossY = this.snap(py);
    this.showCrosshair(crossX, crossY, ringRadius, frac, palette, introOpacity * this.rangeOpacity, now);
    this.showHitMarker(crossX, crossY, ringRadius, palette, now);
    if ((cfg.awpCharge?.maxDamageBonus ?? 0) > 0 && this.weaponChargeProgress > 0) {
      this.showWeaponChargeRing(crossX, crossY, ringRadius, this.weaponChargeProgress, palette, now);
    } else {
      this.chargeWasFull = false;
    }
  }

  getGraphicsCommandCount(): number {
    return this.visuals.getGraphicsCommandCount();
  }

  destroy(): void {
    this.rocketIndicator?.destroy();
    this.plasmaIndicator?.destroy();
    this.scene.input.setDefaultCursor(BADGER_CURSOR);
    this.appliedCursor = BADGER_CURSOR;
    this.visuals.destroy();
  }

  private showCrosshair(
    cx: number,
    cy: number,
    ringRadius: number,
    frac: number,
    palette: SlotPalette,
    opacity: number,
    now: number,
  ): void {
    const shotBoost = this.fade(now - this.shotAt, SHOT_FLASH_MS);
    const breath = Math.sin(now * BLOOM_BREATH_SPEED) * BLOOM_BREATH;
    // Treffer faerben Ring und Punkt kurz in die Markerfarbe: Fadenkreuz und Hitmarker lesen als
    // ein Signal statt als zwei konkurrierende Farben.
    const hitTint = this.getHitTint(now);
    const markerColor = this.getHitMarkerColor(palette);
    const ringColor = mixColor(palette.crossMain, markerColor, hitTint);

    this.visuals.showCrosshair(cx, cy, {
      ringRadius,
      ringColor,
      ringAlpha: Math.min(1, RING_BASE_ALPHA + frac * RING_SPREAD_ALPHA + shotBoost * 0.18 + hitTint * 0.3),
      bloomColor: mixColor(palette.crossGlow, markerColor, hitTint),
      bloom: BLOOM_BASE + breath + shotBoost * 0.4 + hitTint * 0.3,
      dotColor: mixColor(mixWithWhite(palette.crossMain, DOT_LIGHTEN), markerColor, hitTint),
      dotScale: 1 + shotBoost * 0.22 + hitTint * 0.12,
      opacity,
    });
  }

  private showHitMarker(cx: number, cy: number, ringRadius: number, palette: SlotPalette, now: number): void {
    const elapsed = now - this.hitAt;
    const duration = HIT_KIND_DURATION_MS[this.hitKind];
    if (elapsed >= duration) return;

    const t = elapsed / duration;
    const popLinear = 1 - Phaser.Math.Clamp(elapsed / HIT_MARKER_POP_MS, 0, 1);
    const pop = popLinear * popLinear;
    const sizeByKind = this.hitKind === HIT_KIND_KILL ? 1.25 : this.hitKind === HIT_KIND_CRIT ? 1.12 : 1;

    // Die Segmente springen aus dem Ring nach aussen und setzen sich weich ab; der Saum- und
    // Glowaufbau ist derselbe wie beim Ring.
    this.visuals.showHitMarker(cx, cy, {
      color: this.getHitMarkerColor(palette),
      radius: ringRadius + (HIT_MARKER_RING_GAP + HIT_MARKER_POP_PX * pop) * this.hitStrength * sizeByKind,
      alpha: 1 - t * t * t,
      bloom: HIT_MARKER_BLOOM + 0.4 * pop,
    });
  }

  /**
   * Eine Farbfamilie fuer die ganze Zielhilfe: Treffer sind die aufgehellte Slotfarbe, Krits fast
   * weiss. Einziger Fremdton ist das Kill-Rot.
   */
  private getHitMarkerColor(palette: SlotPalette): number {
    if (this.hitKind === HIT_KIND_KILL) return KILL_MARKER_COLOR;
    return mixWithWhite(palette.crossMain, this.hitKind === HIT_KIND_CRIT ? CRIT_MARKER_LIGHTEN : HIT_MARKER_LIGHTEN);
  }

  /** 1 direkt nach einem Treffer; die Kill-Toenung ist nur ein kurzer Akzent. */
  private getHitTint(now: number): number {
    const elapsed = now - this.hitAt;
    const duration = this.hitKind === HIT_KIND_KILL ? KILL_TINT_MS : HIT_TINT_MS;
    const tint = this.fade(elapsed, duration);
    return tint * tint;
  }

  /** Heller Fleck, der nach jedem Schuss vom Lauf zum Ende des Beams laeuft. */
  private showShotPulse(
    sx: number,
    sy: number,
    ex: number,
    ey: number,
    palette: SlotPalette,
    now: number,
  ): void {
    const elapsed = now - this.shotAt;
    if (elapsed >= SHOT_PULSE_MS) return;
    const length = Math.hypot(ex - sx, ey - sy);
    if (length < SHOT_PULSE_MIN_BEAM) return;

    const t = elapsed / SHOT_PULSE_MS;
    const along = easeOutCubic(t);
    const fade = 1 - t;
    this.visuals.showShotPulse(
      sx + (ex - sx) * along,
      sy + (ey - sy) * along,
      Math.atan2(ey - sy, ex - sx),
      mixWithWhite(palette.beamCore, 0.35),
      0.85 * fade * Math.sqrt(fade),
    );
  }

  private showWeaponChargeRing(
    cx: number,
    cy: number,
    ringRadius: number,
    chargeFrac: number,
    palette: SlotPalette,
    now: number,
  ): void {
    const radius = ringRadius + AIM_CHARGE_RING_OFFSET;
    const full = chargeFrac >= 0.999;
    if (full && !this.chargeWasFull) this.chargeFullAt = now;
    this.chargeWasFull = full;
    const pulse = full ? 0.78 + Math.sin(now * 0.012) * 0.16 : 0.72;
    const color = full ? 0xff6a2b : palette.crossMain;
    const readyFlash = full ? this.fade(now - this.chargeFullAt, CHARGE_READY_FLASH_MS) : 0;

    this.visuals.showChargeRing(cx, cy, radius, chargeFrac, palette, color, pulse, full, readyFlash);
  }

  private getRingRadius(spreadFrac: number): number {
    return (RING_GAP_MIN + spreadFrac * (RING_GAP_MAX - RING_GAP_MIN)) * 1.1;
  }

  /** Kritisch gedaempfte Feder in festen Teilschritten; liefert den angezeigten Ringradius. */
  private updateRingSpring(target: number, delta: number): number {
    if (!this.ringSettled) {
      this.ringRadius = Math.min(AIM_CROSS_RING_R_MAX, target + INTRO_RING_EXPAND);
      this.ringVelocity = 0;
      this.ringSettled = true;
    }
    let remaining = Math.min(Math.max(delta, 0), 100) / 1000;
    while (remaining > 1e-6) {
      const step = Math.min(SPRING_STEP_S, remaining);
      const accel = -2 * SPRING_OMEGA * this.ringVelocity
        - SPRING_OMEGA * SPRING_OMEGA * (this.ringRadius - target);
      this.ringVelocity += accel * step;
      this.ringRadius += this.ringVelocity * step;
      remaining -= step;
    }
    if (this.ringRadius > AIM_CROSS_RING_R_MAX) {
      this.ringRadius = AIM_CROSS_RING_R_MAX;
      this.ringVelocity = Math.min(0, this.ringVelocity);
    }
    return this.ringRadius;
  }

  /** Blendet die Slotpalette ueber, statt bei Waffenwechsel hart umzuschalten. */
  private updatePalette(slot: WeaponSlot, delta: number): SlotPalette {
    const target = SLOT_PALETTES[slot];
    const amount = this.paletteSlot === null ? 1 : 1 - Math.exp(-Math.max(0, delta) / PALETTE_BLEND_TAU_MS);
    this.paletteSlot = slot;
    for (const key of Object.keys(target) as (keyof SlotPalette)[]) {
      this.palette[key] = mixColor(this.palette[key], target[key], amount);
    }
    return this.palette;
  }

  private approach(current: number, target: number, delta: number, tauMs: number): number {
    return current + (target - current) * (1 - Math.exp(-Math.max(0, delta) / tauMs));
  }

  /** 1 direkt nach dem Ereignis, linear auf 0 nach `durationMs`. */
  private fade(elapsed: number, durationMs: number): number {
    return elapsed >= durationMs ? 0 : 1 - Math.max(0, elapsed) / durationMs;
  }

  private showGaussAimReticle(sx: number, sy: number, preview: UltimateChargePreviewState): void {
    const range = Math.max(0, preview.range ?? 0);
    const chargeFraction = Phaser.Math.Clamp(preview.chargeFraction, 0, 1);
    const color = preview.colorOverride ?? this.getAccentColor();
    const nx = Math.cos(preview.angle);
    const ny = Math.sin(preview.angle);
    const muzzle = getTopDownMuzzleOrigin(sx, sy, preview.angle);
    const beamLength = Math.max(10, range * chargeFraction);
    const ex = muzzle.x + nx * beamLength;
    const ey = muzzle.y + ny * beamLength;
    const clipped = this.clipToArena(muzzle.x, muzzle.y, ex, ey);
    const startX = this.snap(muzzle.x);
    const startY = this.snap(muzzle.y);
    const tx = this.snap(clipped.x);
    const ty = this.snap(clipped.y);
    const coreColor = mixWithWhite(color, 0.62);
    const alpha = Math.max(0.04, chargeFraction * chargeFraction);
    const pulse = 0.92 + 0.08 * Math.sin(this.scene.time.now * 0.018);
    const clippedLength = Math.hypot(tx - startX, ty - startY);

    this.visuals.showGauss(
      startX,
      startY,
      preview.angle,
      clippedLength,
      color,
      coreColor,
      alpha,
      pulse,
      6 + chargeFraction * 6,
    );
  }

  private getAccentColor(): number {
    const playerColor = this.getPlayerColor();
    if (this.scene.time.now <= this.confirmedHitUntil) {
      return mixWithWhite(playerColor, 0.52);
    }
    return playerColor;
  }

  private snap(value: number): number {
    return Math.round(value);
  }

  private clipToArena(
    sx: number, sy: number,
    ex: number, ey: number,
  ): { x: number; y: number; inside: boolean } {
    const minX = ARENA_OFFSET_X;
    const minY = ARENA_OFFSET_Y;
    const maxX = ARENA_OFFSET_X + ARENA_WIDTH;
    const maxY = ARENA_OFFSET_Y + ARENA_HEIGHT;
    const inside = ex >= minX && ex <= maxX && ey >= minY && ey <= maxY;
    if (inside) return { x: ex, y: ey, inside: true };

    const dx = ex - sx;
    const dy = ey - sy;
    let t = 1;

    if (dx > 0) t = Math.min(t, (maxX - sx) / dx);
    else if (dx < 0) t = Math.min(t, (minX - sx) / dx);

    if (dy > 0) t = Math.min(t, (maxY - sy) / dy);
    else if (dy < 0) t = Math.min(t, (minY - sy) / dy);

    return { x: sx + t * dx, y: sy + t * dy, inside: false };
  }
}

export class UtilityChargeIndicator {
  private readonly container: Phaser.GameObjects.Container;
  private readonly anchorShadow: Phaser.GameObjects.Arc;
  private readonly anchorCore: Phaser.GameObjects.Arc;
  private readonly stemShadow: Phaser.GameObjects.Rectangle;
  private readonly stemCore: Phaser.GameObjects.Rectangle;
  private readonly barShadow: Phaser.GameObjects.Rectangle;
  private readonly barBg: Phaser.GameObjects.Rectangle;
  private readonly barFill: Phaser.GameObjects.Rectangle;
  private readonly barEdge: Phaser.GameObjects.Rectangle;
  private readonly barHatch: Phaser.GameObjects.Graphics;

  private livingEffect: LivingBarEffect | null = null;
  private currentEffectColor = 0;
  private wasVisible = false;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly getLocalSprite: () => Phaser.GameObjects.Image | undefined,
    private readonly getPlayerColor: () => number,
  ) {
    this.anchorShadow = scene.add.circle(CHARGE_ANCHOR_OFFSET_X, 0, 5, COLORS.GREY_10, 0.42);
    this.anchorCore = scene.add.circle(CHARGE_ANCHOR_OFFSET_X, 0, 2.5, COLORS.GREY_1, 0.95);

    this.stemShadow = scene.add.rectangle(CHARGE_ANCHOR_OFFSET_X + 1, 0, CHARGE_STEM_LENGTH + 2, 4, COLORS.GREY_10, 0.32);
    this.stemShadow.setOrigin(0, 0.5);
    this.stemCore = scene.add.rectangle(CHARGE_ANCHOR_OFFSET_X, 0, CHARGE_STEM_LENGTH, 2, COLORS.GREY_3, 0.9);
    this.stemCore.setOrigin(0, 0.5);

    this.barShadow = scene.add.rectangle(CHARGE_BAR_START_X + 1, 0, CHARGE_BAR_WIDTH + 2, CHARGE_BAR_HEIGHT + 2, COLORS.GREY_10, 0.38);
    this.barShadow.setOrigin(0, 0.5);
    this.barBg = scene.add.rectangle(CHARGE_BAR_START_X, 0, CHARGE_BAR_WIDTH, CHARGE_BAR_HEIGHT, COLORS.GREY_8, 0.92);
    this.barBg.setOrigin(0, 0.5);
    this.barFill = scene.add.rectangle(CHARGE_BAR_START_X, 0, 0, CHARGE_BAR_HEIGHT, this.getPlayerColor(), 0.95);
    this.barFill.setOrigin(0, 0.5);
    this.barEdge = scene.add.rectangle(CHARGE_BAR_START_X + CHARGE_BAR_WIDTH, 0, 2, CHARGE_BAR_HEIGHT + 2, COLORS.GREY_1, 0.75);
    this.barEdge.setOrigin(0.5, 0.5);
    this.barHatch = scene.add.graphics();

    this.container = scene.add.container(0, 0, [
      this.anchorShadow,
      this.anchorCore,
      this.stemShadow,
      this.stemCore,
      this.barShadow,
      this.barBg,
      this.barFill,
      this.barEdge,
      this.barHatch,
    ]);
    this.container.setDepth(DEPTH_AIM);
    this.container.setVisible(false);
  }

  /** Lazily create or recreate the LivingBarEffect when the color changes. */
  private ensureLivingEffect(color: number): void {
    if (this.livingEffect && this.currentEffectColor === color) return;
    if (this.livingEffect) this.livingEffect.destroy();
    const palette = paletteFromColor(color);
    // Bar top-left in container-local coords: (CHARGE_BAR_START_X, -CHARGE_BAR_HEIGHT/2)
    this.livingEffect = new LivingBarEffect(
      this.scene, this.container,
      CHARGE_BAR_START_X, -CHARGE_BAR_HEIGHT / 2,
      CHARGE_BAR_WIDTH, CHARGE_BAR_HEIGHT,
      palette,
    );
    this.currentEffectColor = color;
  }

  update(preview: UtilityChargePreviewState | UltimateChargePreviewState | undefined): void {
    const sprite = this.getLocalSprite();
    if (!preview || !sprite) {
      if (this.wasVisible && this.livingEffect) this.livingEffect.stop();
      this.wasVisible = false;
      this.container.setVisible(false);
      return;
    }

    const charge = Phaser.Math.Clamp(preview.chargeFraction, 0, 1);
    const playerColor = this.getPlayerColor();

    this.container.setVisible(true);
    this.container.setPosition(sprite.x, sprite.y);
    this.container.setRotation(preview.angle);
    this.barHatch.clear();

    if (preview.isBlocked) {
      this.anchorCore.setFillStyle(COLORS.GREY_3, 0.92);
      this.stemCore.setFillStyle(COLORS.GREY_4, 0.78);
      this.barFill.width = 0;
      this.barEdge.setAlpha(0.36);
      this.barBg.setFillStyle(COLORS.GREY_7, 0.94);
      if (this.livingEffect) this.livingEffect.stop();
      this.wasVisible = false;
      this.drawBlockedHatch();
      return;
    }

    const fillColor = preview.colorOverride ?? (preview.isGateCharge ? COLORS.GREEN_2 : playerColor);
    this.ensureLivingEffect(fillColor);

    if (!this.wasVisible && this.livingEffect) this.livingEffect.start();
    this.wasVisible = true;

    this.anchorCore.setFillStyle(fillColor, 0.98);
    this.stemCore.setFillStyle(fillColor, 0.72 + charge * 0.18);
    this.barBg.setFillStyle(COLORS.GREY_8, 0.92);
    this.barFill.setFillStyle(fillColor, 0.88 + charge * 0.10);
    this.barFill.width = CHARGE_BAR_WIDTH * charge;
    this.barEdge.setAlpha(0.4 + charge * 0.45);
    this.barBg.setAlpha(0.72 + charge * 0.16);

    if (this.livingEffect) this.livingEffect.setFilledWidth(CHARGE_BAR_WIDTH * charge);
  }

  private drawBlockedHatch(): void {
    const left = CHARGE_BAR_START_X;
    const right = CHARGE_BAR_START_X + CHARGE_BAR_WIDTH;
    const top = -CHARGE_BAR_HEIGHT / 2;
    const bottom = CHARGE_BAR_HEIGHT / 2;
    const spacing = 8;

    this.barHatch.lineStyle(2, COLORS.RED_2, 0.9);
    for (let start = left - CHARGE_BAR_HEIGHT; start < right + CHARGE_BAR_HEIGHT; start += spacing) {
      const x1 = Phaser.Math.Clamp(start, left, right);
      const y1 = Phaser.Math.Clamp(top + Math.max(left - start, 0), top, bottom);
      const x2 = Phaser.Math.Clamp(start + CHARGE_BAR_HEIGHT, left, right);
      const y2 = Phaser.Math.Clamp(bottom - Math.max(start + CHARGE_BAR_HEIGHT - right, 0), top, bottom);
      this.barHatch.beginPath();
      this.barHatch.moveTo(x1, y1);
      this.barHatch.lineTo(x2, y2);
      this.barHatch.strokePath();
    }
  }

  destroy(): void {
    if (this.livingEffect) this.livingEffect.destroy();
    this.container.destroy(true);
  }
}
