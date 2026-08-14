/**
 * Non-periodic material disturbance ("mottle") of a 47-Blob surface.
 *
 * All 47 blob frames share one 32 px material area, so a blob field is that single motif
 * stamped once per cell. A pure colour/value field (see `BlobSurfaceShading`) cannot resolve
 * that, it has no detail structure; per-cell rotation cannot either, because the motif is
 * only seamless with itself in the same orientation.
 *
 * The fix is to scatter softly masked, rotated, mirrored and scaled copies of a material area
 * across the compound. The masks are soft and the stamps overlap, so no seams appear; their
 * size and position have nothing to do with `CELL_SIZE`, so the grid disappears.
 */

import * as Phaser from 'phaser';
import { CELL_SIZE } from '../config';
import { fillRadialGradientTexture } from '../effects/EffectUtils';
import { hashCell01 as hash01 } from './CellHash';
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

/**
 * Falloff textures are keyed by their gradient, not by the profile: identical falloffs are
 * common across layers and profiles, and a per-layer key would allocate the same 32 px canvas
 * several times.
 */
function falloffTextureKey(size: number, falloff: readonly (readonly [number, string])[]): string {
  let hash = 0x811c9dc5;
  const stops = falloff.map(([offset, color]) => `${offset}:${color}`).join('|');
  for (let index = 0; index < stops.length; index += 1) {
    hash = Math.imul(hash ^ stops.charCodeAt(index), 0x01000193);
  }
  return `__blob_surface_falloff_${size}_${(hash >>> 0).toString(16)}`;
}

function resolveLiftAlpha(gain: number, materialPeak: number): number {
  return Math.max(0, (255 - materialPeak * gain) / 255);
}

/** Creates a reusable, layer-scoped material mottle texture. */
export function ensureBlobSurfaceMottleTexture(scene: Phaser.Scene, profile: BlobSurfaceProfile, mottle: BlobSurfaceMottleConfig, layerIndex = 0): string {
  const key = getBlobSurfaceMottleTextureKey(profile, mottle, layerIndex);
  if (scene.textures.exists(key)) return key;

  const falloffKey = falloffTextureKey(mottle.textureSize, mottle.falloff);
  fillRadialGradientTexture(scene.textures, falloffKey, mottle.textureSize, mottle.falloff);
  const texture = scene.textures.addDynamicTexture(key, mottle.textureSize, mottle.textureSize);
  if (!texture) return key;
  // NEAREST although the game filters linearly via `smoothPixelArt`: the stamp is scaled to
  // 0.6–4.8 cells, and linear filtering would smooth away exactly the mid-frequency detail it
  // uses to cover the tile motif.
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
  falloff.destroy();
  for (const source of sources) source.destroy();
  return key;
}

/**
 * Queues the deterministic, non-cell-aligned material stamps of one layer.
 *
 * `stamp()` instead of drawing Image objects: it pushes plain values into the texture's
 * command buffer, so a rebake of a large rock field costs no game objects at all. It also
 * ignores the render texture's camera, which is why the stamps are placed in texture-local
 * coordinates – for an arena-aligned layer that is simply grid position times `CELL_SIZE`.
 */
export function stampBlobSurfaceMottle(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.RenderTexture,
  profile: BlobSurfaceProfile,
  mottle: BlobSurfaceMottleConfig,
  cells: readonly { gridX: number; gridY: number }[],
  layerIndex = 0,
  drawOffsetX = 0,
  drawOffsetY = 0,
): void {
  if (cells.length === 0) return;
  const key = ensureBlobSurfaceMottleTexture(scene, profile, mottle, layerIndex);
  const baseScale = CELL_SIZE / mottle.textureSize;
  const layerSalt = layerIndex * 7919;
  for (const { gridX, gridY } of cells) {
    for (let passIndex = 0; passIndex < mottle.passes.length; passIndex += 1) {
      const pass = mottle.passes[passIndex];
      const guaranteed = Math.floor(pass.perCell);
      const extra = hash01(gridX, gridY, profile.seedSalt + layerSalt + passIndex * 97 + 11) < pass.perCell - guaranteed ? 1 : 0;
      for (let index = 0; index < guaranteed + extra; index += 1) {
        const salt = profile.seedSalt + layerSalt + passIndex * 997 + index * 31;
        const scale = baseScale * (pass.minScale + (pass.maxScale - pass.minScale) * hash01(gridX, gridY, salt + 1));
        layer.stamp(
          key,
          undefined,
          (gridX + hash01(gridX, gridY, salt + 2)) * CELL_SIZE + drawOffsetX,
          (gridY + hash01(gridX, gridY, salt + 3)) * CELL_SIZE + drawOffsetY,
          {
            alpha: pass.alpha,
            rotation: hash01(gridX, gridY, salt + 4) * Math.PI * 2,
            // Mirroring quadruples the distinguishable appearances of the one shared material
            // area at no texture cost. Free-floating soft-masked stamps have no seam
            // constraint, unlike the tiles themselves.
            scaleX: hash01(gridX, gridY, salt + 5) < 0.5 ? -scale : scale,
            scaleY: hash01(gridX, gridY, salt + 6) < 0.5 ? -scale : scale,
          },
        );
      }
    }
  }
}

/**
 * Maximaler Ueberstand eines Mottle-Stamps ueber seine Quellzelle hinaus.
 *
 * Dirty-Region-Bakes koennen damit Quellzellen konservativ vorfiltern, ohne wieder alle
 * Felsen der Arena zu stempeln. Die Stamp-Mitte liegt innerhalb der Zelle; der Radius ergibt
 * sich aus `maxScale * CELL_SIZE / 2` und ist unabhaengig von der Texturaufloesung.
 */
export function getBlobSurfaceMottleReachPx(profile: BlobSurfaceProfile): number {
  let maxScale = 0;
  for (const mottle of [profile.mottle, ...(profile.additionalMottleLayers ?? [])]) {
    for (const pass of mottle.passes) maxScale = Math.max(maxScale, pass.maxScale);
  }
  return maxScale * CELL_SIZE * 0.5;
}

/** Bakes and silhouette-clips the profile-selected material layers for any 47-Blob surface. */
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
  // 'redraw': the command buffer is flushed, the scratch texture itself is never drawn.
  cutout.setRenderMode('redraw');
  cutout.clear();
  cutout.fill(0x000000, 1);
  cutout.erase(silhouetteImages);
  cutout.render();

  const cutoutImage = new Phaser.GameObjects.Image(scene, bounds.offsetX, bounds.offsetY, cutout.texture.key).setOrigin(0, 0);
  const layers: Phaser.GameObjects.RenderTexture[] = [];
  for (let layerIndex = 0; layerIndex < configs.length; layerIndex += 1) {
    const mottle = configs[layerIndex];
    const layer = existingLayers[layerIndex]
      ? existingLayers[layerIndex]
      : scene.add.renderTexture(bounds.offsetX, bounds.offsetY, bounds.width, bounds.height);
    layer.setOrigin(0, 0);
    layer.setDepth(bounds.layerDepth + 0.05 + layerIndex * 0.01);
    layer.camera.setScroll(bounds.offsetX, bounds.offsetY);
    layer.setBlendMode(mottle.blend === 'multiply' ? Phaser.BlendModes.MULTIPLY : Phaser.BlendModes.NORMAL);
    layer.clear();
    stampBlobSurfaceMottle(scene, layer, profile, mottle, cells, layerIndex);
    layer.render();
    layer.erase(cutoutImage);
    layer.render();
    layers.push(layer);
  }
  cutoutImage.destroy();
  return { layers, silhouetteCutout: cutout };
}
