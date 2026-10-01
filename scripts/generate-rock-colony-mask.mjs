import sharp from 'sharp';
import * as path from 'node:path';
import { chamferDistance, clamp01, smoothstep } from './lib/organic-cover-pipeline.mjs';

/** Destruction/overhang mask shared by rock colonies; no vegetation artwork is generated. */
const SPRITE_DIR = path.join('public', 'assets', 'sprites');
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

writeMaskSheet().catch(error => { console.error(error); process.exitCode=1; });
