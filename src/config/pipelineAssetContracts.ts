import * as v from 'valibot';

const id = v.pipe(v.string(), v.minLength(1));
const finite = v.pipe(v.number(), v.finite());
const positive = v.pipe(finite, v.minValue(Number.MIN_VALUE));
const integer = v.pipe(finite, v.safeInteger(), v.minValue(0));
const size = v.pipe(integer, v.minValue(1));
const unit = v.pipe(finite, v.minValue(0), v.maxValue(1));
const hash = v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/));
const path = v.pipe(v.string(), v.regex(/^\.\/assets\/[\w./-]+$/), v.check(p => !p.split('/').includes('..')));
const pair = v.tuple([finite, finite]);
const pivot = v.tuple([unit, unit]);
const socketPoint = v.strictObject({ x: unit, y: unit, z: finite });
export type PipelineSocketPoint = v.InferOutput<typeof socketPoint>;
const clip = v.pipe(v.object({ name: id, frames: v.pipe(v.array(integer), v.minLength(1)),
  frameRate: positive, loop: v.boolean(), markers: v.optional(v.record(id, integer)),
  start: v.optional(v.picklist(['rest', 'free'])), end: v.optional(v.picklist(['rest', 'free', 'terminal'])), next: v.optional(id),
}), v.check(c => Object.values(c.markers ?? {}).every(i => i < c.frames.length), 'Marker outside clip'));
export type PipelineClip = v.InferOutput<typeof clip>;
const eye = v.object({ x: finite, y: finite, width: positive, height: positive, rotation: finite });
const base = {
  id, category: id, gameIds: v.array(id), revision: id, variant: id, sourceSize: size, textureKey: id,
  forward: v.picklist(['north', 'east', 'south', 'west']), pivot,
  displayScale: v.optional(positive), idleFrame: integer, clips: v.array(clip),
};
export const PipelineNormalAssetSchema = v.object({ ...base, runtimeContract: v.literal('sheet'),
  sheetTextureKey: id, idlePath: path, sheetPath: path,
  layout: v.object({ frameWidth: size, frameHeight: size, margin: integer, spacing: integer,
    columns: size, rows: size, frameCount: size, width: size, height: size }),
  hashes: v.object({ idle: hash, sheet: hash }),
  eyeAnchors: v.optional(v.object({ version: size, source: v.object({ revision: id, variant: id,
    blendSha256: hash, sheetSha256: hash, idleSha256: hash }),
    /** Optional further eyes in complete left/right pairs: [left 1, right 1, left 2, ...]. */
    frames: v.array(v.object({ left: eye, right: eye,
      extra: v.optional(v.pipe(v.array(eye), v.check(e => e.length >= 2 && e.length % 2 === 0, 'Extra eyes come in pairs'))) })) })),
  heldItem: v.optional(v.object({ referenceSize: size, grip: pair, muzzle: pair, referenceGrip: v.optional(pair) })),
});
export type PipelineNormalAsset = v.InferOutput<typeof PipelineNormalAssetSchema>;

const page = v.pipe(v.strictObject({
  image: path, json: path, sha256: hash, jsonSha256: hash, width: size, height: size, gpuBytesRGBA8: size,
  /** Frame ownership is exported by D so residency can map each pass without guessing page indices. */
  frameNames: v.pipe(v.array(id), v.minLength(1)),
}), v.check(p => p.width <= 4096 && p.height <= 4096 && p.gpuBytesRGBA8 === p.width * p.height * 4, 'Invalid atlas byte size'));
const atlas = v.strictObject({ sourceSize: size, logicalSourceSize: size, pivot,
  frameNames: v.pipe(v.array(id), v.minLength(1)), sourceFrames: v.pipe(v.array(integer), v.minLength(1)),
  pages: v.pipe(v.array(page), v.minLength(1)),
});
const bytes = v.strictObject({ color: integer, elevation: integer, emission: v.optional(integer), total: integer });
const meshFile = v.strictObject({ file: path, sha256: hash, bytes: size });
const xyz = v.tuple([finite, finite, finite]);
const meshPose = v.strictObject({ vertexCount: size, triangleCount: size,
  bounds: v.strictObject({ min: xyz, max: xyz }), positions: meshFile, indices: meshFile });
const materialPass = v.strictObject({ version: v.literal(1), color: v.literal('srgb-albedo-baked-cavity-v1'),
  normal: v.literal('linear-unorm8-z-oct-normal-v1'), emission: v.literal('linear-rgb-unorm8-scaled-v1'),
  worldPxPerBU: positive, emissionRange: positive, exposure: positive, tint: xyz, saturation: positive });
export const PipelineBossAssetSchema = v.strictObject({ ...base, runtimeContract: v.literal('boss'),
  clips: v.pipe(v.array(clip), v.minLength(1)),
  targetSize: size, runtimeBudgetMB: positive,
  /** Normalized FULL-canvas coordinates, unaffected by trimming. */
  sockets: v.record(id, pivot),
  /** Source-frame indexed; x/y use the full canvas, z is Blender world height. */
  socketFrames: v.optional(v.pipe(v.array(v.record(id, socketPoint)), v.minLength(1))),
  elevation: v.strictObject({ min: finite, max: finite, scale: positive, previewWaterLevel: v.optional(finite) }),
  elevationPass: v.strictObject({ encoding: v.picklist(['linear-unorm8-world-z', 'linear-unorm8-z-oct-normal-v1']), min: finite, max: finite,
    scale: positive, waterline: v.literal(0), alpha: v.literal('beauty-coverage'),
    colorSpace: v.literal('non-color'), premultiplied: v.literal(false) }),
  materialPass: v.optional(materialPass),
  shadowMesh: v.optional(v.strictObject({ version: v.literal(1), encoding: v.literal('u16-world-xyz-per-pose-v1'), frames: v.array(meshPose) })),
  atlases: v.strictObject({ color: v.record(id, atlas), elevation: v.record(id, atlas), emission: v.optional(v.record(id, atlas)) }),
  budget: v.strictObject({ clips: v.record(id, bytes), totals: bytes }),
});
export type PipelineBossAsset = v.InferOutput<typeof PipelineBossAssetSchema>;
export type PipelineRuntimeAsset = PipelineNormalAsset | PipelineBossAsset;
export type PipelineAtlasPage = v.InferOutput<typeof page>;

/** Metadata validation only; selected byte/hash/pixel verification stays in the asset pipeline. */
export function normalizePipelineAsset(raw: unknown): PipelineRuntimeAsset {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid pipeline asset');
  const input = raw as Record<string, unknown>;
  const a = input.runtimeContract === 'boss' ? v.parse(PipelineBossAssetSchema, input)
    : v.parse(PipelineNormalAssetSchema, { ...input, runtimeContract: input.runtimeContract ?? 'sheet' });
  const fail = (message: string): never => { throw new Error(`[pipelineAssets] ${a.id}: ${message}`); };
  if (new Set(a.clips.map(c => c.name)).size !== a.clips.length) fail('Duplicate clip');
  for (const c of a.clips) if (c.next && (c.end !== 'free' || !a.clips.some(next => next.name === c.next))) fail('Invalid next clip');
  if (a.runtimeContract === 'sheet') {
    if (a.idleFrame >= a.layout.frameCount || a.clips.some(c => c.frames.some(f => f >= a.layout.frameCount))) fail('Frame outside sheet');
    return a;
  }
  if (a.sourceSize !== Math.round(a.targetSize * (a.displayScale ?? 1))) fail('Boss must export at displayed canvas resolution');
  if (!(a.elevation.min < a.elevation.max) || a.elevationPass.min !== a.elevation.min || a.elevationPass.max !== a.elevation.max
    || a.elevationPass.scale !== a.elevation.scale) fail('Elevation encoding mismatch');
  const packed = a.elevationPass.encoding === 'linear-unorm8-z-oct-normal-v1';
  if (packed !== !!a.materialPass || packed !== !!a.shadowMesh || packed !== !!a.atlases.emission) fail('Material/normal/mesh passes must be declared together');
  const groups = [{ name: '__rest', frames: [a.idleFrame] }, ...a.clips];
  const socketNames = Object.keys(a.sockets).sort();
  if (socketNames.length && !a.socketFrames) fail('Missing frame sockets');
  if (a.socketFrames) {
    const count = Math.max(...groups.flatMap(c => c.frames)) + 1;
    if (a.socketFrames.length !== count) fail('Socket frame count mismatch');
    for (const frame of a.socketFrames) {
      if (Object.keys(frame).sort().join('|') !== socketNames.join('|')
        || socketNames.some(n => ['eyeLeft', 'eyeRight'].includes(n))) fail('Socket names mismatch');
    }
    for (const name of socketNames) {
      const point = a.socketFrames[a.idleFrame][name];
      if (a.sockets[name][0] !== point.x || a.sockets[name][1] !== point.y) fail('Rest sockets mismatch');
    }
  }
  if (a.shadowMesh) {
    if (a.shadowMesh.frames.length !== Math.max(...groups.flatMap(c => c.frames)) + 1) fail('Mesh pose mapping mismatch');
    for (const m of a.shadowMesh.frames) {
      if (m.vertexCount > 65535 || m.positions.bytes !== m.vertexCount * 6 || m.indices.bytes !== m.triangleCount * 6
        || m.bounds.min.some((value, axis) => value > m.bounds.max[axis])) fail('Mesh dimensions mismatch');
    }
  }
  const names = groups.map(c => c.name).sort().join('|');
  if (Object.keys(a.atlases.color).sort().join('|') !== names || Object.keys(a.atlases.elevation).sort().join('|') !== names
    || Object.keys(a.budget.clips).sort().join('|') !== names) fail('Clip/pass/budget mismatch');
  const totals = { color: 0, elevation: 0, emission: 0, total: 0 };
  const files = new Set<string>();
  for (const group of groups) {
    const counts = { color: 0, elevation: 0, emission: 0, total: 0 };
    const expected = group.frames.map((_, i) => `${group.name}/${String(i).padStart(4, '0')}`);
    for (const pass of (packed ? ['color', 'elevation', 'emission'] : ['color', 'elevation']) as ('color' | 'elevation' | 'emission')[]) {
      const at = a.atlases[pass]![group.name];
      if (!at) fail('Missing material clip');
      if (JSON.stringify(at.frameNames) !== JSON.stringify(expected) || JSON.stringify(at.sourceFrames) !== JSON.stringify(group.frames)
        || at.logicalSourceSize !== a.sourceSize || at.sourceSize !== Math.round(a.sourceSize * (pass === 'elevation' ? a.elevation.scale : 1))
        || JSON.stringify(at.pivot) !== JSON.stringify(a.pivot)) fail('Logical canvas/frame mapping mismatch');
      const found = new Set<string>();
      for (const p of at.pages) {
        for (const file of [p.image, p.json]) { if (files.has(file)) fail('Duplicate atlas file'); files.add(file); }
        for (const frame of p.frameNames) { if (found.has(frame) || !expected.includes(frame)) fail('Duplicate/unknown page frame'); found.add(frame); }
        counts[pass] += p.gpuBytesRGBA8;
      }
      if (found.size !== expected.length) fail('Missing page frames');
    }
    counts.total = counts.color + counts.elevation + counts.emission;
    for (const key of ['color', 'elevation', 'emission', 'total'] as const) {
      if ((a.budget.clips[group.name][key] ?? 0) !== counts[key]) fail('Clip budget mismatch');
      totals[key] += counts[key];
    }
  }
  if (Object.keys(totals).some(k => totals[k as keyof typeof totals] !== (a.budget.totals[k as keyof typeof totals] ?? 0))
    || (!packed && totals.total > a.runtimeBudgetMB * 1024 * 1024)) fail('Resident budget mismatch/exceeded');
  return a;
}

export function normalizePipelineAssets(raw: readonly unknown[]): PipelineRuntimeAsset[] {
  const assets = raw.map(normalizePipelineAsset), ids = new Set<string>(), textures = new Set<string>();
  for (const a of assets) {
    if (ids.has(a.id)) throw new Error(`Duplicate pipeline ID: ${a.id}`);
    ids.add(a.id);
    for (const key of a.runtimeContract === 'sheet' ? [a.textureKey, a.sheetTextureKey] : [a.textureKey]) {
      if (textures.has(key)) throw new Error(`Duplicate pipeline texture: ${key}`);
      textures.add(key);
    }
  }
  return assets;
}

/** A marker is clip-local, while socket samples are indexed by the exported source frame. */
export function pipelineMarkerSocket(asset: PipelineBossAsset, clipName: string, marker: string, socket: string): PipelineSocketPoint {
  const clip = asset.clips.find(c => c.name === clipName);
  const index = clip?.markers?.[marker];
  const point = index === undefined ? undefined : asset.socketFrames?.[clip!.frames[index]]?.[socket];
  if (!point) throw new Error(`[pipelineAssets] ${asset.id}: Missing ${clipName}/${marker} socket ${socket}`);
  return point;
}

export function pipelineEggReleaseSocket(asset: PipelineBossAsset, egg: number): PipelineSocketPoint {
  if (!Number.isInteger(egg) || egg < 1 || egg > 6) throw new Error('Egg socket index must be 1 through 6');
  return pipelineMarkerSocket(asset, 'egg-throw', `release-${egg}`, `egg${egg}`);
}
