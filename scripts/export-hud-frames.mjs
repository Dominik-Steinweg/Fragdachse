/**
 * Exportiert die Waldrelief-HUD-Rahmen in einen kleinen Laufzeit-Atlas.
 *
 * Quelle ist das unveränderte Generator-Sheet (8 Farbvarianten × 3 Formen). Genutzt werden die
 * Objective-Karte (dritte Spalte) aller Farbvarianten sowie die neutrale Statusleiste (erste
 * Spalte). Die Rahmen werden nur horizontal gekürzt: Ecken bleiben pixelgleich, aus der ruhigen
 * Schienenmitte bleibt ein kurzes Stück, das die NineSlice zur Laufzeit streckt. Die Trenner der
 * Statusleiste werden einzeln ausgeschnitten, damit die Leiste beliebig viele Felder tragen kann.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const root = new URL('../', import.meta.url);
const assets = new URL('public/assets/ui/hud-frames/', root);
const SOURCE = 'waldrelief-sheet.png';
const TONES = ['neutral', 'gold', 'bronze', 'blue', 'purple', 'green', 'orange', 'red'];
/** Vertikale Bänder der acht Farbzeilen im Sheet (Generator-Layout, siehe prompts.json). */
const ROW_BANDS = [[32, 129], [158, 254], [283, 379], [410, 506], [537, 634], [667, 764], [795, 892], [923, 1020]];
const CARD_COLUMN = [1070, 1430];
const STRIP_COLUMN = [18, 594];
/** Breite der unveränderten Eckstücke; die Laub-Ornamente enden spätestens bei 72 px. */
const CAP = 84;
const CARD_MIDDLE = 96;
const STRIP_MIDDLE = 88;
/** Zeilen über der Oberkante der Schiene bzw. Gesamthöhe inklusive Schlagschatten. */
const PAD_TOP = 3;
const FRAME_H = 98;
const GAP = 2;

const original = await readFile(new URL(SOURCE, assets));
const { data, info } = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const alpha = (x, y) => data[(y * info.width + x) * 4 + 3];

/** Enge Alpha-Hülle eines Rahmens innerhalb seiner Sheet-Zelle. */
function measure([x0, x1], [y0, y1]) {
  let left = Infinity; let right = -1; let top = Infinity;
  for (let y = y0 - 6; y <= y1 + 6; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      if (alpha(x, y) <= 8) continue;
      left = Math.min(left, x); right = Math.max(right, x);
    }
  }
  // Oberkante der Schiene in der Rahmenmitte: robuster Anker für alle Farbvarianten.
  const centerX = Math.round((left + right) / 2);
  for (let y = y0 - 6; y <= y1; y += 1) {
    if (alpha(centerX, y) > 100) { top = y; break; }
  }
  return { left: left - 2, right: right + 2, top: top - PAD_TOP };
}

async function extract(left, top, width) {
  return sharp(original).extract({ left, top, width, height: FRAME_H }).toBuffer();
}

/** Linke Ecke + ruhiges Schienenstück + rechte Ecke. */
async function composeShortened(box, middleStart, middleWidth) {
  const width = box.right - box.left + 1;
  const pieces = [
    { input: await extract(box.left, box.top, CAP), left: 0, top: 0 },
    { input: await extract(box.left + middleStart, box.top, middleWidth), left: CAP, top: 0 },
    { input: await extract(box.left + width - CAP, box.top, CAP), left: CAP + middleWidth, top: 0 },
  ];
  const out = CAP * 2 + middleWidth;
  return {
    width: out,
    buffer: await sharp({ create: { width: out, height: FRAME_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(pieces).png().toBuffer(),
  };
}

const composites = [];
const frames = {};
const cardW = CAP * 2 + CARD_MIDDLE;
for (const [index, tone] of TONES.entries()) {
  const box = measure(CARD_COLUMN, ROW_BANDS[index]);
  const width = box.right - box.left + 1;
  const card = await composeShortened(box, Math.round(width / 2 - CARD_MIDDLE / 2), CARD_MIDDLE);
  const x = (index % 2) * (cardW + GAP);
  const y = Math.floor(index / 2) * (FRAME_H + GAP);
  composites.push({ input: card.buffer, left: x, top: y });
  frames[`card-${tone}`] = { frame: { x, y, w: card.width, h: FRAME_H } };
}

const stripBox = measure(STRIP_COLUMN, ROW_BANDS[0]);
const stripY = 4 * (FRAME_H + GAP);
// Das ruhige Schienenstück liegt zwischen linker Ecke und erstem Trenner.
const strip = await composeShortened(stripBox, CAP + 8, STRIP_MIDDLE);
composites.push({ input: strip.buffer, left: 0, top: stripY });
frames.strip = { frame: { x: 0, y: stripY, w: strip.width, h: FRAME_H } };
// Erster Trenner der neutralen Leiste (Sheet-Spalten 212–225) samt Schienenanteil.
const DIVIDER_W = 22;
const divider = await extract(207, stripBox.top, DIVIDER_W);
const dividerX = strip.width + GAP;
composites.push({ input: divider, left: dividerX, top: stripY });
frames.divider = { frame: { x: dividerX, y: stripY, w: DIVIDER_W, h: FRAME_H } };

const atlasW = cardW * 2 + GAP;
const atlasH = stripY + FRAME_H;
const atlas = await sharp({ create: { width: atlasW, height: atlasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(composites).png().toBuffer();
const png = await sharp(atlas).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
const lossless = await sharp(atlas).webp({ lossless: true, effort: 6 }).toBuffer();
// Gemalte Rahmen vertragen eine hohe verlustbehaftete Stufe; der Alphakanal bleibt verlustfrei,
// damit Kanten und die transparente Innenfläche exakt bleiben.
const lossy = await sharp(atlas).webp({ quality: 92, alphaQuality: 100, effort: 6, smartSubsample: true }).toBuffer();
await mkdir(new URL('runtime/', assets), { recursive: true });
await writeFile(new URL('runtime/hud-frames.webp', assets), lossy);

for (const entry of Object.values(frames)) {
  Object.assign(entry, { rotated: false, trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w: entry.frame.w, h: entry.frame.h },
    sourceSize: { w: entry.frame.w, h: entry.frame.h } });
}
await writeFile(new URL('src/ui/hudFrameExports.json', root), JSON.stringify({
  file: 'runtime/hud-frames.webp',
  width: atlasW,
  height: atlasH,
  // Geometrie in Quellpixeln relativ zum jeweiligen Frame.
  card: { width: cardW, height: FRAME_H, cap: CAP, interiorTop: 19, interiorBottom: 66,
    railCenter: 10, trackTop: 75, trackBottom: 87, trackInset: 52 },
  strip: { width: strip.width, height: FRAME_H, cap: CAP, interiorTop: 19, interiorBottom: 76, railCenter: 10 },
  divider: { width: DIVIDER_W },
  atlas: { frames, meta: { image: 'hud-frames.webp', size: { w: atlasW, h: atlasH }, scale: '1' } },
}, null, 2) + '\n');
await writeFile(new URL('runtime/REPORT.md', assets), '# HUD frame export\n\n'
  + 'Generated by `node scripts/export-hud-frames.mjs` from the untouched `waldrelief-sheet.png`.\n\n'
  + `Atlas: ${atlasW} × ${atlasH}, ${TONES.length} card colourways, neutral status strip and divider.\n\n`
  + `| Encoding | Bytes |\n| --- | ---: |\n| Original sheet PNG | ${original.length} |\n`
  + `| Atlas PNG | ${png.length} |\n| Atlas lossless WebP | ${lossless.length} |\n`
  + `| Atlas WebP q92, lossless alpha (selected) | ${lossy.length} |\n`);
console.log(`hud frames ${atlasW}×${atlasH}: png ${png.length}, lossless ${lossless.length}, selected ${lossy.length}`);
