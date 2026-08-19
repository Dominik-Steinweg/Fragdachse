import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import type { MiniRocketFlightPhase } from '../types';
import { getGraphicsQualityController, type GraphicsQualityController } from '../graphics/GraphicsQuality';
import { GPU_VFX_NO_SLOT } from './gpu/GpuVfxPool';
import {
  GPU_VFX_DEPTH_EPSILON,
  gpuVfxEasedBase,
  pickGpuVfxTint,
  setGpuVfxTint,
  type GpuVfxEmitter,
  type GpuVfxMember,
  type GpuVfxMemberAnimation,
  type GpuVfxRegistry,
} from './gpu/GpuVfxRegistry';
import { ParticleFlowScheduler } from './gpu/ParticleFlowScheduler';

const TEX_ROCKET_BODY = '__rocket_body';
const TEX_ROCKET_ACCENT = '__rocket_accent';
const TEX_ROCKET_SMOKE = '__rocket_smoke';
const TEX_ROCKET_EXHAUST = '__rocket_exhaust';
const TEX_ROCKET_GLOW = '__rocket_glow';
const TEX_ROCKET_ENGINE = '__rocket_engine';

// ── GPU-Exhaust: Konstanten ─────────────────────────────────────────────────

/**
 * Feste Kapazitaet des geteilten Exhaust-Layers. Der Exhaust emittiert durchgehend, solange
 * eine Rakete fliegt: auf `high` alle 14 ms bei bis zu 140 ms Lebenszeit, also rund zehn
 * gleichzeitig lebende Member je Rakete. 2048 traegt damit ueber 200 gleichzeitige Raketen –
 * deutlich mehr, als Salven, Turret-Bursts und Mini-Rocket-Kaskaden zusammen erzeugen. Keine
 * dynamische Vergroesserung im Hotpath; ein Overrun verwirft den Spawn, statt lebendes
 * Material zu ueberschreiben.
 */
const EXHAUST_POOL_CAPACITY = 2048;

/** Basisintervall der Emission; GraphicsQuality streckt es wie bisher ueber seinen Faktor. */
const EXHAUST_BASE_FREQUENCY_MS = 14;

const EXHAUST_LIFE_MIN_MS  = 80;
const EXHAUST_LIFE_MAX_MS  = 140;
/** `speedX`/`speedY` im alten Config: nicht-radial, beide Achsen unabhaengig gezogen. */
const EXHAUST_SPEED_SPREAD = 12;

/**
 * Fester Scale-Verlauf, wie er heute tatsaechlich gerendert wird.
 *
 * Der bisherige `setParticleScale(Math.max(size / 34, 0.18), 0.05)`-Aufruf pro Frame war
 * wirkungslos: `scale: { start, end }` laedt Op-Methode 5 (eased) auf `scaleX` und deaktiviert
 * `scaleY`; `onChange()` schreibt bei dieser Methode nur das Bookkeeping-Feld `current`, nicht
 * `start`/`end`, und `easedValueEmit()` ueberschreibt `current` beim naechsten Spawn ohnehin
 * wieder mit `this.start`. Der Exhaust lief damit bei jeder Rakete auf 0.34 → 0.05. Diese
 * Migration bildet den Ist-Zustand ab; ein groessenabhaengiger Startscale ist eine bewusste
 * optische Entscheidung und gehoert in einen eigenen Commit, nicht in den Performance-Piloten.
 */
const EXHAUST_SCALE_START = 0.34;
const EXHAUST_SCALE_END   = 0.05;
const EXHAUST_ALPHA_START = 0.95;

/**
 * Wiederverwendete Spawn-Vorlage; die verschachtelten Animationsobjekte werden nur mutiert.
 * `loop`/`yoyo` defaulten in Phaser auf `true` und muessen fuer One-Shots explizit `false` sein.
 */
const exhaustX: GpuVfxMemberAnimation = { base: 0, amplitude: 0, duration: 0, ease: 'Linear', loop: false, yoyo: false };
const exhaustY: GpuVfxMemberAnimation = { base: 0, amplitude: 0, duration: 0, ease: 'Linear', loop: false, yoyo: false };
const exhaustScale: GpuVfxMemberAnimation = {
  base: EXHAUST_SCALE_START,
  amplitude: EXHAUST_SCALE_END - EXHAUST_SCALE_START,
  duration: 0, ease: 'Linear', loop: false, yoyo: false,
};
const exhaustAlpha: GpuVfxMemberAnimation = {
  base: EXHAUST_ALPHA_START,
  amplitude: -EXHAUST_ALPHA_START,
  duration: 0, ease: 'Linear', loop: false, yoyo: false,
};
const EXHAUST_MEMBER: GpuVfxMember = {
  x: exhaustX, y: exhaustY, scaleX: exhaustScale, scaleY: exhaustScale, alpha: exhaustAlpha,
  tintBlend: 1,
  tintTopLeft: 0xffffff, tintTopRight: 0xffffff, tintBottomLeft: 0xffffff, tintBottomRight: 0xffffff,
};

interface RocketVisual {
  id: number;
  body: Phaser.GameObjects.Image;
  accent: Phaser.GameObjects.Image;
  glow: Phaser.GameObjects.Image;
  engine: Phaser.GameObjects.Image;
  /** Aktuelle Tail-Position; jeder Exhaust-Partikel startet hier und laeuft dann GPU-seitig. */
  exhaustX: number;
  exhaustY: number;
  exhaustFlow: ParticleFlowScheduler;
  exhaustTints: number[];
  bodyColor: number;
  accentColor: number;
  smokeColor: number;
  visualScale: number;
  lastSmokeX: number;
  lastSmokeY: number;
  lastSmokeAt: number;
}

// ── GPU-Smoke: Konstanten ───────────────────────────────────────────────────

/**
 * Entspricht dem bisherigen `maxAliveParticles: 640` des geteilten Smoke-Emitters. Phaser
 * verwarf ueber diesem Limit stillschweigend neue Partikel (`atLimit()`), der Pool verwirft
 * den Spawn ebenso. Ein Overrun ist hier also der nachgebildete Deckel und kein Hinweis auf
 * eine zu klein gewaehlte Kapazitaet.
 */
const SMOKE_POOL_CAPACITY = 640;

/** Konstante `lifespan: 1000` des bisherigen Emitters. */
const SMOKE_LIFE_MS = 1000;
const SMOKE_SPEED_X = 6;
const SMOKE_SPEED_Y_MIN = -10;
const SMOKE_SPEED_Y_MAX = -2;
const SMOKE_ALPHA_START = 0.95;
/** `onUpdate` skalierte mit `startScale * (1 + Quadratic.Out(t) * 1.3)`. */
const SMOKE_SCALE_GROWTH = 1.3;

/**
 * Alle Puffs teilen sich einen Owner: Beim Zerstoeren einer einzelnen Rakete liefen die
 * Schwaden des geteilten Emitters bisher aus, statt zu verschwinden. Nur der Teardown raeumt
 * sie ueber `releaseAll()` ab. Bewusst kein moeglicher Projektil-Id und nicht -1, das der Pool
 * intern als "Slot frei" fuehrt.
 */
const SMOKE_OWNER = -2;

/**
 * Wiederverwendete Spawn-Vorlage; die verschachtelten Animationsobjekte werden nur mutiert.
 *
 * Scale und Alpha laufen auf `Quad.easeOut` – Phasers `Quadratic.Out(v) = v * (2 - v)` ist
 * exakt der Term `a * time * (2.0 - time)` im Shader. Beide brauchen deshalb `gpuVfxEasedBase`,
 * weil nicht-lineare Eases mit `loop: false` sonst `floor(amplitude) * amplitude` aufaddieren.
 */
const smokeX: GpuVfxMemberAnimation = { base: 0, amplitude: 0, duration: SMOKE_LIFE_MS, ease: 'Linear', loop: false, yoyo: false };
const smokeY: GpuVfxMemberAnimation = { base: 0, amplitude: 0, duration: SMOKE_LIFE_MS, ease: 'Linear', loop: false, yoyo: false };
const smokeScale: GpuVfxMemberAnimation = {
  base: 0, amplitude: 0, duration: SMOKE_LIFE_MS, ease: 'Quad.easeOut', loop: false, yoyo: false,
};
const smokeAlpha: GpuVfxMemberAnimation = {
  base: gpuVfxEasedBase(SMOKE_ALPHA_START, -SMOKE_ALPHA_START),
  amplitude: -SMOKE_ALPHA_START,
  duration: SMOKE_LIFE_MS, ease: 'Quad.easeOut', loop: false, yoyo: false,
};
const SMOKE_MEMBER: GpuVfxMember = {
  x: smokeX, y: smokeY, scaleX: smokeScale, scaleY: smokeScale, alpha: smokeAlpha,
  tintBlend: 1,
  tintTopLeft: 0xffffff, tintTopRight: 0xffffff, tintBottomLeft: 0xffffff, tintBottomRight: 0xffffff,
};

export class RocketRenderer {
  private rockets = new Map<number, RocketVisual>();
  /** Parallel zur Map, damit der Emissions-Tick ohne Iterator-Allokation laufen kann. */
  private readonly activeRockets: RocketVisual[] = [];
  private exhaustFx: GpuVfxEmitter | null = null;
  private smokeFx: GpuVfxEmitter | null = null;
  private registry: GpuVfxRegistry | null = null;
  private quality: GraphicsQualityController | null = null;
  /**
   * Bruchteil-Uebertrag der qualitaetsskalierten Handemission, wie ihn der Quality-Controller
   * fuer `emitParticleAt()` fuehrt: pro Aufruf kommt `factor` dazu, emittiert wird der
   * ganzzahlige Anteil.
   */
  private smokeEmissionCarry = 0;

  constructor(private readonly scene: Phaser.Scene) {}

  /**
   * Legt den geteilten Exhaust-Layer an – einmalig, szenenlebenslang, niemals pro Rakete.
   * Direkt nach `generateTextures()` aufzurufen.
   */
  initGpuLayers(registry: GpuVfxRegistry): void {
    if (this.exhaustFx) return;
    this.registry = registry;
    this.quality = getGraphicsQualityController(this.scene);
    this.smokeFx = registry.createEmitter({
      name:     'rocket-smoke',
      texture:  TEX_ROCKET_SMOKE,
      capacity: SMOKE_POOL_CAPACITY,
      // Der Smoke-Emitter hatte keinen Blend-Mode im Config und zeichnete damit normal, nicht
      // additiv. Er entstand ausserdem schon beim Szenenaufbau, lag also bei gleicher Depth
      // ohnehin unter allem zur Laufzeit Erzeugten – hier braucht es keinen Epsilon-Versatz.
      blendMode: Phaser.BlendModes.NORMAL,
      depth:    DEPTH.FIRE,
      eases:    ['Linear', 'Quad.easeOut'],
    });
    this.exhaustFx = registry.createEmitter({
      name:     'rocket-exhaust',
      texture:  TEX_ROCKET_EXHAUST,
      capacity: EXHAUST_POOL_CAPACITY,
      // Der bisherige Emitter entstand pro Rakete und lag bei gleicher Depth ueber Body und
      // Engine; der Accent auf DEPTH.PROJECTILES + 1 blieb darueber. Der Versatz haelt genau
      // diese Reihenfolge.
      depth:    DEPTH.PROJECTILES + GPU_VFX_DEPTH_EPSILON,
      eases:    ['Linear'],
    });
    registry.registerEmission((deltaMs, nowMs) => this.emitExhaust(deltaMs, nowMs));
  }

  /**
   * Emissionsintervall wie bisher: der Quality-Controller streckt das Basisintervall ueber
   * `particleFactors.standard` (`applyEmitterProfile`), ein Faktor <= 0 stellt die Emission
   * ganz ab. Nur die Frequenz war beim Exhaust ueberhaupt wirksam – einen
   * `maxAliveParticles`-Deckel gab es nie, weil `lifespan` als `{min,max}` keine Schaetzung
   * liefert und der Config auch keinen expliziten Wert setzt.
   */
  private exhaustFrequencyMs(): number {
    const factor = this.quality?.getProfile().particleFactors.standard ?? 1;
    if (factor <= 0) return 0;
    return Math.max(1, Math.round(EXHAUST_BASE_FREQUENCY_MS / factor));
  }

  /** Emissions-Tick, von der Registry pro Renderframe nach dem Retire-Sweep gerufen. */
  private emitExhaust(deltaMs: number, nowMs: number): void {
    const fx = this.exhaustFx;
    if (!fx) return;
    const frequency = this.exhaustFrequencyMs();
    if (frequency <= 0) return;

    for (let index = 0; index < this.activeRockets.length; index += 1) {
      const rocket = this.activeRockets[index];
      // Setzt nur die ab jetzt gueltige Frequenz; der laufende Countdown bleibt stehen, ein
      // Qualitaetswechsel unterbricht den Fluss also nicht.
      rocket.exhaustFlow.setFrequency(frequency);
      const due = rocket.exhaustFlow.tick(deltaMs);
      for (let n = 0; n < due; n += 1) this.spawnExhaust(fx, rocket, nowMs);
    }
  }

  private spawnExhaust(fx: GpuVfxEmitter, rocket: RocketVisual, nowMs: number): void {
    const life = Phaser.Math.FloatBetween(EXHAUST_LIFE_MIN_MS, EXHAUST_LIFE_MAX_MS);
    const slot = fx.pool.acquire(rocket.id, nowMs, life);
    if (slot === GPU_VFX_NO_SLOT) return;

    const lifeS = life / 1000;
    exhaustX.base      = rocket.exhaustX;
    exhaustX.amplitude = Phaser.Math.FloatBetween(-EXHAUST_SPEED_SPREAD, EXHAUST_SPEED_SPREAD) * lifeS;
    exhaustX.duration  = life;
    exhaustY.base      = rocket.exhaustY;
    exhaustY.amplitude = Phaser.Math.FloatBetween(-EXHAUST_SPEED_SPREAD, EXHAUST_SPEED_SPREAD) * lifeS;
    exhaustY.duration  = life;
    exhaustScale.duration = life;
    exhaustAlpha.duration = life;
    setGpuVfxTint(EXHAUST_MEMBER, pickGpuVfxTint(rocket.exhaustTints));

    fx.layer.editMember(slot, EXHAUST_MEMBER);
  }

  generateTextures(): void {
    const tex = this.scene.textures;

    if (!tex.exists(TEX_ROCKET_BODY)) {
      const w = 28;
      const h = 12;
      const canvas = tex.createCanvas(TEX_ROCKET_BODY, w, h)!;
      const ctx = canvas.context;
      ctx.fillStyle = '#f0d08a';
      ctx.beginPath();
      ctx.moveTo(2, h * 0.2);
      ctx.lineTo(w - 8, h * 0.2);
      ctx.lineTo(w - 2, h / 2);
      ctx.lineTo(w - 8, h * 0.8);
      ctx.lineTo(2, h * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#8c4e2d';
      ctx.fillRect(0, 3, 4, h - 6);
      ctx.fillStyle = '#b63f1e';
      ctx.fillRect(6, 2, 4, h - 4);
      canvas.refresh();
    }

    if (!tex.exists(TEX_ROCKET_ACCENT)) {
      const w = 28;
      const h = 12;
      const canvas = tex.createCanvas(TEX_ROCKET_ACCENT, w, h)!;
      const ctx = canvas.context;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(8, 3, 10, 2);
      ctx.fillRect(8, 7, 6, 1);
      ctx.beginPath();
      ctx.moveTo(2, 2);
      ctx.lineTo(7, 4);
      ctx.lineTo(2, 5);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(2, h - 2);
      ctx.lineTo(7, h - 4);
      ctx.lineTo(2, h - 5);
      ctx.closePath();
      ctx.fill();
      canvas.refresh();
    }

    if (!tex.exists(TEX_ROCKET_SMOKE)) {
      const s = 24;
      const canvas = tex.createCanvas(TEX_ROCKET_SMOKE, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s / 2, s / 2, 1, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(190, 198, 202, 0.45)');
      grad.addColorStop(0.55, 'rgba(120, 136, 145, 0.22)');
      grad.addColorStop(1, 'rgba(70, 80, 88, 0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      canvas.refresh();
    }

    if (!tex.exists(TEX_ROCKET_EXHAUST)) {
      const s = 18;
      const canvas = tex.createCanvas(TEX_ROCKET_EXHAUST, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(255,255,255,1.0)');
      grad.addColorStop(0.25, 'rgba(255,224,132,0.95)');
      grad.addColorStop(0.6, 'rgba(255,129,48,0.4)');
      grad.addColorStop(1, 'rgba(255,90,0,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      canvas.refresh();
    }

    if (!tex.exists(TEX_ROCKET_GLOW)) {
      const s = 34;
      const canvas = tex.createCanvas(TEX_ROCKET_GLOW, s, s)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, 'rgba(255,214,122,0.5)');
      grad.addColorStop(0.5, 'rgba(255,140,60,0.18)');
      grad.addColorStop(1, 'rgba(255,90,0,0.0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      canvas.refresh();
    }

    if (!tex.exists(TEX_ROCKET_ENGINE)) {
      const w = 24;
      const h = 18;
      const canvas = tex.createCanvas(TEX_ROCKET_ENGINE, w, h)!;
      const ctx = canvas.context;
      const grad = ctx.createRadialGradient(7, h / 2, 0, 7, h / 2, 10);
      grad.addColorStop(0, 'rgba(255,255,255,1.0)');
      grad.addColorStop(0.28, 'rgba(255,255,255,0.95)');
      grad.addColorStop(0.55, 'rgba(255,255,255,0.55)');
      grad.addColorStop(1, 'rgba(255,255,255,0.0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(2, h / 2);
      ctx.lineTo(w - 1, 2);
      ctx.lineTo(w - 1, h - 2);
      ctx.closePath();
      ctx.fill();
      canvas.refresh();
    }

  }

  createVisual(
    id: number,
    x: number,
    y: number,
    size: number,
    color: number,
    accentColor: number,
    smokeColor: number,
    visualScale: number = 1,
  ): void {
    if (this.rockets.has(id)) return;

    const body = this.scene.add.image(x, y, TEX_ROCKET_BODY)
      .setDepth(DEPTH.PROJECTILES)
      .setTint(color);
    const accent = this.scene.add.image(x, y, TEX_ROCKET_ACCENT)
      .setDepth(DEPTH.PROJECTILES + 1)
      .setAlpha(0.95)
      .setTint(accentColor);
    const glow = this.scene.add.image(x, y, TEX_ROCKET_GLOW)
      .setDepth(DEPTH.PROJECTILES - 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.42)
      .setTint(accentColor);
    const engine = this.scene.add.image(x, y, TEX_ROCKET_ENGINE)
      .setDepth(DEPTH.PROJECTILES)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.9)
      .setTint(accentColor)
      .setOrigin(0.2, 0.5);

    const visual: RocketVisual = {
      id,
      body,
      accent,
      glow,
      engine,
      exhaustX: x,
      exhaustY: y,
      // Startet auf dem aktuell gueltigen Intervall, wie Phasers Flow-Zaehler nach dem
      // `setFrequency()` des Quality-Controllers beim Erzeugen des Emitters.
      exhaustFlow: new ParticleFlowScheduler(Math.max(1, this.exhaustFrequencyMs())),
      exhaustTints: [0xffffff, accentColor, accentColor],
      bodyColor: color,
      accentColor,
      smokeColor,
      visualScale,
      lastSmokeX: x,
      lastSmokeY: y,
      lastSmokeAt: this.scene.time.now,
    };
    this.rockets.set(id, visual);
    this.activeRockets.push(visual);
    this.updateVisual(id, x, y, size, 1, 0);
  }

  /**
   * Ausloeser und Startposition bleiben unveraendert; nur die Simulation wandert auf die GPU.
   *
   * Die Qualitaetsskalierung bildet den Wrapper nach, den der Quality-Controller um
   * `emitParticleAt()` legt: pro Aufruf waechst der Uebertrag um `particleFactors.standard`,
   * emittiert wird sein ganzzahliger Anteil. Ein Faktor von 0 unterbindet die Emission ganz.
   */
  private spawnSmokePuff(x: number, y: number, visualSize: number, smokeColor: number): void {
    const fx = this.smokeFx;
    if (!fx) return;

    const factor = this.quality?.getProfile().particleFactors.standard ?? 1;
    this.smokeEmissionCarry += Math.max(0, factor);
    const count = Math.floor(this.smokeEmissionCarry);
    if (count <= 0) return;
    this.smokeEmissionCarry -= count;

    // Der Puff entsteht ausserhalb des Emissions-Ticks, die Uhr steht also noch auf dem Stand
    // des Vorframes. Der Retire-Sweep greift dadurch hoechstens einen Frame zu frueh – dort ist
    // die Alpha der Quad-Kurve bereits praktisch null.
    const nowMs = this.registry?.now() ?? 0;
    const startScale = Math.max(visualSize / 28, 0.28);

    for (let n = 0; n < count; n += 1) {
      const slot = fx.pool.acquire(SMOKE_OWNER, nowMs, SMOKE_LIFE_MS);
      if (slot === GPU_VFX_NO_SLOT) return;

      smokeX.base      = x;
      smokeX.amplitude = Phaser.Math.FloatBetween(-SMOKE_SPEED_X, SMOKE_SPEED_X);
      smokeY.base      = y;
      smokeY.amplitude = Phaser.Math.FloatBetween(SMOKE_SPEED_Y_MIN, SMOKE_SPEED_Y_MAX);
      // `lifespan` ist konstant 1000 ms, die Amplitude ist damit direkt die Geschwindigkeit.
      const growth = startScale * SMOKE_SCALE_GROWTH;
      smokeScale.base      = gpuVfxEasedBase(startScale, growth);
      smokeScale.amplitude = growth;
      setGpuVfxTint(SMOKE_MEMBER, smokeColor);

      fx.layer.editMember(slot, SMOKE_MEMBER);
    }
  }

  updateVisual(
    id: number,
    x: number,
    y: number,
    size: number,
    vx: number,
    vy: number,
    miniRocketPhase?: MiniRocketFlightPhase,
    miniRocketCascadeStage = 0,
  ): void {
    const visual = this.rockets.get(id);
    if (!visual) return;

    const angle = Math.atan2(vy, vx);
    const speed = Math.max(1, Math.sqrt(vx * vx + vy * vy));
    const nx = vx / speed;
    const ny = vy / speed;
    const visualSize = size * visual.visualScale;
    const bodyScale = Math.max(size / 10, 0.8) * visual.visualScale;
    const glowScale = Math.max(size / 12, 0.8) * visual.visualScale;
    const engineScaleX = Math.max(size / 12, 0.7) * visual.visualScale;
    const engineScaleY = Math.max(size / 13, 0.6) * visual.visualScale;
    const tailX = x - nx * (visualSize * 0.9);
    const tailY = y - ny * (visualSize * 0.9);
    const pulse = 0.5 + Math.sin(this.scene.time.now * 0.012) * 0.5;
    const phaseColor = miniRocketPhase === 'return'
      ? 0x68ffe1
      : miniRocketPhase === 'coast'
        ? 0xffd36b
        : visual.accentColor;

    visual.body.setPosition(x, y);
    visual.body.setRotation(angle);
    visual.body.setScale(bodyScale, bodyScale);
    visual.body.setTint(visual.bodyColor);

    visual.accent.setPosition(x, y);
    visual.accent.setRotation(angle);
    visual.accent.setScale(bodyScale, bodyScale);
    visual.accent.setTint(phaseColor);
    visual.accent.setAlpha(miniRocketPhase === 'return' ? 0.8 + pulse * 0.2 : 0.95);

    visual.glow.setPosition(x, y);
    visual.glow.setRotation(angle);
    visual.glow.setScale(glowScale * (1 + Math.max(0, miniRocketCascadeStage) * 0.12));
    visual.glow.setTint(phaseColor);
    visual.glow.setAlpha(miniRocketPhase === 'return'
      ? 0.58 + pulse * 0.2
      : miniRocketPhase === 'coast'
        ? 0.5 + pulse * 0.14
      : Math.min(0.68, 0.42 + Math.max(0, miniRocketCascadeStage) * 0.1));

    const engineOffset = visualSize * 0.9;
    visual.engine.setPosition(x - nx * engineOffset, y - ny * engineOffset);
    visual.engine.setRotation(angle + Math.PI);
    visual.engine.setScale(engineScaleX, engineScaleY);
    visual.engine.setTint(phaseColor);
    visual.engine.setAlpha(0.72 + Math.min(speed / 1200, 0.22) + (miniRocketPhase === 'coast' ? pulse * 0.06 : 0));

    const distSinceSmoke = Phaser.Math.Distance.Between(visual.lastSmokeX, visual.lastSmokeY, tailX, tailY);
    const now = this.scene.time.now;
    if (distSinceSmoke >= Math.max(visualSize * 0.55, 5) || now - visual.lastSmokeAt >= 22) {
      const resolvedSmokeColor = miniRocketPhase === 'return'
        ? visual.accentColor
        : visual.smokeColor;
      this.spawnSmokePuff(tailX, tailY, visualSize, resolvedSmokeColor);
      visual.lastSmokeX = tailX;
      visual.lastSmokeY = tailY;
      visual.lastSmokeAt = now;
    }

    // Nur die Spawn-Position nachfuehren. Bereits gespawnte Partikel laufen vollstaendig auf
    // der GPU weiter und bekommen kein Update pro Frame.
    visual.exhaustX = tailX;
    visual.exhaustY = tailY;
  }

  playCollection(x: number, y: number, color: number): void {
    const ring = this.scene.add.circle(x, y, 8, color, 0.08)
      .setDepth(DEPTH.PROJECTILES + 1)
      .setStrokeStyle(2, color, 0.95)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: ring,
      radius: 38,
      alpha: 0,
      duration: 420,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });

    const burst = this.scene.add.particles(x, y, TEX_ROCKET_EXHAUST, {
      lifespan: { min: 260, max: 480 },
      speed: { min: 35, max: 105 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.42, end: 0.02 },
      alpha: { start: 0.95, end: 0 },
      tint: [0xffffff, color, 0x68ffe1],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }).setDepth(DEPTH.PROJECTILES + 1);
    // Partikelkoordinaten sind emitterlokal: Der Emitter steht bereits auf (x, y),
    // ein zusaetzliches explode(count, x, y) wuerde die Weltposition verdoppeln.
    burst.explode(18);
    this.scene.time.delayedCall(520, () => burst.destroy());
  }

  playSpentDestruction(x: number, y: number, color: number): void {
    const flash = this.scene.add.circle(x, y, 3, color, 0.7)
      .setDepth(DEPTH.PROJECTILES + 1)
      .setStrokeStyle(1.5, 0xffffff, 0.85)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: flash,
      radius: 14,
      alpha: 0,
      duration: 180,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });

    const sparks = this.scene.add.particles(x, y, TEX_ROCKET_EXHAUST, {
      lifespan: { min: 140, max: 280 },
      speed: { min: 18, max: 60 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.22, end: 0.02 },
      alpha: { start: 0.8, end: 0 },
      tint: [0xffffff, color, 0x8b949b],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }).setDepth(DEPTH.PROJECTILES + 1);
    sparks.explode(8);
    this.spawnSmokePuff(x, y, 6, color);
    this.scene.time.delayedCall(320, () => sparks.destroy());
  }

  destroyVisual(id: number): void {
    const visual = this.rockets.get(id);
    if (!visual) return;
    visual.body.destroy();
    visual.accent.destroy();
    visual.glow.destroy();
    visual.engine.destroy();
    // Noch sichtbare Exhaust-Member sofort ausblenden – wie bisher `emitter.destroy()`.
    this.exhaustFx?.pool.releaseOwner(id);
    const index = this.activeRockets.indexOf(visual);
    if (index >= 0) this.activeRockets.splice(index, 1);
    this.rockets.delete(id);
  }

  has(id: number): boolean {
    return this.rockets.has(id);
  }

  getActiveIds(): number[] {
    return [...this.rockets.keys()];
  }

  destroyAll(): void {
    for (const id of this.getActiveIds()) {
      this.destroyVisual(id);
    }
    // Einzelne Raketen lassen ihre Schwaden auslaufen; erst der Teardown raeumt sie ab.
    this.smokeFx?.pool.releaseAll();
    this.smokeEmissionCarry = 0;
  }
}
