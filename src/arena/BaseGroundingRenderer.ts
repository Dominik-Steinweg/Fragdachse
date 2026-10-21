import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import type { BaseVisualCell } from '../entities/BaseVisuals';
import type { WorldMetrics } from '../world/WorldMetrics';
import { baseGroundingTextureKey } from './BaseGroundingConfig';
import { getBaseApronRaster, writeBaseApron, type BaseApronMaterials } from './BaseGroundingField';
import type { PersistentBaseGravelCoverage } from './PersistentBaseGravelField';
import { buildBaseGroundingLayout } from './BaseGroundingLayout';
import { DIRT_MATERIAL_KEY, GRASS_MATERIAL_KEY, GRAVEL_MATERIAL_KEY } from './GroundMaterialConfig';
import { readGroundMaterialSamples } from './GroundMaterialSamples';

let nextApronId = 0;

export interface BaseGroundingStyle {
  /** Hostile bases sit on darker, void-stained ground. */
  readonly hostile?: boolean;
  /** Gravel of a base site below; there the apron turns into compacted gravel. */
  readonly gravel?: PersistentBaseGravelCoverage | null;
}

/** Stones and gravel take on the tone of the ground they lie in; hostile ground is darker. */
const FRIENDLY_TINT = 0xc4baa8;
const HOSTILE_TINT = 0x80787f;
const HOSTILE_APRON_BRIGHTNESS = 0.72;

function multiplyColours(a: number, b: number): number {
  const channel = (shift: number) => Math.round(((a >> shift) & 0xff) * ((b >> shift) & 0xff) / 255) << shift;
  return channel(16) | channel(8) | channel(0);
}

/** The shared ground materials, once the World's materials are loaded. */
function readApronMaterials(scene: Phaser.Scene): BaseApronMaterials | null {
  const textures = scene.textures;
  if (!textures?.exists?.(DIRT_MATERIAL_KEY) || !textures.exists(GRAVEL_MATERIAL_KEY)
    || !textures.exists(GRASS_MATERIAL_KEY)) return null;
  const samples = readGroundMaterialSamples(scene);
  return samples.gravel ? { soil: samples.dirt, gravel: samples.gravel, grassHeight: samples.grassHeight } : null;
}

/**
 * Owned by the base presentation; excluded from building shadows and destruction cell indices.
 * The procedural apron stays when single cells fall (their bare foundation remains); stones and
 * gravel deposits leave with their cell.
 */
export class BaseGroundingRenderer {
  private readonly imagesByCell = new Map<number, Phaser.GameObjects.Image[]>();
  private apron: Phaser.GameObjects.Image | null = null;
  private apronKey: string | null = null;
  private readonly cells: readonly BaseVisualCell[];
  private readonly metrics: WorldMetrics;
  private readonly brightness: number;
  private gravel: PersistentBaseGravelCoverage | null;

  constructor(
    private readonly scene: Phaser.Scene,
    cells: readonly BaseVisualCell[],
    metrics: WorldMetrics,
    style: BaseGroundingStyle = {},
  ) {
    this.cells = cells;
    this.metrics = metrics;
    this.brightness = style.hostile ? HOSTILE_APRON_BRIGHTNESS : 1;
    this.gravel = style.gravel ?? null;
    this.renderApron();
    const groundTint = style.hostile ? HOSTILE_TINT : FRIENDLY_TINT;
    for (const placement of buildBaseGroundingLayout(cells, metrics)) {
      const image = scene.add.image(placement.x, placement.y, baseGroundingTextureKey(placement.asset))
        .setDisplaySize(placement.width, placement.height)
        .setRotation(placement.rotation)
        .setAlpha(placement.alpha)
        .setDepth(DEPTH.BASE_GROUNDING - (placement.kind === 'gravel' ? 0.06 : 0));
      image.setTint(placement.tint === undefined ? groundTint : multiplyColours(placement.tint, groundTint));
      let images = this.imagesByCell.get(placement.cellIndex);
      if (!images) this.imagesByCell.set(placement.cellIndex, images = []);
      images.push(image);
    }
  }

  /**
   * Follows a change of the base site's gravel (a new build area): only the apron is redrawn, so
   * stones of fallen cells stay gone.
   */
  setGravel(gravel: PersistentBaseGravelCoverage | null): void {
    if ((gravel?.key ?? null) === (this.gravel?.key ?? null)) return;
    this.gravel = gravel;
    this.destroyApron();
    this.renderApron();
  }

  private renderApron(): void {
    const materials = readApronMaterials(this.scene);
    const raster = getBaseApronRaster(this.cells, this.metrics);
    if (!materials || !raster) return;
    const key = `__base_apron_${nextApronId++}`;
    const texture = this.scene.textures.createCanvas(key, raster.width, raster.height);
    if (!texture) return;
    const pixels = texture.context.createImageData(raster.width, raster.height);
    const gravel = this.gravel;
    writeBaseApron(pixels.data, raster, this.cells, this.metrics, materials, this.brightness,
      gravel ? (x, y) => gravel.coverageAt(x, y) : undefined);
    texture.context.putImageData(pixels, 0, 0);
    texture.refresh();
    this.apronKey = key;
    this.apron = this.scene.add.image(raster.worldX, raster.worldY, key)
      .setOrigin(0, 0)
      .setDepth(DEPTH.BASE_GROUNDING - 0.2);
  }

  private destroyApron(): void {
    this.apron?.destroy();
    this.apron = null;
    if (this.apronKey && this.scene.textures.exists(this.apronKey)) this.scene.textures.remove(this.apronKey);
    this.apronKey = null;
  }

  destroyCell(cellIndex: number): void {
    const images = this.imagesByCell.get(cellIndex);
    if (!images) return;
    for (const image of images) image.destroy();
    this.imagesByCell.delete(cellIndex);
  }

  destroy(): void {
    for (const cellIndex of this.imagesByCell.keys()) this.destroyCell(cellIndex);
    this.destroyApron();
  }
}
