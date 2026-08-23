import type * as Phaser from 'phaser';
import { DEATH_DISINTEGRATION_VFX } from '../../config';

/** Ein normalisierter, getinteter Pixelblock des sichtbaren Sprite-Frames. */
export interface DeathFragmentTemplateChunk {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
  readonly color: number;
  readonly brightness: number;
}

export interface DeathFragmentTemplate {
  readonly textureKey: string;
  readonly frame: string;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly chunks: readonly DeathFragmentTemplateChunk[];
}

export type DeathFragmentCanvasFactory = (width: number, height: number) => HTMLCanvasElement;

/**
 * Zentrale, lazy Pixelanalyse fuer Death-Disintegration.
 *
 * Der Cache-Schluessel ist absichtlich genau die visuelle Identitaet, die ueber das Netzwerk
 * laeuft: Texture Key plus aktueller Frame. Display-Groesse, Rotation, Entity-Tint und Seed
 * bleiben Spawnparameter und erzeugen keine zweite Analyse derselben Grafik.
 */
export class DeathFragmentTemplateCache {
  private readonly templates = new Map<string, DeathFragmentTemplate>();
  private readonly createCanvas: DeathFragmentCanvasFactory;

  constructor(
    private readonly textures: Phaser.Textures.TextureManager,
    createCanvas?: DeathFragmentCanvasFactory,
  ) {
    this.createCanvas = createCanvas ?? ((width, height) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    });
  }

  get(textureKey: string, frame?: string | number): DeathFragmentTemplate {
    const frameKey = normalizeFrameKey(frame);
    const key = `${textureKey}\u0000${frameKey}`;
    const cached = this.templates.get(key);
    if (cached) return cached;

    const template = this.build(textureKey, frameKey);
    this.templates.set(key, template);
    return template;
  }

  get size(): number {
    return this.templates.size;
  }

  clear(): void {
    this.templates.clear();
  }

  private build(textureKey: string, frameKey: string): DeathFragmentTemplate {
    const empty: DeathFragmentTemplate = {
      textureKey,
      frame: frameKey,
      sourceWidth: 1,
      sourceHeight: 1,
      chunks: [],
    };

    if (!this.textures.exists(textureKey)) return empty;
    const texture = this.textures.get(textureKey);
    if (!texture.has(frameKey)) return empty;

    const frame = texture.get(frameKey);
    const width = Math.max(1, Math.ceil(frame.cutWidth));
    const height = Math.max(1, Math.ceil(frame.cutHeight));
    const sourceImage = texture.getSourceImage(frameKey) as CanvasImageSource;
    const canvas = this.createCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return empty;

    context.clearRect(0, 0, width, height);
    // Crop the actual frame. This is important for sprite sheets and atlases: analysing the
    // complete source image would turn neighbouring animation frames into death fragments.
    context.drawImage(
      sourceImage,
      frame.cutX,
      frame.cutY,
      frame.cutWidth,
      frame.cutHeight,
      0,
      0,
      width,
      height,
    );
    const pixels = context.getImageData(0, 0, width, height).data;
    const chunks: DeathFragmentTemplateChunk[] = [];
    const blockSize = DEATH_DISINTEGRATION_VFX.chunkSizePx;

    for (let py = 0; py < height; py += blockSize) {
      for (let px = 0; px < width; px += blockSize) {
        const blockWidth = Math.min(blockSize, width - px);
        const blockHeight = Math.min(blockSize, height - py);
        let weight = 0;
        let red = 0;
        let green = 0;
        let blue = 0;

        for (let sy = 0; sy < blockHeight; sy += 1) {
          for (let sx = 0; sx < blockWidth; sx += 1) {
            const offset = ((py + sy) * width + px + sx) * 4;
            const alpha = pixels[offset + 3] / 255;
            if (alpha <= 0.08) continue;
            weight += alpha;
            red += pixels[offset] * alpha;
            green += pixels[offset + 1] * alpha;
            blue += pixels[offset + 2] * alpha;
          }
        }

        if (weight <= 0.01) continue;
        const averageRed = Math.round(red / weight);
        const averageGreen = Math.round(green / weight);
        const averageBlue = Math.round(blue / weight);
        chunks.push({
          offsetX: (px + blockWidth * 0.5) / width - 0.5,
          offsetY: (py + blockHeight * 0.5) / height - 0.5,
          width: blockWidth / width,
          height: blockHeight / height,
          color: (averageRed << 16) | (averageGreen << 8) | averageBlue,
          brightness: (averageRed + averageGreen + averageBlue) / (255 * 3),
        });
      }
    }

    return {
      textureKey,
      frame: frameKey,
      sourceWidth: width,
      sourceHeight: height,
      chunks,
    };
  }
}

function normalizeFrameKey(frame?: string | number): string {
  if (frame === undefined || frame === null || frame === '') return '__BASE';
  return String(frame);
}
