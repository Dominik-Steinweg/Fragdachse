import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import { emissiveAlpha } from './EmissiveScale';
import {
  configureAdditiveImage,
  createEmitter,
  createSeededRandom,
  destroyEmitter,
  ensureCanvasTexture,
  fillRadialGradientTexture,
  mixColors,
  registerGraphicsObject,
  setEmitterTintArray,
} from './EffectUtils';

const TEX_BOLT_HALO = '__tesla_bolt_halo';
const TEX_BOLT_SPARK = '__tesla_bolt_spark';

interface BoltNode { t: number; offset: number }
interface BoltPoint { x: number; y: number }
interface BoltSpark {
  image: Phaser.GameObjects.Image;
  outer: boolean;
  bornAt: number;
  lifetimeMs: number;
  angle: number;
  radius: number;
  diameter: number;
}

interface BoltVisual {
  halos: Phaser.GameObjects.Image[];
  sparks: BoltSpark[];
  sparkRandom: () => number;
  arcs: Phaser.GameObjects.Graphics;
  color: number;
  hotColor: number;
  size: number;
  x: number;
  y: number;
  angle: number;
  filaments: BoltFilament[];
}

interface BoltFilament {
  random: () => number;
  angleOffset: number;
  previousAngleOffset: number;
  /** Normierte Knoten relativ zur unveränderten Projektilposition. */
  shape: BoltNode[];
  previousShape: BoltNode[];
  nodes: BoltPoint[];
  points: BoltPoint[];
  branchPoints: BoltPoint[];
  branch: { at: number; angle: number; length: number };
  lastShapeAt: number;
  nextShapeAt: number;
  pulsePhase: number;
  flicker: number;
}

const SHAPE_NODES = 7;
const CORNER_STEPS = 4;
const SHAPE_TRANSITION_MS = 10;
const FILAMENT_COUNT = 3;
const SPARK_COUNT = 18;
const makePoints = (count: number): BoltPoint[] => Array.from({ length: count }, () => ({ x: 0, y: 0 }));

/**
 * Gewitterentladung der Tesla-Kuppel im Stil eines Diablo-Charged-Bolt.
 *
 * Bewusst kein Geschoss mit Schweif: die Entladung *ist* der Blitz. Sie besteht aus einem
 * kompakten Büschel aus Querfilamenten. Der helle Kern markiert die Trefferzone;
 * nur schwache Äste und Halos ragen darüber hinaus. Es gibt keinen separaten Projektilkopf.
 * Wiederverwendete Halo-Bilder tragen den weichen Schein, transparente Bänder den Kern.
 */
export class TeslaBoltRenderer {
  private readonly visuals = new Map<number, BoltVisual>();
  private impactEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private readonly impactFlashes = new Set<Phaser.GameObjects.Image>();

  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    const textures = this.scene.textures;

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

    const halos = Array.from({ length: FILAMENT_COUNT }, () => configureAdditiveImage(
      this.scene.add.image(x, y, TEX_BOLT_HALO),
      DEPTH.PROJECTILES + 0.1,
      0,
      mixColors(color, 0x8fd8ff, 0.5),
    ));
    for (const image of halos) registerGraphicsObject(this.scene, 'teslaBoltEffects', image);
    const sparks = Array.from({ length: SPARK_COUNT }, (_, index): BoltSpark => {
      const image = configureAdditiveImage(this.scene.add.image(x, y, TEX_BOLT_SPARK),
        DEPTH.PROJECTILES + 0.22, 0, mixColors(color, 0xffffff, 0.85));
      registerGraphicsObject(this.scene, 'teslaBoltEffects', image);
      return { image, outer: index >= SPARK_COUNT - 2, bornAt: 0, lifetimeMs: 1, angle: 0, radius: 0, diameter: 0 };
    });
    const arcs = this.scene.add.graphics()
      .setDepth(DEPTH.PROJECTILES + 0.2)
      .setBlendMode(Phaser.BlendModes.ADD);
    registerGraphicsObject(this.scene, 'teslaBoltEffects', arcs);

    const visual: BoltVisual = {
      halos,
      sparks,
      sparkRandom: createSeededRandom(id * 3266489917),
      arcs,
      color,
      hotColor: mixColors(color, 0xffffff, 0.78),
      size,
      x,
      y,
      angle: 0,
      filaments: Array.from({ length: FILAMENT_COUNT }, (_, index) => {
        const filament: BoltFilament = {
          random: createSeededRandom(id * 2654435761 + index * 2246822519),
          angleOffset: 0,
          previousAngleOffset: 0,
          shape: Array.from({ length: SHAPE_NODES }, (_, node) => ({ t: node / (SHAPE_NODES - 1), offset: 0 })),
          previousShape: Array.from({ length: SHAPE_NODES }, () => ({ t: 0, offset: 0 })),
          nodes: makePoints(SHAPE_NODES),
          points: makePoints(2 + (SHAPE_NODES - 2) * (CORNER_STEPS + 1)),
          branchPoints: makePoints(7),
          branch: { at: 0.5, angle: 0, length: 0 },
          lastShapeAt: this.scene.time.now - SHAPE_TRANSITION_MS,
          nextShapeAt: this.scene.time.now,
          pulsePhase: (id * 2.399963 + index * 2.1) % (Math.PI * 2),
          flicker: 1,
        };
        this.rollShape(filament);
        filament.nextShapeAt += 25 + filament.random() * 30;
        return filament;
      }),
    };
    for (const spark of sparks) {
      this.rollSpark(visual, spark, this.scene.time.now);
      spark.bornAt -= visual.sparkRandom() * spark.lifetimeMs;
    }
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
      for (const halo of visual.halos) halo.setTint(mixColors(color, 0x8fd8ff, 0.5));
      for (const spark of visual.sparks) spark.image.setTint(mixColors(color, 0xffffff, 0.85));
    }
    visual.size = size;
    visual.x = x;
    visual.y = y;
    if (Math.abs(vx) > 0.001 || Math.abs(vy) > 0.001) visual.angle = Math.atan2(vy, vx);

    for (const filament of visual.filaments) {
      // Begrenztes Nachholen hält den Takt auch bei schwankender Framerate stabil.
      let rolls = 0;
      while (time >= filament.nextShapeAt && rolls++ < 4) {
        this.rollShape(filament);
        filament.lastShapeAt = filament.nextShapeAt;
        filament.nextShapeAt += 25 + filament.random() * 30;
      }
      if (time >= filament.nextShapeAt) filament.nextShapeAt = time + 25 + filament.random() * 30;
      // Jeder Kernbogen bleibt sichtbar; die Helligkeitsminima sind phasenversetzt.
      filament.flicker = 0.88 + Math.sin(time * 0.073 + filament.pulsePhase) * 0.08
        + Math.sin(time * 0.119 + filament.pulsePhase * 1.7) * 0.04;
    }
    this.drawBolt(visual);
    this.updateSparks(visual, time);
  }

  /** Kurzer Entladungsblitz am Einschlagpunkt. */
  playImpact(x: number, y: number, size: number, color: number): void {
    const emitter = this.ensureImpactEmitter();
    const hotColor = mixColors(color, 0xffffff, 0.72);

    // Der Halo allein ist für einen Treffer zu schwach: ein dichter, weicher Kern
    // hält den Kontakt kurz sichtbar, ohne die frühere große Scheibe zurückzubringen.
    const flash = configureAdditiveImage(this.scene.add.image(x, y, TEX_BOLT_SPARK),
      DEPTH.PROJECTILES + 0.3, 1, hotColor);
    const flashScale = Math.max(12, Math.min(28, size * 0.75)) / 10;
    flash.setScale(flashScale);
    registerGraphicsObject(this.scene, 'teslaBoltEffects', flash);
    this.impactFlashes.add(flash);
    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      scaleX: flashScale * 1.5,
      scaleY: flashScale * 1.5,
      delay: 40,
      duration: 160,
      ease: 'Quad.easeOut',
      onComplete: () => {
        this.impactFlashes.delete(flash);
        flash.destroy();
      },
    });

    emitter.setPosition(x, y);
    setEmitterTintArray(emitter, [0xffffff, hotColor, mixColors(color, 0x66c8ff, 0.4)]);
    emitter.explode(10);
  }

  destroyVisual(id: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;
    for (const halo of visual.halos) halo.destroy();
    for (const spark of visual.sparks) spark.image.destroy();
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
    for (const flash of this.impactFlashes) {
      this.scene.tweens.killTweensOf(flash);
      flash.destroy();
    }
    this.impactFlashes.clear();
    if (this.impactEmitter) {
      destroyEmitter(this.impactEmitter);
      this.impactEmitter = null;
    }
  }

  private rollSpark(visual: BoltVisual, spark: BoltSpark, now: number): void {
    const random = visual.sparkRandom;
    spark.bornAt = now;
    spark.lifetimeMs = 70 + random() * 110;
    spark.angle = random() * Math.PI * 2;
    // Nur zwei Funken verzieren den Rand; die übrigen häufen sich nahe der Mitte.
    spark.radius = spark.outer ? 0.42 + random() * 0.12 : Math.pow(random(), 1.5) * 0.32;
    spark.diameter = spark.outer ? 1.6 + random() * 1.1 : 2 + random() * 1.6;
  }

  private updateSparks(visual: BoltVisual, now: number): void {
    for (const spark of visual.sparks) {
      if (now - spark.bornAt >= spark.lifetimeMs) this.rollSpark(visual, spark, now);
      const age = Phaser.Math.Clamp((now - spark.bornAt) / spark.lifetimeMs, 0, 1);
      const radius = visual.size * (spark.radius + age * 0.02);
      spark.image.setPosition(visual.x + Math.cos(spark.angle) * radius, visual.y + Math.sin(spark.angle) * radius);
      spark.image.setScale(spark.diameter / 10 * Math.sqrt(visual.size / 32) * (1 - age * 0.25));
      const envelope = Math.min(1, age / 0.12) * (1 - age * age);
      spark.image.setAlpha(emissiveAlpha(envelope * (spark.outer ? 0.55 : 0.95)));
    }
  }

  /** Unregelmäßige, geordnete Knoten statt alternierendem Sägezahnraster. */
  private rollShape(visual: BoltFilament): void {
    visual.previousAngleOffset = visual.angleOffset;
    visual.angleOffset = (visual.random() - 0.5) * 0.6;
    for (let index = 0; index < SHAPE_NODES; index++) {
      const node = visual.shape[index];
      Object.assign(visual.previousShape[index], node);
      const even = index / (SHAPE_NODES - 1);
      const isEnd = index === 0 || index === SHAPE_NODES - 1;
      node.t = isEnd ? even : even + (visual.random() - 0.5) * 0.12;
      const envelope = 0.16 + Math.sin(node.t * Math.PI) * 0.84;
      node.offset = (visual.random() * 2 - 1) * envelope;
    }
    visual.branch.at = 0.25 + visual.random() * 0.5;
    visual.branch.angle = (visual.random() < 0.5 ? -1 : 1) * (0.5 + visual.random() * 1.1);
    visual.branch.length = visual.random() < 0.25 ? 0 : 0.18 + visual.random() * 0.16;
  }

  private drawBolt(visual: BoltVisual): void {
    visual.arcs.clear();
    for (let index = 0; index < visual.filaments.length; index++) {
      this.drawArc(visual, visual.filaments[index], index);
    }
  }

  private drawArc(visual: BoltVisual, filament: BoltFilament, filamentIndex: number): void {
    const arcs = visual.arcs;
    const length = visual.size * 0.86;
    const amplitude = visual.size * 0.13;
    const blend = Phaser.Math.Clamp((this.scene.time.now - filament.lastShapeAt) / SHAPE_TRANSITION_MS, 0, 1);
    const transition = 1 - (1 - blend) * (1 - blend);
    const angle = visual.angle + Math.PI / 2 + filament.previousAngleOffset
      + (filament.angleOffset - filament.previousAngleOffset) * transition;
    const dirX = Math.cos(angle);
    const dirY = Math.sin(angle);
    for (let index = 0; index < SHAPE_NODES; index++) {
      const from = filament.previousShape[index];
      const to = filament.shape[index];
      const along = (from.t + (to.t - from.t) * transition - 0.5) * length;
      const across = (filamentIndex - 1) * visual.size * 0.2
        + (from.offset + (to.offset - from.offset) * transition) * amplitude;
      filament.nodes[index].x = visual.x + dirX * along - dirY * across;
      filament.nodes[index].y = visual.y + dirY * along + dirX * across;
      this.constrainPoint(filament.nodes[index], visual, visual.size * 0.43);
    }

    // Nur die unmittelbaren Knicke abrunden: die langen Teilstücke bleiben elektrisch kantig.
    const points = filament.points;
    let cursor = 0;
    Object.assign(points[cursor++], filament.nodes[0]);
    for (let index = 1; index < SHAPE_NODES - 1; index++) {
      const previous = filament.nodes[index - 1];
      const corner = filament.nodes[index];
      const next = filament.nodes[index + 1];
      const entryX = corner.x + (previous.x - corner.x) * 0.24;
      const entryY = corner.y + (previous.y - corner.y) * 0.24;
      const exitX = corner.x + (next.x - corner.x) * 0.24;
      const exitY = corner.y + (next.y - corner.y) * 0.24;
      points[cursor].x = entryX;
      points[cursor++].y = entryY;
      for (let step = 1; step <= CORNER_STEPS; step++) {
        const t = step / CORNER_STEPS;
        const u = 1 - t;
        points[cursor].x = u * u * entryX + 2 * u * t * corner.x + t * t * exitX;
        points[cursor++].y = u * u * entryY + 2 * u * t * corner.y + t * t * exitY;
      }
    }
    Object.assign(points[cursor], filament.nodes[SHAPE_NODES - 1]);

    this.drawFilament(arcs, points, visual.size * 0.08, visual.hotColor, filament.flicker, false);
    const branchStart = points[Math.round(filament.branch.at * (points.length - 1))];
    const branchAngle = angle + filament.branch.angle;
    const branchLength = length * filament.branch.length;
    if (branchLength > 0) {
      for (let index = 0; index < filament.branchPoints.length; index++) {
        const t = index / (filament.branchPoints.length - 1);
        const bend = Math.sin(t * Math.PI) * branchLength * 0.18;
        filament.branchPoints[index].x = branchStart.x + Math.cos(branchAngle) * branchLength * t - Math.sin(branchAngle) * bend;
        filament.branchPoints[index].y = branchStart.y + Math.sin(branchAngle) * branchLength * t + Math.cos(branchAngle) * bend;
        this.constrainPoint(filament.branchPoints[index], visual, visual.size * 0.68);
      }
      this.drawFilament(arcs, filament.branchPoints, visual.size * 0.035, visual.hotColor, filament.flicker * 0.38, true);
    }

    const halo = visual.halos[filamentIndex];
    const center = points[Math.floor(points.length / 2)];
    halo.setPosition(visual.x + (center.x - visual.x) * 0.5, visual.y + (center.y - visual.y) * 0.5);
    halo.setScale(visual.size * 1.3 / 72);
    halo.setAlpha(emissiveAlpha(0.35 * filament.flicker));
  }

  /** Radiale Grenzen bleiben auch beim Drehen relativ zur Trefferzone kompakt. */
  private constrainPoint(point: BoltPoint, visual: BoltVisual, radius: number): void {
    const dx = point.x - visual.x;
    const dy = point.y - visual.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= radius) return;
    point.x = visual.x + dx * radius / distance;
    point.y = visual.y + dy * radius / distance;
  }

  /** Zusammenhängende Bänder vermeiden helle Überlappungen einzelner transparenter Linien. */
  private drawFilament(
    graphics: Phaser.GameObjects.Graphics,
    points: BoltPoint[],
    width: number,
    color: number,
    intensity: number,
    branch: boolean,
  ): void {
    for (let pass = 0; pass < 3; pass++) {
      const bandWidth = width * (pass === 0 ? 2.4 : pass === 1 ? 1.45 : 0.65);
      const alpha = emissiveAlpha(intensity * (pass === 0 ? 0.09 : pass === 1 ? 0.23 : 0.64));
      let leftX = points[0].x;
      let leftY = points[0].y;
      let rightX = leftX;
      let rightY = leftY;
      for (let index = 0; index < points.length; index++) {
        const point = points[index];
        const before = points[Math.max(0, index - 1)];
        const after = points[Math.min(points.length - 1, index + 1)];
        const dx = after.x - before.x;
        const dy = after.y - before.y;
        const distance = Math.max(0.0001, Math.hypot(dx, dy));
        const t = index / (points.length - 1);
        const envelope = branch ? (index === 0 ? 0 : Math.sin(Math.PI * t) * (1 - t)) : Math.sin(Math.PI * t);
        const radius = bandWidth * envelope * 0.5;
        const nextLeftX = point.x - dy / distance * radius;
        const nextLeftY = point.y + dx / distance * radius;
        const nextRightX = point.x + dy / distance * radius;
        const nextRightY = point.y - dx / distance * radius;
        if (index > 0) {
          const midpoint = (index - 0.5) / (points.length - 1);
          graphics.fillStyle(pass === 2 ? 0xffffff : color, alpha * (0.2 + Math.sin(Math.PI * midpoint) * 0.8));
          graphics.fillTriangle(leftX, leftY, rightX, rightY, nextLeftX, nextLeftY);
          graphics.fillTriangle(rightX, rightY, nextRightX, nextRightY, nextLeftX, nextLeftY);
        }
        leftX = nextLeftX;
        leftY = nextLeftY;
        rightX = nextRightX;
        rightY = nextRightY;
      }
    }
  }

  private ensureImpactEmitter(): Phaser.GameObjects.Particles.ParticleEmitter {
    if (this.impactEmitter) return this.impactEmitter;
    this.impactEmitter = createEmitter(this.scene, 0, 0, TEX_BOLT_SPARK, {
      lifespan: { min: 110, max: 190 },
      frequency: -1,
      quantity: 1,
      speed: { min: 40, max: 105 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.9, end: 0 },
      alpha: { start: 0.95, end: 0 },
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH.PROJECTILES + 0.31, undefined, 'teslaBolt');
    return this.impactEmitter;
  }
}
