import { runtimeTextureFrame, runtimeTextureKey, runtimeFrameName } from '../assets/RuntimeAtlases';
import type * as Phaser from 'phaser';
import type { GroundCoverStampPlacement } from './GroundCoverField';

/**
 * Setzt einen Platzierungssatz in texturlokalen Koordinaten ab.
 *
 * `stamp()` schreibt reine Werte in den Kommandopuffer und erzeugt kein Game-Object, laeuft dafuer
 * aber an der Kamera der RenderTexture vorbei – daher der ausdrueckliche Zeichenversatz. Die
 * Ebenendeckkraft geht auf jeden einzelnen Stempel, nie auf die fertige RenderTexture: "over" ist
 * assoziativ, pro Stempel bleibt das Ergebnis damit pixelgleich zum ungebackenen Zustand, waehrend
 * eine Alpha auf dem Layer genau die Ueberlappungen anders gewichten wuerde, auf die es hier
 * ankommt.
 */
export function stampGroundCover(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.RenderTexture,
  placements: readonly GroundCoverStampPlacement[],
  drawOffsetX: number,
  drawOffsetY: number,
  layerAlpha = 1,
  renderScale = 1,
): void {
  for (const placement of placements) {
    const frame = runtimeTextureFrame(scene.textures, placement.textureKey);
    if (!frame) continue;
    const scale = placement.sizePx / Math.max(frame.width, frame.height) * renderScale;
    layer.stamp(runtimeTextureKey(placement.textureKey), runtimeFrameName(placement.textureKey), placement.worldX * renderScale + drawOffsetX, placement.worldY * renderScale + drawOffsetY, {
      alpha: placement.alpha * layerAlpha,
      rotation: placement.rotation,
      scaleX: placement.mirrorX ? -scale : scale,
      scaleY: placement.mirrorY ? -scale : scale,
    });
  }
}

/** Groesste Ausdehnung einer Platzierung ueber ihren Mittelpunkt hinaus. */
export function getGroundCoverPlacementRadiusPx(placement: GroundCoverStampPlacement): number {
  return placement.sizePx * Math.SQRT1_2;
}
