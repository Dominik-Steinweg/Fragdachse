import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import {
  configureAdditiveImage,
  createEmitter,
  createSeededRandom,
  destroyEmitter,
  ensureCanvasTexture,
  fillRadialGradientTexture,
  makeAdditive,
  mixColors,
} from './EffectUtils';

const TEX_BOLT_CORE = '__tesla_bolt_core';
const TEX_BOLT_HALO = '__tesla_bolt_halo';
const TEX_BOLT_SPARK = '__tesla_bolt_spark';

interface BoltVisual {
  core: Phaser.GameObjects.Image;
  halo: Phaser.GameObjects.Image;
  arcs: Phaser.GameObjects.Graphics;
  color: number;
  hotColor: number;
  glowColor: number;
  random: () => number;
  size: number;
  x: number;
  y: number;
  angle: number;
  /** Zickzack-Knoten: `t` längs der Flugachse, `offset` quer dazu, beide normiert. */
  shape: { t: number; offset: number }[];
  branch: { at: number; angle: number; length: number };
  lastShapeAt: number;
  flicker: number;
}

/** Wie oft die Entladung ihre Form neu würfelt. Kurz genug fürs Knistern, lang genug zum Lesen. */
const SHAPE_INTERVAL_MS = 42;
const SHAPE_NODES = 5;

/**
 * Gewitterentladung der Tesla-Kuppel im Stil eines Diablo-Charged-Bolt.
 *
 * Bewusst kein Geschoss mit Schweif: die Entladung *ist* der Blitz. Sie besteht aus einem
 * kurzen, gezackten Bogen, der im Knistertakt seine Form neu würfelt, und zeichnet sich in
 * drei additiven Durchgängen – breiter weicher Schein, mittlere Kante, weißglühender Kern.
 * Dadurch bleibt sie über hellem Untergrund als eigene Silhouette lesbar, und eine Salve
 * liest sich als Schwarm einzelner Blitze statt als Kometenregen.
 */
export class TeslaBoltRenderer {
  private readonly visuals = new Map<number, BoltVisual>();
  private impactEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    const textures = this.scene.textures;

    // Enger, sehr heller Kern: er trägt den Bloom-Kick, nicht die Silhouette.
    fillRadialGradientTexture(textures, TEX_BOLT_CORE, 24, [
      [0, 'rgba(255,255,255,1.0)'],
      [0.3, 'rgba(236,250,255,0.86)'],
      [0.62, 'rgba(150,220,255,0.32)'],
      [1, 'rgba(70,140,255,0.0)'],
    ]);

    fillRadialGradientTexture(textures, TEX_BOLT_HALO, 72, [
      [0, 'rgba(210,240,255,0.34)'],
      [0.34, 'rgba(140,210,255,0.2)'],
      [0.68, 'rgba(90,160,255,0.08)'],
      [1, 'rgba(24,48,110,0.0)'],
    ]);

    ensureCanvasTexture(textures, TEX_BOLT_SPARK, 10, 10, (ctx) => {
      ctx.clearRect(0, 0, 10, 10);
      const gradient = ctx.createRadialGradient(5, 5, 0, 5, 5, 5);
      gradient.addColorStop(0, 'rgba(255,255,255,1.0)');
      gradient.addColorStop(0.5, 'rgba(190,238,255,0.6)');
      gradient.addColorStop(1, 'rgba(90,170,255,0.0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 10, 10);
    });
  }

  createVisual(id: number, x: number, y: number, size: number, color: number): void {
    if (this.visuals.has(id)) return;

    const core = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_BOLT_CORE),
      DEPTH.PROJECTILES + 0.22,
      1,
      0xffffff,
    );
    const halo = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_BOLT_HALO),
      DEPTH.PROJECTILES + 0.1,
      0.85,
      mixColors(color, 0x8fd8ff, 0.5),
    );
    const arcs = this.scene.add.graphics()
      .setDepth(DEPTH.PROJECTILES + 0.2)
      .setBlendMode(Phaser.BlendModes.ADD);

    const visual: BoltVisual = {
      core,
      halo,
      arcs,
      color,
      hotColor: mixColors(color, 0xffffff, 0.78),
      glowColor: mixColors(color, 0x66c8ff, 0.45),
      // Seed je Projektil: zwei Bolzen einer Salve zappeln nie identisch.
      random: createSeededRandom(id * 2654435761),
      size,
      x,
      y,
      angle: 0,
      shape: [],
      branch: { at: 0.5, angle: 0, length: 0 },
      lastShapeAt: 0,
      flicker: 1,
    };
    this.rollShape(visual);
    this.visuals.set(id, visual);
    this.updateVisual(id, x, y, size, 0, 0, color);
  }

  updateVisual(id: number, x: number, y: number, size: number, vx: number, vy: number, color: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;

    const time = this.scene.time.now;
    if (color !== visual.color) {
      visual.color = color;
      visual.hotColor = mixColors(color, 0xffffff, 0.78);
      visual.glowColor = mixColors(color, 0x66c8ff, 0.45);
      visual.halo.setTint(mixColors(color, 0x8fd8ff, 0.5));
    }
    visual.size = size;
    visual.x = x;
    visual.y = y;
    if (Math.abs(vx) > 0.001 || Math.abs(vy) > 0.001) visual.angle = Math.atan2(vy, vx);

    if (time - visual.lastShapeAt >= SHAPE_INTERVAL_MS) {
      this.rollShape(visual);
      visual.lastShapeAt = time;
    }

    // Der Kern sitzt am vorderen Ende des Bogens und trägt den hellsten Punkt.
    const headX = x + Math.cos(visual.angle) * size * 0.5;
    const headY = y + Math.sin(visual.angle) * size * 0.5;
    const coreScale = (size / 16) * visual.flicker;

    visual.core.setPosition(headX, headY);
    visual.core.setScale(coreScale);
    visual.core.setAlpha(0.95 * visual.flicker);

    visual.halo.setPosition(x, y);
    visual.halo.setScale((size / 26) * (0.9 + visual.flicker * 0.2));
    visual.halo.setAlpha(0.72 * visual.flicker);

    this.drawBolt(visual);
  }

  /** Kurzer Entladungsblitz am Einschlagpunkt. */
  playImpact(x: number, y: number, size: number, color: number): void {
    const emitter = this.ensureImpactEmitter();
    const hotColor = mixColors(color, 0xffffff, 0.72);

    const flash = this.scene.add.circle(x, y, Math.max(size * 0.8, 7), hotColor, 0.9);
    flash.setDepth(DEPTH.PROJECTILES + 0.3);
    makeAdditive(flash);
    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      scaleX: 2.8,
      scaleY: 2.8,
      duration: 140,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });

    emitter.setPosition(x, y);
    emitter.setParticleTint([0xffffff, hotColor, mixColors(color, 0x66c8ff, 0.4)]);
    emitter.explode(11);
  }

  destroyVisual(id: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;
    visual.core.destroy();
    visual.halo.destroy();
    visual.arcs.destroy();
    this.visuals.delete(id);
  }

  has(id: number): boolean {
    return this.visuals.has(id);
  }

  getActiveIds(): number[] {
    return [...this.visuals.keys()];
  }

  destroyAll(): void {
    for (const id of [...this.visuals.keys()]) this.destroyVisual(id);
    if (this.impactEmitter) {
      destroyEmitter(this.impactEmitter);
      this.impactEmitter = null;
    }
  }

  /**
   * Würfelt Zackenform, Abzweig und Helligkeit neu.
   *
   * Die Enden bleiben nah an der Achse und die Mitte darf weit ausschlagen; so bleibt die
   * Flugrichtung ablesbar, obwohl der Bogen chaotisch zappelt. Auch die Knotenabstände längs
   * der Achse werden gewürfelt: bei gleichmäßigem Raster liest sich der Blitz sonst als
   * regelmäßige Spirale statt als Entladung.
   */
  private rollShape(visual: BoltVisual): void {
    const shape = visual.shape;
    shape.length = 0;
    for (let index = 0; index < SHAPE_NODES; index++) {
      const even = index / (SHAPE_NODES - 1);
      const isEnd = index === 0 || index === SHAPE_NODES - 1;
      const t = isEnd ? even : Phaser.Math.Clamp(even + (visual.random() - 0.5) * 0.26, 0.04, 0.96);
      // Spitze leicht Richtung Kopf gezogen, damit die Silhouette nicht spiegelsymmetrisch wird.
      const taper = Math.sin(Math.pow(t, 0.78) * Math.PI);
      // Alternierendes Vorzeichen erzeugt den harten Zickzack statt einer weichen Welle.
      const sign = index % 2 === 0 ? 1 : -1;
      shape.push({ t, offset: sign * (0.25 + visual.random() * 0.75) * taper });
    }

    visual.branch = {
      at: 0.3 + visual.random() * 0.4,
      angle: (visual.random() - 0.5) * 2.2,
      length: 0.35 + visual.random() * 0.55,
    };
    visual.flicker = 0.82 + visual.random() * 0.18;
  }

  private drawBolt(visual: BoltVisual): void {
    const arcs = visual.arcs;
    arcs.clear();

    const length = Math.max(14, visual.size * 3);
    const amplitude = Math.max(3, visual.size * 0.5);
    const dirX = Math.cos(visual.angle);
    const dirY = Math.sin(visual.angle);
    const normalX = -dirY;
    const normalY = dirX;
    const startX = visual.x - dirX * length * 0.5;
    const startY = visual.y - dirY * length * 0.5;

    const points: { x: number; y: number }[] = [];
    for (const node of visual.shape) {
      const offset = node.offset * amplitude;
      points.push({
        x: startX + dirX * length * node.t + normalX * offset,
        y: startY + dirY * length * node.t + normalY * offset,
      });
    }

    const branchStart = points[Math.round(visual.branch.at * (points.length - 1))];
    const branchAngle = visual.angle + visual.branch.angle;
    const branchEnd = {
      x: branchStart.x + Math.cos(branchAngle) * length * visual.branch.length * 0.5,
      y: branchStart.y + Math.sin(branchAngle) * length * visual.branch.length * 0.5,
    };

    // Drei Durchgänge von außen nach innen: breiter Schein, Kante, weißglühender Kern.
    const passes: readonly [number, number, number][] = [
      [Math.max(3.2, visual.size * 0.55), visual.glowColor, 0.3 * visual.flicker],
      [Math.max(1.8, visual.size * 0.26), visual.hotColor, 0.65 * visual.flicker],
      [Math.max(0.9, visual.size * 0.12), 0xffffff, 0.98 * visual.flicker],
    ];

    for (const [width, tint, alpha] of passes) {
      arcs.lineStyle(width, tint, alpha);
      arcs.beginPath();
      arcs.moveTo(points[0].x, points[0].y);
      for (let index = 1; index < points.length; index++) arcs.lineTo(points[index].x, points[index].y);
      arcs.strokePath();

      arcs.lineStyle(width * 0.6, tint, alpha * 0.8);
      arcs.beginPath();
      arcs.moveTo(branchStart.x, branchStart.y);
      arcs.lineTo(branchEnd.x, branchEnd.y);
      arcs.strokePath();
    }
  }

  private ensureImpactEmitter(): Phaser.GameObjects.Particles.ParticleEmitter {
    if (this.impactEmitter) return this.impactEmitter;
    this.impactEmitter = createEmitter(this.scene, 0, 0, TEX_BOLT_SPARK, {
      lifespan: { min: 90, max: 190 },
      frequency: -1,
      quantity: 1,
      speed: { min: 60, max: 190 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.05, end: 0 },
      alpha: { start: 0.95, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH.PROJECTILES + 0.31, undefined, 'teslaBolt');
    return this.impactEmitter;
  }
}
