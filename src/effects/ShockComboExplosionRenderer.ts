import * as Phaser from 'phaser';
import { DEPTH, DEPTH_FX } from '../config';
import { scaleParticleCount } from '../graphics/GraphicsQuality';
import { emissiveAlpha } from './EmissiveScale';
import { ensureCanvasTexture, mixColors } from './EffectUtils';

const TEX_SPHERE = '__shock_combo_sphere';
const TEX_CRACKLE_A = '__shock_combo_crackle_a';
const TEX_CRACKLE_B = '__shock_combo_crackle_b';
const TEX_RING = '__shock_combo_ring';
const TEX_FLARE = '__shock_combo_flare';
const TEX_GLOW = '__shock_combo_glow';

const SPHERE_SIZE = 256;
/** Radius der hellen Hülle in der Kugeltextur. */
const SPHERE_R = 121;
const CRACKLE_SIZE = 256;
const CRACKLE_R = 118;
const RING_SIZE = 256;
const RING_R = 124;
const FLARE_SIZE = 256;
const GLOW_SIZE = 128;

/** Die Kugel endet knapp vor dem Schadensradius; der Druckring markiert ihn exakt. */
const SPHERE_PEAK_FACTOR = 0.9;
const SPHERE_EXPAND_MS = 150;
const SPHERE_FADE_DELAY_MS = 140;
const SPHERE_FADE_MS = 260;
const ARC_TICK_MS = 36;
const ARC_TICKS = 8;
/** Taktung des Blitzgeflechts in der Kugel: schnell genug für Flackern, nicht für Rauschen. */
const CRACKLE_TICK_MS = 40;

const ASMD_FALLBACK_COLOR = 0xa04dff;

interface ShockComboPalette {
  readonly core: number;
  readonly rim: number;
  readonly body: number;
  readonly deep: number;
}

/**
 * Combo-Detonation des ASMD nach dem Vorbild der Shock-Rifle-Combo: keine Verbrennung, sondern
 * eine schlagartig aufblähende Energiekugel mit gleißender Hülle, einem flackernden
 * Blitzgeflecht im Inneren, verästelten Entladungsbögen und einem Lens-Flare. Am Ende kollabiert der Kern und zündet einen
 * letzten Lichtpunkt. Farbe folgt dem Detonierenden; der Kern bleibt weißglühend.
 *
 * Rein lokale Darstellung; alle Objekte sind kurzlebig und werden in `clear()` geräumt.
 */
export class ShockComboExplosionRenderer {
  private readonly active = new Set<Phaser.GameObjects.GameObject>();
  private readonly timers = new Set<Phaser.Time.TimerEvent>();
  private texturesReady = false;

  constructor(private readonly scene: Phaser.Scene) {}

  play(x: number, y: number, radius: number, color: number | undefined): void {
    if (radius <= 0) return;
    this.ensureTextures();
    const palette = resolvePalette(color ?? ASMD_FALLBACK_COLOR);

    this.spawnAfterglow(x, y, radius, palette);
    this.spawnSphere(x, y, radius, palette);
    this.spawnEnergyPulses(x, y, radius, palette);
    this.spawnShockRings(x, y, radius, palette);
    this.spawnCore(x, y, radius, palette);
    this.spawnFlare(x, y, radius, palette);
    this.spawnArcs(x, y, radius, palette);
    this.spawnCollapse(x, y, radius, palette);
    this.spawnIonizedGround(x, y, radius, palette);
  }

  /** World-Wechsel und Scene-Ende: keine Restentladungen in Lobby oder nächster Runde. */
  clear(): void {
    for (const timer of this.timers) timer.remove(false);
    this.timers.clear();
    for (const object of [...this.active]) {
      this.scene.tweens.killTweensOf(object);
      object.destroy();
    }
    this.active.clear();
  }

  getActiveObjectCount(): number {
    return this.active.size;
  }

  // ── Phasen ────────────────────────────────────────────────────────────────

  /** Farbiges Nachleuchten über dem Wirkungsbereich; hält die Entladung auch nachts lesbar. */
  private spawnAfterglow(x: number, y: number, radius: number, palette: ShockComboPalette): void {
    const glow = this.image(x, y, TEX_GLOW, DEPTH_FX - 0.12, true, 0, palette.body);
    glow.setScale(radius * 1.3 / (GLOW_SIZE / 2));
    this.tween(glow, { alpha: emissiveAlpha(0.42), duration: 50, ease: 'Quad.easeOut' });
    this.tween(glow, { alpha: 0, delay: 140, duration: 380, ease: 'Sine.easeIn' }, true);
  }

  /**
   * Die Energiekugel: abgedunkelte Unterlage für Wertkontrast auf hellem Boden, gleißende
   * Fresnel-Hülle und im Inneren ein Geflecht aus Entladungsblitzen. Schlagartige Expansion,
   * danach ein leichtes Ausdehnen, während die Kugel zerfällt. Die Blitze drehen sich nicht,
   * sondern springen stroboskopartig zwischen Mustern – Spannung statt Strömung.
   */
  private spawnSphere(x: number, y: number, radius: number, palette: ShockComboPalette): void {
    const peak = radius * SPHERE_PEAK_FACTOR;
    const lifeMs = SPHERE_FADE_DELAY_MS + SPHERE_FADE_MS;
    const grow = (image: Phaser.GameObjects.Image, size: number): void => {
      image.setScale(peak * 0.16 / size);
      this.tween(image, { scale: peak / size, duration: SPHERE_EXPAND_MS, ease: 'Expo.easeOut' });
      this.tween(image, { scale: peak * 1.08 / size, delay: SPHERE_EXPAND_MS, duration: lifeMs - SPHERE_EXPAND_MS, ease: 'Sine.easeOut' });
    };

    for (const layer of [
      { depth: DEPTH_FX + 0.3, additive: false, alpha: 0.32, tint: palette.deep },
      { depth: DEPTH_FX + 0.34, additive: true, alpha: 1, tint: palette.rim },
    ]) {
      const image = this.image(x, y, TEX_SPHERE, layer.depth, layer.additive, layer.alpha, layer.tint);
      grow(image, SPHERE_R);
      this.tween(image, { alpha: 0, delay: SPHERE_FADE_DELAY_MS, duration: SPHERE_FADE_MS, ease: 'Quad.easeIn' }, true);
    }

    // Blitzgeflecht: farbiger Schein und weißglühende Kanäle, pro Takt neu gewürfelt.
    const crackles = [
      { image: this.image(x, y, TEX_CRACKLE_A, DEPTH_FX + 0.32, true, 0, palette.body), peak: 0.95 },
      { image: this.image(x, y, TEX_CRACKLE_B, DEPTH_FX + 0.33, true, 0, palette.core), peak: 0.8 },
    ];
    for (const { image } of crackles) grow(image, CRACKLE_R);
    const startedAt = this.scene.time.now;
    const flicker = (): void => {
      const t = Phaser.Math.Clamp((this.scene.time.now - startedAt) / lifeMs, 0, 1);
      const envelope = t < 0.35 ? 1 : 1 - (t - 0.35) / 0.65;
      for (const { image, peak: crackPeak } of crackles) {
        if (!image.active) continue;
        image
          .setTexture(Math.random() < 0.5 ? TEX_CRACKLE_A : TEX_CRACKLE_B)
          .setRotation(Phaser.Math.FloatBetween(0, Math.PI * 2))
          .setFlipX(Math.random() < 0.5)
          .setAlpha(emissiveAlpha(crackPeak * envelope * Phaser.Math.FloatBetween(0.55, 1)));
      }
    };
    flicker();
    this.repeat(CRACKLE_TICK_MS, Math.ceil(lifeMs / CRACKLE_TICK_MS), flicker, () => {
      for (const { image } of crackles) image.destroy();
    });

    // Die Hülle pulsiert einmal hell auf, kurz bevor die Kugel zerfällt.
    const rimPulse = this.image(x, y, TEX_RING, DEPTH_FX + 0.35, true, 0, palette.core);
    rimPulse.setScale(peak / RING_R);
    this.tween(rimPulse, { alpha: emissiveAlpha(0.9), delay: SPHERE_EXPAND_MS - 40, duration: 40 });
    this.tween(rimPulse, {
      alpha: 0,
      scale: peak * 1.1 / RING_R,
      delay: SPHERE_EXPAND_MS,
      duration: 170,
      ease: 'Quad.easeOut',
    }, true);
  }

  /**
   * Energiewellen im Kugelinneren: im Takt der GPU-Ausstoßwellen laufen helle Ringe vom Kern
   * zur Hülle und machen den Fluss von innen nach außen lesbar.
   */
  private spawnEnergyPulses(x: number, y: number, radius: number, palette: ShockComboPalette): void {
    const peak = radius * SPHERE_PEAK_FACTOR;
    for (let wave = 0; wave < 3; wave += 1) {
      const delay = wave * 55;
      const pulse = this.image(x, y, TEX_RING, DEPTH_FX + 0.36, true, 0, wave === 0 ? palette.core : palette.rim);
      pulse.setScale(peak * 0.06 / RING_R);
      this.tween(pulse, { alpha: emissiveAlpha(0.85 - wave * 0.2), delay, duration: 30 });
      this.tween(pulse, { scale: peak * 0.97 / RING_R, delay, duration: 190, ease: 'Quad.easeOut' });
      this.tween(pulse, { alpha: 0, delay: delay + 90, duration: 110, ease: 'Quad.easeIn' }, true);
    }
  }

  /** Druckfront exakt bis zum Schadensradius, gefolgt von einem farbigen Nachläufer. */
  private spawnShockRings(x: number, y: number, radius: number, palette: ShockComboPalette): void {
    const front = this.image(x, y, TEX_RING, DEPTH_FX + 0.4, true, 1, palette.core);
    front.setScale(radius * 0.22 / RING_R);
    this.tween(front, { scale: radius / RING_R, duration: 190, ease: 'Cubic.easeOut' });
    this.tween(front, { alpha: 0, delay: 90, duration: 150, ease: 'Quad.easeIn' }, true);

    const trail = this.image(x, y, TEX_RING, DEPTH_FX + 0.39, true, 0, palette.rim);
    trail.setScale(radius * 0.18 / RING_R);
    this.tween(trail, { alpha: emissiveAlpha(0.8), delay: 40, duration: 40 });
    this.tween(trail, { scale: radius * 1.06 / RING_R, delay: 40, duration: 280, ease: 'Quart.easeOut' });
    this.tween(trail, { alpha: 0, delay: 150, duration: 190, ease: 'Quad.easeIn' }, true);
  }

  /** Weißglühender Kern: Blendblitz zum Zünden, danach ein stehender Plasmakern. */
  private spawnCore(x: number, y: number, radius: number, palette: ShockComboPalette): void {
    const glowRadius = GLOW_SIZE / 2;
    const flash = this.image(x, y, TEX_GLOW, DEPTH_FX + 0.9, true, 1, 0xffffff);
    flash.setScale(radius * 0.14 / glowRadius);
    this.tween(flash, { scale: radius * 0.8 / glowRadius, alpha: 0, duration: 150, ease: 'Expo.easeOut' }, true);

    const core = this.image(x, y, TEX_GLOW, DEPTH_FX + 0.6, true, 0.95, palette.core);
    core.setScale(radius * 0.2 / glowRadius);
    this.tween(core, { scale: radius * 0.46 / glowRadius, duration: 110, ease: 'Cubic.easeOut' });
    // Der Kern hält, während die Kugel steht, und wird in die Kollapsphase hineingezogen.
    this.tween(core, { scale: radius * 0.04 / glowRadius, delay: 200, duration: 170, ease: 'Cubic.easeIn' }, true);
  }

  /** Anamorphotischer Lens-Flare: langer horizontaler Streifen und kurzes Sternkreuz. */
  private spawnFlare(x: number, y: number, radius: number, palette: ShockComboPalette): void {
    const base = radius * 2.1 / FLARE_SIZE;
    const flare = this.image(x, y, TEX_FLARE, DEPTH_FX + 0.85, true, 1, palette.core);
    flare.setRotation(Phaser.Math.FloatBetween(-0.15, 0.15)).setScale(base * 0.45);
    this.tween(flare, { scale: base, duration: 80, ease: 'Cubic.easeOut' });
    this.tween(flare, { alpha: 0, scaleY: base * 0.3, delay: 80, duration: 180, ease: 'Quad.easeIn' }, true);
  }

  /**
   * Entladungsbögen: verästelte Blitze vom Kern zur Kugelhülle und kurze Koronaentladungen,
   * die radial aus der Hülle schlagen. Jeder Takt würfelt die Bahnen neu, damit die Kugel
   * sichtbar unter Spannung steht; alle Bahnen verlaufen radial, nichts kreist.
   */
  private spawnArcs(x: number, y: number, radius: number, palette: ShockComboPalette): void {
    const arcs = this.scene.add.graphics().setDepth(DEPTH_FX + 0.5).setBlendMode(Phaser.BlendModes.ADD);
    this.track(arcs);
    const radialCount = scaleParticleCount(this.scene, Phaser.Math.Clamp(Math.round(radius / 13), 6, 14));
    const coronaCount = scaleParticleCount(this.scene, Phaser.Math.Clamp(Math.round(radius / 16), 4, 10), 'decorative');
    let tick = 0;

    const draw = (): void => {
      if (!arcs.active) return;
      arcs.clear();
      const progress = tick / ARC_TICKS;
      const sphereRadius = radius * SPHERE_PEAK_FACTOR * Math.min(1, 0.2 + progress * 3.2);
      const strength = emissiveAlpha(1 - progress * progress);
      for (let index = 0; index < radialCount; index += 1) {
        const angle = (index / radialCount) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.3, 0.3);
        const reach = sphereRadius * Phaser.Math.FloatBetween(0.8, 1);
        const points = jaggedLine(x, y, x + Math.cos(angle) * reach, y + Math.sin(angle) * reach, reach * 0.16, 7);
        strokeBolt(arcs, points, palette, strength, index % 3 === 0 ? 1.4 : 1);
        // Verästelung: ein kurzer Seitenast zweigt im äußeren Drittel ab.
        if (index % 2 === 0) {
          const fork = points[Phaser.Math.Between(3, 5)]!;
          const forkAngle = angle + Phaser.Math.FloatBetween(0.35, 0.8) * (Math.random() < 0.5 ? -1 : 1);
          const forkReach = sphereRadius * Phaser.Math.FloatBetween(0.18, 0.32);
          strokeBolt(arcs, jaggedLine(
            fork.x, fork.y,
            fork.x + Math.cos(forkAngle) * forkReach, fork.y + Math.sin(forkAngle) * forkReach,
            forkReach * 0.25, 3,
          ), palette, strength * 0.75, 0.65);
        }
      }
      for (let index = 0; index < coronaCount; index += 1) {
        const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
        const inner = sphereRadius * 0.96;
        const outer = sphereRadius * Phaser.Math.FloatBetween(1.08, 1.26);
        strokeBolt(arcs, jaggedLine(
          x + Math.cos(angle) * inner, y + Math.sin(angle) * inner,
          x + Math.cos(angle) * outer, y + Math.sin(angle) * outer,
          (outer - inner) * 0.35, 3,
        ), palette, strength * 0.85, 0.75);
      }
      tick += 1;
    };

    draw();
    this.repeat(ARC_TICK_MS, ARC_TICKS - 1, draw, () => arcs.destroy());
  }

  /**
   * Ruft `step` `count`-mal im Takt `intervalMs` auf und danach einmal `finish`. Der Timer wird
   * in `clear()` mit abgeräumt; die zugehörigen Objekte entfernt dort ohnehin `active`.
   */
  private repeat(intervalMs: number, count: number, step: () => void, finish: () => void): void {
    let calls = 0;
    const timer = this.scene.time.addEvent({
      delay: intervalMs,
      repeat: count,
      callback: () => {
        if (calls >= count) {
          this.timers.delete(timer);
          finish();
          return;
        }
        calls += 1;
        step();
      },
    });
    this.timers.add(timer);
  }

  /** Kollaps: ein Ring zieht sich ins Zentrum zusammen und zündet einen letzten Lichtpunkt. */
  private spawnCollapse(x: number, y: number, radius: number, palette: ShockComboPalette): void {
    const startDelay = SPHERE_FADE_DELAY_MS + 80;
    const implode = this.image(x, y, TEX_RING, DEPTH_FX + 0.45, true, 0, palette.rim);
    implode.setScale(radius * 0.62 / RING_R);
    this.tween(implode, { alpha: emissiveAlpha(0.85), delay: startDelay, duration: 50 });
    this.tween(implode, { scale: radius * 0.03 / RING_R, delay: startDelay, duration: 150, ease: 'Cubic.easeIn' }, true);

    const glowRadius = GLOW_SIZE / 2;
    const pop = this.image(x, y, TEX_GLOW, DEPTH_FX + 0.7, true, 0, 0xffffff);
    pop.setScale(radius * 0.04 / glowRadius);
    this.tween(pop, { alpha: emissiveAlpha(1), delay: startDelay + 140, duration: 20 });
    this.tween(pop, {
      scale: radius * 0.34 / glowRadius,
      alpha: 0,
      delay: startDelay + 160,
      duration: 150,
      ease: 'Expo.easeOut',
    }, true);
  }

  /** Ionisierter Boden: ein kurz nachglimmender Ring markiert den Wirkungsbereich. */
  private spawnIonizedGround(x: number, y: number, radius: number, palette: ShockComboPalette): void {
    const imprint = this.image(x, y, TEX_RING, DEPTH.DECALS + 0.05, false, 0, palette.deep);
    imprint.setScale(radius * 0.92 / RING_R);
    this.tween(imprint, { alpha: 0.32, delay: 80, duration: 110, ease: 'Quad.easeOut' });
    this.tween(imprint, { alpha: 0, delay: 260, duration: 380, ease: 'Sine.easeIn' }, true);
  }

  // ── Objekt- und Tween-Verwaltung ─────────────────────────────────────────

  private image(
    x: number,
    y: number,
    texture: string,
    depth: number,
    additive: boolean,
    alpha: number,
    tint: number,
  ): Phaser.GameObjects.Image {
    const image = this.scene.add.image(x, y, texture)
      .setDepth(depth)
      .setTint(tint)
      .setAlpha(additive ? emissiveAlpha(alpha) : alpha);
    if (additive) image.setBlendMode(Phaser.BlendModes.ADD);
    this.track(image);
    return image;
  }

  private track(object: Phaser.GameObjects.GameObject): void {
    this.active.add(object);
    object.once(Phaser.GameObjects.Events.DESTROY, () => {
      // Parallele Tweens (Drehung, Ausdehnung) dürfen das zerstörte Objekt nicht weiter treiben.
      this.scene.tweens.killTweensOf(object);
      this.active.delete(object);
    });
  }

  /** `finishing` markiert den letzten Tween eines Objekts; er zerstört es am Ende. */
  private tween(
    target: Phaser.GameObjects.Image,
    config: Omit<Phaser.Types.Tweens.TweenBuilderConfig, 'targets'>,
    finishing = false,
  ): void {
    this.scene.tweens.add({
      ...config,
      targets: target,
      ...(finishing ? { onComplete: () => target.destroy() } : {}),
    });
  }

  // ── Texturen ─────────────────────────────────────────────────────────────

  private ensureTextures(): void {
    if (this.texturesReady) return;
    const textures = this.scene.textures;
    ensureCanvasTexture(textures, TEX_SPHERE, SPHERE_SIZE, SPHERE_SIZE, drawSphere);
    ensureCanvasTexture(textures, TEX_CRACKLE_A, CRACKLE_SIZE, CRACKLE_SIZE, (ctx) => drawCrackle(ctx, 0x5a3d));
    ensureCanvasTexture(textures, TEX_CRACKLE_B, CRACKLE_SIZE, CRACKLE_SIZE, (ctx) => drawCrackle(ctx, 0x91c7));
    ensureCanvasTexture(textures, TEX_RING, RING_SIZE, RING_SIZE, drawRing);
    ensureCanvasTexture(textures, TEX_FLARE, FLARE_SIZE, FLARE_SIZE, drawFlare);
    ensureCanvasTexture(textures, TEX_GLOW, GLOW_SIZE, GLOW_SIZE, drawGlow);
    this.texturesReady = true;
  }
}

function resolvePalette(color: number): ShockComboPalette {
  return {
    core: mixColors(color, 0xffffff, 0.82),
    rim: mixColors(color, 0xffffff, 0.4),
    body: color,
    deep: mixColors(color, 0x0c0418, 0.62),
  };
}

/** Blitzbahn mit seitlichem Versatz, der zu den Enden hin abnimmt. */
function jaggedLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  amplitude: number,
  segments: number,
): Phaser.Math.Vector2[] {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const points = [new Phaser.Math.Vector2(x0, y0)];
  for (let index = 1; index < segments; index += 1) {
    const t = index / segments;
    const offset = Phaser.Math.FloatBetween(-amplitude, amplitude) * Math.sin(t * Math.PI);
    points.push(new Phaser.Math.Vector2(x0 + dx * t + nx * offset, y0 + dy * t + ny * offset));
  }
  points.push(new Phaser.Math.Vector2(x1, y1));
  return points;
}

/** Zwei Durchgänge: breiter farbiger Schein, darüber ein dünner weißglühender Kanal. */
function strokeBolt(
  graphics: Phaser.GameObjects.Graphics,
  points: readonly Phaser.Math.Vector2[],
  palette: ShockComboPalette,
  alpha: number,
  width: number,
): void {
  if (alpha <= 0 || points.length < 2) return;
  for (const [lineWidth, color, lineAlpha] of [
    [5 * width, palette.body, 0.35 * alpha],
    [1.6 * width, palette.core, 0.95 * alpha],
  ] as const) {
    graphics.lineStyle(lineWidth, color, lineAlpha);
    graphics.beginPath();
    graphics.moveTo(points[0]!.x, points[0]!.y);
    for (let index = 1; index < points.length; index += 1) graphics.lineTo(points[index]!.x, points[index]!.y);
    graphics.strokePath();
  }
}

// ── Texturzeichnung (weiß; Farbe kommt über den Tint) ──────────────────────

/** Deterministischer Zufall, damit das Blitzgeflecht bei jedem Start gleich aussieht. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fresnel-Kugel: fast transparentes Inneres, das zur Hülle hin stark aufleuchtet. */
function drawSphere(ctx: CanvasRenderingContext2D): void {
  const c = SPHERE_SIZE / 2;
  const edge = SPHERE_R / c;
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  gradient.addColorStop(0, 'rgba(255,255,255,0.1)');
  gradient.addColorStop(edge * 0.55, 'rgba(255,255,255,0.14)');
  gradient.addColorStop(edge * 0.8, 'rgba(255,255,255,0.3)');
  gradient.addColorStop(edge * 0.93, 'rgba(255,255,255,0.72)');
  gradient.addColorStop(edge, 'rgba(255,255,255,1)');
  gradient.addColorStop(Math.min(1, edge + 0.03), 'rgba(255,255,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SPHERE_SIZE, SPHERE_SIZE);
}

/**
 * Blitzgeflecht in der Kugel: gezackte, verästelte Entladungskanäle, die radial vom Kern zur
 * Hülle schlagen. Zwei Varianten mit unterschiedlichem Seed wechseln sich zur Laufzeit ab.
 */
function drawCrackle(ctx: CanvasRenderingContext2D, seed: number): void {
  const c = CRACKLE_SIZE / 2;
  const random = seededRandom(seed);
  const jitter = (amount: number): number => (random() * 2 - 1) * amount;
  const bolt = (x0: number, y0: number, angle: number, length: number, segments: number, width: number, alpha: number, depth: number): void => {
    let px = x0;
    let py = y0;
    const step = length / segments;
    const path: [number, number][] = [[px, py]];
    for (let index = 0; index < segments; index += 1) {
      const heading = angle + jitter(0.55);
      px += Math.cos(heading) * step;
      py += Math.sin(heading) * step;
      path.push([px, py]);
    }
    ctx.lineWidth = width;
    ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(path[0]![0], path[0]![1]);
    for (const [x, y] of path.slice(1)) ctx.lineTo(x, y);
    ctx.stroke();
    if (depth <= 0) return;
    for (let index = 2; index < path.length - 1; index += 1) {
      if (random() > 0.45) continue;
      const [bx, by] = path[index]!;
      const remaining = length * (1 - index / segments);
      bolt(bx, by, angle + jitter(0.9), remaining * (0.35 + random() * 0.35), Math.max(2, Math.round(segments * 0.5)),
        width * 0.55, alpha * 0.75, depth - 1);
    }
  };

  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, CRACKLE_R, 0, Math.PI * 2);
  ctx.clip();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(255,255,255,0.95)';
  ctx.shadowBlur = 5;
  const bolts = 11;
  for (let index = 0; index < bolts; index += 1) {
    const angle = (index / bolts) * Math.PI * 2 + jitter(0.25);
    const start = CRACKLE_R * (0.04 + random() * 0.1);
    const length = CRACKLE_R * (0.78 + random() * 0.22) - start;
    bolt(c + Math.cos(angle) * start, c + Math.sin(angle) * start, angle, length, 8, 2.4 + random() * 1.2, 0.75 + random() * 0.25, 2);
  }
  ctx.restore();
}

/** Scharfer, dünner Druckring mit weichem Saum. */
function drawRing(ctx: CanvasRenderingContext2D): void {
  const c = RING_SIZE / 2;
  const edge = RING_R / c;
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(edge - 0.1, 'rgba(255,255,255,0)');
  gradient.addColorStop(edge - 0.035, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(edge, 'rgba(255,255,255,1)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, RING_SIZE, RING_SIZE);
}

/** Lens-Flare: langer horizontaler Streifen, kürzerer vertikaler und vier feine Diagonalen. */
function drawFlare(ctx: CanvasRenderingContext2D): void {
  const c = FLARE_SIZE / 2;
  const ray = (angle: number, length: number, halfWidth: number, alpha: number): void => {
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(angle);
    const gradient = ctx.createLinearGradient(0, 0, length, 0);
    gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
    gradient.addColorStop(0.4, `rgba(255,255,255,${alpha * 0.45})`);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(0, -halfWidth);
    ctx.lineTo(length, 0);
    ctx.lineTo(0, halfWidth);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  ray(0, c, 4, 1);
  ray(Math.PI, c, 4, 1);
  ray(Math.PI / 2, c * 0.55, 3, 0.85);
  ray(-Math.PI / 2, c * 0.55, 3, 0.85);
  for (const angle of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    ray(angle, c * 0.3, 1.6, 0.6);
  }
  const core = ctx.createRadialGradient(c, c, 0, c, c, c * 0.22);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, FLARE_SIZE, FLARE_SIZE);
}

function drawGlow(ctx: CanvasRenderingContext2D): void {
  const c = GLOW_SIZE / 2;
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE);
}
