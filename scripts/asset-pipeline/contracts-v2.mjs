/** Art-independent contracts shared by catalog, export and runtime import. */
const namePattern = /^[a-z][a-z0-9-]*$/;

export function validateClipContracts(clips, sampled = true) {
  const names = clips.map(c => c.name);
  if (names.some(n => typeof n !== 'string' || !namePattern.test(n)) || new Set(names).size !== names.length) throw new Error('Invalid or duplicate clip name');
  for (const clip of clips) {
    const count = sampled ? clip.frames.length : clip.frameCount;
    if (!Number.isInteger(count) || count < 2 || count > 120 || typeof clip.loop !== 'boolean' || !Number.isFinite(clip.frameRate) || clip.frameRate <= 0) throw new Error('Invalid clip timing');
    const markers = clip.markers ?? {};
    if (clip.name === 'claw' && (clip.loop || Object.keys(markers).length !== 2 || !Number.isInteger(markers.strike) || !Number.isInteger(markers.impact)
      || !(0 < markers.strike && markers.strike < markers.impact && markers.impact < count - 1))) throw new Error('Claw requires ordered strike and impact markers within a one-shot clip');
    if (clip.markers === null || typeof markers !== 'object' || Array.isArray(markers) || Object.entries(markers).some(([name, index]) => !namePattern.test(name) || !Number.isInteger(index) || index < 0 || index >= count)
      || new Set(Object.values(markers)).size !== Object.keys(markers).length) throw new Error('Invalid clip markers: names and distinct in-range frame indices required');
    const end = clip.end ?? 'rest';
    if (!['rest', 'free', 'terminal'].includes(end) || !['rest', 'free'].includes(clip.start ?? 'rest') || clip.end === null || clip.start === null) throw new Error('Invalid clip start/end');
    if (clip.loop && (end !== 'rest' || clip.next !== undefined)) throw new Error('Loop clips close themselves and cannot declare end/next transitions');
    if (clip.next !== undefined && (end !== 'free' || !names.includes(clip.next))) throw new Error('Clip next requires end=free and an existing clip');
  }
}

export function validateExtensions(spec) {
  if (spec.materialSource !== undefined && (spec.materialSource !== 'procedural' || !spec.textures || Array.isArray(spec.textures) || Object.keys(spec.textures).length)) throw new Error('Procedural materials must declare an empty texture map');
  if (spec.runtimeAtlas !== undefined && typeof spec.runtimeAtlas !== 'boolean') throw new Error('runtimeAtlas must be boolean');
  if (spec.elevation !== undefined) {
    const e = spec.elevation, scale = e?.scale ?? .5;
    if (!e || !Number.isFinite(e.min) || !Number.isFinite(e.max) || e.min >= e.max) throw new Error('Elevation requires finite min < max');
    if (!Number.isFinite(scale) || scale <= 0 || scale > 1 || e.scale === null || [spec.targetSize, ...spec.sourceSizes].some(size => Math.round(size * scale) < 1)) throw new Error('Invalid elevation scale');
  }
  if (spec.runtimeBudgetMB !== undefined && (!Number.isFinite(spec.runtimeBudgetMB) || spec.runtimeBudgetMB <= 0)) throw new Error('runtimeBudgetMB must be positive');
  if (spec.runtimeContract !== undefined && (spec.runtimeContract !== 'boss' || !['enemy', 'boss-part'].includes(spec.category)
    || spec.runtimeAtlas !== true || !spec.elevation || spec.runtimeBudgetMB === undefined)) throw new Error('Boss runtime requires enemy/boss-part, atlases, elevation and runtimeBudgetMB');
}
