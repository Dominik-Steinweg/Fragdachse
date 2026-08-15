import type * as Phaser from 'phaser';
import { CELL_SIZE } from '../config';
import type { RockCell } from '../types';

/**
 * Stanzform der Fels-Decals.
 *
 * Fels-Decals sind das einzige felsgebundene Overlay, das die Felskante absichtlich ueberragt: Ein
 * Moosfransen- oder Farn-Decal auf einer Randzelle haengt ein paar Pixel auf den Boden hinaus. Ein
 * Schnitt an der reinen Silhouette – wie ihn Materialstoerung, Moos und Vegetation benutzen –
 * wuerde diesen Ueberhang ueberall abschneiden und damit auch dort das Bild aendern, wo sich gar
 * nichts zerstoert hat.
 *
 * Die Stanzform deckt deshalb genau die Differenz ab: **wo einmal Fels stand und jetzt keiner mehr
 * steht.** Sie entsteht aus Rechtecken ueber allen je belegten Felszellen, aus denen die Bilder der
 * noch stehenden Felsen wieder ausradiert werden. Uebrig bleibt die Flaeche gefallener Felsen –
 * einschliesslich der schmalen Zwickel, die das Autotiling an den Ecken ueberlebender Nachbarn
 * abrundet.
 *
 * Damit gilt fuer jedes Decal-Pixel genau eine der drei Aussagen: Es liegt auf stehendem Fels
 * (bleibt), es haengt ueber nie belegtem Boden (bleibt), oder es lag auf einem gefallenen Fels
 * (verschwindet). Ein Decal muss deshalb nicht mehr komplett verworfen werden, sobald einer seiner
 * Traegerfelsen faellt.
 */
export function fillRockDecalCutout(
  cutout: Phaser.GameObjects.RenderTexture,
  sourceCells: readonly RockCell[],
  activeRocks: readonly Phaser.GameObjects.Image[],
  drawOffsetX = 0,
  drawOffsetY = 0,
): void {
  cutout.clear();
  // `fill` schreibt in Texturkoordinaten und laeuft an der Kamera vorbei – daher der ausdrueckliche
  // Zeichenversatz, waehrend `erase` die Weltposition der Fels-Images ueber die Kamera aufloest.
  for (const { gridX, gridY } of sourceCells) {
    cutout.fill(
      0x000000,
      1,
      gridX * CELL_SIZE + drawOffsetX,
      gridY * CELL_SIZE + drawOffsetY,
      CELL_SIZE,
      CELL_SIZE,
    );
  }
  if (activeRocks.length > 0) cutout.erase(activeRocks);
  cutout.render();
}
