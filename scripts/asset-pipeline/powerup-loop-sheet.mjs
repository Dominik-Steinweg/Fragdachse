import sharp from 'sharp';
import { resizeMaster } from './export.mjs';
import { packSheet } from './export-v2.mjs';
import { finishPowerupSymbol } from './powerup-symbol-finish.mjs';

/** World display size of one loop frame; matches the runtime's prefiltered static layers. */
export const LOOP_FRAME_SIZE = 64;

/**
 * Runtime loop sheet of one symbol. Each master is finished exactly like the static layer
 * (256 canvas, contour and contact shadow), then reduced once with Lanczos, so the loop's
 * frame 0 matches the static symbol and the sheet can be recomputed byte-for-byte.
 */
export async function powerupLoopSheet(masters) {
  const frames = [];
  for (const master of masters) {
    const finished = await finishPowerupSymbol(await resizeMaster(master, 256));
    frames.push(await sharp(finished).resize(LOOP_FRAME_SIZE, LOOP_FRAME_SIZE, { kernel: 'lanczos3' }).png().toBuffer());
  }
  return packSheet(frames, LOOP_FRAME_SIZE);
}
