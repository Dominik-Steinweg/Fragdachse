import sharp from 'sharp';
import * as fs from 'node:fs/promises';
import * as path from 'path';
import {
  alphaBounds,
  bleedRgb,
  chamferDistance,
  clamp01,
  cropRgba,
  listNumberedSources,
  mulberry32,
  smoothstep,
  valueNoiseField,
} from './lib/organic-cover-pipeline.mjs';

/**
 * Erzeugt beide Bestandteile der Fels-Vegetationsschicht (siehe
 * `src/arena/RockVegetationLayer.ts`):
 *
 * 1. Die Quellmatten als **vorgeschnittene Groessenklassen**. Die Vorlagen sind breite, an allen
 *    Seiten ausgefranste Baender; im Spiel werden sie entlang freier Felskanten abgesetzt. Ein
 *    zur Laufzeit beliebig gewaehlter Ausschnitt haette an seinen Schnittkanten eine gerade,
 *    senkrechte Blattkante – auf dem Fels sofort als Aufkleber erkennbar. Der Schnitt passiert
 *    deshalb hier, wo die Enden anschliessend weich auslaufen koennen. Drei Klassen decken die
 *    Kantenlaengen ab, ohne die Matten sichtbar zu stauchen (Faktoren rund 0,7 bis 1,4).
 * 2. `rocks47blob_vegmask.png` – die Reichweitenmaske, die die Vegetation auf den aktuellen
 *    Felsbestand beschneidet und sie dabei ein Stueck **ueber** die Felskante hinauslaufen laesst.
 *
 * Warum die Maske ein zweites 47-Blob-Sheet ist, steht ausfuehrlich in
 * `generate-rock-moss-textures.mjs`: Der Autotile-Frame weiss bereits, welche seiner Kanten offen
 * sind, und nur deshalb entsteht der Verlauf an der echten Aussenkante des Verbunds statt an jeder
 * inneren Kachelgrenze. Der Unterschied zur Moosmaske ist die Richtung: Dort faellt die Deckung
 * von der offenen Kante nach innen ab, hier ist der Fels vollstaendig deckend und die Maske waechst
 * nach aussen ueber ihn hinaus. Ein Frame dieses Sheets ist deshalb doppelt so gross wie eine
 * Zelle und liegt zentriert ueber ihr.
 *
 * Aufruf: node scripts/generate-rock-vegetation-textures.mjs
 */

const SOURCE_DIR = path.join('tools', 'source-art', 'rockvegetation');
const SPRITE_DIR = path.join('public', 'assets', 'sprites');
const OUT_DIR = path.join(SPRITE_DIR, 'rockvegetation');
const ROCK_SHEET = path.join(SPRITE_DIR, 'rocks47blob.png');
const MASK_SHEET = path.join(SPRITE_DIR, 'rocks47blob_vegmask.png');

/** Kantenlaenge eines Autotile-Frames. Entspricht `CELL_SIZE` im Spiel. */
const FRAME_SIZE = 32;
/**
 * Ein Maskenframe ist doppelt so gross wie seine Zelle und liegt zentriert darueber. Der Rand von
 * 16 px ist die harte Obergrenze fuer die Reichweite nach aussen.
 */
const MASK_FRAME_SIZE = FRAME_SIZE * 2;
/** Bis hierher bleibt die Maske ausserhalb des Felsens voll deckend. */
const MASK_HOLD_PX = 4;
/** Ab hier ist sie vollstaendig offen. Muss unter dem Frame-Rand von 16 px bleiben. */
const MASK_REACH_PX = 15;
const MASK_SEED_THRESHOLD = 128;

/**
 * Bezugshoehe der Matte im Spiel, quer zur Felskante. Die Klassen leiten ihr Seitenverhaeltnis
 * daraus ab, das Spiel streut die tatsaechliche Bandhoehe darum herum
 * (`ROCK_VEGETATION_CONFIG.minBandPx`/`maxBandPx`). Der Wert gehoert deshalb in die Mitte dieses
 * Bereichs, sonst steht jede Matte im Spiel dauerhaft gestaucht oder gezogen.
 */
const BAND_PX = 40;
/** Aufloesungsreserve gegenueber der Bildschirmgroesse, wie bei den Moosflecken (384 px Langseite). */
const AUTHOR_SCALE = 1.5;
const CELL_PX = 32;

/**
 * Die Groessenklassen. `cells` ist die native Laenge in Felszellen – die Laenge, bei der die Matte
 * unverzerrt steht. Die Bereiche im Spiel (`RockVegetationConfig`) sind so gewaehlt, dass der
 * Streckfaktor darum herum klein bleibt.
 */
const CLASSES = [
  { name: 'small', cells: 1.5 },
  { name: 'mid', cells: 3.5 },
  { name: 'large', cells: 8 },
];

/** Anteil der Ausschnittbreite, ueber den die Laengsenden auslaufen. */
const END_FEATHER_FRACTION = 0.16;
/**
 * Ab welchem Anteil der Bandhoehe die Innenseite auszufransen beginnt. Darueber liegt die volle
 * Deckung: die gewachsene Franse und der dichte Koerper der Vorlage.
 */
const INNER_DISSOLVE_START = 0.58;
/**
 * Staerke, mit der das Rauschen die Aufloesungsgrenze verschiebt, als Anteil der Restlaenge. Ohne
 * sie liefe die Innenkante als gerade Linie parallel zur Felskante – im Spiel genau der
 * Rahmen-Eindruck, den die Schicht vermeiden soll.
 */
const INNER_DISSOLVE_NOISE = 0.8;
/** Wellenlaengen des Aufloesungsrauschens in Ausgabepixeln: grosse Lappen, feine Auslaeufer. */
const INNER_DISSOLVE_WAVELENGTHS = [46, 17];
const TRIM_THRESHOLD = 3;
const RGB_BLEED_PX = 12;
const SEED = 20260815;

/**
 * Waehlt den Ausschnitt einer Vorlage fuer eine Groessenklasse.
 *
 * Passt das geforderte Seitenverhaeltnis in die volle Hoehe der Vorlage, bleibt sie ungeschnitten:
 * beide Laengsseiten behalten ihre gewachsene Franse. Fuer die langen Matten reicht das Verhaeltnis
 * der Vorlagen (rund 2,3:1) nicht aus; dann wird quer geschnitten, und zwar bewusst buendig an
 * einer der beiden Laengsseiten. So bleibt genau die Seite unversehrt, die im Spiel nach aussen
 * ueber die Felskante haengt – die gegenueberliegende Seite loest {@link dissolveInnerSide}
 * ohnehin auf, egal ob dort geschnitten wurde oder eine gewachsene Franse stand.
 */
function pickCrop(cropWidth, cropHeight, aspect, rng) {
  const wantWidth = Math.round(cropHeight * aspect);
  if (wantWidth <= cropWidth) {
    const left = Math.round(rng() * (cropWidth - wantWidth));
    return { left, top: 0, width: wantWidth, height: cropHeight, cutTop: false, cutBottom: false };
  }
  const height = Math.max(8, Math.round(cropWidth / aspect));
  const keepTop = rng() < 0.5;
  return {
    left: 0,
    top: keepTop ? 0 : cropHeight - height,
    width: cropWidth,
    height,
    cutTop: !keepTop,
    cutBottom: keepTop,
  };
}

/**
 * Blendet die Laengsenden des Ausschnitts aus. Dort stossen im Spiel benachbarte Matten
 * aneinander, und eine harte Kante waere selbst mitten im Bewuchs sichtbar.
 *
 * Die Laengsseiten bleiben hier unangetastet: Die Aussenseite behaelt ihre gewachsene Franse, die
 * Innenseite uebernimmt {@link dissolveInnerSide}.
 */
function featherEnds(data, width, height) {
  const endFeather = Math.max(1, Math.round(width * END_FEATHER_FRACTION));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const factor = smoothstep(clamp01(Math.min(x, width - 1 - x) / endFeather));
      if (factor >= 1) continue;
      const index = (y * width + x) * 4 + 3;
      data[index] = Math.round(data[index] * factor);
    }
  }
}

/**
 * Loest die Innenseite der Matte rauschgesteuert auf.
 *
 * Ohne diesen Schritt ist die Matte ein Rechteck: Auf dem Fels endet sie ueberall im selben
 * Abstand zur Kante, und weil jede Kante des Felsgitters eine bekommt, entsteht im Spiel ein
 * Rahmen um jede Formation. Die Aufloesungsgrenze wird deshalb pro Spalte vom Rauschen verschoben
 * – mal greift der Bewuchs tief in den Fels, mal endet er kurz hinter der Kante, und dazwischen
 * bleiben Auslaeufer und Loecher stehen.
 *
 * Bewusst nach dem Verkleinern: So haengt die Groesse der Lappen an den Bildschirmpixeln und ist
 * ueber alle drei Groessenklassen dieselbe, statt mit der Vorlagenbreite zu skalieren.
 */
function dissolveInnerSide(data, width, height, rng) {
  const fields = INNER_DISSOLVE_WAVELENGTHS.map((wavelength) =>
    valueNoiseField(width, height, wavelength * AUTHOR_SCALE, rng));
  const start = INNER_DISSOLVE_START * height;
  for (let y = Math.ceil(start); y < height; y += 1) {
    const depth = (y - start) / Math.max(1, height - start);
    for (let x = 0; x < width; x += 1) {
      const local = y * width + x;
      const noise = fields[0][local] * 0.65 + fields[1][local] * 0.35;
      const factor = 1 - smoothstep(clamp01(depth + (noise - 0.5) * INNER_DISSOLVE_NOISE));
      const index = local * 4 + 3;
      data[index] = Math.round(data[index] * factor);
    }
  }
}

/**
 * Dreht den Ausschnitt so, dass die gewachsene Franse oben liegt.
 *
 * Der Spielcode dreht die Matte anschliessend nur noch um Vielfache von 90 Grad auf die jeweilige
 * Felskante und spiegelt hoechstens laengs. Ohne diese Normalisierung zeigte bei der Haelfte der
 * Vorlagen die glatte Schnittkante nach aussen und die Franse laege unter dem Fels.
 */
function orientFringeUp(data, width, height, crop) {
  if (!crop.cutTop) return data;
  const out = Buffer.alloc(data.length);
  for (let y = 0; y < height; y += 1) {
    const from = y * width * 4;
    data.copy(out, (height - 1 - y) * width * 4, from, from + width * 4);
  }
  return out;
}

async function writeMats() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const sources = await listNumberedSources(SOURCE_DIR);

  for (const { name, index } of sources) {
    const { data: original, info } = await sharp(path.join(SOURCE_DIR, name))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const data = Buffer.from(original);
    bleedRgb(data, info.width, info.height, RGB_BLEED_PX);
    const bounds = alphaBounds(data, info.width, info.height, TRIM_THRESHOLD);
    const trimmed = cropRgba(data, info.width, bounds);

    // Saat an der Ausgabenummer statt an der Listenposition, aus demselben Grund wie in
    // `organic-cover-pipeline`: eine abgenommene Textur darf sich nicht aendern, nur weil daneben
    // eine weitere Vorlage dazukommt.
    const rng = mulberry32(SEED + (index - 1) * 7919);
    for (const variant of CLASSES) {
      const crop = pickCrop(bounds.width, bounds.height, (variant.cells * CELL_PX) / BAND_PX, rng);
      const cropped = cropRgba(trimmed, bounds.width, crop);
      featherEnds(cropped, crop.width, crop.height);
      const oriented = orientFringeUp(cropped, crop.width, crop.height, crop);

      const outWidth = Math.round(variant.cells * CELL_PX * AUTHOR_SCALE);
      const outHeight = Math.round(BAND_PX * AUTHOR_SCALE);
      const scaled = await sharp(oriented, { raw: { width: crop.width, height: crop.height, channels: 4 } })
        .resize(outWidth, outHeight, { fit: 'fill', kernel: 'lanczos3' })
        .raw()
        .toBuffer();
      dissolveInnerSide(scaled, outWidth, outHeight, rng);

      const file = path.join(OUT_DIR, `rock_veg_${String(index).padStart(2, '0')}_${variant.name}.png`);
      await sharp(scaled, { raw: { width: outWidth, height: outHeight, channels: 4 } })
        .png({ compressionLevel: 9 })
        .toFile(file);
      console.log(`${path.basename(file)}: ${outWidth}x${outHeight} `
        + `(Ausschnitt ${crop.width}x${crop.height} von ${bounds.width}x${bounds.height})`);
    }
  }
  return sources.length;
}

/**
 * Baut die Reichweitenmaske frameweise aus dem Fels-Sheet.
 *
 * Gesaet wird mit den *deckenden* Pixeln des Frames; das Distanzfeld misst also den Abstand nach
 * aussen. Innerhalb des Felsens ist die Maske voll deckend, nach aussen haelt sie `MASK_HOLD_PX`
 * und faellt bis `MASK_REACH_PX` auf null. Eine geschlossene Frame-Kante waechst damit in die
 * Nachbarzelle hinein – dort deckt deren eigener Frame ohnehin, die Vereinigung bleibt sauber.
 * An einer offenen Kante entsteht genau der Ueberhang, der die harte Felskante auflockert.
 */
async function writeMaskSheet() {
  const { data, info } = await sharp(ROCK_SHEET).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cols = info.width / FRAME_SIZE;
  const rows = info.height / FRAME_SIZE;
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) {
    throw new Error(`${ROCK_SHEET} ist kein Vielfaches von ${FRAME_SIZE}px`);
  }

  const outWidth = cols * MASK_FRAME_SIZE;
  const outHeight = rows * MASK_FRAME_SIZE;
  const out = Buffer.alloc(outWidth * outHeight * 4);
  const seeds = new Uint8Array(MASK_FRAME_SIZE * MASK_FRAME_SIZE);
  const margin = (MASK_FRAME_SIZE - FRAME_SIZE) / 2;

  for (let frameY = 0; frameY < rows; frameY += 1) {
    for (let frameX = 0; frameX < cols; frameX += 1) {
      seeds.fill(0);
      let hasSeed = false;
      for (let y = 0; y < FRAME_SIZE; y += 1) {
        for (let x = 0; x < FRAME_SIZE; x += 1) {
          const source = ((frameY * FRAME_SIZE + y) * info.width + frameX * FRAME_SIZE + x) * 4 + 3;
          if (data[source] < MASK_SEED_THRESHOLD) continue;
          seeds[(y + margin) * MASK_FRAME_SIZE + x + margin] = 1;
          hasSeed = true;
        }
      }

      const distance = hasSeed ? chamferDistance(seeds, MASK_FRAME_SIZE, MASK_FRAME_SIZE) : null;
      for (let y = 0; y < MASK_FRAME_SIZE; y += 1) {
        for (let x = 0; x < MASK_FRAME_SIZE; x += 1) {
          const local = y * MASK_FRAME_SIZE + x;
          const value = distance === null
            ? 0
            : 1 - smoothstep(clamp01((distance[local] - MASK_HOLD_PX) / (MASK_REACH_PX - MASK_HOLD_PX)));
          const target = ((frameY * MASK_FRAME_SIZE + y) * outWidth + frameX * MASK_FRAME_SIZE + x) * 4;
          // RGB bleibt weiss: Die Maske ist ausschliesslich Alphaquelle fuer `erase()`.
          out[target] = 255;
          out[target + 1] = 255;
          out[target + 2] = 255;
          out[target + 3] = Math.round(value * 255);
        }
      }
    }
  }

  await sharp(out, { raw: { width: outWidth, height: outHeight, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(MASK_SHEET);
  console.log(`${path.basename(MASK_SHEET)}: ${outWidth}x${outHeight}, ${cols * rows} Frames `
    + `a ${MASK_FRAME_SIZE}px, Reichweite ${MASK_REACH_PX}px`);
}

async function main() {
  const count = await writeMats();
  await writeMaskSheet();
  console.log(`${count} Vorlagen x ${CLASSES.length} Groessenklassen`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
