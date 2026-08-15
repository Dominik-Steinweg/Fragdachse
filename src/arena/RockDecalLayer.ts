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
 * Die Stanzform ist deshalb **allein die Vereinigung der Zellquadrate weggefallener Felsen** – kein
 * Silhouettenschnitt, keine Maske, keine Fels-Images. Genau diese Flaeche ist die einzige, an der
 * ein Decal-Pixel seine Unterlage verloren hat.
 *
 * Der Verzicht auf die Silhouette ist die entscheidende Eigenschaft und nicht etwa eine
 * Vereinfachung: Wuerde die Stanzform aus "alle je belegten Zellen minus lebende Silhouetten"
 * entstehen, blieben die abgerundeten Ecken und Kerben des 47-Blob-Tiles **ueberlebender** Felsen
 * als deckende Zwickel stehen. Der erste Chunk-Neubau raeumte damit Decal-Pixel im gesamten Chunk
 * weg, obwohl dort nichts zerstoert wurde – einmalig sichtbar als umspringende Optik eines ganzen
 * Nachbarbereichs, danach stabil, weil jeder weitere Neubau denselben Zustand erzeugt. Zellquadrate
 * gefallener Felsen koennen das nicht: Ein lebendes Fels-Image liegt exakt auf seiner eigenen Zelle,
 * ueberschneidet also nie das Quadrat eines gefallenen Nachbarn.
 *
 * Damit gilt fuer jedes Decal-Pixel genau eine der drei Aussagen: Es liegt auf stehendem Fels
 * (bleibt), es haengt ueber nie belegtem Boden (bleibt), oder es lag auf einem gefallenen Fels
 * (verschwindet).
 */
export function fillRockDecalCutout(
  cutout: Phaser.GameObjects.RenderTexture,
  fallenCells: readonly RockCell[],
  drawOffsetX = 0,
  drawOffsetY = 0,
): void {
  cutout.clear();
  // `fill` schreibt in Texturkoordinaten und laeuft an der Kamera vorbei – daher der ausdrueckliche
  // Zeichenversatz.
  for (const { gridX, gridY } of fallenCells) {
    cutout.fill(
      0x000000,
      1,
      gridX * CELL_SIZE + drawOffsetX,
      gridY * CELL_SIZE + drawOffsetY,
      CELL_SIZE,
      CELL_SIZE,
    );
  }
  cutout.render();
}
