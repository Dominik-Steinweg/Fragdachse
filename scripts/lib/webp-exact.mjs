import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Lossless WebP that keeps every channel, including RGB under alpha 0 (libwebp `exact`).
 * The project's sharp 0.33 cannot set `exact`; sharp >= 0.35 is installed as `sharp-exact`.
 * Its libvips cannot load next to sharp 0.33 in one process, so encoding runs in a child process.
 */
export function encodeExactWebp(pngPath) {
  return execFileSync(process.execPath, [fileURLToPath(import.meta.url), pngPath], { maxBuffer: 1 << 28 });
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const { default: sharp } = await import('sharp-exact');
  process.stdout.write(await sharp(process.argv[2]).webp({ lossless: true, effort: 6, exact: true }).toBuffer());
}
