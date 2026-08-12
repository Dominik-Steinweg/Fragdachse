import sharp from 'sharp';
import * as path from 'path';
import { mkdir } from 'node:fs/promises';

/**
 * Erzeugt die getragenen Loadout-Items unter `public/assets/sprites/held/`.
 *
 * Diese Sprites haengen als eigenstaendige Bilder an der Spielerfigur (`HeldItemVisual`) und
 * ersetzen die frueheren braunen Platzhalterpixel in `32x32dachsweapon01.png`. Die Figur selbst
 * laedt seitdem `32x32dachs.png`, also die waffenlose Fassung.
 *
 * Drei Festlegungen bestimmen alles Weitere:
 *
 * - **Ein Texturpixel ist ein Figurenpixel.** Die Textur liegt exakt im 32er Raster der
 *   Spielerfigur; `HELD_ITEM_TEXTURE_SIZE_FACTOR` haelt das zur Laufzeit fest. Ueberabtastung
 *   waere hier kontraproduktiv: Phasers `smoothPixelArt` ist ein Vergroesserungsfilter, eine
 *   feinere Textur wuerde beim Zeichnen *verkleinert* und ohne Mipmaps unter Rotation flimmern.
 *   Am Ziel bleiben ohnehin nur drei bis vier sichtbare Pixel Breite – dort traegt ausschliesslich
 *   Wertkontrast, kein Detail.
 * - **Norden ist vorne.** Wie Spieler- und Gegnersprites zeigt jede Waffentextur nach oben
 *   (-y = Blickrichtung); die Rotation kommt komplett von der Figur.
 * - **Der Griffpunkt liegt in Texturpixeln vor** und wird zur Laufzeit auf den Pfotenanker der
 *   Figur gelegt. Er sitzt bewusst etwas vor dem hinteren Ende, damit der Waffenruecken in der
 *   Kopfpartie steckt statt davor zu schweben.
 *
 * Neue Waffen brauchen deshalb nur eine Pixelkarte, ihre Groesse und einen Griffpunkt. Weil bei
 * dieser Groesse Form kaum noch traegt, unterscheiden sich Waffen zuerst ueber Laenge und Breite
 * und erst danach ueber einen Farbakzent.
 *
 * Aufruf: node scripts/generate-held-item-sprites.mjs
 */

const OUT_DIR = path.join('public', 'assets', 'sprites', 'held');

/**
 * Palette. Kontur und Werteumfang sind aus `32x32dachs.png` uebernommen, damit getragene Items
 * mit der Figur verschmelzen statt als Fremdkoerper davor zu liegen.
 */
const PALETTE = {
  '.': null,                  // transparent
  k: [9, 10, 20],             // Kontur, identisch zur Figurenkontur
  d: [30, 38, 50],            // dunkles Metall
  m: [62, 78, 88],            // mittleres Metall, Wert der Figuren-Arme
  l: [124, 144, 152],         // helles Metall
  w: [176, 192, 198],         // Spitzlicht
  o: [86, 100, 58],           // Olivkoerper
  O: [128, 146, 88],          // helles Oliv
  e: [46, 56, 32],            // dunkles Oliv
  b: [198, 124, 44],          // warmes Kennband der Splittergranate
};

/**
 * Jede Zeile ist eine Pixelreihe von vorne (Muendung) nach hinten (Griff).
 *
 * `grip` ist der Punkt in Texturpixeln, der auf dem Pfotenanker der Figur sitzt. Halbe Pixel sind
 * ausdruecklich erlaubt und bei ungerader Breite noetig, um die Waffe auf der Laengsachse zu
 * zentrieren.
 */
const ITEMS = [
  {
    file: 'GLOCK.png',
    grip: { x: 2.5, y: 8.5 },
    // Kompakte Pistole: schmaler Schlitten mit heller Mittellinie, hinten der breitere
    // Verschlussblock. Die Randpixel liegen auf dem Wert der Figuren-Arme; ein dunklerer Rand
    // liesse die Waffe gegen Gras und Figur auf die helle Mittellinie zusammenfallen.
    pixels: [
      '.kkk.',
      '.mlm.',
      '.mlm.',
      '.mlm.',
      '.mlm.',
      '.mlm.',
      'dmlmd',
      'dmlmd',
      'dmwmd',
      '.ddd.',
    ],
  },
  {
    file: 'P90.png',
    grip: { x: 3, y: 11 },
    // Bullpup-PDW: kurzer Lauf vorn, breite Schale, in der Mitte das helle Laengsmagazin. Von der
    // Glock unterscheidet sie in erster Linie die Groesse, erst danach das helle Feld.
    pixels: [
      '..kk..',
      '..dd..',
      '..dd..',
      '..dd..',
      '.dmmd.',
      'dmmmmd',
      'dmllmd',
      'dlwwld',
      'dlwwld',
      'dmllmd',
      'dmmmmd',
      'dmmmmd',
      '.dddd.',
    ],
  },
  {
    file: 'HE_GRENADE.png',
    grip: { x: 3, y: 6 },
    // Splittergranate: gedrungener Oliv-Koerper mit warmem Kennband. Das Band ist der einzige
    // farbige Akzent im Satz und macht die Granate sofort von jeder Waffe unterscheidbar.
    pixels: [
      '..ee..',
      '.OOOO.',
      'OOooOO',
      'OooooO',
      'bbbbbb',
      'OooooO',
      '.eooe.',
      '..ee..',
    ],
  },
  {
    file: 'generic_gun.png',
    grip: { x: 2.5, y: 8.5 },
    // Rueckfallform fuer jede Schusswaffe ohne eigenes Bild: bewusst merkmalsfrei, damit sie
    // keine bestimmte Waffe behauptet.
    pixels: [
      '.kkk.',
      '.mmm.',
      '.mmm.',
      '.mmm.',
      '.mmm.',
      'dmmmd',
      'dmmmd',
      'dmmmd',
      'dmlmd',
      '.ddd.',
    ],
  },
  {
    file: 'generic_throwable.png',
    grip: { x: 2.5, y: 4.5 },
    // Rueckfallform fuer geworfene Utilities ohne eigenes Bild.
    pixels: [
      '.lll.',
      'lmmml',
      'lmmml',
      'lmmml',
      'dmmmd',
      '.ddd.',
    ],
  },
];

async function writeItem(item) {
  const height = item.pixels.length;
  const width = item.pixels[0].length;
  if (item.pixels.some((row) => row.length !== width)) {
    throw new Error(`${item.file}: alle Pixelzeilen muessen gleich lang sein.`);
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const symbol = item.pixels[y][x];
      if (!(symbol in PALETTE)) throw new Error(`${item.file}: unbekanntes Palettenzeichen "${symbol}".`);
      const color = PALETTE[symbol];
      const index = (y * width + x) * 4;
      if (!color) continue;
      rgba[index + 0] = color[0];
      rgba[index + 1] = color[1];
      rgba[index + 2] = color[2];
      rgba[index + 3] = 255;
    }
  }

  const target = path.join(OUT_DIR, item.file);
  await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(target);

  console.log(`${target}: ${width}x${height} px, Griff (${item.grip.x}, ${item.grip.y})`);
}

await mkdir(OUT_DIR, { recursive: true });
for (const item of ITEMS) {
  await writeItem(item);
}
