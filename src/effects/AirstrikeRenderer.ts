import * as Phaser from 'phaser';
import type { SyncedAirstrikeStrike } from '../types';
import { DEPTH }                      from '../config';
import { circleZone }                 from './EffectUtils';
import type { EffectSystem }          from './EffectSystem';

// ── Textur-Schlüssel ────────────────────────────────────────────────────────
const TEX_AS_BOMB   = '__airstrike_bomb';
const TEX_AS_TRAIL  = '__airstrike_trail';
const TEX_AS_WARN   = '__airstrike_warn';

// ── Farb-Palette ────────────────────────────────────────────────────────────
const COL_WARNING  = 0xff6600;
const COL_GLOW     = 0xff9933;
const COL_CORE     = 0xffcc66;
const COL_RING     = 0xffaa00;

// ── Visuelle State pro Strike ────────────────────────────────────────────────

interface AirstrikeVisual {
  // Boden-Warnkreis
  warningFill:   Phaser.GameObjects.Arc;
  warningRing:   Phaser.GameObjects.Arc;
  innerRing:     Phaser.GameObjects.Arc;
  // Fadenkreuz-Linien (4 Arme)
  crossH:        Phaser.GameObjects.Rectangle;
  crossV:        Phaser.GameObjects.Rectangle;
  // Zentral-Glow
  coreGlow:      Phaser.GameObjects.Arc;
  // Fallende Bomben-Partikel von oben
  bombTrails:    Phaser.GameObjects.Particles.ParticleEmitter;
  // Funken am Boden
  sparks:        Phaser.GameObjects.Particles.ParticleEmitter;
  lastCountdown: number | null;
}

/**
 * AirstrikeRenderer – Client-seitige Darstellung laufender Luftangriff-Strikes.
 *
 * Warnphase (armedAt → explodeAt):
 *   - Pulsierender Warnkreis + Fadenkreuz am Boden
 *   - Von oben fallende Streifen als einkommende Bomben
 *   - Countdown-Text (1, 2, …)
 *
 * Explosion: wird vom EffectSystem via broadcastExplosionEffect('nuke') behandelt.
 */
export class AirstrikeRenderer {
  private visuals     = new Map<number, AirstrikeVisual>();
  private effectSystem: EffectSystem | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  setEffectSystem(es: EffectSystem): void {
    this.effectSystem = es;
  }

  generateTextures(): void {
    const texMgr = this.scene.textures;

    // Bomben-Silhouette (8×20 px)
    if (!texMgr.exists(TEX_AS_BOMB)) {
      const c = texMgr.createCanvas(TEX_AS_BOMB, 8, 20);
      if (c) {
        const ctx = c.context;
        const g = ctx.createLinearGradient(0, 0, 0, 20);
        g.addColorStop(0,   'rgba(255,220,120,0.0)');
        g.addColorStop(0.2, 'rgba(255,180,60,0.85)');
        g.addColorStop(0.7, 'rgba(255,100,20,0.65)');
        g.addColorStop(1,   'rgba(255,60,0,0.0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 8, 20);
        c.refresh();
      }
    }

    // Schweif-Partikel (6×6 px, weiß→orange)
    if (!texMgr.exists(TEX_AS_TRAIL)) {
      const c = texMgr.createCanvas(TEX_AS_TRAIL, 6, 6);
      if (c) {
        const ctx  = c.context;
        const grad = ctx.createRadialGradient(3, 3, 0, 3, 3, 3);
        grad.addColorStop(0,   'rgba(255,255,200,1)');
        grad.addColorStop(0.5, 'rgba(255,160,40,0.7)');
        grad.addColorStop(1,   'rgba(255,80,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 6, 6);
        c.refresh();
      }
    }

    // Warnsignal-Partikel am Boden (8×8 px)
    if (!texMgr.exists(TEX_AS_WARN)) {
      const c = texMgr.createCanvas(TEX_AS_WARN, 8, 8);
      if (c) {
        const ctx  = c.context;
        const grad = ctx.createRadialGradient(4, 4, 0, 4, 4, 4);
        grad.addColorStop(0,   'rgba(255,200,80,1)');
        grad.addColorStop(0.4, 'rgba(255,120,20,0.7)');
        grad.addColorStop(1,   'rgba(255,60,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 8, 8);
        c.refresh();
      }
    }
  }

  sync(strikes: SyncedAirstrikeStrike[]): void {
    const activeIds = new Set<number>();
    const now       = Date.now();

    for (const strike of strikes) {
      activeIds.add(strike.id);

      let visual = this.visuals.get(strike.id);
      if (!visual) {
        visual = this.createVisual(strike);
        this.visuals.set(strike.id, visual);
      }

      this.updateVisual(visual, strike, now);
    }

    // Entfernte Strikes aufräumen
    for (const [id, visual] of this.visuals) {
      if (!activeIds.has(id)) {
        this.destroyVisual(visual);
        this.visuals.delete(id);
      }
    }
  }

  clear(): void {
    for (const v of this.visuals.values()) this.destroyVisual(v);
    this.visuals.clear();
  }

  // ── Hilfsmethoden ──────────────────────────────────────────────────────────

  private updateVisual(
    v:      AirstrikeVisual,
    strike: SyncedAirstrikeStrike,
    now:    number,
  ): void {
    const { x, y } = strike;

    // Positionen aktualisieren
    v.warningFill.setPosition(x, y);
    v.warningRing.setPosition(x, y);
    v.innerRing.setPosition(x, y);
    v.coreGlow.setPosition(x, y);
    v.crossH.setPosition(x, y);
    v.crossV.setPosition(x, y);
    v.bombTrails.setPosition(x, y);
    v.sparks.setPosition(x, y);

    // Fortschritt 0→1 über delayMs
    const total    = strike.explodeAt - strike.armedAt;
    const progress = Phaser.Math.Clamp(1 - (strike.explodeAt - now) / total, 0, 1);

    // Pulsierende Ringe
    const pulse    = 1 + 0.07 * Math.sin(now / 80);
    const ringPulse = 1 + 0.1 * Math.sin(now / 110 + 1.2);
    v.warningFill.setAlpha((0.08 + progress * 0.14) * (0.85 + 0.15 * Math.sin(now / 180)));
    v.warningRing.setAlpha(0.5 + 0.3 * Math.sin(now / 130));
    v.innerRing.setScale(ringPulse);
    v.innerRing.setAlpha(0.5 + progress * 0.4);
    v.coreGlow.setAlpha(0.15 + progress * 0.55);
    v.coreGlow.setScale(pulse);

    // Fadenkreuz pulsiert
    const crossAlpha = 0.6 + 0.4 * progress;
    v.crossH.setAlpha(crossAlpha);
    v.crossV.setAlpha(crossAlpha);

    // Partikelfrequenz nimmt mit Fortschritt zu
    v.bombTrails.frequency = Math.max(20, 120 - progress * 100);
    v.sparks.frequency     = Math.max(15, 90 - progress * 70);

    // Kamera-Shake kurz vor Einschlag
    if (progress > 0.75) {
      this.scene.cameras.main.shake(35, 0.001 + progress * 0.0015);
    }

    // Countdown-Text (1, 2, …)
    const remaining = Math.max(0, Math.ceil((strike.explodeAt - now) / 1000));
    if (remaining > 0 && v.lastCountdown !== remaining) {
      v.lastCountdown = remaining;
      this.effectSystem?.playCountdownText(x, y, remaining);
    }
  }

  private createVisual(strike: SyncedAirstrikeStrike): AirstrikeVisual {
    const { x, y, radius } = strike;

    // Großer Warnkreis (gefüllt)
    const warningFill = this.scene.add.circle(x, y, radius, COL_WARNING, 0.08);
    warningFill.setDepth(DEPTH.CANOPY - 1);
    warningFill.setBlendMode(Phaser.BlendModes.ADD);

    // Äußerer Warnring (Stroke)
    const warningRing = this.scene.add.circle(x, y, radius);
    warningRing.setStrokeStyle(3, COL_RING, 0.65);
    warningRing.setDepth(DEPTH.CANOPY);
    warningRing.setBlendMode(Phaser.BlendModes.ADD);

    // Innerer pulsierender Ring
    const innerRing = this.scene.add.circle(x, y, radius * 0.22);
    innerRing.setStrokeStyle(2, COL_CORE, 0.75);
    innerRing.setDepth(DEPTH.PLAYERS - 1);
    innerRing.setBlendMode(Phaser.BlendModes.ADD);

    // Zentrum-Glow
    const coreGlow = this.scene.add.circle(x, y, 18, COL_GLOW, 0.28);
    coreGlow.setDepth(DEPTH.PLAYERS - 1);
    coreGlow.setBlendMode(Phaser.BlendModes.ADD);

    // Fadenkreuz – horizontal
    const crossH = this.scene.add.rectangle(x, y, radius * 1.2, 2, COL_RING, 0.7);
    crossH.setDepth(DEPTH.PLAYERS - 1);
    crossH.setBlendMode(Phaser.BlendModes.ADD);

    // Fadenkreuz – vertikal
    const crossV = this.scene.add.rectangle(x, y, 2, radius * 1.2, COL_RING, 0.7);
    crossV.setDepth(DEPTH.PLAYERS - 1);
    crossV.setBlendMode(Phaser.BlendModes.ADD);

    // Vom Himmel fallende Bomben-Schweife (fallen senkrecht von oben herab)
    const bombTrails = this.scene.add.particles(x, y, TEX_AS_BOMB, {
      lifespan:    { min: 260, max: 460 },
      speedX:      { min: -28, max: 28 },
      speedY:      { min: 55, max: 110 },
      accelerationY: 30,
      scale:       { start: 1.2, end: 0.2 },
      alpha:       { start: 0.85, end: 0 },
      tint:        [0xffffff, COL_CORE, COL_GLOW, COL_WARNING],
      blendMode:   Phaser.BlendModes.ADD,
      frequency:   80,
      quantity:    1,
    });
    // Spawn-Zone: von oben (y-Offset negativ) über dem Ziel
    bombTrails.clearEmitZones();
    bombTrails.addEmitZone(circleZone(radius * 0.4));
    bombTrails.setDepth(DEPTH.PLAYERS);

    // Funken am Boden
    const sparks = this.scene.add.particles(x, y, TEX_AS_WARN, {
      lifespan:  { min: 200, max: 480 },
      speed:     { min: 20, max: 55 },
      scale:     { start: 0.9, end: 0 },
      alpha:     { start: 0.8, end: 0 },
      tint:      [0xffffff, COL_CORE, COL_GLOW],
      blendMode: Phaser.BlendModes.ADD,
      frequency: 70,
      quantity:  1,
    });
    sparks.addEmitZone(circleZone(radius * 0.15));
    sparks.setDepth(DEPTH.PLAYERS - 1);

    // Atem-Tween für Warnkreis
    this.scene.tweens.add({
      targets:  warningFill,
      alpha:    { from: 0.06, to: 0.2 },
      duration: 350,
      yoyo:     true,
      repeat:   -1,
      ease:     'Sine.easeInOut',
    });

    // Spin-Tween für inneren Ring
    this.scene.tweens.add({
      targets:  innerRing,
      angle:    360,
      duration: 1800,
      repeat:   -1,
      ease:     'Linear',
    });

    return {
      warningFill,
      warningRing,
      innerRing,
      crossH,
      crossV,
      coreGlow,
      bombTrails,
      sparks,
      lastCountdown: null,
    };
  }

  private destroyVisual(v: AirstrikeVisual): void {
    v.warningFill.destroy();
    v.warningRing.destroy();
    v.innerRing.destroy();
    v.coreGlow.destroy();
    v.crossH.destroy();
    v.crossV.destroy();
    v.bombTrails.destroy();
    v.sparks.destroy();
  }
}
