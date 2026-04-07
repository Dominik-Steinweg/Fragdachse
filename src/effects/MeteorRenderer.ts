import Phaser from 'phaser';
import type { SyncedMeteorStrike } from '../types';
import { DEPTH, DEPTH_FX } from '../config';
import { circleZone } from './EffectUtils';
import type { GameAudioSystem } from '../audio/GameAudioSystem';

// ── Textur-Schlüssel ────────────────────────────────────────────────────────
const TEX_METEOR_CORE  = '__meteor_core';
const TEX_METEOR_EMBER = '__meteor_ember';
const TEX_METEOR_SPARK = '__meteor_spark';
const TEX_METEOR_GLOW  = '__meteor_glow';

// ── Farb-Palette (feste Meteorfarben) ──────────────────────────────────────
const METEOR_COLORS_CORE  = [0xffffff, 0xffee88, 0xffcc44, 0xff9922];
const METEOR_COLORS_OUTER = [0xff6622, 0xff4400, 0xdd2200, 0xcc3300];
const METEOR_COLORS_SPARK = [0xffffff, 0xffee88, 0xffaa44, 0xff6622];
const METEOR_IMPACT_TINTS = [0xffd700, 0xff8800, 0xff4400, 0xffee88];
const METEOR_EMBER_TINTS  = [0xff6622, 0xff4400, 0xcc3300];
const WARNING_COLOR       = 0xff4400;
const WARNING_FILL_ALPHA  = 0.12;
const WARNING_STROKE_ALPHA = 0.55;

// ── Depth-Layering ─────────────────────────────────────────────────────────
const DEPTH_WARNING  = DEPTH.FIRE - 0.5;
const DEPTH_METEOR   = DEPTH.FIRE + 0.2;
const DEPTH_IMPACT   = DEPTH_FX;

// ── Visuelle State-Typen ───────────────────────────────────────────────────

interface MeteorWarningVisual {
  warningCircle:  Phaser.GameObjects.Arc;        // Boden-Warnkreis (Stroke)
  warningFill:    Phaser.GameObjects.Arc;        // Boden-Warnfüllung
  shadow:         Phaser.GameObjects.Ellipse;    // Schlagschatten
  meteorGlow:     Phaser.GameObjects.Image;      // Leuchtender Kern (skaliert hoch)
  trailEmitter:   Phaser.GameObjects.Particles.ParticleEmitter;  // Schweif-Partikel
}

/**
 * MeteorRenderer – Client-seitige Darstellung der Armageddon-Meteore.
 *
 * Jeder Meteor durchläuft zwei Phasen:
 * 1. Warn-Phase (spawnedAt → impactAt): Warnkreis am Boden + herannahender Meteor (Scale-Up)
 * 2. Einschlag (impactAt): Explosionseffekt (Burst-Partikel, Flash, Schockwelle)
 *
 * Orientiert sich visuell an FlameRenderer/BfgRenderer (Partikel-Emitter, prozed. Texturen).
 */
export class MeteorRenderer {
  private scene: Phaser.Scene;
  private visuals = new Map<number, MeteorWarningVisual>();
  /** IDs die beim letzten sync() aktiv waren – zum Erkennen des Einschlags */
  private previousIds = new Set<number>();
  private audioSystem: GameAudioSystem | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  setAudioSystem(system: GameAudioSystem): void {
    this.audioSystem = system;
  }

  // ── Texturen ──────────────────────────────────────────────────────────────

  generateTextures(): void {
    const texMgr = this.scene.textures;

    // Meteor-Kern: weicher leuchtender Kreis 32×32
    if (!texMgr.exists(TEX_METEOR_CORE)) {
      const s = 32;
      const canvas = texMgr.createCanvas(TEX_METEOR_CORE, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0,   'rgba(255,255,255,1.0)');
      grad.addColorStop(0.2, 'rgba(255,238,136,0.9)');
      grad.addColorStop(0.5, 'rgba(255,153,34,0.6)');
      grad.addColorStop(0.8, 'rgba(255,68,0,0.3)');
      grad.addColorStop(1,   'rgba(200,51,0,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      canvas.refresh();
    }

    // Ember-Textur: kleine Glut 12×12
    if (!texMgr.exists(TEX_METEOR_EMBER)) {
      const s = 12;
      const canvas = texMgr.createCanvas(TEX_METEOR_EMBER, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0,   'rgba(255,238,136,1.0)');
      grad.addColorStop(0.5, 'rgba(255,102,34,0.5)');
      grad.addColorStop(1,   'rgba(204,51,0,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      canvas.refresh();
    }

    // Spark-Textur: winziger Punkt 6×6
    if (!texMgr.exists(TEX_METEOR_SPARK)) {
      const s = 6;
      const canvas = texMgr.createCanvas(TEX_METEOR_SPARK, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0,   'rgba(255,255,255,1.0)');
      grad.addColorStop(0.5, 'rgba(255,238,136,0.6)');
      grad.addColorStop(1,   'rgba(255,170,68,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      canvas.refresh();
    }

    // Glow-Textur: großer weicher Kreis 48×48 (Halo um Meteor)
    if (!texMgr.exists(TEX_METEOR_GLOW)) {
      const s = 48;
      const canvas = texMgr.createCanvas(TEX_METEOR_GLOW, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0,   'rgba(255,200,100,0.8)');
      grad.addColorStop(0.4, 'rgba(255,102,0,0.3)');
      grad.addColorStop(1,   'rgba(200,51,0,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      canvas.refresh();
    }
  }

  // ── Sync (pro Frame aufrufen) ─────────────────────────────────────────────

  sync(meteors: SyncedMeteorStrike[]): void {
    const now = Date.now();
    const activeIds = new Set<number>();

    for (const m of meteors) {
      activeIds.add(m.id);

      let visual = this.visuals.get(m.id);
      if (!visual) {
        visual = this.createWarningVisual(m);
        this.visuals.set(m.id, visual);
      }

      this.updateWarningVisual(visual, m, now);
    }

    // Entfernte Meteore: Einschlag abspielen + Visual aufräumen
    for (const [id, visual] of this.visuals) {
      if (activeIds.has(id)) continue;

      // Wenn der Meteor gerade verschwunden ist → Einschlag (nicht bei bereits explodierten)
      if (this.previousIds.has(id)) {
        this.playImpactEffect(visual);
        this.audioSystem?.playSound('sfx_explosion_armageddon', visual.warningCircle.x, visual.warningCircle.y);
      }

      this.destroyWarningVisual(visual);
      this.visuals.delete(id);
    }

    this.previousIds = activeIds;
  }

  // ── Aufräumen ─────────────────────────────────────────────────────────────

  clear(): void {
    for (const visual of this.visuals.values()) {
      this.destroyWarningVisual(visual);
    }
    this.visuals.clear();
    this.previousIds.clear();
  }

  // ── Warning-Visual erstellen ──────────────────────────────────────────────

  private createWarningVisual(m: SyncedMeteorStrike): MeteorWarningVisual {
    // Boden-Warnkreis (Stroke)
    const warningCircle = this.scene.add.circle(m.x, m.y, m.radius);
    warningCircle.setStrokeStyle(2, WARNING_COLOR, WARNING_STROKE_ALPHA);
    warningCircle.setFillStyle(0, 0);
    warningCircle.setDepth(DEPTH_WARNING);
    warningCircle.setScale(0);

    // Boden-Füllung (semi-transparent)
    const warningFill = this.scene.add.circle(m.x, m.y, m.radius, WARNING_COLOR, WARNING_FILL_ALPHA);
    warningFill.setDepth(DEPTH_WARNING - 0.01);
    warningFill.setScale(0);

    // Pulsierender Warnkreis-Tween
    this.scene.tweens.add({
      targets:  warningCircle,
      alpha:    { from: WARNING_STROKE_ALPHA * 0.6, to: WARNING_STROKE_ALPHA },
      duration: 200,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    });

    // Schlagschatten am Boden
    const shadow = this.scene.add.ellipse(m.x, m.y, 10, 5, 0x000000, 0.25);
    shadow.setDepth(DEPTH_WARNING - 0.02);

    // Meteor-Glow (Kern) – startet klein, skaliert hoch
    const meteorGlow = this.scene.add.image(m.x, m.y, TEX_METEOR_GLOW);
    meteorGlow.setBlendMode(Phaser.BlendModes.ADD);
    meteorGlow.setDepth(DEPTH_METEOR);
    meteorGlow.setScale(0.1);
    meteorGlow.setAlpha(0);

    // Schweif-Partikel (fallen nach oben/hinten = "Annäherung von oben")
    const trailEmitter = this.scene.add.particles(m.x, m.y, TEX_METEOR_EMBER, {
      lifespan:  { min: 150, max: 350 },
      frequency: 30,
      quantity:  2,
      speedX:    { min: -20, max: 20 },
      speedY:    { min: -50, max: -10 },
      scale:     { start: 0.5, end: 0.05 },
      alpha:     { start: 0.8, end: 0 },
      tint:      METEOR_COLORS_OUTER,
      blendMode: Phaser.BlendModes.ADD,
      emitting:  false,
    });
    trailEmitter.setDepth(DEPTH_METEOR + 0.05);

    return { warningCircle, warningFill, shadow, meteorGlow, trailEmitter };
  }

  // ── Warning-Visual aktualisieren ──────────────────────────────────────────

  private updateWarningVisual(visual: MeteorWarningVisual, m: SyncedMeteorStrike, now: number): void {
    const totalDuration = m.impactAt - m.spawnedAt;
    const elapsed = now - m.spawnedAt;
    const progress = Math.min(1, Math.max(0, elapsed / totalDuration));

    // Warnkreis von 0 → 1 skalieren (beschleunigt am Anfang, bremst am Ende)
    const warningScale = Phaser.Math.Easing.Quadratic.Out(progress);
    visual.warningCircle.setScale(warningScale);
    visual.warningFill.setScale(warningScale);

    // Warnkreis-Füllung wird gegen Ende intensiver
    const fillAlpha = WARNING_FILL_ALPHA + (0.25 - WARNING_FILL_ALPHA) * progress * progress;
    visual.warningFill.setAlpha(fillAlpha);

    // Schatten wächst mit (von klein zu voller Größe)
    const shadowScale = 0.5 + 1.5 * progress;
    visual.shadow.setScale(shadowScale, shadowScale * 0.5);
    visual.shadow.setAlpha(0.15 + 0.2 * progress);

    // Meteor-Glow: erscheint ab 20% Fortschritt, skaliert exponentiell hoch
    if (progress > 0.2) {
      const meteorProgress = (progress - 0.2) / 0.8;
      const meteorScale = 0.3 + 2.2 * Phaser.Math.Easing.Quadratic.In(meteorProgress);
      visual.meteorGlow.setScale(meteorScale);
      visual.meteorGlow.setAlpha(0.4 + 0.6 * meteorProgress);
      // Schweif-Emitter aktiv
      visual.trailEmitter.emitting = true;
    } else {
      visual.meteorGlow.setAlpha(0);
      visual.trailEmitter.emitting = false;
    }

    // Schweif-Emitter Zone anpassen (größer wenn Meteor näher)
    if (progress > 0.2) {
      visual.trailEmitter.clearEmitZones();
      const spread = 4 + 12 * progress;
      visual.trailEmitter.addEmitZone(circleZone(spread, 2));
    }
  }

  // ── Einschlags-Effekt ─────────────────────────────────────────────────────

  private playImpactEffect(visual: MeteorWarningVisual): void {
    const x = visual.warningCircle.x;
    const y = visual.warningCircle.y;
    const radius = (visual.warningCircle.geom as Phaser.Geom.Circle).radius;

    // 1. Heller Blitz (weiß, expandiert schnell)
    const flash = this.scene.add.circle(x, y, 6, 0xffffff, 1);
    flash.setDepth(DEPTH_IMPACT + 1);
    flash.setBlendMode(Phaser.BlendModes.ADD);
    const flashEndScale = (radius * 0.6) / 6;
    this.scene.tweens.add({
      targets:    flash,
      scaleX:     flashEndScale,
      scaleY:     flashEndScale,
      alpha:      0,
      duration:   120,
      ease:       'Power3Out',
      onComplete: () => flash.destroy(),
    });

    // 2. Feurige Explosionsfüllung
    const blast = this.scene.add.circle(x, y, 4, 0xff6622, 0.75);
    blast.setDepth(DEPTH_IMPACT);
    blast.setBlendMode(Phaser.BlendModes.ADD);
    const blastEndScale = radius / 4;
    this.scene.tweens.add({
      targets:    blast,
      scaleX:     blastEndScale,
      scaleY:     blastEndScale,
      alpha:      0,
      duration:   450,
      ease:       'Power2Out',
      onComplete: () => blast.destroy(),
    });

    // 3. Schockwellen-Ring
    const ringStartR = radius * 0.4;
    const ringEndScale = (radius * 1.2) / ringStartR;
    const ring = this.scene.add.circle(x, y, ringStartR);
    ring.setStrokeStyle(2, 0xff8800, 0.7);
    ring.setFillStyle(0, 0);
    ring.setDepth(DEPTH_IMPACT);
    this.scene.tweens.add({
      targets:    ring,
      scaleX:     ringEndScale,
      scaleY:     ringEndScale,
      alpha:      0,
      duration:   350,
      ease:       'Linear',
      onComplete: () => ring.destroy(),
    });

    // 4. Funken-Burst (schnelle helle Partikel nach außen)
    const sparkEmitter = this.scene.add.particles(x, y, TEX_METEOR_SPARK, {
      lifespan:  { min: 200, max: 500 },
      speed:     { min: 60, max: radius * 2 },
      scale:     { start: 1.5, end: 0 },
      alpha:     { start: 1, end: 0 },
      tint:      METEOR_IMPACT_TINTS,
      blendMode: Phaser.BlendModes.ADD,
      emitting:  false,
    });
    sparkEmitter.setDepth(DEPTH_IMPACT + 0.1);
    sparkEmitter.explode(18);
    this.scene.time.delayedCall(700, () => sparkEmitter.destroy());

    // 5. Glut-Partikel (langsamer, mit Drift + Gravitation)
    const emberEmitter = this.scene.add.particles(x, y, TEX_METEOR_EMBER, {
      lifespan:  { min: 400, max: 900 },
      speed:     { min: 15, max: radius * 0.9 },
      scale:     { start: 0.9, end: 0.15 },
      alpha:     { start: 0.75, end: 0 },
      tint:      METEOR_EMBER_TINTS,
      gravityY:  30,
      blendMode: Phaser.BlendModes.ADD,
      emitting:  false,
    });
    emberEmitter.setDepth(DEPTH_IMPACT);
    emberEmitter.explode(10);
    this.scene.time.delayedCall(1100, () => emberEmitter.destroy());

    // 6. Boden-Scorch (dunkler Kreis, fadet langsam)
    const scorch = this.scene.add.circle(x, y, radius * 0.8, 0x1a0a00, 0.2);
    scorch.setDepth(DEPTH_WARNING - 0.1);
    this.scene.tweens.add({
      targets:    scorch,
      alpha:      0,
      duration:   1500,
      ease:       'Quad.easeOut',
      onComplete: () => scorch.destroy(),
    });

    // 7. Kamera-Shake (dezent, da viele Einschläge)
    this.scene.cameras.main.shake(80, 0.002);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  private destroyWarningVisual(visual: MeteorWarningVisual): void {
    visual.warningCircle.destroy();
    visual.warningFill.destroy();
    visual.shadow.destroy();
    visual.meteorGlow.destroy();
    visual.trailEmitter.stop();
    visual.trailEmitter.destroy();
  }
}
