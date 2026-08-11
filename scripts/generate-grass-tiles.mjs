import sharp from 'sharp';
import * as path from 'path';

/**
 * Erzeugt die beiden Boden-Kacheln der Arena:
 *
 * - `gras_bg_tile.png`     – die nahtlose Basiskachel (Farbe, Wolken, Halmkorn).
 * - `gras_detail_tile.png` – eine nahezu weisse Multiply-Kachel mit Buescheln und Korn.
 *
 * Warum zwei Kacheln statt einer: Die Basiskachel ist 1254 px breit, die Arena je nach Modus
 * 1440 bis 4320 px. Die Wolkenstruktur wiederholt sich damit bis zu 3,4-mal sichtbar. Die
 * Detailkachel hat mit 512 px eine dazu weitgehend teilerfremde Periode (kgV 321 024 px), sodass
 * die Kombination praktisch nie identisch wiederkehrt.
 *
 * Warum ueberhaupt neu erzeugt: Die alte Kachel war eine einzelne weichgezeichnete Rauschoktave.
 * Ihre gesamte Energie sass bei 65-129 px (RMS 1,31), waehrend das 1-3-px-Band bei 0,22 lag – der
 * Dirt-Boden erreicht dort 3,82. Gras las sich dadurch als unscharfer Hintergrund unter einer
 * scharfen Dirt-Ebene. Beide Kacheln hier sind deshalb bewusst multi-oktavig aufgebaut, mit
 * absichtlich *fallender* Amplitude zu grossen Skalen hin.
 *
 * Aufruf: node scripts/generate-grass-tiles.mjs
 */

const OUT_DIR = path.join('public', 'assets', 'sprites');
const BASE_TARGET = path.join(OUT_DIR, 'gras_bg_tile.png');
const DETAIL_TARGET = path.join(OUT_DIR, 'gras_detail_tile.png');

/**
 * 627 = 3·11·19, also ungerade und damit exakt teilerfremd zur Detailkachel. Die alte Kachel war
 * doppelt so gross; das Viertel an Pixeln haelt die Dateigroesse trotz des neuen Feinkorns etwa
 * auf dem alten Stand. Grossflaechige Struktur geht dabei nicht verloren, weil die groesste
 * verbliebene Wellenlaenge ohnehin die schwaechste Bande ist.
 */
const BASE_SIZE = 627;
/** Zweierpotenz; gegen 627 teilerfremd, gemeinsame Periode also 321 024 px. */
const DETAIL_SIZE = 512;

/**
 * Farbachsen des Grases. Die alte Kachel variierte nur in R und G (sd(B) = 0,3) und wirkte
 * dadurch wie ein Gruen-Helligkeitsverlauf statt wie Material. Diese beiden Endpunkte spannen
 * eine echte Farbtonachse auf: feucht/beschattet gegen trocken/besonnt.
 *
 * Beide Endpunkte haben bewusst **dieselbe Rec.709-Luma (67,2)**. Sonst schleppt die Farbachse
 * verdeckt Helligkeit mit, und weil der Farbton absichtlich traeger wandert als der Wert, landet
 * diese Helligkeit vollstaendig in den grossen Skalen – das Bandprofil laesst sich dann ueber die
 * Wert-Oktaven nicht mehr steuern. Beim Aendern der Farben die Luma nachrechnen:
 * 0,2126·R + 0,7152·G + 0,0722·B.
 */
const COLOR_COOL = [35, 78, 60];
const COLOR_WARM = [54, 75, 36];

/**
 * Multiplikative Helligkeitsamplitude der Basiskachel. Zusammen mit der Detailkachel liegt die
 * Kontrastdichte pro 32-px-Zelle danach etwa bei der Haelfte des Dirt-Bodens – Gras bleibt das
 * ruhigere Material, liest sich aber in derselben Bildebene.
 */
const BASE_VALUE_AMOUNT = 0.056;
/** Ausschlag entlang der Farbtonachse; 1 = voll trocken, -1 = voll feucht. */
const BASE_HUE_AMOUNT = 0.16;
/**
 * Vorabhebung, die den mittleren Multiply-Verlust der Detailkachel ausgleicht. Ohne sie saenke
 * der Gras-Mittelton unter den alten Wert, statt ihn wie beabsichtigt leicht anzuheben.
 */
const DETAIL_MEAN_COMPENSATION = 1 / 0.955;

/**
 * Oktavleiter der Basiskachel. `n` ist die Gitteraufloesung; die Wellenlaenge ist 627/n px.
 * Nur Teiler von 627 sind zulaessig (1, 3, 11, 19, 33, 57, 209, 627), sonst waere die Kachel
 * nicht mehr nahtlos. Die Amplituden fallen bewusst zu grossen Skalen hin – genau umgekehrt zur
 * alten Kachel, deren gesamte Energie bei 65-129 px sass.
 *
 * Die 1-px-Oktave (n = 627) fehlt bewusst: Sie waere der mit Abstand teuerste PNG-Inhalt, und
 * die Detailkachel deckt dieselbe Wellenlaenge mit ihrer 256er-Oktave ab.
 */
const BASE_VALUE_OCTAVES = [
  { nx: 3, ny: 3, amp: 0.14 },     // 209 px – die verbliebene grossflaechige Wolke
  { nx: 11, ny: 11, amp: 0.30 },   // 57 px
  { nx: 19, ny: 19, amp: 0.46 },   // 33 px – gedaempft, sonst wirkt die Flaeche fleckig
  { nx: 33, ny: 33, amp: 1.00 },   // 19 px – Mittelband, traegt das Maximum
  { nx: 57, ny: 57, amp: 1.15 },   // 11 px – Mittelband, traegt das Maximum
  { nx: 209, ny: 209, amp: 0.62 }, // 3 px – Korn, bewusst gedaempft (siehe BLADE_MIX)
];

/** Der Farbton wandert traeger als die Helligkeit, sonst zerfaellt die Flaeche in Farbrauschen. */
const BASE_HUE_OCTAVES = [
  { nx: 3, ny: 3, amp: 1.0 },
  { nx: 11, ny: 11, amp: 0.6 },
  { nx: 19, ny: 19, amp: 0.3 },
  { nx: 57, ny: 57, amp: 0.12 },
];

/**
 * Halmkorn: zwei stark anisotrope Felder, quer und laengs. Beide bleiben exakt kachelbar, weil
 * nur die Gitteraufloesungen pro Achse unterschiedlich sind, nicht die Abtastgeometrie. Eine
 * niederfrequente Maske blendet zwischen ihnen und erzeugt so wechselnde Halmrichtungen.
 */
const BLADE_FIELD_A = [
  { nx: 33, ny: 57, amp: 1.0 },  // 19 px lang, 11 px breit
  { nx: 19, ny: 33, amp: 0.6 },  // 33 px lang, 19 px breit
];
const BLADE_FIELD_B = [
  { nx: 57, ny: 33, amp: 1.0 },
  { nx: 33, ny: 19, amp: 0.6 },
];
const BLADE_MASK_OCTAVE = { nx: 11, ny: 11, amp: 1.0 };
/**
 * Anteil des Halmkorns am Helligkeitsfeld der Basiskachel. Bewusst niedrig: Ein hoher Anteil in
 * Verbindung mit stark gestreckten Feldern loest die Flaeche in einzeln erkennbare Striche auf.
 * Die Streckung bleibt deshalb bei etwa 1,7:1 und dient nur noch als Richtungsandeutung.
 */
const BLADE_MIX = 0.16;

/** Oktavleiter der Detailkachel; Teiler von 512, Wellenlaenge 512/n px. */
const DETAIL_OCTAVES = [
  { nx: 8, ny: 8, amp: 0.32 },     // 64 px – Buescheln/Flecken
  { nx: 16, ny: 16, amp: 0.48 },   // 32 px – Buescheln, gedaempft gegen Fleckigkeit
  { nx: 32, ny: 32, amp: 0.90 },   // 16 px – Mittelband
  { nx: 64, ny: 64, amp: 0.85 },   // 8 px
  { nx: 128, ny: 128, amp: 0.52 }, // 4 px
  { nx: 256, ny: 256, amp: 0.22 }, // 2 px – Korn, nur noch als Andeutung
];
/** Wie stark die Detailkachel maximal abdunkelt (0,075 = bis 92,5 % Helligkeit). */
const DETAIL_DEPTH = 0.075;
/** Leichte Farbtonverschiebung der Detailkachel, damit sie nicht nur Helligkeit moduliert. */
const DETAIL_TINT_DEPTH = 0.012;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

/**
 * Periodisches Value-Noise. Die Gitterindizes werden modulo `nx`/`ny` genommen; solange `nx` die
 * Kachelbreite und `ny` die Kachelhoehe teilt, ist das Ergebnis in beiden Achsen nahtlos.
 */
function valueNoiseField(size, nx, ny, rng) {
  const lattice = new Float64Array(nx * ny);
  for (let i = 0; i < lattice.length; i += 1) lattice[i] = rng();

  const out = new Float64Array(size * size);
  for (let y = 0; y < size; y += 1) {
    const v = (y / size) * ny;
    const y0 = Math.floor(v);
    const fy = smoothstep(v - y0);
    const ya = (y0 % ny) * nx;
    const yb = ((y0 + 1) % ny) * nx;
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * nx;
      const x0 = Math.floor(u);
      const fx = smoothstep(u - x0);
      const xa = x0 % nx;
      const xb = (x0 + 1) % nx;
      const top = lattice[ya + xa] + (lattice[ya + xb] - lattice[ya + xa]) * fx;
      const bottom = lattice[yb + xa] + (lattice[yb + xb] - lattice[yb + xa]) * fx;
      out[y * size + x] = (top + (bottom - top) * fy) * 2 - 1;
    }
  }
  return out;
}

function sumOctaves(size, octaves, rng) {
  const out = new Float64Array(size * size);
  for (const octave of octaves) {
    const field = valueNoiseField(size, octave.nx, octave.ny, rng);
    for (let i = 0; i < out.length; i += 1) out[i] += field[i] * octave.amp;
  }
  return out;
}

/** Auf Mittelwert 0 und Standardabweichung 1 bringen, damit die Amplituden oben absolut wirken. */
function normalize(field) {
  let mean = 0;
  for (let i = 0; i < field.length; i += 1) mean += field[i];
  mean /= field.length;
  let variance = 0;
  for (let i = 0; i < field.length; i += 1) variance += (field[i] - mean) ** 2;
  const sd = Math.sqrt(variance / field.length) || 1;
  for (let i = 0; i < field.length; i += 1) field[i] = (field[i] - mean) / sd;
  return field;
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * Feines Korn ist der teuerste PNG-Inhalt: unquantisiert wiegt die Basiskachel ein Vielfaches.
 * Eine 256-Farben-Palette drueckt sie auf rund ein Viertel bei einem Quantisierungsfehler weit
 * unterhalb der Kanalstreuung. Der Browser dekodiert Paletten-PNGs ohnehin nach RGBA, an der
 * GPU-Textur aendert sich nichts.
 *
 * `dither: 0` ist Absicht: Fehlerdiffusion streut ein Pixelraster ueber die Flaeche, und genau
 * dieses Raster ist auf einer ruhigen Grasflaeche als Grieß sichtbar. Der Farbumfang ist mit
 * einem schmalen Gruenband klein genug, dass 256 Farben auch ohne Dithering nicht bandeln.
 */
async function writePng(target, size, rgb) {
  await sharp(Buffer.from(rgb), { raw: { width: size, height: size, channels: 3 } })
    .png({ palette: true, colours: 256, dither: 0, compressionLevel: 9 })
    .toFile(target);
  console.log(`geschrieben: ${target} (${size}x${size})`);
}

async function generateBaseTile() {
  const size = BASE_SIZE;
  const rng = mulberry32(0x6a5c11);

  const value = normalize(sumOctaves(size, BASE_VALUE_OCTAVES, rng));
  const bladeA = normalize(sumOctaves(size, BLADE_FIELD_A, rng));
  const bladeB = normalize(sumOctaves(size, BLADE_FIELD_B, rng));
  const bladeMask = valueNoiseField(size, BLADE_MASK_OCTAVE.nx, BLADE_MASK_OCTAVE.ny, rng);
  const hue = normalize(sumOctaves(size, BASE_HUE_OCTAVES, rng));

  const blades = new Float64Array(size * size);
  for (let i = 0; i < blades.length; i += 1) {
    const mix = bladeMask[i] * 0.5 + 0.5;
    blades[i] = bladeA[i] * (1 - mix) + bladeB[i] * mix;
  }
  normalize(blades);

  const combined = new Float64Array(size * size);
  for (let i = 0; i < combined.length; i += 1) {
    combined[i] = value[i] * (1 - BLADE_MIX) + blades[i] * BLADE_MIX;
  }
  normalize(combined);

  const rgb = Buffer.alloc(size * size * 3);
  for (let i = 0; i < combined.length; i += 1) {
    const warmth = Math.max(-1, Math.min(1, hue[i] * BASE_HUE_AMOUNT)) * 0.5 + 0.5;
    const level = (1 + combined[i] * BASE_VALUE_AMOUNT) * DETAIL_MEAN_COMPENSATION;
    for (let channel = 0; channel < 3; channel += 1) {
      const base = COLOR_COOL[channel] + (COLOR_WARM[channel] - COLOR_COOL[channel]) * warmth;
      rgb[i * 3 + channel] = clamp255(base * level);
    }
  }

  await writePng(BASE_TARGET, size, rgb);
}

async function generateDetailTile() {
  const size = DETAIL_SIZE;
  const rng = mulberry32(0x1d3f97);

  const detail = normalize(sumOctaves(size, DETAIL_OCTAVES, rng));
  const tint = normalize(sumOctaves(size, [{ nx: 8, ny: 8, amp: 1 }, { nx: 32, ny: 32, amp: 0.4 }], rng));

  const rgb = Buffer.alloc(size * size * 3);
  for (let i = 0; i < detail.length; i += 1) {
    // Auf [-1, 1] begrenzen: einzelne Ausreisser duerfen die Kachel nicht ueber Weiss hinaus
    // oder in harte schwarze Punkte treiben.
    const d = Math.max(-1, Math.min(1, detail[i]));
    const t = Math.max(-1, Math.min(1, tint[i]));
    const level = 1 - DETAIL_DEPTH * (d * 0.5 + 0.5);
    rgb[i * 3 + 0] = clamp255(255 * level * (1 + t * DETAIL_TINT_DEPTH));
    rgb[i * 3 + 1] = clamp255(255 * level);
    rgb[i * 3 + 2] = clamp255(255 * level * (1 - t * DETAIL_TINT_DEPTH));
  }

  await writePng(DETAIL_TARGET, size, rgb);
}

await generateBaseTile();
await generateDetailTile();
