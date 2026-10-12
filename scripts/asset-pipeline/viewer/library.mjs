/** Pure selection and playback rules, shared by the viewer and asset tests. */
export const categoryLabels = { character: 'Spielfiguren', enemy: 'Gegner', turret: 'Türme', weapon: 'Waffen', utility: 'Utilities', construction: 'Konstrukte', companion: 'Begleiter', 'boss-part': 'Boss-Teile' };
/** A loadout icon without a reference grip cannot be composed into the player's hands. */
export function supportsHeldView(asset, original = false) {
  return Boolean(asset.heldItem && (!original || asset.heldItem.referenceGrip));
}
export function models(library, category = '', query = '') {
  const found = new Map();
  for (const construction of library.constructions) for (const asset of construction.assets) {
    if (!found.has(asset.id)) found.set(asset.id, asset);
  }
  const needle = query.trim().toLocaleLowerCase('de');
  return [...found.values()].filter(asset => (!category || asset.category === category)
    && `${asset.label} ${asset.id}`.toLocaleLowerCase('de').includes(needle))
    .sort((a, b) => a.label.localeCompare(b.label, 'de'));
}
export function constructionsFor(library, id) {
  return library.constructions.filter(construction => construction.assets.some(asset => asset.id === id));
}
export function resolveSource(library, choice) {
  const available = constructionsFor(library, choice.id);
  const construction = available.find(c => c.key === choice.construction) ?? available[0];
  const asset = construction?.assets.find(a => a.id === choice.id);
  if (!asset?.variants.length) return null;
  const variant = asset.variants.find(v => v.variant === choice.variant)
    ?? asset.variants.find(v => v.variant === asset.preferred?.variant) ?? asset.variants[0];
  const source = variant.sources.find(s => s.size === choice.size)
    ?? variant.sources.find(s => s.size === asset.preferred?.size)
    ?? [...variant.sources].sort((a, b) => b.size - a.size)[0];
  if (!source) return null;
  return { construction, asset, variant, source, key: `${construction.key}/${asset.id}/${variant.variant}/${source.size}` };
}
export function sampleFrame(resolved, clipName, elapsed, idle, referenceClip) {
  const clip = resolved.variant.clips?.find(c => c.name === clipName);
  if (idle || !clip || !referenceClip) return resolved.variant.idleFrame ?? 0;
  // Equal normalized phases across constructions with different sample counts.
  const duration = referenceClip.frames.length / referenceClip.frameRate;
  const phase = Math.min(.999999, elapsed / duration);
  return clip.frames[Math.min(clip.frames.length - 1, Math.floor(phase * clip.frames.length))];
}

/** Read-only projection of an export report, also usable without a run catalog. */
export function assetFromExport(report, exportUrl) {
  const m = report.manifest, base = exportUrl.slice(0, exportUrl.lastIndexOf('/') + 1);
  const url = file => base + file;
  return { id: m.id, label: m.label, category: m.category, targetSize: m.targetSize,
    displayScale: m.displayScale, forward: m.forward, pivot: m.pivot, collisionDiameter: m.collisionDiameter,
    variants: [{ variant: m.variant, clips: m.clips, idleFrame: m.idleFrame, frameCount: m.frames.length,
      master: url(m.frames[m.idleFrame].file), elevation: m.elevation, nativeMetrics: report.report?.native,
      sources: Object.entries(report.sheets).map(([size, layout]) => ({ ...layout, size: Number(size),
        url: url(`sheet-${size}.png`), idleUrl: url(`sprite-${size}.png`),
        atlases: report.atlases?.[size], exportBase: base, materialPass: report.materialPass,
        elevation: m.elevation ? { ...m.elevation, frames: m.frames.map((_, i) => url(`elevation/frames-${size}/frame-${String(i).padStart(4, '0')}.png`)) } : null })) }] };
}

/** Atlas names remain clip-local; the public frame is always the logical source index. */
export function samplePose(resolved, clipName, elapsed, idle, referenceClip) {
  const logicalFrame = sampleFrame(resolved, clipName, elapsed, idle, referenceClip);
  const current = resolved.variant.clips?.find(c => c.name === clipName);
  const name = idle || !current || !referenceClip ? '__rest' : clipName;
  const atlas = resolved.source.atlases?.color?.[name];
  const index = atlas ? atlas.sourceFrames.indexOf(logicalFrame) : -1;
  if (atlas && index < 0) throw new Error(`Atlas ${name} lacks logical frame ${logicalFrame}`);
  return { logicalFrame, clip: name, frameName: atlas?.frameNames[index] ?? logicalFrame };
}

/** One-shot free/terminal clips hold their last pose unless an authored successor exists. */
export function advancePlayback(clips, state, dt, sustain = false) {
  let next = { ...state, elapsed: state.elapsed + dt };
  for (let guard = 0; guard < 100; guard++) {
    const current = clips.find(c => c.name === next.clip);
    if (!current || !next.playing) return next;
    const duration = current.frames.length / current.frameRate;
    if (next.elapsed < duration) return next;
    if (current.loop || (current.name === 'fire' && sustain)) return { ...next, elapsed: next.elapsed % duration };
    if (current.end === 'free' && current.next) { next = { ...next, clip: current.next, elapsed: next.elapsed - duration }; continue; }
    if (current.end === 'free' || current.end === 'terminal') return { ...next, elapsed: (current.frames.length - 1) / current.frameRate, playing: false, idle: false };
    return { ...next, elapsed: 0, playing: false, idle: true };
  }
  return next;
}

export const reviewDefaults = { background: 'grass', submersion: true, waterLevel: 0, grid: false,
  scalePlayer: false, lane: false, laneWidth: 112, laneAngle: 0, laneX: 0, laneY: 0, laneDock: true };
const ranges = { waterLevel: [-100, 100], laneWidth: [32, 320], laneAngle: [-180, 180], laneX: [-1024, 1024], laneY: [-1024, 1024] };
export function readReviewSettings(params) {
  return Object.fromEntries(Object.entries(reviewDefaults).map(([key, fallback]) => {
    const raw = params.get(key);
    if (raw === null) return [key, fallback];
    if (typeof fallback === 'boolean') return [key, raw === 'true'];
    if (typeof fallback === 'number') { const n = Number(raw), [min, max] = ranges[key]; return [key, Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback]; }
    return [key, ['grass','earth','steel','light','pond'].includes(raw) ? raw : fallback];
  }));
}
export function writeReviewSettings(params, settings) {
  for (const key of Object.keys(reviewDefaults)) params.set(key, String(settings[key]));
  return params;
}
