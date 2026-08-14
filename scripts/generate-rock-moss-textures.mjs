import sharp from 'sharp';
import * as path from 'path';
import { chamferDistance, clamp01, runOrganicCoverPipeline, smoothstep } from './lib/organic-cover-pipeline.mjs';

/**
 * Erzeugt beide Bestandteile der Fels-Moos-Schicht (siehe `src/arena/RockMossLayer.ts`):
 *
 * 1. Die Moosflecken selbst, ueber dieselbe Strecke wie der Ground Cover.
 * 2. `rocks47blob_mossmask.png` – die Verlaufsmaske, die das Moos an der jeweils aktuellen
 *    Aussenkante des Felsbestands weich auslaufen laesst.
 *
 * Warum die Maske ein zweites 47-Blob-Sheet ist und nicht zur Laufzeit aus der Silhouette
 * erodiert wird: Erosion ist nicht distributiv ueber die Vereinigung. Jede 32-px-Kachel einzeln
 * zu schrumpfen ergaebe an *jeder* inneren Kachelgrenze einen Verlauf – also genau das 32-px-
 * Raster, das hier verschwinden soll. Die Autotile-Frames wissen dagegen bereits, welche ihrer
 * Kanten offen sind: Eine geschlossene Kante ist bis zum Kachelrand deckend und bekommt keinen
 * Verlauf, eine offene faellt innerhalb der Kachel auf null. Ein Distanzfeld je Frame liefert
 * damit exakt den Abstand zur echten Aussenkante des Verbunds. Gemessen sind 64,8 % der
 * Kantenmitten des Fels-Sheets voll deckend und 27,3 % vollstaendig offen; nur rund 8 % liegen
 * im weichen Band, und die liegen an echten Uebergaengen.
 *
 * Weil die Maske am selben Autotile-Index haengt wie der Fels, passt sie sich ohne Zusatzarbeit
 * an: Faellt ein Nachbar weg, waehlt das bestehende Retiling einen Frame mit offener Kante, und
 * der Verlauf entsteht dort von selbst.
 *
 * Aufruf: node scripts/generate-rock-moss-textures.mjs [--contact-sheet]
 */

const SOURCE_DIR = path.join('tools', 'source-art', 'rockmoss');
const SPRITE_DIR = path.join('public', 'assets', 'sprites');
const ROCK_SHEET = path.join(SPRITE_DIR, 'rocks47blob.png');
const MASK_SHEET = path.join(SPRITE_DIR, 'rocks47blob_mossmask.png');

/** Kantenlaenge eines Autotile-Frames. Entspricht `CELL_SIZE` im Spiel. */
const FRAME_SIZE = 32;
/**
 * Breite des Randverlaufs in Pixeln, bei 32-px-Kacheln also gut ein Fuenftel der Kachel. Die
 * Maske wird 1:1 gezeichnet, der Wert ist damit direkt die Zahl der Bildschirmpixel. Deutlich
 * breiter, und das Moos verschwaende auf einzeln stehenden Felsen vollstaendig.
 */
const MASK_FADE_PX = 7;
/**
 * Alphaschwelle, ab der ein Pixel als Fels gilt. Bewusst hoch genug, dass das Antialiasing einer
 * geschlossenen Kante keinen Verlauf ausloest, und niedrig genug, dass eine echte offene Kante
 * sicher greift.
 */
const MASK_SEED_THRESHOLD = 128;

const PROFILE = {
  sourceDir: SOURCE_DIR,
  outDir: path.join(SPRITE_DIR, 'rockmoss'),
  outPrefix: 'rock_moss_',
  contactSheet: path.join(SOURCE_DIR, '_preview.png'),
  /** Farbbezug ist der Fels selbst – nur deckende Pixel zaehlen, das Sheet hat Alpha. */
  gradeTargetFile: ROCK_SHEET,

  longSide: 384,
  silhouetteThreshold: 128,
  trimThreshold: 3,
  rgbBleedPx: 12,

  /**
   * Schmalere Feder als beim Ground Cover. Dort loest die Feder die Kante im offenen Gelaende
   * auf; hier uebernimmt das die Silhouettenmaske am Felsrand, und eine zusaetzlich breite
   * Eigenfeder wuerde die Flecken auf der kleinen Felsflaeche nur blass machen.
   */
  featherFraction: 0.3,
  featherScalePercentile: 0.85,
  featherFloorFraction: 0.06,
  alphaRampGamma: 0.7,

  edgeNoiseAmplitude: 0.35,
  edgeNoiseWavelengthFraction: 0.1,

  holeOctaves: [
    { wavelength: 0.26, amp: 1.0 },
    { wavelength: 0.13, amp: 0.5 },
    { wavelength: 0.065, amp: 0.25 },
  ],
  holeThreshold: 0.42,
  holeSoftness: 0.18,
  interiorAlphaFloor: 0.35,
  holeDepthRamp: 2.0,

  /**
   * Schwaecher als beim Ground Cover (0,25). Die Referenzfarbe des Felsens ist mit 44,60,68
   * blaustichig; ein kraeftiger Zug dorthin nimmt dem Moos genau die Gruenidentitaet, die es
   * vom Untergrund unterscheidbar macht. 0,20 bindet es farblich an den Stein, ohne es in
   * Graugruen zu kippen.
   */
  gradeStrength: 0.2,
  seed: 20260815,
};

/**
 * Baut die Verlaufsmaske frameweise aus dem Fels-Sheet.
 *
 * Das Distanzfeld wird ausschliesslich aus Pixeln unterhalb der Alphaschwelle gesaet. Ein Frame
 * ohne solche Pixel – der vollstaendig umbaute Fall – bekommt damit gar keinen Verlauf, und eine
 * geschlossene Kante bleibt bis zum Kachelrand deckend. Genau daran haengt, dass benachbarte
 * Kacheln nahtlos ineinander uebergehen.
 */
async function writeMaskSheet() {
  const { data, info } = await sharp(ROCK_SHEET).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cols = info.width / FRAME_SIZE;
  const rows = info.height / FRAME_SIZE;
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) {
    throw new Error(`${ROCK_SHEET} ist kein Vielfaches von ${FRAME_SIZE}px`);
  }

  const out = Buffer.alloc(info.width * info.height * 4);
  const seeds = new Uint8Array(FRAME_SIZE * FRAME_SIZE);
  let fadedFrames = 0;

  for (let frameY = 0; frameY < rows; frameY += 1) {
    for (let frameX = 0; frameX < cols; frameX += 1) {
      const originX = frameX * FRAME_SIZE;
      const originY = frameY * FRAME_SIZE;
      let hasSeed = false;
      for (let y = 0; y < FRAME_SIZE; y += 1) {
        for (let x = 0; x < FRAME_SIZE; x += 1) {
          const open = data[((originY + y) * info.width + originX + x) * 4 + 3] < MASK_SEED_THRESHOLD;
          seeds[y * FRAME_SIZE + x] = open ? 1 : 0;
          if (open) hasSeed = true;
        }
      }
      if (hasSeed) fadedFrames += 1;

      const distance = hasSeed ? chamferDistance(seeds, FRAME_SIZE, FRAME_SIZE) : null;
      for (let y = 0; y < FRAME_SIZE; y += 1) {
        for (let x = 0; x < FRAME_SIZE; x += 1) {
          const target = ((originY + y) * info.width + originX + x) * 4;
          const value = distance === null
            ? 1
            : smoothstep(clamp01(distance[y * FRAME_SIZE + x] / MASK_FADE_PX));
          // RGB bleibt weiss: Die Maske wird ausschliesslich als Alphaquelle fuer `erase()`
          // benutzt und nie selbst sichtbar gezeichnet.
          out[target] = 255;
          out[target + 1] = 255;
          out[target + 2] = 255;
          out[target + 3] = Math.round(value * 255);
        }
      }
    }
  }

  await sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(MASK_SHEET);
  console.log(`${path.basename(MASK_SHEET)}: ${info.width}x${info.height}, ${cols * rows} Frames `
    + `(${fadedFrames} mit Randverlauf), Feder ${MASK_FADE_PX}px`);
}

async function main() {
  await runOrganicCoverPipeline(PROFILE);
  await writeMaskSheet();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
