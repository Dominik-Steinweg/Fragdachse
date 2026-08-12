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
    file: 'ASMD_PRIM.png',
    grip: { x: 3.5, y: 8.5 },
    // Kompakte Energieseitenwaffe: breiter als die Glock und mit symmetrischem Kern.
    pixels: [
      '..kkk..',
      '..ddd..',
      '..mmm..',
      'dmmmmmd',
      'dmlmlmd',
      'dmlmlmd',
      'dmmmmmd',
      'dmmmmmd',
      'dmlmlmd',
      '.ddddd.',
    ],
  },
  {
    file: 'PLASMA.png',
    grip: { x: 3.5, y: 10.5 },
    // Energiewaffe mit hellem, durchgehendem Plasmakern.
    pixels: [
      '..kkk..',
      '..lml..',
      'dmlwlmd',
      'dmlwlmd',
      'dmmmmmd',
      'dmlwlmd',
      'dmlwlmd',
      'dmmmmmd',
      'dmlwlmd',
      'dmmmmmd',
      'dmlmlmd',
      '.ddddd.',
    ],
  },
  {
    file: 'HYDRA.png',
    grip: { x: 3.5, y: 10.5 },
    // Breiter Mehrfach-Emitter: die lange, schwere Silhouette trennt ihn vom Plasma.
    pixels: [
      '..k.k..',
      '.dmmmmd',
      'dmmmmmd',
      'dmlwlmd',
      'dmlwlmd',
      'dmmmmmd',
      'dmmmmmd',
      'dmlmlmd',
      'dmlmlmd',
      'dmmmmmd',
      'dmmllmd',
      'dmmmmmd',
      '.ddddd.',
    ],
  },
  {
    file: 'XBOW.png',
    grip: { x: 3.5, y: 10.5 },
    // Armbrust: breites Bogenhaupt an der Mündung und schmaler Schaft nach hinten.
    pixels: [
      '..kkk..',
      '.dmmmd.',
      'dmlwlmd',
      'dmlmlmd',
      '.dmmmd.',
      '..dmd..',
      '..dmd..',
      '..dmd..',
      '..dmd..',
      '..dmd..',
      '..dmd..',
      '..ddd..',
      '..ddd..',
    ],
  },
  {
    file: 'LAUBBLAESER.png',
    grip: { x: 3.5, y: 11.5 },
    // Laubbläser: große Düse vorne, danach ein langer, schlanker Griffkörper.
    pixels: [
      '..kkk..',
      '.dmmmd.',
      '.dmmmd.',
      'dmmmmmd',
      'dmlmlmd',
      'dmlmlmd',
      'dmmmmmd',
      '..dmd..',
      '..dmd..',
      '..dmd..',
      '..dmd..',
      '..dmd..',
      '..ddd..',
      '..ddd..',
    ],
  },
  {
    file: 'REPARATURSTRAHL.png',
    grip: { x: 2.5, y: 9.5 },
    // Schmaler Reparaturstrahler mit heller, ruhiger Mittellinie.
    pixels: [
      '.kkk.',
      '.lll.',
      '.mlm.',
      '.mlm.',
      '.mlm.',
      '.mlm.',
      '.mlm.',
      '.mlm.',
      'dmlmd',
      'dmlmd',
      '.ddd.',
    ],
  },
  {
    file: 'OVERCHARGE_CORE.png',
    grip: { x: 3.5, y: 8.5 },
    // Verstärkungskern: kurzer, heller Energiekörper mit kompakter Heckkappe.
    pixels: [
      '..kkk..',
      '.dmmmd.',
      'dmlwlmd',
      'dmlwlmd',
      'dmmmmmd',
      'dmlwlmd',
      'dmlwlmd',
      'dmmmmmd',
      '.dmmmd.',
      '..ddd..',
      '..ddd..',
    ],
  },
  {
    file: 'ENERGIEINJEKTOR.png',
    grip: { x: 2.5, y: 8.5 },
    // Injektor: schmaler Stab mit hellem Energiesegment statt Waffenlauf.
    pixels: [
      '.kkk.',
      '.lml.',
      '.lwl.',
      '.lwl.',
      '.lwl.',
      '.lwl.',
      '.mlm.',
      'dmlmd',
      'dmlmd',
      '.ddd.',
    ],
  },
  {
    file: 'AK47.png',
    grip: { x: 3.5, y: 12 },
    // Langes Sturmgewehr mit gleichmäßiger, schwerer Schulterpartie.
    pixels: [
      '..kkk..',
      '..ddd..',
      '..mmm..',
      'dmmmmmd',
      'dmlmlmd',
      'dmlmlmd',
      'dmmmmmd',
      'dmlmlmd',
      'dmlmlmd',
      'dmmmmmd',
      'dmmmmmd',
      'dmlmlmd',
      'dmlmlmd',
      'dmmmmmd',
      '.ddddd.',
    ],
  },
  {
    file: 'SHOTGUN.png',
    grip: { x: 3.5, y: 10.5 },
    // Doppelläufige Schrotflinte: zwei getrennte Konturpunkte an der Mündung.
    pixels: [
      '..k.k..',
      '..m.m..',
      '..m.m..',
      '.dmmmd.',
      'dmlmlmd',
      'dmmmmmd',
      'dmlmlmd',
      'dmlmlmd',
      'dmmmmmd',
      'dmmmmmd',
      'dmlmlmd',
      'dmmmmmd',
      '.ddddd.',
    ],
  },
  {
    file: 'ASMD_SEC.png',
    grip: { x: 3.5, y: 11 },
    // Sekundär-Emitter: längere Energiewaffe mit hellem Doppelkanal.
    pixels: [
      '..kkk..',
      '.dmmmd.',
      'dmlwlmd',
      'dmlwlmd',
      'dmmmmmd',
      'dmlwlmd',
      'dmlwlmd',
      'dmmmmmd',
      'dmlwlmd',
      'dmlwlmd',
      'dmmmmmd',
      '.dmmmd.',
      '..ddd..',
      '..ddd..',
    ],
  },
  {
    file: 'ROCKET_LAUNCHER.png',
    grip: { x: 3.5, y: 11.5 },
    // Schweres Raketenrohr: breite Mündung, dicker Körper, kurzes Heck.
    pixels: [
      '.kkkkk.',
      'dmmmmmd',
      'dmlmlmd',
      'dmlmlmd',
      'dmmmmmd',
      'dmmmmmd',
      'dmlmlmd',
      'dmlmlmd',
      'dmmmmmd',
      'dmlmlmd',
      'dmlmlmd',
      'dmmmmmd',
      'dmmmmmd',
      '.ddddd.',
    ],
  },
  {
    file: 'MINI_ROCKET_LAUNCHER.png',
    grip: { x: 3, y: 9.5 },
    // Kürzere Raketenvariante, mit hellem Kern zur schnellen Unterscheidung.
    pixels: [
      '.kkkk.',
      'dmmmmd',
      'dmlwld',
      'dmmmmd',
      'dmlmld',
      'dmlmld',
      'dmmmmd',
      'dmlmld',
      'dmmmmd',
      'dmmmmd',
      '.dddd.',
    ],
  },
  {
    file: 'AWP.png',
    grip: { x: 2.5, y: 12.5 },
    // Präzisionsgewehr: die längste, bewusst sehr schmale Silhouette im Satz.
    pixels: [
      '.kkk.',
      '.mlm.',
      '.mlm.',
      '.mlm.',
      '.mlm.',
      '.mlm.',
      '.mlm.',
      '.mlm.',
      '.mlm.',
      '.mlm.',
      '.mlm.',
      'dmlmd',
      'dmlmd',
      'dmlmd',
      'dmlmd',
      '.ddd.',
    ],
  },
  {
    file: 'FLAMETHROWER.png',
    grip: { x: 3.5, y: 11 },
    // Flammenwerfer: schwere Düse und kurzer, kompakter Tankkörper.
    pixels: [
      '..kkk..',
      '..ddd..',
      '.dmmmd.',
      'dmmmmmd',
      'dmlmlmd',
      'dmlmlmd',
      'dmmmmmd',
      'dmmmmmd',
      'dmlmlmd',
      'dmlmlmd',
      'dmmmmmd',
      '..dmd..',
      '..dmd..',
      '..ddd..',
    ],
  },
  {
    file: 'NEGEV.png',
    grip: { x: 3.5, y: 13 },
    // Schweres MG: lang und breit, mit maximaler Schultermasse.
    pixels: [
      '..kkk..',
      'dmmmmmd',
      'dmmmmmd',
      'dmlmlmd',
      'dmlmlmd',
      'dmmmmmd',
      'dmmmmmd',
      'dmlmlmd',
      'dmlmlmd',
      'dmmmmmd',
      'dmmmmmd',
      'dmlmlmd',
      'dmlmlmd',
      'dmmmmmd',
      'dmmmmmd',
      '.ddddd.',
    ],
  },
  {
    file: 'SMOKE_GRENADE.png',
    grip: { x: 3, y: 6.5 },
    // Rauchgranate: symmetrischer Metallzylinder ohne den warmen HE-Kennstreifen.
    pixels: [
      '..kk..',
      'dmmmmd',
      'dmlmld',
      'dmmmmd',
      'dmlmld',
      'dmmmmd',
      '.dddd.',
      '.dddd.',
    ],
  },
  {
    file: 'MOLOTOV_GRENADE.png',
    grip: { x: 3, y: 7 },
    // Molotov: schmaler Hals über dem gedrungenen, oliven Flaschenkörper.
    pixels: [
      '..kk..',
      '..mm..',
      '.OooO.',
      'OooooO',
      'OooooO',
      'OooooO',
      '.eooe.',
      '..ee..',
      '..ee..',
    ],
  },
  {
    file: 'TIME_BUBBLE.png',
    grip: { x: 3, y: 6.5 },
    // Zeitblase: kompakte Tech-Kapsel mit hellem, pulsierendem Kern.
    pixels: [
      '..kk..',
      'dmmmmd',
      'dmlwld',
      'dmlwld',
      'dmmmmd',
      'dmlwld',
      'dmmmmd',
      '.dddd.',
      '.dddd.',
    ],
  },
  {
    file: 'STINKDRUESEN.png',
    grip: { x: 3.5, y: 6.5 },
    // Stinkdrüsen: organische, olivfarbene Kapsel mit dunklem Rand.
    pixels: [
      '..eee..',
      '.OoooO.',
      'eOoooOe',
      'eOoooOe',
      'eOoooOe',
      'eOoooOe',
      '.eoooe.',
      '..eee..',
      '..eee..',
    ],
  },
  {
    file: 'DECOY.png',
    grip: { x: 3, y: 8 },
    // Decoy-Modul: längliches Gerät mit heller Kernanzeige und dicker Basis.
    pixels: [
      '..kk..',
      'dmmmmd',
      'dmlwld',
      'dmlmld',
      'dmmmmd',
      'dmlmld',
      'dmlmld',
      'dmmmmd',
      '..ddd.',
      '..ddd.',
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
