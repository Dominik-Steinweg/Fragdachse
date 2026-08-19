import * as Phaser from 'phaser';
import type { SyncedAirstrikeStrike } from '../types';
import { COOP_DEFENSE_ENEMY_AIRSTRIKE_ATTACKER_ID, DEPTH, VOID_PALETTE } from '../config';
import type { EffectSystem }          from './EffectSystem';
import type { CameraFeedbackController } from './camera/CameraFeedbackController';
import { CAMERA_FEEDBACK_PRIORITY, legacyShakeAmplitudePx, sustainedRumble } from './camera/cameraFeedbackPresets';
import { GPU_VFX_NO_SLOT, GpuVfxPool, type GpuVfxPoolStats } from './gpu/GpuVfxPool';
import { ParticleFlowScheduler } from './gpu/ParticleFlowScheduler';

// ── Textur-Schlüssel ────────────────────────────────────────────────────────
const TEX_AS_BOMB   = '__airstrike_bomb';
const TEX_AS_TRAIL  = '__airstrike_trail';
const TEX_AS_WARN   = '__airstrike_warn';

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

/**
 * Feste Kapazitaet je Layer. Worst Case ist der Eroeffnungs-Sweep von Map 11: bis zu neun
 * gleichzeitige Strikes, Endfrequenz 20 ms (Bombs) bzw. 15 ms (Sparks) bei Lebenszeiten bis
 * 460 ms bzw. 480 ms, also rund 210 bzw. 290 gleichzeitig lebende Member. 1024 laesst rund
 * das Drei- bis Fuenffache an Luft. Keine dynamische Vergroesserung im Hotpath.
 */
const GPU_POOL_CAPACITY = 1024;

/**
 * Die bisherigen Emitter entstanden *zur Strike-Laufzeit*, also nach Spielern, Felsen und den
 * Telegraph-Shapes, und lagen bei gleicher Depth deshalb darueber. Die geteilten Layer
 * entstehen dagegen einmalig beim Szenenaufbau. Ohne Korrektur wuerden sie unter Objekte
 * rutschen, die heute dahinter liegen. Epsilon ist mit 0.001 deutlich kleiner als der
 * kleinste bestehende Abstand (DEPTH.ROCKS 9 → DEPTH.ROCK_MOSS 9.08).
 */
const DEPTH_EPSILON = 0.001;

/** Ergibt zusammen mit `gravityFactor: 1` exakt die bisherige `accelerationY: 30`. */
const BOMB_GRAVITY_PX_PER_S2 = 30;

/** Startwerte der Flow-Countdowns – identisch mit der bisherigen `frequency` beim Erzeugen. */
const BOMB_FLOW_START_MS  = 80;
const SPARK_FLOW_START_MS = 70;

type GpuMember          = Partial<Phaser.Types.GameObjects.SpriteGPULayer.Member>;
type GpuMemberAnimation = Phaser.Types.GameObjects.SpriteGPULayer.MemberAnimation;

/** Ruhepose: flaechenlos und unsichtbar, bis der Slot bespielt wird. */
const DEAD_MEMBER: GpuMember = { scaleX: 0, scaleY: 0, alpha: 0 };

/**
 * Wiederverwendete Spawn-Vorlagen. Die verschachtelten Animationsobjekte werden nur mutiert,
 * niemals neu angelegt – `editMember` liest sie synchron aus. `loop`/`yoyo` defaulten in Phaser
 * auf `true` und muessen fuer One-Shots ueberall explizit `false` sein.
 */
const bombX: GpuMemberAnimation     = { base: 0, amplitude: 0, duration: 0, ease: 'Linear', loop: false, yoyo: false };
const bombY: GpuMemberAnimation     = { base: 0, velocity: 0, gravityFactor: 1, duration: 0, ease: 'Gravity', loop: false, yoyo: false };
const bombScale: GpuMemberAnimation = { base: 1.2, amplitude: -1, duration: 0, ease: 'Linear', loop: false, yoyo: false };
const bombAlpha: GpuMemberAnimation = { base: 0.85, amplitude: -0.85, duration: 0, ease: 'Linear', loop: false, yoyo: false };
const BOMB_MEMBER: GpuMember = {
  x: bombX, y: bombY, scaleX: bombScale, scaleY: bombScale, alpha: bombAlpha, tintBlend: 1,
  tintTopLeft: 0xffffff, tintTopRight: 0xffffff, tintBottomLeft: 0xffffff, tintBottomRight: 0xffffff,
};

const sparkX: GpuMemberAnimation     = { base: 0, amplitude: 0, duration: 0, ease: 'Linear', loop: false, yoyo: false };
const sparkY: GpuMemberAnimation     = { base: 0, amplitude: 0, duration: 0, ease: 'Linear', loop: false, yoyo: false };
const sparkScale: GpuMemberAnimation = { base: 0.9, amplitude: -0.9, duration: 0, ease: 'Linear', loop: false, yoyo: false };
const sparkAlpha: GpuMemberAnimation = { base: 0.8, amplitude: -0.8, duration: 0, ease: 'Linear', loop: false, yoyo: false };
const SPARK_MEMBER: GpuMember = {
  x: sparkX, y: sparkY, scaleX: sparkScale, scaleY: sparkScale, alpha: sparkAlpha, tintBlend: 1,
  tintTopLeft: 0xffffff, tintTopRight: 0xffffff, tintBottomLeft: 0xffffff, tintBottomRight: 0xffffff,
};

/** Scratch fuer die Spawn-Zone; `Circle.Random` liefert dieselbe Flaechenverteilung wie bisher. */
const SPAWN_CIRCLE = new Phaser.Geom.Circle(0, 0, 1);
const SPAWN_POINT  = new Phaser.Math.Vector2(0, 0);

function pickTint(tints: number[]): number {
  // Identisch zu Phasers `EmitterOp.randomStaticValueEmit` fuer Tint-Arrays.
  return tints[Math.floor(Math.random() * tints.length)];
}

function setTint(member: GpuMember, tint: number): void {
  member.tintTopLeft     = tint;
  member.tintTopRight    = tint;
  member.tintBottomLeft  = tint;
  member.tintBottomRight = tint;
}

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
 * Strike, sondern ueber genau zwei szenenweit geteilte `SpriteGPULayer` – unabhaengig davon,
 * wie viele Strikes gleichzeitig laufen. Ein gespawntes Partikel bekommt danach kein
 * CPU-Update mehr: Bewegung, Scale und Alpha sind GPU-Member-Animationen.
 *
 * Getrennt bleiben dabei bewusst zwei Dinge: `sync()` fuehrt Strike-Zustand und die aktuell
 * gueltige Emissionsfrequenz nach, `updateParticles()` nur Flow-Countdown und faellige Rearms.
 * Auf Clients laeuft `sync()` nicht garantiert in jedem Renderframe mit frischem Netzzustand,
 * waehrend der bisherige Emitter autonom weiterlief – der Partikel-Tick braucht deshalb einen
 * eigenen, rollenunabhaengigen Aufruf pro Frame.
 */
export class AirstrikeRenderer {
  private visuals     = new Map<number, AirstrikeVisual>();
  /** Parallel zur Map, damit der Partikel-Tick ohne Iterator-Allokation laufen kann. */
  private readonly activeVisuals: AirstrikeVisual[] = [];
  private effectSystem: EffectSystem | null = null;
  private cameraFeedback: CameraFeedbackController | null = null;

  private bombLayer:  Phaser.GameObjects.SpriteGPULayer | null = null;
  private sparkLayer: Phaser.GameObjects.SpriteGPULayer | null = null;
  private bombPool:   GpuVfxPool | null = null;
  private sparkPool:  GpuVfxPool | null = null;
  /** Eigene monotone Uhr fuer Slot-Lebenszeiten; identisch getaktet mit den GPU-Animationen. */
  private particleClockMs = 0;
  /** Letzter gesehener Stand von `layer.timeElapsed`, um dessen Ruecksprung zu erkennen. */
  private lastBombTimeElapsed = 0;
  private lastSparkTimeElapsed = 0;
  private gpuParticlesSuppressed = false;

  constructor(private readonly scene: Phaser.Scene) {}

  setEffectSystem(es: EffectSystem): void {
    this.effectSystem = es;
  }

  setCameraFeedback(controller: CameraFeedbackController | null): void {
    this.cameraFeedback = controller;
  }

  generateTextures(): void {
    const texMgr = this.scene.textures;

    // Bomben-Silhouette (8×20 px)
    if (!texMgr.exists(TEX_AS_BOMB)) {
      const c = texMgr.createCanvas(TEX_AS_BOMB, 8, 20);
      if (c) {
        const ctx = c.context;
        const g = ctx.createLinearGradient(0, 0, 0, 20);
        g.addColorStop(0,   'rgba(255,255,255,0.0)');
        g.addColorStop(0.2, 'rgba(255,255,255,0.85)');
        g.addColorStop(0.7, 'rgba(255,255,255,0.65)');
        g.addColorStop(1,   'rgba(255,255,255,0.0)');
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
        grad.addColorStop(0,   'rgba(255,255,255,1)');
        grad.addColorStop(0.5, 'rgba(255,255,255,0.7)');
        grad.addColorStop(1,   'rgba(255,255,255,0)');
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
        grad.addColorStop(0,   'rgba(255,255,255,1)');
        grad.addColorStop(0.4, 'rgba(255,255,255,0.7)');
        grad.addColorStop(1,   'rgba(255,255,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 8, 8);
        c.refresh();
      }
    }
  }

  /**
   * Legt die beiden geteilten GPU-Layer an – einmalig, szenenlebenslang, niemals pro Strike.
   * Direkt nach `generateTextures()` aufzurufen.
   */
  initGpuLayers(): void {
    if (this.bombLayer) return;

    this.bombLayer = this.scene.add.spriteGPULayer(TEX_AS_BOMB, GPU_POOL_CAPACITY);
    this.bombLayer.setBlendMode(Phaser.BlendModes.ADD);
    this.bombLayer.setDepth(DEPTH.PLAYERS + DEPTH_EPSILON);
    // Der Shader rechnet `0.5 * uGravity * gravityFactor * t^2`; `gravityFactor: 1` wird als 0
    // kodiert und vom Shader wieder als 1 gelesen, die Beschleunigung ist damit exakt 30 px/s².
    this.bombLayer.gravity = BOMB_GRAVITY_PX_PER_S2;

    this.sparkLayer = this.scene.add.spriteGPULayer(TEX_AS_WARN, GPU_POOL_CAPACITY);
    this.sparkLayer.setBlendMode(Phaser.BlendModes.ADD);
    this.sparkLayer.setDepth(DEPTH.PLAYERS - 1 + DEPTH_EPSILON);

    // Priming: jeder erstmals auftauchende Ease-Typ laesst Shader und FrameData neu bauen. Die
    // hier verwendeten Typen deshalb vorab freischalten, damit der erste Airstrike keinen
    // Rebuild ausloest. Die Namen muessen exakt die aus Phasers Rueckwaertsabbildung
    // `EASE_CODES` sein – mehrere Aliase teilen sich einen Code (Power0 und Linear beide 1),
    // und `_setAnimatedValue` prueft gegen den zuletzt eingetragenen Namen, also 'Linear'.
    this.bombLayer.setAnimationEnabled('Linear', true);
    this.bombLayer.setAnimationEnabled('Gravity', true);
    this.sparkLayer.setAnimationEnabled('Linear', true);

    this.bombPool  = new GpuVfxPool(this.bombLayer, GPU_POOL_CAPACITY, 'airstrike-bomb');
    this.sparkPool = new GpuVfxPool(this.sparkLayer, GPU_POOL_CAPACITY, 'airstrike-spark');
    this.bombPool.prime(DEAD_MEMBER);
    this.sparkPool.prime(DEAD_MEMBER);
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
    this.bombPool?.releaseAll();
    this.sparkPool?.releaseAll();
  }

  /**
   * Partikel-Tick, unabhaengig von Rolle und Netzzustand pro Renderframe aufzurufen. Erst
   * abgelaufene Slots stilllegen, dann faellige Rearms – in dieser Reihenfolge, weil `acquire()`
   * nur freie Slots vergibt.
   */
  updateParticles(deltaMs: number): void {
    const bombPool  = this.bombPool;
    const sparkPool = this.sparkPool;
    if (!bombPool || !sparkPool) return;

    this.handleLayerTimeWrap();

    this.particleClockMs += deltaMs;
    const now = this.particleClockMs;
    bombPool.retireExpired(now);
    sparkPool.retireExpired(now);

    // Waehrend der Ablation ruhen Rendering *und* Scheduler. Die Countdowns bleiben stehen,
    // damit beim Segmentende nichts nachgeholt wird.
    if (this.gpuParticlesSuppressed) return;

    for (let index = 0; index < this.activeVisuals.length; index += 1) {
      const visual = this.activeVisuals[index];
      const bombs  = visual.bombFlow.tick(deltaMs);
      for (let n = 0; n < bombs; n += 1) this.spawnBomb(visual, now);
      const sparks = visual.sparkFlow.tick(deltaMs);
      for (let n = 0; n < sparks; n += 1) this.spawnSpark(visual, now);
    }
  }

  /**
   * Ablations-Hook. GPU-Zeit laesst sich nicht anhalten, deshalb ist das Stilllegen der
   * laufenden Member das Aequivalent zum `setActive(false)` der klassischen Emitter.
   */
  setSuppressed(suppressed: boolean): void {
    if (this.gpuParticlesSuppressed === suppressed) return;
    this.gpuParticlesSuppressed = suppressed;
    this.bombLayer?.setVisible(!suppressed);
    this.sparkLayer?.setVisible(!suppressed);
    if (suppressed) {
      this.bombPool?.releaseAll();
      this.sparkPool?.releaseAll();
    }
  }

  /**
   * Leichtgewichtige Diagnose. Der `ArenaRuntimeProfiler` zaehlt weiterhin nur klassische
   * `ParticleEmitter`; GPU-Member tauchen dort naturgemaess nicht auf.
   */
  getGpuVfxStats(): { bomb: GpuVfxPoolStats; spark: GpuVfxPoolStats } | null {
    if (!this.bombPool || !this.sparkPool) return null;
    return { bomb: this.bombPool.getStats(), spark: this.sparkPool.getStats() };
  }

  // ── Hilfsmethoden ──────────────────────────────────────────────────────────

  /**
   * Der `ElapseTimer` eines Layers springt nach `timeElapsedResetPeriod` (eine Stunde) auf null
   * zurueck, ohne die `creationTime` der Member mitzuziehen. Deren Animationen wuerden dann
   * schlagartig weit ueber ihr Ende hinaus extrapolieren – bei ADD ein bildschirmfuellender
   * Blitz, bis der Retire-Sweep nachkommt. Beim Ruecksprung deshalb sofort alles stilllegen;
   * das kostet einmal pro Stunde ein paar hundert ohnehin kurzlebige Partikel.
   */
  private handleLayerTimeWrap(): void {
    const bombTime = this.bombLayer?.timeElapsed ?? 0;
    if (bombTime < this.lastBombTimeElapsed) this.bombPool?.releaseAll();
    this.lastBombTimeElapsed = bombTime;

    const sparkTime = this.sparkLayer?.timeElapsed ?? 0;
    if (sparkTime < this.lastSparkTimeElapsed) this.sparkPool?.releaseAll();
    this.lastSparkTimeElapsed = sparkTime;
  }

  /**
   * Bombe: Spawn in einem um (x,y) zentrierten Kreis mit `radius * 0.4`, lineare X-Bewegung,
   * Gravity-Y-Bewegung. `speedX`/`speedY` im alten Config schalteten den Emitter auf
   * nicht-radial, beide Komponenten werden also unabhaengig gezogen.
   */
  private spawnBomb(visual: AirstrikeVisual, nowMs: number): void {
    const pool  = this.bombPool;
    const layer = this.bombLayer;
    if (!pool || !layer) return;

    const life = Phaser.Math.FloatBetween(260, 460);
    const slot = pool.acquire(visual.id, nowMs, life);
    if (slot === GPU_VFX_NO_SLOT) return;

    SPAWN_CIRCLE.setTo(visual.x, visual.y, visual.radius * 0.4);
    Phaser.Geom.Circle.Random(SPAWN_CIRCLE, SPAWN_POINT);

    const lifeS = life / 1000;
    bombX.base      = SPAWN_POINT.x;
    bombX.amplitude = Phaser.Math.FloatBetween(-28, 28) * lifeS;
    bombX.duration  = life;
    bombY.base      = SPAWN_POINT.y;
    // Phaser kodiert `velocity` ganzzahlig (`Math.floor`); die Rundung kostet < 0,5 px/s und
    // ueber die maximale Lebenszeit weniger als einen Viertelpixel.
    bombY.velocity  = Math.round(Phaser.Math.FloatBetween(55, 110));
    bombY.duration  = life;
    bombScale.duration = life;
    bombAlpha.duration = life;
    setTint(BOMB_MEMBER, pickTint(visual.palette.bombTints));

    layer.editMember(slot, BOMB_MEMBER);
  }

  /**
   * Funke: Spawn in `radius * 0.15`, radiale Geschwindigkeit aus einer einzigen Speed-Ziehung
   * und gleichverteiltem Winkel – so wirkte das alte `speed`-Config im radialen Modus.
   */
  private spawnSpark(visual: AirstrikeVisual, nowMs: number): void {
    const pool  = this.sparkPool;
    const layer = this.sparkLayer;
    if (!pool || !layer) return;

    const life = Phaser.Math.FloatBetween(200, 480);
    const slot = pool.acquire(visual.id, nowMs, life);
    if (slot === GPU_VFX_NO_SLOT) return;

    SPAWN_CIRCLE.setTo(visual.x, visual.y, visual.radius * 0.15);
    Phaser.Geom.Circle.Random(SPAWN_CIRCLE, SPAWN_POINT);

    const lifeS = life / 1000;
    const speed = Phaser.Math.FloatBetween(20, 55);
    const rad   = Phaser.Math.DegToRad(Phaser.Math.FloatBetween(0, 360));
    sparkX.base      = SPAWN_POINT.x;
    sparkX.amplitude = Math.cos(rad) * speed * lifeS;
    sparkX.duration  = life;
    sparkY.base      = SPAWN_POINT.y;
    sparkY.amplitude = Math.sin(rad) * speed * lifeS;
    sparkY.duration  = life;
    sparkScale.duration = life;
    sparkAlpha.duration = life;
    setTint(SPARK_MEMBER, pickTint(visual.palette.sparkTints));

    layer.editMember(slot, SPARK_MEMBER);
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
    // Bekannte Inkonsistenz, hier absichtlich unveraendert uebernommen: der Wert umgeht die
    // Flow-Skalierung des GraphicsQuality-Controllers. Auf `high` sind alle `particleFactors`
    // gleich 1, die Darstellung ist dort also identisch; unterhalb von `high` entfaellt mit den
    // Emittern zusaetzlich deren `maxAliveParticles`-Deckel. Beides gehoert zusammen und wird
    // getrennt von dieser Migration behoben.
    v.bombFlow.setFrequency(Math.max(20, 120 - progress * 100));
    v.sparkFlow.setFrequency(Math.max(15, 90 - progress * 70));

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
    this.bombPool?.releaseOwner(v.id);
    this.sparkPool?.releaseOwner(v.id);
    const index = this.activeVisuals.indexOf(v);
    if (index >= 0) this.activeVisuals.splice(index, 1);
  }
}
