import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { sampleWeights, localAzimuth, validatePassManifest, digest } from './character-pass-contract.mjs';
import { decodePassImage } from './export-character-passes.mjs';

const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const label = (text, width, height = 22) => Buffer.from(`<svg width="${width}" height="${height}"><text x="5" y="16" font-family="Arial" font-size="12" fill="#eee">${escape(text)}</text></svg>`);
const save = (file, w, h, layers) => sharp({ create: { width: w, height: h, channels: 4, background: '#303832' } }).composite(layers).png().toFile(file);

function bilinear(mask, width, height, x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), u = x - ix, v = y - iy;
  const at = (xx, yy) => xx < 0 || yy < 0 || xx >= width || yy >= height ? 0 : mask[yy * width + xx] / 255;
  return (at(ix, iy) * (1 - u) + at(ix + 1, iy) * u) * (1 - v) + (at(ix, iy + 1) * (1 - u) + at(ix + 1, iy + 1) * u) * v;
}

export async function reviewCharacterPasses(root, destination, { poseIndices } = {}) {
  const manifestBytes = await readFile(path.join(root, 'render-passes.json'));
  const m = validatePassManifest(JSON.parse(manifestBytes));
  const job = JSON.parse(await readFile(path.join(root, 'job.json'), 'utf8'));
  const poses = poseIndices ? m.poses.filter(p => poseIndices.includes(p.index)) : m.poses;
  if (!poses.length || (poseIndices && poses.length !== poseIndices.length)) throw Error('Invalid review pose subset');
  if (await access(destination).then(() => true, () => false)) throw Error('Review directory exists; preserve earlier review');
  await mkdir(destination, { recursive: true });
  const masks = new Map(), beauties = new Map(), files = [];
  for (const img of m.images.filter(i => i.pass === 'shadow' && poses.some(p => p.index === i.pose))) masks.set(`${img.pose}:${img.canvasIndex}`, await decodePassImage(root, img));
  for (const p of poses) {
    const data = await readFile(path.join(job.beautyRoot ? path.join(root, job.beautyRoot) : job.sourceFolder, p.beautyFile));
    if (digest(data) !== p.beautySha256) throw Error('Review beauty changed');
    beauties.set(p.index, data);
  }
  const contactLayers = [];
  for (const [row, pose] of poses.entries()) for (let a = 0; a < 16; a++) {
    const c = m.canvases[16 + a], mono = masks.get(`${pose.index}:${16 + a}`), rgba = Buffer.alloc(c.width * c.height * 4);
    for (let i = 0; i < mono.length; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = 255 - mono[i]; rgba[i * 4 + 3] = 255; }
    const thumb = await sharp(rgba, { raw: { width: c.width, height: c.height, channels: 4 } }).resize(94, 102, { fit: 'contain', background: '#ffffff' }).png().toBuffer();
    contactLayers.push({ input: thumb, left: a * 100 + 3, top: row * 130 + 22 },
      { input: label(`P${pose.index} ${a * 22.5}°`, 100), left: a * 100, top: row * 130 });
  }
  await save(path.join(destination, 'shadow-contact-35deg.png'), 1600, poses.length * 130, contactLayers);
  files.push('shadow-contact-35deg.png');
  // Neutralized real forest-ground texture at one output pixel per world unit.
  const floor = await sharp(job.groundFile ? path.join(root, job.groundFile) : path.join(job.repo, 'public/assets/sprites/gras_bg_tile.png')).resize(160, 160)
    .removeAlpha().raw().toBuffer();
  const tileW = 160, tileH = 160, origin = [80, 82], layers = [];
  const stands = [[0, 28], [90, 35], [180, 45], [270, 35]], rotations = [0, 45, 90];
  for (const [row, pose] of poses.entries()) for (const [stand, [azimuth, elevation]] of stands.entries()) for (const [turn, degrees] of rotations.entries()) {
    const r = degrees * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
    const light = [Math.cos(azimuth * Math.PI / 180), Math.sin(azimuth * Math.PI / 180)];
    const weights = sampleWeights(m.spec, localAzimuth(...light, r), elevation);
    const rgb = Buffer.alloc(tileW * tileH * 3);
    for (let y = 0; y < tileH; y++) for (let x = 0; x < tileW; x++) {
      const dx = x + .5 - origin[0], dy = y + .5 - origin[1];
      const lx = cs * dx + sn * dy, ly = -sn * dx + cs * dy;
      let coverage = 0;
      for (const w of weights) {
        const index = w.elevationIndex * 16 + w.azimuthIndex, c = m.canvases[index];
        coverage += w.weight * bilinear(masks.get(`${pose.index}:${index}`), c.width, c.height,
          (lx - c.boundsWorld[0]) * c.texelsPerWorldPx - .5, (ly - c.boundsWorld[1]) * c.texelsPerWorldPx - .5);
      }
      const i = (y * tileW + x) * 3;
      const lum = floor[i] * .213 + floor[i + 1] * .715 + floor[i + 2] * .072;
      for (let k = 0; k < 3; k++) rgb[i + k] = Math.round((70 + lum * .3 + (k === 1 ? 7 : 0)) * (1 - .58 * coverage));
    }
    // 5x intermediate gives 38.4 world pixels exactly, then reduces to the 1x review.
    const body = await sharp(beauties.get(pose.index)).resize(192, 192).rotate(degrees, { background: '#00000000' }).png().toBuffer();
    const bm = await sharp(body).metadata();
    const highFloor = await sharp(rgb, { raw: { width: tileW, height: tileH, channels: 3 } }).resize(tileW * 5, tileH * 5, { kernel: 'nearest' }).png().toBuffer();
    const composed = await sharp(highFloor).composite([{ input: body, left: origin[0] * 5 - Math.floor(bm.width / 2), top: origin[1] * 5 - Math.floor(bm.height / 2) }]).png().toBuffer();
    const tile = await sharp(composed).resize(tileW, tileH).png().toBuffer();
    const col = stand * 3 + turn;
    layers.push({ input: tile, left: col * tileW, top: row * (tileH + 22) + 22 },
      { input: label(`P${pose.index} L${azimuth}/${elevation} R${degrees}`, tileW), left: col * tileW, top: row * (tileH + 22) });
  }
  await save(path.join(destination, 'game-size-beauty-shadow.png'), tileW * 12, (tileH + 22) * poses.length, layers);
  files.push('game-size-beauty-shadow.png');
  const materialLayers = [];
  for (const [row, pose] of poses.entries()) {
    const normal = m.images.find(i => i.pass === 'normal' && i.pose === pose.index && i.width === 128);
    const albedo = m.images.find(i => i.pass === 'albedo' && i.pose === pose.index && i.width === 128);
    const n = await decodePassImage(root, normal), a = await decodePassImage(root, albedo);
    const normalVisible = Buffer.from(n), aoVisible = Buffer.from(n);
    for (let i = 0; i < n.length; i += 4) {
      normalVisible[i + 3] = a[i + 3];
      aoVisible[i] = aoVisible[i + 1] = aoVisible[i + 2] = n[i + 3]; aoVisible[i + 3] = a[i + 3];
    }
    const items = [await sharp(beauties.get(pose.index)).resize(128).png().toBuffer(), await readFile(path.join(root, albedo.file)),
      await sharp(normalVisible, { raw: { width: 128, height: 128, channels: 4 } }).png().toBuffer(),
      await sharp(aoVisible, { raw: { width: 128, height: 128, channels: 4 } }).png().toBuffer()];
    for (const [col, input] of items.entries()) materialLayers.push({ input, left: col * 144 + 8, top: row * 154 + 22 },
      { input: label(`P${pose.index} ${['Beauty', 'Albedo (unlit)', 'Normal XYZ', 'AO'][col]}`, 144), left: col * 144, top: row * 154 });
  }
  await save(path.join(destination, 'beauty-albedo-normal-ao.png'), 576, 154 * poses.length, materialLayers);
  files.push('beauty-albedo-normal-ao.png');
  const shadows = m.timings.filter(t => t.pass_name === 'shadow').map(t => t.seconds).sort((a, b) => a - b);
  const mean = shadows.reduce((a, b) => a + b, 0) / shadows.length;
  const report = { status: 'awaiting-human-review', sourceRenderManifestSha256: digest(manifestBytes),
    output: root, reviewedPoseIndices: poses.map(p => p.index), reviewFiles: files, shadows: { jobs: shadows.length, meanSeconds: mean,
      medianSeconds: shadows[Math.floor(shadows.length / 2)], minSeconds: shadows[0], maxSeconds: shadows.at(-1),
      full37FramesJobs: 37 * 48, full37FramesRenderSecondsEstimate: mean * 37 * 48 },
    materialRenderSeconds: m.timings.filter(t => ['albedo', 'normal', 'ao'].includes(t.pass_name)).reduce((s, t) => s + t.seconds, 0),
    receiverRenderSeconds: m.timings.filter(t => t.pass_name === 'receiver').reduce((s, t) => s + t.seconds, 0),
    maskSizes: m.canvases.map(c => [c.width, c.height]),
    notes: ['Beauty intentionally retains its original fixed light for the requested shadow comparison.',
      'Contact sheet scales thumbnails independently; game-size sheet uses 1 pixel per world unit.',
      'Normal/AO preview replaces data alpha with albedo coverage ONLY for visualization.',
      'No browser, temporal interpolation or runtime GPU performance was verified.'] };
  await writeFile(path.join(destination, 'review.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return report;
}
