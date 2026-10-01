/** Separate additive pass contract. Never feed this manifest to the V2 beauty importer. */
import { createHash } from 'node:crypto';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
const finite = Number.isFinite;
const positive = n => finite(n) && n > 0;
const positiveInt = n => Number.isInteger(n) && n > 0;
const hash = h => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h);
export function relativePath(value) {
  requireValue(typeof value === 'string' && value.length > 0 && !/[\\:\0]/.test(value)
    && value.split('/').every(p => p && p !== '.' && p !== '..'), 'Unsafe relative pass path');
  return value;
}
export function validatePassSpec(s) {
  requireValue(s?.version === 1 && ['pilot-only', 'production'].includes(s.status), 'Expected pass spec v1');
  relativePath(s.source);
  requireValue(Array.isArray(s.poseIndices) && s.poseIndices.length > 0 && new Set(s.poseIndices).size === s.poseIndices.length
    && s.poseIndices.every(n => Number.isInteger(n) && n >= 0), 'Invalid pose indices');
  const c = s.coordinates;
  requireValue(JSON.stringify(c?.axes) === '["right","south","up"]'
    && JSON.stringify(c.blenderToAsset) === '[1,-1,1]'
    && JSON.stringify(c.pivotBlender) === '[0,0,0]'
    && JSON.stringify(c.bodyPivotUV) === '[0.5,0.5]'
    && finite(c.groundZBlender) && positive(c.bodyCanvasWorldPx) && positive(c.bodyOrthoScaleBlender), 'Invalid coordinate contract');
  const g = s.grid;
  requireValue(g?.azimuthDegrees?.length === 16 && g.azimuthDegrees.every((n, i) => n === i * 22.5), 'Expected cyclic 16-direction grid');
  requireValue(g.elevationDegrees?.length === 3 && g.elevationDegrees.every((n, i, a) => finite(n) && n > 0 && n < 90 && (!i || n > a[i - 1])), 'Invalid elevation grid');
  const p = s.shadow;
  requireValue(p?.encoding === 'unorm8-linear' && p.premultiplied === false
    && positive(p.texelsPerWorldPx) && positiveInt(p.supersample) && finite(p.paddingWorldPx) && p.paddingWorldPx >= 1
    && positiveInt(p.samples) && finite(p.sunAngularDiameterDegrees) && p.sunAngularDiameterDegrees > 0
    && p.sunAngularDiameterDegrees / 2 < g.elevationDegrees[0]
    && positiveInt(p.gutterTexels) && positiveInt(p.maximumPageSize), 'Invalid shadow contract');
  const m = s.material;
  requireValue(m?.masterSize === 1024 && m.sourceSizes?.length > 0 && new Set(m.sourceSizes).size === m.sourceSizes.length
    && m.sourceSizes.every(n => positiveInt(n) && m.masterSize % n === 0)
    && m.albedo?.encoding === 'srgb8-straight-rgba' && m.albedo.premultiplied === false
    && m.normal?.encoding === 'unorm8-linear-rgb-normal-a-ao' && m.normal.premultiplied === false
    && positive(m.aoDistanceBlender) && positiveInt(m.samples) && positiveInt(m.aoSamples), 'Invalid material contract');
  return s;
}
/** Light vector in screen/asset axes, never the opposite shadow direction. */
export function lightVector(azimuth, elevation) {
  const a = azimuth * Math.PI / 180, e = elevation * Math.PI / 180;
  return [Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e)];
}
export function localAzimuth(sunScreenX, sunScreenY, spriteRotation) {
  const c = Math.cos(spriteRotation), s = Math.sin(spriteRotation);
  return ((Math.atan2(-s * sunScreenX + c * sunScreenY, c * sunScreenX + s * sunScreenY) * 180 / Math.PI) % 360 + 360) % 360;
}
export function sampleWeights(spec, azimuth, elevation) {
  validatePassSpec(spec);
  requireValue(finite(azimuth) && finite(elevation), 'Nonfinite light');
  const a = ((azimuth % 360) + 360) % 360 / 22.5, low = Math.floor(a), t = a - low;
  const heights = spec.grid.elevationDegrees;
  const e = Math.max(heights[0], Math.min(heights.at(-1), elevation));
  let j = 0;
  while (j < heights.length - 2 && e > heights[j + 1]) j++;
  const cot = x => 1 / Math.tan(x * Math.PI / 180);
  const u = (cot(heights[j]) - cot(e)) / (cot(heights[j]) - cot(heights[j + 1]));
  return [{ azimuthIndex: low, elevationIndex: j, weight: (1 - t) * (1 - u) },
    { azimuthIndex: (low + 1) % 16, elevationIndex: j, weight: t * (1 - u) },
    { azimuthIndex: low, elevationIndex: j + 1, weight: (1 - t) * u },
    { azimuthIndex: (low + 1) % 16, elevationIndex: j + 1, weight: t * u }];
}
export function validateCanvas(c) {
  requireValue(c && positiveInt(c.width) && positiveInt(c.height) && positive(c.texelsPerWorldPx)
    && Array.isArray(c.boundsWorld) && c.boundsWorld.length === 4 && c.boundsWorld.every(finite), 'Invalid canvas');
  const [x0, y0, x1, y1] = c.boundsWorld;
  requireValue(Math.abs((x1 - x0) * c.texelsPerWorldPx - c.width) < 1e-5
    && Math.abs((y1 - y0) * c.texelsPerWorldPx - c.height) < 1e-5, 'Canvas extent/density mismatch');
  requireValue(c.pivotPx?.length === 2 && Math.abs(c.pivotPx[0] + x0 * c.texelsPerWorldPx) < 1e-5
    && Math.abs(c.pivotPx[1] + y0 * c.texelsPerWorldPx) < 1e-5, 'Canvas pivot mismatch');
  requireValue(c.pixelToWorld?.length === 6
    && c.pixelToWorld.every((n, i) => Math.abs(n - [1 / c.texelsPerWorldPx, 0, 0, 1 / c.texelsPerWorldPx, x0, y0][i]) < 1e-5), 'Canvas transform mismatch');
}
export function validatePassManifest(m) {
  requireValue(m?.schema === 'fd-character-passes' && m.version === 1
    && m.status === (m.spec?.status === 'production' ? 'production-unreviewed' : 'pilot-unreviewed'), 'Invalid pass manifest');
  const s = validatePassSpec(m.spec);
  if (s.status === 'production') requireValue(positiveInt(m.sourceFrameCount)
    && s.poseIndices.length === m.sourceFrameCount && s.poseIndices.every((n, i) => n === i), 'Incomplete production poses');
  requireValue(hash(m.source?.blendSha256) && hash(m.source.renderSha256) && hash(m.source.selectionSha256)
    && hash(m.source.specSha256) && Object.keys(m.source.tools ?? {}).length > 0
    && Object.values(m.source.tools).every(hash), 'Missing source binding');
  const poses = m.poses;
  requireValue(Array.isArray(poses) && poses.length === s.poseIndices.length
    && poses.every((p, i) => p.index === s.poseIndices[i] && finite(p.blenderFrame) && hash(p.beautySha256)), 'Pose binding mismatch');
  requireValue(m.canvases?.length === 48, 'Incomplete canvas grid');
  for (const [i, c] of m.canvases.entries()) {
    validateCanvas(c);
    requireValue(c.azimuthIndex === i % 16 && c.elevationIndex === Math.floor(i / 16), 'Canvas grid order mismatch');
  }
  const expected = new Set();
  for (const p of poses) {
    for (let i = 0; i < 48; i++) expected.add(`shadow:${p.index}:${i}`);
    for (const size of s.material.sourceSizes) for (const pass of ['albedo', 'normal']) expected.add(`${pass}:${p.index}:${size}`);
  }
  const seenFiles = new Set();
  requireValue(Array.isArray(m.images), 'Missing images');
  for (const img of m.images) {
    relativePath(img.file);
    requireValue(!seenFiles.has(img.file), 'Duplicate image file'); seenFiles.add(img.file);
    const shadow = img.pass === 'shadow';
    const id = `${img.pass}:${img.pose}:${shadow ? img.canvasIndex : img.width}`;
    requireValue(expected.delete(id), `Unexpected or duplicate pass sample: ${id}`);
    requireValue(hash(img.sha256) && positiveInt(img.downloadBytes) && positiveInt(img.width) && positiveInt(img.height)
      && img.premultiplied === false, 'Invalid image storage');
    if (shadow) {
      const c = m.canvases[img.canvasIndex];
      requireValue(img.width === c.width && img.height === c.height && img.channels === 1
        && img.encoding === s.shadow.encoding, 'Shadow image differs from canvas');
    } else requireValue(img.height === img.width && img.channels === 4 && img.encoding === s.material[img.pass].encoding, 'Material image encoding mismatch');
    requireValue(img.gpuBytesRGBA8 === img.width * img.height * 4, 'Wrong ordinary-upload GPU bytes');
  }
  requireValue(expected.size === 0, 'Missing pass samples');
  return m;
}
