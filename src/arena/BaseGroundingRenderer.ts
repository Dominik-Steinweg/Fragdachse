import * as Phaser from 'phaser';
import { DEPTH } from '../config';
import type { BaseVisualCell } from '../entities/BaseVisuals';
import type { WorldMetrics } from '../world/WorldMetrics';
import { baseGroundingTextureKey } from './BaseGroundingConfig';
import { getBaseApronRaster, writeBaseApron, type BaseApronMaterials } from './BaseGroundingField';
import { buildBaseGroundingLayout } from './BaseGroundingLayout';
import { DIRT_MATERIAL_KEY, GRASS_MATERIAL_KEY, GRAVEL_MATERIAL_KEY } from './GroundMaterialConfig';
import { readGroundMaterialSamples } from './GroundMaterialSamples';

let nextApronId = 0;

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

  constructor(private readonly scene: Phaser.Scene, cells: readonly BaseVisualCell[], metrics: WorldMetrics) {
    this.createApron(cells, metrics);
    for (const placement of buildBaseGroundingLayout(cells, metrics)) {
      const image = scene.add.image(placement.x, placement.y, baseGroundingTextureKey(placement.asset))
        .setDisplaySize(placement.width, placement.height)
        .setRotation(placement.rotation)
        .setAlpha(placement.alpha)
        .setDepth(DEPTH.BASE_GROUNDING - (placement.kind === 'gravel' ? 0.06 : 0));
      if (placement.tint !== undefined) image.setTint(placement.tint);
      let images = this.imagesByCell.get(placement.cellIndex);
      if (!images) this.imagesByCell.set(placement.cellIndex, images = []);
      images.push(image);
    }
  }

  private createApron(cells: readonly BaseVisualCell[], metrics: WorldMetrics): void {
    const materials = readApronMaterials(this.scene);
    const raster = getBaseApronRaster(cells, metrics);
    if (!materials || !raster) return;
    const key = `__base_apron_${nextApronId++}`;
    const texture = this.scene.textures.createCanvas(key, raster.width, raster.height);
    if (!texture) return;
    const pixels = texture.context.createImageData(raster.width, raster.height);
    writeBaseApron(pixels.data, raster, cells, metrics, materials);
    texture.context.putImageData(pixels, 0, 0);
    texture.refresh();
    this.apronKey = key;
    this.apron = this.scene.add.image(raster.worldX, raster.worldY, key)
      .setOrigin(0, 0)
      .setDepth(DEPTH.BASE_GROUNDING - 0.2);
  }

  destroyCell(cellIndex: number): void {
    const images = this.imagesByCell.get(cellIndex);
    if (!images) return;
    for (const image of images) image.destroy();
    this.imagesByCell.delete(cellIndex);
  }

  destroy(): void {
    for (const cellIndex of this.imagesByCell.keys()) this.destroyCell(cellIndex);
    this.apron?.destroy();
    this.apron = null;
    if (this.apronKey && this.scene.textures.exists(this.apronKey)) this.scene.textures.remove(this.apronKey);
    this.apronKey = null;
  }
}
