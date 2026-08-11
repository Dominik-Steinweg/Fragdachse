import * as Phaser from 'phaser';
import { CELL_SIZE } from '../config';
import { fillRadialGradientTexture } from '../effects/EffectUtils';
import { getBlobSurfaceMottleTextureKey } from './BlobSurfaceProfile';
import type { BlobSurfaceMottleConfig, BlobSurfaceProfile } from './BlobSurfaceProfile';

export interface BlobSurfaceMottleMetrics {
  offsetX: number;
  offsetY: number;
}

export interface BlobSurfaceMottleBakeBounds extends BlobSurfaceMottleMetrics {
  width: number;
  height: number;
  layerDepth: number;
}

export interface BlobSurfaceMottleBakeResult {
  layers: Phaser.GameObjects.RenderTexture[];
  silhouetteCutout: Phaser.GameObjects.RenderTexture | null;
}

function textureKey(profile: BlobSurfaceProfile, suffix: string): string {
  return `__blob_surface_${profile.id}_${suffix}`;
}

function hash01(gridX: number, gridY: number, salt: number): number {
  let h = Math.imul(gridX + 0x9e3779b1, 0x85ebca6b)
    ^ Math.imul(gridY + 0x7f4a7c15, 0xc2b2ae35)
    ^ Math.imul(salt + 0x165667b1, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 16), 0x2545f491);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function resolveLiftAlpha(gain: number, materialPeak: number): number {
  return Math.max(0, (255 - materialPeak * gain) / 255);
}

/** Creates a reusable, profile-scoped material mottle texture. */
export function ensureBlobSurfaceMottleTexture(scene: Phaser.Scene, profile: BlobSurfaceProfile, mottle: BlobSurfaceMottleConfig, layerIndex = 0): string {
  const key = `${getBlobSurfaceMottleTextureKey(profile)}_${layerIndex}`;
  if (scene.textures.exists(key)) return key;

  const falloffKey = textureKey(profile, `mottle_falloff_${layerIndex}`);
  fillRadialGradientTexture(scene.textures, falloffKey, mottle.textureSize, mottle.falloff);
  const texture = scene.textures.addDynamicTexture(key, mottle.textureSize, mottle.textureSize);
  if (!texture) return key;
  texture.setFilter(Phaser.Textures.FilterMode.NEAREST);

  const sources: Phaser.GameObjects.GameObject[] = [];
  if (mottle.materialMode === 'native') {
    const material = new Phaser.GameObjects.Image(scene, 0, 0, profile.materialTextureKey ?? profile.textureKey, profile.materialFrame)
      .setOrigin(0, 0)
      .setDisplaySize(mottle.textureSize, mottle.textureSize);
    texture.draw(material);
    sources.push(material);
  } else {
    const gain = Math.min(mottle.materialGain, 255 / mottle.materialPeak);
    const fullPasses = Math.floor(gain);
    const partialAlpha = gain - fullPasses;
    for (let pass = 0; pass < fullPasses + (partialAlpha > 0 ? 1 : 0); pass += 1) {
      const isPartial = pass === fullPasses;
      // DynamicTexture commands are deferred: every additive pass needs its own source object
      // so later blend/alpha changes cannot alias an earlier queued command.
      const material = new Phaser.GameObjects.Image(scene, 0, 0, profile.materialTextureKey ?? profile.textureKey, profile.materialFrame)
        .setOrigin(0, 0)
        .setDisplaySize(mottle.textureSize, mottle.textureSize)
        .setTint(mottle.materialEqualizeTint);
      if (pass > 0) material.setBlendMode(Phaser.BlendModes.ADD);
      if (isPartial) material.setAlpha(partialAlpha);
      texture.draw(material);
      sources.push(material);
    }
    const liftAlpha = resolveLiftAlpha(gain, mottle.materialPeak);
    if (liftAlpha > 0) {
      const lift = scene.make.graphics({}, false).fillStyle(0xffffff, liftAlpha).fillRect(0, 0, mottle.textureSize, mottle.textureSize);
      lift.setBlendMode(Phaser.BlendModes.ADD);
      texture.draw(lift);
      sources.push(lift);
    }
  }
  texture.render();
  const falloff = new Phaser.GameObjects.Image(scene, 0, 0, falloffKey)
    .setOrigin(0, 0)
    .setDisplaySize(mottle.textureSize, mottle.textureSize);
  texture.erase(falloff);
  texture.render();
  for (const source of sources) source.destroy();
  return key;
}

/**
 * Creates deterministic, non-cell-aligned material stamps. Cell coordinates, rather than list
 * order, seed every stamp so dynamic rebuilds do not recolour unchanged regions.
 */
export function createBlobSurfaceMottleImages(
  scene: Phaser.Scene,
  profile: BlobSurfaceProfile,
  mottle: BlobSurfaceMottleConfig,
  cells: readonly { gridX: number; gridY: number }[],
  metrics: BlobSurfaceMottleMetrics,
  layerIndex = 0,
): Phaser.GameObjects.Image[] {
  if (cells.length === 0) return [];
  const key = ensureBlobSurfaceMottleTexture(scene, profile, mottle, layerIndex);
  const result: Phaser.GameObjects.Image[] = [];
  for (const { gridX, gridY } of cells) {
    for (let passIndex = 0; passIndex < mottle.passes.length; passIndex += 1) {
      const pass = mottle.passes[passIndex];
      const guaranteed = Math.floor(pass.perCell);
      const layerSalt = layerIndex * 7919;
      const extra = hash01(gridX, gridY, profile.seedSalt + layerSalt + passIndex * 97 + 11) < pass.perCell - guaranteed ? 1 : 0;
      for (let index = 0; index < guaranteed + extra; index += 1) {
        const salt = profile.seedSalt + layerSalt + passIndex * 997 + index * 31;
        const scale = pass.minScale + (pass.maxScale - pass.minScale) * hash01(gridX, gridY, salt + 1);
        const worldX = metrics.offsetX + (gridX + hash01(gridX, gridY, salt + 2)) * CELL_SIZE;
        const worldY = metrics.offsetY + (gridY + hash01(gridX, gridY, salt + 3)) * CELL_SIZE;
        result.push(new Phaser.GameObjects.Image(scene, worldX, worldY, key)
          .setDisplaySize(CELL_SIZE * scale, CELL_SIZE * scale)
          .setRotation(hash01(gridX, gridY, salt + 4) * Math.PI * 2)
          .setAlpha(pass.alpha));
      }
    }
  }
  return result;
}

/** Bakes and silhouette-clips the profile-selected material layer for any 47-Blob surface. */
export function bakeBlobSurfaceMottle(
  scene: Phaser.Scene,
  profile: BlobSurfaceProfile,
  cells: readonly { gridX: number; gridY: number }[],
  silhouetteImages: readonly Phaser.GameObjects.Image[],
  bounds: BlobSurfaceMottleBakeBounds,
  existingLayers: readonly Phaser.GameObjects.RenderTexture[] = [],
  existingSilhouetteCutout: Phaser.GameObjects.RenderTexture | null = null,
): BlobSurfaceMottleBakeResult {
  const configs = [profile.mottle, ...(profile.additionalMottleLayers ?? [])];
  if (cells.length === 0) {
    for (const layer of existingLayers) layer.clear();
    return { layers: [...existingLayers], silhouetteCutout: existingSilhouetteCutout };
  }
  const cutout = existingSilhouetteCutout ?? scene.add.renderTexture(bounds.offsetX, bounds.offsetY, bounds.width, bounds.height);
  cutout.setOrigin(0, 0);
  cutout.setDepth(bounds.layerDepth);
  cutout.camera.setScroll(bounds.offsetX, bounds.offsetY);
  cutout.setRenderMode('redraw');
  cutout.clear();
  cutout.fill(0x000000, 1);
  cutout.erase(silhouetteImages);
  cutout.render();

  const cutoutImage = new Phaser.GameObjects.Image(scene, bounds.offsetX, bounds.offsetY, cutout.texture.key).setOrigin(0, 0);
  const layers: Phaser.GameObjects.RenderTexture[] = [];
  for (let layerIndex = 0; layerIndex < configs.length; layerIndex += 1) {
    const mottle = configs[layerIndex];
    const mottleImages = createBlobSurfaceMottleImages(scene, profile, mottle, cells, bounds, layerIndex);
    const layer = existingLayers[layerIndex]
      ? existingLayers[layerIndex]
      : scene.add.renderTexture(bounds.offsetX, bounds.offsetY, bounds.width, bounds.height);
    layer.setOrigin(0, 0);
    layer.setDepth(bounds.layerDepth + 0.05 + layerIndex * 0.01);
    layer.camera.setScroll(bounds.offsetX, bounds.offsetY);
    layer.setBlendMode(mottle.blend === 'multiply' ? Phaser.BlendModes.MULTIPLY : Phaser.BlendModes.NORMAL);
    layer.clear();
    layer.draw(mottleImages);
    layer.render();
    layer.erase(cutoutImage);
    layer.render();
    for (const image of mottleImages) image.destroy();
    layers.push(layer);
  }
  cutoutImage.destroy();
  return { layers, silhouetteCutout: cutout };
}
