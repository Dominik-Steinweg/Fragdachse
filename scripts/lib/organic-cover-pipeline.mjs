import sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Gemeinsame Aufbereitungsstrecke fuer die grossflaechigen, organischen Bewuchstexturen:
 * Ground Cover auf dem Boden (`generate-ground-cover-textures.mjs`) und Moos auf Fels
 * (`generate-rock-moss-textures.mjs`). Beide Aufrufer sind nur noch Profile.
 *
 * Warum die Rohbilder ueberhaupt ueberarbeitet werden muessen: Sie sind als ausgeschnittene
 * Objekte gezeichnet. Ihre Alpha ist zwar keine harte 1-px-Kante, aber der Uebergang laeuft nur
 * ueber 7-16 px bei 1254 px Bildbreite – auf einem 208 px grossen Fleck sind das 3-4 Bildschirm-
 * pixel. Das liest sich als Aufkleber. Ein blosser Weichzeichner hilft dabei nicht: Ein Radius,
 * der bei dieser Bildgroesse etwas aendert, zieht gleichzeitig die Kontur weg und ersetzt den
 * Aufkleber durch einen Airbrush-Hof.
 *
 * Die Alpha wird deshalb aus einem vorzeichenbehafteten Distanzfeld *neu aufgebaut*. Die
 * Federbreite ist ein Anteil der typischen Merkmalsdicke des jeweiligen Bildes, nicht eine feste
 * Pixelzahl: Die Vorlagen unterscheiden sich in der Dicke um mehr als das Dreifache (grosser
 * Klumpen gegen duenne Sichel), eine konstante Feder wuerde die duennen Formen aufloesen.
 *
 * Zwei Rauschfelder kommen dazu:
 * - Kantenrauschen verschiebt die Rampenlage lokal. Ohne das ist die weiche Kante gleichmaessig
 *   breit und liest sich als Vignette – derselbe Fehler in anderer Tonart.
 * - Ein fBm-Feld duennt das Innere aus, sodass der Fleck dichte und lichte Zonen bekommt statt
 *   einer geschlossenen Flaeche. Das ist der Unterschied zwischen "Moos" und "gruener Klecks".
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

export function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

export function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Nicht kachelndes Value-Noise mit Gitterweite `wavelength` in Pixeln. Anders als bei den
 * Bodenkacheln muss hier nichts nahtlos sein – die Flecken werden einzeln gestempelt.
 */
export function valueNoiseField(width, height, wavelength, rng) {
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
export function fbmField(width, height, octaves, longSide, rng) {
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
export function chamferDistance(seedIsZero, width, height) {
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
export function signedSilhouetteDistance(alpha, width, height, threshold) {
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
export function positivePercentile(field, fraction) {
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
export function bleedRgb(data, width, height, iterations) {
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
export function alphaBounds(data, width, height, threshold) {
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

export function cropRgba(data, width, box) {
  const out = Buffer.alloc(box.width * box.height * 4);
  for (let y = 0; y < box.height; y += 1) {
    const from = ((box.top + y) * width + box.left) * 4;
    data.copy(out, y * box.width * 4, from, from + box.width * 4);
  }
  return out;
}

/**
 * Mittelfarbe einer Referenztextur. Nur deckende Pixel zaehlen: Bei Sheets mit Alpha (Fels) traegt
 * der transparente Bereich beliebiges RGB und wuerde den Mittelwert sonst verfaelschen.
 */
export async function readOpaqueMeanColor(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < info.width * info.height; i += 1) {
    if (data[i * 4 + 3] < 128) continue;
    r += data[i * 4];
    g += data[i * 4 + 1];
    b += data[i * 4 + 2];
    n += 1;
  }
  if (n === 0) return [128, 128, 128];
  return [r / n, g / n, b / n];
}

/**
 * Quelldateien sind alle rein numerisch benannten PNGs des Quellordners, aufsteigend sortiert.
 * Die Nummer ist der Vertrag: Aus `07.png` wird immer `<prefix>07.png`, unabhaengig davon, wie
 * viele Dateien daneben liegen. Nur so bleiben die Variantentabellen im Spielcode gueltig, wenn
 * spaeter weitere Vorlagen dazukommen. `_preview.png` faellt durch das Raster.
 */
export async function listNumberedSources(sourceDir) {
  const entries = await fs.readdir(sourceDir);
  const numbered = entries
    .map((name) => ({ name, match: /^(\d+)\.png$/i.exec(name) }))
    .filter((entry) => entry.match !== null)
    .map((entry) => ({ name: entry.name, index: Number(entry.match[1]) }))
    .sort((a, b) => a.index - b.index);
  if (numbered.length === 0) throw new Error(`Keine nummerierten Quelldateien in ${sourceDir}`);
  return numbered;
}

async function processSource(profile, fileName, outputIndex, gradeTarget) {
  const source = path.join(profile.sourceDir, fileName);
  const { data: original, info } = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const data = Buffer.from(original);
  const width = info.width;
  const height = info.height;

  bleedRgb(data, width, height, profile.rgbBleedPx);

  const trimmed = alphaBounds(data, width, height, profile.trimThreshold);
  const cropped = cropRgba(data, width, trimmed);
  const cw = trimmed.width;
  const ch = trimmed.height;

  const alpha = new Uint8Array(cw * ch);
  for (let i = 0; i < alpha.length; i += 1) alpha[i] = cropped[i * 4 + 3];

  const distance = signedSilhouetteDistance(alpha, cw, ch, profile.silhouetteThreshold);
  const thickness = positivePercentile(distance, profile.featherScalePercentile);

  const longSide = Math.max(cw, ch);
  // Rauschsaat an der Ausgabenummer festgemacht, nicht an der Position in der Dateiliste: Eine
  // bereits erzeugte und abgenommene Textur darf sich nicht aendern, nur weil daneben eine
  // weitere Vorlage dazugekommen ist.
  const rng = mulberry32(profile.seed + (outputIndex - 1) * 7919);
  const edgeNoise = valueNoiseField(cw, ch, profile.edgeNoiseWavelengthFraction * longSide, rng);
  const holeNoise = fbmField(cw, ch, profile.holeOctaves, longSide, rng);

  const feather = Math.max(1, profile.featherFraction * thickness);
  const floor = profile.featherFloorFraction * thickness;
  const span = Math.max(1e-6, feather - floor);

  for (let i = 0; i < alpha.length; i += 1) {
    const wobble = profile.edgeNoiseAmplitude * feather * (edgeNoise[i] * 2 - 1);
    const t = clamp01((distance[i] + wobble - floor) / span);
    const shape = Math.pow(smoothstep(t), profile.alphaRampGamma);
    const hole = clamp01((holeNoise[i] - (profile.holeThreshold - profile.holeSoftness)) / (2 * profile.holeSoftness));
    const perforated = profile.interiorAlphaFloor + (1 - profile.interiorAlphaFloor) * smoothstep(hole);
    const depth = clamp01(distance[i] / (profile.holeDepthRamp * feather));
    const body = 1 + (perforated - 1) * smoothstep(depth);
    cropped[i * 4 + 3] = clamp255(shape * body * 255);

    // Farbangleich: zur Referenzfarbe mischen, danach auf die urspruengliche Luma zurueckskalieren.
    // So wandert nur der Farbton, und der Luma-Bezug zum Untergrund bleibt erhalten.
    const r = cropped[i * 4];
    const g = cropped[i * 4 + 1];
    const b = cropped[i * 4 + 2];
    const before = luma(r, g, b);
    const mr = r + (gradeTarget[0] - r) * profile.gradeStrength;
    const mg = g + (gradeTarget[1] - g) * profile.gradeStrength;
    const mb = b + (gradeTarget[2] - b) * profile.gradeStrength;
    const after = luma(mr, mg, mb) || 1;
    const gain = before / after;
    cropped[i * 4] = clamp255(mr * gain);
    cropped[i * 4 + 1] = clamp255(mg * gain);
    cropped[i * 4 + 2] = clamp255(mb * gain);
  }

  const rebuilt = alphaBounds(cropped, cw, ch, profile.trimThreshold);
  const finalData = cropRgba(cropped, cw, rebuilt);

  const outName = `${profile.outPrefix}${String(outputIndex).padStart(2, '0')}.png`;
  const target = path.join(profile.outDir, outName);
  await sharp(finalData, { raw: { width: rebuilt.width, height: rebuilt.height, channels: 4 } })
    .resize({
      width: rebuilt.width >= rebuilt.height ? profile.longSide : undefined,
      height: rebuilt.height > rebuilt.width ? profile.longSide : undefined,
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

/** Kontaktbogen ueber der Referenzfarbe – die Alpha laesst sich nur vor einem Hintergrund beurteilen. */
async function writeContactSheet(profile, targets, background) {
  const cell = profile.longSide;
  const cols = 4;
  const rows = Math.ceil(targets.length / cols);
  const composites = [];
  for (let i = 0; i < targets.length; i += 1) {
    const meta = await sharp(targets[i]).metadata();
    composites.push({
      input: targets[i],
      left: (i % cols) * cell + Math.round((cell - meta.width) / 2),
      top: Math.floor(i / cols) * cell + Math.round((cell - meta.height) / 2),
    });
  }
  await sharp({
    create: {
      width: cols * cell,
      height: rows * cell,
      channels: 4,
      background: {
        r: Math.round(background[0]),
        g: Math.round(background[1]),
        b: Math.round(background[2]),
        alpha: 1,
      },
    },
  }).composite(composites).png().toFile(profile.contactSheet);
  console.log(`Kontaktbogen: ${profile.contactSheet}`);
}

export async function runOrganicCoverPipeline(profile) {
  await fs.mkdir(profile.outDir, { recursive: true });
  const gradeTarget = await readOpaqueMeanColor(profile.gradeTargetFile);
  console.log(`Referenzfarbe (${profile.gradeTargetFile}): ${gradeTarget.map((v) => v.toFixed(1)).join(', ')}`);

  const sources = await listNumberedSources(profile.sourceDir);
  const targets = [];
  for (const { name, index } of sources) {
    targets.push(await processSource(profile, name, index, gradeTarget));
  }

  if (process.argv.includes('--contact-sheet')) {
    await writeContactSheet(profile, targets, gradeTarget);
  }
  return targets;
}
