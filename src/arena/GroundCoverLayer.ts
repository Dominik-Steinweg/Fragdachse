import type * as Phaser from 'phaser';
import type { GroundCoverPlacement, GroundCoverStampPlacement } from './GroundCoverField';

/**
 * Geometrie eines gebackenen Stempels.
 *
 * Die Platzierungen gehen sowohl in Chunk-Bakes als auch in den regionierten
 * TerrainColorSnapshot der gebundenen World ein.
 */
export interface DirtStamp {
  textureKey: string;
  frameName: string | number;
  x: number;
  y: number;
  displayWidth: number;
  displayHeight: number;
  rotation: number;
  alpha: number;
  /** Nur die Ground-Cover-Schicht spiegelt ihre Stempel; sonst undefiniert. */
  mirrorX?: boolean;
  mirrorY?: boolean;
}

/**
 * Backt die Ground-Cover-Platzierungen in eine einzige RenderTexture – gemeinsame Grundlage von
 * Arena und LobbyWorld ({@link ./ArenaBuilder}); beide bauen dieselbe Schicht.
 */

export interface GroundCoverBakeBounds {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export interface GroundCoverBakeResult {
  layer: Phaser.GameObjects.RenderTexture | null;
  /** Geometrie fuer den TerrainColorSnapshot; die Stempel existieren nicht als Objekte. */
  stamps: DirtStamp[];
}

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
    const frame = scene.textures.getFrame(placement.textureKey);
    if (!frame) continue;
    const scale = placement.sizePx / Math.max(frame.width, frame.height) * renderScale;
    layer.stamp(placement.textureKey, undefined, placement.worldX * renderScale + drawOffsetX, placement.worldY * renderScale + drawOffsetY, {
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

export function bakeGroundCoverLayer(
  scene: Phaser.Scene,
  placements: readonly GroundCoverPlacement[],
  bounds: GroundCoverBakeBounds,
  depth: number,
  layerAlpha = 1,
): GroundCoverBakeResult {
  if (placements.length === 0 || layerAlpha <= 0) return { layer: null, stamps: [] };

  const layer = scene.add.renderTexture(bounds.offsetX, bounds.offsetY, bounds.width, bounds.height);
  layer.setOrigin(0, 0);
  layer.setDepth(depth);
  layer.camera.setScroll(bounds.offsetX, bounds.offsetY);

  const stamps: DirtStamp[] = [];
  for (const placement of placements) {
    const frame = scene.textures.getFrame(placement.textureKey);
    if (!frame) continue;
    const scale = placement.sizePx / Math.max(frame.width, frame.height);
    // Die Ebenendeckkraft geht auf jeden einzelnen Stempel, nie auf die fertige RenderTexture.
    // Begruendung: "over" ist assoziativ, pro Stempel
    // bleibt das Ergebnis pixelgleich zum ungebackenen Zustand, waehrend eine Alpha auf dem Layer
    // genau die Ueberlappungen anders gewichten wuerde, auf die es hier ankommt.
    const alpha = placement.alpha * layerAlpha;
    // `stamp()` schreibt reine Werte in den Kommandopuffer und erzeugt kein Game-Object, laeuft
    // dafuer aber an der Kamera der RenderTexture vorbei – die Koordinaten sind texturlokal.
    layer.stamp(placement.textureKey, undefined, placement.worldX - bounds.offsetX, placement.worldY - bounds.offsetY, {
      alpha,
      rotation: placement.rotation,
      scaleX: placement.mirrorX ? -scale : scale,
      scaleY: placement.mirrorY ? -scale : scale,
    });
    stamps.push({
      textureKey: placement.textureKey,
      frameName: frame.name,
      x: placement.worldX,
      y: placement.worldY,
      displayWidth: frame.width * scale,
      displayHeight: frame.height * scale,
      rotation: placement.rotation,
      alpha,
      mirrorX: placement.mirrorX,
      mirrorY: placement.mirrorY,
    });
  }
  layer.render();

  return { layer, stamps };
}
