import * as Phaser from 'phaser';
import type { RockVegetationPlacement } from './RockVegetationField';

/**
 * Backen und Silhouettenschnitt der Fels-Vegetationsschicht.
 *
 * Der Schnitt ist der Kern dieser Datei und arbeitet wie bei {@link ./RockMossLayer}, nur mit der
 * *Reichweiten*maske statt der Verlaufsmaske:
 *
 * - Die Stanzform startet vollflaechig deckend und wird von den Maskenbildern ausradiert. Ihre
 *   Deckkraft ist danach `1 - Maskenalpha`.
 * - Das anschliessende `layer.erase(stanzform)` multipliziert die Vegetation also genau mit dem
 *   Maskenalpha: ueber dem Fels 1, wenige Pixel darueber hinaus noch 1, danach auslaufend auf 0.
 *
 * Daran haengt das gesamte Zerstoerungsverhalten der Schicht, und zwar ohne eine einzige Zeile
 * Zerstoerungslogik: Die Matten selbst werden nie neu ausgewuerfelt (siehe
 * {@link ./RockVegetationField}). Faellt ein Fels, verschwindet aus seinem Maskensatz genau ein
 * Frame, und damit exakt der Teil der Matte, der ueber dieser Zelle lag. Die Nachbarn behalten
 * ihre eigenen Frames, ihr Teil der Matte bleibt Pixel fuer Pixel derselbe – und weil ihre Maske
 * ueber die eigene Kante hinausreicht, franst die Matte an der neu entstandenen Grenze aus, statt
 * dort abgeschnitten zu werden.
 */

export interface RockVegetationBakeBounds {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export interface RockVegetationBakeResult {
  layer: Phaser.GameObjects.RenderTexture | null;
  cutout: Phaser.GameObjects.RenderTexture | null;
}

/**
 * Legt die Stanzform an: vollflaechig deckend, abzueglich der Reichweitenmasken der stehenden
 * Felsen. Ohne Masken bleibt sie ueberall deckend und loescht die Vegetation vollstaendig – der
 * richtige Zustand fuer einen leergeraeumten Bestand.
 */
export function fillRockVegetationCutout(
  cutout: Phaser.GameObjects.RenderTexture,
  maskImages: readonly Phaser.GameObjects.Image[],
): void {
  cutout.clear();
  cutout.fill(0x000000, 1);
  if (maskImages.length > 0) cutout.erase(maskImages);
  cutout.render();
}

/**
 * Setzt die Matten eines Platzierungssatzes in texturlokalen Koordinaten ab.
 *
 * `stamp()` schreibt reine Werte in den Kommandopuffer und erzeugt kein Game-Object, laeuft dafuer
 * aber an der Kamera der RenderTexture vorbei – daher der ausdrueckliche Zeichenversatz.
 *
 * Laenge und Bandhoehe werden getrennt skaliert. Die Bandhoehe ist ueber die gesamte Karte gleich,
 * damit der Bewuchs als eine Schicht liest; die Laenge folgt dem Kantenlauf. Die Groessenklassen
 * der Vorlagen halten den Unterschied beider Faktoren klein (siehe `RockVegetationConfig`).
 */
export function stampRockVegetation(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.RenderTexture,
  placements: readonly RockVegetationPlacement[],
  drawOffsetX: number,
  drawOffsetY: number,
  layerAlpha = 1,
): void {
  for (const placement of placements) {
    const frame = scene.textures.getFrame(placement.textureKey);
    if (!frame) continue;
    const scaleX = placement.lengthPx / frame.width;
    layer.stamp(placement.textureKey, undefined, placement.worldX + drawOffsetX, placement.worldY + drawOffsetY, {
      alpha: placement.alpha * layerAlpha,
      rotation: placement.rotation,
      scaleX: placement.mirrorX ? -scaleX : scaleX,
      scaleY: placement.bandPx / frame.height,
    });
  }
}

/**
 * Backt die gesamte Vegetationsschicht neu.
 *
 * Layer und Stanzform werden bewusst wiederverwendet statt neu erzeugt: Beide sind arenagross,
 * und sie bei jeder Hindernisaenderung neu zu allokieren waere auf den breiten Karten ein
 * spuerbarer Ruckler – dieselbe Ueberlegung wie bei den Fels-Mottle- und Moos-Layern.
 */
export function bakeRockVegetationLayer(
  scene: Phaser.Scene,
  placements: readonly RockVegetationPlacement[],
  maskImages: readonly Phaser.GameObjects.Image[],
  bounds: RockVegetationBakeBounds,
  depth: number,
  existing: RockVegetationBakeResult = { layer: null, cutout: null },
  layerAlpha = 1,
): RockVegetationBakeResult {
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
  fillRockVegetationCutout(cutout, maskImages);

  const layer = existing.layer ?? scene.add.renderTexture(bounds.offsetX, bounds.offsetY, bounds.width, bounds.height);
  layer.setOrigin(0, 0);
  layer.setDepth(depth);
  // Dieselbe Koordinatengrenze wie bei Moos: GameObject-Position traegt den Arena-Offset,
  // Texturinhalt und Regional-Rebuild bleiben dauerhaft lokal.
  layer.camera.setScroll(0, 0);
  layer.clear();
  stampRockVegetation(scene, layer, placements, -bounds.offsetX, -bounds.offsetY, layerAlpha);
  layer.render();

  layer.erase(cutout.texture.key, bounds.width * 0.5, bounds.height * 0.5);
  layer.render();

  return { layer, cutout };
}
