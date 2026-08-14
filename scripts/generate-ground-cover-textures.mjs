import sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Erzeugt die Ground-Cover-Texturen: grosse, moosige Flecken, die in der Arena ueber der
 * Dirt/Gras-Grenze liegen (siehe `src/arena/GroundCoverLayer.ts`).
 *
 * Warum die Rohbilder ueberhaupt ueberarbeitet werden muessen: Sie sind als ausgeschnittene
 * Objekte gezeichnet. Ihre Alpha ist zwar keine harte 1-px-Kante, aber der Uebergang laeuft nur
 * ueber 7-16 px bei 1254 px Bildbreite – auf einem 208 px grossen Fleck sind das 3-4 Bildschirm-
 * pixel. Das liest sich als Aufkleber, und genau das soll die Schicht nicht sein. Ein blosser
 * Weichzeichner hilft dabei nicht: Ein Radius, der bei dieser Bildgroesse etwas aendert, zieht
 * gleichzeitig die Kontur weg und ersetzt den Aufkleber durch einen Airbrush-Hof.
 *
 * Die Alpha wird deshalb aus einem Distanzfeld *neu aufgebaut*. Die Federbreite ist ein Anteil
 * des groessten einbeschriebenen Radius des jeweiligen Bildes, nicht eine feste Pixelzahl: Die
 * Vorlagen unterscheiden sich in der Merkmalsdicke um mehr als das Dreifache (grosser Klumpen
 * gegen duenne Sichel), eine konstante Feder wuerde die duennen Formen vollstaendig aufloesen.
 *
 * Zwei Rauschfelder kommen dazu:
 * - Kantenrauschen verschiebt die Rampenlage lokal. Ohne das ist die weiche Kante gleichmaessig
 *   breit und liest sich als Vignette – derselbe Fehler in anderer Tonart.
 * - Ein fBm-Feld duennt das Innere aus, sodass der Fleck dichte und lichte Zonen bekommt statt
 *   einer geschlossenen Flaeche. Das ist der Unterschied zwischen "Moos" und "gruener Klecks".
 *
 * Die braunen Adern der Vorlagen bleiben bewusst erhalten. Gemessen liegen die Vorlagen mit
 * Rec.709-Luma 66-77 fast exakt auf der Luma der Graskachel (70,8) und deutlich unter der des
 * Dirt-Bodens (84,4). Auf Gras wirken sie damit als reine Farbtonverschiebung, auf Dirt als klar
 * lesbare Abdunklung – und die Adern sind der einzige Bildinhalt, der den Fleck an die Dirt-Seite
 * bindet. Der Farbangleich zieht deshalb nur schwach zur Grasfarbe.
 *
 * Aufruf: node scripts/generate-ground-cover-textures.mjs [--contact-sheet]
 */

const SOURCE_DIR = path.join('tools', 'source-art', 'groundcover');
const OUT_DIR = path.join('public', 'assets', 'sprites', 'groundcover');
const GRASS_TILE = path.join('public', 'assets', 'sprites', 'gras_bg_tile.png');
const CONTACT_SHEET = path.join(SOURCE_DIR, '_preview.png');

const SOURCE_FILES = ['01.png', '02.png', '03.png', '04.png', '05.png', '06.png', '07.png', '08.png'];

/**
 * Laengere Ausgabekante. Das Spiel laeuft mit `smoothPixelArt: true`, was global lineare Filterung
 * erzwingt, aber **keine** Mipmaps anlegt (`mipmapFilter` bleibt leer). Minifizierung ueber etwa
 * das 2,5-fache faengt deshalb an zu flimmern. Die Flecken werden mit 96-352 px gestempelt, 384 px
 * Quellkante haelt den Faktor unter 2,4. Acht Texturen kosten so rund 4,7 MB VRAM.
 */
const LONG_SIDE = 384;

/** Alphaschwelle, die die Silhouette definiert – die gemessene Mitte der bimodalen Verteilung. */
const SILHOUETTE_THRESHOLD = 128;
/** Alphaschwelle fuer die Zuschnitte. Bewusst niedriger, damit die Feder nicht abgeschnitten wird. */
const TRIM_THRESHOLD = 3;

/**
 * Reichweite, mit der Innenfarbe nach aussen gedrueckt wird. Die Vorlagen tragen im aeusseren
 * 8-px-Band einen warmen Saum (R-G etwa +11 gegen -8 im Kern). Nach dem Alpha-Neuaufbau liegt dort
 * ohnehin fast keine Deckkraft mehr; die Verdraengung ist die billige Absicherung dagegen, dass
 * beim Verkleinern doch noch Saumfarbe nach innen gemittelt wird.
 */
const RGB_BLEED_PX = 12;

/**
 * Federbreite als Anteil der typischen Merkmalsdicke. Das ist der eine Wert, der ueber
 * "Aufkleber" gegen "loest sich auf" entscheidet: er ersetzt die gemessenen 3-4 Bildschirmpixel
 * Uebergang der Vorlagen durch gut das Zehnfache.
 */
const FEATHER_FRACTION = 0.45;
/**
 * Bezugsgroesse der Feder ist das 85. Perzentil der Innenabstaende, nicht deren Maximum. Das
 * Maximum ist der eine dickste Punkt der Form; bei einer duennen Sichel liegt fast die gesamte
 * Flaeche weit darunter, und eine daran bemessene Feder loescht sie vollstaendig aus. Das
 * Perzentil beschreibt dagegen die tatsaechlich vorherrschende Dicke.
 */
const FEATHER_SCALE_PERCENTILE = 0.85;
/** Totzone ganz aussen. Ohne sie legt sich ein flaechiger Hauch exakt auf die alte Kontur. */
const FEATHER_FLOOR_FRACTION = 0.06;
/**
 * Exponent der Alpharampe. Konkav (< 1): steigt schnell an und flacht dann ab. Ohne ihn bliebe
 * bei dieser Federbreite nur ein Bruchteil der Flaeche nahe voller Deckkraft, der Fleck waere
 * durchgehend blass.
 */
const ALPHA_RAMP_GAMMA = 0.7;

/** Anteil der Federbreite, um den die Rampenlage lokal wandert. */
const EDGE_NOISE_AMPLITUDE = 0.35;
/** Wellenlaenge des Kantenrauschens als Anteil der laengeren Bildkante. */
const EDGE_NOISE_WAVELENGTH_FRACTION = 0.1;

/** fBm des Innenfeldes; Wellenlaengen als Anteil der laengeren Bildkante. */
const HOLE_OCTAVES = [
  { wavelength: 0.26, amp: 1.0 },
  { wavelength: 0.13, amp: 0.5 },
  { wavelength: 0.065, amp: 0.25 },
];
/** Etwa 40 % des Inneren werden zur Untergrenze gezogen. */
const HOLE_THRESHOLD = 0.42;
/** Bewusst weich – harte Lochraender waeren derselbe Aufkleber-Effekt eine Groessenordnung kleiner. */
const HOLE_SOFTNESS = 0.18;
/** Loecher perforieren nie vollstaendig, der Fleck bleibt ein Koerper statt einer Spitzendecke. */
const INTERIOR_ALPHA_FLOOR = 0.35;
/**
 * Tiefe, ab der die Perforation voll wirkt, als Vielfaches der Federbreite. Duenne Auslaeufer und
 * Sicheln liegen vollstaendig innerhalb ihrer eigenen Feder; wuerde das Lochfeld dort ebenso
 * angreifen, blieben von ihnen nur noch Fetzen uebrig. Loecher gehoeren in breite Flaechen.
 */
const HOLE_DEPTH_RAMP = 2.0;

/** Wie weit die Moosfarbe zur mittleren Grasfarbe gezogen wird – luma-erhaltend. */
const GRASS_GRADE_STRENGTH = 0.25;

const SEED = 20260814;

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

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Nicht kachelndes Value-Noise mit Gitterweite `wavelength` in Pixeln. Anders als bei den
 * Bodenkacheln muss hier nichts nahtlos sein – die Flecken werden einzeln gestempelt.
 */
function valueNoiseField(width, height, wavelength, rng) {
  const nx = Math.max(2, Math.ceil(width / wavelength) + 1);
  const ny = Math.max(2, Math.ceil(height / wavelength) + 1);
  const lattice = new Float64Array(nx * ny);
  for (let i = 0; i < lattice.length; i += 1) lattice[i] = rng();

  const out = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const v = y / wavelength;
    const y0 = Math.min(ny - 2, Math.floor(v));
    const fy = smoothstep(v - y0);
    const rowA = y0 * nx;
    const rowB = (y0 + 1) * nx;
    for (let x = 0; x < width; x += 1) {
      const u = x / wavelength;
      const x0 = Math.min(nx - 2, Math.floor(u));
      const fx = smoothstep(u - x0);
      const top = lattice[rowA + x0] + (lattice[rowA + x0 + 1] - lattice[rowA + x0]) * fx;
      const bottom = lattice[rowB + x0] + (lattice[rowB + x0 + 1] - lattice[rowB + x0]) * fx;
      out[y * width + x] = top + (bottom - top) * fy;
    }
  }
  return out;
}

/** Summiert Oktaven und normiert das Ergebnis auf [0, 1]. */
function fbmField(width, height, octaves, longSide, rng) {
  const out = new Float64Array(width * height);
  let total = 0;
  for (const octave of octaves) {
    const field = valueNoiseField(width, height, octave.wavelength * longSide, rng);
    for (let i = 0; i < out.length; i += 1) out[i] += field[i] * octave.amp;
    total += octave.amp;
  }
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < out.length; i += 1) {
    out[i] /= total;
    if (out[i] < min) min = out[i];
    if (out[i] > max) max = out[i];
  }
  const span = max - min || 1;
  for (let i = 0; i < out.length; i += 1) out[i] = (out[i] - min) / span;
  return out;
}

/**
 * Chamfer-Distanztransformation zur naechsten Nullzelle. Zwei Durchlaeufe mit 3x3-Maske,
 * Diagonalgewicht sqrt(2).
 */
function chamferDistance(seedIsZero, width, height) {
  const INF = 1e9;
  const d = new Float64Array(width * height);
  for (let i = 0; i < d.length; i += 1) d[i] = seedIsZero[i] ? 0 : INF;

  const D = 1;
  const DD = Math.SQRT2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (d[i] === 0) continue;
      let best = d[i];
      if (x > 0) best = Math.min(best, d[i - 1] + D);
      if (y > 0) {
        best = Math.min(best, d[i - width] + D);
        if (x > 0) best = Math.min(best, d[i - width - 1] + DD);
        if (x < width - 1) best = Math.min(best, d[i - width + 1] + DD);
      }
      d[i] = best;
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = y * width + x;
      if (d[i] === 0) continue;
      let best = d[i];
      if (x < width - 1) best = Math.min(best, d[i + 1] + D);
      if (y < height - 1) {
        best = Math.min(best, d[i + width] + D);
        if (x < width - 1) best = Math.min(best, d[i + width + 1] + DD);
        if (x > 0) best = Math.min(best, d[i + width - 1] + DD);
      }
      d[i] = best;
    }
  }
  // Enthaelt das Bild ueberhaupt keine Nullzelle, bleibt alles auf INF. Auf einen endlichen Wert
  // ziehen, damit die spaetere Arithmetik nicht ueberlaeuft.
  let finiteMax = 0;
  for (let i = 0; i < d.length; i += 1) if (d[i] < INF && d[i] > finiteMax) finiteMax = d[i];
  for (let i = 0; i < d.length; i += 1) if (d[i] >= INF) d[i] = finiteMax;
  return d;
}

/**
 * Vorzeichenbehaftetes Distanzfeld der Silhouette: innen positiv, aussen negativ.
 *
 * Das Vorzeichen ist nicht Kosmetik. Mit einem reinen Innenabstand liegt die gesamte Aussenflaeche
 * bei exakt 0, und das additive Kantenrauschen hebt sie dort flaechig an, wo es positiv ist – im
 * Bild erscheinen dann schwache Schleier weit ausserhalb der Form. Mit Vorzeichen faellt der Wert
 * nach aussen weiter ab, das Rauschen verschiebt die Kante lokal nach innen und aussen, statt
 * irgendwo Deckkraft aus dem Nichts zu erzeugen.
 */
function signedSilhouetteDistance(alpha, width, height, threshold) {
  const outside = new Uint8Array(width * height);
  const inside = new Uint8Array(width * height);
  for (let i = 0; i < outside.length; i += 1) {
    const isInside = alpha[i] >= threshold;
    outside[i] = isInside ? 0 : 1;
    inside[i] = isInside ? 1 : 0;
  }
  const distanceIn = chamferDistance(outside, width, height);
  const distanceOut = chamferDistance(inside, width, height);
  const signed = new Float64Array(width * height);
  for (let i = 0; i < signed.length; i += 1) signed[i] = distanceIn[i] - distanceOut[i];
  return signed;
}

/** `fraction`-Perzentil aller positiven Werte des Feldes. */
function positivePercentile(field, fraction) {
  const positives = [];
  for (let i = 0; i < field.length; i += 1) if (field[i] > 0) positives.push(field[i]);
  if (positives.length === 0) return 0;
  positives.sort((a, b) => a - b);
  return positives[Math.min(positives.length - 1, Math.floor(positives.length * fraction))];
}

/**
 * Drueckt die Farbe deckender Pixel nach aussen ueber die halbtransparenten. Alpha bleibt
 * unangetastet; nur RGB wird ersetzt.
 */
function bleedRgb(data, width, height, iterations) {
  const solid = new Uint8Array(width * height);
  for (let i = 0; i < solid.length; i += 1) solid[i] = data[i * 4 + 3] >= 200 ? 1 : 0;

  for (let pass = 0; pass < iterations; pass += 1) {
    const grown = solid.slice();
    let changed = false;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        if (solid[i]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const j = ny * width + nx;
            if (!solid[j]) continue;
            r += data[j * 4];
            g += data[j * 4 + 1];
            b += data[j * 4 + 2];
            n += 1;
          }
        }
        if (n === 0) continue;
        data[i * 4] = Math.round(r / n);
        data[i * 4 + 1] = Math.round(g / n);
        data[i * 4 + 2] = Math.round(b / n);
        grown[i] = 1;
        changed = true;
      }
    }
    solid.set(grown);
    if (!changed) break;
  }
}

/** Bounding-Box aller Pixel mit `alpha > threshold`. */
function alphaBounds(data, width, height, threshold) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] <= threshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { left: 0, top: 0, width, height };
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function cropRgba(data, width, box) {
  const out = Buffer.alloc(box.width * box.height * 4);
  for (let y = 0; y < box.height; y += 1) {
    const from = ((box.top + y) * width + box.left) * 4;
    data.copy(out, y * box.width * 4, from, from + box.width * 4);
  }
  return out;
}

async function readGrassMean() {
  const stats = await sharp(GRASS_TILE).stats();
  return [stats.channels[0].mean, stats.channels[1].mean, stats.channels[2].mean];
}

async function processSource(fileName, index, grassMean) {
  const source = path.join(SOURCE_DIR, fileName);
  const { data: original, info } = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Auf einem eigenen Buffer arbeiten: `data` aus sharp ist bereits eine Kopie, wird aber
  // in-place veraendert und danach noch einmal zugeschnitten.
  const data = Buffer.from(original);
  const width = info.width;
  const height = info.height;

  bleedRgb(data, width, height, RGB_BLEED_PX);

  const trimmed = alphaBounds(data, width, height, TRIM_THRESHOLD);
  const cropped = cropRgba(data, width, trimmed);
  const cw = trimmed.width;
  const ch = trimmed.height;

  const alpha = new Uint8Array(cw * ch);
  for (let i = 0; i < alpha.length; i += 1) alpha[i] = cropped[i * 4 + 3];

  const distance = signedSilhouetteDistance(alpha, cw, ch, SILHOUETTE_THRESHOLD);
  const thickness = positivePercentile(distance, FEATHER_SCALE_PERCENTILE);

  const longSide = Math.max(cw, ch);
  const rng = mulberry32(SEED + index * 7919);
  const edgeNoise = valueNoiseField(cw, ch, EDGE_NOISE_WAVELENGTH_FRACTION * longSide, rng);
  const holeNoise = fbmField(cw, ch, HOLE_OCTAVES, longSide, rng);

  const feather = Math.max(1, FEATHER_FRACTION * thickness);
  const floor = FEATHER_FLOOR_FRACTION * thickness;
  const span = Math.max(1e-6, feather - floor);

  for (let i = 0; i < alpha.length; i += 1) {
    const wobble = EDGE_NOISE_AMPLITUDE * feather * (edgeNoise[i] * 2 - 1);
    const t = clamp01((distance[i] + wobble - floor) / span);
    const shape = Math.pow(smoothstep(t), ALPHA_RAMP_GAMMA);
    const hole = clamp01((holeNoise[i] - (HOLE_THRESHOLD - HOLE_SOFTNESS)) / (2 * HOLE_SOFTNESS));
    const perforated = INTERIOR_ALPHA_FLOOR + (1 - INTERIOR_ALPHA_FLOOR) * smoothstep(hole);
    const depth = clamp01(distance[i] / (HOLE_DEPTH_RAMP * feather));
    const body = 1 + (perforated - 1) * smoothstep(depth);
    cropped[i * 4 + 3] = clamp255(shape * body * 255);

    // Farbangleich: zur Grasfarbe mischen, danach auf die urspruengliche Luma zurueckskalieren.
    // So wandert nur der Farbton, und der gemessene Luma-Gleichstand mit der Graskachel bleibt.
    const r = cropped[i * 4];
    const g = cropped[i * 4 + 1];
    const b = cropped[i * 4 + 2];
    const before = luma(r, g, b);
    const mr = r + (grassMean[0] - r) * GRASS_GRADE_STRENGTH;
    const mg = g + (grassMean[1] - g) * GRASS_GRADE_STRENGTH;
    const mb = b + (grassMean[2] - b) * GRASS_GRADE_STRENGTH;
    const after = luma(mr, mg, mb) || 1;
    const gain = before / after;
    cropped[i * 4] = clamp255(mr * gain);
    cropped[i * 4 + 1] = clamp255(mg * gain);
    cropped[i * 4 + 2] = clamp255(mb * gain);
  }

  const rebuilt = alphaBounds(cropped, cw, ch, TRIM_THRESHOLD);
  const finalData = cropRgba(cropped, cw, rebuilt);

  const outName = `ground_cover_${String(index + 1).padStart(2, '0')}.png`;
  const target = path.join(OUT_DIR, outName);
  await sharp(finalData, { raw: { width: rebuilt.width, height: rebuilt.height, channels: 4 } })
    .resize({
      width: rebuilt.width >= rebuilt.height ? LONG_SIDE : undefined,
      height: rebuilt.height > rebuilt.width ? LONG_SIDE : undefined,
      fit: 'inside',
      kernel: 'lanczos3',
    })
    .png({ compressionLevel: 9 })
    .toFile(target);

  const written = await sharp(target).metadata();
  console.log(
    `${outName}: ${written.width}x${written.height}  `
    + `dicke(p85)=${thickness.toFixed(0)}px feder=${feather.toFixed(0)}px  (aus ${fileName} ${width}x${height})`,
  );
  return target;
}

/** Kontaktbogen ueber Grasfarbe – die Alpha laesst sich nur vor einem Hintergrund beurteilen. */
async function writeContactSheet(targets, grassMean) {
  const cell = LONG_SIDE;
  const cols = 4;
  const rows = Math.ceil(targets.length / cols);
  const background = {
    create: {
      width: cols * cell,
      height: rows * cell,
      channels: 4,
      background: {
        r: Math.round(grassMean[0]),
        g: Math.round(grassMean[1]),
        b: Math.round(grassMean[2]),
        alpha: 1,
      },
    },
  };
  const composites = [];
  for (let i = 0; i < targets.length; i += 1) {
    const meta = await sharp(targets[i]).metadata();
    composites.push({
      input: targets[i],
      left: (i % cols) * cell + Math.round((cell - meta.width) / 2),
      top: Math.floor(i / cols) * cell + Math.round((cell - meta.height) / 2),
    });
  }
  await sharp(background).composite(composites).png().toFile(CONTACT_SHEET);
  console.log(`Kontaktbogen: ${CONTACT_SHEET}`);
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const grassMean = await readGrassMean();
  console.log(`Grasmittelfarbe: ${grassMean.map((v) => v.toFixed(1)).join(', ')}`);

  const targets = [];
  for (let index = 0; index < SOURCE_FILES.length; index += 1) {
    targets.push(await processSource(SOURCE_FILES[index], index, grassMean));
  }

  if (process.argv.includes('--contact-sheet')) {
    await writeContactSheet(targets, grassMean);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
