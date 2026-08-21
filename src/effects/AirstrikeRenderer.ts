import * as Phaser from 'phaser';
import type { SyncedAirstrikeStrike } from '../types';
import { COOP_DEFENSE_ENEMY_AIRSTRIKE_ATTACKER_ID, DEPTH, VOID_PALETTE } from '../config';
import type { EffectSystem }          from './EffectSystem';
import type { CameraFeedbackController } from './camera/CameraFeedbackController';
import { CAMERA_FEEDBACK_PRIORITY, legacyShakeAmplitudePx, sustainedRumble } from './camera/cameraFeedbackPresets';
import { GpuVfxEase } from './gpu/GpuVfxEase';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import { pickGpuVfxTint } from './gpu/GpuVfxMember';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';
import { ensureAirstrikeBombTexture, ensureAirstrikeSparkTexture } from './gpu/GpuVfxSourceTextures';
import { GPU_VFX_NO_SOURCE_HANDLE, type GpuVfxSystem } from './gpu/GpuVfxSystem';
import { ParticleFlowScheduler } from './gpu/ParticleFlowScheduler';

// ── Textur-Schlüssel ────────────────────────────────────────────────────────
const TEX_AS_TRAIL  = '__airstrike_trail';

// ── Farb-Palette ────────────────────────────────────────────────────────────
const COL_WARNING  = 0xff6600;
const COL_GLOW     = 0xff9933;
const COL_CORE     = 0xffcc66;
const COL_RING     = 0xffaa00;

interface AirstrikePalette {
  warning:    number;
  glow:       number;
  core:       number;
  ring:       number;
  bombTints:  number[];
  sparkTints: number[];
}

const PLAYER_AIRSTRIKE_PALETTE: AirstrikePalette = {
  warning:    COL_WARNING,
  glow:       COL_GLOW,
  core:       COL_CORE,
  ring:       COL_RING,
  bombTints:  [0xffffff, COL_CORE, COL_GLOW, COL_WARNING],
  sparkTints: [0xffffff, COL_CORE, COL_GLOW],
};

/** Void-Akzent nur fuer den gegnerischen Telegraphen; der Einschlag bleibt warm. */
const ENEMY_AIRSTRIKE_PALETTE: AirstrikePalette = {
  warning:    VOID_PALETTE.deep,
  glow:       VOID_PALETTE.primary,
  core:       VOID_PALETTE.bright,
  ring:       VOID_PALETTE.primary,
  bombTints:  [VOID_PALETTE.core, VOID_PALETTE.bright, VOID_PALETTE.primary, VOID_PALETTE.deep],
  sparkTints: [VOID_PALETTE.core, VOID_PALETTE.bright, VOID_PALETTE.primary],
};

// ── GPU-Partikel: Konstanten ────────────────────────────────────────────────

/** Startwerte der Flow-Countdowns – identisch mit der bisherigen `frequency` beim Erzeugen. */
const BOMB_FLOW_START_MS  = 80;
const SPARK_FLOW_START_MS = 70;

const BOMB_SCALE_START = 1.2;
const BOMB_SCALE_END   = 0.2;
const BOMB_ALPHA_START = 0.85;

const SPARK_SCALE_START = 0.9;
const SPARK_ALPHA_START = 0.8;

/** Scratch fuer die Spawn-Zone; `Circle.Random` liefert dieselbe Flaechenverteilung wie bisher. */
const SPAWN_CIRCLE = new Phaser.Geom.Circle(0, 0, 1);
const SPAWN_POINT  = new Phaser.Math.Vector2(0, 0);

// ── Visuelle State pro Strike ────────────────────────────────────────────────

interface AirstrikeVisual {
  id:            number;
  // Boden-Warnkreis
  warningFill:   Phaser.GameObjects.Arc;
  warningRing:   Phaser.GameObjects.Arc;
  innerRing:     Phaser.GameObjects.Arc;
  // Fadenkreuz-Linien (4 Arme)
  crossH:        Phaser.GameObjects.Rectangle;
  crossV:        Phaser.GameObjects.Rectangle;
  // Zentral-Glow
  coreGlow:      Phaser.GameObjects.Arc;
  // Emissionssteuerung der GPU-Partikel
  x:             number;
  y:             number;
  radius:        number;
  palette:       AirstrikePalette;
  bombFlow:      ParticleFlowScheduler;
  sparkFlow:     ParticleFlowScheduler;
  /** Numerischer Source-Handle des Backends; alle Partikel dieses Strikes haengen daran. */
  source:        number;
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
 *
 * ## Partikel auf der GPU
 *
 * Bomben-Schweife und Boden-Funken laufen nicht mehr ueber je einen `ParticleEmitter` pro
 * Strike, sondern ueber zwei szenenweit geteilte Render-Lanes des GPU-VFX-Backends – unabhaengig
 * davon, wie viele Strikes gleichzeitig laufen. Ein gespawntes Partikel bekommt danach kein
 * CPU-Update mehr: Bewegung, Scale und Alpha sind GPU-Member-Animationen.
 *
 * Getrennt bleiben dabei bewusst zwei Dinge: `sync()` fuehrt Strike-Zustand und die aktuell
 * gueltige Emissionsfrequenz nach, der beim `GpuVfxSystem` angemeldete Emissions-Tick nur
 * Flow-Countdown und faellige Rearms. Auf Clients laeuft `sync()` nicht garantiert in jedem
 * Renderframe mit frischem Netzzustand, waehrend der bisherige Emitter autonom weiterlief – der
 * Partikel-Tick braucht deshalb einen eigenen, rollenunabhaengigen Aufruf pro Frame.
 */
export class AirstrikeRenderer {
  private visuals     = new Map<number, AirstrikeVisual>();
  /** Parallel zur Map, damit der Partikel-Tick ohne Iterator-Allokation laufen kann. */
  private readonly activeVisuals: AirstrikeVisual[] = [];
  private effectSystem: EffectSystem | null = null;
  private cameraFeedback: CameraFeedbackController | null = null;

  private gpuVfx: GpuVfxSystem | null = null;
  private bombSpec:  GpuVfxSpawnSpec | null = null;
  private sparkSpec: GpuVfxSpawnSpec | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  setEffectSystem(es: EffectSystem): void {
    this.effectSystem = es;
  }

  setCameraFeedback(controller: CameraFeedbackController | null): void {
    this.cameraFeedback = controller;
  }

  generateTextures(): void {
    const texMgr = this.scene.textures;

    // Bomben-Silhouette und Bodenfunke liegen im gemeinsamen GPU-VFX-Atlas.
    ensureAirstrikeBombTexture(this.scene);
    ensureAirstrikeSparkTexture(this.scene);

    // Schweif-Partikel (6×6 px, weiß→orange)
    if (!texMgr.exists(TEX_AS_TRAIL)) {
      const c = texMgr.createCanvas(TEX_AS_TRAIL, 6, 6);
      if (c) {
        const ctx  = c.context;
        const grad = ctx.createRadialGradient(3, 3, 0, 3, 3, 3);
        grad.addColorStop(0,   'rgba(255,255,255,1)');
        grad.addColorStop(0.5, 'rgba(255,255,255,0.7)');
        grad.addColorStop(1,   'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 6, 6);
        c.refresh();
      }
    }

  }

  /**
   * Meldet Bomben und Funken beim gemeinsamen GPU-VFX-Backend an. Die Layer gehoeren dem
   * Backend; hier entstehen nur die beiden Spawn-Specs.
   */
  registerGpuVfx(system: GpuVfxSystem): void {
    if (this.gpuVfx) return;
    this.gpuVfx = system;

    this.bombSpec = system.createSpec(GpuVfxEffectId.AirstrikeBomb);
    // Der Shader rechnet `0.5 * uGravity * gravityFactor * t^2` mit der layerglobalen Gravity
    // der Lane – exakt die fruehere `accelerationY: 30`.
    this.bombSpec.yMode      = GpuVfxEase.Gravity;
    this.bombSpec.scaleStart = BOMB_SCALE_START;
    this.bombSpec.scaleEnd   = BOMB_SCALE_END;
    this.bombSpec.alphaStart = BOMB_ALPHA_START;
    this.bombSpec.alphaEnd   = 0;

    this.sparkSpec = system.createSpec(GpuVfxEffectId.AirstrikeSpark);
    this.sparkSpec.scaleStart = SPARK_SCALE_START;
    this.sparkSpec.scaleEnd   = 0;
    this.sparkSpec.alphaStart = SPARK_ALPHA_START;
    this.sparkSpec.alphaEnd   = 0;

    system.registerEmission((deltaMs, nowMs) => this.emitParticles(deltaMs, nowMs));
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
        this.activeVisuals.push(visual);
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
    this.activeVisuals.length = 0;
    // Die Strikes haben ihre Quellen in `destroyVisual()` bereits freigegeben.
  }

  // ── Hilfsmethoden ──────────────────────────────────────────────────────────

  /**
   * Emissions-Tick, von der Registry pro Renderframe gerufen – nach dem Retire-Sweep und nur
   * ausserhalb der Ablation.
   */
  private emitParticles(deltaMs: number, nowMs: number): void {
    const quality = this.gpuVfx?.quality;
    // Faktor 0 (dekorativ auf `low`) stellt die Emission ganz ab, wie `applyEmitterProfile`.
    const bombOn  = !quality || quality.getEmissionFactor(GpuVfxEffectId.AirstrikeBomb) > 0;
    const sparkOn = !quality || quality.getEmissionFactor(GpuVfxEffectId.AirstrikeSpark) > 0;

    for (let index = 0; index < this.activeVisuals.length; index += 1) {
      const visual = this.activeVisuals[index];
      const bombs  = visual.bombFlow.tick(deltaMs);
      if (bombOn) for (let n = 0; n < bombs; n += 1) this.spawnBomb(visual, nowMs);
      const sparks = visual.sparkFlow.tick(deltaMs);
      if (sparkOn) for (let n = 0; n < sparks; n += 1) this.spawnSpark(visual, nowMs);
    }
  }

  /**
   * Bombe: Spawn in einem um (x,y) zentrierten Kreis mit `radius * 0.4`, lineare X-Bewegung,
   * Gravity-Y-Bewegung. `speedX`/`speedY` im alten Config schalteten den Emitter auf
   * nicht-radial, beide Komponenten werden also unabhaengig gezogen.
   */
  private spawnBomb(visual: AirstrikeVisual, nowMs: number): void {
    const system = this.gpuVfx;
    const spec = this.bombSpec;
    if (!system || !spec) return;

    // Ziehreihenfolge wie bisher: erst Lebenszeit, dann Zone, dann Geschwindigkeit.
    spec.lifeMs = Phaser.Math.FloatBetween(260, 460);
    SPAWN_CIRCLE.setTo(visual.x, visual.y, visual.radius * 0.4);
    Phaser.Geom.Circle.Random(SPAWN_CIRCLE, SPAWN_POINT);

    spec.x  = SPAWN_POINT.x;
    spec.y  = SPAWN_POINT.y;
    spec.vx = Phaser.Math.FloatBetween(-28, 28);
    spec.vy = Phaser.Math.FloatBetween(55, 110);
    spec.tint = pickGpuVfxTint(visual.palette.bombTints);

    system.spawn(spec, visual.source, nowMs);
  }

  /**
   * Funke: Spawn in `radius * 0.15`, radiale Geschwindigkeit aus einer einzigen Speed-Ziehung
   * und gleichverteiltem Winkel – so wirkte das alte `speed`-Config im radialen Modus.
   */
  private spawnSpark(visual: AirstrikeVisual, nowMs: number): void {
    const system = this.gpuVfx;
    const spec = this.sparkSpec;
    if (!system || !spec) return;

    // Ziehreihenfolge wie bisher: erst Lebenszeit, dann Zone, dann Geschwindigkeit.
    spec.lifeMs = Phaser.Math.FloatBetween(200, 480);
    SPAWN_CIRCLE.setTo(visual.x, visual.y, visual.radius * 0.15);
    Phaser.Geom.Circle.Random(SPAWN_CIRCLE, SPAWN_POINT);

    const speed = Phaser.Math.FloatBetween(20, 55);
    const rad   = Phaser.Math.DegToRad(Phaser.Math.FloatBetween(0, 360));
    spec.x  = SPAWN_POINT.x;
    spec.y  = SPAWN_POINT.y;
    spec.vx = Math.cos(rad) * speed;
    spec.vy = Math.sin(rad) * speed;
    spec.tint = pickGpuVfxTint(visual.palette.sparkTints);

    system.spawn(spec, visual.source, nowMs);
  }

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
    v.x = x;
    v.y = y;

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

    // Partikelfrequenz nimmt mit Fortschritt zu. Der Wechsel setzt den laufenden Flow-Countdown
    // bewusst nicht zurueck – genau so verhielt sich der direkte Schreibzugriff auf
    // `emitter.frequency`.
    //
    // Das progress-abhaengige Intervall ist die Basis, die zentrale Quality-Politik streckt sie.
    // Auf `high` (Faktor 1) ist das bitgleich zu vorher; darunter emittiert der Airstrike jetzt
    // ueberhaupt qualitaetsabhaengig. Bis zur Zentralisierung tat er das nie: die alten Emitter
    // bekamen zwar eine skalierte `frequency`, `updateVisual()` ueberschrieb sie aber im selben
    // Frame, und ein `maxAliveParticles`-Deckel kam wegen `lifespan: {min,max}` nie zustande.
    const quality = this.gpuVfx?.quality;
    const bombBase  = Math.max(20, 120 - progress * 100);
    const sparkBase = Math.max(15, 90 - progress * 70);
    v.bombFlow.setFrequency(quality?.scaleFrequency(bombBase, GpuVfxEffectId.AirstrikeBomb) ?? bombBase);
    v.sparkFlow.setFrequency(quality?.scaleFrequency(sparkBase, GpuVfxEffectId.AirstrikeSpark) ?? sparkBase);

    // Anschwellendes Rumpeln kurz vor dem Einschlag. Stabile `id` je Strike: die Anforderung
    // läuft pro Frame und soll die Quelle aktualisieren, nicht stapeln oder neu starten.
    if (progress > 0.75) {
      this.cameraFeedback?.request(sustainedRumble(
        `airstrike:${strike.id}`,
        legacyShakeAmplitudePx(0.001 + progress * 0.0015),
        CAMERA_FEEDBACK_PRIORITY.telegraph,
        { sourceX: x, sourceY: y },
      ));
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
    const palette = strike.triggeredBy === COOP_DEFENSE_ENEMY_AIRSTRIKE_ATTACKER_ID
      ? ENEMY_AIRSTRIKE_PALETTE
      : PLAYER_AIRSTRIKE_PALETTE;

    // Die Marker der Gefahrenzone bleiben bewusst ungedämpft (`setBlendMode` statt
    // `makeAdditive`): sie sind ein Telegraph, keine Impact-Grafik, und müssen zu jeder
    // Tageszeit voll lesbar bleiben. Der Einschlag weiter unten wird dagegen gedämpft.

    // Großer Warnkreis (gefüllt)
    const warningFill = this.scene.add.circle(x, y, radius, palette.warning, 0.08);
    warningFill.setDepth(DEPTH.CANOPY - 1);
    warningFill.setBlendMode(Phaser.BlendModes.ADD);

    // Äußerer Warnring (Stroke)
    const warningRing = this.scene.add.circle(x, y, radius);
    warningRing.setStrokeStyle(3, palette.ring, 0.65);
    warningRing.setDepth(DEPTH.CANOPY);
    warningRing.setBlendMode(Phaser.BlendModes.ADD);

    // Innerer pulsierender Ring
    const innerRing = this.scene.add.circle(x, y, radius * 0.22);
    innerRing.setStrokeStyle(2, palette.core, 0.75);
    innerRing.setDepth(DEPTH.PLAYERS - 1);
    innerRing.setBlendMode(Phaser.BlendModes.ADD);

    // Zentrum-Glow
    const coreGlow = this.scene.add.circle(x, y, 18, palette.glow, 0.28);
    coreGlow.setDepth(DEPTH.PLAYERS - 1);
    coreGlow.setBlendMode(Phaser.BlendModes.ADD);

    // Fadenkreuz – horizontal
    const crossH = this.scene.add.rectangle(x, y, radius * 1.2, 2, palette.ring, 0.7);
    crossH.setDepth(DEPTH.PLAYERS - 1);
    crossH.setBlendMode(Phaser.BlendModes.ADD);

    // Fadenkreuz – vertikal
    const crossV = this.scene.add.rectangle(x, y, 2, radius * 1.2, palette.ring, 0.7);
    crossV.setDepth(DEPTH.PLAYERS - 1);
    crossV.setBlendMode(Phaser.BlendModes.ADD);

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
      id: strike.id,
      warningFill,
      warningRing,
      innerRing,
      crossH,
      crossV,
      coreGlow,
      x,
      y,
      radius,
      palette,
      bombFlow:  new ParticleFlowScheduler(BOMB_FLOW_START_MS),
      sparkFlow: new ParticleFlowScheduler(SPARK_FLOW_START_MS),
      // Bomben und Funken teilen sich die Quelle: sie verschwinden gemeinsam mit dem Strike.
      source: this.gpuVfx?.createSource(GpuVfxEffectId.AirstrikeBomb) ?? GPU_VFX_NO_SOURCE_HANDLE,
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
    // Noch sichtbare Partikel dieses Strikes sofort ausblenden – wie bisher `emitter.destroy()`.
    this.gpuVfx?.releaseSource(v.source);
    const index = this.activeVisuals.indexOf(v);
    if (index >= 0) this.activeVisuals.splice(index, 1);
  }
}
