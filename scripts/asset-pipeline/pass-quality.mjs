/** Offline pixel gates. Normal A is AO, never silhouette coverage. */
import sharp from 'sharp';

export async function rgba(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

export function tile(image, rect) {
  const [x, y, width, height] = rect;
  if (![x,y,width,height].every(Number.isInteger) || x < 0 || y < 0 || width < 1 || height < 1
    || x + width > image.width || y + height > image.height) throw Error('Invalid frame rectangle');
  const data = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row++) image.data.copy(data, row * width * 4,
    ((y + row) * image.width + x) * 4, ((y + row) * image.width + x + width) * 4);
  return { data, width, height };
}

function islands(mask, width) {
  let count = 0, largest = 0;
  for (let start = 0; start < mask.length; start++) if (mask[start]) {
    count++; const queue = [start]; mask[start] = 0;
    for (let j = 0; j < queue.length; j++) {
      const i = queue[j];
      for (const n of [i % width ? i - 1 : -1, i % width < width - 1 ? i + 1 : -1, i - width, i + width]) {
        if (n >= 0 && n < mask.length && mask[n]) { mask[n] = 0; queue.push(n); }
      }
    }
    largest = Math.max(largest, queue.length);
  }
  return { count, largest };
}

export function inspectPasses({ beauty, albedo, normal, ao, emission }) {
  const reference = albedo ?? beauty;
  if (!reference) throw Error('Coverage reference required');
  const { width, height } = reference;
  for (const image of [beauty, albedo, normal, ao, emission].filter(Boolean)) {
    if (image.width !== width || image.height !== height || image.data.length !== width * height * 4)
      throw Error('Pass canvas mismatch');
    if (!(image.data instanceof Uint8Array) && !image.data.every(Number.isFinite)) throw Error('Nonfinite pixel');
  }
  const black = new Uint8Array(width * height), beautyBlack = new Uint8Array(black.length);
  const m = { opaque: 0, opaqueBlack: 0, blackOverLitBeauty: 0, invalidNormals: 0,
    maxNormalLengthError: 0, alphaMax: 0, alphaMean: 0, alphaInteriorMismatch: 0, aoMin: 255, aoMax: 0 };
  const coveragePasses = [ao, emission].filter(Boolean);
  for (let p = 0; p < black.length; p++) {
    const i = p * 4, coverage = reference.data[i + 3];
    if (beauty && beauty.data[i+3] >= 250 && Math.max(beauty.data[i],beauty.data[i+1],beauty.data[i+2]) === 0) beautyBlack[p] = 1;
    if (beauty && albedo) {
      const delta = Math.abs(beauty.data[i+3] - coverage); m.alphaMax = Math.max(m.alphaMax, delta); m.alphaMean += delta;
      if ((coverage >= 250 && beauty.data[i+3] < 128) || (beauty.data[i+3] >= 250 && coverage < 128)) m.alphaInteriorMismatch++;
    }
    for (const image of coveragePasses) if (Math.abs(image.data[i+3] - coverage) > 7) m.alphaInteriorMismatch++;
    if (coverage < 250) continue;
    m.opaque++;
    if (albedo && Math.max(albedo.data[i],albedo.data[i+1],albedo.data[i+2]) === 0) {
      black[p] = 1; m.opaqueBlack++;
      if (beauty && Math.max(beauty.data[i],beauty.data[i+1],beauty.data[i+2]) > 16) m.blackOverLitBeauty++;
    }
    if (normal) {
      const length = Math.hypot(normal.data[i]/127.5-1,normal.data[i+1]/127.5-1,normal.data[i+2]/127.5-1);
      m.maxNormalLengthError = Math.max(m.maxNormalLengthError, Math.abs(length-1));
      if (!Number.isFinite(length) || Math.abs(length-1) > .015) m.invalidNormals++;
      m.aoMin = Math.min(m.aoMin, normal.data[i+3]); m.aoMax = Math.max(m.aoMax, normal.data[i+3]);
    }
  }
  m.alphaMean /= black.length;
  return { ...m, blackIslands: islands(black,width), beautyBlackIslands: islands(beautyBlack,width) };
}

export function validatePoseMapping(poses, other, pivot, otherPivot) {
  if (!poses?.length || JSON.stringify(pivot) !== JSON.stringify(otherPivot)
    || !Array.isArray(pivot) || pivot.length !== 2 || !pivot.every(Number.isFinite)) throw Error('Pivot mismatch');
  if (poses.length !== other?.length || poses.some((p,i) => p.index !== i || other[i].index !== i
    || !Number.isFinite(p.blenderFrame) || p.blenderFrame !== other[i].blenderFrame)) throw Error('Frame mapping mismatch');
}

/** Bounded I/O workers; fail only after every independent asset has returned evidence. */
export async function mapLimit(items, jobs, fn) {
  if (!Number.isInteger(jobs) || jobs < 1 || jobs > 16) throw Error('jobs must be 1..16');
  const results = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(jobs,items.length) }, async () => {
    while (next < items.length) { const i = next++; try { results[i] = { value: await fn(items[i],i) }; }
      catch (error) { results[i] = { error: String(error.message ?? error) }; } }
  }));
  return results;
}
