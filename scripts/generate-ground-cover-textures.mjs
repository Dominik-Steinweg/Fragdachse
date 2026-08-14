import * as path from 'path';
import { runOrganicCoverPipeline } from './lib/organic-cover-pipeline.mjs';

/**
 * Erzeugt die Ground-Cover-Texturen: grosse, moosige Flecken, die in der Arena ueber der
 * Dirt/Gras-Grenze liegen (siehe `src/arena/GroundCoverLayer.ts`).
 *
 * Die eigentliche Aufbereitung steht in `lib/organic-cover-pipeline.mjs`; hier liegen nur die
 * Werte, die diese Texturmenge von der Fels-Moos-Menge unterscheiden.
 *
 * Die braunen Adern der Vorlagen bleiben bewusst erhalten. Gemessen liegen sie mit Rec.709-Luma
 * 66-77 fast exakt auf der Luma der Graskachel (70,8) und deutlich unter der des Dirt-Bodens
 * (84,4). Auf Gras wirken sie damit als reine Farbtonverschiebung, auf Dirt als klar lesbare
 * Abdunklung – und die Adern sind der einzige Bildinhalt, der den Fleck an die Dirt-Seite bindet.
 * Der Farbangleich zieht deshalb nur schwach zur Grasfarbe.
 *
 * Aufruf: node scripts/generate-ground-cover-textures.mjs [--contact-sheet]
 */

const SOURCE_DIR = path.join('tools', 'source-art', 'groundcover');

const PROFILE = {
  sourceDir: SOURCE_DIR,
  outDir: path.join('public', 'assets', 'sprites', 'groundcover'),
  outPrefix: 'ground_cover_',
  contactSheet: path.join(SOURCE_DIR, '_preview.png'),
  /** Farbbezug ist die Graskachel: Der Fleck soll zum Untergrund gehoeren, auf dem er meistens liegt. */
  gradeTargetFile: path.join('public', 'assets', 'sprites', 'gras_bg_tile.png'),

  /**
   * Laengere Ausgabekante. Das Spiel laeuft mit `smoothPixelArt: true`, was global lineare
   * Filterung erzwingt, aber **keine** Mipmaps anlegt (`mipmapFilter` bleibt leer). Minifizierung
   * ueber etwa das 2,5-fache faengt deshalb an zu flimmern. Die Flecken werden mit 96-352 px
   * gestempelt, 384 px Quellkante haelt den Faktor unter 2,4.
   */
  longSide: 384,
  /** Alphaschwelle, die die Silhouette definiert – die gemessene Mitte der bimodalen Verteilung. */
  silhouetteThreshold: 128,
  /** Schwelle fuer die Zuschnitte. Bewusst niedriger, damit die Feder nicht abgeschnitten wird. */
  trimThreshold: 3,
  /**
   * Reichweite, mit der Innenfarbe nach aussen gedrueckt wird. Die Vorlagen tragen im aeusseren
   * 8-px-Band einen warmen Saum (R-G etwa +11 gegen -8 im Kern).
   */
  rgbBleedPx: 12,

  /**
   * Federbreite als Anteil der typischen Merkmalsdicke. Das ist der eine Wert, der ueber
   * "Aufkleber" gegen "loest sich auf" entscheidet.
   */
  featherFraction: 0.45,
  /**
   * Bezugsgroesse der Feder ist das 85. Perzentil der Innenabstaende, nicht deren Maximum. Das
   * Maximum ist der eine dickste Punkt der Form; bei einer duennen Sichel liegt fast die gesamte
   * Flaeche weit darunter, und eine daran bemessene Feder loescht sie vollstaendig aus.
   */
  featherScalePercentile: 0.85,
  /** Totzone ganz aussen. Ohne sie legt sich ein flaechiger Hauch exakt auf die alte Kontur. */
  featherFloorFraction: 0.06,
  /**
   * Exponent der Alpharampe. Konkav (< 1): steigt schnell an und flacht dann ab. Ohne ihn bliebe
   * bei dieser Federbreite nur ein Bruchteil der Flaeche nahe voller Deckkraft.
   */
  alphaRampGamma: 0.7,

  /** Anteil der Federbreite, um den die Rampenlage lokal wandert. */
  edgeNoiseAmplitude: 0.35,
  /** Wellenlaenge des Kantenrauschens als Anteil der laengeren Bildkante. */
  edgeNoiseWavelengthFraction: 0.1,

  /** fBm des Innenfeldes; Wellenlaengen als Anteil der laengeren Bildkante. */
  holeOctaves: [
    { wavelength: 0.26, amp: 1.0 },
    { wavelength: 0.13, amp: 0.5 },
    { wavelength: 0.065, amp: 0.25 },
  ],
  /** Etwa 40 % des Inneren werden zur Untergrenze gezogen. */
  holeThreshold: 0.42,
  /** Bewusst weich – harte Lochraender waeren derselbe Aufkleber-Effekt eine Groessenordnung kleiner. */
  holeSoftness: 0.18,
  /** Loecher perforieren nie vollstaendig, der Fleck bleibt ein Koerper statt einer Spitzendecke. */
  interiorAlphaFloor: 0.35,
  /**
   * Tiefe, ab der die Perforation voll wirkt, als Vielfaches der Federbreite. Duenne Auslaeufer
   * liegen vollstaendig innerhalb ihrer eigenen Feder; wuerde das Lochfeld dort ebenso angreifen,
   * blieben von ihnen nur Fetzen uebrig. Loecher gehoeren in breite Flaechen.
   */
  holeDepthRamp: 2.0,

  /** Wie weit die Moosfarbe zur mittleren Grasfarbe gezogen wird – luma-erhaltend. */
  gradeStrength: 0.25,
  seed: 20260814,
};

runOrganicCoverPipeline(PROFILE).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
