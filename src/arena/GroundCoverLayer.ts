import type * as Phaser from 'phaser';
import type { GroundCoverPlacement } from './GroundCoverField';
import type { DirtStamp } from './ArenaBuilder';

/**
 * Backt die Ground-Cover-Platzierungen in eine einzige RenderTexture – gemeinsame Grundlage von
 * Arena ({@link ./ArenaBuilder}) und Lobby-Vorschau ({@link ./MenuArenaPreviewRenderer}).
 */

export interface GroundCoverBakeBounds {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export interface GroundCoverBakeResult {
  layer: Phaser.GameObjects.RenderTexture | null;
  /** Geometrie fuer den Terrain-Farb-Sampler; die Stempel existieren nicht als Objekte. */
  stamps: DirtStamp[];
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
    // Begruendung wie bei `MenuArenaPreviewRenderer.bakeLayer`: "over" ist assoziativ, pro Stempel
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
