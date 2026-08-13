import sharp from 'sharp';
import * as path from 'path';
import { existsSync, readFileSync } from 'node:fs';
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
 *   (-y = Blickrichtung); die Rotation kommt komplett von der Figur. Die Pixelkarten duerfen
 *   fuer Lesbarkeit leicht asymmetrisch und um wenige Pixel seitlich versetzt sein, bleiben aber
 *   klar in der Draufsicht ausgerichtet.
 * - **Griffpunkt und Mündung liegen in Texturpixeln vor** und werden zur Laufzeit gemeinsam mit
 *   dem Bild transformiert. Der Griff sitzt bewusst etwas vor dem hinteren Ende, damit der
 *   Waffenruecken in der Kopfpartie steckt statt davor zu schweben.
 *
 * Neue Waffen brauchen deshalb eine Pixelkarte, ihre Groesse, einen Griffpunkt und optional eine
 * explizite Mündung. Ohne Angabe liegt die Mündung mittig an der vordersten Pixelreihe. Weil bei
 * dieser Groesse Form kaum noch traegt, unterscheiden sich Waffen zuerst ueber Laenge und Breite
 * und erst danach ueber einen Farbakzent.
 *
 * Aufruf: node scripts/generate-held-item-sprites.mjs
 */

const OUT_DIR = path.join('public', 'assets', 'sprites', 'held');
const PREVIEW_DIR = path.join(OUT_DIR, 'previews');
const PREVIEW_PATH = path.join(PREVIEW_DIR, 'held-weapon-pilots.png');
const PLAYER_SPRITE_PATH = path.join('public', 'assets', 'sprites', '32x32dachs.png');
const HELD_ITEM_TEXTURE_SIZE = 32;
const HELD_ITEM_ANCHOR_X = 0;
const HELD_ITEM_ANCHOR_Y = -9;
const CATALOG_PATH = path.join('src', 'loadout', 'content', 'data', 'catalog.json');
const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
const catalogById = new Map(catalog.catalog.map((entry) => [entry.id, entry]));

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
  n: [26, 42, 62],             // tiefes Blau aus Pistolen-/PDW-Icons
  u: [64, 96, 132],            // blaugrauer Akzent
  c: [38, 146, 170],           // Energie-/Cyan-Akzent
  C: [142, 232, 244],          // heller Energiekern
  f: [30, 104, 128],            // dunkler Tuerkis-Akzent der Hydra-/ASMD-Icons
  F: [72, 192, 204],            // heller Tuerkis-Akzent der Hydra-/ASMD-Icons
  p: [54, 42, 104],            // dunkles Violett aus dem ASMD-Icon
  P: [124, 78, 194],           // heller Violett-Akzent aus dem ASMD-Icon
  o: [86, 100, 58],           // Olivkoerper
  O: [128, 146, 88],          // helles Oliv
  e: [46, 56, 32],            // dunkles Oliv
  g: [54, 86, 48],             // dunkles Gruen
  G: [112, 146, 72],           // helles Gruen
  h: [72, 42, 30],             // dunkles Holz
  H: [156, 88, 40],            // warmes Holz
  y: [208, 168, 66],            // gelbes Warnband
  z: [142, 56, 24],             // dunkles Orange fuer Flammenwerfer-/Holzakzente
  Z: [232, 126, 38],            // helles Orange fuer Flammenwerfer-/Holzakzente
  b: [198, 124, 44],          // warmes Kennband der Splittergranate
};

/**
 * Jede Zeile ist eine Pixelreihe von vorne (Muendung) nach hinten (Griff).
 *
 * `grip` ist der Punkt in Texturpixeln, der auf dem Pfotenanker der Figur sitzt. Halbe Pixel sind
 * ausdruecklich erlaubt und bei ungerader Breite noetig, um die Waffe auf der Laengsachse zu
 * zentrieren. Bei Pilot-Sprites duerfen alle Zeilen auch vollstaendig ausgeschrieben und bewusst
 * asymmetrisch sein; die Textur wird nicht mehr auf eine Spiegelachse gezwungen.
 */
const ITEMS = [
  {
    file: 'GLOCK.png',
    grip: { x: 4.5, y: 9.5 },
    muzzle: { x: 3.5, y: 0 },
    // Ikonreferenz: blaugrauer Schlitten, dunkler Lauf und ein kurzer blauer Akzent.
    // Die leicht nach rechts versetzte Griffpartie ist ein lokales Anbauteil, keine Seitenansicht.
    pixels: [
      '...k...',
      '...d...',
      '..ndd..',
      '..nmm..',
      '..nmmu.',
      '.nnmmu.',
      '.nnmmuu',
      '..nmmuu',
      '...dmm.',
      '....dmm',
      '....dd.',
    ],
  },
  {
    file: 'P90.png',
    grip: { x: 4.5, y: 11.5 },
    // Ikonreferenz: breite, kompakte PDW mit blauem Magazin-/Energieakzent.
    pixels: [
      '....k....',
      '....d....',
      '...dmd...',
      '..dmmmdd.',
      '.dmmmmmd.',
      'dmmnmmmdd',
      'dmmnmmmdd',
      '.dmmnmmu.',
      '.dmmnmmu.',
      '..dmmmu..',
      '..dmmmu..',
      '...dmm...',
      '...ddd...',
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
    grip: { x: 4.5, y: 10.5 },
    // Kompakte Energieseitenwaffe: breiter als die Glock und mit symmetrischem Kern.
    pixels: [
      '....k....',
      '...ddd...',
      '..dpppd..',
      '.dppPppd.',
      'dppPCPPpd',
      'dppPPPPpd',
      '.dppPPpd.',
      'dppPPPPpd',
      '.dppPppd.',
      '..dpppd..',
      '..dpppd..',
      '...ddd...',
      '....d....',
    ],
  },
  {
    file: 'PLASMA.png',
    grip: { x: 3.5, y: 11.5 },
    // Energiewaffe mit hellem, durchgehendem Plasmakern.
    pixels: [
      '...k...',
      '...d...',
      '..dmd..',
      '.dmcmd.',
      'dmcCcmd',
      'dmcCCmd',
      '.dmCmu.',
      'dmmCmmd',
      '.dmcmd.',
      '..dmd..',
      '..dmd..',
      '..ddd..',
      '...d...',
    ],
  },
  {
    file: 'HYDRA.png',
    grip: { x: 4.5, y: 13.5 },
    // Breiter Mehrfach-Emitter: die lange, schwere Silhouette trennt ihn vom Plasma.
    pixels: [
      '..k.k.k..',
      '.dmmmmd..',
      'dmmcCcmmd',
      'dmmFcFmmd',
      '.dmmcCmm.',
      '.dmmFcmm.',
      'dmmcCcmmd',
      '.dmmmmmd.',
      '..dmmmd..',
      '.dmmmmmd.',
      'dmmcCcmmd',
      'dmmFcFmmd',
      '..dmmmd..',
      '...ddd...',
      '....d....',
    ],
  },
  {
    file: 'XBOW.png',
    grip: { x: 4.5, y: 13.5 },
    // Armbrust: breites Bogenhaupt an der Mündung und schmaler Schaft nach hinten.
    pixels: [
      '..k...k..',
      '.nmmmnmm.',
      'nmmcCcmmn',
      'nmmcCcmmn',
      '.nmmumnm.',
      '..nmmmn..',
      '...ncn...',
      '...nmn...',
      '...nmn...',
      '...nmn...',
      '...nmn...',
      '...nnn...',
      '...nnn...',
      '....n....',
      '....n....',
    ],
  },
  {
    file: 'LAUBBLAESER.png',
    grip: { x: 5.5, y: 13.5 },
    // Laubbläser: große Düse vorne, danach ein langer, schlanker Griffkörper.
    pixels: [
      '...k.....',
      '..dGd....',
      '.dGGGd...',
      'dGGGGGd..',
      'dGgGGu...',
      '.dGGGuu..',
      '.dGGGuu..',
      '..dGGuu..',
      '..dGGuu..',
      '..dGGuu..',
      '..dGGuu..',
      '...dGuu..',
      '...dGuu..',
      '...ddd...',
      '....d....',
      '....d....',
    ],
  },
  {
    file: 'REPARATURSTRAHL.png',
    grip: { x: 4.5, y: 10.5 },
    muzzle: { x: 3.5, y: 0 },
    // Schmaler Reparaturstrahler mit heller, ruhiger Mittellinie.
    pixels: [
      '...k...',
      '..mCm..',
      '..mcm..',
      '.mGgm..',
      '.mGGm..',
      '.mCGm..',
      '.mGmmu.',
      '.mGmmu.',
      '..dmmu.',
      '..dmmu.',
      '...ddd.',
      '....d..',
    ],
  },
  {
    file: 'OVERCHARGE_CORE.png',
    grip: { x: 3.5, y: 9.5 },
    // Verstärkungskern: kurzer, heller Energiekörper mit kompakter Heckkappe.
    pixels: [
      '...k...',
      '..dmd..',
      '.dZyZd.',
      '.dZyZd.',
      'dZyyyZd',
      '.dZyydd',
      '..dmd..',
      '..dmd..',
      '...d...',
      '...d...',
    ],
  },
  {
    file: 'ENERGIEINJEKTOR.png',
    grip: { x: 2.5, y: 9.5 },
    // Injektor: schmaler Stab mit hellem Energiesegment statt Waffenlauf.
    pixels: [
      '..k..',
      '..C..',
      '.mCm.',
      '.mcm.',
      '.mCm.',
      '.mcm.',
      '.mCm.',
      'dmCmd',
      'dmCmu',
      '.ddmu',
      '..d..',
    ],
  },
  {
    file: 'AK47.png',
    grip: { x: 4.5, y: 20.5 },
    // Langes Sturmgewehr mit gleichmäßiger, schwerer Schulterpartie.
    pixels: [
      '....k....',
      '....d....',
      '...dmd...',
      '...dmd...',
      '..dmmmd..',
      '.dmmmmmd.',
      'dmmHmmmd.',
      '.dmmHmmmd',
      '.dmmHmmmd',
      '.dmmHmmmd',
      '.dmmHmmmd',
      '..dmmmd..',
      '..dmmmd..',
      '..dmmhd..',
      '..dmmhd..',
      '...dmm...',
      '...dmm...',
      '...dmm...',
      '...dmm...',
      '...ddd...',
      '...ddd...',
      '....d....',
    ],
  },
  {
    file: 'SHOTGUN.png',
    grip: { x: 5.5, y: 17.5 },
    muzzle: { x: 4.5, y: 0 },
    // Doppelläufige Schrotflinte: zwei getrennte Konturpunkte an der Mündung.
    pixels: [
      '...k...k...',
      '...d...d...',
      '...d...d...',
      '...d...d...',
      '...d...d...',
      '...dmmmd...',
      '..dmmHmmmd.',
      '..dmmHmmmd.',
      '..dmmhmmd..',
      '...dmmmd...',
      '...dmmmd...',
      '...dmmmH...',
      '...dmmmH...',
      '...dmmmH...',
      '....dmmH...',
      '....dmmH...',
      '....dmmH...',
      '.....dd....',
      '.....d.....',
    ],
  },
  {
    file: 'ASMD_SEC.png',
    grip: { x: 4.5, y: 14.5 },
    // Sekundär-Emitter: längere Energiewaffe mit hellem Doppelkanal.
    pixels: [
      '...k.k...',
      '..dmmmd..',
      'dmmcFcmmd',
      'dmmcCcmmd',
      '.dmmcFmmd',
      'dmmcCcmmd',
      '.dmmcFmmd',
      '.dmmcCmm.',
      '..dmmmd..',
      '..dmmmd..',
      '...dmd...',
      '...dmd...',
      '...dmd...',
      '...ddd...',
      '...ddd...',
      '....d....',
    ],
  },
  {
    file: 'ROCKET_LAUNCHER.png',
    grip: { x: 6.5, y: 19.5 },
    muzzle: { x: 5.5, y: 0 },
    // Schweres Raketenrohr: breite Mündung, dicker Körper, kurzes Heck.
    pixels: [
      '...kOOOk.....',
      '..kOmmmOkk...',
      '.kOmmmmOkk...',
      '.kOmmmmOkk...',
      '..kOmmmOkk...',
      '..dOmmmOkk...',
      '...dmmmmOkk..',
      '...dmmmOOO...',
      '...dmmmOOO...',
      '...dmmOyyO...',
      '...dmmOyyO...',
      '....dmmOO....',
      '....dmmOO....',
      '....dmmOO....',
      '....dmmOO....',
      '....dmmOO....',
      '.....dmOO....',
      '.....dmOO....',
      '.....dmmm....',
      '.....dmmm....',
      '.....ddd.....',
      '......dd.....',
    ],
  },
  {
    file: 'MINI_ROCKET_LAUNCHER.png',
    grip: { x: 4.5, y: 12.5 },
    muzzle: { x: 4.5, y: 0 },
    // Kürzere Raketenvariante, mit hellem Kern zur schnellen Unterscheidung.
    pixels: [
      '..k.k.k..',
      '.nmmnmmn.',
      'nmmcCcmmn',
      'nmmcCcmmn',
      '.nmmnmmu.',
      '.nmmnmmu.',
      '..nmmmu..',
      '..nmmmu..',
      '..nmmmu..',
      '...nmmu..',
      '...nmmu..',
      '...ddd...',
      '...ddd...',
      '....d....',
    ],
  },
  {
    file: 'AWP.png',
    grip: { x: 4.5, y: 26.5 },
    muzzle: { x: 4.5, y: 0 },
    // Präzisionsgewehr: die längste, bewusst sehr schmale Silhouette im Satz.
    pixels: [
      '....k....',
      '....o....',
      '....o....',
      '....o....',
      '....o....',
      '....o....',
      '....o....',
      '....o....',
      '....o....',
      '....o....',
      '....o....',
      '....o....',
      '....o....',
      '...eoe...',
      '...eoe...',
      '..oOooO..',
      '..oOoOO..',
      '..oOoOO..',
      '..oooOO..',
      '..ooooo..',
      '...oooO..',
      '...oooO..',
      '...oooO..',
      '...oooO..',
      '...oooO..',
      '...oooO..',
      '...ddd...',
      '....d....',
    ],
  },
  {
    file: 'FLAMETHROWER.png',
    grip: { x: 5.5, y: 15.5 },
    muzzle: { x: 4.5, y: 0 },
    // Flammenwerfer: schwere Düse und kurzer, kompakter Tankkörper.
    pixels: [
      '....k......',
      '...dmmmm...',
      '..dmmmmm...',
      '.dmmhHhmmd.',
      'dmmZyZmmmd.',
      '.dmmhHhmmd.',
      '.dmmmmmmmd.',
      '..dmmmmd...',
      '..dmmZmd...',
      '..dmmZmd...',
      '..dmmmmd...',
      '..dmmmmd...',
      '...dmmmm...',
      '...dmmmZ...',
      '...dmmmZ...',
      '....ddd....',
      '.....d.....',
    ],
  },
  {
    file: 'NEGEV.png',
    grip: { x: 6.5, y: 20.5 },
    muzzle: { x: 5.5, y: 0 },
    // Ikonreferenz: breites dunkles MG mit olivgrünen Markierungen und schwerem Gehäuse.
    pixels: [
      '.....k.......',
      '.....d.......',
      '....dmd......',
      '....dmm......',
      '...dmmmdd....',
      '..dmmmmdd....',
      '..dmmmGGdd...',
      '..dmmmGGddd..',
      '..dmmmGGddd..',
      '..dmmmGGddd..',
      '...dmmmGGdd..',
      '...dmmmGGdd..',
      '...dmmmGGdd..',
      '...dmmmGGdd..',
      '...dmmmGGdd..',
      '...dmmmmdd...',
      '...dmmmmdd...',
      '...dmmmmdd...',
      '...dmmmmdd...',
      '...dmmmmdd...',
      '....dmmmm....',
      '.....ddd.....',
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
      '.dddd.',
      '.dddd.',
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

// 32px bleibt eine seltene Langwaffen-Ausnahme; die normale Silhouette soll deutlich kleiner
// bleiben, damit Waffen nicht in die Spielerfigur hineinwachsen.
const EXCEPTIONAL_SIZE_ITEMS = new Set(['AWP.png']);
const STANDARD_HELD_ITEM_MAX_WIDTH = 13;
const STANDARD_HELD_ITEM_MAX_HEIGHT = 24;
const ABSOLUTE_HELD_ITEM_MAX_SIZE = 32;

const PILOT_PREVIEW_ITEMS = ['GLOCK.png', 'NEGEV.png', 'ROCKET_LAUNCHER.png'];
const PILOT_PREVIEW_ROTATIONS = [0, 90, 180, 270];
const PILOT_PREVIEW_SCALE = 8;
const PILOT_PREVIEW_TILE_SIZE = 448;
const PILOT_PREVIEW_PADDING = 64;
const ALL_WEAPON_PREVIEW_GROUPS = [
  {
    path: path.join(PREVIEW_DIR, 'held-weapons-all-01.png'),
    items: ['GLOCK.png', 'ASMD_PRIM.png', 'PLASMA.png', 'HYDRA.png', 'XBOW.png', 'LAUBBLAESER.png'],
  },
  {
    path: path.join(PREVIEW_DIR, 'held-weapons-all-02.png'),
    items: ['REPARATURSTRAHL.png', 'OVERCHARGE_CORE.png', 'ENERGIEINJEKTOR.png', 'P90.png', 'AK47.png', 'SHOTGUN.png'],
  },
  {
    path: path.join(PREVIEW_DIR, 'held-weapons-all-03.png'),
    items: ['ASMD_SEC.png', 'ROCKET_LAUNCHER.png', 'MINI_ROCKET_LAUNCHER.png', 'AWP.png', 'FLAMETHROWER.png', 'NEGEV.png'],
  },
];
const ALL_WEAPON_PREVIEW_SCALE = 6;
const ALL_WEAPON_PREVIEW_TILE_SIZE = 416;
const ALL_WEAPON_PREVIEW_PADDING = 48;

function rotatePoint(x, y, degrees) {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: x * cos - y * sin,
    y: x * sin + y * cos,
  };
}

/**
 * Erzeugt eine vergrösserte Rastertafel aus genau derselben Pixelkarte und demselben Grippunkt.
 * Reihenfolge: Glock, Negev, Rocket Launcher; Spalten: 0, 90, 180, 270 Grad.
 */
async function writeWeaponPreview(items, outputPath, scale, tileSize, padding) {
  const previewWidth = padding * 2 + tileSize * PILOT_PREVIEW_ROTATIONS.length;
  const previewHeight = padding * 2 + tileSize * items.length;
  const previewCenter = tileSize / 2;
  const weaponCanvasSize = 64 * scale;
  const weaponCanvasCenter = weaponCanvasSize / 2;
  const player = await sharp(PLAYER_SPRITE_PATH)
    .resize({ width: HELD_ITEM_TEXTURE_SIZE * scale, height: HELD_ITEM_TEXTURE_SIZE * scale, kernel: 'nearest' })
    .png()
    .toBuffer();

  const composites = [];
  for (let row = 0; row < items.length; row += 1) {
    const item = ITEMS.find((candidate) => candidate.file === items[row]);
    if (!item) throw new Error(`Preview-Waffe fehlt im Generator: ${items[row]}`);
    const weaponPath = path.join(OUT_DIR, item.file);
    const weapon = await sharp(weaponPath)
      .resize({ width: Math.max(...item.pixels.map((line) => line.length)) * scale, height: item.pixels.length * scale, kernel: 'nearest' })
      .png()
      .toBuffer();
    const weaponCanvas = await sharp({
      create: {
        width: weaponCanvasSize,
        height: weaponCanvasSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{
        input: weapon,
        left: Math.round(weaponCanvasCenter - item.grip.x * scale),
        top: Math.round(weaponCanvasCenter - item.grip.y * scale),
      }])
      .png()
      .toBuffer();

    for (let column = 0; column < PILOT_PREVIEW_ROTATIONS.length; column += 1) {
      const degrees = PILOT_PREVIEW_ROTATIONS[column];
      const playerRotated = await sharp(player)
        .rotate(degrees, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      const weaponRotated = await sharp(weaponCanvas)
        .rotate(degrees, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      const anchor = rotatePoint(
        HELD_ITEM_ANCHOR_X * scale,
        HELD_ITEM_ANCHOR_Y * scale,
        degrees,
      );
      const tileLeft = padding + column * tileSize;
      const tileTop = padding + row * tileSize;
      composites.push({ input: playerRotated, left: tileLeft + previewCenter - (HELD_ITEM_TEXTURE_SIZE * scale) / 2, top: tileTop + previewCenter - (HELD_ITEM_TEXTURE_SIZE * scale) / 2 });
      composites.push({ input: weaponRotated, left: Math.round(tileLeft + previewCenter + anchor.x - weaponCanvasSize / 2), top: Math.round(tileTop + previewCenter + anchor.y - weaponCanvasSize / 2) });
    }
  }

  await sharp({
    create: {
      width: previewWidth,
      height: previewHeight,
      channels: 4,
      background: { r: 22, g: 26, b: 34, alpha: 255 },
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(outputPath);
  console.log(`${outputPath}: ${previewWidth}x${previewHeight} px (${items.length} Waffen x 4 Rotationen)`);
}

async function writeItem(item) {
  const height = item.pixels.length;
  const width = Math.max(...item.pixels.map((row) => row.length));
  const pixels = item.pixels.map((row) => {
    const missing = width - row.length;
    if (missing < 0) {
      throw new Error(`${item.file}: Pixelzeilen duerfen nicht breiter als die Textur sein.`);
    }
    const leftPadding = Math.floor(missing / 2);
    const rightPadding = missing - leftPadding;
    return `${'.'.repeat(leftPadding)}${row}${'.'.repeat(rightPadding)}`;
  });
  const isExceptionalSize = EXCEPTIONAL_SIZE_ITEMS.has(item.file);
  const maxWidth = isExceptionalSize ? ABSOLUTE_HELD_ITEM_MAX_SIZE : STANDARD_HELD_ITEM_MAX_WIDTH;
  const maxHeight = isExceptionalSize ? ABSOLUTE_HELD_ITEM_MAX_SIZE : STANDARD_HELD_ITEM_MAX_HEIGHT;
  if (width > maxWidth || height > maxHeight) {
    throw new Error(
      `${item.file}: Held-Texturen duerfen standardmaessig maximal ${maxWidth}x${maxHeight} px gross sein.`,
    );
  }
  const grip = item.grip;
  const muzzle = item.muzzle ?? { x: width / 2, y: 0 };
  for (const [label, point] of [['Grip', grip], ['Muzzle', muzzle]]) {
    if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) {
      throw new Error(`${item.file}: ${label}-Punkt liegt ausserhalb der Textur.`);
    }
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const symbol = pixels[y][x];
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

  const itemId = path.basename(item.file, '.png');
  const catalogEntry = catalogById.get(itemId);
  if (catalogEntry?.iconKey) {
    const iconPath = path.join('public', 'assets', 'sprites', 'Loadout', `${catalogEntry.iconKey}.png`);
    if (!existsSync(iconPath)) throw new Error(`${item.file}: Icon-Referenz fehlt: ${iconPath}`);
  }
  console.log(`${target}: ${width}x${height} px, Grip (${grip.x}, ${grip.y}), Muzzle (${muzzle.x}, ${muzzle.y}), Icon ${catalogEntry?.iconKey ?? 'none'}`);
}

await mkdir(OUT_DIR, { recursive: true });
await mkdir(PREVIEW_DIR, { recursive: true });
for (const item of ITEMS) {
  await writeItem(item);
}
await writeWeaponPreview(PILOT_PREVIEW_ITEMS, PREVIEW_PATH, PILOT_PREVIEW_SCALE, PILOT_PREVIEW_TILE_SIZE, PILOT_PREVIEW_PADDING);
for (const group of ALL_WEAPON_PREVIEW_GROUPS) {
  await writeWeaponPreview(group.items, group.path, ALL_WEAPON_PREVIEW_SCALE, ALL_WEAPON_PREVIEW_TILE_SIZE, ALL_WEAPON_PREVIEW_PADDING);
}
