import * as Phaser from 'phaser';
import type { RockMossPlacement } from './RockMossField';

/**
 * Backen und Silhouettenschnitt der Fels-Moos-Schicht.
 *
 * Der Schnitt ist der Kern dieser Datei. Das Moos wird frei ueber den Felsbestand gestempelt und
 * anschliessend mit einer Stanzform beschnitten, die aus der Verlaufsmaske des Fels-Autotiles
 * entsteht:
 *
 * - Die Stanzform startet vollflaechig deckend und wird von den Maskenbildern ausradiert. Ihre
 *   Deckkraft ist danach `1 - Maskenalpha`.
 * - Das anschliessende `mossLayer.erase(stanzform)` multipliziert das Moos also genau mit dem
 *   Maskenalpha: aussen 0, an der Felskante ansteigend, im Inneren 1.
 *
 * Damit ist beides gleichzeitig erfuellt – Moos erscheint nur auf noch stehendem Fels, und es
 * laeuft an der Aussenkante ueber einige Pixel weich aus statt an der Kachelgrenze abzureissen.
 * Der Verlauf folgt immer der *aktuellen* Silhouette, weil die Maskenframes am selben
 * Autotile-Index haengen wie die Felsen selbst.
 */

export interface RockMossBakeBounds {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export interface RockMossBakeResult {
  layer: Phaser.GameObjects.RenderTexture | null;
  cutout: Phaser.GameObjects.RenderTexture | null;
}

/**
 * Legt die Stanzform an: vollflaechig deckend, abzueglich der Verlaufsmasken der stehenden Felsen.
 * Ohne Masken bleibt sie ueberall deckend und loescht das Moos vollstaendig – der richtige
 * Zustand fuer einen leergeraeumten Bestand.
 */
export function fillRockMossCutout(
  cutout: Phaser.GameObjects.RenderTexture,
  maskImages: readonly Phaser.GameObjects.Image[],
): void {
  cutout.clear();
  cutout.fill(0x000000, 1);
  if (maskImages.length > 0) cutout.erase(maskImages);
  cutout.render();
}

/**
 * Setzt die Stempel eines Flecksatzes in texturlokalen Koordinaten ab.
 *
 * `stamp()` schreibt reine Werte in den Kommandopuffer und erzeugt kein Game-Object, laeuft dafuer
 * aber an der Kamera der RenderTexture vorbei – daher der ausdrueckliche Zeichenversatz.
 */
export function stampRockMoss(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.RenderTexture,
  placements: readonly RockMossPlacement[],
  drawOffsetX: number,
  drawOffsetY: number,
  layerAlpha = 1,
): void {
  for (const placement of placements) {
    const frame = scene.textures.getFrame(placement.textureKey);
    if (!frame) continue;
    const scale = placement.sizePx / Math.max(frame.width, frame.height);
    layer.stamp(placement.textureKey, undefined, placement.worldX + drawOffsetX, placement.worldY + drawOffsetY, {
      alpha: placement.alpha * layerAlpha,
      rotation: placement.rotation,
      scaleX: placement.mirrorX ? -scale : scale,
      scaleY: placement.mirrorY ? -scale : scale,
    });
  }
}

/**
 * Backt die gesamte Moosschicht neu.
 *
 * Layer und Stanzform werden bewusst wiederverwendet statt neu erzeugt: Beide sind arenagross,
 * und sie bei jeder Hindernisaenderung neu zu allokieren waere auf den breiten Karten ein
 * spuerbarer Ruckler – dieselbe Ueberlegung wie bei den Fels-Mottle-Layern.
 */
export function bakeRockMossLayer(
  scene: Phaser.Scene,
  placements: readonly RockMossPlacement[],
  maskImages: readonly Phaser.GameObjects.Image[],
  bounds: RockMossBakeBounds,
  depth: number,
  existing: RockMossBakeResult = { layer: null, cutout: null },
  layerAlpha = 1,
): RockMossBakeResult {
  if (placements.length === 0) {
    existing.layer?.clear();
    return existing;
  }

  const cutout = existing.cutout ?? scene.add.renderTexture(bounds.offsetX, bounds.offsetY, bounds.width, bounds.height);
  cutout.setOrigin(0, 0);
  cutout.setDepth(depth);
  cutout.camera.setScroll(bounds.offsetX, bounds.offsetY);
  // 'redraw': Der Kommandopuffer wird geleert, die Stanzform selbst nie gezeichnet.
  cutout.setRenderMode('redraw');
  fillRockMossCutout(cutout, maskImages);

  const layer = existing.layer ?? scene.add.renderTexture(bounds.offsetX, bounds.offsetY, bounds.width, bounds.height);
  layer.setOrigin(0, 0);
  layer.setDepth(depth);
  // Die sichtbare RenderTexture steht bereits am Arena-Offset; ihr Inhalt bleibt wie beim
  // regionalen Scratch-Rebuild texturlokal. Andernfalls springt die Moosstruktur beim ersten
  // Chunk-Neubau um denselben vertikalen Offset.
  layer.camera.setScroll(0, 0);
  layer.clear();
  stampRockMoss(scene, layer, placements, -bounds.offsetX, -bounds.offsetY, layerAlpha);
  layer.render();

  layer.erase(cutout.texture.key, bounds.width * 0.5, bounds.height * 0.5);
  layer.render();

  return { layer, cutout };
}
