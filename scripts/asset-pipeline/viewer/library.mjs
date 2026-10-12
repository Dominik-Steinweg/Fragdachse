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
    variants: [{ variant: m.variant, clips: m.clips, sockets: m.sockets, socketFrames: m.socketFrames, idleFrame: m.idleFrame, frameCount: m.frames.length,
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
  spines: true, regrow: false, regrowSeconds: 2,
  scalePlayer: false, lane: false, laneWidth: 112, laneAngle: 0, laneX: 0, laneY: 0, laneDock: true };
const ranges = { regrowSeconds: [.1, 30], waterLevel: [-100, 100], laneWidth: [32, 320], laneAngle: [-180, 180], laneX: [-1024, 1024], laneY: [-1024, 1024] };
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

/** Never borrow a detached part from a different revision. */
export function resolveSpine(library, body) {
  if (body.asset.id !== 'abyssal-kraken'
    || !body.construction.assets.some(a => a.id === 'abyssal-kraken-spine')) return null;
  return resolveSource(library, { id: 'abyssal-kraken-spine', construction: body.construction.key,
    variant: body.variant.variant, size: body.source.size });
}

/** The viewer holds the volley's final pose while its optional regrowth tail runs. */
export function advanceViewerPlayback(clips, state, dt, sustain, settings) {
  const current = clips.find(c => c.name === state.clip);
  if (current?.name !== 'spine-volley') return advancePlayback(clips, state, dt, sustain);
  if (!state.playing) return state;
  const end = current.frames.length / current.frameRate + (settings.regrow ? settings.regrowSeconds : 0);
  const elapsed = Math.min(end, state.elapsed + dt);
  return { ...state, elapsed, playing: elapsed < end, idle: false };
}

export function spineGrowth(resolved, index, playback, referenceClip, settings) {
  const current = resolved.variant.clips?.find(c => c.name === playback.clip);
  if (playback.idle || current?.name !== 'spine-volley' || !referenceClip) return 1;
  const release = current.markers?.[`release-${index}`];
  if (release === undefined) return 1;
  const duration = referenceClip.frames.length / referenceClip.frameRate;
  if (playback.elapsed >= duration) return settings.regrow
    ? Math.min(1, (playback.elapsed - duration) / settings.regrowSeconds) : 0;
  return playback.elapsed / duration * current.frames.length + 1e-7 >= release ? 0 : 1;
}

/** Full-canvas normalized sockets, independent of atlas trim and source resolution. */
export function spineTransform(body, sockets, base, tip, index, growth) {
  const from = sockets?.[`spine${index}`], to = sockets?.[`spine${index}Tip`];
  if (!from || !to || !base || !tip || growth <= 0) return null;
  const assetDistance = Math.hypot(tip[0] - base[0], tip[1] - base[1]);
  if (!assetDistance) return null;
  const dx = (from.x - body.originX) * body.displayWidth, dy = (from.y - body.originY) * body.displayHeight;
  const vx = (to.x - from.x) * body.displayWidth, vy = (to.y - from.y) * body.displayHeight;
  const c = Math.cos(body.rotation), s = Math.sin(body.rotation);
  return { x: body.x + dx*c - dy*s, y: body.y + dx*s + dy*c, z: from.z ?? 0,
    rotation: body.rotation + Math.atan2(vy, vx) - Math.atan2(tip[1] - base[1], tip[0] - base[0]),
    size: Math.hypot(vx, vy) / assetDistance * growth };
}
