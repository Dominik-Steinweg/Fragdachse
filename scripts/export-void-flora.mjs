// Void botany atlases (GDD Nachtsicht G2). The approved selection is read from each source
// folder's selection.json, so later accepted candidates join without editing this script.
// Every colour frame gets a congruent emissive frame: the mask runs through exactly the colour's
// geometry (resize, trim, padding, finish blur) and is stored as white RGB with alpha = emission.
import { prepareRuntimeAssets } from './prepare-runtime-assets.mjs';
import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { packEcologyAtlas, hash } from './lib/ecology-atlas.mjs';
import { ROCK_ECOLOGY_RECIPE } from './lib/rock-ecology-v8-export.mjs';

const output = 'public/assets/environment/woodland/ecology';
const approved = async folder => Object.entries(JSON.parse(await readFile(`${folder}/selection.json`, 'utf8')))
  .filter(([, entry]) => entry.accepted && entry.emissive).map(([name]) => name).sort();

/** Grey mask as RGBA: white colour, alpha carries the emission. */
async function maskRgba(mask) {
  const { data, info } = await sharp(mask).greyscale().raw().toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4, 255);
  for (let i = 0; i < info.width * info.height; i++) rgba[i * 4 + 3] = data[i];
  return sharp(rgba, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

/** Same colour treatment as the natural export; the mask only shares geometry and blur. */
async function finish(bytes, recipe, isMask) {
  const f = recipe.surfaceFinish;
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = info.width * info.height, alpha = Buffer.alloc(pixels), colour = Buffer.alloc(pixels * 3);
  const graded = f && !isMask ? await sharp(bytes).removeAlpha().modulate({ brightness: f.brightness, saturation: f.saturation })
    .linear(f.rgb, [0, 0, 0]).raw().toBuffer() : null;
  for (let i = 0; i < pixels; i++) {
    alpha[i] = data[i * 4 + 3];
    for (let c = 0; c < 3; c++) colour[i * 3 + c] = Math.round((graded ? graded[i * 3 + c] : data[i * 4 + c]) * alpha[i] / 255);
  }
  const blur = f?.blur;
  const blurredColour = blur ? await sharp(colour, { raw: { width: info.width, height: info.height, channels: 3 } }).blur(blur).raw().toBuffer() : colour;
  const blurredAlpha = blur ? await sharp(alpha, { raw: { width: info.width, height: info.height, channels: 1 } }).blur(blur).greyscale().raw().toBuffer() : alpha;
  for (let i = 0; i < pixels; i++) {
    const a = blurredAlpha[i], x = i % info.width, y = Math.floor(i / info.width);
    const border = x < 4 || y < 4 || x >= info.width - 4 || y >= info.height - 4;
    data[i * 4 + 3] = border ? 0 : a;
    for (let c = 0; c < 3; c++) data[i * 4 + c] = border || !a ? 0 : isMask ? 255 : Math.min(255, Math.round(blurredColour[i * 3 + c] * 255 / a));
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

async function pondFrames() {
  const folder = 'tools/source-art/pond-ecology-v8/void', frames = [];
  for (const name of await approved(folder)) {
    const fit = async input => sharp(input).resize(248, 248, { fit: 'contain', background: '#00000000', kernel: 'lanczos3' })
      .extend({ top: 4, bottom: 4, left: 4, right: 4, background: '#00000000' }).png().toBuffer();
    const colourSource = await readFile(`${folder}/${name}.png`), maskSource = await readFile(`${folder}/${name}-emissive.png`);
    if (!(await sharp(colourSource).metadata()).hasAlpha) throw new Error(`${name} needs authored alpha`);
    frames.push({ name, width: 256, height: 256, colour: await fit(colourSource), mask: await fit(await maskRgba(maskSource)),
      sourceSha256: hash(colourSource), maskSourceSha256: hash(maskSource) });
  }
  return frames;
}

/** The natural recipe of the same colony kind; size follows the void source's own aspect. */
function rockRecipe(name, metadata) {
  const kind = name.replace(/^void-/, '').replace(/-\d+$/, '');
  const natural = ROCK_ECOLOGY_RECIPE.find(r => r.name.startsWith(`${kind}-`) && r.surfaceFinish);
  if (!natural) throw new Error(`No natural rock ecology recipe for ${name}`);
  const height = natural.preserveCanvas ? Math.round(256 * metadata.height / metadata.width) : natural.height;
  return { ...natural, name, width: 256, height };
}

async function rockFrames() {
  const folder = 'tools/source-art/rock-ecology-v8/void', frames = [];
  for (const name of await approved(folder)) {
    const colourSource = await readFile(`${folder}/${name}.png`), maskSource = await readFile(`${folder}/${name}-emissive.png`);
    const metadata = await sharp(colourSource).metadata();
    if (!metadata.hasAlpha) throw new Error(`${name} needs authored alpha`);
    const recipe = rockRecipe(name, metadata), mask = await maskRgba(maskSource);
    let colour, emissive;
    if (recipe.preserveCanvas) {
      const resize = input => sharp(input).ensureAlpha().resize(recipe.width, recipe.height, { kernel: 'lanczos3' }).png().toBuffer();
      colour = await finish(await resize(colourSource), recipe, false);
      emissive = await finish(await resize(mask), recipe, true);
    } else {
      // Trim by the colour's alpha and apply the identical crop to the mask.
      const { info } = await sharp(colourSource).ensureAlpha().trim({ threshold: 4 }).toBuffer({ resolveWithObject: true });
      const region = { left: -(info.trimOffsetLeft ?? 0), top: -(info.trimOffsetTop ?? 0), width: info.width, height: info.height };
      const crop = input => sharp(input).ensureAlpha().extract(region).resize(recipe.width - 8, recipe.height - 8, {
        fit: 'contain', background: '#00000000', kernel: 'lanczos3' })
        .extend({ top: 4, bottom: 4, left: 4, right: 4, background: '#00000000' }).png().toBuffer();
      colour = await finish(await crop(colourSource), recipe, false);
      emissive = await finish(await crop(mask), recipe, true);
    }
    frames.push({ name, width: recipe.width, height: recipe.height, minWorld: recipe.minWorld, maxWorld: recipe.maxWorld,
      colour, mask: emissive, sourceSha256: hash(colourSource), maskSourceSha256: hash(maskSource) });
  }
  return frames;
}

await mkdir(output, { recursive: true });
for (const [target, frames, source] of [
  ['void-lilies', await pondFrames(), 'tools/source-art/pond-ecology-v8/void'],
  ['void-rock-colonies', await rockFrames(), 'tools/source-art/rock-ecology-v8/void'],
]) {
  const atlas = await packEcologyAtlas(output, target, frames, 256, f => f.colour);
  const emissiveAtlas = await packEcologyAtlas(output, `${target}-emissive`, frames, 256, f => f.mask);
  const assets = [];
  for (const f of frames) {
    assets.push({ name: f.name, width: f.width, height: f.height, ...(f.minWorld ? { minWorld: f.minWorld, maxWorld: f.maxWorld } : {}),
      source: `${f.name}.png`, sourceSha256: f.sourceSha256, emissiveSource: `${f.name}-emissive.png`, emissiveSourceSha256: f.maskSourceSha256,
      pixelSha256: hash(await sharp(f.colour).ensureAlpha().raw().toBuffer()),
      emissivePixelSha256: hash(await sharp(f.mask).ensureAlpha().raw().toBuffer()) });
  }
  await writeFile(`src/assets/manifests/${target}.json`, JSON.stringify({ version: 1, source, recipe: 'scripts/export-void-flora.mjs',
    alpha: 'authored alpha; emissive = white RGB with alpha from the congruent mask; transparent 4px padding',
    atlas, emissiveAtlas, assets }, null, 2) + '\n');
  console.log(`${target}: ${frames.length} frames`);
}
await prepareRuntimeAssets();
