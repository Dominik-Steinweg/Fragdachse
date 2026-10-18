import type * as Phaser from 'phaser';
import { registerGraphicsObject } from '../../effects/EffectUtils';

const TICKS = 48;
/** Widest soft stroke (10 px) reaches 5 px beyond its path; keep a margin for antialiasing. */
const PADDING = 8;
/** Soft strokes: width and alpha; their joint alpha breathes. */
const SOFT_STROKES = [[10, 0.035], [6, 0.07], [3, 0.16]] as const;

type Layer = 'under' | 'soft' | 'over';
const LAYERS: readonly Layer[] = ['under', 'soft', 'over'];
let nextId = 0;

function rgba(color: number, alpha: number): string {
  return `rgba(${(color >> 16) & 255},${(color >> 8) & 255},${color & 255},${alpha})`;
}

/**
 * Local turret placement footprint. The former Graphics redrew five 160-segment ellipses and 48
 * ticks (about 5,000 path commands) in every frame of placement mode. The geometry only depends on
 * radius, colour and validity, so it is baked once into three textures in the original drawing
 * order (coverage wash, breathing soft edge, crisp edge with ticks); only the soft layer's alpha
 * changes per frame.
 */
export class TurretRangePreviewVisual {
  private readonly images: Record<Layer, Phaser.GameObjects.Image>;
  private readonly prefix = `__turret_range_preview_${nextId++}_`;
  private signature = '';

  constructor(private readonly scene: Phaser.Scene, depth: number) {
    const image = (layer: Layer) => {
      const object = scene.add.image(0, 0, '__WHITE').setDepth(depth).setVisible(false);
      registerGraphicsObject(scene, 'placementPreview', object);
      return object.setName(`turret-range-${layer}`);
    };
    this.images = { under: image('under'), soft: image('soft'), over: image('over') };
  }

  show(x: number, y: number, radius: number, color: number, valid: boolean, breathe: number): void {
    if (!Number.isFinite(radius) || radius <= 0) { this.hide(); return; }
    const signature = `${Math.round(radius * 4) / 4}:${color}:${valid ? 1 : 0}`;
    if (signature !== this.signature) this.bake(radius, color, valid ? 1 : 0.55, signature);
    for (const layer of LAYERS) this.images[layer].setPosition(x, y).setVisible(true);
    this.images.soft.setAlpha(breathe);
  }

  hide(): void {
    for (const layer of LAYERS) this.images[layer].setVisible(false);
  }

  destroy(): void {
    for (const layer of LAYERS) this.images[layer].destroy();
    this.releaseTextures();
  }

  private releaseTextures(): void {
    for (const layer of LAYERS) {
      const key = this.prefix + layer;
      if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
    }
    this.signature = '';
  }

  private bake(radius: number, color: number, opacity: number, signature: string): void {
    for (const layer of LAYERS) this.images[layer].setTexture('__WHITE');
    this.releaseTextures();
    const size = Math.ceil(radius * 2 + PADDING * 2), centre = size / 2;
    const draw = (layer: Layer, paint: (ctx: CanvasRenderingContext2D) => void): void => {
      const texture = this.scene.textures.createCanvas(this.prefix + layer, size, size);
      if (!texture) return;
      paint(texture.context);
      texture.refresh();
      this.images[layer].setTexture(this.prefix + layer);
    };
    const circle = (ctx: CanvasRenderingContext2D, r: number) => { ctx.beginPath(); ctx.arc(centre, centre, r, 0, Math.PI * 2); };
    // A quiet coverage wash and soft edge keep terrain and combat silhouettes readable.
    draw('under', ctx => { ctx.fillStyle = rgba(color, 0.035 * opacity); circle(ctx, radius); ctx.fill(); });
    draw('soft', ctx => {
      for (const [width, alpha] of SOFT_STROKES) {
        ctx.strokeStyle = rgba(color, alpha * opacity); ctx.lineWidth = width;
        circle(ctx, radius - width / 2); ctx.stroke();
      }
    });
    // Inward ticks and four pale cardinal accents give the footprint a surveyed, precise edge.
    draw('over', ctx => {
      ctx.strokeStyle = rgba(color, 0.8 * opacity); ctx.lineWidth = 1.5;
      circle(ctx, radius); ctx.stroke();
      for (let index = 0; index < TICKS; index++) {
        const angle = index * Math.PI * 2 / TICKS, cardinal = index % 12 === 0;
        const length = Math.min(radius * 0.12, cardinal ? 12 : 4);
        const nx = Math.cos(angle), ny = Math.sin(angle);
        ctx.strokeStyle = rgba(cardinal ? 0xe5f8ff : color, (cardinal ? 0.85 : 0.35) * opacity);
        ctx.lineWidth = cardinal ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(centre + nx * (radius - length), centre + ny * (radius - length));
        ctx.lineTo(centre + nx * radius, centre + ny * radius);
        ctx.stroke();
      }
    });
    this.signature = signature;
  }
}
